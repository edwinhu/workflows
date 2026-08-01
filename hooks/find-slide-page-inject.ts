#!/usr/bin/env bun
/**
 * PreToolUse hook (visual-verify scoped): Auto-inject find-slide-page output
 * before any tinymist compile targeting a Touying .typ slide file.
 *
 * When an agent is about to compile a .typ file for visual verification, this
 * hook runs find-slide-page in pres mode and prints the full heading→page map
 * as a system message. The agent sees exact page numbers before the compile
 * result lands, breaking the guess-compile-wrong-page-retry loop.
 *
 * Fires on: Bash tool calls containing "tinymist compile" + a slides/*.typ target.
 * No-ops silently on: anything else.
 *
 * Port note: this is a behavior-preserving port of find-slide-page-inject.py. The three-line
 * success block, the glob-sort-last scripts_dir lookup, the copy-then-unlink-in-finally, and the
 * "any subprocess failure means no output" swallow are all reproduced verbatim, including the fact
 * that a non-object payload raises (exit 1) because `.get` is called outside the try.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { denyOnCrash } from "./_gate_common.ts";

// FIRST STATEMENT WITH AN EFFECT: a throw below becomes a schema-valid deny instead of an
// exit-1, which Claude Code treats as NON-BLOCKING — i.e. a silent allow in a PreToolUse gate.
denyOnCrash("FIND SLIDE PAGE INJECT");

// Any *.typ compile target, not just one under a literal `slides/` directory — workshop decks
// commonly compile `presentation/slides.typ` or a flat `slides.typ`, neither of which matched the
// old `slides/\S+\.typ` requirement. The findScriptsDir() teaching-plugin lookup below stays the
// graceful no-op for machines without it — that part is by design, not part of this fix.
const TRIGGER_RE = /tinymist\s+compile\b.*?\b(\S+\.typ)\b/;

/** Find the most recent teaching marketplace plugin scripts dir. */
function findScriptsDir(): string | null {
  // Equivalent of glob("~/.claude/plugins/cache/teaching/teaching/*/scripts"): `*` never
  // matches a leading dot, each candidate must exist, and the list is sorted before taking the last.
  const home = process.env.HOME ?? homedir();
  const base = join(home, ".claude", "plugins", "cache", "teaching", "teaching");
  let entries: string[];
  try {
    entries = readdirSync(base);
  } catch {
    return null;
  }
  const matches = entries
    .filter((name) => !name.startsWith("."))
    .map((name) => join(base, name, "scripts"))
    .filter((p) => existsSync(p))
    .sort();
  return matches.length ? matches[matches.length - 1] : null;
}

/** Run find-slide-page in pres mode for the given target, return output. */
function runFindSlidePage(scriptsDir: string, target: string, cwd: string): string | null {
  const fspTyp = join(scriptsDir, "find-slide-page.typ");
  const valTyp = join(scriptsDir, "validation.typ");
  const extractPy = join(scriptsDir, "extract-headings.py");

  if (![fspTyp, valTyp, extractPy].every((p) => existsSync(p))) {
    return null;
  }

  // Copy query files to output/ (mirrors the skill's own workflow)
  const outDir = join(cwd, "output");
  mkdirSync(outDir, { recursive: true });
  copyFileSync(fspTyp, join(outDir, "find-slide-page.typ"));
  copyFileSync(valTyp, join(outDir, "validation.typ"));

  try {
    const queryResult = spawnSync(
      "typst",
      [
        "query",
        "--root",
        ".",
        "output/find-slide-page.typ",
        "<val>",
        "--field",
        "value",
        `--input=target=${target}`,
        "--input=mode=pres",
      ],
      { cwd, encoding: "utf8", timeout: 60_000 },
    );
    // spawnSync reports a spawn failure / timeout via `error` instead of throwing; Python raises and
    // the except swallows it — same outcome, same finally.
    if (queryResult.error) return null;
    const queryStdout = queryResult.stdout ?? "";
    if (queryResult.status !== 0 || !queryStdout.trim()) {
      return null;
    }

    const extractResult = spawnSync("uv", ["run", "python3", extractPy], {
      input: queryStdout,
      encoding: "utf8",
      timeout: 10_000,
    });
    if (extractResult.error) return null;
    return (extractResult.stdout ?? "").trim() || null;
  } catch {
    return null;
  } finally {
    for (const f of ["find-slide-page.typ", "validation.typ"]) {
      try {
        unlinkSync(join(outDir, f));
      } catch {
        // OSError -> pass
      }
    }
  }
}

let hookInput: unknown;
try {
  hookInput = JSON.parse(await Bun.stdin.text());
} catch {
  process.exit(0);
}

// Python calls hook_input.get() OUTSIDE the try: a payload that parses but is not a dict raises
// AttributeError and exits 1. Reproduce that rather than silently no-oping.
if (typeof hookInput !== "object" || hookInput === null || Array.isArray(hookInput)) {
  throw new TypeError("hook input is not an object");
}
const payload = hookInput as Record<string, unknown>;

if (payload.tool_name !== "Bash") {
  process.exit(0);
}

const toolInput = (payload.tool_input ?? {}) as Record<string, unknown>;
const command = (toolInput.command ?? "") as string;
const m = TRIGGER_RE.exec(typeof command === "string" ? command : String(command));
if (!m) {
  process.exit(0);
}

const target = m[1];
const cwd = process.cwd();

// Only act on files that actually exist (skip generated/temp targets)
if (!existsSync(join(cwd, target))) {
  process.exit(0);
}

const scriptsDir = findScriptsDir();
if (!scriptsDir) {
  process.exit(0);
}

const pageMap = runFindSlidePage(scriptsDir, target, cwd);
if (!pageMap) {
  process.exit(0);
}

console.log(`=== find-slide-page (pres mode): ${target} ===`);
console.log(pageMap);
console.log(`=== Use these page numbers — do NOT guess or estimate ===`);
