#!/usr/bin/env bun
/**
 * PreToolUse on CronDelete: refuse to cancel the loop that drives a work run still in flight.
 *
 * The refusal is TASK-SPECIFIC. `--record` runs as PostToolUse on CronCreate and appends the new
 * job id to `heartbeatCrons` in the args.json of every `.craft/<run>` whose name the prompt names,
 * so the guard denies only when a run CLAIMING this id is in flight; an id no run claims falls back
 * to the old rule (deny while any run is in flight).
 *
 * In flight is decided as work-goal-resend.sh decides it -- a run directory holds args.json with
 * no non-empty result.json beside it. That is a property of the filesystem, not of anyone's belief
 * that the run is over, which is exactly where the judgement failed (measured 2026-09-14: a loop
 * deleted at round 2 of 6 with the goal unmet, on the reasoning that the run had been halted).
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { allow, deny, denyOnCrash, parsePayload } from "./_gate_common.ts";
import { statePath } from "./work-hold.ts";

/** A cron job id as CronCreate mints them: 8 lowercase hex chars. */
const JOB_ID = /\b[0-9a-f]{8}\b/;

/** Run directories under `<cwd>/.craft` that hold an args.json, with what that file says. */
interface Run {
  name: string;
  argsPath: string;
  argsMtime: number;
  inFlight: boolean;
  crons: string[];
}

function runsUnder(cwd: string): Run[] | null {
  const craftDir = join(cwd, ".craft");
  let entries: string[];
  try {
    entries = readdirSync(craftDir);
  } catch {
    return null; // no .craft at all: a determinate "no run here"
  }
  const runs: Run[] = [];
  for (const name of entries) {
    const argsPath = join(craftDir, name, "args.json");
    let argsMtime: number;
    try {
      argsMtime = statSync(argsPath).mtimeMs;
    } catch {
      continue; // not a run directory
    }
    let inFlight = true;
    try {
      if (statSync(join(craftDir, name, "result.json")).size > 0) inFlight = false; // has a verdict
    } catch {
      // An absent result.json IS the in-flight shape.
    }
    let crons: string[] = [];
    try {
      const parsed = JSON.parse(readFileSync(argsPath, "utf8"));
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.heartbeatCrons)) {
        crons = parsed.heartbeatCrons.filter((x: unknown) => typeof x === "string");
      }
    } catch {
      // Unparseable args.json claims nothing; it is still a run directory for the fallback rule.
    }
    runs.push({ name, argsPath, argsMtime, inFlight, crons });
  }
  return runs;
}

// ---------------------------------------------------------------- record mode (PostToolUse)

/**
 * NEVER blocks and NEVER prints a decision: a PostToolUse hook that emits a PreToolUse shape gets
 * the payload rejected, and a crash here must not be visible at all. Every failure exits 0 silently.
 */
