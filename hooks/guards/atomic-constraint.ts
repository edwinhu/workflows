// PostToolUse(Edit|Write): guard against monolithic constraint files.
//
// Two anti-patterns: a .md under references/ (not constraints/) that looks like bundled constraints,
// and a .md under constraints/ with 3+ ### rule headings. Non-blocking: context only.
//
// The heading count reproduces Python's `re.findall(r"^###\s+", content, re.MULTILINE)`: Python's
// `\s` is [ \t\n\r\f\v] and MULTILINE `^` matches only at start-of-string or after "\n"; JS's `\s`
// and `m` flag are both wider.
import type { Guard } from './core.ts'

/** len(re.findall(r"^###\s+", content, re.MULTILINE)) — Python semantics. */
function countH3(text: string): number {
  const re = /###[ \t\n\r\f\v]+/g
  let n = 0
  for (const m of text.matchAll(re)) {
    const i = m.index!
    if (i === 0 || text[i - 1] === '\n') n++
  }
  return n
}

export const atomicConstraintGuard: Guard = async (payload, io) => {
  const toolName = String(payload.tool_name ?? '')
  const toolInput = (payload.tool_input as Record<string, unknown>) ?? {}
  if (toolName !== 'Edit' && toolName !== 'Write') return {}

  const filePath = (toolInput.file_path ?? '') as string
  if (!filePath) return {}

  // Python pathlib: parts / name / stem / suffix.
  const parts = String(filePath)
    .split('/')
    .filter(p => p !== '' && p !== '.')
  const name = parts.length ? parts[parts.length - 1]! : ''
  const dot = name.lastIndexOf('.')
  const suffix = dot > 0 ? name.slice(dot) : ''
  const stem = suffix ? name.slice(0, -suffix.length) : name

  if (suffix.toLowerCase() !== '.md') return {}
  if (!parts.includes('references')) return {}

  const content = await io.read(String(filePath))
  if (content === null) return {}

  const messages: string[] = []
  const refIdx = parts.lastIndexOf('references')
  const inConstraintsDir = refIdx + 1 < parts.length && parts[refIdx + 1] === 'constraints'

  if (!inConstraintsDir) {
    const h3Count = countH3(content)
    if ((stem.endsWith('-constraints') || stem.endsWith('-conventions')) && h3Count >= 3) {
      messages.push(
        `MONOLITH DETECTED: ${name} has ${h3Count} sections and looks like bundled constraints. ` +
          `Split into individual .md files in constraints/ — one rule per file. ` +
          `See the atomic-constraints constraint for details.`,
      )
    }
  }

  if (inConstraintsDir) {
    const h3Count = countH3(content)
    // Allow the meta-constraint itself to have structure
    if (h3Count >= 3 && stem !== 'atomic-constraints') {
      messages.push(
        `POTENTIAL MONOLITH: ${name} has ${h3Count} ### headings. ` +
          `Each constraint file should contain ONE rule. ` +
          `If these headings describe different rules, split into separate files.`,
      )
    }
  }

  return messages.length ? { context: messages.join('\n') } : {}
}
