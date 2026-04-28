/**
 * Pure-function pandoc citation extractor.
 *
 * Recognizes:
 *   [@bibkey]                 → 1 citation
 *   [@bibkey, p. 42]          → 1 citation w/ locator "p. 42"
 *   [@a; @b, p. 5]            → 2 citations (locator only on b)
 *   @bibkey                   → in-text citation (single bibkey)
 *
 * The "claim" is the sentence containing the citation, where a sentence is
 * delimited by `. ` / `! ` / `? ` or paragraph boundaries (blank line, start
 * or end of file). The citation marker itself is stripped from the returned
 * claim text for cleaner reading.
 *
 * Footnote indirection: pandoc footnote definitions look like
 *   [^id]: footnote body text [@bibkey, p. 42]
 * When a citation is found inside a footnote definition, we walk the markdown
 * for the matching `[^id]` body marker (NOT followed by `:`) and use the
 * sentence containing that marker as the `claim`. The footnote body itself is
 * returned as `footnoteContext`.
 *
 * Pandoc-crossref filter: bibkeys starting with `tbl:`, `fig:`, `sec:`, `eq:`,
 * or `lst:` are pandoc-crossref internal anchors, not real citations. We
 * silently skip them.
 */

export interface Citation {
  bibkey: string;
  /** Anything after the bibkey in `[@key, ...]`, e.g. "p. 42", "ch. 3". */
  locator?: string;
  /**
   * The proposition this cite supports. When a Bluebook-style parenthetical
   * follows the cite (e.g. `[@key] (showing X)`), the parenthetical text is
   * the claim and the body sentence is moved to `bodyContext`. Otherwise the
   * claim is the body sentence with the cite marker stripped.
   */
  claim: string;
  /** Raw text of the parenthetical immediately following the cite, when present. */
  parenthetical?: string;
  /** Lowercased Bluebook signal preceding the cite (e.g. "see", "cf."), if any. */
  signal?: string;
  /** Body sentence retained as auxiliary context when `parenthetical` is the claim. */
  bodyContext?: string;
  /** Footnote body text when the cite was defined inside a `[^id]:` footnote. */
  footnoteContext?: string;
  /** File path where the citation was found (caller-supplied; pass-through). */
  file: string;
  /** 1-indexed line number of the citation match. */
  line: number;
}

// Bibkey character class: word chars, hyphen, colon. Covers `Hirst2022-pq`,
// `B:foo-bar123`, `cremers2009`, etc.
const BIBKEY_CHARS = "[\\w\\-:]";

// Bracketed cite group: `[@a]`, `[@a, p. 4]`, `[@a; @b, p. 5]`. We capture
// the entire inner content (everything between `[` and `]`) and re-parse the
// pieces (split on `;`) below. The group must contain at least one `@key`.
const BRACKETED_RE = new RegExp(
  `\\[((?:@${BIBKEY_CHARS}+)[^\\]]*)\\]`,
  "g",
);

// In-text cite: `@key` not preceded by `[` or a word char (so we don't match
// emails like `foo@bar.com` or already-bracketed cites that the bracketed
// regex will pick up).
const INTEXT_RE = new RegExp(`(?<![\\[\\w])@(${BIBKEY_CHARS}+)\\b`, "g");

// A multi-cite group: [@a; @b, p. 5]. We split on `;` and re-parse each piece
// using a per-bibkey regex.
const SINGLE_BIB_RE = new RegExp(
  `^\\s*@(${BIBKEY_CHARS}+)\\s*(?:,\\s*(.+?))?\\s*$`,
);

// Pandoc-crossref internal-anchor prefixes — not real citations.
const CROSSREF_PREFIXES = /^(tbl|fig|sec|eq|lst):/;