if (process.argv.includes("--record")) {
  try {
    const payload: Record<string, unknown> = JSON.parse(await Bun.stdin.text());
    const toolInput = (payload?.tool_input ?? {}) as Record<string, unknown>;
    const prompt = String(toolInput?.prompt ?? "");
    const response = payload?.tool_response as unknown;

    // tool_response is an object for some tools and a bare string for others, so both are read.
    let id = "";
    if (response && typeof response === "object" && typeof (response as Record<string, unknown>).id === "string") {
      id = (response as Record<string, unknown>).id as string;
    } else if (typeof response === "string") {
      id = response.match(JOB_ID)?.[0] ?? "";
    }
    if (!JOB_ID.test(id)) process.exit(0);

    const cwd = String(payload?.cwd ?? "") || process.cwd();
    for (const run of runsUnder(cwd) ?? []) {
      if (!run.name || !prompt.includes(run.name)) continue;
      if (run.crons.includes(id)) continue; // idempotent
      const raw = readFileSync(run.argsPath, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      parsed.heartbeatCrons = [...run.crons, id];
      // Keep the file's own formatting: the indent of its first nested line, and its trailing newline.
      const indent = raw.match(/^\{\r?\n([ \t]+)"/)?.[1] ?? "";
      writeFileSync(run.argsPath, JSON.stringify(parsed, null, indent) + (raw.endsWith("\n") ? "\n" : ""));
    }
  } catch {
    // Recording is best-effort: a run whose id was never recorded simply falls back to the old rule.
  }
  process.exit(0);
}

// ---------------------------------------------------------------- guard mode (PreToolUse)

// FIRST STATEMENT WITH AN EFFECT: a throw below becomes a schema-valid deny instead of an exit-1,
// which Claude Code treats as NON-BLOCKING -- i.e. a silent allow in a PreToolUse gate.
denyOnCrash("CRON DELETE GUARD");

const hookInput: Record<string, unknown> = parsePayload(await Bun.stdin.text());

if (String(hookInput?.tool_name ?? "") !== "CronDelete") allow();

// The deliberate override, for genuinely abandoning a run.
if (process.env.CRAFT_ALLOW_CRON_DELETE === "1") allow();

const cwd = String(hookInput?.cwd ?? "") || process.cwd();
const deleteId = String(((hookInput?.tool_input ?? {}) as Record<string, unknown>)?.id ?? "");

// ------------------------------------------------------------ the hold gate: DONE MEANS GOAL MET
//
// The heartbeat's teardown clause fires on "this goal closes", and the session decides that from
// what it can see -- which used to be a green check and nothing else. Measured 2026-09-26: a work
// run armed with no `--goal`, `work-result.sh` exited 0, the hold released on the check alone, and the
// loop was deleted with the user's actual objective (an estimate landing inside the published
// interval) untouched. So the authority on "closed" is the HOLD'S OWN RELEASE, read from the same
// per-session ledger work-hold.ts writes -- not this hook's opinion and not the session's.
// ONLY the payload. A PreToolUse payload always carries session_id, so an ambient fallback buys
// nothing and costs correctness: measured 2026-09-27, `CLAUDE_CODE_SESSION_ID` leaking in from the
// session that merely LAUNCHED the process made this gate answer about that session's hold instead
// of the one the call belongs to -- four tests denied by the real ledger of the shell's own session.
//
// SCOPE: an ARMED hold only. A RELEASED hold is not this gate's business, whatever verb it released
// on -- the PASSED_UNJUDGED verb used to deny too, and that was wrong in both directions: it held the
// heartbeat open on a run the user had already walked away from, while saying nothing a re-arm
// could not say. The sanctioned escape is `work-abandon.sh`, which settles the run and releases the
// hold in one step, rather than an env var the session sets for itself.
const session = String(hookInput?.session_id ?? "");
if (session && existsSync(statePath(session))) {
  deny(
    "A hold is ARMED for this session, so its objective has not closed yet. The heartbeat " +
      "is what re-enters the session while the hold is working; deleting it now leaves the hold " +
      "with nothing to wake it. Let the hold release itself (the check goes green AND the " +
      "classifier judges the goal met), or have the USER confirm `work-hold.sh --disarm` at a " +
      "terminal. If the USER has abandoned this run, retire it with " +
      "`work-abandon.sh <run-dir> --why '<reason>'`: it writes the run's verdict, releases the " +
      "hold, and this delete is then allowed.",
  );
}

// No .craft at all is a determinate "no run here", not a failure to decide, so it allows. An
// unreadable directory that EXISTS is a different case and reaches denyOnCrash via the throw.
const runs = runsUnder(cwd);
if (runs === null) allow();

// A run that CLAIMS this id answers the question by itself: a heartbeat recorded for run A says
// nothing about run B, so an unrelated in-flight run must not hold A's finished loop open.
const claiming = deleteId ? runs.filter(r => r.crons.includes(deleteId)) : [];
const candidates = claiming.length ? claiming : runs;

// The newest in-flight run among the candidates, by args.json mtime -- the file the dispatch writes.
let newest = "";
let newestMtime = 0;
for (const run of candidates) {
  if (!run.inFlight) continue;
  if (run.argsMtime > newestMtime) {
    newestMtime = run.argsMtime;
    newest = run.name;
  }
}

if (!newest) allow();

// A run-directory name that is not a plain slug is withheld rather than repeated: .craft can be
// repo-shipped, so the name is untrusted text inside a message the reader acts on.
const run = /^[A-Za-z0-9._-]+$/.test(newest) ? newest : "(a run under .craft/)";

deny(
  (claiming.length
    ? `The loop you are deleting drives a work run that is still in flight: .craft/${run}/args.json ` +
      "records this cron in heartbeatCrons and has no verdict beside it. "
    : `A work run is still in flight: .craft/${run}/args.json has no verdict beside it, and no run ` +
      "claims this cron, so it cannot be told apart from that run's heartbeat. ") +
    "The loop is usually what drives that run to completion -- it is what re-enters the session to " +
    "read the verdict, fix what failed and redispatch. Deleting it now strands the run: the " +
    "dispatch keeps going detached and nothing comes back for it. Let the run finish " +
    "(work-result.sh exits 0, or the round cap or time ceiling is reached), then delete the loop. " +
    "If you genuinely mean to abandon the run, set CRAFT_ALLOW_CRON_DELETE=1 for the call and say " +
    "so out loud.",
);
