// ============================================================================
// run-core.js  —  the SHARED compiled-runner core (pass #9 extraction).
//
// ONE driver + helpers + result schema, shared by every codegen instance
// (ds, dev today; future domains via the birther). A per-domain compiler
// (scripts/<domain>/<domain>_compile.py) SPLICES this file together with a
// per-domain CODE FRAGMENT (templates/<domain>-task.js) and the plan DATA,
// emitting a self-contained <project>/.planning/run.js that the domain's
// implement-skill runs via Workflow({ scriptPath: ".planning/run.js", args }).
//
// Why splice and not import: Workflow scripts have NO filesystem/import at
// runtime (only agent/parallel/log/phase/args/return), and run.js lives in an
// EXTERNAL project dir with no path back to the plugin — so the shared core is
// inlined at compile time, never required at runtime.
//
// The SIX doctrine invariants live HERE so every generated run.js inherits them:
//   (1) payload > pass/fail — every pause carries deviations + a numbered summary;
//   (2) mandatory R4 — grain/schema/interface/architecture changes BLOCK + pause;
//   (3) the probe corroborates the artifact INDEPENDENTLY of the pass signal —
//       `pass` (the deterministic gate verdict) and `artifactsPresent` (the
//       existence check) are TWO booleans and the CORE ANDs them; a domain MUST
//       NOT fold presence into pass (that re-opens the funnel-clobber blind spot);
//   (4) adversarial review stays OUTSIDE this script (the skill's ground truth);
//   (5) no LLM between a structured producer and a strict checker — the gate is
//       a real exit code / mechanical floor run by an independent probe agent;
//   (6) emitter-canonical — the plan is born canonical; the parser's tolerance is
//       a back-compat shim, not the primary defense.
//
// The per-domain FRAGMENT (spliced at the __TASK_BODIES__ hole) MUST define, in scope:
//   async gateProbe(t)   -> { pass, artifactsPresent, evidence, scope:{checked,notChecked} }
//                           (the runner-side probe is ALWAYS deterministic; the
//                            semantic authority, if any, lives OUTSIDE run.js)
//   implementerPrompt(t) -> string
//   function recheckTrigger(results, li) -> { recheckKind, payload } | null
//                           (OPTIONAL — omit for domains with no mid-run recheck; do NOT
//                            return atLevel — the core supplies it from `li` directly)
//
// Holes (each a block-comment token the compiler replaces verbatim, exactly once):
//   __META__              meta object literal
//   __PROJECT__           absolute project dir string literal
//   __TASKS__             array-of-task-spec literal (carries D3 columns + D4 tier)
//   __GLOBAL_CONSTRAINTS__ verbatim Global Constraints body string literal ("" if none)
//   __LEVEL_MODES__       per-level 'parallel'|'sequential' array (COMPILER-DERIVED intraLevel)
//   __REQUIRE_OUTPUTS_PRODUCED__  bool literal: true forces the `outputsProduced` self-report
//                          (ds); false leaves it optional/advisory (dev has no such field)
//   __TASK_BODIES__       the per-domain code fragment (gateProbe/implementerPrompt/recheckTrigger)
// ============================================================================

export const meta = /*__META__*/

const PROJECT = /*__PROJECT__*/
const TASKS   = /*__TASKS__*/
const GLOBAL_CONSTRAINTS = /*__GLOBAL_CONSTRAINTS__*/
const LEVEL_MODES = /*__LEVEL_MODES__*/   // intraLevel, derived by the compiler from declared-output disjointness + isolation-safety
const REQUIRE_OUTPUTS_PRODUCED = /*__REQUIRE_OUTPUTS_PRODUCED__*/   // compiler-set: ds=true (output-first forcing function), dev=false

// ── args (carry human decisions across pauses; Workflow scripts have no disk) ──
let cfg = (typeof args === 'string') ? (() => { try { return JSON.parse(args) } catch { return {} } })() : (args || {})
const DECISIONS = cfg.decisions || {}                                  // { taskId: "the human's call" }
const CLEARED   = new Set((cfg.clearedPauses || []).map(String))       // declared pauses already resolved
const ONLY      = (Array.isArray(cfg.onlyChecks) && cfg.onlyChecks.length) ? new Set(cfg.onlyChecks.map(String)) : null
const REVERIFY_DONE = !!cfg.reverifyDone                               // re-probe PLAN `[x]` tasks instead of blind-skipping (clobber-safe resume)
const CLEARED_RECHECK = new Set((cfg.clearedFullSuite || []).map(Number))   // level indices whose yield-for-recheck the skill already passed

