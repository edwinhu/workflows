/**
 * brief-style-lint — refuses a farm-out row whose prompt dictates chart styling.
 *
 * Styling belongs to the subagent's rules (A5 type system, A6 palette). A brief that names a font,
 * a hex colour or "an X-style look" outranks those rules in the child's context, and the child
 * follows the brief (nevada, 2026-10-11: ~20 figures). The brief says WHAT to show.
 *
 *   bun scripts/lib/brief-style-lint.ts --row '<json>'   # exit 0 clean, exit 2 refused (stderr)
 *
 * Applies to a row when its agent is `ds*` or its prompt mentions a chart (CHART_CONTEXT); a
 * prose or code row that says "serif" is not a chart brief.
 *
 * Text that is NOT scanned (blanked before matching, offsets preserved):
 *   - fenced ``` blocks and `>` blockquote lines (content the user supplied verbatim)
 *   - absolute/home/dot-relative paths (`/x/y`, `~/x`, `./x`) and any `name.ext` file token, so
 *     `ds-chart-type-system.md` and `/…/wsj_final/` never match
 *   - the span of the row's `userStyle`, when it is a non-empty string occurring verbatim in the
 *     prompt (the user's own style words; the override is auditable because it is a field on the row)
 *
 * What is flagged (each hit names the offending text):
 *   hex      #RGB / #RRGGBB / #RRGGBBAA (3-digit needs a letter, so "#123" is not one), rgb()/hsl()
 *   font     serif, sans-serif, sans serif, monospace(d), font-family, and named faces: Helvetica,
 *            Arial, Liberation Sans|Serif|Mono, Lora, Times New Roman, Calibri, Roboto, Verdana,
 *            Courier New, DejaVu, Garamond, Palatino, Futura, Gill Sans, Segoe, Open Sans, Lato,
 *            Fira Sans|Code|Mono, IBM Plex, Consolas, Tahoma, Trebuchet, Source Serif|Sans.
 *            Faces that are also places or papers (Georgia, Times, Courier, Inter, Menlo) are NOT
 *            flagged: a false positive on "New York Times" costs more than the miss.
 *   look     "<X>-style|style <chart word>" within 40 chars, "in the style of", "styled like|after",
 *            "<X> graphics|chart|figure look", "modelled on|after the … chart|graphic|figure"
 *   colour   a colour word directly before bars?|dots?|markers?|fills?|swatches?|palette|accent
 *
 * Known gaps, on purpose: a bare relative path without an extension ("scratch/a/b") is not exempt;
 * a negated mention ("do not choose fonts") is still flagged — reword; plain "font" is not flagged.
 */

const CHART_CONTEXT = /\b(chart|charts|figure|figures|plot|plots|graph|graphs|graphic|graphics|visuali[sz]\w*|dashboard|bars?|axis|axes|histogram|dumbbell|heatmap|infographic)\b/i

const FAMILIES = [
  'Helvetica', 'Arial', 'Liberation (?:Sans|Serif|Mono)', 'Lora', 'Times New Roman', 'Calibri', 'Roboto',
  'Verdana', 'Courier New', 'DejaVu', 'Garamond', 'Palatino', 'Futura', 'Gill Sans', 'Segoe',
  'Open Sans', 'Lato', 'Fira (?:Sans|Code|Mono)', 'IBM Plex', 'Consolas', 'Tahoma', 'Trebuchet',
  'Source (?:Serif|Sans)',
]
const COLOURS = 'red|green|blue|yellow|orange|purple|pink|teal|navy|crimson|amber|magenta|cyan|brown|grey|gray|black|gold|maroon|violet|olive'

export interface Hit { kind: 'hex' | 'font' | 'look' | 'colour'; text: string; index: number }

