#!/usr/bin/env bun
/**
 * Parity harness for the Python -> TypeScript hook port.
 *
 * WHY THIS EXISTS
 *   Hooks are enforcement. A port with subtly wrong behavior does not fail loudly — per this repo's
 *   own enforcement checklist, a bad hook "still runs, still exits 0, prints nothing anyone sees,
 *   and its `deny` silently becomes an allow". So "the .ts file exists and exits 0" proves nothing.
 *   The only useful evidence is: same stdin + same env + same cwd => same stdout, same exit code,
 *   same filesystem effect, as the Python original.
 *
 * WHY THE SANDBOX
 *   18 of 40 hooks have side effects (write files, spawn subprocesses). Running the Python version
 *   and then the TS version against the live repo would double-write, re-exec, and let the second
 *   run observe state the first one created — a naive diff is both destructive and wrong. Each
 *   implementation therefore runs in its own disposable temp copy of a per-case fixture.
 *
 * WHERE THE PYTHON COMES FROM
 *   The port replaces hooks/x.py with hooks/x.ts, so the original is read from git rather than the
 *   worktree: `git show <BASE>:hooks/x.py`. BASE defaults to HEAD and is overridable, so parity is
 *   still checkable after the .py is deleted.
 *
 * USAGE
 *   bun scripts/parity.ts <hook-name>      # one hook, all its golden cases
 *   bun scripts/parity.ts --all            # every golden file in tests/golden/
 *   bun scripts/parity.ts --all --base 3a4184f
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

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync, existsSync, symlinkSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

const REPO = resolve(import.meta.dir, "..");
const GOLDEN_DIR = join(REPO, "tests", "golden");

type Case = {
  name: string;
  kind: "allow" | "deny" | "context" | "effect";
  stdin?: unknown;
  env?: Record<string, string>;
  fixture?: Record<string, string>;
  argv?: string[];
};
type Golden = { hook: string; cases: Case[] };
type RunResult = { stdout: string; stderr: string; exit: number; fs: Record<string, string> };

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
        out[rel] = ADVISORY_CACHES.has(rel)
          ? "<present>"
          : createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);
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
 * Extract the Python originals from git so parity still works after the .py files are deleted.
 *
 * Extracts the WHOLE hooks/ tree at `base`, not one file: several hooks do
 * `sys.path.insert(0, Path(__file__).parent)` and import a sibling (`_gate_common`,
 * `footnote_mask`, `wc_file_set`, …). Extracting a lone file put it in a directory with no
 * siblings, so every case exited 1 with empty stdout — the harness's own first bug.
 *
 * The extracted tree is rooted at `<tmp>/hooks/`, and every other top-level entry of the repo
 * (scripts/, references/, skills/, …) is SYMLINKED next to it as `<tmp>/<name>`. Several hooks
 * compute `PLUGIN_ROOT = Path(__file__).parent.parent` and then read real plugin assets underneath
 * it — `scripts/lib/footnote_mask.py`, `references/constraints/check-all.py`,
 * `skills/ai-anti-patterns/scripts/style_metrics.py`. Extracting the hooks into a bare temp dir made
 * PLUGIN_ROOT resolve to the temp dir's PARENT (i.e. /tmp), so those hooks died at import with
 * ModuleNotFoundError on EVERY case — exit 1, empty stdout — and no port could ever match. Mirroring
 * the plugin layout one level up makes PLUGIN_ROOT point at a tree that looks like the repo.
 *
 * The WORKTREE .ts hooks are COPIED INTO THE SAME DIRECTORY, and the TS side is run from there.
 * Some hooks embed their own location in their output — image-read-guard prints
 * `Path(__file__).resolve().parent.parent` inside its deny message. Running the Python from a temp
 * dir and the TypeScript from the real repo makes those two strings differ for a reason that has
 * nothing to do with the port, and no correct port could ever match. Co-locating the two
 * implementations makes `__file__` / `import.meta.dir` agree, so a location-derived string is
 * compared on equal footing rather than normalized away.
 */
let pyDirCache: string | null = null;
function pythonHooksDir(base: string): string | null {
  if (pyDirCache) return pyDirCache;
  const ls = Bun.spawnSync(["git", "ls-tree", "--name-only", `${base}:hooks`], { cwd: REPO });
  if (ls.exitCode !== 0) return null;
  const root = mkdtempSync(join(tmpdir(), "parity-py-"));
  // Mirror the plugin layout so PLUGIN_ROOT (= <hooks>/..) resolves to a repo-shaped tree.
  for (const entry of readdirSync(REPO, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "hooks") continue;
    symlinkSync(join(REPO, entry.name), join(root, entry.name));
  }
  const dir = join(root, "hooks");
  mkdirSync(dir, { recursive: true });
  for (const name of new TextDecoder().decode(ls.stdout).split("\n").filter((n) => n.endsWith(".py"))) {
    const r = Bun.spawnSync(["git", "show", `${base}:hooks/${name}`], { cwd: REPO });
    if (r.exitCode === 0) writeFileSync(join(dir, name), r.stdout);
  }
  for (const name of readdirSync(join(REPO, "hooks")).filter((n) => n.endsWith(".ts"))) {
    writeFileSync(join(dir, name), readFileSync(join(REPO, "hooks", name)));
  }
  pyDirCache = dir;
  return dir;
}

