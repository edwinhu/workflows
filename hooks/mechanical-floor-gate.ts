#!/usr/bin/env bun
/**
 * PreToolUse gate: guarantee the deterministic static-analysis floor (check-all) actually RAN and
 * PASSED before a phase spends tokens on its expensive fan-out. Prose "run check-all" is a suggestion
 * the model can skip; this is the enforcement (the plugin's "Hooks over prompt" doctrine).
 *
 * TypeScript port of hooks/mechanical-floor-gate.py — behavior-preserving, including the odd bits
 * (Python's `str(bool)` capitalization in the CLI summary, the `raw[:raw.rfind("}")+1]` slice, the
 * fail-open bare excepts).
 *
 * Parameterized by the FLOOR env var (set in the skill frontmatter hook command):
 *
 *   FLOOR=dev  → gate the Agent spawn (the goal-backward verifier in dev-verify, Leg 2).
 *                Runs references/constraints/check-all.py. Denies on HARD failures only.
 *
 *   FLOOR=ds   → gate the shared beat-implement Workflow spawn.
 *                Runs scripts/check-all-ds.sh; denies on non-zero exit. Gates the WORKFLOW only —
 *                NOT Agent — so fix subagents stay free.
 *
 * A constraint that ERRORED is surfaced but does NOT block. A harness error running the gate itself
 * never blocks either (fail-open).
 *
 * CLI (debug):  FLOOR=dev bun mechanical-floor-gate.ts /abs/project
 */
import { resolve, dirname, join } from "node:path";
import { deny, denyOnCrash, parsePayload, projectFromArgs } from "./_gate_common.ts";

// FIRST STATEMENT WITH AN EFFECT: a throw below becomes a schema-valid deny instead of an
// exit-1, which Claude Code treats as NON-BLOCKING — i.e. a silent allow in a PreToolUse gate.
denyOnCrash("MECHANICAL FLOOR GATE");

const HOOKS_DIR = resolve(import.meta.dir);
const REPO = dirname(HOOKS_DIR);
const CHECK_ALL_PY = join(REPO, "references", "constraints", "check-all.py");
const CHECK_ALL_DS = join(REPO, "scripts", "check-all-ds.sh");