// Bluebook signal regex. Anchored to end-of-string ($) so we apply it to the
// short slice of text immediately preceding a cite. We allow markdown emphasis
// markers (`*` or `_`) around the signal word(s). The captured group is the
// signal text proper, which we lowercase and squash whitespace on for the
// `signal` field. Order matters: longer phrases first so "see also" wins over
// "see".
const SIGNAL_RE =
  /(?:^|[\s>(])([*_]?)\s*(see,\s*e\.g\.,?|see\s+also|see\s+generally|but\s+see|but\s+cf\.|cf\.|compare|accord|see)\s*\1\s*$/i;

/** Look back ~30 chars from the cite start on the same line for a Bluebook signal. */
function detectSignal(text: string, citeStart: number): string | undefined {
  // Restrict to the same line: walk back to the most recent `\n` (exclusive).
  let lineStart = citeStart;
  while (lineStart > 0 && text[lineStart - 1] !== "\n") lineStart--;
  // Up to 30 chars back, but not before the line start.
  const windowStart = Math.max(lineStart, citeStart - 30);
  const window = text.slice(windowStart, citeStart);
  const m = SIGNAL_RE.exec(window);
  if (!m) return undefined;
  // Normalize: lowercase, collapse internal whitespace.
  return m[2].toLowerCase().replace(/\s+/g, " ");
}

/**
 * Detect a parenthetical immediately following a cite's closing `]`. Allows
 * any whitespace (including a single newline) between `]` and `(`. Returns
 * { text, end } where `end` is the offset just after the closing `)`, or
 * null if no parenthetical is present.
 */
function detectParenthetical(
  text: string,
  afterBracket: number,
): { text: string; end: number } | null {
  // Skip whitespace (no newlines beyond a single one — we don't want to grab
  // a paren on the next paragraph).
  let i = afterBracket;
  let sawNewline = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\n") {
      if (sawNewline) return null;
      sawNewline = true;
      i++;
      continue;
    }
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    break;
  }
  if (text[i] !== "(") return null;
  // Find the matching `)` allowing nested parens.
  let depth = 1;
  let j = i + 1;
  while (j < text.length && depth > 0) {
    const ch = text[j];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth === 0) break;
    j++;
  }
  if (depth !== 0) return null;
  const inner = text.slice(i + 1, j).trim();
  if (!inner) return null;
  return { text: inner, end: j + 1 };
}

// Footnote definition: a line starting with `[^id]:`. Capture the id and the
// rest of the line (the footnote body).
const FOOTNOTE_DEF_RE = /^\[\^([\w-]+)\]:[ \t]?(.*)$/gm;

/** Find the 1-indexed line number for a string offset. */
function lineNumberOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

/**
 * Find the sentence (or paragraph fragment) containing position `pos`.
 * Sentence boundaries: `. `, `! `, `? `, blank line (`\n\n`), or file edge.
 */
function sentenceContaining(text: string, pos: number): string {
  // Walk backward from pos to find sentence start.
  let start = 0;
  for (let i = pos - 1; i >= 1; i--) {
    const prev = text[i - 1];
    const cur = text[i];
    // Paragraph boundary.
    if (prev === "\n" && cur === "\n") {
      start = i + 1;
      break;
    }
    // Sentence terminator + whitespace.
    if (
      (prev === "." || prev === "!" || prev === "?") &&
      (cur === " " || cur === "\n" || cur === "\t")
    ) {
      start = i + 1;
      break;
    }
  }

  // Walk forward from pos to find sentence end.
  let end = text.length;
  for (let i = pos; i < text.length - 1; i++) {
    const cur = text[i];
    const next = text[i + 1];
    if (cur === "\n" && next === "\n") {
      end = i;
      break;
    }
    if (
      (cur === "." || cur === "!" || cur === "?") &&
      (next === " " || next === "\n" || next === "\t")
    ) {
      end = i + 1;
      break;
    }
  }

  return text.slice(start, end).trim();
}

/** Strip every pandoc cite marker from a string. */
function stripCitations(s: string): string {
  return s
    .replace(BRACKETED_RE, "")
    .replace(INTEXT_RE, "")
    // Collapse double spaces / leading punctuation left behind.
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

/**
 * Parse one inner-bracket fragment like `@key` or `@key, p. 42`.
 * Returns { bibkey, locator } or null if it doesn't look like a citation.
 */
function parseInnerCite(
  fragment: string,
): { bibkey: string; locator?: string } | null {
  const m = SINGLE_BIB_RE.exec(fragment);
  if (!m) return null;
  return {
    bibkey: m[1],
    locator: m[2] ? m[2].trim() : undefined,
  };
}

/**
 * Build a map of footnote-definition byte ranges → { id, body }.
 * The range covers the full definition line (we only support single-line
 * definitions for now — multi-line continuation is a TODO).
 */
interface FootnoteDef {
  id: string;
  body: string;
  start: number; // line start
  end: number;   // line end (exclusive newline)
}

function findFootnoteDefs(text: string): FootnoteDef[] {
  const defs: FootnoteDef[] = [];
  const re = new RegExp(FOOTNOTE_DEF_RE.source, "gm");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    defs.push({ id: m[1], body: m[2], start, end });
  }
  return defs;
}

/**
 * Find the byte offset of the first `[^id]` body MARKER (anywhere NOT followed
 * by `:`) in `text`. Returns -1 if none found.
 */
