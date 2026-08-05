#!/usr/bin/env bun
/** PreToolUse gate: guarantee the deterministic mechanical floor (check-all.py) actually ran and
 * PASSED before the writing-review semantic fan-out spends tokens. Prose "run check-all" is a
 * suggestion the model can skip; this is the enforcement (the plugin's "Hooks over prompt" doctrine).
 *
 * TIGHTLY SCOPED on purpose (the "check-all runs all .py" history):
 *   - FIRES only on a `Workflow` tool call whose target is the writing-review engine — NOT on every
 *     Write/Edit, NOT on other workflows. (Skill-scoped to writing-review in the frontmatter too.)
 *   - RUNS check-all from the PROJECT dir, so check-all self-scopes to the WRITING constraints via its
 *     APPLIES_TO + detected-workflow filter (non-writing constraints are skipped, not run).
 *   - BLOCKS only on HARD failures — meaning a failed constraint whose module declares
 *     SEVERITY = "hard". Soft failures and advisory "conventions" (judgment-only) never block;
 *     soft ones ride along in the allow payload as context. Before v5.127.0 check-all dropped the
 *     declared severity entirely and this gate blocked on ANY failure, so advisory puffery could
 *     stop the review fan-out while a provenance leak counted no higher.
 *
 * FRESHNESS CACHE (this gate ONLY): after a successful run this gate writes
 * `.planning/.checkall-cache.json`; on the next invocation, if the freshness hash (drafts/*.md +
 * constraint files, by mtime) still matches, the cached verdict is reused. Fail-open throughout.
 *
 * CLI (debug):  bun writing-mechanical-gate.ts /abs/project
 *
 * PORT NOTE: this is a behavior-preserving port of writing-mechanical-gate.py. Python truthiness
 * (`if si`), Python's `repr()` of the (path, mtime) list that feeds the freshness hash, and Python's
 * `json.dumps` byte format are all reproduced deliberately — see pyTruthy / pyRepr / pyJson.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { deny, denyOnCrash, parsePayload, projectFromArgs, pyJson } from "./_gate_common.ts";

// FIRST STATEMENT WITH AN EFFECT: a throw below becomes a schema-valid deny instead of an
// exit-1, which Claude Code treats as NON-BLOCKING — i.e. a silent allow in a PreToolUse gate.
denyOnCrash("WRITING MECHANICAL GATE");

const HOOKS_DIR = import.meta.dir;
const PLUGIN_ROOT = resolve(HOOKS_DIR, "..");
const CHECK_ALL = join(PLUGIN_ROOT, "references", "constraints", "check-all.py");
const CACHE_REL = join(".planning", ".checkall-cache.json");

/** Python truthiness: "", 0, [], {}, null/undefined, false are falsy. */
function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return false;
  if (v === true) return true;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Non-recursive glob of `dir` for names ending in `suffix`; [] when the dir is missing. */
function globSuffix(dir: string, suffix: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith(suffix))
      .map((n) => join(dir, n));
  } catch {
    return [];
  }
}

/** Every constraint script check-all.py can execute: references/constraints/*.py plus
 * skills/<x>/references/*.py, plus check-all itself. Sorted/deduped for a stable hash input. */
function constraintFiles(): string[] {
  let files = globSuffix(join(PLUGIN_ROOT, "references", "constraints"), ".py");
  const skillsDir = join(PLUGIN_ROOT, "skills");
  let skillNames: string[] = [];
  try {
    skillNames = readdirSync(skillsDir);
  } catch {
    skillNames = [];
  }
  for (const s of skillNames) {
    files = files.concat(globSuffix(join(skillsDir, s, "references"), ".py"));
  }
  files.push(CHECK_ALL);
  return [...new Set(files)].sort();
}

/** Python `repr()` of a str — single quotes unless the value contains ' and no ". */
function pyReprStr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    if (ch === "\\") out += "\\\\";
    else if (ch === quote) out += "\\" + ch;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else {
      const code = ch.codePointAt(0)!;
      if (code < 0x20 || code === 0x7f) out += "\\x" + code.toString(16).padStart(2, "0");
      else out += ch;
    }
  }
  return out + quote;
}

