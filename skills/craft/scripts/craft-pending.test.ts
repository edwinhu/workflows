/**
 * "Is a craft run armed but undispatched?" — the question main-thread-guard.sh holds every Edit,
 * Write and delegation on.
 *
 * The run dir does not have to live under the same root as the plan file. A dispatch block may name
 * a `projectDir` elsewhere, which is correct when the deliverable is a NEW repo that did not exist
 * at plan time; craft-dispatch.sh writes .craft/<runId>/ there. Searching only the plan's root then
 * found no args.json and reported a RUNNING run as undispatched forever, blocking every turn-end
 * with "the verdict is owed" and inviting a SECOND concurrent dispatch of the same plan.
 *
 * The asymmetry these pin down: a missing, malformed or projectDir-less block must read as ARMED,
 * never as dispatched. The guard swallows this script's stderr, so a crash disarms it silently —
 * every negative here is therefore also a check that the script ran at all.
 *
 * Run: bun test ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/craft-pending.test.ts
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPTS = import.meta.dir
const PENDING = join(SCRIPTS, 'craft-pending.sh')
const DISPATCH = join(SCRIPTS, 'craft-dispatch.sh')

const TMP = mkdtempSync(join(tmpdir(), 'craft-pending-test-'))
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

const EMPTY_HOME = join(TMP, 'empty-home')
mkdirSync(EMPTY_HOME, { recursive: true })

/**
 * A project root carrying one plan whose dispatch block is `block` (raw text, so it may be junk).
 * `plansDir` is where plan mode wrote it, project-root-relative; the default is the default.
 */
function plantPlan(name: string, block: string, plansDir = '.claude/plans'): string {
  const root = join(TMP, name)
  mkdirSync(join(root, plansDir), { recursive: true })
  writeFileSync(join(root, plansDir, 'p.md'), `# ${name}\n\n<!-- craft:dispatch ${block} -->\n`)
  return root
}

/** Declare `plansDirectory` in one of `root`'s settings tiers. */
function setPlansDirectory(root: string, value: string, file = 'settings.json') {
  mkdirSync(join(root, '.claude'), { recursive: true })
  writeFileSync(join(root, '.claude', file), JSON.stringify({ plansDirectory: value }))
}

function specHash(root: string, plansDir = '.claude/plans'): string {
  return execFileSync('bash', [DISPATCH, '--spec-hash', join(root, plansDir, 'p.md')], {
    encoding: 'utf8',
  }).trim()
}

/** Record a dispatch of `hash` in `<dir>/.craft/<runId>/args.json`, as craft-dispatch.sh would. */
function recordDispatch(dir: string, runId: string, hash: string) {
  mkdirSync(join(dir, '.craft', runId), { recursive: true })
  writeFileSync(join(dir, '.craft', runId, 'args.json'), JSON.stringify({ specHash: hash }))
}

/**
 * The guard's own read of this script: the plan path, or '' for "nothing pending".
 * HOME points at an empty dir so the developer's own user-tier `plansDirectory` cannot decide
 * these cases — the script reads three settings tiers now, and one of them is `$HOME`.
 */
function pending(root: string): string {
  const r = Bun.spawnSync(['bash', PENDING, root], { env: { ...process.env, HOME: EMPTY_HOME } })
  return new TextDecoder().decode(r.stdout).split('\t')[0].trim()
}

describe('craft-pending: a run dispatched under a DIFFERENT projectDir', () => {
  test('is not pending — the false positive that blocked every turn-end', () => {
    const elsewhere = join(TMP, 'elsewhere-split')
    mkdirSync(elsewhere, { recursive: true })
    const root = plantPlan(
      'split',
      JSON.stringify({ runId: 'r', args: { projectDir: elsewhere, goal: 'g' } }),
    )
    recordDispatch(elsewhere, 'r', specHash(root))
    expect(pending(root)).toBe('')
  })

  test('is still pending when nothing was dispatched there — the guard is the point', () => {
    const elsewhere = join(TMP, 'elsewhere-armed')
    mkdirSync(elsewhere, { recursive: true })
    const root = plantPlan(
      'armed',
      JSON.stringify({ runId: 'r', args: { projectDir: elsewhere, goal: 'g' } }),
    )
    expect(pending(root)).toBe(join(root, '.claude/plans/p.md'))
  })

  test('is still pending when the OTHER root holds a dispatch of a different spec', () => {
    const elsewhere = join(TMP, 'elsewhere-stale')
    mkdirSync(elsewhere, { recursive: true })
    const root = plantPlan(
      'stale',
      JSON.stringify({ runId: 'r', args: { projectDir: elsewhere, goal: 'g' } }),
    )
    recordDispatch(elsewhere, 'r', 'f'.repeat(64)) // some earlier, amended spec
    expect(pending(root)).toBe(join(root, '.claude/plans/p.md'))
  })

  test('an abandon recorded under projectDir releases the hold', () => {
    const elsewhere = join(TMP, 'elsewhere-abandoned')
    mkdirSync(join(elsewhere, '.craft'), { recursive: true })
    const root = plantPlan(
      'abandoned',
      JSON.stringify({ runId: 'r', args: { projectDir: elsewhere, goal: 'g' } }),
    )
    writeFileSync(join(elsewhere, '.craft/abandoned'), `${specHash(root)}\n`)
    expect(pending(root)).toBe('')
  })

  test('projectDir at the TOP of the block is honoured too — dispatch defaults it from there', () => {
    const elsewhere = join(TMP, 'elsewhere-top')
    mkdirSync(elsewhere, { recursive: true })
    const root = plantPlan(
      'top',
      JSON.stringify({ runId: 'r', projectDir: elsewhere, args: { goal: 'g' } }),
    )
    recordDispatch(elsewhere, 'r', specHash(root))
    expect(pending(root)).toBe('')
  })
})

