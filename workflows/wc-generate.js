export const meta = {
  name: 'wc-generate',
  description: "workflow-creator's Mode 1 Step 6 file generation as a dynamic TRANSFORM workflow: discover the file set from the approved DESIGN.md, fan out one worktree-isolated write-agent per file (each skill phase file + each constraint .md/.py pair + the runner) creating it from its pinned DESIGN spec, then a read-only verify stage confirms each file matches its spec and the co-located .md/.py pairing holds. The 'what' comes from DESIGN — write-agents get NO creative latitude. Returns per-file transform + verify records and a computed gate.",
  whenToUse: "Called by workflow-creator Mode 1 Step 6 AFTER Steps 1-5 are completed and DESIGN.md is approved. Returns { overallPass, scoreTable, files, findings, reviews, filesThatFailed }. The skill keeps the interview, decomposition, enforcement design, and the user file-approval gate conversational; it merges the surfaced worktrees and then does the ground-truth ls / node-check at the expected paths. On a re-run it passes onlyChecks (failed file IDs) + priorReviews.",
  phases: [
    { title: 'Discover', detail: 'read DESIGN.md; enumerate every file to generate with its per-file spec (skill phase files + constraint .md/.py pairs + runner)' },
    { title: 'Transform', detail: 'one worktree-isolated write-agent per file — creates it from the pinned DESIGN spec, NOT from judgment' },
    { title: 'Verify', detail: 'read-only: confirm each file matches its spec and the .md/.py pair + co-location convention holds' },
    { title: 'Gate', detail: 'all files generated AND all verifies pass — computed in JS' },
  ],
}

// ── Inputs ──────────────────────────────────────────────────────────────────
// args = {
//   workflowName: "myflow",                       // REQUIRED — the workflow being created (skills/{workflowName}*)
//   projectDir: "/abs/plugin-repo-root",          // REQUIRED — where skills/ and references/constraints/ live
//   designPath: "/abs/.planning/wc/myflow/DESIGN.md", // optional — defaults to projectDir/.planning/wc/{workflowName}/DESIGN.md
//   onlyChecks?: ["skill:myflow-implement", ...],  // re-run loop: regenerate only these file IDs; carry the rest
//   priorReviews?: [<file objects>],               // re-run loop: prior per-file results to carry forward
// }
let cfg = args
if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch { cfg = {} } }
cfg = cfg || {}
const PROJECT = cfg.projectDir
if (!PROJECT) throw new Error(`wc-generate requires args.projectDir. Got "${typeof args}": ${JSON.stringify(args)?.slice(0, 200)}`)
const NAME = cfg.workflowName
if (!NAME) throw new Error(`wc-generate requires args.workflowName. Got "${typeof args}": ${JSON.stringify(args)?.slice(0, 200)}`)
const DESIGN = cfg.designPath || `${PROJECT}/.planning/wc/${NAME}/DESIGN.md`
const ONLY = Array.isArray(cfg.onlyChecks) && cfg.onlyChecks.length ? new Set(cfg.onlyChecks.map(String)) : null
const PRIOR = new Map((Array.isArray(cfg.priorReviews) ? cfg.priorReviews : []).map(f => [String(f.fileId), f]))

// ── Schemas ───────────────────────────────────────────────────────────────────
const DISCOVERY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['designReadable', 'files'],
  properties: {
    designReadable: { type: 'boolean', description: 'true iff DESIGN.md exists and contains a phase decomposition to generate from' },
    files: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['fileId', 'path', 'kind', 'spec'],
        properties: {
          fileId: { type: 'string', description: 'stable id, e.g. "skill:myflow-implement", "constraint:no-x.md", "constraint:no-x.py", "runner:check-all.py"' },
          path: { type: 'string', description: 'ABSOLUTE target path to create' },
          kind: { type: 'string', enum: ['skill-entry', 'skill-midpoint', 'skill-phase', 'constraint-md', 'constraint-py', 'runner'] },
          spec: { type: 'string', description: 'the pinned per-file spec from DESIGN.md: responsibility, gate, enforcement patterns, transitions, frontmatter — the "what", verbatim from DESIGN, NOT invented' },
        },
      },
    },
  },
}

