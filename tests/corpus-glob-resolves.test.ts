import { describe, expect, test } from "bun:test";
import { globSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";

// An agent or skill that tells a model to Glob a constraint/rule corpus is trusting that the
// glob still matches. When the corpus moves, the glob matches nothing, the model reads nothing,
// and the review reads as if it graded against the rules: workshop-reviewer globbed
// `~/.claude/skills/typst/constraints/*.md` for weeks after the rule texts moved to `rules/`.

const REPO = resolve(import.meta.dir, "..");

/** A path token anchored at a root the harness or shell expands, containing a `*`. */
const GLOB_RE = /(~|\$HOME|\$\{?CLAUDE_PLUGIN_ROOT\}?|\$\{?CLAUDE_SKILL_DIR\}?)(\/[^\s`"'()\]]*\*[^\s`"'()\]]*)/g;
/** Only corpus globs are held to "must match": a plans or logs glob may legitimately be empty. */
const CORPUS_SEGMENT = /\/(constraints|rules)\//;

export function corpusGlobs(text: string): { anchor: string; rest: string; line: number }[] {
  const out: { anchor: string; rest: string; line: number }[] = [];
  text.split("\n").forEach((l, i) => {
    for (const m of l.matchAll(GLOB_RE)) {
      if (CORPUS_SEGMENT.test(m[2])) out.push({ anchor: m[1], rest: m[2].replace(/[.,;:]+$/, ""), line: i + 1 });
    }
  });
  return out;
}

export function expand(anchor: string, rest: string, file: string): string {
  const a = anchor.replace(/[{}$]/g, "");
  const base = a === "~" || a === "HOME" ? homedir()
    : a === "CLAUDE_PLUGIN_ROOT" ? REPO
    : dirname(file); // CLAUDE_SKILL_DIR: the SKILL.md's own directory
  return base + rest;
}

function mdFiles(dir: string): string[] {
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  // Dirent types do not follow symlinks: a linked external tree or a dangling link is not ours.
  return ents.flatMap(e => {
    const p = join(dir, e.name);
    return e.isDirectory() ? mdFiles(p) : e.isFile() && e.name.endsWith(".md") ? [p] : [];
  });
}

const SOURCES = ["agents", "user-agents", "skills"].flatMap(d => mdFiles(join(REPO, d)));

describe("corpus globs in agents and skills", () => {
  const found = SOURCES.flatMap(f =>
    corpusGlobs(readFileSync(f, "utf8")).map(g => ({ ...g, file: f })));

  test("the scan is not vacuous", () => {
    expect(found.length).toBeGreaterThan(0);
  });

  test("every corpus glob matches at least one file", () => {
    const empty = found
      .filter(g => globSync(expand(g.anchor, g.rest, g.file)).length === 0)
      .map(g => `${relative(REPO, g.file)}:${g.line} ${g.anchor}${g.rest}`);
    expect(empty).toEqual([]);
  });

  test("the extractor catches a stale corpus glob and ignores a non-corpus one", () => {
    const text = "    Glob  ~/.claude/skills/typst/constraints/*.md   the rules\nsee ~/.claude/plans/*.md";
    const g = corpusGlobs(text);
    expect(g.map(x => x.rest)).toEqual(["/.claude/skills/typst/constraints/*.md"]);
    expect(globSync(expand(g[0].anchor, "/.claude/skills/typst/constraints/no-such-dir/*.md", "x"))).toEqual([]);
  });
});
