// ============================================================================
// ds run-template  —  the compile target for `spec → plan → compiled run.js`.
//
// scripts/ds/ds_compile.py fills three holes and writes the result to
// <project>/.planning/run.js, which the ds-implement skill executes via
//   Workflow({ scriptPath: ".planning/run.js", args: {...} })
//
// This file carries the PROTOCOL; the compiled output carries the DATA. The
// honesty invariants live HERE so every generated run.js inherits them:
//   - the gate is the Verify command's real exit code (run by an independent
//     probe agent — Workflow scripts cannot exec shell), never a self-report;
//   - output-first: the implementer must produce the artifact, then it is probed;
//   - the only way to yield to a human is pause() (a structured early return);
//   - resume is deterministic: the script is a pure function of (TASKS,
//     args.decisions, on-disk state). State that must survive a pause rides in args.
//
// Holes (each a block-comment token the compiler replaces verbatim, exactly once):
//   __META__     meta object literal
//   __PROJECT__  absolute project dir string literal
//   __TASKS__    array-of-task-spec literal
// ============================================================================

export const meta = /*__META__*/

const PROJECT = /*__PROJECT__*/
const TASKS   = /*__TASKS__*/

// ── args (carry human decisions across pauses; Workflow scripts have no disk) ──
let cfg = (typeof args === 'string') ? (() => { try { return JSON.parse(args) } catch { return {} } })() : (args || {})
const DECISIONS = cfg.decisions || {}                                  // { taskId: "the human's call" }
const CLEARED   = new Set((cfg.clearedPauses || []).map(String))       // declared pauses already resolved
const ONLY      = (Array.isArray(cfg.onlyChecks) && cfg.onlyChecks.length) ? new Set(cfg.onlyChecks.map(String)) : null
const REVERIFY_DONE = !!cfg.reverifyDone                               // re-probe PLAN `[x]` tasks instead of blind-skipping (clobber-safe resume)

// ── schemas ───────────────────────────────────────────────────────────────
const GATE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['exit0', 'outputsPresent', 'tail'],
  properties: {
    exit0: { type: 'boolean', description: 'true IFF the Verify command exited 0' },
    outputsPresent: { type: 'boolean', description: 'true IFF every declared Outputs artifact exists AND is non-empty — checked independently of Verify, because a Verify can pass on a stale/clobbered artifact (e.g. a funnel silently overwritten to 3 of 11 years). true when no outputs were declared.' },
    tail:  { type: 'string', description: 'last ~25 lines of output, as proof it actually ran' },
  },
}
const TRANSFORM_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['task', 'status', 'outputsProduced', 'filesTouched', 'deviations', 'summary'],
  properties: {
    task: { type: 'string' },
    status: { type: 'string', enum: ['implemented', 'blocked', 'error'] },
    outputsProduced: { type: 'boolean', description: 'did you create every declared Outputs artifact?' },
    filesTouched: { type: 'array', items: { type: 'string' } },
    deviations: { type: 'string', description: 'R1/R2/R3 auto-fixed verbatim; R4 escalation reason if status=blocked' },
    summary: { type: 'string', description: 'one line: what was produced + SPEC IDs + key output numbers' },
  },
}

// ── helpers ─────────────────────────────────────────────────────────────────
const byId = Object.fromEntries(TASKS.map(t => [String(t.id), t]))

function toposort(tasks) {
  const ids = new Set(tasks.map(t => String(t.id)))
  const deps = Object.fromEntries(tasks.map(t => [String(t.id), (t.deps || []).map(String).filter(d => ids.has(d))]))
  const placed = new Set(); const levels = []
  while (placed.size < tasks.length) {
    let layer = [...ids].filter(id => !placed.has(id) && deps[id].every(d => placed.has(d)))
    if (!layer.length) layer = [...ids].filter(id => !placed.has(id)) // cycle guard (validated away at compile)
    layer.sort((a, b) => (parseInt(a.replace(/\D/g, '')) || 0) - (parseInt(b.replace(/\D/g, '')) || 0))
    levels.push(layer); layer.forEach(id => placed.add(id))
  }
  return levels
}

// The single source of gate truth: an independent cheap agent runs ONLY the
// Verify command AND confirms the declared Outputs actually exist+non-empty
// (a Verify can pass on a stale/clobbered artifact). Swapping this for an
// implementer self-report (decision D1) is an isolated change to this one fn.
async function gateProbe(t) {
  if (!t.verify) return { exit0: false, outputsPresent: false, tail: '(no Verify command in the plan row)' }
  const outs = (t.outputs || []).filter(Boolean)
  return agent(
    `Run EXACTLY this command from ${PROJECT} and report the result. Do NOT create, edit, fix, or analyze anything — only run it and report.\n\n    ${t.verify}\n\n`
    + (outs.length
        ? `Then INDEPENDENTLY confirm each declared output artifact below EXISTS and is non-empty (an \`ls\` / a one-line row-count — do NOT recompute or re-derive it; a Verify can exit 0 while the artifact is stale or clobbered):\n${outs.map(o => '    ' + o).join('\n')}\n\n`
        : '')
    + `Return { exit0: <true iff the process exited 0>, outputsPresent: <true iff every declared output above exists and is non-empty${outs.length ? '' : '; true since none were declared'}>, tail: "<last ~25 lines of output, as proof>" }.`,
    { label: `gate:${t.id}`, phase: 'Gate', schema: GATE_SCHEMA, model: 'haiku', effort: 'low' })
}