// Write-agent returns what it created + the full content so the verify stage can adjudicate even before worktrees merge.
const TRANSFORM_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['fileId', 'path', 'status', 'filesTouched', 'content', 'summary'],
  properties: {
    fileId: { type: 'string', description: 'echo the dispatched file id verbatim — the gate keys on it' },
    path: { type: 'string' },
    status: { type: 'string', enum: ['created', 'skipped', 'error'] },
    filesTouched: { type: 'array', items: { type: 'string' } },
    content: { type: 'string', description: 'the full content written (so verify can validate against spec independent of worktree merge timing)' },
    summary: { type: 'string', description: 'one line: what was generated and which DESIGN spec items it satisfies' },
  },
}

const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['fileId', 'matchesSpec', 'pairOk', 'findings'],
  properties: {
    fileId: { type: 'string', description: 'echo the dispatched file id verbatim' },
    matchesSpec: { type: 'boolean', description: 'does the generated content satisfy every item in its DESIGN spec?' },
    pairOk: { type: 'boolean', description: 'for constraints: is the .md/.py pair present and co-located (same name, same constraints/ dir)? true if N/A.' },
    findings: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['severity', 'detail'],
        properties: { severity: { type: 'string', enum: ['critical', 'major', 'minor'] }, detail: { type: 'string' } },
      },
    },
  },
}

// ── Phase 1: Discover ─────────────────────────────────────────────────────────
phase('Discover')
const disc = await agent(
  `Enumerate the files Mode 1 Step 6 must generate for the "${NAME}" workflow, reading the APPROVED design. Working directory: ${PROJECT}

1. Read ${DESIGN} (the Step 3b DESIGN.md). If it does not exist or has no phase decomposition, set designReadable=false and files=[] — the workflow will refuse (generation without an approved design is forbidden; Delete & Restart protocol).
2. From DESIGN.md, enumerate EVERY file to create, each with its pinned per-file spec (do NOT invent — extract the "what" from DESIGN):
   - The entry skill: ${PROJECT}/skills/${NAME}/SKILL.md (kind "skill-entry").
   - The midpoint skill: ${PROJECT}/skills/${NAME}-fix/SKILL.md (or -debug / -revise per DESIGN) (kind "skill-midpoint").
   - One phase skill per phase in DESIGN: ${PROJECT}/skills/${NAME}-{phase}/SKILL.md (kind "skill-phase").
   - For every constraint DESIGN specifies: ${PROJECT}/references/constraints/{rule}.md (kind "constraint-md") AND, if DESIGN marks it mechanically testable, the co-located ${PROJECT}/references/constraints/{rule}.py (kind "constraint-py"). A convention is .md only.
   - The auto-discovering runner ${PROJECT}/references/constraints/check-all.py (kind "runner") IF DESIGN calls for constraints and it does not already exist.
3. Each file's spec MUST capture: its single responsibility, gate condition + artifact, the enforcement patterns assigned in DESIGN, the next-phase transition, required frontmatter (name/description/hooks/allowed-tools), and any post-subagent boundary — all sourced from DESIGN.

Use ABSOLUTE paths and stable fileIds (e.g. "skill:${NAME}-implement", "constraint:no-x.md", "constraint:no-x.py", "runner:check-all.py"). Return DISCOVERY_SCHEMA.`,
  { label: 'discover', phase: 'Discover', schema: DISCOVERY_SCHEMA, model: 'sonnet' }
)
if (!disc.designReadable) throw new Error(`wc-generate: ${DESIGN} not readable or has no phase decomposition. Mode 1 Steps 1-5 must complete and DESIGN.md must be approved before generation (Delete & Restart protocol).`)
if (!disc.files.length) throw new Error('wc-generate: DESIGN.md yielded no files to generate — check the decomposition.')
log(`Generating ${disc.files.length} file(s) for ${NAME}; ${ONLY ? `re-run ${ONLY.size}` : 'full generation'}`)

