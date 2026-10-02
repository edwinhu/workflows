// The no-agent stages of a work round. workflow.js's AGENTS stage runs inside farm.sh --workflow;
// this file re-enters workflow.js with `args.round` set, and no re-entry may dispatch an agent:
//
//   bun work-stage.mjs plan     --args A
//       -> stdout: {stage:'plan', checkPlan, fanOut} (work-dispatch.sh probes checkPlan.red before launch)
//   bun work-stage.mjs digest   --args A --raw RAW --checks CHECKS --run DIR --provider HOST [--cwd D]
//       -> DIR/digest.json, DIR/digest.md, DIR/rows.json (the ONE lens row, kind review)
//   bun work-stage.mjs assemble --args A --raw RAW --checks CHECKS --lens LENS --out RESULT
//       -> RESULT, the work result contract work-result.sh adjudicates
//
// The workflow body is compiled the way workflow-harness.mjs compiles it (top-level await, hooks
// as free variables), so the gate arithmetic that runs here is the file under test, not a copy.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
export const WORKFLOW = new URL('../workflow.js', import.meta.url).pathname

export function load(path = WORKFLOW) {
  const src = readFileSync(path, 'utf8').replace('export const meta =', 'const meta =')
  return new AsyncFunction('args', 'agent', 'phase', 'parallel', 'pipeline', 'log', src)
}

const noAgent = async (_p, opts) => {
  throw new Error(`work-stage: a no-agent stage tried to dispatch ${opts && opts.label}`)
}
const parallel = thunks => Promise.all(thunks.map(async th => { try { return await th() } catch { return null } }))
const pipeline = async () => { throw new Error('work-stage: pipeline in a no-agent stage') }

/** Run one no-agent stage of workflow.js. `round` is {agents, checks[, lens]}. */
export async function runStage(args, round, path = WORKFLOW) {
  const logs = []
  const result = await load(path)({ ...args, round }, noAgent, () => {}, parallel, pipeline, m => logs.push(m))
  return { result, logs }
}

