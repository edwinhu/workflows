// ============================================================================
// GENERIC compiled-runner template — the reference skeleton wc-creator points
// authors at when a workflow is a "DAG of mechanical work between human gates"
// (Step 3 classified it `compiled-runner`, NOT generic-interpreter).
//
// This is the compile TARGET for `spec → plan → compiled run.js`. A domain's
// `scripts/<domain>/<domain>_compile.py` fills the three holes and writes the
// result to <project>/.planning/run.js, which the slim domain skill executes via
//   Workflow({ scriptPath: ".planning/run.js", args: {...} })
//
// COPY this file to `workflows/templates/<domain>-run-template.js` and fill ONLY
// the THREE SEAMS (marked ▼ SEAM). Leave the driver + the four invariants alone —
// they are hand-won; see ds-run-template.js / dev-run-template.js for live ones.
//
// THE FOUR SAFETY INVARIANTS (baked in here so every generated run.js inherits them):
//   (i)   payload > pass/fail — pause/finding payloads carry deviations + a NUMBERED
//         summary, never a bare exit code (the gate caught zero bugs in ds/dev;
//         deviations + adversarial review caught them).
//   (ii)  mandatory R4 — an assumption/contract/architecture change BLOCKS (pause),
//         never auto-resolves to pass a gate; a stale-gate backstop re-blocks.
//   (iii) the probe asserts ARTIFACTS-EXIST, not just gate-pass (a Verify can pass
//         on a stale/clobbered artifact).
//   (iv)  the adversarial/full-suite/review layer stays OUTSIDE this run.js.
//
// Holes the compiler replaces verbatim, exactly once:
//   __META__     meta object literal
//   __PROJECT__  absolute project dir string literal
//   __TASKS__    array-of-task-spec literal (shape = ▼ SEAM 1)
// ============================================================================

export const meta = /*__META__*/

const PROJECT = /*__PROJECT__*/
const TASKS   = /*__TASKS__*/

// ── args (carry human decisions across pauses; Workflow scripts have no disk) ──
let cfg = (typeof args === 'string') ? (() => { try { return JSON.parse(args) } catch { return {} } })() : (args || {})
const DECISIONS = cfg.decisions || {}                                  // { taskId: "the human's call" }  (behavior-only decisions)
const CLEARED   = new Set((cfg.clearedPauses || []).map(String))       // declared pauses already resolved
const ONLY      = (Array.isArray(cfg.onlyChecks) && cfg.onlyChecks.length) ? new Set(cfg.onlyChecks.map(String)) : null
const REVERIFY_DONE = !!cfg.reverifyDone                               // re-probe PLAN `[x]` tasks instead of blind-skipping (clobber-safe resume)

