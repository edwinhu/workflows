// ============================================================================
// dev run-template  —  the compile target for `spec → plan → compiled run.js`.
//
// scripts/dev/dev_compile.py fills four holes and writes the result to
// <project>/.planning/run.js, which the dev-implement skill executes via
//   Workflow({ scriptPath: ".planning/run.js", args: {...} })
//
// This file carries the PROTOCOL; the compiled output carries the DATA. The
// honesty invariants live HERE so every generated run.js inherits them:
//   - the gate is the Verify Command's REAL exit code (run by an independent
//     probe agent — Workflow scripts cannot exec shell), never a self-report.
//     (Today's dev-implement.js gate keys on the implementer's typed
//     `verifyPassed` + a non-executing corroboration — see DESIGN §1.1/G1.
//     This probe makes "real exit codes, not self-judgment" TRUE.)
//   - TDD test-first: the implementer writes the failing test, sees RED, writes
//     code, sees GREEN; the probe then confirms the test EXISTS (the dev analog
//     of ds outputs-present) — catching "claimed GREEN, wrote nothing / faked it";
//   - dev runs a level's tasks SEQUENTIALLY (shared working tree, no worktree
//     merge in v1 — DESIGN D-dev-1), unlike ds which parallelizes disjoint outputs;
//   - the implementer INHERITS the session model (no per-task tier — DESIGN D-dev-5);
//   - the only way to yield to a human is pause() (a structured early return);
//   - the full suite / dev-test-gaps / dev-review stay OUTSIDE this script
//     (the skill's adversarial ground-truth) — the ds lesson: the JS gate caught
//     zero bugs; the deviation note + adversarial review did.
//
// Holes (each a block-comment token the compiler replaces verbatim, exactly once):
//   __META__               meta object literal
//   __PROJECT__            absolute project dir string literal
//   __TASKS__              array-of-task-spec literal
//   __GLOBAL_CONSTRAINTS__ verbatim Global Constraints body string literal ("" if none)
// ============================================================================

export const meta = /*__META__*/

const PROJECT = /*__PROJECT__*/
const TASKS   = /*__TASKS__*/
const GLOBAL_CONSTRAINTS = /*__GLOBAL_CONSTRAINTS__*/

// ── args (carry human decisions across pauses; Workflow scripts have no disk) ──
let cfg = (typeof args === 'string') ? (() => { try { return JSON.parse(args) } catch { return {} } })() : (args || {})
const DECISIONS = cfg.decisions || {}                                  // { taskId: "the human's call" }
const CLEARED   = new Set((cfg.clearedPauses || []).map(String))       // declared pauses already resolved
const ONLY      = (Array.isArray(cfg.onlyChecks) && cfg.onlyChecks.length) ? new Set(cfg.onlyChecks.map(String)) : null
const REVERIFY_DONE = !!cfg.reverifyDone                               // re-probe PLAN `[x]` tasks instead of blind-skipping
const CLEARED_FS = new Set((cfg.clearedFullSuite || []).map(Number))   // level indices whose full-suite check the skill already passed

// ── schemas ───────────────────────────────────────────────────────────────
const GATE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['exit0', 'filesPresent', 'testPresent', 'tail'],
  properties: {
    exit0: { type: 'boolean', description: 'true IFF the Verify Command exited 0 (GREEN)' },
    filesPresent: { type: 'boolean', description: 'true IFF every declared Files artifact exists AND is non-empty — checked independently of the command (a Verify can exit 0 on a stale tree). true when no files were declared.' },
    testPresent: { type: 'boolean', description: 'true IFF the declared Failing Test actually exists in the tree (Grep/Read the test file) — the dev analog of outputs-present, catches a fake/missing test. true when the task declares Failing Test = N/A.' },
    tail: { type: 'string', description: 'last ~25 lines of the Verify Command output, as proof it actually ran' },
  },
}
const TRANSFORM_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['task', 'status', 'testWritten', 'verifyPassed', 'verifyOutput', 'filesTouched', 'deviations', 'summary'],
  properties: {
    task: { type: 'string', description: 'echo the task id verbatim — the gate keys on it' },
    status: { type: 'string', enum: ['implemented', 'blocked', 'error'] },
    testWritten: { type: 'boolean', description: 'did you write the failing test FIRST and see it RED (true; N/A tasks set true)?' },
    verifyPassed: { type: 'boolean', description: 'did the task Verify Command exit 0 after implementation? (advisory — the authoritative gate is an independent probe)' },
    verifyOutput: { type: 'string', description: 'last ~25 lines of the Verify Command output you saw (proof, not self-judgment)' },
    filesTouched: { type: 'array', items: { type: 'string' }, description: 'repo-relative paths created/edited' },
    deviations: { type: 'string', description: 'R1/R2/R3 auto-fixed counts; R4 architectural escalation reason if status=blocked' },
    summary: { type: 'string', description: 'one line: what was implemented + SPEC IDs + the test result (N passed / M failed)' },
  },
}