function implementerPrompt(t) {
  const role = t.kind === 'engineer'
    ? 'You are a ds-ENGINEER (pipeline/ETL): enforce determinism (no unseeded randomness, stable sort), idempotency (re-running produces the same Outputs), and schema validation on the output.'
    : t.kind === 'analyst'
      ? 'You are a ds-ANALYST: verify every number against the data; no hand-waved results.'
      : 'You are a ds implementer.'
  const decision = DECISIONS[String(t.id)] ? `\nHUMAN DECISION for this task (honor it exactly): ${DECISIONS[String(t.id)]}` : ''
  return `${role} You implement EXACTLY ONE planned task by writing DIRECTLY into the project at ${PROJECT}. ds is OUTPUT-FIRST (not TDD): produce the Outputs, then confirm them. The "what" is pinned by the PLAN row — no latitude on scope. Earlier tasks' Outputs are already on disk; build on them.
Set task="${t.id}" verbatim (the gate keys on it).

TASK ${t.id}: ${t.name}   (kind: ${t.kind})
Implements (SPEC IDs): ${(t.implements || []).join(', ')}
Outputs to produce (under ${PROJECT}): ${(t.outputs || []).join(', ')}
Expected Output (proves completion): ${t.expectedOutput}
Verify (the assertion that will gate you; make it pass): ${t.verify}${decision}

FULL TASK TEXT FROM PLAN:
${t.taskText}

Protocol (NON-NEGOTIABLE, output-first):
1. Produce every declared Outputs artifact (write the code, run it, confirm the files exist).
2. Run the Verify assertion yourself and read your own output — confirm it matches Expected Output (specific numbers/shape), not "looks right".
3. Deviations: R1 bug / R2 missing-critical / R3 blocking → auto-fix + re-verify + record in deviations.
   ⛔ MANDATORY R4 — you may NOT auto-resolve these to make Verify pass; set status="blocked" and put the decision + the conflicting NUMBERS in deviations (the run pauses, a human decides): any change to the data's GRAIN, SAMPLE definition/size, SCHEMA/keys, FILTERS, winsor/cap levels, or METHODOLOGY. Dedup, dropping rows, changing a key, or relaxing/tightening a filter to satisfy an assertion is R4 — NEVER R1/R2. If the data legitimately doesn't match the assertion, that is a finding to ESCALATE, not a sample to quietly reshape. "I changed an assumption so the gate would pass" is always a blocked R4.
4. summary MUST carry the KEY OUTPUT NUMBERS (final row counts, headline estimates, the tie-out figures named in Expected Output) — these are surfaced to the human at every pause and are the channel that catches gate-passing bugs (e.g. an 8.8% dedup that satisfies a grain assertion but silently changed the sample: 2015 = 3,736,998 vs the expected 4,096,611). A summary without numbers is a regression.
Return TRANSFORM_SCHEMA.`
}

async function runTask(t) {
  // 1. idempotent short-circuit — skip only if Verify passes AND the declared outputs
  //    actually exist (a stale/clobbered artifact must NOT count as already-done).
  if (!(ONLY && ONLY.has(String(t.id)))) {
    const probe = await gateProbe(t)
    if (probe.exit0 && probe.outputsPresent) { log(`↳ ${t.id}: already satisfied (skip implement)`); return { id: String(t.id), impl: null, gate: probe, pass: true, skipped: true } }
  }
  // 2. implement (the real work — tiered model)
  const impl = await agent(implementerPrompt(t), {
    label: `task:${t.id}`, phase: 'Implement', schema: TRANSFORM_SCHEMA,
    model: t.tier || 'sonnet', effort: t.effort || 'medium',
  })
  if (!impl || impl.status === 'blocked') return { id: String(t.id), impl, gate: null, pass: false }
  // 3. authoritative gate — fresh independent probe: real Verify exit code AND outputs exist.
  const gate = await gateProbe(t)
  return { id: String(t.id), impl, gate, pass: !!gate.exit0 && gate.outputsPresent !== false && impl.outputsProduced === true }
}

function scoreTable(state) {
  const rows = TASKS.map(t => {
    const r = state[String(t.id)]
    const mark = b => b ? '✅' : '❌'
    const st = !r ? '·' : r.skipped ? '✅(skip)' : r.pass ? '✅' : (r.impl && r.impl.status === 'blocked' ? '⏸ R4' : '❌')
    return `| ${t.id}. ${t.name.slice(0, 48)} | ${r ? mark(r.pass) : '·'} | ${st} |`
  })
  return ['| Task | Gate | Status |', '|------|------|--------|', ...rows].join('\n')
}

