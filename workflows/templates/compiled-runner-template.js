// ============================================================================
// compiled-runner-template.js — the BIRTHER's generic <domain>-task.js FRAGMENT
// skeleton. Post pass-#9 (PR#29), the shared driver lives ONCE in run-core.js;
// the birther no longer carries a parallel driver copy. To scaffold a new
// compiled-runner workflow, COPY this to workflows/templates/<domain>-task.js
// and fill the three injected interfaces — nothing else.
//
// ── What this is ────────────────────────────────────────────────────────────
// A CODE FRAGMENT, not a module: NO import/export, function declarations only.
// The per-domain compiler (scripts/<domain>/<domain>_compile.py) SPLICES this
// into run-core.js's `__TASK_BODIES__` hole, so it runs in run-core's lexical
// scope and SEES (do not redeclare): PROJECT, TASKS, DECISIONS, GLOBAL_CONSTRAINTS,
// CLEARED, ONLY, the agent/parallel/log/phase primitives, and the shared
// TRANSFORM_SCHEMA. run-core owns the topo/level/runTask/return-reason driver +
// the six doctrine invariants — DO NOT reimplement any of them here.
//
// ── The three injected interfaces (D1/D2 + optional recheck) ─────────────────
//   async gateProbe(t)   -> { pass, artifactsPresent, evidence, scope:{checked,notChecked} }
//                           D1. `pass` is ALWAYS DETERMINISTIC (a real exit code OR a
//                           mechanical floor) — NEVER a returned LLM judgment. `pass` ⊥
//                           `artifactsPresent` are TWO booleans; run-core ANDs them — do
//                           NOT fold presence into pass. For a SEMANTIC domain the probe is
//                           a necessary-not-sufficient floor and the sufficient authority
//                           lives OUTSIDE run.js (adversarial review). `scope` discloses the
//                           floor's blind spot. Pick the trust-class from interview Q7.
//   implementerPrompt(t) -> string   D2. Domain role + protocol. Keep the MANDATORY-R4
//                           block + stale-gate backstop verbatim.
//   function recheckTrigger(results, li) -> { recheckKind, atLevel, payload } | null
//                           OPTIONAL — return a recheck only for an AUTOMATED cross-cutting
//                           gate (dev's full-suite on cross-level file overlap). OMIT the
//                           whole function for domains with no mid-run recheck.
//
// ── How <domain>_compile.py splices it (copy an active domain compiler) ──────
//   1. read run-core.js (template) + this fragment;
//   2. replace the SINGLE `/*__TASK_BODIES__*/` hole with the fragment FIRST
//      (so the exactly-once assertion below runs over the spliced text);
//   3. assert every data hole (__META__/__PROJECT__/__TASKS__/__GLOBAL_CONSTRAINTS__/
//      __LEVEL_MODES__) appears EXACTLY ONCE post-splice (a hole token leaking out of
//      the fragment/comments is a compile error), then fill them;
//   4. __LEVEL_MODES__ is COMPILER-DERIVED (S2): 'parallel' iff a level's declared
//      outputs are statically-known AND pairwise-disjoint AND the domain is
//      isolation-safe, else 'sequential' — never an author knob, never asked;
//   5. `node --check` the emitted .planning/run.js.
//
// Shared extension infrastructure: workflows/templates/run-core.js and
// scripts/lib/{compile_core.py,plan_table_core.py}. Domain compilers are optional.
// Canonical seam list: docs/common-infra-candidates.md.
// ============================================================================

// ▼ D1 — gateProbe(t): how ONE task is gated. An INDEPENDENT cheap agent runs the
//   gate; run-core ANDs pass && artifactsPresent. Return the CANONICAL contract.
//   Default below = the exit-code/artifact shape; for a semantic
//   floor, `pass` is the mechanical floor and the evidence states scope.notChecked
//   (copy scripts/writing/writing_gate_probe.py).
const GATE_PROBE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['pass', 'artifactsPresent', 'tail'],
  properties: {
    pass: { type: 'boolean', description: 'true IFF the DETERMINISTIC gate passed (exit code 0 / mechanical floor) — NEVER a returned judgment' },
    artifactsPresent: { type: 'boolean', description: 'true IFF every declared output artifact exists AND is non-empty — checked INDEPENDENTLY of the gate (a gate can pass on a stale/clobbered artifact). true when none declared.' },
    tail: { type: 'string', description: 'last ~25 lines / cited specifics, as proof it ran AND a statement of what it did NOT check' },
  },
}
async function gateProbe(t) {
  if (!t.verify) return { pass: false, artifactsPresent: false, evidence: { tail: '(no Verify/gate in the plan row)' }, scope: { checked: [], notChecked: ['gate (no command declared)'] } }
  const outs = (t.outputs || t.files || []).filter(Boolean)
  const raw = await agent(
    `Run EXACTLY this gate from ${PROJECT} and report the result. Do NOT create, edit, fix, or analyze anything — only run it and report.\n\n    ${t.verify}\n\n`
    + (outs.length
        ? `Then INDEPENDENTLY confirm each declared output below EXISTS and is non-empty (an \`ls\` / one-line check — do NOT recompute it; a gate can pass while the artifact is stale or clobbered):\n${outs.map(o => '    ' + o).join('\n')}\n\n`
        : '')
    + `Return { pass: <true iff the gate passed>, artifactsPresent: <true iff every declared output above exists and is non-empty${outs.length ? '' : '; true since none declared'}>, tail: "<last ~25 lines + what it did NOT check>" }.`,
    { label: `gate:${t.id}`, phase: 'Gate', schema: GATE_PROBE_SCHEMA, model: 'haiku', effort: 'low' })
  // pass = the deterministic gate verdict ALONE; artifactsPresent = the independent existence check.
  return {
    pass: !!raw.pass,
    artifactsPresent: raw.artifactsPresent !== false,
    evidence: { tail: raw.tail, missing: raw.artifactsPresent === false ? 'a declared output' : null },
    scope: {
      checked: ['the gate verdict', outs.length ? 'declared outputs exist + non-empty' : 'no outputs declared'],
      notChecked: ['<SEAM D1: what this deterministic gate does NOT verify — e.g. semantic correctness; that authority is the adversarial review OUTSIDE run.js>'],
    },
  }
}