// ── schemas ───────────────────────────────────────────────────────────────
// ▼ SEAM 3a — the gate return contract. {pass, outputsPresent, evidence}. For an
//   exit-code gate, pass=exit0. For a semantic gate, pass is the judge's verdict —
//   but keep `evidence` numbered/specific (a vague-evidence pass is the failure
//   mode wearing a judge's robe) and keep the adversarial layer OUTSIDE run.js.
const GATE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['pass', 'outputsPresent', 'evidence'],
  properties: {
    pass: { type: 'boolean', description: 'true IFF the gate passed (exit-code: the Verify command exited 0; semantic: the judge confirmed)' },
    outputsPresent: { type: 'boolean', description: 'true IFF every declared output artifact exists AND is non-empty — checked INDEPENDENTLY of the gate (a gate can pass on a stale/clobbered artifact). true when none were declared.' },
    evidence: { type: 'string', description: 'numbered/specific proof it ran (exit-code: last ~25 lines; semantic: the cited specifics). NOT a bare pass/fail.' },
  },
}
const TRANSFORM_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['task', 'status', 'outputsProduced', 'filesTouched', 'deviations', 'summary'],
  properties: {
    task: { type: 'string' },
    status: { type: 'string', enum: ['implemented', 'blocked', 'error'] },
    outputsProduced: { type: 'boolean', description: 'did you create every declared output artifact?' },
    filesTouched: { type: 'array', items: { type: 'string' } },
    deviations: { type: 'string', description: 'R1/R2/R3 auto-fixed verbatim; R4 escalation reason if status=blocked' },
    summary: { type: 'string', description: 'one line: what was produced + SPEC IDs + KEY OUTPUT NUMBERS (invariant i)' },
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

// ▼ SEAM 3b — gateProbe(t): how a task is gated. An INDEPENDENT cheap agent runs the
//   gate AND confirms declared outputs exist (invariant iii). Swapping exit-code ⇄
//   semantic ⇄ mechanical-floor is an isolated change to THIS one function. NEVER let
//   the implementer's self-report be the gate.
async function gateProbe(t) {
  if (!t.verify) return { pass: false, outputsPresent: false, evidence: '(no Verify/gate in the plan row)' }
  const outs = (t.outputs || []).filter(Boolean)
  return agent(
    `Run EXACTLY this gate from ${PROJECT} and report the result. Do NOT create, edit, fix, or analyze anything — only run it and report.\n\n    ${t.verify}\n\n`
    + (outs.length
        ? `Then INDEPENDENTLY confirm each declared output below EXISTS and is non-empty (an \`ls\` / one-line check — do NOT recompute it; a gate can pass while the artifact is stale or clobbered):\n${outs.map(o => '    ' + o).join('\n')}\n\n`
        : '')
    + `Return { pass: <true iff the gate passed>, outputsPresent: <true iff every declared output above exists and is non-empty${outs.length ? '' : '; true since none were declared'}>, evidence: "<numbered/specific proof — last ~25 lines or cited specifics>" }.`,
    { label: `gate:${t.id}`, phase: 'Gate', schema: GATE_SCHEMA, model: 'haiku', effort: 'low' })
}

// ▼ SEAM 2 — implementerPrompt(t): how ONE task is produced. Domain role + protocol.
//   Keep the MANDATORY R4 block + the stale-gate backstop verbatim (invariant ii) —
//   only the domain's role line and its R4 list (what counts as an assumption change)
//   change per domain. The "what" is pinned by the plan row — no scope latitude.
function implementerPrompt(t) {
  const role = 'You are a domain implementer. <SEAM 2: domain role + determinism/idempotency/schema rules>.'
  const decision = DECISIONS[String(t.id)]
    ? `\nHUMAN DECISION for this task (honor it EXACTLY): ${DECISIONS[String(t.id)]}\n  ⚠ STALE-GATE BACKSTOP: if this decision changes the contract/grain/schema but the Verify above still encodes the OLD one, do NOT revert your output to satisfy the stale gate. Honor the decision, then RE-BLOCK (status="blocked") and state in deviations that the PLAN's Verify must be updated and recompiled.`
    : ''
  return `${role} You implement EXACTLY ONE planned task by writing DIRECTLY into ${PROJECT}. The "what" is pinned by the PLAN row — no latitude on scope.
Set task="${t.id}" verbatim (the gate keys on it).

TASK ${t.id}: ${t.name}
Implements (SPEC IDs): ${(t.implements || []).join(', ')}
Outputs to produce (under ${PROJECT}): ${(t.outputs || []).join(', ')}
Expected Output (proves completion): ${t.expectedOutput}
Verify/gate (make it pass HONESTLY — do not reshape inputs to satisfy it): ${t.verify}${decision}

FULL TASK TEXT FROM PLAN:
${t.taskText}

Protocol (NON-NEGOTIABLE):
1. Produce every declared output (write the code/artifact, run it, confirm it exists).
2. Run the Verify/gate yourself and read your own output — confirm it matches Expected Output (specific numbers/shape), not "looks right".
3. Deviations: R1 bug / R2 missing-critical / R3 blocking → auto-fix + re-verify + record in deviations.
   ⛔ MANDATORY R4 — you may NOT auto-resolve these to make the gate pass; set status="blocked" and put the decision + the conflicting NUMBERS in deviations (the run pauses, a human decides): <SEAM 2: the domain's assumption/contract/architecture-change list>. "I changed an assumption so the gate would pass" is always a blocked R4.
4. summary MUST carry the KEY OUTPUT NUMBERS named in Expected Output — these are surfaced at every pause and are the channel that catches gate-passing bugs (invariant i). A summary without numbers is a regression.
Return TRANSFORM_SCHEMA.`
}

async function runTask(t) {
  // 1. idempotent short-circuit (gate-first) — skip only if the gate passes AND the
  //    declared outputs actually exist (a stale/clobbered artifact must NOT count as done).
  if (!(ONLY && ONLY.has(String(t.id)))) {
    const probe = await gateProbe(t)
    if (probe.pass && probe.outputsPresent) { log(`↳ ${t.id}: already satisfied (skip implement)`); return { id: String(t.id), impl: null, gate: probe, pass: true, skipped: true } }
  }
  // 2. implement (the real work — tiered model per ▼ SEAM 1: t.tier/t.effort)
  const impl = await agent(implementerPrompt(t), {
    label: `task:${t.id}`, phase: 'Implement', schema: TRANSFORM_SCHEMA,
    model: t.tier || 'sonnet', effort: t.effort || 'medium',
  })
  if (!impl || impl.status === 'blocked') return { id: String(t.id), impl, gate: null, pass: false }
  // 3. authoritative gate — fresh independent probe: real gate pass AND outputs exist.
  const gate = await gateProbe(t)
  return { id: String(t.id), impl, gate, pass: !!gate.pass && gate.outputsPresent !== false && impl.outputsProduced === true }
}

function scoreTable(state) {
  const rows = TASKS.map(t => {
    const r = state[String(t.id)]
    const mark = b => b ? '✅' : '❌'
    const st = !r ? '·' : r.skipped ? '✅(skip)' : r.pass ? '✅' : (r.impl && r.impl.status === 'blocked' ? '⏸ R4' : '❌')
    return `| ${t.id}. ${String(t.name).slice(0, 48)} | ${r ? mark(r.pass) : '·'} | ${st} |`
  })
  return ['| Task | Gate | Status |', '|------|------|--------|', ...rows].join('\n')
}

// invariant (i): pause/finding payloads carry deviations + numbered summary, NOT just pass/fail.
function pausePayload(r, decision) {
  const t = byId[r.id] || {}
  const impl = r.impl || {}
  return {
    task: r.id, name: t.name, decision,
    summary: impl.summary || '',          // KEY OUTPUT NUMBERS
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
    else if (impl.outputsProduced !== true) findings.push({ ...base, detail: 'declared outputs not produced' })
    else if (r.gate && r.gate.outputsPresent === false) findings.push({ ...base, detail: `gate passed but a declared output is missing/empty (stale/clobbered): ${(t.outputs || []).join(', ')}` })
    else findings.push({ ...base, detail: `gate did not pass (\`${t.verify}\`)` })
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

// ── driver (topo → level-parallel → gate-first skip → two kinds of pause) ─────
const levels = toposort(TASKS)
const state = {}
log(`compiled-run: ${TASKS.length} task(s), ${levels.length} dependency level(s)${ONLY ? `; re-run ${ONLY.size}` : ''}`)

for (let li = 0; li < levels.length; li++) {
  const layer = levels[li].map(id => byId[id]).filter(Boolean)
  // A PLAN `[x]` (t.done) is the prior run's confirmed mark; blind-skip by default (0 agents).
  // args.reverifyDone routes done tasks through the cheap gate-first probe for a paranoid resume.
  const todo = layer.filter(t => REVERIFY_DONE || !t.done || (ONLY && ONLY.has(String(t.id))))
  if (!todo.length) { layer.forEach(t => { state[String(t.id)] = { id: String(t.id), impl: null, gate: null, pass: true, skipped: true } }); continue }
  phase(`Level ${li}`)
  // ▼ SEAM 1 (within-level execution): parallel (disjoint outputs, e.g. ds) is the default here.
  //   For a SHARED work-tree domain (e.g. dev), the compiler emits sequential levels or the
  //   implementer serializes — a naive parallel copy corrupts a shared tree. Set per DESIGN.md.
  log(`Level ${li}/${levels.length - 1}: [${todo.map(t => t.id).join(', ')}]${todo.length > 1 ? ' (parallel)' : ''}`)
  const results = (await parallel(todo.map(t => () => runTask(t)))).filter(Boolean)
  for (const r of results) state[r.id] = r

  // dynamic pause — an implementer hit an R4 it cannot auto-resolve (invariant ii). Surfaces
  // the deviations + numbers, never a bare exit code (invariant i).
  const blocked = results.find(r => r.impl && r.impl.status === 'blocked')
  if (blocked) return collect(state, { paused: true, pauseKind: 'R4', atTask: blocked.id, payload: pausePayload(blocked, (blocked.impl || {}).deviations || 'R4 escalation') })

  // a hard gate failure (not R4) stops the run for the skill's fix loop
  const failed = results.find(r => !r.pass && !(r.impl && r.impl.status === 'blocked'))
  if (failed) return collect(state)

  // declared pause — a planned decision point implemented this run and not yet cleared.
  // Cleared pauses ride in args.clearedPauses so resume is deterministic.
  const gateRes = results.find(r => !r.skipped && byId[r.id] && byId[r.id].pauseAfter && !CLEARED.has(r.id))
  if (gateRes) return collect(state, { paused: true, pauseKind: 'decision', atTask: gateRes.id, payload: pausePayload(gateRes, byId[gateRes.id].pauseAfter) })
}

return collect(state, { done: true })
