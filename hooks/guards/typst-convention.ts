// PostToolUse(Edit|Write) on .typ: quick grep-based Typst convention checks, reported as context.
//
// The odd bits are deliberate, not bugs to fix:
//   - Check 9 interpolates a Python float, so "1" renders as "1.0em", not "1em".
//   - The apostrophe message contains the LITERAL text `\u{2019}` — it is not an escape.
//   - A payload whose tool_input or file_path has the wrong type throws (the script exits 1 with
//     empty stdout, as the Python original died on `.get`); the mod skips the hook.
//
// SCOPE. A Write is judged on the whole file. An Edit is judged only on the lines its new_string
// occupies in the file now: whole-file reporting attached standing violations at lines 8-24 to an
// edit at line 79. An Edit payload with no new_string carries no span and is judged whole.
// Each finding is shown once per session (path + label + line text), seen-set in the temp dir.
import { absolute, joinPath, type Guard, type GuardIO, type Payload } from "./core.ts";
import { isTypDeckWith } from "./deck.ts";

/** Python's Path(...) normalization, enough for suffix/stem: strip trailing slashes, take the name. */
function pathName(p: string): string {
  let s = p;
  while (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  const idx = s.lastIndexOf("/");
  return idx < 0 ? s : s.slice(idx + 1);
}

/** Python's PurePath.suffix. */
function pathSuffix(p: string): string {
  const name = pathName(p);
  const i = name.lastIndexOf(".");
  return i > 0 && i < name.length - 1 ? name.slice(i) : "";
}

const LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

/** Python's str.splitlines (the boundaries that matter for text files). */
function splitLines(s: string): string[] {
  if (s === "") return [];
  const parts = s.split(LINE_BREAK);
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** Python's str.rstrip() — trailing whitespace only. */
function rstrip(s: string): string {
  return s.replace(/\s+$/, "");
}

/** Python's f-string rendering of a float: 1 -> "1.0", 1.5 -> "1.5". */
function pyFloat(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : String(n);
}

/** A violation and the 1-based lines it concerns; `line` is the one its key reads. */
interface Finding {
  msg: string;
  line: number;
  lines: number[];
}

/** Run convention checks on a .typ file's content. */
function checkContent(filepath: string, content: string): Finding[] {
  const lines = splitLines(content);
  const violations: Finding[] = [];
  const at = (i: number, msg: string, extra: number[] = []): void => {
    violations.push({ msg: `Line ${i + 1}: ${msg}`, line: i + 1, lines: [i + 1, ...extra] });
  };

  // Check 1: Missing blank lines between top-level bullets
  for (let i = 0; i < lines.length; i++) {
    if (i + 1 < lines.length) {
      const curr = rstrip(lines[i]);
      const nxt = rstrip(lines[i + 1]);
      // Two consecutive lines starting with "- " (top-level bullets)
      if (/^\s{0,1}-\s/.test(curr) && /^\s{0,1}-\s/.test(nxt)) {
        at(i, "Missing blank line between top-level bullets", [i + 2]);
      }
    }
  }

  // Check 2: Fake sub-bullets using -- as marker
  for (let i = 0; i < lines.length; i++) {
    if (/^\s+--\s/.test(lines[i])) {
      at(i, "Fake sub-bullet using '--'. Use two-space indent + '- ' instead");
    }
  }

  // Check 3: cetz-plot import (banned)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("cetz-plot")) {
      at(i, "cetz-plot import detected. Use #table() instead");
    }
  }

  // Check 4: Missing qr: none in config-info (decks only).
  // NOT `pathStem(filepath).includes("slides")` — the filename with its extension stripped, which
  // matched only a file literally named `slides.typ` and skipped every deck stored as
  // `slides/<name>.typ`. Same defect as overflow-check.ts had; `isTypDeck` is the shared predicate.
  if (isTypDeckWith(filepath, () => content)) {
    if (content.includes("config-info") && !content.includes("qr:")) {
      // Anchored to the config-info line, so an Edit elsewhere in the deck does not re-raise it.
      const line = lines.findIndex((l) => l.includes("config-info")) + 1;
      violations.push({ msg: "Missing 'qr: none' in config-info block", line, lines: [line] });
    }
  }

  // Check 5: Uncentered images
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("#image(") && !lines[i].includes("align(center)")) {
      // Check if previous line has align(center)
      if (i === 0 || !lines[i - 1].includes("align(center)")) {
        at(i, "#image() not wrapped in #align(center)");
      }
    }
  }

  // Check 6: Smart apostrophe issues
  for (let i = 0; i < lines.length; i++) {
    if (/[)\]]'s/.test(lines[i])) {
      at(i, "Smart apostrophe issue. Use \\u{2019}s instead of )'s or ]'s");
    }
  }

  // Check 7: Unescaped dollar signs before numbers
  for (let i = 0; i < lines.length; i++) {
    if (/[^\\]\$\d/.test(lines[i])) {
      at(i, "Unescaped dollar sign. Use \\$ instead of $");
    }
  }

  // Check 8: Table inset too small
  for (let i = 0; i < lines.length; i++) {
    const insetMatch = lines[i].match(/inset:\s*(\d+)pt/);
    if (insetMatch && parseInt(insetMatch[1], 10) < 10) {
      at(i, `Table inset ${insetMatch[1]}pt is too small. Use 10pt minimum`);
    }
  }

  // Check 9: cetz canvas without minimum length
  for (let i = 0; i < lines.length; i++) {
    const lengthMatch = lines[i].match(/length:\s*(\d+(?:\.\d+)?)(cm|mm|pt|em)/);
    if (lengthMatch && content.includes("cetz")) {
      const val = parseFloat(lengthMatch[1]);
      const unit = lengthMatch[2];
      if (unit === "em" && val < 2) {
        at(i, `CeTZ canvas length ${pyFloat(val)}${unit} is too small. Use 2em minimum`);
      } else if (unit === "cm" || unit === "mm") {
        at(i, `CeTZ canvas uses ${unit}. Use em units (minimum 2em)`);
      }
    }
  }

  return violations;
}

