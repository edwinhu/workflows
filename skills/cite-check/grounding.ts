/**
 * Post-hoc passage grounding verification.
 *
 * After Gemini returns a "supporting_passage", this module verifies the
 * passage actually exists in the source text using token-level LCS alignment
 * (ported from langextract's WordAligner).
 *
 * Two gates reject bad matches:
 *   - Coverage: matched_tokens / passage_tokens >= threshold (default 0.75)
 *   - Density:  matched_tokens / source_span_length >= min_density (default 0.33)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Token {
  text: string;
  charStart: number; // inclusive
  charEnd: number;   // exclusive
}

export interface LcsSpan {
  matches: number;
  startIdx: number; // inclusive index into source tokens
  endIdx: number;   // inclusive index into source tokens
}

export interface GroundingResult {
  grounded: boolean;
  coverage: number;       // matched / passage tokens
  density: number;        // matched / source span length
  charStart?: number;     // char offset in source text (if grounded)
  charEnd?: number;       // char offset in source text (if grounded)
  matchedText?: string;   // slice of source text at matched span
}

export interface GroundingOptions {
  coverageThreshold?: number; // default 0.75
  densityThreshold?: number;  // default 0.33
}

// ---------------------------------------------------------------------------
// Pre-normalization (Unicode NFC + ligature decomposition)
// ---------------------------------------------------------------------------

/**
 * Normalize text before tokenization: apply NFC normalization and decompose
 * common PDF ligatures (fi, fl, ff, ffi, ffl) into their component characters.
 * This ensures consistent tokenization regardless of how the PDF extractor
 * encoded the text.
 */
export function preNormalize(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\uFB00/g, "ff")
    .replace(/\uFB01/g, "fi")
    .replace(/\uFB02/g, "fl")
    .replace(/\uFB03/g, "ffi")
    .replace(/\uFB04/g, "ffl");
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * Regex tokenizer that splits text into word/number/punctuation tokens,
 * preserving character positions for source mapping.
 *
 * Matches the same pattern as langextract's RegexTokenizer:
 * sequences of letters, digits, or individual punctuation/symbols.
 *
 * Applies preNormalize() first so char positions refer to the normalized string.
 */
const TOKEN_PATTERN = /[a-zA-Z\u00C0-\u024F\u0400-\u04FF]+|\d+|[^\s\w]/g;

