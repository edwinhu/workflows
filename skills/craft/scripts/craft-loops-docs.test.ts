/**
 * The documentation contract for --loops, made decidable.
 *
 * Two rules, both computed rather than judged — an open-ended prose review of a doc does not
 * terminate, so what is asserted here is only what a grep can settle:
 *
 *   1. Every long flag craft-dispatch.sh's argument parser ACCEPTS is named in its own usage header.
 *      This is the rule that catches the real drift: a flag added to the `case` and never written
 *      down is invisible to every future reader, including the model reading the header to learn
 *      the interface.
 *   2. SKILL.md documents the flag and the exit codes the driver returns — and grows by less than
 *      25 lines doing it, because SKILL.md is re-read into context on EVERY craft invocation, so a
 *      line there is a recurring token cost, not a one-time one.
 *
 * Run: bun test /home/eh/projects/workflows/skills/craft/scripts/craft-loops-docs.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DISPATCH = join(import.meta.dir, 'craft-dispatch.sh')
const SKILL_MD = join(import.meta.dir, '..', 'SKILL.md')
const REPO = join(import.meta.dir, '..', '..', '..')

const dispatchSrc = () => readFileSync(DISPATCH, 'utf8')

/** The header block: everything before `set -uo pipefail`, which is where the usage lives. */
function usageHeader(src: string): string {
  const i = src.indexOf('set -uo pipefail')
  return i === -1 ? src : src.slice(0, i)
}

/**
 * The long flags the argument parser actually accepts, read off the `--foo)` case arms in the
 * option loop. `--*)` (the unknown-flag catch-all) and `--dispatch` (which exists only to REJECT a
 * flag by name) are not part of the interface.
 */
function acceptedFlags(src: string): string[] {
  const flags = new Set<string>()
  for (const m of src.matchAll(/^\s*(--[a-z][a-z-]*)\)/gm)) flags.add(m[1])
  flags.delete('--dispatch')
  return [...flags].sort()
}

describe('the script documents its own interface', () => {
  test('--loops is an accepted flag', () => {
    expect(acceptedFlags(dispatchSrc())).toContain('--loops')
  })

  test('every accepted long flag is named in the usage header — no flag ships undocumented', () => {
    const src = dispatchSrc()
    const header = usageHeader(src)
    const undocumented = acceptedFlags(src).filter(f => !header.includes(f))
    expect(undocumented).toEqual([])
  })
})

describe('SKILL.md carries the rule, and only the rule', () => {
  test('the flag, its default and its zero case are documented', () => {
    const md = readFileSync(SKILL_MD, 'utf8')
    expect(md).toContain('--loops')
    expect(md).toMatch(/maxRounds/)
    expect(md).toMatch(/--loops 0/)
  })

  test('every exit code the driver can return is documented', () => {
    const md = readFileSync(SKILL_MD, 'utf8')
    // 0 pass, 1 died with no verdict, 2 refused, 5 not converging, 6 cap reached, 7 escalated.
    for (const code of [1, 2, 5, 6, 7]) expect(md).toMatch(new RegExp(`exit ${code}\\b`))
  })

  test('SKILL.md grew by fewer than 25 lines — it is re-read into context on every invocation', () => {
    const head = execFileSync('git', ['show', 'HEAD:skills/craft/SKILL.md'], { encoding: 'utf8', cwd: REPO })
    const now = readFileSync(SKILL_MD, 'utf8')
    const growth = now.split('\n').length - head.split('\n').length
    expect(growth).toBeLessThan(25)
  })
})
