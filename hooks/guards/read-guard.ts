// PreToolUse(Read, Bash): block dumping a file larger than READ_GUARD_BYTES without a bound.
//
// The Bash parsing is conservative on purpose: a missed dump is acceptable; blocking a legitimate
// bounded command (head -n N<=2000, sed -n 'A,Bp' <=2000 lines, rg, grep -c, wc, jq with a filter,
// or a pipe into one of these) is not.
import type { Guard, GuardIO } from './core.ts'

async function fileSize(io: GuardIO, filePath: string): Promise<number> {
  const s = await io.stat(filePath)
  return s && s.kind === 'file' ? s.size : 0
}

const isBounded = (cmd: string): boolean => {
  if (/\brg\b/.test(cmd)) return true
  if (/\bgrep\s+-c\b/.test(cmd)) return true
  if (/\bwc\b/.test(cmd)) return true
  if (/\bjq\b.*\'.+\'/.test(cmd)) return true // jq with a filter
  if (/\bjq\b.*\".+\"/.test(cmd)) return true // jq with a filter
  if (/\bjq\s+\./.test(cmd)) return false // jq . dumps everything

  const headMatch = cmd.match(/\bhead\s+-n\s+(\d+)/)
  if (headMatch && parseInt(headMatch[1]!, 10) <= 2000) return true
  const headNMatch = cmd.match(/\bhead\s+-(\d+)/)
  if (headNMatch && parseInt(headNMatch[1]!, 10) <= 2000) return true
  const sedMatch = cmd.match(/\bsed\s+-n\s+[\'\"]?(\d+),(\d+)p/)
  if (sedMatch && parseInt(sedMatch[2]!, 10) - parseInt(sedMatch[1]!, 10) <= 2000) return true
  return false
}

const extractDumpFile = (cmd: string, limit: number): string | null => {
  const m1 = cmd.match(/\b(?:cat|less|more)\s+([^\s\|&;]+)/)
  if (m1 && !m1[1]!.startsWith('-')) return m1[1]!.replace(/['"]/g, '')
  const m2 = cmd.match(/\b(?:head|tail)\s+-c\s+(\d+)\s+([^\s\|&;]+)/)
  if (m2 && parseInt(m2[1]!, 10) > limit && !m2[2]!.startsWith('-')) return m2[2]!.replace(/['"]/g, '')
  const m3 = cmd.match(/\bpython\s+-c\s+.*open\(['"]([^'"]+)['"]\)\.read\(\)/)
  if (m3) return m3[1]!
  return null
}

const alternatives = (file: string): string =>
  `Dumping this whole file will blow out your context budget.\n` +
  `Alternatives:\n` +
  `- Use Read with offset and limit parameters\n` +
  `- Use \`rg -n <pattern> ${file}\` to locate what you need first\n` +
  `- Use \`sed -n 'A,Bp' ${file}\` to read a specific range of lines`

export const readGuard: Guard = async (payload, io) => {
  const toolName = String(payload?.tool_name ?? '')
  const toolInput = (payload?.tool_input ?? {}) as Record<string, unknown>

  const limit = parseInt(io.env('READ_GUARD_BYTES') ?? '262144', 10)
  if (limit === 0) return {}

  if (toolName === 'Read') {
    const filePath = (toolInput.file_path ?? '') as string
    if (!filePath) return {}
    const hasOffset = 'offset' in toolInput && toolInput.offset !== null && toolInput.offset !== undefined
    const hasLimit = 'limit' in toolInput && toolInput.limit !== null && toolInput.limit !== undefined
    if (!hasOffset && !hasLimit) {
      const size = await fileSize(io, filePath)
      if (size > limit) {
        return { deny: `File size (${size} bytes) exceeds READ_GUARD_BYTES (${limit}).\n\n` + alternatives(filePath) }
      }
    }
    return {}
  }

  if (toolName === 'Bash') {
    const command = (toolInput.command ?? '') as string
    if (!command) return {}
    if (isBounded(command)) return {}
    const dumpedFile = extractDumpFile(command, limit)
    if (dumpedFile) {
      const size = await fileSize(io, dumpedFile)
      if (size > limit) {
        return {
          deny:
            `Command attempts to dump file ${dumpedFile} (${size} bytes) which exceeds READ_GUARD_BYTES (${limit}).\n\n` +
            alternatives(dumpedFile),
        }
      }
    }
    return {}
  }

  return {}
}
