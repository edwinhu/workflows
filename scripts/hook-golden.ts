#!/usr/bin/env bun
/**
 * Golden harness: every hook still behaves as recorded.
 *
 * WHY THIS EXISTS
 *   Hooks are enforcement, and a broken one does not fail loudly — per this repo's own enforcement
 *   checklist a bad hook "still runs, still exits 0, prints nothing anyone sees, and its `deny`
 *   silently becomes an allow". So "the .ts file exists and exits 0" proves nothing. The evidence
 *   is: same stdin + same env + same cwd => same stdout, same exit code, same filesystem effect.
 *
 * WHAT IT REPLACED
 *   This diffed each hook against the Python original at a pinned commit, answering "is the port
 *   faithful" — a question that closed when the port landed. What it kept measuring was whether a
 *   hook had changed since 2026-08-18, so every deliberate improvement read as a failure:
 *   image-read-guard's move to look_at.sh and its two security fixes (a `..` is not permission;
 *   deny on crash) all showed up red. A gate that goes red on a security fix teaches you to ignore
 *   it, so the baseline is now the hook's own recorded behaviour.
 *
 * WHY THE SANDBOX
 *   Many hooks write files and spawn subprocesses. Each case runs in its own disposable temp copy
 *   of its fixture, so a run never observes state another run created.
 *
 * WHAT IS NORMALISED
 *   Sandbox, repo and tmp paths, and the wall clock to the minute. Both appear verbatim in hook
 *   output (the look-at deny reason names a script path; session-end stamps LEARNINGS.md), and
 *   hashing them raw makes the suite go red on the clock rather than on a hook.
 *
 * USAGE
 *   bun scripts/hook-golden.ts <hook-name>        # one hook, all its golden cases
 *   bun scripts/hook-golden.ts --all              # every golden file in tests/golden/
 *   bun scripts/hook-golden.ts --all --record     # re-record after an INTENDED change;
 *                                                 # read the golden diff, that diff is the review
 *
 * GOLDEN FILE  tests/golden/<hook>.json
 *   {
 *     "hook": "phase-gate-guard",
 *     "cases": [
 *       {
 *         "name": "deny-missing-artifact",
 *         "kind": "deny",                       // "allow" | "deny" — at least one of each required
 *         "stdin": { ... hook payload ... },
 *         "env":   { "GATE_ARTIFACT": ".planning/SPEC_REVIEWED.md", ... },
 *         "fixture": { ".planning/SPEC.md": "..." }   // files materialized before the run
 *       }
 *     ]
 *   }
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

const REPO = resolve(import.meta.dir, "..");
const GOLDEN_DIR = join(REPO, "tests", "golden");

function legacyContractStdout(stdout: string, base: string): string {
  const localReferenceRoot = join(EXTRACTION_ROOT, "reference");
  const historicalReferenceRoot = join(tmpdir(), `parity-py-${base}`);
  return stdout.replaceAll(localReferenceRoot, historicalReferenceRoot);
}

/**
 * The Python base predates the approved native-PLAN/TaskList DS migration. These are the only
 * behavior changes deliberately superseding it; every unlisted case remains byte-for-byte parity.
 * Each expectation hashes complete stdout and enumerates the complete filesystem delta.
 */
