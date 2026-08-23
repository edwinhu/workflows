#!/usr/bin/env bun
// SDK runner: delegate to a CLIProxyAPI wrapper in a separate process.
// The wrapper's --settings-json both starts the proxy and yields the env block.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const WRAPPERS: Record<string, string> = {
  claude: "claude-code",
  codex: "codex-code",
  gemini: "gemini-code",
};

// Without this, a delegated run will report success it never observed.
const ANTI_SIM =
  "\n\nYou MUST actually perform this work with real tool calls. Do not simulate, " +
  "summarize, or claim any completion you did not observe. If you cannot do it, " +
  "say so explicitly with the exact error text and stop.";

type Task = { prompt: string; expect?: string | string[]; model?: string; label?: string };

// Exit 2 is "you called me wrong" — distinct from 1, "the delegation failed".
function refuse(msg: string): never {
  console.error(msg);
  process.exit(2);
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith("--")) refuse(`--${name} needs a value`);
  return v;
}
function argAll(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a !== `--${name}`) return;
    const v = process.argv[i + 1];
    if (v === undefined || v.startsWith("--")) refuse(`--${name} needs a value`);
    out.push(v);
  });
  return out;
}

// ---- argument validation -------------------------------------------------
// All of it runs before the wrapper probe: a refusal must not depend on the
// proxy being reachable.

const provider = arg("provider", "claude")!;
const wrapper = WRAPPERS[provider];
if (!wrapper) refuse(`unknown provider ${provider}; use claude|codex|gemini`);
const cwd = resolve(arg("cwd", process.cwd())!);

// Absolute: the child would resolve a relative script path against --cwd, not ours.
const workflowArg = arg("workflow");
const workflow = workflowArg === undefined ? undefined : resolve(workflowArg);
const tasksFile = arg("tasks");
const single = arg("task");
const cliExpect = argAll("expect");
const argsFile = arg("args");
// Absolute: the child resolves this path against --cwd, we resolve it against ours.
const outPath = arg("out") === undefined ? undefined : resolve(arg("out")!);

const modes = [workflow && "--workflow", tasksFile && "--tasks", single && "--task"].filter(Boolean);
if (modes.length === 0) refuse("need --task, --tasks, or --workflow");
if (modes.length > 1) refuse(`pick one of ${modes.join(", ")}`);

let wfArgs: unknown;
if (workflow) {
  // A workflow's value is a structured return. Relaying it as prose puts a model
  // in the gate path, so the child writes the object to --out and we check the file.
  if (!outPath) {
    refuse("--workflow requires --out <path>: the returned object is the result, not the summary");
  }
  if (!existsSync(dirname(outPath!))) refuse(`--out ${outPath}: directory does not exist`);
  // A directory here would blow up the pre-run rm mid-flight, after the dispatch.
  if (existsSync(outPath!) && statSync(outPath!).isDirectory()) {
    refuse(`--out ${outPath} is a directory`);
  }
  if (argsFile !== undefined) {
    try {
      wfArgs = JSON.parse(readFileSync(argsFile, "utf8"));
    } catch (e) {
      refuse(`--args ${argsFile} is not readable JSON: ${(e as Error).message}`);
    }
    // Workflow args are a keyed payload; anything else is a caller mistake.
    if (wfArgs === null || typeof wfArgs !== "object" || Array.isArray(wfArgs)) {
      refuse(`--args ${argsFile} must hold a JSON object, got ${Array.isArray(wfArgs) ? "array" : wfArgs === null ? "null" : typeof wfArgs}`);
    }
  }
  // Cheaper to catch a typo'd path here than 20-60 minutes into a dispatched run.
  if (!existsSync(workflow)) refuse(`--workflow ${workflow}: no such file`);
} else if (argsFile !== undefined || outPath !== undefined) {
  refuse("--args and --out apply only to --workflow");
}

