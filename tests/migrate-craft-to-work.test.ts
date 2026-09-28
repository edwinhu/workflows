import { beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT = join(import.meta.dir, '..', 'scripts', 'migrate-craft-to-work.sh')

const MARKER = '<!-- craft:dispatch\n{"tasks":[]}\n-->\n'

function write(root: string, rel: string, body = MARKER) {
  const p = join(root, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, body)
  return p
}

function run(root: string, apply = false) {
  const r = spawnSync('bash', apply ? [SCRIPT, '--apply', root] : [SCRIPT, root], {
    encoding: 'utf8',
  })
  return { out: (r.stdout ?? '') + (r.stderr ?? ''), status: r.status }
}

/** Skipped count for one reason, parsed out of the dry-run summary. */
function skipped(out: string, reason: string): number {
  const m = out.match(new RegExp(`^\\s+${reason}\\s+(\\d+)$`, 'm'))
  if (!m) throw new Error(`no skip line for ${reason} in:\n${out}`)
  return Number(m[1])
}

function marker(p: string): 'craft' | 'work' {
  return readFileSync(p, 'utf8').includes('craft:dispatch') ? 'craft' : 'work'
}

describe('migrate-craft-to-work.sh scope', () => {
  let root: string
  let paths: Record<string, string>
  let dry: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'migratescope-'))
    paths = {
      // The one shape that IS a plan and IS rewritten, in both plan directories.
      plan: write(root, 'proj/.claude/plans/tail-shapes.md'),
      planning: write(root, 'proj/.planning/htmltable-layout.md'),
      // One skip per rule.
      worktree: write(root, 'proj/.claude/worktrees/other-branch/.claude/plans/live.md'),
      changelog: write(root, 'proj/CHANGELOG.md'),
      readme: write(root, 'proj/README.md'),
      philosophy: write(root, 'proj/PHILOSOPHY.md'),
      docs: write(root, 'proj/docs/DESIGN-spine.md'),
      skills: write(root, 'proj/skills/work/SKILL.md'),
      notAPlan: write(root, 'proj/notes/stray.md'),
    }
    // A pre-rename checkout: a git dir plus the old dispatcher. Its plan must be left alone.
    mkdirSync(join(root, 'oldrepo', '.git'), { recursive: true })
    write(root, 'oldrepo/skills/craft/scripts/craft-dispatch.sh', '#!/bin/bash\n')
    paths.preRename = write(root, 'oldrepo/.claude/plans/in-flight.md')
    dry = run(root).out
  })

  test('dry run rewrites nothing', () => {
    for (const p of Object.values(paths)) expect(marker(p)).toBe('craft')
  })

  test('dry run names only the two real plan files', () => {
    expect(dry).toContain(paths.plan)
    expect(dry).toContain(paths.planning)
    expect(dry).toContain('DRY RUN: 2 file(s) would be rewritten')
  })

  test('dry run counts each skip reason', () => {
    expect(skipped(dry, 'worktree')).toBe(1)
    expect(skipped(dry, 'changelog')).toBe(1)
    expect(skipped(dry, 'readme')).toBe(1)
    expect(skipped(dry, 'philosophy')).toBe(1)
    expect(skipped(dry, 'docs')).toBe(1)
    expect(skipped(dry, 'skills')).toBe(1)
    expect(skipped(dry, 'not-a-plan-file')).toBe(1)
    expect(skipped(dry, 'pre-rename-checkout')).toBe(1)
    expect(dry).toContain('skipped 8 file(s) by reason:')
  })

  test('--apply rewrites the plans and nothing else', () => {
    const { out } = run(root, true)
    expect(out).toContain('applied: 2 file(s) rewritten; 8 skipped.')
    expect(marker(paths.plan)).toBe('work')
    expect(marker(paths.planning)).toBe('work')
    for (const key of [
      'worktree',
      'changelog',
      'readme',
      'philosophy',
      'docs',
      'skills',
      'notAPlan',
      'preRename',
    ]) {
      expect(marker(paths[key])).toBe('craft')
    }
  })

  test('a second pass rewrites nothing and still reports the skips', () => {
    const { out, status } = run(root)
    expect(status).toBe(0)
    expect(out).toContain('DRY RUN: 0 file(s) would be rewritten')
    expect(out).toContain('skipped 8 file(s) by reason:')
  })
})

describe('migrate-craft-to-work.sh guardrails', () => {
  test('refuses with no root', () => {
    const r = spawnSync('bash', [SCRIPT], { encoding: 'utf8' })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('at least one root directory is required')
  })

  test('.craft run directories are never candidates', () => {
    const root = mkdtempSync(join(tmpdir(), 'migraterun-'))
    const run1 = write(root, 'proj/.craft/run-1/plan-copy.md')
    const plan = write(root, 'proj/.planning/real.md')
    const { out } = run(root, true)
    expect(out).toContain('applied: 1 file(s) rewritten')
    expect(marker(run1)).toBe('craft')
    expect(marker(plan)).toBe('work')
  })
})
