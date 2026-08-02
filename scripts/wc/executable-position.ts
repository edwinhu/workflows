#!/usr/bin/env bun
/**
 * Does the RUNTIME reach this file, or does only prose mention it?
 *
 * THE DEFECT THIS EXISTS FOR
 *   Five components in this ecosystem were correct, tested, documented, confidently cited — and
 *   invoked by nothing:
 *
 *     workflows/beat-implement.js          dead 4 months; every workflow's IMPLEMENT step
 *     hooks/work-implement-observation.ts  shipped in v5.106.0 registered nowhere; 35 passing tests
 *     hooks/typst-convention-guard.ts      wired to no event; its 17-case golden stayed green
 *     scripts/plan-review-constraints.ts   deterministic loader; `agents/plan-checker.md:25` does
 *                                          the same job in prose
 *     scripts/beat/implement-gate.ts       the remedy the compliance probe PRESCRIBES for fail-open
 *                                          hooks — one caller, and it is a line of markdown
 *
 *   Every mention-counting check scores all five healthy, because mentions are exactly what they
 *   have. `implement-gate.ts` has twelve: a CHANGELOG entry, a comment calling it "LOAD-BEARING", a
 *   remedy string in this very tool, four hits in a test that EXEMPTS a hook on the grounds that
 *   this gate covers it — and one bash line inside a SKILL.md Gate section.
 *
 * THE DISTINCTION THAT DECIDES IT
 *   An EXECUTABLE position is one the runtime reaches without a model choosing to:
 *     - a `hooks.json` entry
 *     - a hook command in a skill's YAML frontmatter
 *     - an `import` from non-test code
 *     - a shell invocation inside a script
 *
 *   A bash fence in a SKILL.md body is NOT one. It runs only if a model reads that section and
 *   decides to run it — which is precisely how `beat-implement.js` stayed "invoked" for four months.
 *   That is the whole distinction, and no amount of grepping for a filename expresses it.
 *
 * WHY THIS IS A SEPARATE FILE
 *   It is the check the audit team ranked first, and it subsumes four of their sixteen shapes. It is
 *   also the check whose absence let this tool's own remedy string point at an orphan. Keeping it
 *   separable means it can be run against any repo, including one that does not have the rest of the
 *   probe's assumptions.
 *
 * Usage: bun scripts/wc/executable-position.ts --target <repo root> [--json]
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type Position = "hooks.json" | "frontmatter" | "import" | "shell" | "skill-prose" | "doc" | "test" | "comment";

export type Reachability = {
  file: string;
  executable: number;
  modelMediated: number;
  inert: number;
  sites: { position: Position; where: string }[];
};

const TEXT = /\.(ts|js|mjs|py|sh|md|json)$/;

function walk(root: string, dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(join(root, dir)); } catch { return out; }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git" || entry === "external") continue;
    const rel = dir ? `${dir}/${entry}` : entry;
    let stat;
    try { stat = statSync(join(root, rel)); } catch { continue; }
    if (stat.isDirectory()) walk(root, rel, out);
    else if (TEXT.test(entry)) out.push(rel);
  }
  return out;
}

const read = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };

/** Frontmatter of a skill file, or "" for anything else. */
function frontmatter(text: string): string {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  return match?.[1] ?? "";
}

/**
 * Classify one reference site.
 *
 * The ORDER matters and is not arbitrary: a hook command inside a skill's frontmatter is executable,
 * while the identical string in that same file's BODY is model-mediated. Splitting frontmatter from
 * body before classifying is what makes the two distinguishable at all.
 */