let tasks: Task[] = [];
if (tasksFile) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(tasksFile, "utf8"));
  } catch (e) {
    refuse(`--tasks ${tasksFile} is not readable JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed)) refuse(`--tasks ${tasksFile} must hold a JSON array of tasks`);
  tasks = parsed as Task[];
  if (tasks.some((t) => typeof t?.prompt !== "string")) {
    refuse(`--tasks ${tasksFile}: every task needs a string "prompt"`);
  }
}

// ---- proxy ---------------------------------------------------------------

// Starts the proxy as a side effect and validates the wrapper's model slots.
const probe = spawnSync(wrapper, ["--settings-json"], { encoding: "utf8" });
if (probe.status !== 0) {
  console.error(`${wrapper} --settings-json failed:\n${probe.stderr}`);
  process.exit(1);
}
const settings = JSON.parse(probe.stdout);
Object.assign(process.env, settings.env);
// Exempts our own children from the main-thread-guard PreToolUse hook, which would
// otherwise deny the delegation this script exists to perform.
process.env.FARM_OUT_CHILD = "1";

// node_modules is gitignored, so a fresh dotfiles clone has no SDK yet.
const skillRoot = new URL("..", import.meta.url).pathname;
if (!existsSync(`${skillRoot}node_modules/@anthropic-ai/claude-agent-sdk`)) {
  const r = spawnSync("bun", ["install"], { cwd: skillRoot, stdio: "inherit" });
  if (r.status !== 0) throw new Error("bun install failed in " + skillRoot);
}
const { query } = await import("@anthropic-ai/claude-agent-sdk");

function expectsOf(t: Task): string[] {
  return t.expect ? (Array.isArray(t.expect) ? t.expect : [t.expect]) : [];
}

// Rule 1: the model's own summary is not evidence. Check the artifact.
//
// Resolved against `cwd` — the directory the AGENT worked in — not this process's.
// They are routinely different (`farm.ts` is launched from wherever the caller sat,
// with `--cwd` pointing elsewhere), and a bare existsSync then checks a path that
// never existed and reports every artifact missing however well the task went.
function verify(paths: string[]): { ok: boolean; missing: string[] } {
  const missing = paths.filter((p) => {
    const abs = isAbsolute(p) ? p : resolve(cwd, p);
    return !existsSync(abs) || statSync(abs).size === 0;
  });
  return { ok: missing.length === 0, missing };
}

// One line per milestone on STDERR, so a caller watching the log sees progress,
// AND appended to a conventional per-pid file the plugin monitor tails. stdout
// stays pure JSON.
//
// TMPDIR, not the repo: session-scoped, high-frequency, nobody's working tree.
const EVENT_DIR = join(process.env.TMPDIR ?? "/tmp", "farm-events");
const EVENT_FILE = join(EVENT_DIR, `${process.pid}.ndjson`);
function event(line: string): void {
  const out = `farm: ${line}\n`;
  process.stderr.write(out);
  try {
    mkdirSync(EVENT_DIR, { recursive: true });
    appendFileSync(EVENT_FILE, out);
  } catch {
    // Observability must never take the run down.
  }
}

async function run(task: Task, model?: string) {
  let text = "";
  const models = new Set<string>();
  let toolCalls = 0;
  const label = task.label ?? "task";
  event(`START ${label} cwd=${cwd} expect=${expectsOf(task).length}`);
  for await (const message of query({
    prompt: task.prompt + ANTI_SIM,
    options: {
      cwd,
      model: model ?? task.model ?? settings.model,
      permissionMode: "bypassPermissions",
      allowedTools: undefined, // inherit the full toolset; the task decides
    },
  })) {
    const m = message as any;
    if (m.type === "assistant") {
      if (m.message?.model) models.add(m.message.model);
      for (const b of m.message?.content ?? []) {
        if (b.type === "tool_use") {
          toolCalls++;
          // Sparse on purpose: enough to tell working from wedged, not a firehose.
          if (toolCalls % 10 === 0) event(`PROGRESS ${label} toolCalls=${toolCalls}`);
        }
        if (b.type === "text") text = b.text;
      }
    }
    if ("result" in m) text = m.result ?? text;
  }
  const v = verify(expectsOf(task));
  event(
    v.ok
      ? `DONE ${label} ok toolCalls=${toolCalls}`
      : `DONE ${label} UNVERIFIED toolCalls=${toolCalls} missing=${v.missing.join(",")}`
  );
  return {
    label: task.label ?? "task",
    ok: v.ok,
    toolCalls,          // 0 tool calls on a work task is a fabrication smell
    models: [...models],
    missing: v.missing,
    result: text,
  };
}

let out: any;
if (workflow) {
  // A leftover file from an earlier run would satisfy the artifact check without
  // this run writing anything.
  rmSync(outPath!, { force: true });
  out = await run({
    // The Workflow tool lives in the delegated session; ask it to run the script.
    prompt:
      `Call the Workflow tool with scriptPath ${workflow} and ` +
      (wfArgs === undefined ? "no args" : `exactly these args:\n${JSON.stringify(wfArgs)}`) +
      `. Do not write your own script and do not alter the args.\n\n` +
      // The Workflow tool returns a task id immediately and runs in the background.
      // A child that ends its turn there takes the whole run down with the session.
      `CRITICAL — Workflow returns IMMEDIATELY with a task id and then keeps running in ` +
      `the background. If you end your turn at that point the session exits and the entire ` +
      `run is destroyed. You MUST NOT end your turn until the workflow has actually ` +
      `returned. It may take 20-60 minutes.\n` +
      `After calling Workflow, stay alive by polling: run \`sleep 120\` via Bash, then check ` +
      `whether it finished (ToolSearch for "select:TaskList,TaskGet,TaskOutput" and use those, ` +
      `or read the workflow transcript directory named in the Workflow result). Repeat for as ` +
      `long as it takes. Never emit a final text message while the workflow is still running.\n\n` +
      `When it returns, write the returned object to ${outPath} as a single JSON ` +
      `document using the Write tool — verbatim, no commentary, no summarising. ` +
      `If Workflow throws, write {"error": "<exact error text>"} to that same path. ` +
      `Do not retry with invented arguments.`,
    expect: [...cliExpect, outPath!],
    label: "workflow",
  });
  // Non-empty is not structured: a child that wrote its summary would pass the
  // artifact check and hand prose to the caller as the workflow's return value.
  if (out.ok) {
    try {
      const parsed = JSON.parse(readFileSync(outPath!, "utf8"));
      if (parsed === null || typeof parsed !== "object") throw new Error("not a JSON object");
    } catch (e) {
      out.ok = false;
      out.missing = [`${outPath} (not a JSON object: ${(e as Error).message})`];
    }
  }
} else if (tasksFile) {
  out = await Promise.all(tasks.map((t, i) => run({ ...t, label: t.label ?? `task-${i}` })));
} else {
  out = await run({ prompt: single!, expect: cliExpect, label: "task" });
}

console.log(JSON.stringify(out, null, 2));
const failed = (Array.isArray(out) ? out : [out]).filter((r: any) => !r.ok);
if (failed.length) {
  console.error(`\nUNVERIFIED: ${failed.map((f: any) => `${f.label} missing ${f.missing}`).join("; ")}`);
  process.exit(1);
}
