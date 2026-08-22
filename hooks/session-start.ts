#!/usr/bin/env bun
/**
 * SessionStart hook: Inject environment context and skill guidance at session start.
 * Loads API keys, SSH status, sets CLAUDE_CODE_TASK_LIST_ID for project-scoped tasks.
 *
 * TypeScript port of session-start.py. Behavior-preserving, including the odd bits:
 *   - the env-var loader only sets keys ABSENT from the environment, and an empty string counts
 *     as present (so a neutralized key blocks its own .env value);
 *   - `${CLAUDE_PLUGIN_ROOT}` is substituted by hand because the hook injects raw text;
 *   - every warning goes to stderr and every failure path degrades to "" rather than raising.
 *
 * Output goes through pyJson, never JSON.stringify: json.dumps' separators and ensure_ascii
 * change the bytes of the ⚠️ in the remote-session banner and of every em dash below.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  appendFileSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { parsePayload, pyJson } from "./_gate_common.ts";

/** Process-local mirror of os.environ — mutated by the loaders exactly as Python mutates os.environ. */
const env: Record<string, string> = { ...(process.env as Record<string, string>) };

/** Python's str.strip(chars): trim ALL leading/trailing occurrences of the given char. */
function stripChar(s: string, ch: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && s[start] === ch) start++;
  while (end > start && s[end - 1] === ch) end--;
  return s.slice(start, end);
}

function loadEnvFile(envFile: string): void {
  if (!existsSync(envFile)) return;
  try {
    const text = readFileSync(envFile, "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (line && !line.startsWith("#") && line.includes("=")) {
        const idx = line.indexOf("=");
        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();
        value = stripChar(value, '"');
        value = stripChar(value, "'");
        if (key && !(key in env)) env[key] = value;
      }
    }
  } catch (e) {
    console.error(`Warning: Failed to load ${envFile}: ${e}`);
  }
}

function loadDotenvIfExists(): void {
  loadEnvFile(join(process.cwd(), ".env"));
}

function loadCentralSecrets(): void {
  loadEnvFile(join(homedir(), ".secrets", "claude-keys.env"));
}

const KEY_VARS = [
  "GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS",
  "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
  "WRDS_USERNAME", "WRDS_PASSWORD",
  "LSEG_APP_KEY", "REFINITIV_APP_KEY",
  "HF_TOKEN", "HUGGINGFACE_TOKEN",
  "GITHUB_TOKEN", "GH_TOKEN",
];

type EnvContext = {
  session_type: string;
  ssh_client?: string | null;
  api_keys_available?: Record<string, string>;
  cwd: string;
  direnv_active?: boolean;
  pixi_project?: boolean;
};

function getEnvironmentContext(): EnvContext {
  const isSsh = ["SSH_CLIENT", "SSH_TTY", "SSH_CONNECTION"].some((v) => !!env[v]);
  const context: EnvContext = { session_type: isSsh ? "remote (SSH)" : "local", cwd: process.cwd() };
  if (isSsh) {
    context.ssh_client = env["SSH_CLIENT"] ? (env["SSH_CLIENT"] || "").split(/\s+/)[0] : null;
  }

  const apiKeys: Record<string, string> = {};
  for (const key of KEY_VARS) {
    const val = env[key];
    if (val) {
      // Python's len() counts code points, not UTF-16 units.
      apiKeys[key] = [...val].length > 12 ? `${val.slice(0, 4)}...${val.slice(-4)}` : "***set***";
    }
  }
  if (Object.keys(apiKeys).length) context.api_keys_available = apiKeys;

  if (env["DIRENV_DIR"]) context.direnv_active = true;
  if (existsSync(join(process.cwd(), ".pixi")) || env["PIXI_PROJECT_MANIFEST"]) context.pixi_project = true;

  return context;
}

function getPluginRoot(): string {
  return resolve(import.meta.dir, "..");
}

