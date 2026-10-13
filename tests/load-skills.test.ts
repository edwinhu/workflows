// An agent launched as the MAIN thread (a farm row, `claude --agent`) gets its rules only from its
// initialPrompt, and the writing registers are not user-invocable, so the prose-rules-* skills bang
// them in through scripts/load-skills.ts. A bang's output past BASH_MAX_OUTPUT_LENGTH (default
// 30,000 chars in 2.1.287) is saved to a file with a 2 KB preview, so every bang must stay under it.
import { test, expect } from 'bun:test'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { renderSkill, bangLoaderNames } from '../scripts/load-skills.ts'
import { useTmp } from './helpers/tmp.ts'

const mkTmp = useTmp()
const ROOT = join(import.meta.dir, '..')
const BANG_CAP = 30_000
const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 30_000, cwd: ROOT })
const fm = (f: string) => Bun.YAML.parse(readFileSync(f, 'utf8').split('\n---\n')[0].replace(/^---\n/, '')) as any

/** Every skill named by a load-skills.ts bang in one SKILL.md. */
const bangNames = (f: string) => bangLoaderNames(readFileSync(f, 'utf8'))

const REGISTERS: Record<string, string[]> = {
  'writing.md': ['writing-general', 'ai-anti-patterns'],
  'writing-legal.md': ['writing-general', 'writing-legal', 'ai-anti-patterns'],
  'writing-econ.md': ['writing-general', 'writing-econ', 'ai-anti-patterns'],
  'writing-reviewer.md': ['writing-general', 'writing-legal', 'writing-econ', 'ai-anti-patterns'],
}

test('each writing agent\'s one rules skill (skills: and initialPrompt:) bangs every register, one per bang', () => {
  const agents = readdirSync(join(ROOT, 'user-agents')).filter(f => /^writing.*\.md$/.test(f))
  expect(agents.length).toBe(4)
  for (const a of agents) {
    const meta = fm(join(ROOT, 'user-agents', a))
    const cmd = /^\/(\S+)$/.exec(meta.initialPrompt ?? '')?.[1]
    expect([a, cmd]).toEqual([a, expect.stringMatching(/^prose-rules/)])
    const skill = join(ROOT, 'skills', cmd!, 'SKILL.md')
    expect(fm(skill)['user-invocable']).not.toBe(false)
    const names = bangNames(skill)
    expect([a, meta.skills]).toEqual([a, [cmd]])
    expect([a, [...names].sort()]).toEqual([a, [...REGISTERS[a]].sort()])
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
}, 150_000)

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
}, 30_000)

test('a nested bang that exits non-zero is named loudly in the output and the CLI exits 1 after printing everything', () => {
  const root = mkTmp('load-skills-fail-')
  const mk = (n: string, body: string) => {
    mkdirSync(join(root, 'skills', n), { recursive: true })
    writeFileSync(join(root, 'skills', n, 'SKILL.md'), `---\nname: ${n}\n---\n\n${body}\n`)
  }
  mk('bad', '# bad\n!`echo partial; echo boom-on-stderr >&2; exit 2`\nafter')
  mk('good', '# good\nfine')
  const out = renderSkill(join(root, 'skills', 'bad', 'SKILL.md'))
  expect(out).toContain('(load-skills: bad bang failed, status 2: boom-on-stderr')
  expect(out).toContain('NOT in your context')
  expect(out).toContain('after')
  // The CLI: run against a copy of the loader rooted at the fixture so `bad` resolves as this plugin's skill.
  mkdirSync(join(root, 'scripts'), { recursive: true })
  mkdirSync(join(root, '.claude-plugin'), { recursive: true })
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), '{"name":"fx"}')
  writeFileSync(join(root, 'scripts', 'load-skills.ts'), readFileSync(join(ROOT, 'scripts', 'load-skills.ts'), 'utf8'))
  const r = spawnSync('bun', [join(root, 'scripts', 'load-skills.ts'), 'bad', 'good'], { encoding: 'utf8', timeout: 30_000, cwd: root })
  expect(r.status).toBe(1)
  expect(r.stdout).toContain('# Skill: good')
  expect(r.stdout).toContain('bang failed, status 2')
}, 60_000)

test('bangLoaderNames reads loader names from executable bang lines only', () => {
  const real = '!`c=$X/load-skills.ts; [ -f "$c" ] && exec bun "$c" a b:c; echo no`'
  const text = ['prose load-skills.ts exec bun x y;', 'e.g. `!`exec bun load-skills.ts z;``', real].join('\n')
  expect(bangLoaderNames(text)).toEqual(['a', 'b:c'])
})

test('the writing-reviewer has Read but no Skill or Bash, so its fallback says Read a path, never invoke', () => {
  const agent = readFileSync(join(ROOT, 'user-agents', 'writing-reviewer.md'), 'utf8')
  expect(fm(join(ROOT, 'user-agents', 'writing-reviewer.md')).tools).not.toMatch(/\b(Skill|Bash)\b/)
  expect(agent).toContain('~/.claude/skills/workflows/skills/<name>/SKILL.md')
  expect(agent).not.toContain('no file to `Read`')
  const wrapper = readFileSync(join(ROOT, 'skills', 'prose-rules-review', 'SKILL.md'), 'utf8')
  expect(wrapper).not.toMatch(/; invoke the/)
  expect(wrapper.match(/Read ~\/\.claude\/skills\/workflows\/skills\/[\w-]+\/SKILL\.md/g)?.length).toBe(4)
})