// ── Phase 2: Transform (per-file, parallel, worktree-isolated write-agents) ─────
phase('Transform')
const KIND_GUIDE = {
  'skill-entry': 'an entry-point SKILL.md that routes to the first phase, checks .planning/HANDOFF.md on startup, and loads its constraints via the auto-loader bang. Trigger-only description.',
  'skill-midpoint': 'a self-contained midpoint SKILL.md that re-enters a running episode: loads ALL constraint layers it needs (not summaries) before touching work, then diagnoses and routes.',
  'skill-phase': 'an internal phase SKILL.md with ONE responsibility, a structural (hook-enforced where possible) gate, the DESIGN-assigned enforcement patterns, a post-subagent boundary if it dispatches a subagent, a YAML summary-frontmatter block, and a transition that reads the next phase.',
  'constraint-md': 'a constraint/convention rule file: frontmatter (name, description, applies-to), Rule, Rationale (cite the real failure mode from DESIGN), Examples (correct/incorrect), Rationalization Table, Red Flags.',
  'constraint-py': 'the co-located check script implementing the standard interface (CONSTRAINT, APPLIES_TO, SEVERITY, def check(context)->violations, __main__ runner). Same stem as its .md.',
  'runner': 'check-all.py — auto-discovers and runs every constraints/*.py, prints structured JSON {passed,failed,conventions,errors}, exits non-zero on any failure. No manual wiring.',
}
const tasks = []
const carried = []
let reran = 0, carriedCount = 0
for (const f of disc.files) {
  if (ONLY && !ONLY.has(String(f.fileId))) {
    if (PRIOR.has(String(f.fileId))) { carried.push(PRIOR.get(String(f.fileId))); carriedCount++ }
    continue
  }
  reran++
  tasks.push(() => agent(
    `You are a workflow-creator file generator (Mode 1 Step 6). You CREATE exactly one file from a PINNED DESIGN spec — you have NO creative latitude. The "what" comes entirely from the spec below; your job is faithful mechanical generation, not design.
Set fileId="${f.fileId}" verbatim in your returned record (the gate keys on it).

TARGET FILE: ${f.path}
KIND: ${f.kind} — ${KIND_GUIDE[f.kind] || 'generate per the spec.'}
DESIGN SPEC (the authoritative "what" — do NOT deviate, do NOT add features DESIGN did not specify):
${f.spec}

Hard rules:
- Path portability: in hook command: fields use \${CLAUDE_PLUGIN_ROOT}; in skill body use \${CLAUDE_SKILL_DIR}. NEVER \${CLAUDE_SKILL_DIR} in a hook command (silent-failure landmine).
- Verifier/reviewer agents get allowed-tools restricted to read-only (Read, Grep, Glob).
- A constraint .md MUST have a co-located .py of the same stem if DESIGN marked it testable; a convention is .md only.
Write the file with the Write tool, then return TRANSFORM_SCHEMA with status="created", filesTouched=[the path], and content=the FULL file you wrote (so the verify stage can adjudicate before worktrees are merged).`,
    { label: String(f.fileId), phase: 'Transform', schema: TRANSFORM_SCHEMA, model: 'sonnet', isolation: 'worktree' }))
}
const liveTransforms = (await parallel(tasks)).filter(Boolean)
if (ONLY) log(`Selective re-generation: ${reran} file(s) live, ${carriedCount} carried`)

// ── Phase 3: Verify (read-only — confirm each transform matches its DESIGN spec) ─
phase('Verify')
const specByFileId = Object.fromEntries(disc.files.map(f => [String(f.fileId), f]))
const generatedIds = new Set(disc.files.map(f => String(f.fileId)))
const pyStems = new Set(disc.files.filter(f => f.kind === 'constraint-py').map(f => f.path.replace(/\.py$/, '')))
const mdStems = new Set(disc.files.filter(f => f.kind === 'constraint-md').map(f => f.path.replace(/\.md$/, '')))