const RULES: { kind: Hit['kind']; re: RegExp; keep?: (m: RegExpExecArray) => boolean }[] = [
  { kind: 'hex', re: /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w])/g,
    keep: m => m[0].length >= 7 || /[a-fA-F]/.test(m[0]) },
  { kind: 'hex', re: /\b(?:rgba?|hsla?)\(\s*[\d.%\s,]+\)/gi },
  { kind: 'font', re: /\b(?:sans[- ]serif|serif|monospaced?|font-family|fontfamily)\b/gi },
  { kind: 'font', re: new RegExp(`\\b(?:${FAMILIES.join('|')})\\b`, 'g') },
  { kind: 'look', re: /\b[\w&]+[- ]style\b(?=[^.\n]{0,40}\b(?:chart|charts|graphic|graphics|figure|figures|plot|plots|look|colou?rs?|palette|visual|visuals|bars?|aesthetic|theme)\b)/gi },
  { kind: 'look', re: /\bin the style of\b|\bstyled (?:like|after)\b|\b[\w&]+ (?:graphics?|charts?|figures?) look\b|\bmodell?ed (?:on|after) the\b[^.\n]{0,80}\b(?:chart|graphic|figure)\b/gi },
  { kind: 'colour', re: new RegExp(`\\b(?:${COLOURS})\\s+(?:bars?|dots?|markers?|fills?|swatch(?:es)?|palette|accent)\\b`, 'gi') },
]

function blank(s: string, a: number, b: number): string {
  return s.slice(0, a) + s.slice(a, b).replace(/[^\n]/g, ' ') + s.slice(b)
}

/** Replace every exempt region with spaces, keeping offsets so hits index the original text. */
export function exempt(prompt: string, userStyle?: unknown): string {
  let s = prompt
  const blankAll = (re: RegExp) => { for (const m of [...s.matchAll(re)]) s = blank(s, m.index!, m.index! + m[0].length) }
  blankAll(/```[\s\S]*?(?:```|$)/g)
  blankAll(/^[ \t]*>.*$/gm)
  blankAll(/(?<=^|[\s(`])(?:~|\.{1,2})?(?:\/[\w.\-~@+#%=:,]+)+\/?/gm)
  blankAll(/(?<![\w])[\w.\-]+\.(?:md|py|R|r|qmd|ipynb|csv|tsv|json|jsonl|parquet|svg|png|pdf|ts|js|txt|mplstyle|typ|yaml|yml|toml|sh)\b/g)
  if (typeof userStyle === 'string' && userStyle.trim()) {
    const at = prompt.indexOf(userStyle)
    if (at >= 0) s = blank(s, at, at + userStyle.length)
  }
  return s
}

export function applies(row: { prompt?: unknown; agent?: unknown }): boolean {
  const agent = typeof row.agent === 'string' ? row.agent : ''
  return /^ds(-|$)/.test(agent) || (typeof row.prompt === 'string' && CHART_CONTEXT.test(row.prompt))
}

export function lintBrief(row: { prompt?: unknown; agent?: unknown; userStyle?: unknown }): Hit[] {
  if (typeof row.prompt !== 'string' || !applies(row)) return []
  const text = exempt(row.prompt, row.userStyle)
  const hits: Hit[] = []
  for (const { kind, re, keep } of RULES) {
    for (const m of text.matchAll(re)) {
      if (keep && !keep(m as RegExpExecArray)) continue
      hits.push({ kind, text: m[0], index: m.index! })
    }
  }
  return hits.sort((a, b) => a.index - b.index)
}

export function refusal(hits: Hit[]): string {
  const shown = hits.slice(0, 8).map(h => `  ${h.kind}: "${h.text}"`).join('\n')
  const more = hits.length > 8 ? `\n  … and ${hits.length - 8} more` : ''
  return `the brief dictates chart styling:\n${shown}${more}\n` +
    'Styling (fonts, colours, "X-style look") belongs to the subagent\'s rules (ds-rules A5/A6), not the brief: ' +
    'say what to show, not how it looks. If the USER specified the style, set the row field ' +
    '"userStyle" to their verbatim words (they must appear in the prompt).'
}

if (import.meta.main) {
  const i = process.argv.indexOf('--row')
  if (i < 0 || !process.argv[i + 1]) { console.error('usage: brief-style-lint.ts --row <json>'); process.exit(2) }
  let row: any
  try { row = JSON.parse(process.argv[i + 1]) } catch (e) { console.error(`--row is not JSON: ${e}`); process.exit(2) }
  if (row && row.userStyle !== undefined && (typeof row.userStyle !== 'string' || !row.userStyle.trim() || !String(row.prompt).includes(row.userStyle))) {
    console.error('"userStyle" must be a non-empty string that appears verbatim in the prompt'); process.exit(2)
  }
  const hits = lintBrief(row ?? {})
  if (hits.length) { console.error(refusal(hits)); process.exit(2) }
  if (typeof row?.userStyle === 'string') console.error(`brief-style-lint: userStyle override accepted: ${JSON.stringify(row.userStyle.slice(0, 200))}`)
}