// ── helpers ─────────────────────────────────────────────────────────────────
const byId = Object.fromEntries(TASKS.map(t => [String(t.id), t]))
const testRequired = t => {
  const n = String(t.failingTest || '').trim().toLowerCase()
  return n !== '' && !/^(n\/?a|none)\b/.test(n)
}

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

// The single source of gate truth: an independent cheap agent runs ONLY the Verify
// Command, confirms the declared Files exist+non-empty, and confirms the Failing Test
// exists. Swapping this for an implementer self-report (DESIGN D-dev-3) is an isolated
// change to this one fn.
async function gateProbe(t) {
  if (!t.verify) return { exit0: false, filesPresent: false, testPresent: false, tail: '(no Verify Command in the plan row)' }
  const files = (t.files || []).filter(Boolean)
  const needTest = testRequired(t)
  return agent(
    `Run EXACTLY this command from ${PROJECT} and report the result. Do NOT create, edit, fix, or analyze anything — only run it and report.\n\n    ${t.verify}\n\n`
    + (files.length
        ? `Then INDEPENDENTLY confirm each declared file below EXISTS and is non-empty (an \`ls\` / a quick read — do NOT recompute; a Verify can exit 0 on a stale tree):\n${files.map(f => '    ' + f).join('\n')}\n\n`
        : '')
    + (needTest
        ? `Then confirm the declared FAILING TEST exists in the tree (Grep/Read for it — it must be a real test that exercises code, not a stub):\n    ${t.failingTest}\n\n`
        : `(No failing test required — the task declares Failing Test = N/A.)\n\n`)
    + `Return { exit0: <true iff the process exited 0>, filesPresent: <true iff every declared file above exists and is non-empty${files.length ? '' : '; true since none were declared'}>, testPresent: <true iff the failing test exists${needTest ? '' : '; true since N/A'}>, tail: "<last ~25 lines of output, as proof>" }.`,
    { label: `gate:${t.id}`, phase: 'Gate', schema: GATE_SCHEMA, model: 'haiku', effort: 'low' })
}

function implementerPrompt(t) {
  const decision = DECISIONS[String(t.id)]
    ? `\nHUMAN DECISION for this task (honor it EXACTLY): ${DECISIONS[String(t.id)]}\n  ⚠ STALE-GATE BACKSTOP: if this decision changes the Verify Command's CONTRACT (e.g. an API signature, a return shape) but the Verify Command above still encodes the OLD contract, do NOT bend the code to satisfy the stale gate. Honor the decision in the code, then RE-BLOCK (status="blocked") and state in deviations that the PLAN's Verify Command (+ Failing Test) must be updated to match the decision and recompiled. Code shaped to pass a stale gate is exactly the silent divergence we forbid.`
    : ''
  const interfaces = (t.interfaces && t.interfaces.trim())
    ? `\nINTERFACES (what this task consumes / produces — honor these boundaries exactly):\n${t.interfaces}\n` : ''
  const constraints = (GLOBAL_CONSTRAINTS && GLOBAL_CONSTRAINTS.trim())
    ? `\nGLOBAL CONSTRAINTS (bind EVERY task — obey verbatim):\n${GLOBAL_CONSTRAINTS}\n` : ''
  const need = testRequired(t)
  return `You are a dev-implementer (TDD, test-FIRST). You implement EXACTLY ONE planned task by writing DIRECTLY into the project at ${PROJECT}. The "what" is pinned by the PLAN row — you have no design latitude; your job is faithful TDD implementation. Other tasks in this level ran before you in sequence (shared tree), so build on their work, do not revert it.
Set task="${t.id}" verbatim in your record (the gate keys on it).

TASK ${t.id}: ${t.name}
Implements (SPEC IDs): ${(t.implements || []).join(', ')}
Files to create/edit (under ${PROJECT}): ${(t.files || []).join(', ') || '(none declared — declare what you touch)'}
Failing Test (write this FIRST): ${t.failingTest}
Verify Command (must exit 0 when done — the independent probe will RE-RUN it to gate you): ${t.verify}${interfaces}${constraints}${decision}

FULL TASK TEXT FROM PLAN:
${t.taskText}

Protocol (NON-NEGOTIABLE, TDD):
${need
    ? `1. Write the failing test FIRST and run it — see it RED. ⚠ The RED must be because the BEHAVIOR under test is ABSENT, not because of a fixture/type bug (e.g. a numeric id where the type is a string makes the assertion miss for the wrong reason — a false RED that "goes GREEN" by fixing the fixture, implementing nothing). Confirm the RED is for the asserted behavior before writing code.
2. Implement the minimum code to make it GREEN. Follow existing patterns; no \`any\`/\`@ts-ignore\`/suppression; no committing broken code.
3. Run the Verify Command (\`${t.verify}\`) from ${PROJECT}, capture its real output + exit code, set verifyPassed to the actual exit==0.`
    : `1. (Failing Test = N/A — types-only/meta task.) Set testWritten=true.
2. Implement the minimum code. Follow existing patterns; no \`any\`/\`@ts-ignore\`/suppression.
3. Run the Verify Command (\`${t.verify}\`) from ${PROJECT}, capture its real output + exit code, set verifyPassed to the actual exit==0.`}
4. Deviations: R1 bug / R2 missing-critical / R3 blocking → auto-fix + test + record counts in deviations.
   ⛔ MANDATORY R4 (architectural) — you may NOT make these to pass the gate; set status="blocked" and put the decision + impact in deviations (the run pauses, a human decides): a new DB table, a schema change, a new service, switching libraries, a breaking API change, or any change to a Verify Command's contract. "I changed the architecture so the gate would pass" is always a blocked R4.
