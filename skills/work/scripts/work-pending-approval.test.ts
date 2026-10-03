/**
 * "Approved" means the user approved it, and "dispatched" means a run exists wherever it was put.
 *
 * Measured 2026-10-02 in ~/areas/secreg, session e3b75752: the Stop nudge called notes-18-repair.md
 * "approved" and "armed and undispatched". The session had made ZERO ExitPlanMode calls — the plan
 * was only written — and the plan WAS in flight: `work-dispatch.sh --run-dir ~/.local/state/craft`
 * had written args.json carrying its spec hash outside the project, where no lookup looked. The only
 * way to stage a plan was moving it or `--abandon`, which wrote `abandoned` into the course tree.
 *
 * Run: bun test ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/work-pending-approval.test.ts
 */
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { useTmp } from '../../../tests/helpers/tmp.ts'

setDefaultTimeout(60_000)
const mkTmp = useTmp()
const PENDING = join(import.meta.dir, 'work-pending.sh')
const DISPATCH = join(import.meta.dir, 'work-dispatch.sh')

function world() {
  const dir = mkTmp('wp-approval-')
  const root = join(dir, 'course')
  const home = join(dir, 'home')
  const tmp = join(dir, 'tmp')
  for (const d of [join(root, '.claude/plans'), home, tmp, join(root, 'src')]) mkdirSync(d, { recursive: true })
  const plan = join(root, '.claude/plans/p.md')
  const args = {
    projectDir: root, goal: 'g', readOnly: true, tasks: [],
    mechanicalChecks: [{ name: 'ok', cmd: 'true' }],
    lens: { agentType: 'Explore', refs: [], prompt: 'raise MAJOR when wrong' },
  }
  writeFileSync(plan, `# p\n\n<!-- work:dispatch\n${JSON.stringify({ runId: 'r1', args }, null, 2)}\n-->\n`)
  return { dir, root, home, tmp, plan }
}

type W = ReturnType<typeof world>

/** A transcript line pair exactly as Claude Code writes an ExitPlanMode call and its result. */
function exitPlanMode(plan: string, approved: boolean, id = 'toolu_01'): string {
  const use = { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'ExitPlanMode', input: { plan: '# p', planFilePath: plan } }] } }
  const result = approved
    ? { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: `User has approved your plan. You can now start coding.\n\nYour plan has been saved to: ${plan}` }] },
        toolUseResult: { plan: '# p', isAgent: false, filePath: plan } }
    : { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: "The user doesn't want to proceed with this tool use." }] },
        toolUseResult: 'User rejected tool use' }
  return JSON.stringify(use) + '\n' + JSON.stringify(result) + '\n'
}

function transcript(w: W, name: string, body: string): string {
  const p = join(w.dir, `${name}.jsonl`)
  writeFileSync(p, body)
  return p
}

function pending(w: W, extra: string[] = [], env: Record<string, string> = {}): string {
  const r = spawnSync('bash', [PENDING, w.root, ...extra], {
    encoding: 'utf8', timeout: 60_000, env: { ...process.env, HOME: w.home, TMPDIR: w.tmp, CLAUDE_CODE_SESSION_ID: '', ...env },
  })
  return (r.stdout || '').split('\t')[0].trim()
}

