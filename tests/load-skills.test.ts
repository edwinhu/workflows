// An agent launched as the MAIN thread (a farm row, `claude --agent`) gets its rules only from its
// initialPrompt, and the writing registers are not user-invocable, so the prose-rules-* skills bang
// them in through scripts/load-skills.ts. A bang's output past BASH_MAX_OUTPUT_LENGTH (default
// 30,000 chars in 2.1.287) is saved to a file with a 2 KB preview, so every bang must stay under it.
import { test, expect } from 'bun:test'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { renderSkill } from '../scripts/load-skills.ts'
import { useTmp } from './helpers/tmp.ts'

const mkTmp = useTmp()
const ROOT = join(import.meta.dir, '..')
const BANG_CAP = 30_000
const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 30_000, cwd: ROOT })
const fm = (f: string) => Bun.YAML.parse(readFileSync(f, 'utf8').split('\n---\n')[0].replace(/^---\n/, '')) as any

/** Every skill named by a load-skills.ts bang in one SKILL.md. */
const bangNames = (f: string) => readFileSync(f, 'utf8').split('\n').filter(l => l.includes('load-skills.ts'))
  .flatMap(l => (/exec bun \S+ ([^;`]+);/.exec(l)?.[1] ?? '').trim().split(/\s+/))

test('each writing agent\'s initialPrompt skill loads its whole skills: preload, one bang per register', () => {
  const agents = readdirSync(join(ROOT, 'user-agents')).filter(f => /^writing.*\.md$/.test(f))
  expect(agents.length).toBe(4)
  for (const a of agents) {
    const meta = fm(join(ROOT, 'user-agents', a))
    const cmd = /^\/(\S+)$/.exec(meta.initialPrompt ?? '')?.[1]
    expect([a, cmd]).toEqual([a, expect.stringMatching(/^prose-rules/)])
    const skill = join(ROOT, 'skills', cmd!, 'SKILL.md')
    expect(fm(skill)['user-invocable']).not.toBe(false)
    const names = bangNames(skill)
    expect([a, [...names].sort()]).toEqual([a, [...meta.skills].sort()])
    // One register per bang, so no single bang carries two registers toward the cap.
    expect(readFileSync(skill, 'utf8').split('\n').filter(l => l.includes('load-skills.ts')).length).toBe(names.length)
  }
})

test('every bang output a main-thread rule skill renders stays under the inline cap', () => {
  const sizes: Record<string, number> = {}
  for (const s of ['writing-general', 'writing-legal', 'writing-econ', 'ai-anti-patterns']) {
    const r = run('bun', ['scripts/load-skills.ts', s])
    expect(r.status).toBe(0)
    sizes[s] = r.stdout.length
  }
  const ds = run('scripts/load-constraints', ['ds', '--digest'])
  expect(ds.status).toBe(0)
  sizes['ds --digest'] = ds.stdout.length
  for (const [k, n] of Object.entries(sizes)) expect([k, n < BANG_CAP]).toEqual([k, true])
})

test('a rendered skill is the file itself: frontmatter gone, variables substituted, bangs run', () => {
  const dir = join(mkTmp('load-skills-'), 'skills', 'x')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: x\n---\n\n# x\n\nsee ${CLAUDE_SKILL_DIR}/r.md\n!`echo ran-$((1+1))`\nend\n')
  const out = renderSkill(join(dir, 'SKILL.md'))
  expect(out).not.toContain('name: x')
  expect(out).toContain(`see ${dir}/r.md`)
  expect(out).toContain('\nran-2\nend')
})

test('a missing skill is exit 2 and loads nothing, never a partial stack', () => {
  const r = run('bun', ['scripts/load-skills.ts', 'writing-general', 'no-such-skill'])
  expect(r.status).toBe(2)
  expect(r.stdout).toBe('')
  expect(r.stderr).toContain('NO skill was loaded')
})
