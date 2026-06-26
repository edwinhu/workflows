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
// the FOUR INJECTED SEAMS D1-D4 (marked ▼ SEAM). Leave the driver + the invariants
// alone — they are the SHARED CORE; see ds-run-template.js / dev-run-template.js for
// live ones, and `docs/common-infra-candidates.md` for the CANONICAL seam list (the
// source of truth: shared seams S1-S7, injected seams D1-D4, the 6 doctrine invariants).
//
// THE FOUR INJECTED SEAMS (the real per-domain fork — everything else is core):
//   D1  gateProbe(t)        → {pass, outputsPresent, evidence, scope}  (pass ALWAYS deterministic; scope discloses the floor's blind spot)
//   D2  implementerPrompt(t)→ how one task is produced (output-first vs TDD failing-test-first)
//   D3  task-spec COLUMNS   → the __TASKS__ shape (fed to the deterministic parser)
//   D4  tier/effort policy  → t.tier/t.effort (ds: heuristic by weight · dev: inherit session model)
// NOT a seam: intra-level parallel-vs-sequential is CORE — the COMPILER DERIVES it (parallel IFF a
// level's declared outputs are provably DISJOINT, else sequential). Never hand-set it as a constant.
//
// THE SAFETY INVARIANTS baked in here (subset of the 6 doctrine invariants that live in the runtime;
// the other two — no-LLM-between-producer-and-checker and emitter-canonical — live in the parser/compiler):
//   (i)   payload > pass/fail — pause/finding payloads carry deviations + a NUMBERED
//         summary, never a bare exit code (the gate caught zero bugs in ds/dev;
//         deviations + adversarial review caught them).
//   (ii)  mandatory R4 — an assumption/contract/architecture change BLOCKS (pause),
//         never auto-resolves to pass a gate; a stale-gate backstop re-blocks.
//   (iii) the probe corroborates ARTIFACTS-EXIST independently of the pass signal (a pass
//         can be stale OR gamed in every domain).
//   (iv)  the adversarial/full-suite/review layer stays OUTSIDE this run.js (and is PRIMARY,
//         not a backstop, when the gate trust-class is judgment — it can lie where an exit code can't).
//
// Holes the compiler replaces verbatim, exactly once:
//   __META__     meta object literal
//   __PROJECT__  absolute project dir string literal
//   __TASKS__    array-of-task-spec literal (shape = ▼ D3)
// ============================================================================

export const meta = /*__META__*/

const PROJECT = /*__PROJECT__*/
// ▼ D3 (task-spec COLUMNS) — the compiler inlines __TASKS__ as an array of task specs whose shape is the
//   domain's column-map fed to the deterministic parser. Per task: id, name, deps, outputs, expectedOutput,
//   verify, implements, kind, tier, effort, done, pauseAfter, taskText. ds: Outputs/Expected/Verify;
//   dev: Files/Failing Test/Verify Command. Add/rename columns here + in <domain>_plan_table.py together.
const TASKS   = /*__TASKS__*/

// ── args (carry human decisions across pauses; Workflow scripts have no disk) ──
let cfg = (typeof args === 'string') ? (() => { try { return JSON.parse(args) } catch { return {} } })() : (args || {})
const DECISIONS = cfg.decisions || {}                                  // { taskId: "the human's call" }  (behavior-only decisions)
const CLEARED   = new Set((cfg.clearedPauses || []).map(String))       // declared pauses already resolved
const ONLY      = (Array.isArray(cfg.onlyChecks) && cfg.onlyChecks.length) ? new Set(cfg.onlyChecks.map(String)) : null
const REVERIFY_DONE = !!cfg.reverifyDone                               // re-probe PLAN `[x]` tasks instead of blind-skipping (clobber-safe resume)