/** 1-based line of a character offset, counting the same breaks splitLines splits on. */
function lineAt(content: string, offset: number): number {
  return content.slice(0, offset).split(LINE_BREAK).length;
}

/** The lines an Edit's new_string occupies in the file now; every occurrence counts, since the
 *  payload does not say which one the edit wrote. Empty when the text is not there. */
function editedLines(content: string, newString: string): Set<number> {
  const out = new Set<number>();
  if (newString === "") return out;
  for (let i = content.indexOf(newString); i >= 0; i = content.indexOf(newString, i + newString.length)) {
    const last = lineAt(content, i + newString.length - 1);
    for (let n = lineAt(content, i); n <= last; n++) out.add(n);
  }
  return out;
}

/** The payload's session id as a filename component, or "" (then nothing is deduplicated). */
function sessionKey(payload: Payload): string {
  const id = payload.session_id;
  return typeof id === "string" ? id.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64).replace(/^\.+$/, "") : "";
}

/** The findings this session has not been shown yet. A finding is its label on a line's TEXT: a
 *  line moved by an insertion above is not new, an edited line is, even under the same label. */
async function unseen(
  payload: Payload, io: GuardIO, path: string, lines: string[], found: Finding[],
): Promise<{ fresh: Finding[]; record: (shown: Finding[]) => Promise<void> }> {
  const session = sessionKey(payload);
  if (!session) return { fresh: found, record: async () => {} };
  const keyOf = (f: Finding): string =>
    `${absolute(io.cwd, path)}\0${f.msg.replace(/^Line \d+: /, "")}\0${(lines[f.line - 1] ?? "").trim()}`;
  const file = joinPath(io.osTmpdir, `typst-convention-seen-${session}.json`);
  let known: Set<string>;
  try {
    known = new Set(JSON.parse((await io.read(file)) ?? "[]"));
  } catch {
    known = new Set();
  }
  return {
    fresh: found.filter((f) => !known.has(keyOf(f))),
    record: async (shown) => {
      if (shown.length === 0) return;
      for (const f of shown) known.add(keyOf(f));
      try {
        await io.write(file, JSON.stringify([...known]));
      } catch {
        // advisory: the worst case is a repeat
      }
    },
  };
}

export const typstConventionGuard: Guard = async (hookInput, io) => {
  const toolName = "tool_name" in hookInput ? hookInput.tool_name : "";
  const toolInput = "tool_input" in hookInput ? hookInput.tool_input : {};

  if (toolName !== "Edit" && toolName !== "Write") return {};

  if (toolInput === null || typeof toolInput !== "object" || Array.isArray(toolInput)) {
    throw new TypeError("tool_input has no attribute 'get'");
  }
  const ti = toolInput as Record<string, unknown>;
  const filePathRaw = "file_path" in ti ? ti.file_path : "";
  if (typeof filePathRaw !== "string") {
    throw new TypeError("file_path has no attribute 'endswith'");
  }
  if (!filePathRaw.endsWith(".typ")) return {};

  if (pathSuffix(filePathRaw) !== ".typ") return {};
  const content = await io.read(filePathRaw);
  if (content === null) return {};

  let found = checkContent(filePathRaw, content);
  const newString = ti.new_string;
  if (toolName === "Edit" && typeof newString === "string") {
    const span = editedLines(content, newString);
    found = found.filter((f) => f.lines.some((n) => span.has(n)));
  }
  if (found.length === 0) return {};
  const { fresh, record } = await unseen(hookInput, io, filePathRaw, splitLines(content), found);
  // Limit to first 5 violations to avoid overwhelming output
  const violations = fresh.slice(0, 5);
  if (violations.length === 0) return {};
  await record(violations);
  let msg = "TYPST CONVENTION VIOLATIONS detected:\n";
  for (const v of violations) msg += `  - ${v.msg}\n`;
  msg += "\nFix these before proceeding. Every convention violation is rework for the presenter.";
  return { context: msg };
};
