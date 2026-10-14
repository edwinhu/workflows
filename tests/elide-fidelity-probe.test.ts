import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const SKILL = readFileSync(join(ROOT, 'skills/elide-case/SKILL.md'), 'utf8')

// The fidelity probe reads a .docx, which Read cannot open: its prompt must name the projection
// command, and that script must exist.
describe('elide-case fidelity probe', () => {
  const prompt = SKILL.split('\n').find(l => l.includes('Verbatim matching cannot see misrepresentation')) ?? ''

  test('the prompt names an existing docx-projection script', () => {
    const m = prompt.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/(\S+?\.py)/)
    expect(m).not.toBeNull()
    expect(existsSync(join(ROOT, m![1]))).toBe(true)
    expect(m![1]).toContain('westlaw-docx-text.py')
  })

  test('the probe agent type can run Bash (Explore holds every tool but the write ones)', () => {
    const seg = SKILL.slice(SKILL.indexOf('key: "fidelity"'))
    expect(seg.slice(0, seg.indexOf('prompt:'))).toContain('agentType: "Explore"')
  })
})