// ── schemas ───────────────────────────────────────────────────────────────
// ▼ D1 (gate return contract) — {pass, outputsPresent, evidence, scope}. `pass` is ALWAYS
//   DETERMINISTIC — an exit code (ds/dev: the gate IS the probe, sufficient) OR a mechanical
//   FLOOR (semantic domains: necessary-NOT-sufficient). There is NEVER a returned judgment inside
//   the probe — so there is nothing in the runner to game. For a semantic domain the SUFFICIENT
//   authority is the adversarial review OUTSIDE run.js (doctrine #4), not this probe.
//   `scope` discloses the floor's BLIND SPOT (doctrine #3): a clean pass:true must NEVER imply it
//   verified tokens/quantities it couldn't check (writing's Bluebook regex floor false-positived on
//   "§ 78mm" and was blind to spelled-out numbers — it must SAY so, not pass silently). This is the
//   floor's analog of the "vague-evidence pass = the failure mode in a judge's robe" guard.
//   Keep `evidence` numbered/specific and stating its scope; a semantic floor wants a non-haiku tier.
const GATE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['pass', 'outputsPresent', 'evidence', 'scope'],
  properties: {
    pass: { type: 'boolean', description: 'true IFF the DETERMINISTIC gate passed (exit-code: the Verify command exited 0; mechanical floor: the structural/floor check passed). NEVER a returned judgment.' },
    outputsPresent: { type: 'boolean', description: 'true IFF every declared output artifact exists AND is non-empty — checked INDEPENDENTLY of the gate (a gate can pass on a stale/clobbered artifact). true when none were declared.' },
    evidence: { type: 'string', description: 'numbered/specific proof it ran (exit-code: last ~25 lines; floor: the cited specifics) AND a statement of what it did NOT check. NOT a bare pass/fail.' },
    scope: { type: 'string', enum: ['checked', 'not-checked'], description: 'coverage disclosure: "checked" iff the gate actually verified the full claim; "not-checked" iff it is a necessary-not-sufficient floor with a blind spot (the sufficient authority is the adversarial review outside run.js).' },
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

// SOUND intra-level disjointness — parallel is safe ONLY when every task's declared outputs are
// statically-known CONCRETE files AND no normalized output path is a prefix of another. String-
// uniqueness is NOT enough: `data/out/` (dir) vs `data/out/x.parquet` are distinct strings but nested;
// a glob (`a/*.csv`) is not statically provable. Any doubt ⇒ sequential (a shared-tree corruption in a
// BIRTHER template propagates to every copier). LIMIT: this reasons only about DECLARED outputs — if a
// domain's tasks also touch UNDECLARED shared files (imports, a barrel/index), declared-disjoint is not
// real disjointness, so that domain's compiler must NOT populate concrete `outputs` for such tasks (→
// sequential here) — that is why dev (shared tree) stays sequential. Future: per-task
// opts.isolation:'worktree' is a 2nd input that makes parallel safe even on a shared tree — add it here.
function provablyDisjoint(todo) {
  if (todo.length < 2 || !todo.every(t => (t.outputs || []).length)) return false
  const norm = p => String(p).replace(/\/+$/, '')                       // strip trailing slash
  const isDirOrGlob = p => /[*?{}\[\]]/.test(p) || /\/$/.test(p) || !/\.[A-Za-z0-9]+$/.test(norm(p).split('/').pop())
  const all = todo.flatMap(t => (t.outputs || []).map(norm))
  if (all.some(p => isDirOrGlob(p))) return false                       // dir/glob ⇒ not statically provable
  for (let i = 0; i < all.length; i++) for (let j = 0; j < all.length; j++) {
    if (i === j) continue
    if (all[i] === all[j] || all[i].startsWith(all[j] + '/')) return false  // equal or nested-prefix ⇒ overlap
  }
  return true
}

// ▼ D1 (gateProbe body): how a task is gated. An INDEPENDENT cheap agent runs the
//   gate AND confirms declared outputs exist (invariant iii). Swapping exit-code ⇄
//   judgment ⇄ mechanical-floor is an isolated change to THIS one function. NEVER let
//   the implementer's self-report be the gate. (Default below = exit-code shape.)
async function gateProbe(t) {
  if (!t.verify) return { pass: false, outputsPresent: false, evidence: '(no Verify/gate in the plan row)', scope: 'not-checked' }
  const outs = (t.outputs || []).filter(Boolean)
  return agent(
    `Run EXACTLY this gate from ${PROJECT} and report the result. Do NOT create, edit, fix, or analyze anything — only run it and report.\n\n    ${t.verify}\n\n`
    + (outs.length
        ? `Then INDEPENDENTLY confirm each declared output below EXISTS and is non-empty (an \`ls\` / one-line check — do NOT recompute it; a gate can pass while the artifact is stale or clobbered):\n${outs.map(o => '    ' + o).join('\n')}\n\n`
        : '')
    + `Return { pass: <true iff the DETERMINISTIC gate passed — exit code 0 / floor check passed; never a judgment>, outputsPresent: <true iff every declared output above exists and is non-empty${outs.length ? '' : '; true since none were declared'}>, evidence: "<numbered/specific proof — last ~25 lines or cited specifics — AND a statement of what this gate did NOT verify>", scope: <"checked" iff the gate verified the FULL claim, else "not-checked" — a necessary-not-sufficient floor with a blind spot> }.`,
    { label: `gate:${t.id}`, phase: 'Gate', schema: GATE_SCHEMA, model: 'haiku', effort: 'low' })
}

// ▼ D2 — implementerPrompt(t): how ONE task is produced. Domain role + protocol.
//   Keep the MANDATORY R4 block + the stale-gate backstop verbatim (invariant ii) —
//   only the domain's role line and its R4 list (what counts as an assumption change)
//   change per domain. The "what" is pinned by the plan row — no scope latitude.
function implementerPrompt(t) {
  const role = 'You are a domain implementer. <D2: domain role + determinism/idempotency/schema rules>.'
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
   ⛔ MANDATORY R4 — you may NOT auto-resolve these to make the gate pass; set status="blocked" and put the decision + the conflicting NUMBERS in deviations (the run pauses, a human decides): <D2: the domain's assumption/contract/architecture-change list>. "I changed an assumption so the gate would pass" is always a blocked R4.
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
  // 2. implement (the real work). ▼ D4 (tier/effort policy): t.tier/t.effort come from the compiler's
  //    domain policy — ds: heuristic by task weight; dev: inherit the session model (TDD needs capability,
  //    so omit t.tier and let it default). Pull this policy out of the shared compiler, not hardcoded here.
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

// yield-for-recheck TRIGGER (optional, domain-filled) — distinct from a human pause. Return a
// recheckKind string to yield control so the SKILL runs an AUTOMATED cross-cutting gate (dev: the full
// test suite when a level re-touched an earlier level's file AND did real work; the skill runs the suite
// and AUTO-RESUMES on green — no human). Returning null (default) means "no recheck". Do NOT route this
// through the pause channel — muxing an automated recheck onto a human decision is the anti-pattern this
// channel exists to prevent. ds's analog (validate-coverage) runs once at end-of-run at the SKILL level,
// so ds leaves this hook returning null.
const TOUCHED = {}                                                    // level index → Set(files written so far)
function recheckTrigger(results, li) {
  // ▼ DOMAIN HOOK (default: no recheck). Example (dev's fullsuite): yield when this level wrote a file an
  //   EARLIER level already owned (a cross-cutting change the per-task gate can't see).
  //   const wrote = results.flatMap(r => (r.impl && r.impl.filesTouched) || [])
  //   const earlier = new Set(Object.entries(TOUCHED).filter(([k]) => +k < li).flatMap(([, s]) => [...s]))
  //   if (results.some(r => r.impl && r.impl.status === 'implemented') && wrote.some(f => earlier.has(f))) return 'fullsuite'
  return null
}

// ── driver (topo → level-parallel → gate-first skip → return-reasons) ─────────
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
  // intra-level execution is CORE, not a seam: DERIVE disjointness (parallel IFF this level's tasks
  // write provably-disjoint, statically-known declared outputs — ds's disjoint parquets qualify; dev's
  // shared tree never does → sequential by construction). A naive hand-set parallel copy corrupts a
  // shared tree. provablyDisjoint() is conservative: dir/glob/nested-prefix ⇒ sequential.
  const par = provablyDisjoint(todo)
  log(`Level ${li}/${levels.length - 1}: [${todo.map(t => t.id).join(', ')}]${todo.length > 1 ? (par ? ' (parallel — disjoint outputs)' : ' (sequential)') : ''}`)
  let results
  if (par) {
    results = (await parallel(todo.map(t => () => runTask(t)))).filter(Boolean)
  } else {
    results = []
    for (const t of todo) { const r = await runTask(t); if (r) results.push(r) }
  }
  for (const r of results) state[r.id] = r
  TOUCHED[li] = new Set(results.flatMap(r => (r.impl && r.impl.filesTouched) || []))

  // RETURN-REASON 1 — pause-human / dynamic R4: an implementer hit an R4 it cannot auto-resolve
  // (invariant ii). Surfaces the deviations + numbers, never a bare exit code (invariant i).
  const blocked = results.find(r => r.impl && r.impl.status === 'blocked')
  if (blocked) return collect(state, { paused: true, pauseKind: 'R4', atTask: blocked.id, payload: pausePayload(blocked, (blocked.impl || {}).deviations || 'R4 escalation') })

  // RETURN-REASON 2 — hard-fail: a gate failure (not R4) stops the run for the skill's fix loop.
  const failed = results.find(r => !r.pass && !(r.impl && r.impl.status === 'blocked'))
  if (failed) return collect(state)

  // RETURN-REASON 4 — pause-human / declared: a planned decision point not yet cleared. Checked BEFORE
  // the recheck and keyed ONLY on `pauseAfter && !CLEARED` (NOT on this-run `!r.skipped`), so a declared
  // pause SURVIVES a resume: on re-invoke the pausing task gate-first-skips, but the pause still surfaces
  // until the human clears it (rides in args.clearedPauses). Dropping a human decision because the work
  // happened in a prior invocation is exactly the autopilot-past-a-gate failure the pattern forbids.
  const gateRes = results.find(r => byId[r.id] && byId[r.id].pauseAfter && !CLEARED.has(r.id))
  if (gateRes) return collect(state, { paused: true, pauseKind: 'decision', atTask: gateRes.id, payload: pausePayload(gateRes, byId[gateRes.id].pauseAfter) })

  // RETURN-REASON 3 — yield-for-recheck: an AUTOMATED cross-cutting gate (NO human). Its OWN channel,
  // never muxed onto a pause. The skill runs the recheck (e.g. full suite) and auto-resumes on green.
  // CONSTRAINT: do NOT co-locate a recheck trigger and a declared ⏸ pause on the SAME level. The recheck
  // trigger derives from THIS-invocation `results`, which a resume erases (the level gate-first-skips) —
  // so a level that both pauses and rechecks would surface the pause first, then lose the recheck on the
  // post-clear resume. Split them across levels (a recheck level carries no pauseAfter). A durable
  // recheck (tracked in args like clearedPauses) is the core's next increment; until then this is a
  // compile-time constraint, not a runtime guarantee.
  const recheckKind = recheckTrigger(results, li)
  if (recheckKind) return collect(state, { yieldForRecheck: true, recheckKind, atLevel: li })
}

return collect(state, { done: true })