function pythonOriginal(hook: string, base: string): string | null {
  const dir = pythonHooksDir(base);
  if (!dir) return null;
  const p = join(dir, `${hook}.py`);
  return existsSync(p) ? p : null;
}

async function checkHook(hook: string, base: string): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = [];
  const goldenPath = join(GOLDEN_DIR, `${hook}.json`);
  if (!(await Bun.file(goldenPath).exists())) {
    return { ok: false, lines: [`  ✗ ${hook}: no golden file at tests/golden/${hook}.json`] };
  }
  const golden: Golden = JSON.parse(await Bun.file(goldenPath).text());

  const py = pythonOriginal(hook, base);
  if (!py) return { ok: false, lines: [`  ✗ ${hook}: no ${base}:hooks/${hook}.py to compare against`] };

  // Coverage rule, DERIVED FROM THE SOURCE rather than imposed uniformly. Only 12 of 39 hooks have
  // a deny path at all — the other 27 inject context, write files, or run at session boundaries.
  // Demanding a deny case from all of them would fail 27 hooks for lacking a branch they do not
  // have. But where a deny path DOES exist it is mandatory, because the block branch is the one
  // only a real payload reaches and the one where a broken port hides silently.
  const kinds = new Set(golden.cases.map((c) => c.kind));
  const source = readFileSync(py, "utf8");
  const hasDenyPath = /\bdeny\s*\(|"deny"/.test(source);
  if (hasDenyPath && !kinds.has("deny")) {
    return {
      ok: false,
      lines: [`  ✗ ${hook}: source has a deny path but no deny case — the branch most likely to break is untested`],
    };
  }
  if (golden.cases.length < 2) {
    return { ok: false, lines: [`  ✗ ${hook}: needs ≥2 cases covering distinct outcomes (has ${golden.cases.length})`] };
  }
  if (!(await Bun.file(join(REPO, "hooks", `${hook}.ts`)).exists())) {
    return { ok: false, lines: [`  ✗ ${hook}: hooks/${hook}.ts does not exist yet`] };
  }
  // Run the COPY that sits next to the extracted Python, not the worktree file — see pythonHooksDir.
  const ts = join(dirname(py), `${hook}.ts`);

  let ok = true;
  for (const c of golden.cases) {
    // ONE sandbox, reused: both implementations must run at the SAME absolute path, or every
    // path-derived value (tool caches, freshness hashes) differs for reasons unrelated to behavior.
    const dir = materialize(c.fixture);
    try {
      const a = await run(["uv", "run", "python3", py, ...(c.argv ?? [])], c, dir);
      reset(dir, c.fixture);
      const b = await run(["bun", ts, ...(c.argv ?? [])], c, dir);

      const diffs: string[] = [];
      if (a.stdout !== b.stdout) diffs.push(`stdout\n      py: ${JSON.stringify(a.stdout)}\n      ts: ${JSON.stringify(b.stdout)}`);
      if (a.exit !== b.exit) diffs.push(`exit: py=${a.exit} ts=${b.exit}`);
      const fsA = JSON.stringify(a.fs), fsB = JSON.stringify(b.fs);
      if (fsA !== fsB) diffs.push(`fs-delta\n      py: ${fsA}\n      ts: ${fsB}`);

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
  return { ok, lines };
}

const args = process.argv.slice(2);
const baseIdx = args.indexOf("--base");
const base = baseIdx >= 0 ? args[baseIdx + 1] : "HEAD";
const targets = args.includes("--all")
  ? readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort()
  : args.filter((a) => !a.startsWith("--") && a !== base);

if (!targets.length) {
  console.error("usage: bun scripts/parity.ts <hook-name> | --all [--base <ref>]");
  process.exit(2);
}

let failed = 0;
for (const hook of targets) {
  const { ok, lines } = await checkHook(hook, base);
  for (const l of lines) console.log(l);
  if (!ok) failed++;
}
console.log(`\n${targets.length - failed}/${targets.length} hooks at parity` + (failed ? `  (${failed} FAILED)` : ""));
process.exit(failed ? 1 : 0);
