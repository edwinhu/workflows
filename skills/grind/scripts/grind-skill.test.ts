/**
 * skills/grind/SKILL.md — the doctrine, and the guarantee that it describes the script that exists.
 *
 * Two classes of defect this pins, both of which have bitten this plugin before:
 *
 *  1. A SKILL.md missing the `skill-toc` bang line. sc-probe invariant S1 requires it of EVERY
 *     skill, unconditionally — `skill-toc` prints "(this skill carries no references/ or scripts/)"
 *     and exits 0 for a skill with neither, so there is no skill for which the line is wrong.
 *  2. Documentation that drifts from the script. A skill whose examples name a subcommand the
 *     script does not dispatch on is worse than no documentation, because a reader trusts it. The
 *     check runs in BOTH directions: nothing documented that does not exist, nothing existing that
 *     is not documented.
 *
 * Run: bun test /home/eh/projects/workflows/skills/grind/scripts/grind-skill.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const SKILL_DIR = resolve(import.meta.dir, '..')
const SKILL_MD = join(SKILL_DIR, 'SKILL.md')
const GRIND = join(SKILL_DIR, 'scripts', 'grind.sh')
const HOUND_MD = resolve(import.meta.dir, '..', '..', 'hound', 'SKILL.md')

const body = () => readFileSync(SKILL_MD, 'utf8')

/** The `!`-prefixed TOC line, which must be byte-identical across every skill in the plugin. */
function tocBang(md: string): string | undefined {
  const lines = md.split('\n')
  const i = lines.findIndex(l => l.includes('What this skill carries'))
  return i >= 0 ? lines.slice(i + 1).find(l => l.startsWith('!')) : undefined
}

/** Subcommands the script itself dispatches on, taken from its own usage output. */
function implementedSubcommands(): string[] {
  const r = spawnSync('bash', [GRIND], { encoding: 'utf8', timeout: 30_000 })
  const usage = `${r.stdout}${r.stderr}`
  return ['run', 'append', 'floors', 'status', 'tail', 'stop'].filter(s =>
    new RegExp(`(^|\\s)${s}(\\s|$)`, 'm').test(usage),
  )
}

/** Subcommands the documentation shows, from every `grind.sh <word>` it prints. */
function documentedSubcommands(md: string): string[] {
  const found = new Set<string>()
  for (const m of md.matchAll(/grind\.sh\s+([a-z][a-z-]*)/g)) found.add(m[1])
  return [...found]
}