// ── unified implementer-result schema (shared base + domain-optional fields) ──
const TRANSFORM_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['task', 'status', 'filesTouched', 'deviations', 'summary'],
  properties: {
    task: { type: 'string', description: 'echo the task id verbatim — the gate keys on it' },
    status: { type: 'string', enum: ['implemented', 'blocked', 'error'] },
    filesTouched: { type: 'array', items: { type: 'string' }, description: 'repo-relative paths created/edited' },
    deviations: { type: 'string', description: 'R1/R2/R3 auto-fixed verbatim; R4 escalation reason if status=blocked' },
    summary: { type: 'string', description: 'one line: what was produced + SPEC IDs + the KEY OUTPUT NUMBERS / test result' },
    // domain-optional (required-ness enforced by the per-domain implementerPrompt text):
    outputsProduced: { type: 'boolean', description: 'ds output-first: did you create every declared Outputs artifact?' },
    testWritten: { type: 'boolean', description: 'dev TDD: did you write the failing test FIRST and see it RED?' },
    verifyPassed: { type: 'boolean', description: 'dev: did the Verify Command exit 0 after implementation? (advisory)' },
    verifyOutput: { type: 'string', description: 'dev: last ~25 lines of the Verify Command output you saw (proof)' },
  },
}
// ds forces the self-report: when REQUIRE_OUTPUTS_PRODUCED, `outputsProduced` must be present
// AND true (not merely !== false) — restores the pre-extraction ds forcing function without
// naming "ds" in the shared core (a compiled config hole flips it per-domain).
if (REQUIRE_OUTPUTS_PRODUCED) TRANSFORM_SCHEMA.required.push('outputsProduced')

// ── per-domain fragment (spliced ABOVE first use: gateProbe / implementerPrompt / recheckTrigger) ──
/*__TASK_BODIES__*/

// ── core helpers ──────────────────────────────────────────────────────────────
const byId = Object.fromEntries(TASKS.map(t => [String(t.id), t]))

// DEFERRED (see PR): unify this tie-breaker with scripts/lib/plan_table_core.toposort_ids's
// Python twin (same numeric-suffix sort, independently maintained). Any change here must stay
// ORDER-COMPATIBLE with that function — both must place the same task ids in the same levels
// in the same order, since the compiler's LEVEL_MODES/tier decisions are computed over the
// Python levels but the runtime driver walks these JS levels.
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

