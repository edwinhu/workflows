export const meta = {
  name: 'dev-implement',
  description: "dev's implementation phase as an ultracode TRANSFORM workflow: parse the hardened PLAN.md Implementation Order table into a dependency DAG, then implement ONE dependency level per invocation. Tasks in a level run SEQUENTIALLY (each dev-implementer writes directly to the project tree — TDD: failing test FIRST, then code, then its own Verify Command), and a read-only verify stage corroborates each. The 'what' comes from the PLAN row; the gate is the Verify Command exit code, computed in JS — never honor-system. (v1 is sequential-within-level: implementers write the shared tree in turn, so no worktree-merge. Intra-level parallelism is a future enhancement.)",
  whenToUse: "Called by the dev-implement skill once per dependency level, under the phase /goal. Returns { overallPass, level, levelTasks, levelsTotal, tasksRemaining, tasks, findings, tasksThatFailed, reviews }. Implementers write directly to projectDir, so the code is already in the tree when the workflow returns — the skill runs the FULL suite (ground truth — self-reports are not), marks the level's PLAN rows [x], then re-invokes for the next level. On a re-run it passes onlyChecks (failed task ids) + priorReviews. The workflow never decides the phase is done — that is the skill's /goal loop. An R4 block surfaces as a critical finding + overallPass=false; the skill escalates it.",
  phases: [
    { title: 'Discover', detail: 'parse PLAN.md Implementation Order table → tasks + Deps DAG → pick the lowest level with pending tasks whose deps are all done' },
    { title: 'Transform', detail: 'sequentially, one dev-implementer per task in the level — TDD test-first, write to the project tree, run its Verify Command' },
    { title: 'Verify', detail: 'read-only: confirm each task wrote its failing test + its Verify Command genuinely exited 0' },
    { title: 'Gate', detail: 'level passes iff every task wrote a test (or N/A) AND its Verify Command exited 0 — computed in JS from real exit codes, not self-judgment' },
  ],
}

// ── Inputs ──────────────────────────────────────────────────────────────────
// args = {
//   projectDir: "/abs/dev-project-root",   // REQUIRED — holds .planning/PLAN.md + the codebase; implementers write here
//   pluginRoot: "/abs/.../workflows",       // optional — for resolving dev-tdd guidance
//   onlyChecks?: ["2","3"],                  // re-run loop: re-implement exactly these task numbers (overrides level pick)
//   priorReviews?: [<task objects>],         // re-run loop: prior per-task results to carry
// }
let cfg = args
if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch { cfg = {} } }
cfg = cfg || {}
const PROJECT = cfg.projectDir
if (!PROJECT) throw new Error(`dev-implement requires args.projectDir. Got "${typeof args}": ${JSON.stringify(args)?.slice(0, 200)}`)
const PLUGIN = cfg.pluginRoot || ''
const ONLY = Array.isArray(cfg.onlyChecks) && cfg.onlyChecks.length ? new Set(cfg.onlyChecks.map(String)) : null
const PRIOR = new Map((Array.isArray(cfg.priorReviews) ? cfg.priorReviews : []).map(t => [String(t.task), t]))