function classify(referrer: string, line: string, inFrontmatter: boolean): Position {
  if (referrer.endsWith("hooks.json")) return "hooks.json";
  if (referrer.endsWith("SKILL.md")) return inFrontmatter ? "frontmatter" : "skill-prose";
  if (/(^|\/)tests?\//.test(referrer) || /\.test\.|_test\./.test(referrer)) return "test";
  if (/^\s*(\/\/|#|\*)/.test(line)) return "comment";
  if (referrer.endsWith(".md")) return "doc";
  if (/\bimport\b|\brequire\s*\(|\bfrom\s+["']/.test(line)) return "import";
  if (/\b(bun|node|python3?|bash|sh|uv run)\b/.test(line)) return "shell";
  return "comment";
}

const EXECUTABLE: ReadonlySet<Position> = new Set<Position>(["hooks.json", "frontmatter", "import", "shell"]);

/**
 * SCOPED TO hooks/ AND scripts/ ON PURPOSE — `workflows/*.js` is excluded and that is not an oversight.
 *
 * A workflow script's DESIGNED invocation is a model calling the `Workflow` tool from a SKILL.md
 * body. Model-mediated is its normal state, so flagging it says only "this is a workflow script."
 * A HOOK is the opposite: its designed invocation is the runtime firing it, so model-mediated is a
 * defect. A script cited as ENFORCEMENT is the same — `implement-gate.ts` is not supposed to depend
 * on someone reading a Gate section and choosing to run it.
 *
 * Including workflows/ produced 29 findings, most of them "a workflow script is invoked the way
 * workflow scripts are invoked." That is the false-positive wave this comment exists to prevent
 * someone reintroducing.
 */
export function reachability(root: string, subjectDirs = ["hooks", "scripts"]): Reachability[] {
  const all = walk(root, "");
  const subjects = all.filter(f => subjectDirs.some(d => f.startsWith(`${d}/`)) && /\.(ts|js|mjs|py|sh)$/.test(f));
  const results: Reachability[] = [];

  for (const subject of subjects) {
    const base = subject.split("/").pop()!;
    // `_`-prefixed files and anything under a lib/ directory are shared helpers reached by import.
    // They have no independent invocation to look for, and flagging them measures nothing.
    if (base.startsWith("_") || subject.includes("/lib/")) continue;
    const stem = base.replace(/\.(ts|js|mjs|py|sh)$/, "");
    const sites: { position: Position; where: string }[] = [];

    for (const referrer of all) {
      if (referrer === subject) continue;
      const text = read(join(root, referrer));
      if (!text.includes(base) && !text.includes(stem)) continue;
      const front = referrer.endsWith("SKILL.md") ? frontmatter(text) : "";
      for (const [index, line] of text.split("\n").entries()) {
        if (!line.includes(base) && !line.includes(stem)) continue;
        // A reference is "in frontmatter" if the line falls inside the frontmatter block.
        const inFrontmatter = front.includes(line.trim()) && line.trim().length > 0;
        sites.push({ position: classify(referrer, line, inFrontmatter), where: `${referrer}:${index + 1}` });
      }
    }

    const executable = sites.filter(s => EXECUTABLE.has(s.position)).length;
    const modelMediated = sites.filter(s => s.position === "skill-prose").length;
    const inert = sites.length - executable - modelMediated;
    results.push({ file: subject, executable, modelMediated, inert, sites });
  }
  return results;
}

export type OrphanFinding = {
  file: string;
  severity: "critical" | "major";
  mentions: number;
  detail: string;
  remedy: string;
};

/**
 * A file with references but no executable one.
 *
 * SEVERITY SPLITS ON WHETHER PROSE CLAIMS TO INVOKE IT. A file reached only through a SKILL.md bash
 * fence is worse than one reached through nothing at all: the prose asserts that it runs, so every
 * reader — and every audit — records it as live. `implement-gate.ts` is that case exactly, and it is
 * why five separate reviewers cited it as the remedy for a defect it was itself an instance of.
 */
/**
 * SAFETY DEPENDENCIES, DECLARED — not detected.
 *
 * I tried three heuristics for "is this file cited as a safety guarantee" and every one was noisy.
 * The last one matched THIS FILE'S OWN HEADER, because a header documenting the defect class uses the
 * same vocabulary as a safety argument. The class, in the checker for the class, for the second time.
 *
 * So it is declared instead. Each entry says: THIS component's safety argument depends on THAT
 * component actually running. That is a fact only a human knows and a grep never will — and burying
 * it in a comment is exactly how `implement-gate.ts` came to be cited by two files as the reason a
 * fail-open hook was safe, while nothing ran it.
 *
 * Making the dependency explicit is most of the fix. The check below is the cheap part.
 */
export const SAFETY_DEPENDS_ON: readonly { dependent: string; requires: string; why: string }[] = [
  {
    dependent: "hooks/work-implement-observation.ts",
    requires: "scripts/beat/implement-gate.ts",
    why: "the hook fails OPEN on its own errors and writes a record instead of denying. That is only safe if something treats a MISSING record as failure. tests/pretooluse-crash-closure.test.mjs exempts the hook from denyOnCrash on exactly these grounds.",
  },
];

export type GuaranteeFinding = { dependent: string; requires: string; why: string; detail: string };

/** A declared safety dependency whose required component has no runtime-reached invocation. */
export function checkDeclaredGuarantees(root: string): GuaranteeFinding[] {
  const reach = new Map(reachability(root).map(r => [r.file, r]));
  return SAFETY_DEPENDS_ON.flatMap(dep => {
    const r = reach.get(dep.requires);
    if (!r) return [{ ...dep, detail: `${dep.requires} was not found under hooks/ or scripts/ at all.` }];
    if (r.executable > 0) return [];
    return [{ ...dep, detail: `${dep.requires} has ${r.executable} executable invocation(s) and ${r.modelMediated} skill-prose site(s). ${dep.dependent}'s safety argument rests on it running, and nothing runs it.` }];
  });
}

export function findOrphans(root: string): OrphanFinding[] {
  const summary = (r: Reachability) => `${r.modelMediated + r.inert} reference(s), 0 executable`;
  return reachability(root)
    .filter(r => r.executable === 0 && r.modelMediated + r.inert > 0)
    .map(r => ({
      file: r.file,
      severity: "major" as const,
      mentions: r.modelMediated + r.inert,
      detail: `${summary(r)} — no executable invocation; ${r.modelMediated} skill-prose site(s), which run only if a model chooses to.`,
      remedy: "wire it, delete it, or record it as CLI-only tooling. This is hygiene, not a broken guarantee — for the sharp version, see whether anything's safety rests on it running (SAFETY_DEPENDS_ON above).",
    }));
}

if (import.meta.main) {
  const argv = process.argv;
  const target = argv[argv.indexOf("--target") + 1];
  if (!target || target.startsWith("--")) { console.error("requires --target <repo root>"); process.exit(2); }
  const findings = findOrphans(target);
  if (argv.includes("--json")) console.log(JSON.stringify({ target, findings }, null, 2));
  else {
    for (const f of findings) console.log(`${f.severity.toUpperCase()}  ${f.file}\n    ${f.detail}\n    -> ${f.remedy}`);
    console.log(`executable-position: ${findings.length} orphan(s) in ${relative(process.cwd(), target) || target}`);
  }
  process.exit(findings.length ? 1 : 0);
}