/** Python `repr()` of a float: integral values keep a trailing ".0". */
function pyReprFloat(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? "inf" : Number.isNaN(n) ? "nan" : "-inf";
  const s = String(n);
  return /[.eE]/.test(s) ? s : s + ".0";
}

/** Hash of (path, mtime) over drafts/*.md + every constraint file. null on any filesystem error,
 * so a hashing failure fails OPEN to a normal check-all run. */
function freshnessHash(project: string): string | null {
  try {
    const draftsDir = join(project, "drafts");
    const drafts = isDir(draftsDir) ? globSuffix(draftsDir, ".md").sort() : [];
    const stamps: Array<[string, number]> = [];
    for (const p of drafts.concat(constraintFiles())) {
      if (!isFile(p)) continue;
      const st = statSync(p, { bigint: true });
      // Python's os.stat().st_mtime is SECONDS as a float. With { bigint: true } node still returns
      // a Date for `.mtime`, so Number(st.mtime) is MILLISECONDS — the previous form produced
      // 1784829199831.83 where Python gives 1784829199.831764, and then added a nanosecond
      // fraction on top of milliseconds. The freshness cache was cross-incompatible: a cache
      // written by Python was never honoured here and vice versa, so one side would allow while
      // the other emitted a full deny on identical inputs. mtimeNs is the only exact source.
      const mtime = Number(st.mtimeNs) / 1e9;
      stamps.push([p, mtime]);
    }
    stamps.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
    const repr = "[" + stamps.map(([p, m]) => `(${pyReprStr(p)}, ${pyReprFloat(m)})`).join(", ") + "]";
    return createHash("sha256").update(repr, "utf8").digest("hex");
  } catch {
    return null;
  }
}

function readCache(project: string): Record<string, unknown> | null {
  try {
    const cachePath = join(project, CACHE_REL);
    if (!isFile(cachePath)) return null;
    return JSON.parse(readFileSync(cachePath, "utf8"));
  } catch {
    return null;
  }
}

function writeCache(
  project: string,
  ok: boolean,
  failed: unknown[],
  soft: unknown[],
  errors: unknown[],
  summary: string,
  hash_: string,
): void {
  try {
    const cachePath = join(project, CACHE_REL);
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(
      cachePath,
      pyJson({ exit_ok: ok, failed: failed, soft: soft, errors: errors, summary: summary, hash: hash_ }),
    );
  } catch {
    // caching is advisory-only; never fail the gate over a cache-write error
  }
}

type CheckResult = { ok: boolean; failed: string[]; soft: string[]; errors: string[]; summary: string };

/** A check-all `failed[]` entry's declared severity. Anything not literally `hard` — including an
 *  entry from a check-all old enough not to emit the field, and a cached verdict written before
 *  this gate understood severity — is `soft`. */
function isHard(entry: unknown): boolean {
  return (
    entry !== null &&
    typeof entry === "object" &&
    !Array.isArray(entry) &&
    String((entry as Record<string, unknown>).severity ?? "soft").toLowerCase() === "hard"
  );
}

/** Last element of Python's `s.strip().splitlines() or [fallback]`.
 * Python splitlines() breaks on the full universal-newline set, and returns [] for "". */
function lastLineOr(s: string, fallback: string): string {
  const stripped = s.replace(/^\s+/, "").replace(/\s+$/, "");
  if (stripped === "") return fallback;
  const lines = stripped.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  return lines[lines.length - 1];
}

function nameOf(v: unknown): string {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const n = (v as Record<string, unknown>).name;
    return n === undefined ? "?" : String(n);
  }
  return String(v);
}

