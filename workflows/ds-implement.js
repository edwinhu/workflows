export const meta = {
  name: 'ds-implement',
  description: "ds's analysis/ETL implementation as an ultracode TRANSFORM workflow: parse the hardened PLAN.md Task Breakdown table into a data-flow DAG, then implement ONE dependency level per invocation. Tasks in a level run SEQUENTIALLY (each ds-analyst/ds-engineer writes DIRECTLY to the project — OUTPUT-FIRST: produce the Outputs artifact, then run the Verify assertion), and a read-only verify stage corroborates each. The 'what' comes from the PLAN row; the gate is the Verify assertion exit code, computed in JS — never honor-system. (ds is output-first, not TDD; deeper per-requirement coverage review is ds-validate-coverage's job.)",
  whenToUse: "Called by the ds-implement skill once per dependency level, under the phase /goal. Returns { overallPass, level, levelTasks, levelsTotal, tasksRemaining, tasks, findings, tasksThatFailed, reviews }. Implementers write directly to projectDir, so outputs are already on disk when the workflow returns — the skill runs any full-pipeline / ds-validate-coverage ground-truth, marks the level's PLAN rows [x], then re-invokes for the next level. On a re-run it passes onlyChecks (failed task ids) + priorReviews. The workflow never decides the phase is done — that is the skill's /goal loop.",
  phases: [
    { title: 'Discover', detail: 'parse PLAN.md Task Breakdown table → tasks + data-flow DAG → pick the lowest level with pending tasks whose deps are all done' },
    { title: 'Transform', detail: 'sequentially, one ds-analyst/ds-engineer per task in the level — produce Outputs, then run the Verify assertion (output-first)' },
    { title: 'Verify', detail: 'read-only: confirm each task produced its declared Outputs + its Verify assertion genuinely exited 0' },
    { title: 'Gate', detail: 'level passes iff every task produced its Outputs AND its Verify assertion exited 0 — computed in JS from real exit codes' },
  ],
}

// ── Inputs ──────────────────────────────────────────────────────────────────
// args = { projectDir (REQUIRED), pluginRoot?, onlyChecks?: ["2","3"], priorReviews?: [...] }
let cfg = args
if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch { cfg = {} } }
cfg = cfg || {}
const PROJECT = cfg.projectDir
if (!PROJECT) throw new Error(`ds-implement requires args.projectDir. Got "${typeof args}": ${JSON.stringify(args)?.slice(0, 200)}`)
const PLUGIN = cfg.pluginRoot || ''
const ONLY = Array.isArray(cfg.onlyChecks) && cfg.onlyChecks.length ? new Set(cfg.onlyChecks.map(String)) : null
const PRIOR = new Map((Array.isArray(cfg.priorReviews) ? cfg.priorReviews : []).map(t => [String(t.task), t]))