/** Python's `str.splitlines()`: no trailing empty element, and "" -> []. */
function pySplitlines(s: string): string[] {
  if (s === "") return [];
  const parts = s.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** Python's `str.strip()` (whitespace both ends) followed by `splitlines()`. */
function strippedLines(s: string): string[] {
  return pySplitlines(s.trim());
}

/** `(lines or [fallback])[-1]` */
function lastLine(s: string, fallback: string): string {
  const lines = strippedLines(s);
  return lines.length ? lines[lines.length - 1] : fallback;
}

type RunOut = { stdout: string; returncode: number };

/** subprocess.run(..., capture_output=True, text=True, timeout=180). Throws like Python does. */
function runProc(cmd: string[]): RunOut {
  const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", timeout: 180_000 });
  if (r.signalCode === "SIGTERM" || r.signalCode === "SIGKILL") throw new Error("timeout");
  const stdout = new TextDecoder().decode(r.stdout ?? new Uint8Array()).replace(/\r\n/g, "\n");
  return { stdout, returncode: r.exitCode ?? 1 };
}

type FloorResult = { ok: boolean; failed: string[]; errors: string[]; summary: string };

/** check-all.py (dev). ok iff no hard content FAILURES. */
function runDev(project: string): FloorResult {
  let out: RunOut;
  try {
    out = runProc(["uv", "run", "--with", "lxml", "python3", CHECK_ALL_PY, project]);
  } catch (e) {
    return { ok: true, failed: [], errors: [], summary: `(check-all.py could not run: ${e})` };
  }
  let failed: string[] = [];
  let errors: string[] = [];
  try {
    const raw = out.stdout;
    // strip the trailing human summary line — mirrors raw[:raw.rfind("}") + 1] exactly,
    // including the rfind == -1 case that slices to "" and makes the parse throw.
    const data = JSON.parse(raw.slice(0, raw.lastIndexOf("}") + 1));
    if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error("not a dict");
    const name = (f: unknown) =>
      f !== null && typeof f === "object" && !Array.isArray(f)
        ? String((f as Record<string, unknown>).name ?? "?")
        : String(f);
    failed = ((data.failed ?? []) as unknown[]).map(name);
    errors = ((data.errors ?? []) as unknown[]).map(name);
  } catch {
    if (out.returncode !== 0) {
      failed = [lastLine(out.stdout, "check-all reported failures")];
    }
  }
  const summary = lastLine(out.stdout, "(no output)");
  return { ok: failed.length === 0, failed, errors, summary };
}

/** check-all-ds.sh (ds). ok iff exit 0. */
function runDs(project: string): FloorResult {
  let out: RunOut;
  try {
    out = runProc(["bash", CHECK_ALL_DS, project]);
  } catch (e) {
    return { ok: true, failed: [], errors: [], summary: `(check-all-ds.sh could not run: ${e})` };
  }
  let failed = pySplitlines(out.stdout)
    .filter((ln) => ln.includes("✗"))
    .map((ln) => ln.slice(ln.indexOf("✗") + 1).trim());
  const summary = lastLine(out.stdout, "(no output)");
  const ok = out.returncode === 0;
  if (!ok && failed.length === 0) failed = [summary];
  return { ok, failed, errors: [], summary };
}

async function main(): Promise<never> {
  const floor = (process.env.FLOOR ?? "").trim().toLowerCase();
  const argv = process.argv.slice(2);

  // CLI debug mode
  if (argv.length > 0 && argv[0] !== "-") {
    const runner = floor === "ds" ? runDs : runDev;
    const { ok, failed, errors, summary } = runner(argv[0]);
    console.log(`FLOOR=${floor || "dev"} ok=${ok ? "True" : "False"} | ${summary}`);
    if (failed.length) console.log("FAILED (blocking):\n- " + failed.join("\n- "));
    if (errors.length) console.log("errors (non-blocking — tooling):\n- " + errors.join("\n- "));
    process.exit(ok ? 0 : 1);
  }

  // A PreToolUse GATE DENIES ON A PAYLOAD IT CANNOT READ. The `catch { exit 0 }` here was
  // Python parity, and it is precisely what `denyOnCrash` cannot reach: the handler covers
  // throws that ESCAPE, and a local catch means none does. Measured — unparseable stdin, and
  // for the raw-`JSON.parse` gates also `null`/`"s"`/`[1,2]`, produced exit 0 with no output,
  // i.e. a silent ALLOW on every malformed payload. `parsePayload` denies on a non-object and
  // lets a parse error propagate to the handler, which denies too.
  const hookInput: Record<string, unknown> = parsePayload(await Bun.stdin.text());
  const toolName = String(hookInput.tool_name ?? "");
  const toolInput = (hookInput.tool_input as Record<string, unknown>) ?? {};

  if (floor === "ds") {
    // Gate the shared DS implementation Workflow ONLY (never Agent — fix subagents must run).
    if (toolName !== "Workflow") process.exit(0);
    const project = projectFromArgs(toolInput, hookInput);
    const { ok, failed, summary } = runDs(project);
    if (!ok) {
      deny(
        "GATE BLOCKED: the DS static-analysis floor (check-all-ds.sh — determinism, join " +
          "audits, idempotency, error handling, schema contracts, standard errors, viz " +
          "integrity) has failures, so the shared implementation fan-out must not run " +
          "yet. These are code-quality defects in the analysis scripts. Dispatch a FIX " +
          "SUBAGENT (an Agent — not blocked) to fix them, then re-invoke:\n- " +
          (failed.length ? failed : [summary]).join("\n- ") +
          "\n\n(Run `bash scripts/check-all-ds.sh .` for details.)",
      );
    }
    process.exit(0);
  }

  // FLOOR=dev (default): gate the goal-backward verifier Agent spawn.
  if (toolName !== "Agent") process.exit(0);
  const project = projectFromArgs(toolInput, hookInput);
  const { ok, failed, errors, summary } = runDev(project);
  if (!ok) {
    const note = errors.length
      ? "\n\n(Plus " + String(errors.length) + " constraint(s) errored — tooling, NOT blocking.)"
      : "";
    deny(
      "GATE BLOCKED: the constraint floor (check-all.py — Leg 1) has hard failures, so the " +
        "goal-backward verifier must not run yet. Constraint failures are hard blocks — fix " +
        "these first, then re-spawn the verifier:\n- " +
        (failed.length ? failed : [summary]).join("\n- ") +
        note +
        "\n\n(Run `uv run --with lxml python3 references/constraints/check-all.py .` for details.)",
    );
  }
  process.exit(0);
}

await main();