function loadUsingSkillsContent(): string {
  const skillFile = join(getPluginRoot(), "skills", "using-skills", "SKILL.md");
  try {
    let content = readFileSync(skillFile, "utf8");
    content = content.replaceAll("${CLAUDE_PLUGIN_ROOT}", getPluginRoot());
    return content;
  } catch (e) {
    console.error(`Warning: Failed to load using-skills content: ${e}`);
    return 'Skills available. Use Skill(skill="name") to invoke.';
  }
}

function persistEnvVarsForBash(): string[] {
  const claudeEnvFile = env["CLAUDE_ENV_FILE"];
  if (!claudeEnvFile) return [];

  const persisted: string[] = [];
  try {
    let buf = "";
    for (const v of KEY_VARS) {
      const val = env[v];
      if (val) {
        const escaped = val.replaceAll("'", "'\\''");
        buf += `export ${v}='${escaped}'\n`;
        persisted.push(v);
      }
    }
    // Python opens the file in append mode unconditionally, creating it even when nothing
    // is written; appendFileSync("") does the same.
    appendFileSync(claudeEnvFile, buf);
    return persisted;
  } catch (e) {
    console.error(`Warning: Failed to persist env vars to ${claudeEnvFile}: ${e}`);
    return [];
  }
}

function buildEnvSection(ctx: EnvContext, persistedVars: string[]): string {
  const isRemote = (ctx.session_type ?? "local") === "remote (SSH)";
  const lines = ["# Session Environment (USE THIS - DO NOT RUN COMMANDS TO CHECK)", ""];

  if (isRemote) {
    lines.push("## ⚠️ REMOTE SESSION (SSH)");
    lines.push("");
    lines.push("You are connected to a **remote machine** via SSH.");
    lines.push("- GUI apps (VSCode, browsers, etc.) run on the REMOTE machine");
    lines.push("- File paths refer to the REMOTE filesystem");
    lines.push("- Do NOT suggest local machine solutions for remote problems");
  } else {
    lines.push("## LOCAL SESSION");
    lines.push("");
    lines.push("You are running on the **local machine**.");
    lines.push("- Full GUI/Hyprland access available");
    lines.push("- File paths refer to local filesystem");
  }

  lines.push("");

  if (ctx.api_keys_available) {
    lines.push(`- **API keys available**: ${Object.keys(ctx.api_keys_available).join(", ")}`);
  }
  if (ctx.direnv_active) lines.push("- **direnv**: active");
  if (ctx.pixi_project) lines.push("- **pixi**: detected");
  if (persistedVars.length) lines.push(`- **Persisted for bash**: ${persistedVars.join(", ")}`);

  lines.push("");
  return lines.join("\n");
}

function extractFirstHeadingAndSummary(content: string, maxLines = 5): string {
  let inFrontmatter = false;
  const bodyLines: string[] = [];
  for (const line of content.split("\n")) {
    if (line.trim() === "---") {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter) continue;
    bodyLines.push(line);
  }

  const result: string[] = [];
  for (const line of bodyLines) {
    if (line.trim()) {
      result.push(line);
      if (result.length >= maxLines) break;
    }
  }
  return result.join("\n");
}