// ── Schemas ───────────────────────────────────────────────────────────────────
const TASK = {
  type: 'object', additionalProperties: false,
  required: ['num', 'name', 'kind', 'deps', 'outputs', 'expectedOutput', 'verify', 'implements', 'done', 'taskText'],
  properties: {
    num: { type: 'string' }, name: { type: 'string' },
    kind: { type: 'string', enum: ['engineer', 'analyst', 'unspecified'], description: 'from a [engineer]/[analyst] tag in the task name; unspecified if none' },
    deps: { type: 'array', items: { type: 'string' }, description: 'task numbers whose Outputs this consumes ([] for `---`)' },
    outputs: { type: 'array', items: { type: 'string' }, description: 'artifact paths this task produces' },
    expectedOutput: { type: 'string', description: 'the verifiable completion claim (specific numbers/shape)' },
    verify: { type: 'string', description: 'the deterministic assertion command whose exit-0 is the per-task gate' },
    implements: { type: 'string', description: 'SPEC requirement IDs' },
    done: { type: 'boolean' },
    taskText: { type: 'string', description: 'full task text from PLAN.md (row + any detail)' },
  },
}
const DISCOVERY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['planReadable', 'specPath', 'language', 'tasks', 'levels', 'levelToRun'],
  properties: {
    planReadable: { type: 'boolean' },
    specPath: { type: 'string', description: 'absolute path to .planning/SPEC.md, or ""' },
    language: { type: 'string', description: 'Implementation Language from PLAN.md (python | R | SAS | Mixed | unspecified)' },
    tasks: { type: 'array', items: TASK },
    levels: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
    levelToRun: { type: 'integer', description: 'lowest level with pending tasks whose deps are done; -1 if all done' },
  },
}
const TRANSFORM_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['task', 'status', 'outputsProduced', 'verifyPassed', 'verifyOutput', 'filesTouched', 'deviations', 'summary'],
  properties: {
    task: { type: 'string' },
    status: { type: 'string', enum: ['implemented', 'blocked', 'error'] },
    outputsProduced: { type: 'boolean', description: 'did you create every declared Outputs artifact?' },
    verifyPassed: { type: 'boolean', description: 'did the Verify assertion exit 0 against the produced output?' },
    verifyOutput: { type: 'string', description: 'last ~25 lines of the Verify run (proof, not self-judgment)' },
    filesTouched: { type: 'array', items: { type: 'string' } },
    deviations: { type: 'string', description: 'R1/R2/R3 auto-fixed; R4 escalations verbatim' },
    summary: { type: 'string', description: 'one line: what was produced + which SPEC IDs + key output numbers' },
  },
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['task', 'outputsPresent', 'verifyReproduced', 'findings'],
  properties: {
    task: { type: 'string' },
    outputsPresent: { type: 'boolean', description: 'do the declared Outputs artifacts actually exist on disk?' },
    verifyReproduced: { type: 'boolean', description: 'does the output corroborate the Verify assertion would pass (artifact present + matches Expected Output shape)? false if missing/empty' },
    findings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['severity', 'detail'], properties: { severity: { type: 'string', enum: ['critical', 'major', 'minor'] }, detail: { type: 'string' } } } },
  },
}

// ── Phase 1: Discover ─────────────────────────────────────────────────────────
phase('Discover')
const disc = await agent(
  `Parse the hardened Task Breakdown table in the ds PLAN and build the data-flow DAG. Working directory: ${PROJECT}

1. Read ${PROJECT}/.planning/PLAN.md. If it has no machine-executable Task Breakdown table (columns Task | Deps | Outputs | Expected Output | Verify | Implements), set planReadable=false, tasks=[], levels=[], levelToRun=-1.
2. For EACH row, extract: num, name, kind (from a [engineer]/[analyst] tag in the name, else "unspecified"), deps (\`---\`→[] or \`after N\`/\`after N,M\`→["N","M"]), outputs (split the Outputs cell), expectedOutput, verify (the Verify cell verbatim), implements, done (row checkbox [x] / done marker), taskText (row + any detail).
3. Compute topological levels from deps (DAG guaranteed — the guard rejected cycles). levelToRun = lowest level with a NOT-done task whose deps are all done; -1 if all done.
4. language = the PLAN.md "Implementation Language" if stated (python/R/SAS/Mixed), else "unspecified". specPath = .planning/SPEC.md if present else "".

Return DISCOVERY_SCHEMA with absolute paths where relevant.`,
  { label: 'discover', phase: 'Discover', schema: DISCOVERY_SCHEMA, model: 'sonnet' }
)
if (!disc.planReadable) throw new Error(`ds-implement: ${PROJECT}/.planning/PLAN.md has no executable Task Breakdown table. ds-plan + ds-plan-executable-guard must produce one before implementation.`)
const byNum = Object.fromEntries(disc.tasks.map(t => [String(t.num), t]))

let targetNums
if (ONLY) targetNums = disc.tasks.filter(t => ONLY.has(String(t.num))).map(t => String(t.num))
else if (disc.levelToRun >= 0) targetNums = (disc.levels[disc.levelToRun] || []).filter(n => byNum[String(n)] && !byNum[String(n)].done)
else targetNums = []
const pendingTotal = disc.tasks.filter(t => !t.done).length
if (!targetNums.length) {
  log(disc.levelToRun < 0 ? '✅ ds-implement: all PLAN tasks already done' : 'ds-implement: no pending tasks in the selected level')
  return { overallPass: true, level: disc.levelToRun, levelTasks: [], levelsTotal: disc.levels.length, tasksRemaining: pendingTotal, tasks: [], findings: [], tasksThatFailed: [], reviews: [], scoreTable: '| (no pending tasks this level) |\n|---|' }
}
log(`Level ${disc.levelToRun}/${disc.levels.length - 1}: implementing ${targetNums.length} task(s) [${targetNums.join(', ')}] sequentially (output-first); ${pendingTotal} pending${ONLY ? ` (re-run ${ONLY.size})` : ''}`)