5. summary MUST carry the test result NUMBERS (e.g. "12 passed / 0 failed") + the SPEC IDs — these are surfaced to the human at every pause and are the channel that catches gate-passing bugs. A summary without the test numbers is a regression.
Return TRANSFORM_SCHEMA. Do NOT claim verifyPassed=true without actually running the command.`
}

async function runTask(t) {
  // 1. idempotent short-circuit (resume): a NOT-done task already GREEN with its files + test
  //    present is genuinely complete — skip the implementer. (A stale/missing artifact must NOT skip.)
  if (!(ONLY && ONLY.has(String(t.id)))) {
    const probe = await gateProbe(t)
    if (probe.exit0 && probe.filesPresent && probe.testPresent) { log(`↳ ${t.id}: already satisfied (skip implement)`); return { id: String(t.id), impl: null, gate: probe, pass: true, skipped: true } }
  }
  // 2. implement (the real work — INHERIT the session model; multi-step TDD needs capability, D-dev-5)
  const impl = await agent(implementerPrompt(t), { label: `task:${t.id}`, phase: 'Implement', schema: TRANSFORM_SCHEMA })
  if (!impl || impl.status === 'blocked') return { id: String(t.id), impl, gate: null, pass: false }
  // 3. authoritative gate — fresh independent probe runs the REAL Verify Command (G1 fix); the
  //    gate keys on its exit0 + files/test present, NOT on the implementer's self-reported verifyPassed.
  const gate = await gateProbe(t)
  const pass = !!gate.exit0 && gate.filesPresent !== false && (testRequired(t) ? gate.testPresent !== false : true)
  return { id: String(t.id), impl, gate, pass }
}

function scoreTable(state) {
  const rows = TASKS.map(t => {
    const r = state[String(t.id)]
    const st = !r ? '·' : r.skipped ? '✅(skip)' : r.pass ? '✅' : (r.impl && r.impl.status === 'blocked' ? '⏸ R4' : '❌')
    return `| ${t.id}. ${String(t.name).slice(0, 48)} | ${r ? (r.pass ? '✅' : '❌') : '·'} | ${st} |`
  })
  return ['| Task | Gate | Status |', '|------|------|--------|', ...rows].join('\n')
}

// Every pause/finding payload carries the implementer's deviations + numbered summary —
// NOT just the gate's pass/fail. The deviation note / numbers are the human's catch-channel.
function pausePayload(r, decision) {
  const t = byId[r.id] || {}
  const impl = r.impl || {}
  return {
    task: r.id, name: t.name, decision,
    summary: impl.summary || '',          // test result numbers + SPEC IDs
    deviations: impl.deviations || '',    // what the implementer changed/escalated — the bug channel
    failingTest: t.failingTest || '',
    verifyCommand: t.verify || '',
    filesTouched: impl.filesTouched || [],
    verifyOutput: (impl.verifyOutput || '').slice(0, 1500),
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
    if (impl.status === 'blocked') findings.push({ ...base, detail: `R4 architectural escalation: ${impl.deviations || 'blocked'}` })
    else if (r.gate && r.gate.testPresent === false && testRequired(t)) findings.push({ ...base, detail: `failing test not present (TDD violation / faked test): ${t.failingTest}` })
    else if (r.gate && r.gate.filesPresent === false) findings.push({ ...base, detail: `declared file missing/empty: ${(t.files || []).join(', ')}` })
    else findings.push({ ...base, detail: `Verify Command did not exit 0 (\`${t.verify}\`)` })
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

