// ============================================================================
// ds-task.js  —  the ds per-domain FRAGMENT spliced into run-core.js by ds-compile.
//
// This is a CODE FRAGMENT, not a module: no import/export. It is inlined into
// run-core's lexical scope (sees PROJECT, TASKS, DECISIONS, GLOBAL_CONSTRAINTS,
// agent, log, …) and supplies the ds bodies for the three injected interfaces:
//   gateProbe(t)         — D1: run the Verify command + confirm Outputs exist
//   implementerPrompt(t) — D2: ds is OUTPUT-FIRST (produce the artifact, then probe)
//   (no recheckTrigger — ds has no mid-run cross-cutting recheck; ds-validate-
//    coverage runs once at end, OUTSIDE this script)
//
// gateProbe returns the CANONICAL contract { pass, artifactsPresent, evidence,
// scope } — `pass` is the deterministic Verify exit code, `artifactsPresent` is
// the INDEPENDENT outputs-exist check; the core ANDs them (doctrine iii).
// ============================================================================

// raw shape the independent probe agent returns (mapped into the canonical contract below)
const GATE_PROBE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['exit0', 'outputsPresent', 'tail'],
  properties: {
    exit0: { type: 'boolean', description: 'true IFF the Verify command exited 0' },
    outputsPresent: { type: 'boolean', description: 'true IFF every declared Outputs artifact exists AND is non-empty — checked independently of Verify, because a Verify can pass on a stale/clobbered artifact (e.g. a funnel silently overwritten to 3 of 11 years). true when no outputs were declared.' },
    tail: { type: 'string', description: 'last ~25 lines of output, as proof it actually ran' },
  },
}

// The single source of gate truth: an independent cheap agent runs ONLY the Verify
// command AND confirms the declared Outputs exist+non-empty (a Verify can pass on a
// stale/clobbered artifact). Swapping this for an implementer self-report (D1) is an
// isolated change to this one fn.
async function gateProbe(t) {
  if (!t.verify) return { pass: false, artifactsPresent: false, evidence: { tail: '(no Verify command in the plan row)' }, scope: { checked: [], notChecked: ['Verify exit code (no command declared)'] } }
  const outs = (t.outputs || []).filter(Boolean)
  const raw = await agent(
    `Run EXACTLY this command from ${PROJECT} and report the result. Do NOT create, edit, fix, or analyze anything — only run it and report.\n\n    ${t.verify}\n\n`
    + (outs.length
        ? `Then INDEPENDENTLY confirm each declared output artifact below EXISTS and is non-empty (an \`ls\` / a one-line row-count — do NOT recompute or re-derive it; a Verify can exit 0 while the artifact is stale or clobbered):\n${outs.map(o => '    ' + o).join('\n')}\n\n`
        : '')
    + `Return { exit0: <true iff the process exited 0>, outputsPresent: <true iff every declared output above exists and is non-empty${outs.length ? '' : '; true since none were declared'}>, tail: "<last ~25 lines of output, as proof>" }.`,
    { label: `gate:${t.id}`, phase: 'Gate', schema: GATE_PROBE_SCHEMA, model: 'haiku', effort: 'low' })
  // canonical contract: pass = the deterministic Verify verdict ALONE; artifactsPresent = the
  // independent outputs-exist check (the core ANDs them — never folds presence into pass).
  return {
    pass: !!raw.exit0,
    artifactsPresent: raw.outputsPresent !== false,
    evidence: { tail: raw.tail, missing: raw.outputsPresent === false ? 'a declared output' : null },
    scope: {
      checked: ['Verify command exit code', outs.length ? 'declared Outputs exist + non-empty' : 'no Outputs declared'],
      notChecked: ['semantic correctness of the Outputs (the values themselves) — that is the implementer summary + adversarial review, OUTSIDE this probe'],
    },
  }
}

function implementerPrompt(t) {
  const role = t.kind === 'engineer'
    ? 'You are a ds-ENGINEER (pipeline/ETL): enforce determinism (no unseeded randomness, stable sort), idempotency (re-running produces the same Outputs), and schema validation on the output.'
    : t.kind === 'analyst'
      ? 'You are a ds-ANALYST: verify every number against the data; no hand-waved results.'
      : 'You are a ds implementer.'
  const decision = DECISIONS[String(t.id)]
    ? `\nHUMAN DECISION for this task (honor it EXACTLY in the output): ${DECISIONS[String(t.id)]}\n  ⚠ STALE-GATE BACKSTOP: if this decision changes the GRAIN / KEY / SCHEMA but the Verify assertion above still encodes the OLD one, do NOT revert your output (e.g. re-dedup) to satisfy the stale gate. Honor the decision in the data, then RE-BLOCK (status="blocked") and state in deviations that the PLAN's Verify must be updated to match the decision and recompiled. A decision honored in data while a stale gate forces a dedup is exactly the silent divergence we forbid.`
    : ''
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
4. summary MUST carry the KEY OUTPUT NUMBERS (final row counts, headline estimates, the tie-out figures named in Expected Output) — these are surfaced to the human at every pause and are the channel that catches gate-passing bugs (e.g. an 8.8% dedup that satisfies a grain assertion but silently changed the sample: 2015 = 3,736,998 vs the expected 4,096,611). A summary without numbers is a regression. Set outputsProduced=true once every declared Outputs artifact exists.
Return TRANSFORM_SCHEMA.`
}