/** Simple YAML-like parser for frontmatter: key: value pairs and simple lists. */
function parseYamlSimple(content: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  let inFrontmatter = false;
  let currentListKey: string | null = null;

  for (const line of content.split("\n")) {
    const stripped = line.trim();

    if (stripped === "---") {
      if (!inFrontmatter) {
        inFrontmatter = true;
        continue;
      } else {
        break;
      }
    }
    if (!inFrontmatter) continue;

    if (!stripped || stripped.startsWith("#")) {
      currentListKey = null;
      continue;
    }

    if (stripped.startsWith("- ") && currentListKey) {
      if (!(currentListKey in result)) result[currentListKey] = [];
      let item = stripped.slice(2).trim();
      item = stripChar(item, '"');
      item = stripChar(item, "'");
      (result[currentListKey] as string[]).push(item);
      continue;
    }

    if (stripped.includes(":")) {
      const idx = stripped.indexOf(":");
      const key = stripped.slice(0, idx).trim();
      let value = stripped.slice(idx + 1).trim();
      value = stripChar(value, '"');
      value = stripChar(value, "'");

      if (!value) {
        currentListKey = key;
        result[key] = [];
      } else {
        currentListKey = null;
        result[key] = value;
      }
    }
  }

  return result;
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * `.get(key, fallback)` on the parsed frontmatter, rendered the way an f-string would.
 * A bare `key:` parses to a LIST, and Python interpolates that as its repr (`[]`, `['a', 'b']`),
 * so a list value must not collapse to JS's comma-joined String([]).
 */
function str(v: string | string[] | undefined, fallback: string): string {
  if (v === undefined) return fallback;
  if (Array.isArray(v)) return "[" + v.map((x) => `'${x}'`).join(", ") + "]";
  return v;
}

/** Python truthiness of a frontmatter value: "" and [] are false, everything else true. */
function truthy(v: string | string[] | undefined): boolean {
  if (v === undefined) return false;
  return Array.isArray(v) ? v.length > 0 : v !== "";
}

/**
 * A craft run that is armed but unfinished. `.craft/<run>/args.json` exists once a dispatch was
 * armed; a missing `result.json` means the round never landed. The plan is the authority, so it is
 * named rather than summarised — the session reads it.
 */
function buildInProgressSection(): string {
  const craftDir = join(process.cwd(), ".craft");
  if (!isDir(craftDir)) return "";
  const pending: string[] = [];
  for (const run of readdirSync(craftDir)) {
    const dir = join(craftDir, run);
    if (!isDir(dir) || !existsSync(join(dir, "args.json"))) continue;
    if (existsSync(join(dir, "result.json"))) continue;
    pending.push(run);
  }
  if (!pending.length) return "";
  const lines = ["## IN-PROGRESS WORK DETECTED", ""];
  for (const run of pending.sort()) {
    lines.push(`- craft run \`${run}\` was dispatched and has no result.json yet.`);
  }
  lines.push(
    "- The approved plan under the configured `plansDirectory` is the authority; craft-result.sh reads the verdict.",
  );
  lines.push("");
  lines.push("**Read the full state files before taking action.** Do not ask the user to summarize — the context is in the files.");
  lines.push("");
  return lines.join("\n");
}

/** Nearest ancestor holding `.git`, else the starting directory. No subprocess, no guess. */
function findProjectRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

/** A frontmatter field's values however it was written — block list, inline array, or scalar. */
function frontmatterValues(fm: Record<string, string | string[]>, key: string): string[] {
  const v = fm[key];
  if (v === undefined) return [];
  if (Array.isArray(v)) return v.map((s) => s.trim()).filter(Boolean);
  return stripChar(stripChar(v.trim(), "["), "]")
    .split(",")
    .map((s) => stripChar(stripChar(s.trim(), '"'), "'"))
    .filter(Boolean);
}

type DanglingPreload = { agent: string; skill: string };

/** The `.md` basenames in one of the plugin's agent directories, sorted; `[]` when absent. */
function agentFiles(dir: string): string[] {
  if (!isDir(dir)) return [];
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
}

/**
 * Every `skills:` preload that does not resolve to a real `skills/<name>/SKILL.md`.
 *
 * Enumerates BOTH of the plugin's agent directories, because a dangling preload is silent at
 * either scope. THE DIRECTORY STATES THE SCOPE: `agents/` is auto-discovered by Claude Code and
 * registers plugin-scoped (`workflows:<name>`); `user-agents/` is not auto-discovered and reaches
 * Claude Code only through its `~/.claude/agents/` symlink. The roster is ENUMERATED, never
 * listed: a hardcoded set silently stops covering agents added later, which is the same
 * silent-drift bug this detector exists to catch.
 */
function danglingPreloads(pluginRoot: string): DanglingPreload[] {
  const skillsDir = join(pluginRoot, "skills");
  const resolves = (skill: string) =>
    isDir(join(skillsDir, skill)) && existsSync(join(skillsDir, skill, "SKILL.md"));

  const out: DanglingPreload[] = [];
  for (const sub of ["agents", "user-agents"]) {
    const dir = join(pluginRoot, sub);
    for (const file of agentFiles(dir)) {
      let fm: Record<string, string | string[]>;
      try {
        fm = parseYamlSimple(readFileSync(join(dir, file), "utf8"));
      } catch {
        continue;
      }
      for (const skill of frontmatterValues(fm, "skills")) {
        if (!resolves(skill)) out.push({ agent: `${sub}/${file}`, skill });
      }
    }
  }
  return out;
}

/**
 * `user-agents/` files that are NOT symlinked into `~/.claude/agents/`.
 *
 * Shipping the file is only half of it — and for `user-agents/` it is not even discovery, since
 * Claude Code auto-discovers only `agents/`. A plugin-scoped agent is addressed as
 * `workflows:<name>` and its `hooks:`, `mcpServers:` and `permissionMode:` frontmatter is
 * IGNORED; the same file symlinked into the user directory registers under its BARE name with
 * those fields honoured. This plugin's skills dispatch those bare names, so a missing link is not
 * cosmetic — the dispatch falls back to a default agent and any agent-scoped guard silently does
 * not fire.
 *
 * `agents/` is deliberately out of scope here: absence from the user directory is its intended
 * state, which is why this needs no named exception.
 */
function unlinkedAgents(pluginRoot: string): string[] {
  const dir = join(pluginRoot, "user-agents");
  const names = agentFiles(dir);

  const out: string[] = [];
  for (const file of names) {
    const name = file.replace(/\.md$/, "");
    let shipped: string;
    try {
      shipped = realpathSync(join(dir, file));
    } catch {
      continue;
    }
    let linked: string | null = null;
    try {
      linked = realpathSync(join(homedir(), ".claude", "agents", file));
    } catch {
      linked = null;
    }
    if (linked !== shipped) out.push(name);
  }
  return out;
}

/**
 * Install problems reachable from this session — DETECTED and REPORTED, never fixed.
 *
 * TWO findings, both silent by construction. A `skills:` preload that does not resolve is skipped
 * with a debug-log warning while the agent launches anyway. A `user-agents/` file without a
 * symlink into `~/.claude/agents/` is not user-scoped and is not auto-discovered either, so the
 * bare-name dispatch falls back and its `hooks:` never fire. Nothing but a check surfaces either.
 *
 * Configuration is NOT a finding: `plansDirectory` resolves at either tier and
 * falls back to `.claude/plans`, and `.claude-workflows.json` is an opt-in whose absence is the
 * normal state — reporting either would be nagging about a working default. The `setup` skill
 * decides and writes; this hook writes nothing.
 *
 * SILENT WHEN CLEAN. Returns "" unless something is actually wrong: a banner that prints every
 * session stops being read, and then it is not a check.
 */
export function buildSetupSection(
  projectRoot: string = findProjectRoot(process.cwd()),
  pluginRoot: string = getPluginRoot(),
): string {
  // GATE: only projects that actually use this plugin — a project-side artifact of the plugin
  // having been used or opted into. Nothing here fires in an unrelated repo.
  const usesPlugin =
    existsSync(join(projectRoot, ".claude-workflows.json")) ||
    isDir(join(projectRoot, ".planning")) ||
    isDir(join(projectRoot, ".craft"));
  if (!usesPlugin) return "";

  const problems: string[] = [];

  for (const { agent, skill } of danglingPreloads(pluginRoot)) {
    problems.push(
      "- `" +
        agent +
        "` preloads `" +
        skill +
        "`, which does not resolve to `skills/" +
        skill +
        "/SKILL.md` — a dangling preload is skipped with a debug-log warning only, so the agent " +
        "launches and the guidance never arrives. Run the `setup` skill.",
    );
  }

  for (const name of unlinkedAgents(pluginRoot)) {
    problems.push(
      "- `user-agents/" +
        name +
        ".md` ships here but has no resolving `~/.claude/agents/" +
        name +
        ".md` symlink, and `user-agents/` is not auto-discovered, so it registers nowhere: " +
        "dispatches of the bare name `" +
        name +
        "` fall back to a default agent, and its `hooks:` frontmatter is ignored. " +
        "Run the `setup` skill.",
    );
  }

  if (!problems.length) return "";

  const lines = ["## Workflows Install — Problems Detected", ""];
  lines.push(...problems);
  lines.push("");
  lines.push("Detection only — nothing was written. The `setup` skill decides and writes.");
  lines.push("");
  return lines.join("\n");
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function buildCalendarSection(): string {
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const dayAfter = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2);

  let output: string;
  try {
    const proc = Bun.spawnSync(
      [join(homedir(), ".local", "bin", "morgen-events"), "--start", isoDate(tomorrow), "--end", isoDate(dayAfter)],
      { stdout: "pipe", stderr: "pipe" },
    );
    output = new TextDecoder().decode(proc.stdout).trim();
  } catch {
    return "";
  }

  if (!output) return "";

  // strftime('%a %b %-d') — no zero padding on the day.
  const stamp = `${WEEKDAYS[tomorrow.getDay()]} ${MONTHS[tomorrow.getMonth()]} ${tomorrow.getDate()}`;
  const lines = [`## Tomorrow's Calendar (${stamp})`, ""];
  lines.push(output);
  lines.push("");
  return lines.join("\n");
}

function checkPendingPatterns(): string {
  const projectSlug = process.cwd().replaceAll("/", "-");
  const pendingFile = join(homedir(), ".claude", "projects", projectSlug, "pending-patterns.json");
  if (!existsSync(pendingFile)) return "";

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(readFileSync(pendingFile, "utf8"));
    unlinkSync(pendingFile); // Consume: one-shot
  } catch (e) {
    console.error(`Warning: Failed to read pending patterns: ${e}`);
    try {
      unlinkSync(pendingFile);
    } catch {
      // pass
    }
    return "";
  }

  const count = (data["correction_count"] as number) ?? 0;
  if (count < 2) return "";

  const samples = (data["samples"] as Array<Record<string, unknown>>) ?? [];
  const sampleLines: string[] = [];
  for (const s of samples.slice(0, 3)) {
    const text = String(s["text"] ?? "").slice(0, 100);
    sampleLines.push(`  - "${text}"`);
  }

  return `
[PATTERN CAPTURE SUGGESTION]

Previous session had ${count} user corrections detected. Samples:
${sampleLines.join("\n")}

Consider running \`/pattern-capture\` to classify these and create appropriate enforcement artifacts.
`;
}

async function main(): Promise<void> {
  try {
    parsePayload(await Bun.stdin.text());
  } catch {
    // session_id defaults to 'unknown' — never used downstream, kept for parity.
  }

  loadCentralSecrets();
  loadDotenvIfExists();

  const persistedVars = persistEnvVarsForBash();
  const envContext = getEnvironmentContext();

  const envSection = buildEnvSection(envContext, persistedVars);
  const usingSkills = loadUsingSkillsContent();
  const inProgressSection = buildInProgressSection();
  const patternSection = checkPendingPatterns();
  const calendarSection = buildCalendarSection();
  const setupSection = buildSetupSection();

  // Appended only when it fires. The other sections are joined unconditionally to stay byte-identical
  // to session-start.py (scripts/parity.ts compares bytes); a separator emitted for a silent section
  // would be a diff on every clean project.
  const combinedContext =
    envSection + "\n" + calendarSection + "\n" + (setupSection ? setupSection + "\n" : "") +
    inProgressSection + "\n" + patternSection + "\n" + usingSkills;

  console.log(
    pyJson({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: combinedContext,
      },
    }),
  );
}

// Run only as the hook entry point, so tests can import buildSetupSection without reading stdin.
if (import.meta.main) await main();