function runCheckAll(project: string): CheckResult {
  let stdout: string;
  let returncode: number;
  try {
    const proc = Bun.spawnSync(["uv", "run", "--with", "lxml", "python3", CHECK_ALL, project], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 180000,
    });
    stdout = new TextDecoder().decode(proc.stdout);
    returncode = proc.exitCode ?? 1;
    // Python's subprocess.run(timeout=180) RAISES TimeoutExpired, which its `except Exception`
    // catches and turns into ok=True — the gate fails OPEN on a slow check-all, deliberately
    // ("never hard-block the workflow on a harness error"). Bun.spawnSync does NOT throw on
    // timeout; it returns a killed process, whose non-zero exit fell through to the returncode
    // branch below and emitted a DENY. That inverted fail-open into fail-closed: a check-all
    // exceeding 180s would block writing-review instead of waving it through.
    if (proc.signalCode || (proc.exitCode === null && !stdout)) {
      return { ok: true, failed: [], soft: [], errors: [], summary: "(check-all could not run: timeout)" };
    }
  } catch (e) {
    // Never hard-block the workflow on a harness error running the gate.
    return { ok: true, failed: [], soft: [], errors: [], summary: `(check-all could not run: ${e})` };
  }
  let failed: string[] = [];
  let soft: string[] = [];
  let errors: string[] = [];
  try {
    const raw = stdout;
    const cut = raw.lastIndexOf("}") + 1;
    const data = JSON.parse(raw.slice(0, cut));
    if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error("not a dict");
    const f = (data as Record<string, unknown>).failed;
    const e = (data as Record<string, unknown>).errors;
    const all = (Array.isArray(f) ? f : f === undefined ? [] : (() => { throw new Error("not iterable"); })());
    failed = all.filter(isHard).map(nameOf);
    soft = all.filter((x) => !isHard(x)).map(nameOf);
    errors = (Array.isArray(e) ? e : e === undefined ? [] : (() => { throw new Error("not iterable"); })()).map(nameOf);
  } catch {
    // Parse failed → severity is unknowable, so fall back to the process exit code and treat the
    // run as hard-failing. Never invent failures, and never invent a soft classification either.
    failed = [];
    soft = [];
    errors = [];
    if (returncode !== 0) failed = [lastLineOr(stdout, "check-all reported failures")];
  }
  const summary = lastLineOr(stdout, "(no output)");
  return { ok: failed.length === 0, failed, soft, errors, summary };
}