/** A REAL dispatch (the log records only those), farmed to a stub and holding no session. */
function dispatch(w: W, ...flags: string[]) {
  const farm = join(w.dir, 'stub-farm.sh')
  writeFileSync(farm, '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 })
  return spawnSync('bash', [DISPATCH, '--provider', 'claude', '--no-lint', '--loops', '0', '--no-cron', ...flags, w.plan], {
    encoding: 'utf8', timeout: 120_000, cwd: w.root,
    env: { ...process.env, HOME: w.home, TMPDIR: w.tmp, CLAUDE_CODE_SESSION_ID: '', WORK_NO_SCOPE: '1', WORK_FARM: farm },
  })
}

describe('approval comes only from an ExitPlanMode receipt', () => {
  test('a plan that was only WRITTEN is staged, not owed', () => {
    const w = world()
    expect(pending(w)).toBe('')
    expect(pending(w, ['--transcript', transcript(w, 't', '{"type":"user","message":{"content":"hi"}}\n')])).toBe('')
  })

  test('an approved ExitPlanMode for this plan arms it', () => {
    const w = world()
    expect(pending(w, ['--transcript', transcript(w, 't', exitPlanMode(w.plan, true))])).toBe(w.plan)
  })

  test('a REJECTED ExitPlanMode does not arm it', () => {
    const w = world()
    expect(pending(w, ['--transcript', transcript(w, 't', exitPlanMode(w.plan, false))])).toBe('')
  })

  test('approval of a DIFFERENT plan does not arm this one', () => {
    const w = world()
    expect(pending(w, ['--transcript', transcript(w, 't', exitPlanMode(join(w.root, '.claude/plans/other.md'), true))])).toBe('')
  })

  test('a re-seeded session finds the approval in the transcript it was cleared from', () => {
    const w = world()
    const old = transcript(w, 'old', exitPlanMode(w.plan, true))
    const seed = { type: 'user', message: { content: `Implement the following plan:\n\n# p\n\nIf you need specific details from before exiting plan mode, read the full transcript at: ${old}\n` } }
    expect(pending(w, ['--transcript', transcript(w, 'new', JSON.stringify(seed) + '\n')])).toBe(w.plan)
  })

  test('with no --transcript, the session id locates the transcript', () => {
    const w = world()
    mkdirSync(join(w.home, '.claude/projects/some-slug'), { recursive: true })
    writeFileSync(join(w.home, '.claude/projects/some-slug/sid-123.jsonl'), exitPlanMode(w.plan, true))
    expect(pending(w, [], { CLAUDE_CODE_SESSION_ID: 'sid-123' })).toBe(w.plan)
  })

  test('--written reports a written plan regardless of approval (the dispatch default)', () => {
    const w = world()
    expect(pending(w, ['--written'])).toBe(w.plan)
  })
})

describe('a dispatched run is found wherever its run dir is', () => {
  test('--run-dir outside the project: not owed — the in-flight false positive', () => {
    const w = world()
    const t = ['--transcript', transcript(w, 't', exitPlanMode(w.plan, true))]
    expect(pending(w, t)).toBe(w.plan)
    const runs = join(w.dir, 'state-runs')
    const r = dispatch(w, '--run-dir', runs)
    expect(r.status).toBe(0)
    expect(existsSync(join(runs, 'r1', 'args.json'))).toBe(true)
    expect(existsSync(join(w.root, '.work'))).toBe(false)
    expect(pending(w, t)).toBe('')
  })

  test('a dispatch record whose args.json does not carry the hash is not trusted', () => {
    const w = world()
    const t = ['--transcript', transcript(w, 't', exitPlanMode(w.plan, true))]
    const runs = join(w.dir, 'state-runs')
    expect(dispatch(w, '--run-dir', runs).status).toBe(0)
    writeFileSync(join(runs, 'r1', 'args.json'), JSON.stringify({ specHash: 'f'.repeat(64) }))
    expect(pending(w, t)).toBe(w.plan)
  })
})

describe('--abandon keeps its state out of the project tree', () => {
  test('abandon releases the plan and writes nothing under the project', () => {
    const w = world()
    const t = ['--transcript', transcript(w, 't', exitPlanMode(w.plan, true))]
    const r = dispatch(w, '--abandon')
    expect(r.status).toBe(0)
    expect(existsSync(join(w.root, '.work'))).toBe(false)
    expect(existsSync(join(w.root, '.craft'))).toBe(false)
    expect(readFileSync(join(w.tmp, 'work-dispatch.log'), 'utf8')).toMatch(/\tabandoned\t/)
    expect(pending(w, t)).toBe('')
  })
})