// ── Schemas ───────────────────────────────────────────────────────────────────
const TASK = {
  type: 'object', additionalProperties: false,
  required: ['num', 'name', 'deps', 'files', 'failingTest', 'verifyCmd', 'implements', 'done', 'taskText', 'interfaces'],
  properties: {
    num: { type: 'string', description: 'the task number as a string, e.g. "2"' },
    name: { type: 'string' },
    deps: { type: 'array', items: { type: 'string' }, description: 'task numbers this depends on ([] for `---`)' },
    files: { type: 'array', items: { type: 'string' }, description: 'files the task creates/edits (repo-relative)' },
    failingTest: { type: 'string', description: 'the test to write FIRST, or "N/A"' },
    verifyCmd: { type: 'string', description: 'the deterministic command whose exit-0 is the per-task gate' },
    implements: { type: 'string', description: 'SPEC requirement IDs' },
    done: { type: 'boolean', description: 'true if the PLAN row is already checked [x]' },
    taskText: { type: 'string', description: 'the full task text from PLAN.md (name + sub-bullets) — pasted to the implementer so it need not re-read the file' },
    interfaces: { type: 'string', description: "this task's Interfaces sub-block (Consumes/Produces) from PLAN.md's '## Task Interfaces' section, verbatim; '' if the plan declares none" },
  },
}
const DISCOVERY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['planReadable', 'specPath', 'globalConstraints', 'tasks', 'levels', 'levelToRun'],
  properties: {
    planReadable: { type: 'boolean', description: 'true iff PLAN.md has a parseable Implementation Order table' },
    specPath: { type: 'string', description: 'absolute path to .planning/SPEC.md, or "" if absent' },
    globalConstraints: { type: 'string', description: "verbatim text of PLAN.md's '## Global Constraints' section (rules binding EVERY task), or '' if the plan declares none (optional/backward-compatible)" },
    tasks: { type: 'array', items: TASK },
    levels: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'topological levels: levels[i] = task numbers whose deps are all in earlier levels' },
    levelToRun: { type: 'integer', description: 'index into levels of the LOWEST level that has pending (not-done) tasks; -1 if all tasks done' },
  },
}
const TRANSFORM_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['task', 'status', 'testWritten', 'verifyPassed', 'verifyOutput', 'filesTouched', 'deviations', 'summary'],
  properties: {
    task: { type: 'string', description: 'echo the task number verbatim — the gate keys on it' },
    status: { type: 'string', enum: ['implemented', 'blocked', 'error'] },
    testWritten: { type: 'boolean', description: 'did you write the failing test FIRST and see it RED (true; N/A tasks set true)?' },
    verifyPassed: { type: 'boolean', description: 'did the task Verify Command exit 0 after implementation?' },
    verifyOutput: { type: 'string', description: 'last ~25 lines of the Verify Command output (proof, not self-judgment)' },
    filesTouched: { type: 'array', items: { type: 'string' }, description: 'repo-relative paths created/edited' },
    deviations: { type: 'string', description: 'R1/R2/R3 auto-fixed counts; R4 escalations (STOP items) verbatim' },
    summary: { type: 'string', description: 'one line: what was implemented + which SPEC IDs' },
  },
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['task', 'testPresent', 'verifyReproduced', 'findings'],
  properties: {
    task: { type: 'string' },
    testPresent: { type: 'boolean', description: 'does the declared failing-test actually exist in the tree (or N/A)?' },
    verifyReproduced: { type: 'boolean', description: 'does the tree state corroborate the Verify Command would pass (test files present, code present)? false if the diff is empty or the test is missing' },
    findings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['severity', 'detail'], properties: { severity: { type: 'string', enum: ['critical', 'major', 'minor'] }, detail: { type: 'string' } } } },
  },
}

