/**
 * RESOLVE A CALLER'S SKILL BUNDLE INTO BYTES.
 *
 * WHY THIS EXISTS
 *   The domain rules a third-party reviewer is judged against used to be inlined in one adapter, so
 *   the only way to give a reviewer a different domain's rules was to edit that adapter. This module
 *   is the seam that replaces the edit: a caller names its own skills, and the beat hands over their
 *   text plus a hash of exactly what was handed over.
 *
 * WHY EVERY FAILURE HERE THROWS RATHER THAN DEGRADING
 *   A typo in a bundle name that silently yielded no rules would be the same silent zero the `status`
 *   field exists to prevent, one layer up: the reviewer runs, reports cleanly, and nobody learns it
 *   was judging against nothing. Over-cap throws for a related reason — truncating a rule set
 *   mid-sentence produces a reviewer applying half a rule, which is worse than a refusal because it
 *   still looks like a review.
 *
 * A LEAF-ADJACENT MODULE. It imports only `contract.ts` (types) and node builtins, so it can be used
 * from an adapter without reopening the prose -> runner -> registry -> prose cycle documented in
 * `contract.ts`.
 */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import type { SkillBrief } from "./contract.ts";

/**
 * Total brief bytes handed to one reviewer.
 *
 * 60 KB is roughly ~15k tokens on top of the ~22k the harness wrapper already spends on system
 * prompt and skill roster before the document is even reached. Past that the bundle is competing
 * with the thing under review for the reviewer's attention.
 */
export const MAX_BRIEF_BYTES = 60 * 1024;

/**
 * The file a skill offers a third-party reviewer, when it offers a purpose-built one.
 *
 * Preferred over `SKILL.md` because a SKILL.md is written to instruct Claude inside this harness —
 * it names tools, hooks and workflow steps a foreign reviewer cannot act on. A skill that wants to
 * be read by a different model writes this file instead.
 */
const BRIEF_FILE = join("references", "third-party-brief.md");

function fail(message: string): never {
  throw new Error(`third-party skill bundle: ${message}`);
}

/** `<pluginRoot>/skills`, resolved through symlinks so containment is compared on real paths. */
function skillsRoot(pluginRoot: string): string {
  try {
    return realpathSync(join(pluginRoot, "skills"));
  } catch (error) {
    return fail(`cannot resolve the skills directory under ${pluginRoot}: ${(error as Error).message}`);
  }
}

function realFile(candidate: string): string | undefined {
  try {
    const real = realpathSync(candidate);
    return statSync(real).isFile() ? real : undefined;
  } catch {
    return undefined;
  }
}

/**
 * One bundle entry -> one file.
 *
 *   `ai-anti-patterns`                      -> references/third-party-brief.md, else SKILL.md
 *   `ai-anti-patterns/references/12-....md` -> that exact file
 *
 * The two forms are distinguished by the presence of a separator, not by a flag, because that is how
 * a caller writes them.
 */
function resolvePath(root: string, entry: string): string {
  const candidates = entry.includes("/")
    ? [join(root, entry)]
    : [join(root, entry, BRIEF_FILE), join(root, entry, "SKILL.md")];
  for (const candidate of candidates) {
    const real = realFile(candidate);
    if (!real) continue;
    // CONTAINMENT IS CHECKED AFTER REALPATH, not before. `skills/x/../../../etc/passwd` normalises
    // away under `join` alone, and a symlink out of the tree survives any purely lexical check.
    if (real !== root && !real.startsWith(root + sep)) {
      fail(`"${entry}" resolves outside ${root}`);
    }
    return real;
  }
  // Naming a bundle that does not exist is a caller error, and the only honest response is a refusal:
  // yielding zero rules here produces a review nobody can tell from a rule-governed one.
  fail(`"${entry}" names no readable file (looked for ${candidates.join(", ")})`);
}

/**
 * Resolve a caller's `skills` list into the bytes a reviewer will be given.
 *
 * Order is preserved; duplicates collapse, because a name repeated is the same rules twice and the
 * cap should not be spent on a copy.
 */
export function resolveSkillBriefs(pluginRoot: string, names: unknown): SkillBrief[] {
  if (names === undefined || names === null) return [];
  if (!Array.isArray(names)) fail("skills must be an array of skill names or skill-relative paths");
  const entries: string[] = [];
  for (const name of names) {
    if (typeof name !== "string" || !name.trim()) fail(`entry is not a nonempty string: ${JSON.stringify(name)}`);
    const entry = name.trim();
    if (!entries.includes(entry)) entries.push(entry);
  }
  if (!entries.length) return [];

  const root = skillsRoot(pluginRoot);
  const briefs: SkillBrief[] = [];
  let total = 0;
  for (const entry of entries) {
    const path = resolvePath(root, entry);
    const bytes = readFileSync(path);
    total += bytes.byteLength;
    if (total > MAX_BRIEF_BYTES) {
      fail(`"${entry}" pushes the bundle past ${MAX_BRIEF_BYTES} bytes; name a narrower reference file rather than a whole skill`);
    }
    briefs.push({
      skill: entry,
      // Reported relative to the skills root: an absolute path leaks the machine and is not what a
      // reader tracing a finding back to its rule needs.
      path: path.slice(root.length + 1),
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      text: bytes.toString("utf8"),
    });
  }
  return briefs;
}

/** Strip the bytes, keep the receipt. */
export function briefSources(briefs: SkillBrief[]): { skill: string; path: string; bytes: number; sha256: string }[] {
  return briefs.map(({ skill, path, bytes, sha256 }) => ({ skill, path, bytes, sha256 }));
}