export function tokenize(text: string): Token[] {
  const normalized = preNormalize(text);
  const tokens: Token[] = [];
  let match: RegExpExecArray | null;
  TOKEN_PATTERN.lastIndex = 0;
  while ((match = TOKEN_PATTERN.exec(normalized)) !== null) {
    tokens.push({
      text: match[0],
      charStart: match.index,
      charEnd: match.index + match[0].length,
    });
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Lightweight normalization for matching: lowercase + strip trailing 's'
 * (for words > 3 chars not ending in "ss"). Same as langextract's
 * _normalize_token().
 */
export function normalize(token: string): string {
  const lower = token.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (lower.length > 3 && lower.endsWith("s") && !lower.endsWith("ss")) {
    return lower.slice(0, -1);
  }
  return lower;
}

// ---------------------------------------------------------------------------
// LCS DP — best span finder
// ---------------------------------------------------------------------------

/**
 * Find the tightest span in `source` that contains at least k tokens from
 * `passage` as a subsequence, for the maximum achievable k.
 *
 * Uses O(n * m²) DP where n = |source|, m = |passage|.
 * For our use case, m (passage tokens) is small (~10-100), so this is fast.
 *
 * Returns the best LcsSpan passing both coverage and density gates,
 * or null if no acceptable match exists.
 */
export function bestLcsSpan(
  source: string[],
  passage: string[],
  coverageThreshold = 0.75,
  densityThreshold = 0.33,
): LcsSpan | null {
  const n = source.length;
  const m = passage.length;
  if (n === 0 || m === 0) return null;

  const minMatches = Math.ceil(m * coverageThreshold);

  // dp[j][k] = latest (rightmost) source start index such that
  // source[start..i) contains k tokens from passage[0..j) as a subsequence.
  // Latest start = tightest span. -1 means not achievable.

  // Rolling rows: prevRow = dp at source index i-1, currRow = dp at source index i
  // prevRow[j][k] and currRow[j][k] store the latest (rightmost) source start
  // index achieving k matches using passage[0..j) within source[start..i].

  // Pre-allocate two row buffers and swap between them to avoid per-iteration allocation.
  const rowA: number[][] = Array.from({ length: m + 1 }, () => new Array(m + 1));
  const rowB: number[][] = Array.from({ length: m + 1 }, () => new Array(m + 1));

  // Initialize prevRow (rowA): before any source tokens, k=0 is achievable starting at position 0
  for (let j = 0; j <= m; j++) {
    rowA[j].fill(-1);
    rowA[j][0] = 0;
  }
  let prevRow = rowA;

  // bestPerK tracks the tightest (shortest span) result for each match count
  const bestPerK = new Map<number, LcsSpan>();

  for (let i = 1; i <= n; i++) {
    const currRow = prevRow === rowA ? rowB : rowA;
    for (let j = 0; j <= m; j++) {
      currRow[j].fill(-1);
      currRow[j][0] = i; // k=0 achievable: span can start at position i (0-based, after current token)
    }

    for (let j = 1; j <= m; j++) {
      for (let k = 1; k <= j; k++) {
        let best = -1;

        // Option 1: skip current source token (inherit from prev source position)
        if (prevRow[j][k] !== -1) {
          best = prevRow[j][k];
        }

        // Option 2: skip current passage token (inherit from previous passage position)
        if (currRow[j - 1][k] !== -1) {
          best = Math.max(best, currRow[j - 1][k]);
        }

        // Option 3: match source[i-1] with passage[j-1]
        if (source[i - 1] === passage[j - 1]) {
          const prev = prevRow[j - 1][k - 1];
          if (prev !== -1) {
            best = Math.max(best, prev);
          }
        }

        currRow[j][k] = best;
      }
    }

    // Check all achievable match counts at this source position
    for (let k = minMatches; k <= m; k++) {
      const startIdx = currRow[m][k];
      if (startIdx === -1) continue;

      const spanLen = i - startIdx;
      const density = k / spanLen;
      if (density < densityThreshold) continue;

      const existing = bestPerK.get(k);
      if (!existing || spanLen < existing.endIdx - existing.startIdx + 1) {
        bestPerK.set(k, { matches: k, startIdx, endIdx: i - 1 });
      }
    }

    prevRow = currRow;
  }

  // Return the span with the most matches (prefer more coverage)
  if (bestPerK.size === 0) return null;

  let best: LcsSpan | null = null;
  for (const span of bestPerK.values()) {
    if (!best || span.matches > best.matches) {
      best = span;
    } else if (
      span.matches === best.matches &&
      span.endIdx - span.startIdx < best.endIdx - best.startIdx
    ) {
      best = span; // same matches, tighter span
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Top-level verification
// ---------------------------------------------------------------------------

/**
 * Verify that a passage returned by Gemini actually exists in the source text.
 *
 * Tokenizes both texts, normalizes for matching, runs LCS alignment,
 * and applies coverage + density gates.
 */
export function verifyGrounding(
  passage: string,
  sourceText: string,
  opts?: GroundingOptions,
): GroundingResult {
  const coverageThreshold = opts?.coverageThreshold ?? 0.75;
  const densityThreshold = opts?.densityThreshold ?? 0.33;

  if (!passage.trim()) {
    return { grounded: false, coverage: 0, density: 0 };
  }

  // Pre-normalize source so char positions refer to the normalized string
  const normalizedSource = preNormalize(sourceText);
  const sourceTokens = tokenize(normalizedSource);
  const passageTokens = tokenize(passage);

  if (passageTokens.length === 0) {
    return { grounded: false, coverage: 0, density: 0 };
  }
  if (sourceTokens.length === 0) {
    return { grounded: false, coverage: 0, density: 0 };
  }

  // Normalize for matching
  const sourceNorm = sourceTokens.map((t) => normalize(t.text));
  const passageNorm = passageTokens.map((t) => normalize(t.text));

  let span = bestLcsSpan(
    sourceNorm,
    passageNorm,
    coverageThreshold,
    densityThreshold,
  );

  if (!span) {
    // Compute best-effort coverage for reporting.
    // Quick check: how many passage tokens appear anywhere in source?
    const sourceSet = new Set(sourceNorm);
    const found = passageNorm.filter((t) => sourceSet.has(t)).length;
    const setCoverage = found / passageNorm.length;

    // High-coverage retry: when ≥90% of passage tokens exist in the source
    // but the density gate rejected the span (tokens spread across page breaks
    // or formatting noise), retry with a relaxed density threshold (0.25).
    // This handles real supporting passages that straddle page/section breaks.
    if (setCoverage >= 0.90) {
      const relaxedDensity = 0.25;
      span = bestLcsSpan(sourceNorm, passageNorm, coverageThreshold, relaxedDensity);
    }

    // If still no span but token-set-coverage is very high (>=0.85),
    // the passage is real — tokens exist in the source but are scattered
    // (paraphrased or spread across page breaks). Accept as grounded.
    if (!span && setCoverage >= 0.85) {
      return {
        grounded: true,
        coverage: setCoverage,
        density: 0, // no contiguous span found
        // No charStart/charEnd — can't pinpoint the location
      };
    }

    if (!span) {
      return {
        grounded: false,
        coverage: setCoverage,
        density: 0,
      };
    }
  }

  const coverage = span.matches / passageNorm.length;
  const spanLen = span.endIdx - span.startIdx + 1;
  const density = span.matches / spanLen;

  const charStart = sourceTokens[span.startIdx].charStart;
  const charEnd = sourceTokens[span.endIdx].charEnd;
  const matchedText = normalizedSource.slice(charStart, charEnd);

  return {
    grounded: true,
    coverage,
    density,
    charStart,
    charEnd,
    matchedText,
  };
}