describe('skills/grind/SKILL.md', () => {
  test('exists', () => {
    expect(existsSync(SKILL_MD)).toBe(true)
  })

  test('frontmatter carries name, description and allowed-tools', () => {
    const md = body()
    expect(md.startsWith('---\n')).toBe(true)
    const fm = md.slice(4, md.indexOf('\n---', 4))
    expect(fm).toMatch(/^name:\s*grind\s*$/m)
    expect(fm).toMatch(/^description:\s*\S/m)
    expect(fm).toMatch(/^allowed-tools:\s*\[/m)
  })

  test('description routes away from the skills grind is not', () => {
    const md = body()
    const fm = md.slice(4, md.indexOf('\n---', 4))
    // hound holds a live session open; grind exists so that no session lives at all. A reader who
    // cannot tell them apart reaches for the wrong one.
    expect(fm).toContain('NEGATIVE ROUTING')
    expect(fm).toMatch(/hound/)
  })

  test('carries the skill-toc bang line, byte-identical to the one in hound', () => {
    const ours = tocBang(body())
    const theirs = tocBang(readFileSync(HOUND_MD, 'utf8'))
    expect(theirs).toBeDefined()
    expect(ours).toBe(theirs)
  })

  test('every script path it names exists and is executable', () => {
    const md = body()
    const paths = new Set<string>()
    for (const m of md.matchAll(/(?:^|[\s`(])((?:scripts|\.\/scripts)\/[A-Za-z0-9._-]+)/g)) {
      paths.add(m[1].replace(/^\.\//, ''))
    }
    expect(paths.size).toBeGreaterThan(0)
    for (const p of paths) {
      const abs = join(SKILL_DIR, p)
      expect(existsSync(abs)).toBe(true)
      expect(statSync(abs).mode & 0o111).toBeGreaterThan(0)
    }
  })

  test('documents exactly the subcommands the script dispatches on', () => {
    const documented = documentedSubcommands(body()).sort()
    const implemented = implementedSubcommands().sort()
    expect(implemented.length).toBeGreaterThan(0)
    // Both directions: no example naming a subcommand that does not exist, and no subcommand
    // shipped without being documented.
    expect(documented).toEqual(implemented)
  })

  test('covers the three rules that make an amnesiac loop safe', () => {
    const md = body().toLowerCase()
    expect(md).toContain('floor')
    expect(md).toContain('gate')
    expect(md).toContain('journal')
  })

  test('documents which record kinds the agent may write and which the loop owns', () => {
    // Round 1 shipped an `append` that accepted any kind, so an agent could write `stop` or `done`
    // and end or misreport the run. The code now refuses loop-owned kinds — and a rule an agent
    // cannot read is a rule it will break, because every iteration reconstructs the record shape
    // from its prompt and this file.
    const md = body()
    for (const agentKind of ['progress', 'floor', 'attempt', 'note']) {
      expect(md).toContain(agentKind)
    }
    for (const loopKind of ['stop', 'done']) {
      expect(md).toContain(loopKind)
    }
    // Documenting WHO writes each kind is not the same as saying the split is ENFORCED. A reader
    // who is told only "the loop writes done" may still try to write one; a reader told the append
    // subcommand refuses it will not. The sentence has to exist, because the code now behaves that
    // way and an undocumented refusal reads as a bug to the next agent that hits it.
    const enforcement = md
      .split(/(?<=[.!?])\s+|\n/)
      .filter(s => /\bappend\b/i.test(s) && /\brefus|\breject/i.test(s))
    expect(
      enforcement.some(s => /reserved|loop-owned|loop's own|only the loop|kind/i.test(s)),
      'SKILL.md must state that the append subcommand refuses loop-owned kinds',
    ).toBe(true)
  })

  test('states the limit of the stop guard rather than implying a guarantee', () => {
    // The guard refuses the stop subcommand from inside an iteration, which stops the good-faith
    // mistake. It cannot stop an iteration that kills the pid it read out of the journal, because
    // an iteration runs bash. A reader who is not told the boundary will assume the stronger claim,
    // and will trust the loop with work it should not be trusted with.
    const md = body()
    // The claim: the stop subcommand is refused when an iteration runs it.
    expect(
      /refus\w*[^.]{0,120}\bfrom inside an iteration\b/i.test(md) ||
        /\bfrom inside an iteration\b[^.]{0,120}refus\w*/i.test(md),
      'SKILL.md must state that the stop subcommand is refused from inside an iteration',
    ).toBe(true)
    // The limit: an iteration runs bash, so it can always kill the process. Saying only the first
    // half sells a guard as a guarantee.
    expect(
      /\bkill\b/i.test(md),
      'SKILL.md must state the limit — an iteration can still kill the process',
    ).toBe(true)
  })

  test('documents that a floor record is refused without a key', () => {
    // A floor accepted and then silently dropped is the defect that makes a loop never converge.
    const md = body().toLowerCase()
    const floorPara = md.split(/\n\s*\n/).filter(p => p.includes('floor')).join('\n')
    expect(floorPara).toContain('key')
  })

  test('never writes a live bang in prose', () => {
    // A bang outside an inline code span aborts the skill load. A fenced block does NOT protect it;
    // only an inline code span does. The TOC bang is the one sanctioned exception.
    const lines = body().split('\n')
    const toc = tocBang(body())
    for (const [n, line] of lines.entries()) {
      if (line === toc) continue
      if (line.startsWith('!')) throw new Error(`live bang in prose at line ${n + 1}: ${line}`)
    }
    expect(true).toBe(true)
  })
})