// ── ownership: which task's writablePaths reach a path ─────────────────────────────────────────
const norm = p => String(p || '').replace(/^\.\//, '').replace(/\/+$/, '')
const globRe = g => new RegExp('^' + norm(g).split('**').map(s => s.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*') + '(/.*)?$')
export const covers = (writablePaths, file) =>
  (writablePaths || []).some(w => (/[*]/.test(w) ? globRe(w).test(norm(file)) : (norm(file) === norm(w) || norm(file).startsWith(norm(w) + '/'))))
export const ownerOfPath = (tasks, file) => {
  const t = (tasks || []).find(x => covers(x.writablePaths, file))
  return t ? t.id : 'plan'
}

const tail = (s, n = 60) => String(s == null ? '' : s).split('\n').slice(-n).join('\n')

// A mechanical failure owns no task by declaration; name the owner when the output points at files
// exactly one task can reach, else leave it to the lens (the RED-mode route).
const ownerFromOutput = (tasks, output) => {
  const owners = new Set()
  for (const m of String(output || '').matchAll(/[\w./-]+\.[A-Za-z0-9]+/g)) {
    const o = ownerOfPath(tasks, m[0])
    if (o !== 'plan') owners.add(o)
  }
  return owners.size === 1 ? [...owners][0] : null
}

function gitDiffStat(cwd, paths) {
  const r = spawnSync('git', ['diff', '--stat', 'HEAD', '--', ...paths], { cwd, encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : `(git diff failed: ${(r.stderr || '').trim()})`
}
function changedFiles(cwd) {
  const r = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd, encoding: 'utf8' })
  if (r.status !== 0) return null
  return r.stdout.split('\n').filter(Boolean).map(l => l.slice(3).split(' -> ').pop())
}

/** The structured digest the lens reads at the top of its prompt. Pure but for the git calls. */
export function buildDigest(args, checks, gate, cwd) {
  const tasks = Array.isArray(args.tasks) ? args.tasks : []
  const failures = []
  const settled = []
  for (const r of checks.red || []) {
    const before = (args.redBefore || {})[r.id]
    const ok = before && before.exitCode !== 0 && before.exitCode !== -1 && r.exitCode === 0
    const row = { kind: 'red', check: `red:${r.id}`, command: r.command, exitCode: r.exitCode, beforeExit: before ? before.exitCode : -1, output: tail(r.output), owner: r.id }
    ;(ok ? settled : failures).push(row)
  }
  for (const r of checks.acceptance || []) {
    const row = { kind: 'acceptance', check: `acceptance:${r.id}`, command: r.command, exitCode: r.exitCode, output: tail(r.output), owner: r.id }
    ;(r.exitCode === 0 ? settled : failures).push(row)
  }
  for (const r of checks.mechanical || []) {
    const row = { kind: 'mechanical', check: `mechanical:${r.name}`, command: r.cmd, exitCode: r.exitCode, output: tail(r.output), owner: r.exitCode === 0 ? null : ownerFromOutput(tasks, r.output) }
    ;(r.exitCode === 0 ? settled : failures).push(row)
  }
  for (const c of (checks.suite && checks.suite.changed) || []) {
    failures.push({ kind: 'suite', check: `suite:${c.path}`, command: `sha256 ${c.path}`, exitCode: 1, output: `${c.before || 'absent'} -> ${c.after || 'absent'}`, owner: c.owner, severity: 'critical' })
  }
  for (const v of gate.agents ? gate.agents.verified || [] : []) {
    if (!v.pass) failures.push({ kind: 'verifier', check: `verify:${v.id}`, command: null, exitCode: null, output: (v.failures || []).join('; '), owner: v.id })
  }
  for (const i of gate.agents ? gate.agents.implemented || [] : []) {
    if (!i.done) failures.push({ kind: 'implementer', check: `implement:${i.id}`, command: null, exitCode: null, output: (i.blockers || []).join('; '), owner: i.id })
  }
  const active = Array.isArray(args.onlyTasks) ? tasks.filter(t => args.onlyTasks.includes(t.id)) : tasks
  const scope = active.map(t => ({
    id: t.id,
    writablePaths: t.writablePaths || [],
    diffStat: (t.writablePaths || []).length ? gitDiffStat(cwd, t.writablePaths) : '(no writablePaths declared)',
  }))
  const changed = changedFiles(cwd)
  const outOfScope = changed == null ? null : changed.filter(f => !tasks.some(t => covers(t.writablePaths, f)) && !f.startsWith('.planning/'))
  // What no command checks: acceptance prose with no acceptanceCmd, and the plan's criteria.
  const uncommanded = tasks.filter(t => !t.acceptanceCmd).map(t => `${t.id}: ${t.acceptance}`)
  const criteria = Array.isArray(args.criteria) ? args.criteria : []
  return { mode: gate.mode, failures, settled, scope, outOfScope, uncommanded, criteria, workflowDigest: gate.digest }
}

export function digestMarkdown(d) {
  const L = [`# Round digest — MODE ${d.mode}`, '']
  L.push(`## Failures (${d.failures.length})`)
  if (!d.failures.length) L.push('None. Every command below exited as required.')
  for (const f of d.failures) {
    L.push('', `### ${f.check} — owner ${f.owner || 'unrouted (route it)'}${f.severity ? ` — ${f.severity.toUpperCase()}` : ''}`)
    if (f.command) L.push(`command: \`${f.command}\``, `exit: ${f.exitCode}${f.beforeExit !== undefined ? ` (before: ${f.beforeExit})` : ''}`)
    L.push('```', f.output || '(no output)', '```')
  }
  L.push('', `## Settled checks (${d.settled.length}) — SETTLED: never re-run these`)
  for (const s of d.settled) L.push(`- ${s.check}: \`${s.command}\` exit ${s.exitCode}`)
  L.push('', '## Per-task diff (restricted to writablePaths)')
  for (const s of d.scope) L.push('', `### ${s.id} — ${s.writablePaths.join(', ') || '(none)'}`, '```', s.diffStat || '(no changes)', '```')
  L.push('', '## Out-of-scope paths (changed, reachable by no task)')
  if (d.outOfScope == null) L.push('(git status unavailable — scope NOT checked)')
  else if (!d.outOfScope.length) L.push('None.')
  else for (const f of d.outOfScope) L.push(`- ${f}  ← PRE-FLAGGED`)
  L.push('', '## Not checked by any command — judge these')
  for (const u of d.uncommanded) L.push(`- ${u}`)
  for (const c of d.criteria) L.push(`- plan criterion: ${c}`)
  if (!d.uncommanded.length && !d.criteria.length) L.push('None.')
  return L.join('\n')
}

const flags = argv => {
  const o = {}
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[++i]
  return o
}
const readJson = p => JSON.parse(readFileSync(p, 'utf8'))
const readJsonOrNull = p => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null } catch { return null } }

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const f = flags(rest)
  const args = readJson(f.args)
  if (cmd === 'plan') {
    const { result } = await runStage(args, { plan: true })
    process.stdout.write(JSON.stringify(result) + '\n')
    return
  }
  const raw = readJson(f.raw)
  if (!raw || raw.stage !== 'agents') throw new Error(`work-stage: ${f.raw} is not an agents-stage result`)
  const checks = readJson(f.checks)
  const round = { agents: raw.agents, checks }
  if (cmd === 'digest') {
    const { result: gate } = await runStage(args, round)
    if (!gate || gate.stage !== 'digest') throw new Error('work-stage: digest stage returned no digest')
    const d = buildDigest(args, checks, { ...gate, agents: raw.agents }, f.cwd || args.projectDir || process.cwd())
    const md = digestMarkdown(d)
    const lensOut = join(f.run, 'lens.json')
    writeFileSync(join(f.run, 'digest.json'), JSON.stringify(d, null, 2) + '\n')
    writeFileSync(join(f.run, 'digest.md'), md + '\n')
    const spec = gate.lens
    const prompt = [
      md,
      '',
      '---',
      'Every check marked SETTLED above already ran and its exit code is final. NEVER re-run a settled check; spend your time on the failures and on what no command checks.',
      '',
      spec.prompt,
      '',
      `Write your answer as ONE JSON object matching this schema to ${lensOut}, and nothing else in that file:`,
      JSON.stringify(spec.schema),
    ].join('\n')
    // The provider dispatch already resolved; work-round.sh passes it to farm.sh as --provider, so
    // route.ts is not asked a second time and the row's own model is the one that runs.
    const routing = args.routing || {}
    const provider = (routing.lens && routing.lens.provider)
      || (routing.decisions && routing.decisions.review && routing.decisions.review.provider)
      || routing.provider || f.provider
    const row = {
      label: spec.label, kind: spec.kind, prompt, provider,
      ...(spec.model ? { model: spec.model } : {}),
      ...(spec.agentType ? { agent: spec.agentType } : {}),
      expect: [lensOut],
    }
    writeFileSync(join(f.run, 'rows.json'), JSON.stringify([row], null, 2) + '\n')
    process.stdout.write(`work-stage: digest MODE ${d.mode}, ${d.failures.length} failure(s), ${d.settled.length} settled -> ${join(f.run, 'rows.json')}\n`)
  } else if (cmd === 'assemble') {
    const lens = readJsonOrNull(f.lens)
    const { result, logs } = await runStage(args, { ...round, lens })
    if (!result || result.stage) throw new Error('work-stage: gate stage did not return a result')
    writeFileSync(f.out, JSON.stringify(result, null, 2) + '\n')
    for (const l of logs) process.stdout.write(l + '\n')
  } else {
    throw new Error(`work-stage: unknown stage ${cmd}`)
  }
}

if (import.meta.main ?? (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1])) {
  main().catch(e => { process.stderr.write(`${e.stack || e}\n`); process.exit(2) })
}