// Every pause/finding payload carries the implementer's deviations + numbered summary —
// NOT just the gate's pass/fail. In the muni run the JS gate caught zero bugs; every bug
// was caught by a deviation note or by adversarial review reading these numbers. Compressing
// a pause to "exit 0 / exit 1" would make exactly those bugs invisible.
function pausePayload(r, decision) {
  const t = byId[r.id] || {}
  const impl = r.impl || {}
  return {
    task: r.id, name: t.name, decision,
    summary: impl.summary || '',          // KEY OUTPUT NUMBERS (row counts, headline estimates)
    deviations: impl.deviations || '',    // what the implementer changed/auto-fixed — the bug channel
    expectedOutput: t.expectedOutput || '',
    filesTouched: impl.filesTouched || [],
    gate: r.gate || null,
  }
}

function collect(state, extra = {}) {
  const done = TASKS.filter(t => state[String(t.id)] && state[String(t.id)].pass)
  const failed = TASKS.filter(t => state[String(t.id)] && !state[String(t.id)].pass)
  const findings = []
  for (const t of TASKS) {
    const r = state[String(t.id)]
    if (!r || r.pass) continue
    const impl = r.impl || {}
    const base = { severity: 'critical', task: t.id, summary: impl.summary || '', deviations: impl.deviations || '' }
    if (impl.status === 'blocked') findings.push({ ...base, detail: `R4 escalation: ${impl.deviations || 'blocked'}` })
    else if (impl.outputsProduced !== true) findings.push({ ...base, detail: 'declared Outputs not produced' })
    else if (r.gate && r.gate.outputsPresent === false) findings.push({ ...base, detail: `Verify passed but a declared output is missing/empty (stale/clobbered): ${(t.outputs || []).join(', ')}` })
    else findings.push({ ...base, detail: `Verify did not exit 0 (\`${t.verify}\`)` })
  }
  return {
    overallPass: failed.length === 0,
    tasksTotal: TASKS.length,
    tasksDone: done.map(t => String(t.id)),
    tasksRemaining: TASKS.length - done.length,
    tasksThatFailed: failed.map(t => String(t.id)),
    scoreTable: scoreTable(state),
    findings,
    reviews: TASKS.map(t => state[String(t.id)]).filter(Boolean),
    ...extra,
  }
}

// ── driver ──────────────────────────────────────────────────────────────────
const levels = toposort(TASKS)
const state = {}
log(`ds-run: ${TASKS.length} task(s), ${levels.length} dependency level(s)${ONLY ? `; re-run ${ONLY.size}` : ''}`)

for (let li = 0; li < levels.length; li++) {
  const layer = levels[li].map(id => byId[id]).filter(Boolean)
  // A PLAN `[x]` (t.done) is the prior run's ds-validate-coverage-confirmed mark; by default we
  // trust it and blind-skip (instant no-op, 0 agents). Defense for a since-clobbered done output:
  // (a) within a phase the CLOBBERING task is never itself done, so its own gateProbe catches it;
  // (b) a downstream consumer's implementer/probe fails on a clobbered upstream; (c) ds-validate-
  // coverage re-checks cross-task. For a paranoid fresh-session resume, args.reverifyDone routes
  // done tasks through the cheap gate-first probe instead (skips intact ones, rebuilds clobbered).
  const todo = layer.filter(t => REVERIFY_DONE || !t.done || (ONLY && ONLY.has(String(t.id))))
  if (!todo.length) { layer.forEach(t => { state[String(t.id)] = { id: String(t.id), impl: null, gate: null, pass: true, skipped: true } }); continue }
  phase(`Level ${li}`)
  log(`Level ${li}/${levels.length - 1}: [${todo.map(t => t.id).join(', ')}]${todo.length > 1 ? ' (parallel)' : ''}`)
  const results = (await parallel(todo.map(t => () => runTask(t)))).filter(Boolean)
  for (const r of results) state[r.id] = r

  // dynamic pause — an implementer hit an R4 it cannot auto-resolve (grain/sample/schema/
  // methodology change). Surfaces the deviations + numbers, never a bare exit code.
  const blocked = results.find(r => r.impl && r.impl.status === 'blocked')
  if (blocked) return collect(state, { paused: true, pauseKind: 'R4', atTask: blocked.id, payload: pausePayload(blocked, (blocked.impl || {}).deviations || 'R4 escalation') })

  // a hard gate failure (not R4) stops the run for the skill's fix loop
  const failed = results.find(r => !r.pass && !(r.impl && r.impl.status === 'blocked'))
  if (failed) return collect(state)

  // declared pause — a planned decision point we ACTUALLY implemented this run (a skipped/
  // already-satisfied task had its decision made in the run that built it) and the human
  // has not yet cleared. Cleared pauses ride in args.clearedPauses so resume is deterministic.
  const gateRes = results.find(r => !r.skipped && byId[r.id] && byId[r.id].pauseAfter && !CLEARED.has(r.id))
  if (gateRes) return collect(state, { paused: true, pauseKind: 'decision', atTask: gateRes.id, payload: pausePayload(gateRes, byId[gateRes.id].pauseAfter) })
}

return collect(state, { done: true })