function findFootnoteMarker(text: string, id: string): number {
  // Escape regex metacharacters in id (id is `[\w-]+` so only `-` matters,
  // and it's safe in a non-class context — but be defensive).
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\[\\^${escaped}\\](?!:)`, "g");
  const m = re.exec(text);
  return m ? m.index : -1;
}

export function extractCitations(
  markdownText: string,
  filePath: string,
): Citation[] {
  const out: Citation[] = [];

  // Pre-compute footnote definitions for indirection lookup.
  const footnoteDefs = findFootnoteDefs(markdownText);

  // Track [start, end) byte ranges of bracketed cite groups so we can skip
  // in-text matches that fall inside them.
  const bracketRanges: Array<[number, number]> = [];

  // Pass 1: bracketed citations (may be multi-cite).
  // Use a fresh RegExp each call to avoid lastIndex leaking across calls.
  const bracketRe = new RegExp(BRACKETED_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = bracketRe.exec(markdownText)) !== null) {
    const matchStart = m.index;
    const matchEnd = matchStart + m[0].length;
    bracketRanges.push([matchStart, matchEnd]);
    const inner = markdownText.slice(matchStart + 1, matchEnd - 1); // drop [ ]
    const line = lineNumberOf(markdownText, matchStart);

    // Bluebook signal preceding the cite (applies to whole multi-cite group).
    const signal = detectSignal(markdownText, matchStart);

    // Bluebook parenthetical following the cite (applies to whole group).
    const paren = detectParenthetical(markdownText, matchEnd);
    if (paren) {
      // Extend the bracket range to also cover the parenthetical so later
      // sentence/cite scans treat it as part of the cite group.
      bracketRanges[bracketRanges.length - 1] = [matchStart, paren.end];
    }

    // Footnote indirection: is this cite inside a footnote definition?
    const enclosingFn = footnoteDefs.find(
      (d) => matchStart >= d.start && matchStart < d.end,
    );
    let bodySentence: string;
    let footnoteContext: string | undefined;
    if (enclosingFn) {
      const markerOffset = findFootnoteMarker(markdownText, enclosingFn.id);
      if (markerOffset >= 0) {
        // Found a body marker — use that sentence as the claim, and carry
        // the footnote body as auxiliary context.
        bodySentence = stripCitations(
          sentenceContaining(markdownText, markerOffset),
        );
        footnoteContext = stripCitations(enclosingFn.body);
      } else {
        // Orphan footnote: no body reference. Fall back to the footnote body
        // as the claim and leave context undefined.
        bodySentence = stripCitations(enclosingFn.body);
        footnoteContext = undefined;
      }
    } else {
      bodySentence = stripCitations(sentenceContaining(markdownText, matchStart));
      footnoteContext = undefined;
    }

    // When a parenthetical is present, it becomes the claim and the body
    // sentence is demoted to bodyContext.
    const claim = paren ? paren.text : bodySentence;
    const bodyContext = paren ? bodySentence : undefined;
    const parenthetical = paren ? paren.text : undefined;

    // Split on `;` for multi-cite groups.
    const pieces = inner.split(";");
    for (const piece of pieces) {
      const parsed = parseInnerCite(piece);
      if (!parsed) continue;
      // Skip pandoc-crossref internal anchors.
      if (CROSSREF_PREFIXES.test(parsed.bibkey)) continue;
      out.push({
        bibkey: parsed.bibkey,
        locator: parsed.locator,
        claim,
        parenthetical,
        signal,
        bodyContext,
        footnoteContext,
        file: filePath,
        line,
      });
    }
  }

  // Pass 2: in-text citations. Skip any that fall inside an already-matched
  // bracketed group.
  const intextRe = new RegExp(INTEXT_RE.source, "g");
  while ((m = intextRe.exec(markdownText)) !== null) {
    const matchStart = m.index;
    const matchEnd = matchStart + m[0].length;
    const insideBracket = bracketRanges.some(
      ([s, e]) => matchStart >= s && matchStart < e,
    );
    if (insideBracket) continue;
    const bibkey = m[1];
    // Skip pandoc-crossref internal anchors.
    if (CROSSREF_PREFIXES.test(bibkey)) continue;
    const line = lineNumberOf(markdownText, matchStart);

    // Bluebook signal preceding and parenthetical following.
    const signal = detectSignal(markdownText, matchStart);
    const paren = detectParenthetical(markdownText, matchEnd);

    // Footnote indirection (same logic as Pass 1).
    const enclosingFn = footnoteDefs.find(
      (d) => matchStart >= d.start && matchStart < d.end,
    );
    let bodySentence: string;
    let footnoteContext: string | undefined;
    if (enclosingFn) {
      const markerOffset = findFootnoteMarker(markdownText, enclosingFn.id);
      if (markerOffset >= 0) {
        bodySentence = stripCitations(
          sentenceContaining(markdownText, markerOffset),
        );
        footnoteContext = stripCitations(enclosingFn.body);
      } else {
        bodySentence = stripCitations(enclosingFn.body);
        footnoteContext = undefined;
      }
    } else {
      bodySentence = stripCitations(sentenceContaining(markdownText, matchStart));
      footnoteContext = undefined;
    }

    const claim = paren ? paren.text : bodySentence;
    const bodyContext = paren ? bodySentence : undefined;
    const parenthetical = paren ? paren.text : undefined;

    out.push({
      bibkey,
      claim,
      parenthetical,
      signal,
      bodyContext,
      footnoteContext,
      file: filePath,
      line,
    });
  }

  return out;
}