export function runCheckAllCached(project: string): CheckResult & { fromCache: boolean } {
  const curHash = freshnessHash(project);
  if (curHash !== null) {
    const cached = readCache(project);
    if (cached && pyTruthy(cached) && cached.hash === curHash) {
      const ok = cached.exit_ok === undefined ? true : (cached.exit_ok as boolean);
      const failed = (cached.failed === undefined ? [] : cached.failed) as unknown[];
      const soft = (cached.soft === undefined ? [] : cached.soft) as unknown[];
      const errors = (cached.errors === undefined ? [] : cached.errors) as unknown[];
      const summary = (cached.summary === undefined ? "(cached)" : cached.summary) as string;
      return {
        ok: pyTruthy(ok),
        failed: failed as string[],
        soft: soft as string[],
        errors: errors as string[],
        summary: summary,
        fromCache: true,
      };
    }
  }
  const r = runCheckAll(project);
  if (curHash !== null) writeCache(project, r.ok, r.failed, r.soft, r.errors, r.summary, curHash);
  return { ...r, fromCache: false };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // CLI debug mode
  if (argv.length > 0 && argv[0] !== "-") {
    const r = runCheckAllCached(argv[0]);
    console.log(`ok=${r.ok ? "True" : "False"} | ${r.summary}` + (r.fromCache ? " [cached]" : ""));
    if (r.failed.length) console.log("FAILED hard (blocking):\n- " + r.failed.join("\n- "));
    if (r.soft.length) console.log("failed soft (advisory — NOT blocking):\n- " + r.soft.join("\n- "));
    if (r.errors.length) console.log("errors (non-blocking — tooling):\n- " + r.errors.join("\n- "));
    process.exit(r.ok ? 0 : 1);
  }

  // A PreToolUse GATE DENIES ON A PAYLOAD IT CANNOT READ. The `catch { exit 0 }` here was
  // Python parity, and it is precisely what `denyOnCrash` cannot reach: the handler covers
  // throws that ESCAPE, and a local catch means none does. Measured — unparseable stdin, and
  // for the raw-`JSON.parse` gates also `null`/`"s"`/`[1,2]`, produced exit 0 with no output,
  // i.e. a silent ALLOW on every malformed payload. `parsePayload` denies on a non-object and
  // lets a parse error propagate to the handler, which denies too.
  const hookInput: Record<string, unknown> = parsePayload(await Bun.stdin.text());
  if (String((hookInput as Record<string, unknown>).tool_name ?? "") !== "Workflow") process.exit(0);
  const rawToolInput = (hookInput as Record<string, unknown>).tool_input;
  const toolInput: Record<string, unknown> =
    rawToolInput && typeof rawToolInput === "object" && pyTruthy(rawToolInput)
      ? (rawToolInput as Record<string, unknown>)
      : {};

  // SCOPE: only the writing-draft / writing-review engines, nothing else.
  const target = `${toolInput.scriptPath ?? ""} ${toolInput.name ?? ""}`;
  const isReview = target.includes("writing-review");
  const isDraft = target.includes("writing-draft");
  if (!(isReview || isDraft)) process.exit(0);

  // Soft check (both engines): the deterministic section-index should be COMPILED and passed.
  let args: unknown = toolInput.args;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      args = {};
    }
  }
  const isDict = args !== null && typeof args === "object" && !Array.isArray(args);
  const si = isDict ? (args as Record<string, unknown>).sectionIndex : null;
  const sectionWarn = pyTruthy(si)
    ? ""
    : " NOTE: args.sectionIndex was not passed — the engine will fall back to the LLM Discover. " +
      "For the deterministic path, compile it first: " +
      "`uv run python3 scripts/writing/writing_section_index.py <project>` and pass it as args.sectionIndex.";

  // The check-all mechanical gate is the REVIEW floor only.
  if (isDraft) {
    if (sectionWarn) {
      console.log(
        pyJson({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
            permissionDecisionReason: sectionWarn.trim(),
          },
        }),
      );
    }
    process.exit(0);
  }

  const project = projectFromArgs(toolInput, hookInput);
  const r = runCheckAllCached(project);
  const softNote = r.soft.length
    ? "\n\n(Plus " + String(r.soft.length) + " SOFT constraint failure(s) — advisory, NOT blocking:\n- " +
      r.soft.join("\n- ") + ")"
    : "";
  if (!r.ok) {
    const note = r.errors.length
      ? "\n\n(Plus " + String(r.errors.length) + " constraint(s) errored — tooling, NOT blocking.)"
      : "";
    deny(
      "GATE BLOCKED: the deterministic mechanical floor (check-all.py — bold-lead, " +
        "topic-sentences, anchored-numbers, outline-sync, AI provenance artifacts, etc.) has HARD " +
        "failures, so the semantic review fan-out must not run yet. A hard constraint is one whose " +
        "module declares SEVERITY = \"hard\". Fix these first, then re-invoke:\n- " +
        (r.failed.length ? r.failed : [r.summary]).join("\n- ") +
        note +
        softNote +
        sectionWarn +
        "\n\n(Only writing constraints were checked; soft failures and advisory 'conventions' do " +
        "not block. Run `uv run --with lxml python3 references/constraints/check-all.py .` for details.)",
    );
  }
  if (sectionWarn || softNote) {
    console.log(
      pyJson({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "Mechanical floor clean of HARD failures." + softNote + sectionWarn,
        },
      }),
    );
  }
  process.exit(0);
}

// GUARDED SO THE MODULE CAN BE IMPORTED. Unguarded, `await main()` ran on import: it read stdin and
// called process.exit, so any test importing runCheckAllCached died before its first assertion and
// printed nothing — a silent pass. The cache behaviour below is only testable because this is gated.
if (import.meta.main) await main();