// ▼ D2 — implementerPrompt(t): how ONE task is produced. Domain role + protocol.
//   Only the role line and the domain's R4 list change per domain; keep the
//   MANDATORY-R4 block + stale-gate backstop + numbered-summary clause verbatim.
function implementerPrompt(t) {
  const role = 'You are a <SEAM D2: domain> implementer. <determinism / idempotency / schema rules for this domain>.'
  const decision = DECISIONS[String(t.id)]
    ? `\nHUMAN DECISION for this task (honor it EXACTLY): ${DECISIONS[String(t.id)]}\n  ⚠ STALE-GATE BACKSTOP: if this decision changes the contract/grain/schema but the Verify above still encodes the OLD one, do NOT revert your output to satisfy the stale gate. Honor the decision, then RE-BLOCK (status="blocked") and state in deviations that the PLAN's Verify must be updated and recompiled.`
    : ''
  return `${role} You implement EXACTLY ONE planned task by writing DIRECTLY into ${PROJECT}. The "what" is pinned by the PLAN row — no latitude on scope.
Set task="${t.id}" verbatim (the gate keys on it).

TASK ${t.id}: ${t.name}
Implements (SPEC IDs): ${(t.implements || []).join(', ')}
Outputs to produce (under ${PROJECT}): ${(t.outputs || t.files || []).join(', ')}
Expected Output (proves completion): ${t.expectedOutput || t.failingTest || ''}
Verify/gate (make it pass HONESTLY — do not reshape inputs to satisfy it): ${t.verify}${decision}
${GLOBAL_CONSTRAINTS ? `\nGLOBAL CONSTRAINTS (apply to every task):\n${GLOBAL_CONSTRAINTS}\n` : ''}
FULL TASK TEXT FROM PLAN:
${t.taskText}

Protocol (NON-NEGOTIABLE):
1. Produce every declared output (write the code/artifact, run it, confirm it exists).
2. Run the Verify/gate yourself and read your own output — confirm it matches Expected Output (specific numbers/shape), not "looks right".
3. Deviations: R1 bug / R2 missing-critical / R3 blocking → auto-fix + re-verify + record in deviations.
   ⛔ MANDATORY R4 — you may NOT auto-resolve these to make the gate pass; set status="blocked" and put the decision + the conflicting NUMBERS in deviations (the run pauses, a human decides): <SEAM D2: the domain's assumption/contract/architecture-change list>. "I changed an assumption so the gate would pass" is always a blocked R4.
4. summary MUST carry the KEY OUTPUT NUMBERS named in Expected Output — these are surfaced at every pause and catch gate-passing bugs (doctrine i). A summary without numbers is a regression. Set outputsProduced=true once every declared output exists.
Return TRANSFORM_SCHEMA.`
}

// The shape below is a CONTRACT FOR THE DOMAIN AUTHOR'S function, not a promise this template
// keeps — the function is optional and is absent here on purpose. wc-probe's P5 reads a documented
// return shape as this file's own contract, which is right for a workflow script and wrong for a
// template that specifies one. Scoped to this block so a real contract added elsewhere is checked.
// <!-- wc-probe: ignore-returns:start -->
// ▼ OPTIONAL — recheckTrigger(results, li): yield-for-recheck (an AUTOMATED cross-cutting
//   gate; NO human). Return { recheckKind, atLevel, payload } to make run-core yield so the
//   SKILL runs the recheck (e.g. dev's full suite when a level re-touched an earlier level's
//   file) and auto-resumes on green. OMIT THIS FUNCTION ENTIRELY for domains with no mid-run
//   recheck — run-core checks `typeof recheckTrigger === 'function'`.
//
// function recheckTrigger(results, li) {
//   const wrote = results.flatMap(r => (r.impl && r.impl.filesTouched) || [])
//   // ... domain rule: does this level's work invalidate an earlier level's gate? ...
//   // return { recheckKind: 'fullsuite', atLevel: li, payload: { files: wrote } }
//   return null
// }
// <!-- wc-probe: ignore-returns:end -->
