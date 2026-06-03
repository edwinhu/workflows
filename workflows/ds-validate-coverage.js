export const meta = {
  name: 'ds-validate-coverage',
  description: 'Per-requirement output-coverage validation as an ultracode workflow: one read-only validator per SPEC.md requirement runs DQ1-DQ5 + M1 on the output, returns RAW per-check statuses, and the script computes COVERED/PARTIAL/MISSING + the validated|gaps_found gate in pure JS. Read-only; does NOT fix.',
  whenToUse: 'Called by the ds-validate skill (Phase 3.5) after implement and before review. Returns the requirements coverage matrix + a validated|gaps_found status the skill renders into VALIDATION.md. The skill keeps the user fix/accept decision and the /goal loop; on a re-run it passes onlyChecks (changed requirement IDs) + priorReviews.',
  phases: [
    { title: 'Discover', detail: 'enumerate SPEC requirements + resolve outputs, ds-checks.md, pipeline row counts' },
    { title: 'Validate', detail: 'one read-only DQ validator per requirement, in parallel' },
    { title: 'Gate', detail: 'compute COVERED/PARTIAL/MISSING + validated|gaps_found, in JS from raw statuses' },
  ],
}

// ── Inputs ──────────────────────────────────────────────────────────────────
// args = {
//   projectDir: "/abs/analysis-project",   // REQUIRED — holds .planning/ (SPEC, PLAN, LEARNINGS) + outputs
//   pluginRoot: "/abs/.../workflows",        // optional — for resolving ds-checks.md when not installed in cache
//   onlyChecks?: ["DATA-01", ...],           // re-run loop: re-validate only these requirement IDs; carry the rest
//   priorReviews?: [<requirement objects>],  // re-run loop: prior per-requirement results to carry forward
// }
let cfg = args
if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch { cfg = {} } }
cfg = cfg || {}
const PROJECT = cfg.projectDir
if (!PROJECT) throw new Error(`ds-validate-coverage requires args.projectDir. Got "${typeof args}": ${JSON.stringify(args)?.slice(0, 200)}`)
const ONLY = Array.isArray(cfg.onlyChecks) && cfg.onlyChecks.length ? new Set(cfg.onlyChecks.map(String)) : null
const PRIOR = new Map((Array.isArray(cfg.priorReviews) ? cfg.priorReviews : []).map(r => [String(r.reqId), r]))

// ── Schemas ───────────────────────────────────────────────────────────────────
const DQ_STATUS = { type: 'string', enum: ['PASS', 'WARN', 'FAIL', 'NA'] }

const DISCOVERY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['checksDoc', 'rowCountsKnown', 'requirements'],
  properties: {
    checksDoc: { type: 'string', description: 'absolute path to ds-checks.md (DQ definitions), or "" if absent' },
    rowCountsKnown: { type: 'boolean', description: 'true if LEARNINGS.md has pipeline row counts for DQ4 traceability' },
    requirements: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['reqId', 'description', 'scope', 'successCriteria', 'expectedOutput'],
        properties: {
          reqId: { type: 'string', description: 'CATEGORY-NN id from SPEC.md' },
          description: { type: 'string' },
          scope: { type: 'string', description: 'v1 | v2 | out-of-scope' },
          successCriteria: { type: 'string' },
          expectedOutput: { type: 'string', description: 'output file path or variable, or "" if unspecified' },
        },
      },
    },
  },
}

// Validators return RAW statuses + counts — NOT a classification. The JS gate classifies.
const VALIDATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['reqId', 'outputExists', 'rowsNonEmpty', 'dq', 'm1', 'itemsChecked', 'findings', 'reportMarkdown'],
  properties: {
    reqId: { type: 'string', description: 'echo the dispatched requirement id verbatim — the gate keys on it' },
    outputExists: { type: 'boolean', description: 'Level 1 — output file/variable present' },
    rowsNonEmpty: { type: 'boolean', description: 'Level 2 — substantive (>0 rows, expected columns)' },
    dq: {
      type: 'object', additionalProperties: false,
      required: ['DQ1', 'DQ2', 'DQ3', 'DQ4', 'DQ5'],
      properties: { DQ1: DQ_STATUS, DQ2: DQ_STATUS, DQ3: DQ_STATUS, DQ4: DQ_STATUS, DQ5: DQ_STATUS },
    },
    m1: { ...DQ_STATUS, description: 'M1 spec compliance — does the output address the requirement?' },
    itemsChecked: { type: 'integer', description: 'checks actually run (0 ⇒ unreliable, e.g. output missing)' },
    findings: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['check', 'status', 'detail'],
        properties: { check: { type: 'string' }, status: { type: 'string', enum: ['WARN', 'FAIL'] }, detail: { type: 'string' } },
      },
    },
    reportMarkdown: { type: 'string' },
  },
}