// ── driver — SEQUENTIAL within a level (shared tree), across the whole DAG ────
const levels = toposort(TASKS)
// Hybrid full-suite cadence (DESIGN D-dev-2c): only at a level that touches a file an EARLIER
// level also declared can a cross-level integration regression originate. Precompute those level
// indices; the driver pauses there for the skill's full suite. Every other boundary auto-advances;
// the final once-at-end full suite is the skill's job on overallPass.
const FULLSUITE_LEVELS = (() => {
  const out = new Set(); const seen = new Set()
  for (let li = 0; li < levels.length; li++) {
    const levelFiles = levels[li].flatMap(id => (byId[id]?.files) || [])
    if (li > 0 && levelFiles.some(f => seen.has(f))) out.add(li)
    levelFiles.forEach(f => seen.add(f))
  }
  return out
})()

const state = {}
log(`dev-run: ${TASKS.length} task(s), ${levels.length} dependency level(s)${ONLY ? `; re-run ${ONLY.size}` : ''}${FULLSUITE_LEVELS.size ? `; full-suite checkpoints at level(s) ${[...FULLSUITE_LEVELS].join(', ')}` : ''}`)

for (let li = 0; li < levels.length; li++) {
  const layer = levels[li].map(id => byId[id]).filter(Boolean)
  // A PLAN `[x]` (t.done) is the prior run's verified mark; by default trust it and blind-skip.
  // args.reverifyDone routes done tasks through the cheap gate-first probe for paranoid resumes.
  const todo = layer.filter(t => REVERIFY_DONE || !t.done || (ONLY && ONLY.has(String(t.id))))
  let levelDidWork = false
  if (todo.length) {
    phase(`Level ${li}`)
    log(`Level ${li}/${levels.length - 1}: [${todo.map(t => t.id).join(', ')}] (sequential)`)
    // SEQUENTIAL: each implementer writes the shared tree in turn (DESIGN D-dev-1).
    const results = []
    for (const t of todo) results.push(await runTask(t))
    for (const r of results.filter(Boolean)) state[r.id] = r
    levelDidWork = results.some(r => r && !r.skipped)  // a pure-skip level changed no code

    // dynamic pause — an implementer hit an R4 (architectural) it cannot auto-resolve.
    const blocked = results.find(r => r && r.impl && r.impl.status === 'blocked')
    if (blocked) return collect(state, { paused: true, pauseKind: 'R4', atTask: blocked.id, payload: pausePayload(blocked, (blocked.impl || {}).deviations || 'R4 architectural escalation') })

    // hard gate failure (not R4) → stop for the skill's onlyChecks fix loop.
    const failed = results.find(r => r && !r.pass && !(r.impl && r.impl.status === 'blocked'))
    if (failed) return collect(state)

    // declared pause — a planned decision point implemented this run and not yet cleared.
    const gateRes = results.find(r => r && !r.skipped && byId[r.id] && byId[r.id].pauseAfter && !CLEARED.has(r.id))
    if (gateRes) return collect(state, { paused: true, pauseKind: 'decision', atTask: gateRes.id, payload: pausePayload(gateRes, byId[gateRes.id].pauseAfter) })
  } else {
    layer.forEach(t => { state[String(t.id)] = { id: String(t.id), impl: null, gate: null, pass: true, skipped: true } })
  }

  // hybrid full-suite checkpoint — pause so the skill runs the full suite before advancing past a
  // cross-level-overlap boundary. Only when: this level actually implemented something (a pure-skip
  // level changed no code, so no regression is possible — keeps the all-done resume a 0-pause no-op),
  // more levels remain (the last level's check is the skill's once-at-end), and it's not already cleared.
  if (levelDidWork && FULLSUITE_LEVELS.has(li) && li < levels.length - 1 && !CLEARED_FS.has(li)) {
    return collect(state, { paused: true, pauseKind: 'fullsuite', atLevel: li,
      payload: { decision: `Cross-level file overlap at level ${li}: run the full test suite before advancing. If green, resume with clearedFullSuite += ${li}; if red, fix via onlyChecks then resume.`,
                 levelTasks: levels[li], filesThisLevel: levels[li].flatMap(id => (byId[id]?.files) || []) } })
  }
}

return collect(state, { done: true })