// ── Phase 1: Discover ─────────────────────────────────────────────────────────
phase('Discover')
const disc = await agent(
  `Parse the hardened Implementation Order table in the dev PLAN and build the dependency DAG. Working directory: ${PROJECT}

1. Read ${PROJECT}/.planning/PLAN.md. If it has no machine-executable Implementation Order table (columns Task | Deps | Files | Failing Test | Verify Command | Implements), set planReadable=false, tasks=[], levels=[], levelToRun=-1 — the workflow will refuse (the dev-plan-executable-guard should have prevented this).
2. For EACH table row, extract a task: num (leading integer), name, deps (parse \`---\`→[] or \`after N\`/\`after N,M\`→["N","M"]), files (split the Files cell), failingTest, verifyCmd (the Verify Command cell verbatim), implements, done (true iff the row's task checkbox is [x] or a "done" marker is present). taskText = the row PLUS any sub-bullets/detail for that task elsewhere in PLAN.md (so the implementer needn't re-read the file). interfaces = the task's sub-block under a '## Task Interfaces' section (a '### Task N' block with Consumes/Produces), verbatim; '' if the plan has no such section or no block for this task (it is optional/backward-compatible).
3. globalConstraints = the verbatim body of a '## Global Constraints' section if PLAN.md has one (rules that bind EVERY task), else '' — the plan format makes this optional, so absence is normal, not an error.
4. Compute topological levels: levels[0] = tasks with deps [] OR all-deps-done; each subsequent level = tasks whose deps are all in earlier levels. (A DAG is guaranteed — the guard rejected cycles.)
5. levelToRun = index of the LOWEST level that contains at least one NOT-done task whose every dep is done. If all tasks are done, levelToRun=-1.
6. specPath = ${PROJECT}/.planning/SPEC.md if present else "".

Return DISCOVERY_SCHEMA with absolute paths where relevant.`,
  { label: 'discover', phase: 'Discover', schema: DISCOVERY_SCHEMA, model: 'sonnet' }
)
if (!disc.planReadable) throw new Error(`dev-implement: ${PROJECT}/.planning/PLAN.md has no executable Implementation Order table. dev-design + dev-plan-executable-guard must produce one before implementation.`)
const byNum = Object.fromEntries(disc.tasks.map(t => [String(t.num), t]))

// Which tasks to implement this invocation: onlyChecks override, else the picked level's pending tasks.
let targetNums
if (ONLY) {
  targetNums = disc.tasks.filter(t => ONLY.has(String(t.num))).map(t => String(t.num))
} else if (disc.levelToRun >= 0) {
  targetNums = (disc.levels[disc.levelToRun] || []).filter(n => byNum[String(n)] && !byNum[String(n)].done)
} else {
  targetNums = []
}
const pendingTotal = disc.tasks.filter(t => !t.done).length
if (!targetNums.length) {
  log(disc.levelToRun < 0 ? '✅ dev-implement: all PLAN tasks already done — nothing to implement' : 'dev-implement: no pending tasks in the selected level')
  return {
    overallPass: true, level: disc.levelToRun, levelTasks: [], levelsTotal: disc.levels.length,
    tasksRemaining: pendingTotal, tasks: [], findings: [], tasksThatFailed: [], reviews: [],
    scoreTable: '| (no pending tasks this level) |\n|---|',
  }
}
log(`Level ${disc.levelToRun}/${disc.levels.length - 1}: implementing ${targetNums.length} task(s) [${targetNums.join(', ')}] sequentially; ${pendingTotal} pending overall${ONLY ? ` (re-run ${ONLY.size})` : ''}`)