// ── Phase 1: Discover ─────────────────────────────────────────────────────────
phase('Discover')
const disc = await agent(
  `Enumerate the analysis requirements and resolve validation inputs. Working directory: ${PROJECT}

1. Read .planning/SPEC.md — extract EVERY requirement from the Requirements table: its CATEGORY-NN id, description, scope (v1|v2|out-of-scope), and success criteria.
2. Read .planning/PLAN.md — map each requirement to its expected output (file path or variable). If a task header lists \`implements: [IDs]\`, use it.
3. Read .planning/LEARNINGS.md — set rowCountsKnown=true if it records pipeline row counts at each stage (DQ4 traceability needs them).
4. Resolve checksDoc = absolute path to ds-checks.md (DQ definitions). ${cfg.pluginRoot ? `Plugin workflows root: ${cfg.pluginRoot} (ds-checks.md is at ../skills/ds-implement/references/ds-checks.md relative to it).` : 'Resolve via: command ls -d ~/.claude/plugins/cache/*/workflows/*/skills/ds-implement/references/ds-checks.md, or the in-repo skills/ds-implement/references/ds-checks.md.'}

Return DISCOVERY_SCHEMA. Absolute paths. Include out-of-scope requirements too (the gate filters them).`,
  { label: 'discover', phase: 'Discover', schema: DISCOVERY_SCHEMA, model: 'sonnet' }
)
// Out-of-scope requirements are not gated.
let requirements = (disc.requirements || []).filter(r => r.scope !== 'out-of-scope')
if (!requirements.length) throw new Error('No in-scope requirements discovered — check .planning/SPEC.md Requirements table')
log(`Requirements: ${requirements.length} in-scope; ${ONLY ? `re-validate ${ONLY.size}` : 'full validation'}; checks=${disc.checksDoc || 'ds-checks.md NOT FOUND'}`)

// ── Phase 2: Validate (per-requirement, parallel, read-only) ───────────────────
phase('Validate')
const tasks = []
const carried = []
let reran = 0, carriedCount = 0
for (const r of requirements) {
  if (ONLY && !ONLY.has(String(r.reqId))) {
    if (PRIOR.has(String(r.reqId))) { carried.push(PRIOR.get(String(r.reqId))); carriedCount++ }
    continue
  }
  reran++
  tasks.push(() => agent(
    `You are a READ-ONLY data-quality validator. Do NOT create, edit, or overwrite any code or data files. Inspect outputs only.
Set reqId="${r.reqId}" verbatim in your returned record (the gate keys on it).

REQUIREMENT (${r.reqId}): ${r.description}
SUCCESS CRITERIA: ${r.successCriteria}
EXPECTED OUTPUT: ${r.expectedOutput || '(unspecified — locate it from PLAN.md / LEARNINGS.md)'}
DQ DEFINITIONS: read ${disc.checksDoc || '.planning + skills/ds-implement/references/ds-checks.md'} for DQ1-DQ5 + M1 semantics.
PIPELINE ROW COUNTS: ${disc.rowCountsKnown ? 'in .planning/LEARNINGS.md (use for DQ4 traceability)' : 'NOT recorded — mark DQ4 as WARN if you cannot trace the final count'}

Run each check and report its RAW status (PASS / WARN / FAIL / NA) — do NOT compute an overall grade or classification, the orchestrator does that:
- outputExists (Level 1): is the output file/variable present? If MISSING, set outputExists=false, itemsChecked=0, and mark all DQ + m1 = NA.
- rowsNonEmpty (Level 2): >0 rows and expected columns present?
- DQ1 empty/constant columns · DQ2 high-null (>50%) · DQ3 duplicate rows on key · DQ4 row-count traceability vs LEARNINGS · DQ5 cardinality sanity
- m1 (Level 4): does the output actually address the requirement / success criteria?
itemsChecked = number of checks actually executed (0 if the output is missing). For every WARN/FAIL, add a findings entry. Return VALIDATE_SCHEMA.`,
    { label: String(r.reqId), phase: 'Validate', schema: VALIDATE_SCHEMA, model: 'sonnet' }))
}
const live = (await parallel(tasks)).filter(Boolean)
if (ONLY) log(`Selective re-validation: ${reran} requirement(s) live, ${carriedCount} carried`)
const reviews = [...live, ...carried]

