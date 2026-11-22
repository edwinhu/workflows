// PostToolUse(Edit|Write): a script that fetches EDGAR filings from sec.gov gets a pointer to the
// WRDS route. Reads the whole edited file, so an Edit elsewhere in a file that already has the URL
// still flags. Scripts only; prose never flags. Context only, no state.
import type { Guard } from './core.ts'

const SCRIPT_SUFFIXES = new Set(
  ('.py .pyw .ipynb .sh .bash .zsh .fish .r .rmd .qmd .jl .js .mjs .cjs .ts .tsx .mts .go .rs .rb ' +
    '.pl .sas .do .sql .java').split(' '),
)

// Built from pieces so this file's own text never matches it. `\\?` admits the regex-escaped spellings.
const FILING_URL = new RegExp(
  ['sec\\\\?\\.gov\\\\?/', 'Archives'].join('') + '|' + ['data\\\\?\\.sec\\\\?\\.gov\\\\?/', 'submissions'].join(''),
  'i',
)

/** Is this a script by suffix, or an extensionless file that starts with a shebang? */
function isScript(path: string, content: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  if (dot > 0) return SCRIPT_SUFFIXES.has(name.slice(dot).toLowerCase())
  return content.startsWith('#!')
}

export const edgarSourceGuard: Guard = async (payload, io) => {
  const tool = String(payload.tool_name ?? '')
  if (tool !== 'Edit' && tool !== 'Write') return {}
  const input = (payload.tool_input as Record<string, unknown>) ?? {}
  const path = input.file_path
  if (typeof path !== 'string' || path === '') return {}

  const content = await io.read(path)
  if (content === null || !isScript(path, content)) return {}

  const hits: number[] = []
  content.split('\n').forEach((line, i) => {
    if (FILING_URL.test(line)) hits.push(i + 1)
  })
  if (hits.length === 0) return {}

  const shown = hits.slice(0, 5).join(', ')
  const more = hits.length > 5 ? `, +${hits.length - 5} more` : ''
  return {
    context:
      `EDGAR SOURCE: ${path} has sec.gov filing URLs (line ${shown}${more}). ` +
      'Filing lists, text and exhibits come from WRDS: load the `workflows:edgar` skill before running or extending this. ' +
      'sec.gov is only for a single-filing spot check or filings newer than WRDS. Advisory; nothing was blocked.',
  }
}