const LEGACY_TS_EXPECTATIONS: Record<string, TsExpectation> = {
  "pre-compact/ds-workflow-detected-dev-patterns-absent": { stdoutSha256: "728581b9595c05b4ec3c332bf3d15d1cca17494fa7f505cf8af352f158f6dbbd", exit: 0, fs: {} },
  "pre-compact/native-ds-plan-without-keywords-never-writes-state": { stdoutSha256: "156864016656d19c95cd65f4f7262a5e439192bcf2148137f54d89e8d9641e11", exit: 0, fs: {} },
  "pre-compact/learnings-only-no-plan-marker-has-no-workflow-note": { stdoutSha256: "e1f92e984bc0c0fe51bbabfa8e654606e871dc2d1b9125169775fd881bb1eafd", exit: 0, fs: {} },
  "session-start/planning-plan-progress-with-next-task": { stdoutSha256: "6e18c9ca8e23e6c0ae91d148d53914a4a71159e3574e0b807ae386c5056c0dac", exit: 0, fs: {} },
  "session-start/legacy-claude-dir-plan-without-checkboxes": { stdoutSha256: "2b63930c16cdf6b06a60e748c4808e35a929fd9af4a232afd70a7afd370d401f", exit: 0, fs: {} },
  "session-start/planning-dir-present-but-no-recognized-state-files": { stdoutSha256: "6e18c9ca8e23e6c0ae91d148d53914a4a71159e3574e0b807ae386c5056c0dac", exit: 0, fs: {} },
  "subagent-start/active-workflow-only": { stdoutSha256: "92f7c2777260574d918b907072e08b60e42504422a22607249c880b126a2f0eb", exit: 0, fs: {} },
  "subagent-start/skills-with-reference-files-only": { stdoutSha256: "7a46d64deafa9c2ebd499d75d5d5ab65512668030b275bc881818a622ebc29bd", exit: 0, fs: {} },
  "subagent-start/workflow-and-skills-merged-across-state-spec-plan": { stdoutSha256: "a8bc42829d751f61205e60ba8910458d59842a217878ba323e70ef70e85cb7f5", exit: 0, fs: {} },
  "subagent-start/empty-stdin-still-injects": { stdoutSha256: "75600f29044bd8da8fdfd5a8ad9d603e5d347572f235fc73bab191f102d19546", exit: 0, fs: {} },

  // UNREADABLE STDIN IN A PreToolUse GATE: the Python contract is the DEFECT, so parity to it is not
  // a property worth keeping. Each Python original wrapped `json.load(sys.stdin)` in
  // `except: sys.exit(0)`, and in a PreToolUse hook exit 0 with no output IS THE ALLOW — so every
  // one of these gates permitted the call it exists to refuse whenever it could not read its own
  // payload. The TS ports inherited the `catch { process.exit(0) }` faithfully, which also made
  // `denyOnCrash` inert in them: the handler covers throws that ESCAPE, and a local catch means none
  // does. The gates now let the parse error propagate and deny.
  //
  // This is the same call `_gate_common.requireObject` already made for a non-object payload, and it
  // is split the same way: PreToolUse denies, PostToolUse keeps exit-code parity, because only in
  // the first is a non-zero exit (or a silent zero) a permit. `tests/pretooluse-crash-closure.test.mjs`
  // asserts the DECISION for all 18 gates, which is what these six cases stop contradicting.
  "find-slide-page-inject/unparseable-stdin-noop": { stdoutSha256: "7975103a99c4d7cbefc253eeaa7786b0e6e2311dbdf900fa5d6d5fcbb22dc203", exit: 0, fs: {} },
  "image-read-guard/allow-unparseable-stdin": { stdoutSha256: "8ccddd10a1efffad4348431e65835fc0c78eec9ac32668aecbf1cbdc4e6e87f5", exit: 0, fs: {} },
  "mechanical-floor-gate/allow-on-unreadable-stdin": { stdoutSha256: "fc6a4130ac2a4f0a83af0242461ac2a424894c23af7018954e933d469bc3025c", exit: 0, fs: {} },
  "suggest-compact/unparseable-stdin-exits-clean": { stdoutSha256: "51d37ef05f9472dfa22e8200acf0c141422e045576f7ad450232dd61ff5ab2bb", exit: 0, fs: {} },
  "writing-outline-guard/allow-unparseable-stdin": { stdoutSha256: "9e59479c734d2229046b52336aad3f1bd321fe7d3bc1d425e04ad087382c9a10", exit: 0, fs: {} },
};

type TsExpectation = {
  /** SHA-256 of the complete TS stdout, not a substring or permissive matcher. */
  stdoutSha256: string;
  exit: number;
  /** Complete filesystem delta, keyed by path with the snapshot's content hash. */
  fs: Record<string, string>;
};

type Case = {
  name: string;
  kind: "allow" | "deny" | "context" | "effect";
  stdin?: unknown;
  env?: Record<string, string>;
  fixture?: Record<string, string>;
  argv?: string[];
  /**
   * Native-PLAN migration exception to Python parity. This remains an exact TS contract:
   * stdout SHA-256, exit code, and every filesystem change must all match.
   */
  tsExpected?: TsExpectation;
};
type Golden = { hook: string; cases: Case[] };
type RunResult = { stdout: string; stderr: string; exit: number; fs: Record<string, string> };

