#!/usr/bin/env bun
/**
 * PreToolUse hook: block OUTLINE_REVIEWED.md = APPROVED unless the writing outline-spec is
 * machine-executable — i.e. scripts/writing/writing_section_index.py parses it clean.
 *
 * TypeScript port of hooks/writing-outline-executable-guard.py.
 *
 * This is the writing analog of ds/dev's *-plan-executable-guard: the SAME shared parser the
 * two writing engines (writing-draft.js, writing-review.js) consume also gates approval, so
 * "the index compiles" ⇔ "the outline passes the gate" — they cannot drift. The parser is the
 * single source of truth for the document's section set, document order, file pairing, and the
 * claim→section mapping.
 *
 * THE PARSER STAYS IN PYTHON ON PURPOSE — same reasoning as hooks/_plan_guard_common.ts.
 * scripts/writing/writing_section_index.py is imported by scripts/writing/writing_compile.py
 * (which feeds the engines their section index) AND by this guard, precisely so the engines and
 * the guard can never disagree about the section set. Reimplementing its 360 lines of tolerant
 * regex parsing here would fork that single source of truth and let an outline compile while the
 * gate rejects it (or worse, the reverse). We shell out to it instead, and reproduce the Python
 * original's failure mode when the import blows up: traceback on stderr, nonzero exit.
 *
 * What it blocks on (from build_index().violations):
 *   - a section with no outline file (tolerant pairing already tried '<Name>.md' + '(Outline).md')
 *   - a non-granular outline (placeholder "TBA"/"develop this", or bare headings)
 *   - a section whose draft.implements is MISSING a primary claim the OUTLINE.md
 *     `## Claim → Section Map` assigns to it (the ⊇ gate)
 *
 * It ALSO surfaces (non-blocking warning) staleApproval — a re-approve prompt, not a hard block.
 *
 * CLI:  bun writing-outline-executable-guard.ts /abs/project   # lint mode (exit 1 if bad)
 */
import { deny, pyJson } from "./_gate_common.ts";

/** The Python original's module-level `sys.path.insert(parents[1]/scripts/writing)`. */
const SCRIPTS_DIR = `${import.meta.dir.replace(/\/[^/]*$/, "")}/scripts/writing`;

const VALIDATE_SNIPPET = [
  "import json, sys",
  "from pathlib import Path",
  "sys.path.insert(0, sys.argv[1])",
  'mod = __import__("writing_section_index", fromlist=["build_index"])',
  "res = mod.build_index(Path(sys.argv[2]))",
  'print("\\x00PARITY\\x00" + json.dumps([res.violations, res.stale_approval]))',
].join("\n");

/** build_index(project_or_planning) -> [violations, staleApproval] */
function validate(projectOrPlanning: string): [string[], string[]] {
  const r = Bun.spawnSync(["uv", "run", "python3", "-c", VALIDATE_SNIPPET, SCRIPTS_DIR, projectOrPlanning]);
  const out = new TextDecoder().decode(r.stdout);
  const marker = out.lastIndexOf("\x00PARITY\x00");
  if (r.exitCode !== 0 || marker < 0) {
    process.stderr.write(new TextDecoder().decode(r.stderr));
    process.exit(r.exitCode === 0 ? 1 : r.exitCode);
  }
  return JSON.parse(out.slice(marker + "\x00PARITY\x00".length).split("\n")[0]);
}

/** str(PurePosixPath(p).parent) — pathlib drops "." components and collapses separators. */
function pyParent(p: string): string {
  const absolute = p.startsWith("/");
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  parts.pop();
  const joined = parts.join("/");
  if (absolute) return "/" + joined;
  return joined === "" ? "." : joined;
}

const argv = process.argv.slice(2);

// CLI lint mode
if (argv.length > 0 && argv[0] !== "-") {
  const [violations, stale] = validate(argv[0]);
  if (stale.length) {
    console.log("STALE APPROVAL (re-approve PRECIS/OUTLINE):\n- " + stale.join("\n- "));
  }
  if (violations.length) {
    console.log("OUTLINE NOT EXECUTABLE:\n- " + violations.join("\n- "));
    process.exit(1);
  }
  console.log("Outline-spec executable: every section parses, granular, and claim-pinned (⊇).");
  process.exit(0);
}

let hookInput: Record<string, unknown>;
try {
  hookInput = JSON.parse(await Bun.stdin.text());
} catch {
  process.exit(0);
}
const toolName = hookInput?.["tool_name"] ?? "";
if (toolName !== "Write" && toolName !== "Edit") process.exit(0);
const toolInput = (hookInput["tool_input"] ?? {}) as Record<string, unknown>;
const filePath = String(toolInput["file_path"] ?? "");
if (!filePath || !filePath.endsWith("OUTLINE_REVIEWED.md")) process.exit(0);

// OUTLINE_REVIEWED.md lives in .planning/; the project root is its grandparent.
const planning = pyParent(filePath);
const [violations, stale] = validate(planning);

if (violations.length) {
  let msg =
    "GATE BLOCKED: the writing outline-spec is not machine-executable, so it " +
    "cannot be approved for drafting/review.\n\n" +
    "Problems (from scripts/writing/writing_section_index.py):\n- " +
    violations.join("\n- ") +
    "\n\n" +
    "Both writing engines build the section set from this index (document order " +
    "from OUTLINE.md ## Structure; the claim→section map; tolerant outline/draft " +
    "pairing). Fix the outline(s) in writing-outline — give each section a " +
    "paragraph-granular outline, pair its draft, and ensure each draft's " +
    "`implements: [CLAIM-XX]` covers the primary claims the `## Claim → Section " +
    "Map` assigns it — then re-run the outline reviewer.";
  if (stale.length) {
    msg += "\n\nALSO (stale approval — fix while you are here):\n- " + stale.join("\n- ");
  }
  deny(msg);
}

// Outline executable but a prior approval is stale → warn, do not block (re-approval is the fix).
if (stale.length) {
  console.log(
    pyJson({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason:
          "Outline-spec is executable. NOTE — a prior review artifact is stale vs the " +
          "live OUTLINE.md (re-approve to clear):\n- " + stale.join("\n- "),
      },
    }),
  );
  process.exit(0);
}

process.exit(0);