// ── Phase 2: Transform (SEQUENTIAL within the level — output-first, direct-write) ─
phase('Transform')
const langHint = disc.language && disc.language !== 'unspecified' ? `Implementation language: ${disc.language}. Follow the project's established ${disc.language} patterns and enforcement.` : ''
const dsHint = PLUGIN ? `Read ${PLUGIN}/../skills/ds-delegate/SKILL.md for the output-first protocol + ETL/methodology patterns before writing code.` : ''
const liveTransforms = []
for (const num of targetNums) {
  const t = byNum[String(num)]
  const roleLine = t.kind === 'engineer'
    ? 'You are a ds-ENGINEER: pipeline/ETL work. Enforce determinism (no unseeded randomness, stable sort), idempotency (re-running produces the same Outputs), and schema validation on the output.'
    : t.kind === 'analyst'
      ? 'You are a ds-ANALYST: analysis work. Verify every number against the data; no hand-waved results.'
      : 'You are a ds implementer.'
  const tr = await agent(
    `${roleLine} You implement EXACTLY ONE planned task by writing DIRECTLY into the project at ${PROJECT}. ds is OUTPUT-FIRST (NOT TDD): produce the Outputs, then run the Verify assertion. The "what" is pinned by the PLAN row — no latitude on scope. Earlier tasks in this level ran before you and their Outputs are on disk — build on them.
Set task="${t.num}" verbatim (the gate keys on it).

TASK ${t.num}: ${t.name}   (kind: ${t.kind})
Implements (SPEC IDs): ${t.implements}
Outputs to produce (under ${PROJECT}): ${(t.outputs || []).join(', ')}
Expected Output (what proves completion): ${t.expectedOutput}
Verify (run this; exit 0 = pass): ${t.verify}

FULL TASK TEXT FROM PLAN:
${t.taskText}
${disc.specPath ? `SPEC for context: ${disc.specPath}` : ''}
${langHint}
${dsHint}

Protocol (NON-NEGOTIABLE — output-first):
1. Produce every declared Outputs artifact (write the analysis/ETL code, run it, confirm the files exist).
2. Run the Verify assertion (\`${t.verify}\`) from ${PROJECT} and capture its real output + exit code. Set verifyPassed = (exit==0). Do NOT claim verifyPassed=true without running it.
3. Read your own output — confirm it matches Expected Output (the specific numbers/shape), not "looks roughly right".
4. Deviations: R1 bug / R2 missing-critical / R3 blocking → auto-fix + re-verify + record. R4 (schema change, new data source, methodology pivot) → do NOT proceed; set status="blocked", report verbatim in deviations.

Return TRANSFORM_SCHEMA with status, outputsProduced, verifyPassed, verifyOutput (last ~25 lines — your PROOF), filesTouched, deviations, summary (incl. the key output numbers).`,
    { label: `task:${t.num}`, phase: 'Transform', schema: TRANSFORM_SCHEMA, model: 'sonnet' })
  if (tr) liveTransforms.push(tr)
}

// ── Phase 3: Verify (read-only corroboration) ──────────────────────────────────
phase('Verify')
const verifs = (await parallel(liveTransforms.map(tr => () => {
  const t = byNum[String(tr.task)]
  return agent(
    `You are a READ-ONLY verifier. Do NOT create, edit, or run mutating commands. Corroborate an implementer's self-report against the project tree at ${PROJECT} — catch "claimed done, produced nothing".
Set task="${tr.task}" verbatim.

The task required: Outputs=${t ? (t.outputs || []).join(', ') : ''}; Expected Output="${t ? t.expectedOutput : ''}"; Verify=\`${t ? t.verify : ''}\`.
Implementer reported: status=${tr.status}, outputsProduced=${tr.outputsProduced}, verifyPassed=${tr.verifyPassed}, filesTouched=${(tr.filesTouched || []).join(', ')}.
Verify output (tail): ${(tr.verifyOutput || '').slice(0, 1500)}

Check (read-only): outputsPresent — do the declared Outputs artifacts exist on disk (ls/Read)? verifyReproduced — does the output corroborate the Verify assertion would pass (artifact present, non-empty, shape consistent with Expected Output)? false if missing/empty or the Verify output shows an assertion failure. List discrepancies in findings (critical if outputsProduced/verifyPassed were claimed true but the tree contradicts them).
Return VERIFY_SCHEMA.`,
    { label: `verify:${tr.task}`, phase: 'Verify', schema: VERIFY_SCHEMA, model: 'sonnet' })
}))).filter(Boolean)
const verifyByTask = Object.fromEntries(verifs.map(v => [String(v.task), v]))