describe('craft-pending: fails CLOSED — a spec nobody can read is never "dispatched"', () => {
  test('a block naming no projectDir is unaffected — still pending', () => {
    const root = plantPlan('no-projdir', JSON.stringify({ runId: 'r', args: { goal: 'g' } }))
    expect(pending(root)).toBe(join(root, '.claude/plans/p.md'))
  })

  test('a projectDir that does not exist reads as pending, not as dispatched', () => {
    const root = plantPlan(
      'ghost-dir',
      JSON.stringify({ runId: 'r', args: { projectDir: join(TMP, 'nope'), goal: 'g' } }),
    )
    expect(pending(root)).toBe(join(root, '.claude/plans/p.md'))
  })

  test('a non-string projectDir is ignored rather than crashing the script', () => {
    const root = plantPlan(
      'bad-type',
      JSON.stringify({ runId: 'r', args: { projectDir: 42, goal: 'g' } }),
    )
    expect(pending(root)).toBe(join(root, '.claude/plans/p.md'))
  })

  test('an unparseable block stays exactly as it was — no hash, so never armed', () => {
    const root = plantPlan('junk', '{"runId":"r", "args":{ NOT JSON }')
    expect(pending(root)).toBe('')
  })
})

describe('craft-pending: the root-relative path is untouched', () => {
  test('a same-root dispatch still disarms', () => {
    const root = plantPlan('same-root', JSON.stringify({ runId: 'r', args: { goal: 'g' } }))
    recordDispatch(root, 'r', specHash(root))
    expect(pending(root)).toBe('')
  })

  test('a same-root armed plan is still reported', () => {
    const root = plantPlan('same-root-armed', JSON.stringify({ runId: 'r', args: { goal: 'g' } }))
    expect(pending(root)).toBe(join(root, '.claude/plans/p.md'))
  })

  test('a plan with no dispatch block at all is not pending', () => {
    const root = join(TMP, 'unarmed')
    mkdirSync(join(root, '.claude/plans'), { recursive: true })
    writeFileSync(join(root, '.claude/plans/p.md'), '# just a plan, never armed\n')
    expect(pending(root)).toBe('')
  })

  test('a root with no .claude/plans is not pending', () => {
    const root = join(TMP, 'bare')
    mkdirSync(root, { recursive: true })
    expect(pending(root)).toBe('')
  })
})

describe('craft-pending: plansDirectory decides where the plan is', () => {
  test('a custom plansDirectory is where the armed plan is found', () => {
    const root = plantPlan('custom-plansdir', JSON.stringify({ runId: 'r', args: { goal: 'g' } }), '.planning')
    setPlansDirectory(root, './.planning')
    expect(pending(root)).toBe(join(root, '.planning/p.md'))
  })

  test('a plan left at the default path is invisible once plansDirectory moves', () => {
    const root = plantPlan('moved-plansdir', JSON.stringify({ runId: 'r', args: { goal: 'g' } }))
    setPlansDirectory(root, './.planning')
    expect(pending(root)).toBe('')
  })

  test('a dispatch under the custom directory disarms', () => {
    const root = plantPlan('custom-dispatched', JSON.stringify({ runId: 'r', args: { goal: 'g' } }), '.planning')
    setPlansDirectory(root, './.planning')
    recordDispatch(root, 'r', specHash(root, '.planning'))
    expect(pending(root)).toBe('')
  })

  test('settings.local.json wins over settings.json — Claude Code precedence', () => {
    const root = plantPlan('local-tier', JSON.stringify({ runId: 'r', args: { goal: 'g' } }), 'plans-local')
    setPlansDirectory(root, './plans-shared')
    setPlansDirectory(root, './plans-local', 'settings.local.json')
    mkdirSync(join(root, 'plans-shared'), { recursive: true })
    expect(pending(root)).toBe(join(root, 'plans-local/p.md'))
  })

  test('an absolute plansDirectory is honoured as written', () => {
    const root = join(TMP, 'abs-plansdir')
    const plans = join(TMP, 'abs-plansdir-elsewhere')
    mkdirSync(plans, { recursive: true })
    setPlansDirectory(root, plans)
    writeFileSync(join(plans, 'p.md'), `# abs\n\n<!-- craft:dispatch ${JSON.stringify({ runId: 'r', args: { goal: 'g' } })} -->\n`)
    expect(pending(root)).toBe(join(plans, 'p.md'))
  })

  test('a malformed settings file falls back to the default, it does not crash', () => {
    const root = plantPlan('bad-settings', JSON.stringify({ runId: 'r', args: { goal: 'g' } }))
    mkdirSync(join(root, '.claude'), { recursive: true })
    writeFileSync(join(root, '.claude/settings.json'), '{ NOT JSON')
    expect(pending(root)).toBe(join(root, '.claude/plans/p.md'))
  })
})