/**
 * Paths that change every run are not behaviour.
 *
 * The sandbox is a fresh mkdtemp per case and several hooks echo an absolute path back — the
 * look-at deny reason names the script it wants you to run. Hashing that raw makes the digest
 * differ on every invocation, so the sandbox, the repo and the tmp root are replaced by stable
 * tokens first. Longest first: the sandbox usually lives under the tmp root.
 */
function normalise(text: string, dir: string): string {
  const pathed = [[dir, "<SANDBOX>"], [REPO, "<REPO>"], [tmpdir(), "<TMP>"]]
    .sort((a, b) => b[0].length - a[0].length)
    .reduce((acc, [from, to]) => acc.split(from).join(to), text);
  // session-end stamps the wall clock to the minute; that is the clock, not behaviour.
  return pathed.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g, "<TIMESTAMP>");
}

/** sha256 of every file under `dir`, keyed by repo-relative path. The filesystem half of parity. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Caches written by tools the hook SPAWNS are not the hook's own side effect, and several are
  // keyed by absolute path — ruff names its cache entry after the path of the file it linted, so the
  // two sandboxes (different temp dirs by design) produce different filenames for identical work.
  // Comparing them reports a behavior difference where there is none. Ignore the tool caches; the
  // hook's real writes are still compared.
  // Files whose CONTENT is environment-derived by design. Presence is still compared.
  const ADVISORY_CACHES = new Set([".planning/.checkall-cache.json"]);
  const TOOL_CACHES = new Set([".git", ".ruff_cache", "__pycache__", ".mypy_cache", ".pytest_cache", "node_modules"]);
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (TOOL_CACHES.has(entry.name)) continue;
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) {
        const rel = p.slice(dir.length + 1);
        // Advisory caches: compare PRESENCE, not content. Their payload is a hash of environment
        // paths and mtimes, so it cannot be equal across two runs even at the same path — but the
        // hook is fail-open on them ("any cache read/write/hash error just falls through to a normal
        // run"), so gate behavior is fully determined by stdout + exit, which ARE compared. Ignoring
        // the content here does not weaken the check; comparing it reports the clock as a bug.
        // Content is normalised before hashing for the same reason stdout is: session-end stamps
        // `YYYY-MM-DD HH:MM` into LEARNINGS.md, so an un-normalised digest changes every minute
        // and the suite goes red on the clock rather than on a hook.
        out[rel] = ADVISORY_CACHES.has(rel)
          ? "<present>"
          : createHash("sha256").update(normalise(readFileSync(p, "utf8"), dir)).digest("hex").slice(0, 16);
      }
    }
  };
  if (statSync(dir).isDirectory()) walk(dir);
  return out;
}

/**
 * Fixed mtime for every fixture file, so the two runs see identical (path, mtime) pairs.
 *
 * Same sandbox path was not sufficient: `reset()` rewrites the fixture between runs, which gives
 * every file a fresh mtime. writing-mechanical-gate's freshness hash is
 * sha256(repr(sorted([(path, st_mtime), …]))), so the second run computed a different hash and wrote
 * a different `.planning/.checkall-cache.json` — reported as a behavior difference when the only
 * thing that differed was the clock.
 */
const FIXTURE_MTIME = new Date("2026-01-01T00:00:00Z");

function populate(dir: string, fixture: Record<string, string> | undefined): void {
  for (const [rel, content] of Object.entries(fixture ?? {})) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    utimesSync(abs, FIXTURE_MTIME, FIXTURE_MTIME);
  }
}

function materialize(fixture: Record<string, string> | undefined): string {
  const dir = mkdtempSync(join(tmpdir(), "parity-"));
  populate(dir, fixture);
  return dir;
}

/**
 * Reset a sandbox to its fixture state, IN PLACE, so both implementations run at the same path.
 *
 * Running them in two different temp dirs makes every path-derived value differ for reasons that
 * have nothing to do with behavior: ruff names its cache entry after the absolute path it linted,
 * and writing-mechanical-gate's freshness hash is sha256 over (absolute path, mtime) pairs. Both
 * reported a "behavior difference" that was purely an artifact of the harness. Same path, run
 * sequentially, removes the whole class at the root rather than denylisting artifacts one at a time.
 */
function reset(dir: string, fixture: Record<string, string> | undefined): void {
  for (const entry of readdirSync(dir)) rmSync(join(dir, entry), { recursive: true, force: true });
  populate(dir, fixture);
}

