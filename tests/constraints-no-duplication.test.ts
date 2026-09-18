import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// A constraint module has exactly ONE canonical home: a `constraints/` directory.
// Nothing may reproduce its body — a second copy is a source of truth that can drift, and the
// copy is what agents actually read. See workflow-creator: constraints are never a top-level skill.

const REPO = resolve(import.meta.dir, "..");
import { execFileSync } from "node:child_process"

function typstRoot(): string {
  try {
    const r = execFileSync("typst-plugin-root", [], { encoding: "utf8" }).trim()
    if (r) return r
  } catch { /* absent: fall through */ }
  return resolve(process.env.HOME!, ".claude/skills/typst")
}

// The bodies compared here are PROSE, so they live in rules/. constraints/ is code now and a
// duplication check over it would be comparing checkers, which is vendor-lint's job.
const CANONICAL_ROOTS = [
  join(REPO, "rules"),
  // ASKED, not spelled: typst-plugin-root is on PATH and is the one place that knows the
  // layout, which moved twice in September. The pre-split spelling stays beneath it so this
  // keeps working against an older install in a plain shell.
  resolve(typstRoot(), "rules"),
  resolve(typstRoot(), "constraints"),
];

function stripFrontmatter(t: string): string {
  return t.startsWith("---") ? t.replace(/^---[\s\S]*?\n---\n/, "") : t;
}
const norm = (t: string) => t.replace(/\s+/g, " ").trim();

function canonicalBodies(): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  for (const root of CANONICAL_ROOTS) {
    let names: string[];
    try { names = readdirSync(root); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith(".md") || n === "DROPPED.md") continue;
      const body = norm(stripFrontmatter(readFileSync(join(root, n), "utf8")));
      if (body.length >= 400) out.push({ name: n, body });
    }
  }
  return out;
}

function skillFiles(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) skillFiles(p, acc);
    else if (e.endsWith(".md")) acc.push(p);
  }
  return acc;
}

describe("constraint modules have exactly one canonical copy", () => {
  const bodies = canonicalBodies();

  test("canonical modules were found", () => {
    expect(bodies.length).toBeGreaterThan(10);
  });

  test("no file under skills/ reproduces a canonical constraint body", () => {
    const files = skillFiles(join(REPO, "skills")).filter(
      (f) => !CANONICAL_ROOTS.some((r) => f.startsWith(r)) && !f.includes("/constraints/"),
    );
    const offenders: string[] = [];
    for (const f of files) {
      const hay = norm(readFileSync(f, "utf8"));
      for (const { name, body } of bodies) {
        if (hay.includes(body)) offenders.push(`${f.slice(REPO.length + 1)} duplicates ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
