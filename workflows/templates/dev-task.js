// ============================================================================
// dev-task.js  —  the dev per-domain FRAGMENT spliced into run-core.js by dev-compile.
//
// CODE FRAGMENT, not a module: no import/export. Inlined into run-core's lexical
// scope (sees PROJECT, TASKS, DECISIONS, GLOBAL_CONSTRAINTS, levels, byId, agent,
// log, …) and supplies the dev bodies for the three injected interfaces:
//   gateProbe(t)         — D1: run the Verify Command + confirm Files + the Failing Test exist
//   implementerPrompt(t) — D2: dev is TDD (write the failing test FIRST, RED→GREEN)
//   recheckTrigger(...)  — yield-for-recheck: a cross-level file-overlap level → full suite
//
// gateProbe returns the CANONICAL contract { pass, artifactsPresent, evidence,
// scope }: `pass` is the deterministic Verify exit code; the two presence checks
// (declared Files exist + the Failing Test exists) AND into the single canonical
// `artifactsPresent` — the core then ANDs pass && artifactsPresent (doctrine iii).
// ============================================================================

const testRequired = t => {
  const n = String(t.failingTest || '').trim().toLowerCase()
  return n !== '' && !/^(n\/?a|none)\b/.test(n)
}

// raw shape the independent probe agent returns (mapped into the canonical contract below)
const GATE_PROBE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['exit0', 'filesPresent', 'testPresent', 'tail'],
  properties: {
    exit0: { type: 'boolean', description: 'true IFF the Verify Command exited 0 (GREEN)' },
    filesPresent: { type: 'boolean', description: 'true IFF every declared Files artifact exists AND is non-empty — checked independently of the command (a Verify can exit 0 on a stale tree). true when no files were declared.' },
    testPresent: { type: 'boolean', description: 'true IFF the declared Failing Test actually exists in the tree (Grep/Read the test file) — the dev analog of outputs-present, catches a fake/missing test. true when the task declares Failing Test = N/A.' },
    tail: { type: 'string', description: 'last ~25 lines of the Verify Command output, as proof it actually ran' },
  },
}