// ── Phase 2: Transform (SEQUENTIAL within the level — implementers write the shared tree in turn) ─
// Model policy (turn-economics): mechanical stages (Discover/Verify) are pinned to a
// mid-tier model (sonnet) — the floor, never the cheapest tier, because cheap models
// take 2-3× the turns on multi-step work and cost more end to end. The implementer
// runs multi-step TDD, so it deliberately OMITS model to inherit the session model
// (≥ the mid-tier floor — capability where judgment is needed). Do NOT downgrade the
// implementer to the cheapest tier; that trades a token line-item for more turns.
phase('Transform')
const tdHint = PLUGIN ? `Read ${PLUGIN}/../skills/dev-tdd/SKILL.md and follow the TDD Iron Law + Execution Gate before writing code.` : 'Follow TDD: write the failing test, see it RED, then implement to GREEN.'
const liveTransforms = []
for (const num of targetNums) {
  const t = byNum[String(num)]
  // Sequential (await in a loop): each implementer writes directly to the project tree, so they must not run concurrently.
  const tr = await agent(
    `You are a dev-implementer (TDD, test-FIRST). You implement EXACTLY ONE planned task by writing DIRECTLY into the project at ${PROJECT}. The "what" is pinned by the PLAN row — you have no design latitude; your job is faithful TDD implementation. Other tasks in this level run before/after you in sequence, so the tree may already contain earlier tasks' work — build on it, do not revert it.
Set task="${t.num}" verbatim in your record (the gate keys on it).

TASK ${t.num}: ${t.name}
Implements (SPEC IDs): ${t.implements}
Files to create/edit (from the PLAN, under ${PROJECT}): ${(t.files || []).join(', ') || '(none declared — declare what you touch)'}
Failing Test (write this FIRST): ${t.failingTest}
Verify Command (must exit 0 when done): ${t.verifyCmd}
${(t.interfaces && t.interfaces.trim()) ? `\nINTERFACES (what this task consumes / produces — honor these boundaries exactly):\n${t.interfaces}` : ''}
${(disc.globalConstraints && disc.globalConstraints.trim()) ? `\nGLOBAL CONSTRAINTS (bind EVERY task — obey verbatim):\n${disc.globalConstraints}` : ''}

FULL TASK TEXT FROM PLAN:
${t.taskText}
${disc.specPath ? `SPEC for context: ${disc.specPath}` : ''}

${tdHint}

Protocol (NON-NEGOTIABLE):
1. Write the failing test FIRST and run it — see it RED. (If Failing Test is "N/A" — types-only/meta — skip, set testWritten=true.)
2. Implement the minimum code to make it GREEN. Follow existing code patterns; no \`any\`/\`@ts-ignore\`/suppression; no committing broken code.
3. Run the Verify Command (\`${t.verifyCmd}\`) from ${PROJECT} and capture its real output + exit code. Set verifyPassed to the actual exit==0.
4. Deviations: R1 bug / R2 missing-critical / R3 blocking → auto-fix + test + record. R4 architectural (new schema, lib swap, breaking API) → do NOT proceed; set status="blocked" and report it verbatim in deviations.

Return TRANSFORM_SCHEMA with status, testWritten, verifyPassed, verifyOutput (last ~25 lines of the Verify Command run — your PROOF), filesTouched, deviations, summary. Do NOT claim verifyPassed=true without actually running the command.`,
    { label: `task:${t.num}`, phase: 'Transform', schema: TRANSFORM_SCHEMA })
  if (tr) liveTransforms.push(tr)
}

// ── Phase 3: Verify (read-only corroboration — the tree must back the self-report) ─
phase('Verify')
const verifs = (await parallel(liveTransforms.map(tr => () => {
  const t = byNum[String(tr.task)]
  return agent(
    `You are a READ-ONLY verifier. Do NOT create, edit, or run mutating commands. Corroborate that an implementer's self-report matches the project tree at ${PROJECT} — catch "claimed done, did nothing".
Set task="${tr.task}" verbatim.

The task required:
- Failing Test: ${t ? t.failingTest : '(unknown)'}
- Files: ${t ? (t.files || []).join(', ') : ''}
- Verify Command: ${t ? t.verifyCmd : ''}
The implementer reported: status=${tr.status}, testWritten=${tr.testWritten}, verifyPassed=${tr.verifyPassed}, filesTouched=${(tr.filesTouched || []).join(', ')}.
Its Verify Command output (tail):
${(tr.verifyOutput || '').slice(0, 1500)}

Check (read-only): testPresent — does the declared failing test actually exist (Grep/Read the test file under ${PROJECT})? verifyReproduced — does the tree corroborate the Verify Command would pass (the declared files exist and are non-trivial, the test references the implemented symbol)? Set verifyReproduced=false if the files are missing, the test is missing, or the output shows failures. List discrepancies in findings (critical if testWritten/verifyPassed were claimed true but the tree contradicts them).
Return VERIFY_SCHEMA.`,
    { label: `verify:${tr.task}`, phase: 'Verify', schema: VERIFY_SCHEMA, model: 'sonnet' })
}))).filter(Boolean)
const verifyByTask = Object.fromEntries(verifs.map(v => [String(v.task), v]))