async function run(cmd: string[], c: Case, cwd: string): Promise<RunResult> {
  const before = snapshot(cwd);
  const proc = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...(c.env ?? {}), CLAUDE_PROJECT_DIR: cwd },
    stdin: c.stdin === undefined ? "ignore" : new TextEncoder().encode(JSON.stringify(c.stdin)),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const after = snapshot(cwd);

  // Only report paths that actually changed — an unchanged fixture is not a side effect.
  const fs: Record<string, string> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[k] !== after[k]) fs[k] = after[k] ?? "<deleted>";
  }
  return { stdout, stderr, exit, fs };
}

/**
 * Compare a hook against its RECORDED OWN behaviour.
 *
 * This used to diff the TypeScript hook against the Python original extracted from a pinned
 * commit, which answered "is the port faithful" — a question that stopped being open once the
 * port landed. What it kept measuring was whether a hook had changed since 2026-08-18, so every
 * deliberate improvement read as a failure: image-read-guard's move to look_at.sh and its two
 * security fixes (a `..` is not permission; deny on crash) all showed up red. A gate that goes
 * red on a security fix teaches you to ignore it.
 *
 * `--record` rewrites the expectations from current behaviour. Run it when a change to a hook is
 * intended, and read the golden diff — that diff IS the review.
 */
async function checkHook(hook: string, record: boolean): Promise<{ ok: boolean; lines: string[]; golden?: Golden }> {
  const lines: string[] = [];
  const golden: Golden = JSON.parse(readFileSync(join(GOLDEN_DIR, `${hook}.json`), "utf8"));
  const ts = join(REPO, "hooks", `${hook}.ts`);
  let ok = true;
  for (const c of golden.cases) {
    const dir = materialize(c.fixture);
    try {
      const actual = await run(["bun", ts, ...(c.argv ?? [])], c, dir);
      const got = {
        stdoutSha256: createHash("sha256").update(normalise(actual.stdout, dir)).digest("hex"),
        exit: actual.exit,
        fs: JSON.parse(normalise(JSON.stringify(actual.fs), dir)),
      };
      if (record) {
        c.tsExpected = got;
        lines.push(`  · ${hook} [${c.kind}] ${c.name} recorded`);
        continue;
      }
      if (!c.tsExpected) {
        ok = false;
        lines.push(`  ✗ ${hook} [${c.kind}] ${c.name}: no recorded expectation — run with --record`);
        continue;
      }
      const diffs: string[] = [];
      if (got.stdoutSha256 !== c.tsExpected.stdoutSha256) {
        diffs.push(`stdout-sha256: expected=${c.tsExpected.stdoutSha256} got=${got.stdoutSha256}`);
        diffs.push(`stdout: ${JSON.stringify(normalise(actual.stdout, dir)).slice(0, 400)}`);
      }
      if (got.exit !== c.tsExpected.exit) diffs.push(`exit: expected=${c.tsExpected.exit} got=${got.exit}`);
      const a = JSON.stringify(got.fs), e = JSON.stringify(c.tsExpected.fs);
      if (a !== e) diffs.push(`fs-delta\n      expected: ${e}\n      got: ${a}`);
      if (diffs.length) {
        ok = false;
        lines.push(`  ✗ ${hook} [${c.kind}] ${c.name}`);
        for (const d of diffs) lines.push(`      ${d}`);
      } else {
        lines.push(`  ✓ ${hook} [${c.kind}] ${c.name}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return { ok, lines, golden };
}

const args = process.argv.slice(2);
const record = args.includes("--record");
const quiet = args.includes("--quiet");
const targets = args.includes("--all")
  ? readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort()
  : args.filter((a) => !a.startsWith("--"));

if (!targets.length) {
  console.error("usage: bun scripts/hook-golden.ts <hook-name> | --all [--record] [--quiet]");
  process.exit(2);
}

let failed = 0;
for (const hook of targets) {
  const { ok, lines, golden } = await checkHook(hook, record);
  if (record && golden) {
    writeFileSync(join(GOLDEN_DIR, `${hook}.json`), JSON.stringify(golden, null, 2) + "\n");
  }
  if (!ok) failed++;
  if (!quiet || !ok) for (const l of lines) console.log(l);
}
const verb = record ? "recorded" : "at parity with their goldens";
console.log(`${targets.length - failed}/${targets.length} hooks ${verb}${failed ? `  (${failed} FAILED)` : ""}`);
process.exit(failed ? 1 : 0);