// ── Phase 4: Gate (pure JS — real Verify exit codes + corroboration) ───────────
phase('Gate')
const SEV_RANK = { critical: 0, major: 1, minor: 2 }
const rows = []
const findings = []
for (const num of targetNums) {
  const t = byNum[String(num)]
  const tr = liveTransforms.find(x => String(x.task) === String(num)) || (PRIOR.has(String(num)) ? PRIOR.get(String(num)) : null)
  const v = verifyByTask[String(num)] || (PRIOR.has(String(num)) ? PRIOR.get(String(num)).verify : null)
  const implemented = !!tr && tr.status === 'implemented'
  const produced = !!tr && tr.outputsProduced === true && (!v || v.outputsPresent !== false)
  const verified = !!tr && tr.verifyPassed === true && (!v || v.verifyReproduced !== false)
  const pass = implemented && produced && verified
  rows.push({ task: num, name: t?.name || '', implemented, produced, verified, pass })
  if (!implemented) findings.push({ severity: 'critical', task: num, detail: `Task ${num}: ${tr ? (tr.status === 'blocked' ? 'BLOCKED (R4 — ' + (tr.deviations || 'escalation') + ')' : 'errored') : 'no result'}` })
  else {
    if (!produced) findings.push({ severity: 'critical', task: num, detail: `Task ${num}: declared Outputs not produced/present` })
    if (!verified) findings.push({ severity: 'critical', task: num, detail: `Task ${num}: Verify assertion did not pass / not corroborated (\`${t?.verify}\`)` })
  }
  for (const f of (v?.findings || [])) findings.push({ severity: f.severity, task: num, detail: `Task ${num}: ${f.detail}` })
}
findings.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])

const overallPass = rows.length > 0 && rows.every(r => r.pass)
const remainingAfter = pendingTotal - rows.filter(r => r.pass).length
const verdict = overallPass ? (remainingAfter > 0 ? `LEVEL ${disc.levelToRun} DONE (${remainingAfter} in later levels)` : 'ALL LEVELS DONE') : 'LEVEL GAPS'

const scoreTable = [
  `| Task | Implemented | Outputs | Verify | Gate |  (level ${disc.levelToRun}/${disc.levels.length - 1})`,
  '|------|-------------|---------|--------|------|',
  ...rows.map(r => `| ${r.task}. ${r.name} | ${r.implemented ? '✅' : '❌'} | ${r.produced ? '✅' : '❌'} | ${r.verified ? '✅' : '❌'} | ${r.pass ? '✅' : '❌'} |`),
  `| **Level ${disc.levelToRun}** | ${rows.filter(r => r.pass).length}/${rows.length} pass | | | ${overallPass ? '✅' : '❌'} |`,
].join('\n')

log(overallPass
  ? `✅ ds-implement level ${disc.levelToRun}: ${rows.length} task(s) verified (outputs on disk) — SKILL should run ds-validate-coverage + mark these PLAN rows [x], then re-invoke for the next level`
  : `❌ ds-implement level ${disc.levelToRun}: ${rows.filter(r => !r.pass).length}/${rows.length} failed — ${findings.length} finding(s); fix + re-invoke with onlyChecks=tasksThatFailed`)

return {
  overallPass,
  level: disc.levelToRun,
  levelTasks: targetNums,
  levelsTotal: disc.levels.length,
  tasksRemaining: remainingAfter,
  verdict,
  scoreTable,
  tasks: rows,
  findings,
  tasksThatFailed: rows.filter(r => !r.pass).map(r => r.task),
  reviews: liveTransforms.map(tr => ({ ...tr, verify: verifyByTask[String(tr.task)] || null })),
}