// ── Phase 4: Gate (pure JS — real Verify Command exit codes + corroboration) ────
phase('Gate')
const SEV_RANK = { critical: 0, major: 1, minor: 2 }
const rows = []
const findings = []
for (const num of targetNums) {
  const t = byNum[String(num)]
  const tr = liveTransforms.find(x => String(x.task) === String(num)) || (PRIOR.has(String(num)) ? PRIOR.get(String(num)) : null)
  const v = verifyByTask[String(num)] || (PRIOR.has(String(num)) ? PRIOR.get(String(num)).verify : null)
  const implemented = !!tr && tr.status === 'implemented'
  const tested = !!tr && tr.testWritten === true && (!v || v.testPresent !== false)
  const verified = !!tr && tr.verifyPassed === true && (!v || v.verifyReproduced !== false)
  const pass = implemented && tested && verified
  rows.push({ task: num, name: t?.name || '', implemented, tested, verified, pass })
  if (!implemented) findings.push({ severity: 'critical', task: num, detail: `Task ${num}: ${tr ? (tr.status === 'blocked' ? 'BLOCKED (R4 — ' + (tr.deviations || 'architectural escalation') + ')' : 'errored') : 'no result'}` })
  else {
    if (!tested) findings.push({ severity: 'critical', task: num, detail: `Task ${num}: failing test not written/present (TDD violation)` })
    if (!verified) findings.push({ severity: 'critical', task: num, detail: `Task ${num}: Verify Command did not pass / not corroborated (\`${t?.verifyCmd}\`)` })
  }
  for (const f of (v?.findings || [])) findings.push({ severity: f.severity, task: num, detail: `Task ${num}: ${f.detail}` })
}
findings.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])

const overallPass = rows.length > 0 && rows.every(r => r.pass)
const remainingAfter = pendingTotal - rows.filter(r => r.pass).length
const verdict = overallPass ? (remainingAfter > 0 ? `LEVEL ${disc.levelToRun} DONE (${remainingAfter} task(s) in later levels)` : 'ALL LEVELS DONE') : 'LEVEL GAPS'

const scoreTable = [
  `| Task | Implemented | Test (TDD) | Verify Cmd | Gate |  (level ${disc.levelToRun}/${disc.levels.length - 1})`,
  '|------|-------------|-----------|------------|------|',
  ...rows.map(r => `| ${r.task}. ${r.name} | ${r.implemented ? '✅' : '❌'} | ${r.tested ? '✅' : '❌'} | ${r.verified ? '✅' : '❌'} | ${r.pass ? '✅' : '❌'} |`),
  `| **Level ${disc.levelToRun}** | ${rows.filter(r => r.pass).length}/${rows.length} pass | | | ${overallPass ? '✅' : '❌'} |`,
].join('\n')

log(overallPass
  ? `✅ dev-implement level ${disc.levelToRun}: ${rows.length} task(s) green (written to the tree) — SKILL must run the FULL suite, mark these PLAN rows [x], then re-invoke for the next level`
  : `❌ dev-implement level ${disc.levelToRun}: ${rows.filter(r => !r.pass).length}/${rows.length} task(s) failed — ${findings.length} finding(s); fix + re-invoke with onlyChecks=tasksThatFailed`)

return {
  overallPass,
  level: disc.levelToRun,
  levelTasks: targetNums,
  levelsTotal: disc.levels.length,
  tasksRemaining: remainingAfter,            // pending tasks left AFTER this level (skill keeps looping while >0)
  verdict,
  scoreTable,
  tasks: rows,
  findings,                                  // severity-ordered; critical = TDD/verify failures + R4 blocks
  tasksThatFailed: rows.filter(r => !r.pass).map(r => r.task),   // pass as onlyChecks on re-run
  reviews: liveTransforms.map(tr => ({ ...tr, verify: verifyByTask[String(tr.task)] || null })),  // priorReviews on re-run
}