// ── Phase 3: Gate (pure JS — classify from raw statuses; NEVER trust an agent grade) ─
phase('Gate')
const byId = Object.fromEntries(requirements.map((r, i) => [String(r.reqId), { ...r, order: i }]))
const rows = []
const findings = []
for (const v of reviews) {
  const dqVals = Object.values(v.dq || {})
  const anyFail = dqVals.includes('FAIL') || v.m1 === 'FAIL'
  const anyWarn = dqVals.includes('WARN') || v.m1 === 'WARN'
  const unreliable = !(v.itemsChecked > 0) && v.outputExists !== false  // 0 checks but claims present = can't trust
  let classification
  if (v.outputExists === false) classification = 'MISSING'
  else if (!v.rowsNonEmpty || anyFail) classification = 'PARTIAL'
  else if (anyWarn) classification = 'PARTIAL'
  else classification = 'COVERED'
  const meta = byId[String(v.reqId)] || { description: '(unknown)', scope: 'v1', order: 99 }
  rows.push({ reqId: v.reqId, description: meta.description, scope: meta.scope, order: meta.order, classification, unreliable, dq: v.dq, m1: v.m1 })
  for (const f of (v.findings || [])) findings.push({ reqId: v.reqId, ...f })
}
rows.sort((a, b) => a.order - b.order)

// Status gate: validated only if every v1 requirement is COVERED and reliable. v2 gaps don't block.
const v1Rows = rows.filter(r => r.scope === 'v1')
const covered = rows.filter(r => r.classification === 'COVERED').length
const partial = rows.filter(r => r.classification === 'PARTIAL').length
const missing = rows.filter(r => r.classification === 'MISSING').length
const v1Clean = v1Rows.length > 0 && v1Rows.every(r => r.classification === 'COVERED' && !r.unreliable)
const status = v1Clean ? 'validated' : 'gaps_found'
const overallPass = status === 'validated'

const scoreTable = [
  '| # | Requirement | Scope | DQ1 | DQ2 | DQ3 | DQ4 | DQ5 | M1 | Classification | Gate |',
  '|---|-------------|-------|-----|-----|-----|-----|-----|----|----------------|------|',
  ...rows.map((r, i) => {
    const d = r.dq || {}
    const gate = r.classification === 'COVERED' ? '✅' : (r.scope === 'v1' ? '❌' : '⚠️')
    return `| ${i + 1} | ${r.reqId}: ${r.description} | ${r.scope} | ${d.DQ1 || '—'} | ${d.DQ2 || '—'} | ${d.DQ3 || '—'} | ${d.DQ4 || '—'} | ${d.DQ5 || '—'} | ${r.m1 || '—'} | ${r.classification}${r.unreliable ? ' (unreliable)' : ''} | ${gate} |`
  }),
].join('\n')

log(overallPass
  ? `✅ status=validated — ${covered}/${rows.length} COVERED`
  : `❌ status=gaps_found — covered ${covered}, partial ${partial}, missing ${missing} (v1 gaps block)`)

return {
  overallPass,
  status,                       // validated | gaps_found — for VALIDATION.md frontmatter
  counts: { total: rows.length, covered, partial, missing },
  scoreTable,                   // requirements matrix the skill renders into VALIDATION.md
  findings,                     // non-COVERED DQ findings, for the skill to present
  reviews,                      // raw per-requirement records, for priorReviews on re-run
  reviewersThatFlagged: rows.filter(r => r.classification !== 'COVERED').map(r => String(r.reqId)), // for onlyChecks
}