async function runTask(t) {
  // 1. idempotent short-circuit — skip only if the gate passes AND the declared artifact
  //    actually exists (a stale/clobbered artifact must NOT count as already-done). The
  //    CORE conjoins the two independent booleans the probe returns (doctrine iii).
  if (!(ONLY && ONLY.has(String(t.id)))) {
    const probe = await gateProbe(t)
    if (probe.pass && probe.artifactsPresent) { log(`↳ ${t.id}: already satisfied (skip implement)`); return { id: String(t.id), impl: null, gate: probe, pass: true, skipped: true } }
  }
  // 2. implement (the real work — D4 tier rides on the task spec; absent → inherit session model)
  const opts = { label: `task:${t.id}`, phase: 'Implement', schema: TRANSFORM_SCHEMA }
  if (t.tier) opts.model = t.tier
  if (t.effort) opts.effort = t.effort
  const impl = await agent(implementerPrompt(t), opts)
  if (!impl || impl.status === 'blocked') return { id: String(t.id), impl, gate: null, pass: false }
  // 3. authoritative gate — fresh independent probe; the CORE ANDs pass && artifactsPresent
  //    (never trusts pass alone) so "gate passed but artifact missing/clobbered" stays a distinct finding.
  const gate = await gateProbe(t)
  const outputsOk = REQUIRE_OUTPUTS_PRODUCED ? impl.outputsProduced === true : impl.outputsProduced !== false
  return { id: String(t.id), impl, gate, pass: !!gate.pass && gate.artifactsPresent !== false && outputsOk }
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
// NOT just the gate's pass/fail. In the muni run the JS gate caught zero bugs; every bug was
// caught by a deviation note or by adversarial review reading these numbers (doctrine i).
function pausePayload(r, decision) {
  const t = byId[r.id] || {}
  const impl = r.impl || {}
  const p = {
    task: r.id, name: t.name, decision,
    summary: impl.summary || '',          // KEY OUTPUT NUMBERS / test result
    deviations: impl.deviations || '',    // what the implementer changed/escalated — the bug channel
    filesTouched: impl.filesTouched || [],
    gate: r.gate || null,
  }
  if (t.expectedOutput) p.expectedOutput = t.expectedOutput     // ds
  if (t.failingTest) p.failingTest = t.failingTest              // dev
  if (t.verify) p.verifyCommand = t.verify
  if (impl.verifyOutput) p.verifyOutput = String(impl.verifyOutput).slice(0, 1500)  // dev
  return p
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
    else if (REQUIRE_OUTPUTS_PRODUCED ? impl.outputsProduced !== true : impl.outputsProduced === false) findings.push({ ...base, detail: 'declared Outputs not produced' })
    else if (r.gate && r.gate.artifactsPresent === false) {
      const miss = (r.gate.evidence && r.gate.evidence.missing) ? r.gate.evidence.missing : 'a declared artifact'
      findings.push({ ...base, detail: `gate passed but ${miss} missing/empty (stale/clobbered): ${(t.outputs || t.files || []).join(', ')}` })
    }
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

// ── driver — one loop; intraLevel mode is COMPILER-DERIVED (LEVEL_MODES) ───────
const levels = toposort(TASKS)
const state = {}
log(`run-core: ${TASKS.length} task(s), ${levels.length} dependency level(s)${ONLY ? `; re-run ${ONLY.size}` : ''}`)

for (let li = 0; li < levels.length; li++) {
  const layer = levels[li].map(id => byId[id]).filter(Boolean)
  // A PLAN `[x]` (t.done) is the prior run's verified mark; by default trust it and blind-skip.
  // args.reverifyDone routes done tasks through the cheap gate-first probe for paranoid resumes.
  const todo = layer.filter(t => REVERIFY_DONE || !t.done || (ONLY && ONLY.has(String(t.id))))
  const mode = LEVEL_MODES[li] || 'sequential'
  let results = []
  let levelDidWork = false
  if (todo.length) {
    // Stamp the blind-skipped `[x]` tasks THIS layer also holds (a mixed level: some done, some
    // todo) with the same skip-state shape the all-done branch below uses — otherwise they get
    // no state entry at all, so collect() under-counts tasksDone/over-counts tasksRemaining and
    // scoreTable shows '·' (never-run) for work that was already verified done.
    layer.filter(t => !todo.includes(t)).forEach(t => {
      state[String(t.id)] = { id: String(t.id), impl: null, gate: null, pass: true, skipped: true }
    })
    phase(`Level ${li}`)
    log(`Level ${li}/${levels.length - 1}: [${todo.map(t => t.id).join(', ')}] (${mode})`)
    if (mode === 'parallel') {
      results = (await parallel(todo.map(t => () => runTask(t)))).filter(Boolean)
    } else {
      for (const t of todo) results.push(await runTask(t))
      results = results.filter(Boolean)
    }
    for (const r of results) state[r.id] = r
    levelDidWork = results.some(r => r && !r.skipped)  // a pure-skip level changed nothing

    // RETURN-REASON 'pause-human' (R4) — an implementer hit an R4 it cannot auto-resolve
    // (grain/schema/architecture); a HUMAN must decide. Surfaces deviations + numbers, not a bare code.
    const blocked = results.find(r => r.impl && r.impl.status === 'blocked')
    if (blocked) return collect(state, { returnReason: 'pause-human', pauseKind: 'R4', atTask: blocked.id, payload: pausePayload(blocked, (blocked.impl || {}).deviations || 'R4 escalation') })

    // RETURN-REASON 'hard-fail' — a hard gate failure (not R4) stops the run for the skill's onlyChecks fix loop.
    const failed = results.find(r => !r.pass && !(r.impl && r.impl.status === 'blocked'))
    if (failed) return collect(state, { returnReason: 'hard-fail' })

    // RETURN-REASON 'pause-human' (declared) — a planned ⏸ decision point implemented this run, not yet cleared.
    const gateRes = results.find(r => !r.skipped && byId[r.id] && byId[r.id].pauseAfter && !CLEARED.has(r.id))
    if (gateRes) return collect(state, { returnReason: 'pause-human', pauseKind: 'declared', atTask: gateRes.id, payload: pausePayload(gateRes, byId[gateRes.id].pauseAfter) })
  } else {
    layer.forEach(t => { state[String(t.id)] = { id: String(t.id), impl: null, gate: null, pass: true, skipped: true } })
  }

  // RETURN-REASON 'yield-for-recheck' — an AUTOMATED cross-cutting gate (NO human decides; its own
  // channel, never muxed onto pause-human). The fragment decides whether this level needs it (dev:
  // cross-level file overlap → full suite); the core fires only when the level did real work, more
  // levels remain, and the skill hasn't already cleared it. atLevel is `li` itself — the fragment's
  // recheckTrigger receives `li` as an argument, so it never needs to echo it back in its return.
  const rt = (typeof recheckTrigger === 'function') ? recheckTrigger(results, li) : null
  if (levelDidWork && rt && li < levels.length - 1 && !CLEARED_RECHECK.has(li)) {
    return collect(state, { returnReason: 'yield-for-recheck', recheckKind: rt.recheckKind, atLevel: li, payload: rt.payload })
  }
}

return collect(state, { returnReason: 'done' })