// The single source of gate truth: an independent cheap agent runs ONLY the Verify Command,
// confirms the declared Files exist+non-empty, and confirms the Failing Test exists. Swapping
// this for an implementer self-report (D1) is an isolated change to this one fn.
async function gateProbe(t) {
  if (!t.verify) return { pass: false, artifactsPresent: false, evidence: { tail: '(no Verify Command in the plan row)', missing: 'a declared artifact' }, scope: { checked: [], notChecked: ['Verify Command exit code (no command declared)'] } }
  const files = (t.files || []).filter(Boolean)
  const needTest = testRequired(t)
  const raw = await agent(
    `Run EXACTLY this command from ${PROJECT} and report the result. Do NOT create, edit, fix, or analyze anything — only run it and report.\n\n    ${t.verify}\n\n`
    + (files.length
        ? `Then INDEPENDENTLY confirm each declared file below EXISTS and is non-empty (an \`ls\` / a quick read — do NOT recompute; a Verify can exit 0 on a stale tree):\n${files.map(f => '    ' + f).join('\n')}\n\n`
        : '')
    + (needTest
        ? `Then confirm the declared FAILING TEST exists in the tree (Grep/Read for it — it must be a real test that exercises code, not a stub):\n    ${t.failingTest}\n\n`
        : `(No failing test required — the task declares Failing Test = N/A.)\n\n`)
    + `Return { exit0: <true iff the process exited 0>, filesPresent: <true iff every declared file above exists and is non-empty${files.length ? '' : '; true since none were declared'}>, testPresent: <true iff the failing test exists${needTest ? '' : '; true since N/A'}>, tail: "<last ~25 lines of output, as proof>" }.`,
    { label: `gate:${t.id}`, phase: 'Gate', schema: GATE_PROBE_SCHEMA, model: 'haiku', effort: 'low' })
  const filesOk = raw.filesPresent !== false
  const testOk = needTest ? raw.testPresent !== false : true
  // canonical contract: pass = the deterministic Verify verdict ALONE; the two presence checks AND
  // into the single artifactsPresent (the core then ANDs pass && artifactsPresent — never folds presence into pass).
  return {
    pass: !!raw.exit0,
    artifactsPresent: filesOk && testOk,
    evidence: { tail: raw.tail, missing: !testOk ? 'failing test' : (!filesOk ? 'declared file' : null) },
    scope: {
      checked: ['Verify Command exit code (GREEN)', files.length ? 'declared Files exist + non-empty' : 'no Files declared', needTest ? 'Failing Test exists in the tree' : 'no Failing Test required'],
      notChecked: ['whether the test ASSERTS the right behavior, and whole-suite integration — that is dev-review + the full suite, OUTSIDE this probe'],
    },
  }
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
    ? `1. Write the failing test FIRST and run it — see it RED. ⚠ The RED must be because the BEHAVIOR under test is ABSENT, not because of a fixture/type bug (e.g. a numeric id where the type is a string makes the assertion miss for the wrong reason — a false RED that "goes GREEN" by fixing the fixture, implementing nothing). Confirm the RED is for the asserted behavior before writing code. Set testWritten=true.
2. Implement the minimum code to make it GREEN. Follow existing patterns; no \`any\`/\`@ts-ignore\`/suppression; no committing broken code.
3. Run the Verify Command (\`${t.verify}\`) from ${PROJECT}, capture its real output + exit code, set verifyPassed to the actual exit==0 and verifyOutput to the last ~25 lines.`
    : `1. (Failing Test = N/A — types-only/meta task.) Set testWritten=true.
2. Implement the minimum code. Follow existing patterns; no \`any\`/\`@ts-ignore\`/suppression.
3. Run the Verify Command (\`${t.verify}\`) from ${PROJECT}, capture its real output + exit code, set verifyPassed to the actual exit==0 and verifyOutput to the last ~25 lines.`}
4. Deviations: R1 bug / R2 missing-critical / R3 blocking → auto-fix + test + record counts in deviations.
   ⛔ MANDATORY R4 (architectural) — you may NOT make these to pass the gate; set status="blocked" and put the decision + impact in deviations (the run pauses, a human decides): a new DB table, a schema change, a new service, switching libraries, a breaking API change, or any change to a Verify Command's contract. "I changed the architecture so the gate would pass" is always a blocked R4.
5. summary MUST carry the test result NUMBERS (e.g. "12 passed / 0 failed") + the SPEC IDs — these are surfaced to the human at every pause and are the channel that catches gate-passing bugs. A summary without the test numbers is a regression.
Return TRANSFORM_SCHEMA. Do NOT claim verifyPassed=true without actually running the command.`
}

// yield-for-recheck (DESIGN D-dev-2c): a level that re-touches a file an EARLIER level also declared
// is the only place a cross-level integration regression can originate. Yield there so the skill runs
// the full suite before advancing; green → resume with clearedFullSuite += atLevel, red → fix via onlyChecks.
// (Returns a recheck descriptor or null; the core fires it only when the level did real work, more
// levels remain, and the skill hasn't already cleared it.)
function recheckTrigger(results, li) {
  if (li <= 0) return null
  const seenBefore = new Set(levels.slice(0, li).flatMap(lv => lv.flatMap(id => (byId[id] && byId[id].files) || [])))
  const filesThisLevel = levels[li].flatMap(id => (byId[id] && byId[id].files) || [])
  if (!filesThisLevel.some(f => seenBefore.has(f))) return null
  return {
    recheckKind: 'fullsuite', atLevel: li,
    payload: {
      decision: `Cross-level file overlap at level ${li}: run the full test suite before advancing. If green, resume with clearedFullSuite += ${li}; if red, fix via onlyChecks then resume.`,
      levelTasks: levels[li], filesThisLevel,
    },
  }
}