const verifs = (await parallel(liveTransforms.map(t => () => {
  const spec = specByFileId[String(t.fileId)]
  const stem = spec ? spec.path.replace(/\.(md|py)$/, '') : ''
  const pairExpectation = spec && spec.kind === 'constraint-md'
    ? (pyStems.has(stem) ? `This is a CONSTRAINT — a co-located ${stem}.py MUST also be in the generated set (it is: ${pyStems.has(stem)}). pairOk=true iff that holds.` : 'This is a CONVENTION (.md only, no .py in the set) — pairOk=true (N/A).')
    : (spec && spec.kind === 'constraint-py'
      ? `This is a check script — its .md (${stem}.md) MUST also be in the generated set (it is: ${mdStems.has(stem)}). pairOk=true iff that holds.`
      : 'Not a constraint — pairOk=true (N/A).')
  return agent(
    `You are a READ-ONLY verifier. Do NOT create, edit, or overwrite any files. Confirm a generated file matches its DESIGN spec.
Set fileId="${t.fileId}" verbatim.

DESIGN SPEC the file had to satisfy:
${spec ? spec.spec : '(spec missing — flag critical)'}

GENERATED CONTENT (as written by the transform agent):
${(t.content || '').slice(0, 6000)}

Also try to Read the file at ${t.path} (it may already be merged); if present, prefer the on-disk content over the digest above.
Check:
1. matchesSpec — does the content satisfy EVERY item in the spec (responsibility, gate + artifact, enforcement patterns, transition, frontmatter, post-subagent boundary)? Missing a gate or an enforcement pattern DESIGN required = matchesSpec=false with a critical/major finding.
2. Path portability: no \${CLAUDE_SKILL_DIR} in any hook command: field; verifier agents restricted to read-only. Violations are critical findings.
3. ${pairExpectation}
Return VERIFY_SCHEMA — list every gap in findings with severity.`,
    { label: `verify:${t.fileId}`, phase: 'Verify', schema: VERIFY_SCHEMA, model: 'sonnet' }
  )
}))).filter(Boolean)
const verifyById = Object.fromEntries(verifs.map(v => [String(v.fileId), v]))

// ── Phase 4: Gate (pure JS — all files created AND all verifies pass) ───────────
phase('Gate')
const transformById = Object.fromEntries([...liveTransforms, ...carried].map(t => [String(t.fileId), t]))
const SEV_RANK = { critical: 0, major: 1, minor: 2 }
const rows = []
const findings = []
for (const f of disc.files) {
  const id = String(f.fileId)
  const t = transformById[id]
  const v = verifyById[id] || (PRIOR.has(id) ? PRIOR.get(id).verify : null)
  const created = !!t && t.status === 'created'
  const matches = !!v && v.matchesSpec === true
  const pairOk = !v || v.pairOk !== false
  const pass = created && matches && pairOk
  rows.push({ fileId: id, kind: f.kind, path: f.path, created, matches, pairOk, pass })
  if (!created) findings.push({ severity: 'critical', fileId: id, detail: `${id}: not created (status=${t ? t.status : 'missing'})` })
  for (const ff of (v?.findings || [])) findings.push({ severity: ff.severity, fileId: id, detail: `${id}: ${ff.detail}` })
  if (created && !pairOk) findings.push({ severity: 'critical', fileId: id, detail: `${id}: constraint .md/.py pairing broken (co-location convention violated)` })
}
findings.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])

const overallPass = rows.length > 0 && rows.every(r => r.pass)
const verdict = overallPass ? 'GENERATED' : 'GAPS FOUND'

const scoreTable = [
  '| File | Kind | Created | Matches spec | Pair OK | Gate |',
  '|------|------|---------|--------------|---------|------|',
  ...rows.map(r => `| ${r.fileId} | ${r.kind} | ${r.created ? '✅' : '❌'} | ${r.matches ? '✅' : '❌'} | ${r.pairOk ? '✅' : '❌'} | ${r.pass ? '✅' : '❌'} |`),
  `| **Overall** | ${rows.length} files | ${rows.filter(r => r.created).length}/${rows.length} | ${rows.filter(r => r.matches).length}/${rows.length} | — | ${overallPass ? '✅ GENERATED' : '❌ GAPS'} |`,
].join('\n')

log(overallPass
  ? `✅ wc-generate: all ${rows.length} file(s) generated and verified`
  : `❌ wc-generate: ${rows.filter(r => !r.pass).length}/${rows.length} file(s) failed — ${findings.length} finding(s). Skill must merge worktrees then ground-truth ls/node-check.`)

return {
  overallPass,
  verdict,
  summary: { total: rows.length, created: rows.filter(r => r.created).length, passed: rows.filter(r => r.pass).length, findings: findings.length },
  scoreTable,
  files: rows,                  // per-file create/verify status the skill renders
  findings,                     // severity-ordered failures
  // raw per-file records (transform + verify) for priorReviews on a selective re-run
  reviews: [...liveTransforms, ...carried].map(t => ({ ...t, verify: verifyById[String(t.fileId)] || (PRIOR.get(String(t.fileId))?.verify ?? null) })),
  filesThatFailed: rows.filter(r => !r.pass).map(r => r.fileId), // pass as onlyChecks on a re-run
}
