export const meta = {
  name: 'writing-draft',
  description: "Expand authenticated PLAN-bound section outlines into prose, verify execution fidelity, and return a computed gate.",
  whenToUse: "Called after authenticated whole-plan review and detailed outlines. Requires planPath, planHash, and a deterministic sectionIndex; never discovers alternate authority.",
  phases: [
    { title: 'Discover', detail: 'load the authenticated PLAN-bound section index and assert paragraph granularity' },
    { title: 'Transform', detail: 'one write-agent per section — expands its outline to prose from the pinned spec + prior/next outlines for transitions, NOT from judgment' },
    { title: 'Verify', detail: 'read-only: every outline point expanded, only the outline-pinned sources cited, first/last sentences connect to neighbors' },
    { title: 'Gate', detail: 'all sections drafted AND coverage/fidelity/transition substrate clean — computed in JS' },
  ],
}

// ── Inputs ──────────────────────────────────────────────────────────────────
// args = {
//   projectDir: "/abs/writing-project-dir",     // REQUIRED — holds .planning/, outlines/, drafts/
//   projectReal: "/abs/resolved-project-dir",   // REQUIRED — bundle.projectReal from the authenticate pre-step
//   artifacts: { receipt|plan|bib|"section:<name>:outline"|"section:<name>:draft": {path, real, hash, text} },
//                                                // REQUIRED — bundle.artifacts from `writing_section_index.py --authenticate`.
//                                                // INPUTS only. `section:<name>:draft` is present only for a section this
//                                                // run does NOT redraft (a carried selective-retry section, whose draft
//                                                // already existed at entry). Drafts this run produces are OUTPUTS and
//                                                // cannot appear in an entry bundle — see the Gate phase.
//   pluginRoot: "/abs/.../workflows",            // optional — for resolving the domain skill (writing-{style})
//   outputSubdir: "drafts",                      // optional compatibility value; canonical execution rejects alternatives
//   onlyChecks?: ["Part II", ...],                // re-run loop: re-draft only these sections; carry the rest
//   priorReviews?: [<section objects>],           // re-run loop: prior per-section results to carry forward
// }
let cfg = args
if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch { cfg = {} } }
cfg = cfg || {}
const PROJECT = cfg.projectDir
if (!PROJECT) throw new Error(`writing-draft requires args.projectDir. Got "${typeof args}": ${JSON.stringify(args)?.slice(0, 200)}`)
const PLUGIN = cfg.pluginRoot || ''
const OUTDIR = cfg.outputSubdir || 'drafts'
if (OUTDIR !== 'drafts') throw new Error('writing-draft canonical execution must write the exact Draft paths in PLAN Section Outputs; alternate outputSubdir is not authoritative.')
const ONLY = Array.isArray(cfg.onlyChecks) && cfg.onlyChecks.length ? new Set(cfg.onlyChecks.map(String)) : null
const PRIOR = new Map((Array.isArray(cfg.priorReviews) ? cfg.priorReviews : []).map(s => [String(s.section), s]))
// The caller must pass the authenticated PLAN-bound index. Canonical writing has no
// LLM or retired-file discovery fallback: absent, malformed, or stale inputs fail closed.
const PLAN_PATH = typeof cfg.planPath === 'string' ? cfg.planPath : ''
const PLAN_HASH = typeof cfg.planHash === 'string' ? cfg.planHash : ''
const SECTION_INDEX = (cfg.sectionIndex && Array.isArray(cfg.sectionIndex.sections) && cfg.sectionIndex.sections.length) ? cfg.sectionIndex : null
if (!PLAN_PATH || !PLAN_HASH || !SECTION_INDEX) {
  throw new Error('writing-draft requires args.planPath, args.planHash, and a non-empty deterministic args.sectionIndex; canonical discovery never falls back to an LLM or retired planning files.')
}
if (SECTION_INDEX.ok !== true || SECTION_INDEX.planPath !== PLAN_PATH || SECTION_INDEX.planHash !== PLAN_HASH) {
  throw new Error('writing-draft rejected a malformed or stale section index: ok, planPath, and planHash must match the authenticated PLAN input.')
}
for (const prior of (Array.isArray(cfg.priorReviews) ? cfg.priorReviews : [])) {
  if (prior.planHash !== PLAN_HASH) throw new Error('writing-draft rejected priorReviews from a different plan hash.')
}
for (const key of ['precisPath', 'outlinePath', 'activeWorkflowPath', 'legacyPlanPath']) {
  if (cfg[key]) throw new Error(`writing-draft rejected mixed active authority: args.${key} is retired.`)
}
if (SECTION_INDEX.precisPath || (SECTION_INDEX.outlinePath && SECTION_INDEX.outlinePath !== PLAN_PATH)) {
  throw new Error('writing-draft rejected an index carrying retired active planning authority.')
}

// ── Authenticated artifact bundle (no filesystem access in here) ─────────────
// Workflow scripts are pure control flow: the runtime rejects import(), import.meta,
// process, and Buffer. The TOCTOU-hardened snapshot/hash/read that used to run here
// now runs in scripts/writing/writing_section_index.py --authenticate, the same
// deterministic pre-step that compiles this index, and arrives via args.artifacts.
// It is NOT delegated to an agent: the section index already comes from an agent, and
// asking the untrusted party to vouch for its own artifacts is not authentication.
//
// writing-draft is a WRITER, so the split matters here in a way it does not in
// writing-review. Only the artifacts that exist BEFORE dispatch — receipt, plan, bib,
// every section outline, and the already-written drafts of carried selective-retry
// sections — can be authenticated by an entry bundle. The drafts this run produces
// come into existence AFTER dispatch, inside untrusted agents; no entry snapshot can
// speak for them, and an agent's self-reported bytes are not evidence about the file
// it wrote. Those are verified by the deterministic post-step (`--verify --findings`),
// which is why this run returns verifyRequired: true.
const isAbs = value => typeof value === 'string' && value.startsWith('/')
const normalizePath = value => {
  const out = []
  for (const segment of String(value).split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') { out.pop(); continue }
    out.push(segment)
  }
  return '/' + out.join('/')
}
// resolve() over already-absolute inputs only. A relative or empty input is a
// missing authenticated value, and yields a sentinel that can never compare equal
// to a real path — the pre-extraction code reached cwd here and failed the same way.
const INVALID = '<unauthenticated-path>'
const resolvePath = (...parts) => {
  let base = ''
  for (const part of parts) {
    if (!part || typeof part !== 'string') return INVALID
    base = isAbs(part) ? part : (base ? `${base}/${part}` : INVALID)
    if (base === INVALID) return INVALID
  }
  return base ? normalizePath(base) : INVALID
}
const joinPath = (...parts) => normalizePath(parts.join('/'))
// Strict containment: equivalent to the old `relative()` test — an empty relative
// path (same file), a '..' prefix, or an absolute result all fail closed.
const containedBy = (root, path) => typeof path === 'string' && path !== INVALID && path !== root && path.startsWith(`${root}/`)

const PROJECT_REAL = typeof cfg.projectReal === 'string' ? cfg.projectReal : ''
if (!isAbs(PROJECT_REAL) || normalizePath(PROJECT_REAL) !== PROJECT_REAL) {
  throw new Error('writing-draft requires args.projectReal: the absolute resolved projectDir emitted by writing_section_index.py --authenticate.')
}
const ARTIFACTS = (cfg.artifacts && typeof cfg.artifacts === 'object' && !Array.isArray(cfg.artifacts)) ? cfg.artifacts : null
if (!ARTIFACTS) throw new Error('writing-draft requires args.artifacts: the authenticated bundle from writing_section_index.py --authenticate.')
const HEX64 = /^[0-9a-f]{64}$/
const artifact = key => {
  const snapshot = ARTIFACTS[key]
  if (!snapshot || typeof snapshot !== 'object') throw new Error(`writing-draft is missing an authenticated artifact: ${key}`)
  const { path, real, hash, text } = snapshot
  if (!isAbs(path) || !isAbs(real) || typeof text !== 'string' || !HEX64.test(String(hash))) {
    throw new Error(`writing-draft rejected a malformed authenticated artifact: ${key}`)
  }
  if (!containedBy(PROJECT_REAL, normalizePath(real))) throw new Error(`writing-draft artifact escapes projectDir: ${key} (${real})`)
  return { path, real: normalizePath(real), hash, text }
}
const SECTION_KEY = (name, kind) => `section:${name}:${kind}`
const PLAN_FILE = typeof SECTION_INDEX.planFile === 'string' ? SECTION_INDEX.planFile : ''
if (!/^\.planning\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(PLAN_FILE) || PLAN_FILE === '.planning/PLAN.md' || SECTION_INDEX.reviewStatus !== 'APPROVED') {
  throw new Error('writing-draft requires an APPROVED receipt-selected generated planFile; fixed PLAN.md and non-approved review state cannot authorize implementation.')
}
const EXPECTED_PLAN = resolvePath(PROJECT_REAL, PLAN_FILE)
const PLAN_SNAPSHOT = artifact('plan')
const PLAN_REAL = PLAN_SNAPSHOT.real
if (resolvePath(PLAN_PATH) !== resolvePath(PLAN_SNAPSHOT.path) || PLAN_REAL !== EXPECTED_PLAN || !containedBy(joinPath(PROJECT_REAL, '.planning'), PLAN_REAL)) {
  throw new Error('writing-draft planPath must equal the receipt-selected generated planFile and may not escape through a symlink.')
}
const parseFlatStringJson = raw => {
  const text = raw.trim(); let index = 0
  const skip = () => { while (/\s/.test(text[index] || '')) index++ }
  const readString = () => {
    skip(); if (text[index] !== '"') throw new Error('not a JSON string')
    const start = index++; let escaped = false
    while (index < text.length) {
      const char = text[index++]
      if (escaped) { escaped = false; continue }
      if (char === '\\') { escaped = true; continue }
      if (char === '"') return JSON.parse(text.slice(start, index))
    }
    throw new Error('unterminated JSON string')
  }
  skip(); if (text[index++] !== '{') throw new Error('not an object')
  const value = {}; skip()
  if (text[index] === '}') index++
  else while (index < text.length) {
    const key = readString(); if (Object.hasOwn(value, key)) throw new Error(`duplicate field ${key}`)
    skip(); if (text[index++] !== ':') throw new Error('missing colon')
    value[key] = readString(); skip()
    if (text[index] === ',') { index++; continue }
    if (text[index] === '}') { index++; break }
    throw new Error('missing separator')
  }
  skip(); if (index !== text.length) throw new Error('trailing content')
  return value
}
const RECEIPT_PATH = joinPath(PROJECT_REAL, '.planning', '.state', 'review.json')
const RECEIPT_SNAPSHOT = artifact('receipt')
if (resolvePath(RECEIPT_SNAPSHOT.path) !== RECEIPT_PATH) throw new Error('writing-draft authenticated receipt is not the projectDir combined review state.')
const receiptKeys = ['workflow', 'plan_file', 'plan_hash', 'approved_session_id', 'approved_at', 'status', 'reviewer_session_id', 'reviewed_at']
const strictUtc = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const receiptApproved = value => Object.keys(value).length === receiptKeys.length && receiptKeys.every(key => Object.hasOwn(value, key)) && value.workflow === 'writing' && `.planning/${value.plan_file}` === PLAN_FILE && value.plan_hash === PLAN_HASH && value.status === 'APPROVED' && typeof value.approved_session_id === 'string' && !!value.approved_session_id.trim() && typeof value.reviewer_session_id === 'string' && !!value.reviewer_session_id.trim() && value.approved_session_id !== value.reviewer_session_id && strictUtc(value.approved_at) && strictUtc(value.reviewed_at) && Date.parse(value.reviewed_at) > Date.parse(value.approved_at)
let receipt
try { receipt = parseFlatStringJson(RECEIPT_SNAPSHOT.text) } catch { throw new Error('writing-draft rejected malformed or duplicate combined review state.') }
if (!receiptApproved(receipt)) {
  throw new Error('writing-draft combined review state does not authenticate the supplied generated plan identity.')
}
const PLAN_TEXT = PLAN_SNAPSHOT.text
const ACTUAL_PLAN_HASH = PLAN_SNAPSHOT.hash
if (ACTUAL_PLAN_HASH !== PLAN_HASH) throw new Error('writing-draft generated plan bytes no longer match args.planHash.')
const REQUIRED_H2 = ['Writing Intent', 'Claims', 'Counterarguments', 'Document Structure', 'Claim → Section Map', 'Source Plan', 'Section Outputs', 'Review Surfaces']
const OBSERVED_H2 = [...PLAN_TEXT.matchAll(/^##\s+(.+?)\s*$/gm)].map(m => m[1])
if (JSON.stringify(OBSERVED_H2) !== JSON.stringify(REQUIRED_H2)) throw new Error('writing-draft PLAN grammar changed after compilation.')
const structureBlock = PLAN_TEXT.match(/^## Document Structure\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m)?.[1] || ''
const plannedNames = [...structureBlock.matchAll(/^###\s+(.+?)\s*$/gm)].map(m => m[1])
const indexedNames = SECTION_INDEX.sections.map(s => String(s.name))
if (JSON.stringify(plannedNames) !== JSON.stringify(indexedNames)) throw new Error('writing-draft section index is truncated, reordered, or not compiled from PLAN Document Structure.')
const outputsBlock = PLAN_TEXT.match(/^## Section Outputs\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m)?.[1] || ''
const tableLines = outputsBlock.split('\n').map(line => line.trim()).filter(line => line.startsWith('|'))
const cells = line => line.slice(1, -1).split('|').map(cell => cell.trim())
const artifactIdentity = text => {
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1] || ''
  const implementMatches = [...frontmatter.matchAll(/^implements:\s*\[(.*?)\]\s*$/gm)]
  const hashMatches = [...frontmatter.matchAll(/^plan_hash:\s*([0-9a-f]{64})\s*$/gm)]
  if (implementMatches.length !== 1 || hashMatches.length !== 1) return { valid: false, implements: [], planHash: '' }
  const raw = implementMatches[0][1].trim()
  const implementsClaims = raw ? raw.split(',').map(value => value.trim()) : []
  const valid = implementsClaims.every(value => /^CLAIM-[0-9]{2}$/.test(value)) && new Set(implementsClaims).size === implementsClaims.length
  return { valid, implements: implementsClaims, planHash: hashMatches[0][1] }
}
const headers = tableLines.length ? cells(tableLines[0]).map(h => h.toLowerCase()) : []
const outputRows = tableLines.slice(2).map(line => Object.fromEntries(headers.map((h, i) => [h, cells(line)[i] || ''])))
const intentBlock = PLAN_TEXT.match(/^## Writing Intent\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m)?.[1] || ''
const plannedStyle = intentBlock.match(/^\s*(?:[-*]\s*)?(?:\*\*)?Domain(?:\*\*)?\s*:\s*(legal|econ|general)\s*$/mi)?.[1]?.toLowerCase() || ''
if (SECTION_INDEX.style !== plannedStyle) throw new Error('writing-draft section index style does not match PLAN Writing Intent.')
const sourceBlock = PLAN_TEXT.match(/^## Source Plan\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m)?.[1] || ''
const plannedSourcePlan = {}
for (const match of sourceBlock.matchAll(/^\s*(?:[-*]\s*)?(?:\*\*)?([A-Za-z][A-Za-z /_-]*?)(?:\*\*)?\s*:\s*(.+?)\s*$/gm)) {
  plannedSourcePlan[match[1].trim().replace(/\s+/g, ' ').toLowerCase()] = match[2].trim()
}
const plannedBib = plannedSourcePlan.bibliography || ''
const normalizedSourceEntries = value => JSON.stringify(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)))
const EXPECTED_BIB = resolvePath(PROJECT_REAL, plannedBib)
if (resolvePath(SECTION_INDEX.bibPath || '') !== EXPECTED_BIB || normalizedSourceEntries(SECTION_INDEX.sourcePlan) !== normalizedSourceEntries(plannedSourcePlan)) {
  throw new Error('writing-draft section index Source Plan context does not match the generated plan.')
}
const BIB_SNAPSHOT = artifact('bib')
if (resolvePath(BIB_SNAPSHOT.path) !== EXPECTED_BIB) throw new Error('writing-draft authenticated bibliography is not the PLAN Source Plan bibliography.')
const reviewBlock = PLAN_TEXT.match(/^## Review Surfaces\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m)?.[1] || ''
const plannedSurfaces = [...reviewBlock.matchAll(/^\s*[-*]\s+(\S.*?)\s*$/gm)].map(match => match[1])
if (JSON.stringify(SECTION_INDEX.reviewSurfaces || []) !== JSON.stringify(plannedSurfaces)) throw new Error('writing-draft section index Review Surfaces do not match the generated plan.')
const mapBlock = PLAN_TEXT.match(/^## Claim → Section Map\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m)?.[1] || ''
const mapLines = mapBlock.split('\n').map(line => line.trim()).filter(line => line.startsWith('|'))
const mapHeaders = mapLines.length ? cells(mapLines[0]).map(h => h.toLowerCase()) : []
const mapRows = mapLines.slice(2).map(line => Object.fromEntries(mapHeaders.map((h, i) => [h, cells(line)[i] || ''])))
const expectedClaims = Object.fromEntries(indexedNames.map(name => [name, []]))
const admittedOutlineSnapshots = {}
const expectedDraftPaths = {}
for (const row of mapRows) if (expectedClaims[row.section]) expectedClaims[row.section].push(row.claim)
if (outputRows.length !== SECTION_INDEX.sections.length) throw new Error('writing-draft section index does not contain every PLAN Section Outputs row.')
for (let i = 0; i < SECTION_INDEX.sections.length; i++) {
  const section = SECTION_INDEX.sections[i]
  const row = outputRows[i]
  if (!row || row.section !== section.name) throw new Error('writing-draft section index order does not match PLAN Section Outputs.')
  const expectedOutline = resolvePath(PROJECT_REAL, row.outline)
  const expectedDraft = resolvePath(PROJECT_REAL, row.draft)
  for (const path of [expectedOutline, expectedDraft, resolvePath(section.outlineFile), resolvePath(section.draftFile)]) {
    if (!containedBy(PROJECT_REAL, path)) throw new Error('writing-draft rejected an artifact path outside projectDir.')
  }
  if (resolvePath(section.outlineFile) !== expectedOutline || resolvePath(section.draftFile) !== expectedDraft) {
    throw new Error('writing-draft section index artifact paths do not match PLAN Section Outputs.')
  }
  const expectedDependencies = !row['depends on'] || ['-', 'none', 'n/a'].includes(row['depends on'].toLowerCase()) ? [] : row['depends on'].split(/\s*(?:,|;)\s*/).filter(Boolean)
  if (JSON.stringify(section.dependencies || []) !== JSON.stringify(expectedDependencies)) throw new Error('writing-draft section index dependencies do not match PLAN Section Outputs.')
  const claimsForSection = expectedClaims[section.name] || []
  if (JSON.stringify(section.primaryClaims || []) !== JSON.stringify(claimsForSection)) throw new Error('writing-draft section index claims do not match PLAN Claim → Section Map.')
  if (section.outlineCurrent !== true) throw new Error(`writing-draft requires a current PLAN-bound detailed outline for ${section.name}: ${(section.outlineIssues || []).join('; ')}`)
  const outlineSnapshot = artifact(SECTION_KEY(section.name, 'outline'))
  if (resolvePath(outlineSnapshot.path) !== expectedOutline) {
    throw new Error(`writing-draft authenticated outline for ${section.name} is not the PLAN Section Outputs path.`)
  }
  admittedOutlineSnapshots[section.name] = outlineSnapshot
  expectedDraftPaths[section.name] = expectedDraft
  const outlineText = outlineSnapshot.text
  const outlineIdentity = artifactIdentity(outlineText)
  const outlineBullets = outlineText.split('\n').filter(line => /^\s*(?:[-*]|\d+\.)\s+\S/.test(line)).length
  if (!outlineIdentity.valid || outlineIdentity.planHash !== PLAN_HASH || JSON.stringify(outlineIdentity.implements) !== JSON.stringify(claimsForSection) || outlineBullets < 3 || /\b(?:TBA|TBD|develop this|to be (?:written|drafted)|\d+\s*pgs?)\b/i.test(outlineText)) {
    throw new Error(`writing-draft detailed outline for ${section.name} is stale, unmapped, or under-granular.`)
  }
}
const onlyInput = Array.isArray(cfg.onlyChecks) ? cfg.onlyChecks.map(String) : []
if (new Set(onlyInput).size !== onlyInput.length || onlyInput.some(name => !indexedNames.includes(name))) {
  throw new Error('writing-draft onlyChecks must contain unique current PLAN section names.')
}

// ── Schemas ───────────────────────────────────────────────────────────────────
const FINDING = {
  type: 'object', additionalProperties: false, required: ['severity', 'detail'],
  properties: {
    severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
    detail: { type: 'string' },
    location: { type: 'string', description: 'file:line or outline point id, if applicable' },
  },
}

// Write-agent returns what it wrote + the full content so verify can adjudicate independent of write timing.
const TRANSFORM_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['section', 'draftFile', 'status', 'content', 'pointsExpanded', 'summary', 'changedFiles'],
  properties: {
    changedFiles: { type: 'array', items: { type: 'string' }, description: 'EVERY project-relative file this task changed. The observation hook cross-checks this against the real git delta; omitting it is not a neutral omission, it fails adjudication and is attributed to you.' },
    section: { type: 'string', description: 'echo the section name verbatim — the gate keys on it' },
    draftFile: { type: 'string' },
    status: { type: 'string', enum: ['drafted', 'skipped', 'error'] },
    content: { type: 'string', description: 'the full prose written (so verify can validate before any merge/read race)' },
    pointsExpanded: { type: 'integer', description: 'count of outline points expanded into prose' },
    summary: { type: 'string', description: 'one line: which PLAN claim this advances + R1-R3 deviations applied' },
  },
}

const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['section', 'coverageOk', 'fidelityOk', 'transitionOk', 'findings', 'boundary'],
  properties: {
    section: { type: 'string', description: 'echo the section name verbatim' },
    coverageOk: { type: 'boolean', description: "SUBSTANCE coverage: is every outline point's CLAIM actually made and its logic landed in the prose? false ONLY for a genuinely DROPPED point/subsection (claim missing/unsupported). Do NOT require one-paragraph-per-point or a word-count — proportional development (a minor point folded into a clause) is CORRECT coverage, not a gap." },
    fidelityOk: { type: 'boolean', description: 'does every citation trace to a source the outline pinned (no invented/ungrounded cites)?' },
    transitionOk: { type: 'boolean', description: 'does the first sentence connect to what the prior section handed off, and the last set up the next? (true for first/last section if the open/close is sound)' },
    findings: { type: 'array', items: FINDING },
    boundary: {
      type: 'object', additionalProperties: false, required: ['firstSentence', 'lastSentence'],
      properties: { firstSentence: { type: 'string' }, lastSentence: { type: 'string' } },
    },
  },
}

// Section ROLE drives heading emission: only PARTS get lettered ## A./B./C. subsection headings;
// an Introduction or Conclusion is continuous unheaded prose even when its outline groups its Body
// as A/B/C (those groupings guide paragraph ORDER, not headings). Match on the FULL title after
// stripping a leading enumeration prefix ("Part V:", "V.", "IV:", "2.", "Section 3:") — a substring/
// prefix match would misclassify "Conclusions" / "Concluding Remarks" / "V. Conclusion" as non-continuous
// (false negative → wrongly lettered subsections) and "Introduction to the Regime" as continuous
// (false positive → verifier flags legit subsections, unsatisfiable /goal loop).
function isContinuousSection(name) {
  let s = String(name).trim()
  // Strip an enumeration prefix, but require an explicit keyword ("Part") or a delimiter immediately
  // after the roman/numeral run — otherwise "Conclusion" (which starts with the roman numeral "C")
  // would get its leading "C" eaten by a bare-letters match.
  s = s.replace(/^part\s+[ivxlcdm]+\.?:?\)?\s*/i, '')
  s = s.replace(/^(?:[ivxlcdm]+|\d+)[.:)]\s*/i, '')
  s = s.replace(/^section\s+\d+[.:)]?\s*/i, '')
  s = s.trim().toLowerCase()
  return /^(introduction|intro|conclusion(s)?|concluding remarks|summary and conclusions?|preface|foreword)$/.test(s)
}

// ── Phase 1: Discover ─────────────────────────────────────────────────────────
// Map the authenticated PLAN index into the workflow shape. draftFile is recomputed from OUTDIR so pilot output directories remain supported.
function discFromIndex(idx) {
  const style = idx.style && idx.style !== 'unspecified' ? idx.style : 'general'
  return {
    style,
    planPath: idx.planPath,
    domainSkillPath: PLUGIN ? `${PLUGIN}/../skills/writing-${style}/SKILL.md` : '',
    bibPath: idx.bibPath || '',
    sourcePlan: idx.sourcePlan || {},
    sections: idx.sections.map(s => ({
      name: String(s.name),
      outlineFile: s.outlineFile || '',
      draftFile: s.draftFile,
      precisClaim: (s.primaryClaims && s.primaryClaims.length ? s.primaryClaims : (s.implements || [])).join(', '),
      outlineGranular: s.granular !== false,
      sourcesPinned: !!s.sourcesPinned,
      granularityNote: s.granularityNote || '',
      prevName: s.prevName || '',
      nextName: s.nextName || '',
    })),
  }
}

phase('Discover')
const disc = discFromIndex(SECTION_INDEX)
if (!disc.sections.length) throw new Error(`writing-draft: no section outlines found under ${PROJECT}/outlines/. Detailed outlines must exist after authenticated whole-plan review before drafting.`)
log(`Discover: authenticated PLAN index (${disc.sections.length} sections, ${disc.style}, ${PLAN_HASH})`)
const underGranular = disc.sections.filter(s => s.outlineGranular === false)
const draftable = disc.sections.filter(s => s.outlineGranular !== false)
const outlineByName = Object.fromEntries(disc.sections.map(s => [String(s.name), s]))
const outlineSnapshots = admittedOutlineSnapshots
const draftSnapshots = {}
log(`${disc.sections.length} section(s); ${draftable.length} structured, ${underGranular.length} structureless (bounce to outline)${ONLY ? `; re-run ${ONLY.size}` : ''}`)
if (underGranular.length) log(`⚠️ structureless outlines (NOT drafted): ${underGranular.map(s => s.name).join(', ')} — add paragraph-level structure in writing-outline first`)
const unpinned = draftable.filter(s => s.sourcesPinned === false).map(s => s.name)
if (unpinned.length) log(`ℹ️ ${unpinned.length} outline(s) don't pin sources — draft agents will assign citations from the bib; fidelity check will verify each resolves: ${unpinned.join(', ')}`)

// ── Phase 2+3: Transform → Verify, chained per section (one parallel() barrier) ──────────
// Each section's verify used to wait on a SECOND parallel() barrier that blocked until every
// section finished drafting — so a slow section's draft held up a fast section's verify for no
// reason. Fix: compose draft→verify as ONE thunk per section and run all sections' chains in a
// single parallel() call; a fast section's verify starts the moment ITS OWN draft lands.
// Seams dissolve because the FULL spec exists up front: each agent reads the prior/next OUTLINE (not draft)
// to write correct bridges — no dependency on sibling drafts, so the fan-out is genuinely parallel.
phase('Transform')
const DOMAIN_RULE = {
  legal: 'Legal law-review register: confront counterarguments, NO secondary citations (cite originals), formal but not stuffy. Footnotes carry citations.',
  econ: 'Econ register: NO boilerplate ("This paper discusses…", roadmap paragraphs), NO elegant variation (one concept = one word), lead with the finding.',
  general: 'General academic prose: Strunk & White discipline — concrete, active, no filler/hedging.',
}
const tasks = []
const carried = []
const liveDispatchNames = new Set()
let drafted = 0, carriedCount = 0
for (const s of draftable) {
  if (ONLY && !ONLY.has(String(s.name))) {
    const prior = PRIOR.get(String(s.name))
    const outlineHash = outlineSnapshots[String(s.name)].hash
    // A carried section is NOT redrafted, so its draft already existed at entry and IS
    // an authenticable input: the bundle must carry it, and the prior result's draftHash
    // must equal the bytes the pre-step actually opened. (The live branch below has no
    // such entry snapshot — that draft does not exist yet.)
    const draftSnapshot = artifact(SECTION_KEY(String(s.name), 'draft'))
    if (resolvePath(draftSnapshot.path) !== resolvePath(expectedDraftPaths[String(s.name)])) {
      throw new Error(`writing-draft authenticated carried draft for ${s.name} is not the PLAN Section Outputs path.`)
    }
    const verify = prior?.verify
    if (!prior || prior.planHash !== PLAN_HASH || prior.outlineHash !== outlineHash || prior.draftHash !== draftSnapshot.hash || prior.status !== 'drafted' || !verify || verify.coverageOk !== true || verify.fidelityOk !== true || verify.transitionOk === false || !Array.isArray(verify.findings)) {
      throw new Error(`writing-draft selective retry requires one complete current-content prior result for ${s.name}.`)
    }
    draftSnapshots[String(s.name)] = draftSnapshot
    carried.push(prior)
    carriedCount++
    continue
  }
  drafted++
  liveDispatchNames.add(String(s.name))
  const prev = s.prevName ? outlineByName[String(s.prevName)] : null
  const next = s.nextName ? outlineByName[String(s.nextName)] : null
  // Section ROLE drives heading emission: only PARTS get lettered ## A./B./C. subsection headings;
  // an Introduction or Conclusion is continuous unheaded prose even when its outline groups its Body
  // as A/B/C (those groupings guide paragraph ORDER, not headings).
  const continuous = isContinuousSection(s.name)
  const draftPrompt =
    `TASK ${s.name}: draft section
You are a writing-draft prose generator. You EXPAND one section outline into prose. The outline pins the WHAT — the claims, their order at the section level, and the pinned sources. WITHIN the section you MAY merge, subordinate, or reorder the outline's points for PROPORTIONAL development: a minor point can become a clause inside a neighbor's paragraph; a pivotal one can run several paragraphs. What you may NOT do: add new claims, change the section-level structure the outline specifies, or invent citations the outline didn't pin. How the pinned points are developed, paced, and sentenced is YOURS — that judgment is what makes the prose read like a person wrote it.
Set section="${s.name}" verbatim in your record (the gate keys on it).

DOMAIN STYLE (${disc.style}): ${DOMAIN_RULE[disc.style] || DOMAIN_RULE.general}
${disc.domainSkillPath ? `Read ${disc.domainSkillPath} and follow its Iron Laws + register before writing a word.` : ''}

THIS SECTION'S IMMUTABLE OUTLINE SNAPSHOT (source path ${s.outlineFile}):
${outlineSnapshots[String(s.name)].text}
PLAN claim(s) it advances: ${s.precisClaim || '(none; claimless section)'}
Full authenticated PLAN context: ${PLAN_TEXT}

FOR TRANSITIONS ONLY (use these immutable outline snapshots, not live files or any draft):
${prev ? `- Prior section "${prev.name}" snapshot:\n${outlineSnapshots[String(prev.name)].text}\nYour FIRST sentence should connect to what it establishes.` : '- This is the FIRST section — open the document/argument cleanly (no "as discussed above").'}
${next ? `- Next section "${next.name}" snapshot:\n${outlineSnapshots[String(next.name)].text}\nYour LAST sentence should set it up.` : '- This is the LAST section — close cleanly, no dangling hand-off.'}

Drafting contract (the Iron Laws of writing-draft):
- TOPIC-SENTENCE-LED, PROPORTIONAL development. Lead each unit with its TOPIC SENTENCE — the outline POINT sharpened into a claim that carries the argument — then develop it IN PROPORTION TO ITS WEIGHT: a minor point may be a single clause folded into a neighbor's paragraph; a pivotal one may run several paragraphs. COVER every point's claim and keep every subsection transition as an explicit bridge — but do NOT give every point its own paragraph and do NOT pad to a word-count target. **Uniform one-paragraph-per-point is the FAILURE MODE — it reads flat and machine-made.** A reader should be able to follow the whole argument from the topic sentences alone. (Drop a point entirely and that is a stub; pad a thin point to look complete and that is the flat tell — neither is the goal.)
- RHYTHM (positive target, not just prohibitions): vary sentence and paragraph length deliberately. Mix short, punchy sentences with longer developed ones; let a pivotal claim land in a short sentence. High variance in sentence length (burstiness) is what human legal prose has and machine prose lacks. Use semicolons and colons where two clauses balance.
- EM-DASHES, RARELY. The single most common machine tell in this pipeline is em-dash over-use. Cap them at roughly ONE per 400 words, and only for a genuine appositive or aside — NEVER as a default connector. A comma, colon, semicolon, or period almost always serves better; reach for those first. (Human legal prose averages ~0.25 em-dashes per 1,000 words; a draft with one every other sentence reads machine-made regardless of how good the rhythm is.)
- HEADINGS — outline scaffolding is NOT document headings. The outline's \`## Opening\`, \`## Body\`, and \`## Closing\` are SCAFFOLDING LABELS that organize the outline; NEVER emit them — or any synonym like "Conclusion to Part II" / "Closing" — as a heading in the prose. ${continuous ? `THIS SECTION IS AN ${String(s.name).toUpperCase().includes('CONCLUSION') ? 'CONCLUSION' : 'INTRODUCTION'} — render it as CONTINUOUS UNHEADED PROSE. Emit NO lettered \`## A./B./C.\` subsection headings even though its outline groups the Body as A/B/C; those groupings guide paragraph ORDER only. The ONLY heading is the section TITLE (\`# ${s.name}\`).` : `This is a PART. The ONLY headings are the section TITLE (\`# <Section Name>\`) and the lettered subsection headings (\`## A. <Name>\`, \`## B. <Name>\`, …). Concretely: "Opening" → lead paragraph(s) with NO heading; "Body" → the lettered \`## A./B./C.\` subsections, which DO take headings; "Closing" → a trailing UNHEADED bridging paragraph after the last lettered subsection (a Part ends in an unheaded bridge, never a "Closing"/"Conclusion" heading).`}
- CITATIONS: this outline may not pin sources to its claims. Where a substantive claim needs a citation, draw it from a REAL source in this immutable authenticated bibliography snapshot (${disc.bibPath}):\n${BIB_SNAPSHOT.text}\nFor legal claims use a real, well-formed, verifiable authority (case/statute/article). Carry through any [@bibkey]/[CLAIM-XX] the outline DOES pin. **NEVER fabricate a citation, and NEVER attribute a claim to a source that does not support it.** If you cannot identify a real source for a claim, leave a literal \`[CITE-NEEDED: <what's needed>]\` marker instead of inventing one — the verify stage treats an invented cite as a critical failure but an honest CITE-NEEDED as a flag to resolve.
- Apply R1-R3 deviations inline if drafting surfaces them (R1 factual fix, R2 add a real source, R3 structural bridge). If you hit an R4 (the argument itself needs restructuring), do NOT invent a fix — note it in summary and draft to the outline as written.

Write the full prose to the exact PLAN-owned path ${s.draftFile} with the Write tool. Frontmatter MUST include \`implements: [${s.precisClaim}]\` (or an empty list when this section has no primary claim) and the exact \`plan_hash: ${PLAN_HASH}\`. Then return TRANSFORM_SCHEMA with draftFile exactly equal to that path, status="drafted", content=the FULL exact file content you wrote, pointsExpanded=the number of outline points you expanded, and changedFiles=EVERY project-relative path you changed (the observation hook cross-checks this against the real filesystem delta).`
  const buildVerifyPrompt = (t) =>
    `You are a READ-ONLY verifier. Do NOT create, edit, or overwrite any files. Confirm a drafted section faithfully EXECUTED its outline — this is execution-fidelity, NOT a document-quality review (writing-review does that later).
Set section="${t.section}" verbatim.

IMMUTABLE OUTLINE SNAPSHOT IT HAD TO EXPAND (${s.outlineFile}):
${outlineSnapshots[String(s.name)].text}
GENERATED PROSE SNAPSHOT RETURNED BY THE DRAFT AGENT:
${t.content || ''}
Judge only these immutable snapshots. Do not reread mutable outline or draft paths during verification.

Check, and report every gap in findings with severity:
1. coverageOk — SUBSTANCE coverage: is every outline point's CLAIM made and its logic landed? Judge whether the ARGUMENT the outline specifies is fully present — NOT whether each point got its own paragraph or hit a word count. Proportional development is CORRECT: a minor point folded into a clause/sentence is covered, not cursory; a uniform one-paragraph-per-point draft is NOT better-covered than a well-paced one. coverageOk=false ONLY when a point or subsection is genuinely DROPPED (its claim is absent/unsupported) ⇒ major; a wholly missing subsection ⇒ critical. Do NOT flag proportional brevity or varied paragraph length as a coverage gap.
2. fidelityOk — CITATION RESOLVABILITY (the chosen "mandatory source-verify" gate). Every citation in the prose must resolve to a REAL, identifiable source: an @bibkey must exist in this immutable authenticated bibliography snapshot (${disc.bibPath}):\n${BIB_SNAPSHOT.text}\nA legal authority must be well-formed and verifiable (a real case/statute/article, not a plausible-looking invention). Any citation you cannot confirm resolves — or any unfilled \`[CITE-NEEDED]\` marker left in the prose — ⇒ fidelityOk=false with a CRITICAL finding naming the cite. (Deep quote-in-source verification is the source-verify skill's job, run by the wrapping skill after this gate; here, confirm existence/resolvability and catch fabrication.)
3. transitionOk — ${prev ? `does the FIRST sentence connect to what "${prev.name}" (${prev.outlineFile}) establishes?` : 'is the opening clean (no "as discussed above" with nothing prior)?'} ${next ? `does the LAST sentence set up "${next.name}" (${next.outlineFile})?` : 'is the close clean (no dangling hand-off)?'} A seam (abrupt jump, repeated setup, dangling reference) ⇒ transitionOk=false (major).
4. SCAFFOLDING HEADINGS — the outline's \`## Opening\`, \`## Body\`, \`## Closing\` are scaffolding, NOT document headings. If the prose contains a literal heading named "Opening", "Body", or "Closing" (or a synonym like "Conclusion to Part ${'X'}"), report it as a MAJOR finding ("scaffolding label emitted as a heading"): the section must end in an UNHEADED bridging paragraph, not a "Closing"/"Conclusion" heading.${continuous ? ` ALSO — this is an INTRODUCTION/CONCLUSION, which is CONTINUOUS UNHEADED prose: if the draft contains ANY lettered subsection heading (\`## A.\`, \`## B.\`, … — even though the outline groups its Body as A/B/C), report it as a MAJOR finding ("lettered subsections in an Introduction/Conclusion"). Only the section title (\`#\`) is a valid heading here.` : ` Only the section title (\`#\`) and the lettered \`## A./B./C.\` subsections are valid headings in a Part.`}
Also return boundary.firstSentence and boundary.lastSentence verbatim (for the skill's seam audit).
Return VERIFY_SCHEMA.`
  tasks.push(() => (async () => {
    const t = await agent(draftPrompt, { label: String(s.name), phase: 'Transform', schema: TRANSFORM_SCHEMA })
    if (!t) return null
    // The draft the agent just wrote is an OUTPUT: it did not exist when the bundle was
    // built, and this script cannot open or hash it. t.content is the agent's account of
    // what it wrote, not evidence about the file — so it is carried out to the post-step,
    // which re-snapshots ${s.draftFile} and confirms the bytes on disk equal it.
    const v = await agent(buildVerifyPrompt(t), { label: `verify:${s.name}`, phase: 'Verify', schema: VERIFY_SCHEMA, model: 'sonnet' })
    return { expectedSection: String(s.name), transform: t, verify: v, draftSnapshot: null }
  })())
}
// SEQUENTIAL, NOT parallel(). The observation hooks bracket each dispatch with a git observation of
// the WHOLE working tree, so a sibling section's draft written inside this section's pre/post window
// lands in this section's delta — reported as "output outside writable authority" against an agent
// that did nothing wrong. `scripts/beat/preflight.ts` returns executionMode: 'sequential' for exactly
// this reason and nothing here was reading it.
const liveResults = []
for (const task of tasks) { const result = await task(); if (result) liveResults.push(result) }
if (ONLY) log(`Selective re-draft: ${drafted} section(s) live, ${carriedCount} carried`)
// draftSnapshots holds ONLY authenticated entry snapshots — i.e. carried sections. A live
// section's draft has no authenticated bytes in this process, and pretending otherwise by
// storing the agent's echo under a snapshot-shaped key is exactly the confusion to avoid.
const pendingDraftVerification = liveResults.map(result => result.expectedSection)
// A verifier result is evidence only for the section captured when its dispatch was created.
// Never let a swapped self-reported echo rebind it to a different section.
const verifyByName = Object.fromEntries(liveResults
  .filter(r => r.verify && String(r.verify.section) === r.expectedSection)
  .map(r => [r.expectedSection, r.verify]))

// ── Phase 4: Gate (pure JS — substrate split: drafted + coverage + fidelity + transitions) ─
phase('Gate')
// Two things this gate can no longer do in-process, and how each is handled:
//   1. DRIFT of authenticated inputs (plan, receipt, bib, outlines, carried drafts). Same
//      guarantee, run on the other side of the workflow: the entry hashes are returned and
//      the deterministic post-step (`--verify --findings`) re-snapshots each one, zeroes the
//      hash of anything that moved, and appends the critical artifact-integrity findings
//      this block used to append.
//   2. OUTPUT verification of the drafts this run wrote. There is no entry snapshot to
//      compare against — the file did not exist yet — so the post-step must read each live
//      section's draftFile and confirm it equals reportedContent below. Until it does, a
//      live section's `drafted` is the agent's own account of its work. verifyRequired
//      announces that the returned verdict is provisional for exactly that reason.
const transformByName = Object.fromEntries([
  ...liveResults.map(result => [result.expectedSection, result.transform]),
  ...carried.map(result => [String(result.section), result]),
])
const SEV_RANK = { critical: 0, major: 1, minor: 2 }
const rows = []
const findings = []

// Structureless outlines are blocking: no paragraph-level spec to expand, so we did NOT draft — bounce to writing-outline.
for (const s of underGranular) {
  rows.push({ section: s.name, drafted: false, coverage: false, fidelity: false, transition: false, pass: false, reason: 'outline lacks paragraph-level structure' })
  findings.push({ severity: 'critical', planHash: PLAN_HASH, section: s.name, area: 'outline-granularity', detail: `${s.name}: outline lacks paragraph-level structure — ${s.granularityNote || 'bare headings / placeholder, no paragraph-level points'}. Add paragraph-level structure in writing-outline before drafting.`, location: s.outlineFile, retryKey: `section:${s.name}:outline-granularity` })
}

for (const s of draftable) {
  const name = String(s.name)
  const t = transformByName[name]
  const v = verifyByName[name] || (!liveDispatchNames.has(name) && PRIOR.has(name) ? PRIOR.get(name).verify : null)
  // A carried section's draft bytes ARE authenticated (entry snapshot); a live section's are
  // not — its only account is the agent's own `content`, which the post-step must confirm
  // against the file. Everything below that is a comparison of DATA (echoed section name,
  // status, exact PLAN-owned path, frontmatter identity, claim mapping) still runs here on
  // whichever text this run legitimately has.
  const draftSnapshot = draftSnapshots[name]
  const contentAuthenticated = !!draftSnapshot
  const draftText = contentAuthenticated ? draftSnapshot.text : (typeof t?.content === 'string' ? t.content : '')
  const canonicalIdentity = artifactIdentity(draftText)
  const mappedClaims = s.precisClaim ? s.precisClaim.split(/\s*,\s*/).filter(claim => /^CLAIM-[0-9]{2}$/.test(claim)) : []
  // A carried result's stored content must still equal the bytes the pre-step opened; a live
  // result has nothing to compare `content` to until the post-step reads the file.
  const contentMatchesDisk = contentAuthenticated ? t?.content === draftSnapshot.text : null
  const isDrafted = !!t && String(t.section) === name && t.status === 'drafted' && resolvePath(t.draftFile) === resolvePath(s.draftFile) && contentMatchesDisk !== false && canonicalIdentity.valid && canonicalIdentity.planHash === PLAN_HASH && JSON.stringify(canonicalIdentity.implements) === JSON.stringify(mappedClaims)
  const coverage = !!v && v.coverageOk === true
  const fidelity = !!v && v.fidelityOk === true
  const transition = !!v && v.transitionOk !== false   // no verify (e.g. not drafted) ⇒ false, matching coverage/fidelity
  const vFindings = v?.findings || []
  const blocking = vFindings.filter(f => f.severity === 'critical' || f.severity === 'major')
  // Substrate: drafted AND coverage AND fidelity AND transitions hold AND no blocking finding.
  // Minor prose nits are advisory here — writing-review owns document-quality polish.
  const pass = isDrafted && coverage && fidelity && transition && blocking.length === 0
  // draftFile + reportedContent are the post-step's inputs for output verification: it
  // re-snapshots draftFile and fails the section if the bytes differ from reportedContent.
  rows.push({ section: name, drafted: isDrafted, coverage, fidelity, transition, pass, draftFile: s.draftFile, contentAuthenticated, reportedContent: typeof t?.content === 'string' ? t.content : '' })
  if (!isDrafted) findings.push({ severity: 'critical', planHash: PLAN_HASH, section: name, area: 'draft-integrity', detail: `${name}: not drafted or exact path/content/frontmatter identity changed (status=${t ? t.status : 'missing'}).`, location: s.draftFile, retryKey: `section:${name}:draft-integrity` })
  if (!v) {
    findings.push({ severity: 'critical', planHash: PLAN_HASH, section: name, area: 'reviewer-integrity', detail: `${name}: independent draft verification was missing or returned the wrong section identity.`, location: s.draftFile, retryKey: `section:${name}:reviewer-missing` })
  } else {
    if (!coverage) findings.push({ severity: 'major', planHash: PLAN_HASH, section: name, area: 'coverage', detail: `${name}: verifier did not confirm outline coverage.`, location: s.draftFile, retryKey: `section:${name}:coverage` })
    if (!fidelity) findings.push({ severity: 'critical', planHash: PLAN_HASH, section: name, area: 'fidelity', detail: `${name}: verifier did not confirm citation fidelity.`, location: s.draftFile, retryKey: `section:${name}:fidelity` })
    if (!transition) findings.push({ severity: 'major', planHash: PLAN_HASH, section: name, area: 'transition', detail: `${name}: verifier did not confirm the planned section transition.`, location: s.draftFile, retryKey: `section:${name}:transition` })
  }
  for (const [index, f] of vFindings.entries()) findings.push({ severity: f.severity, planHash: PLAN_HASH, section: name, area: 'verification', detail: `${name}: ${f.detail}`, location: f.location || s.draftFile, retryKey: `section:${name}:verification:${index}` })
}
findings.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])

const severityCounts = {
  critical: findings.filter(f => f.severity === 'critical').length,
  major: findings.filter(f => f.severity === 'major').length,
  minor: findings.filter(f => f.severity === 'minor').length,
}
const blockingCount = severityCounts.critical + severityCounts.major
const minorCount = severityCounts.minor
// Provisional: input drift and live-draft output verification are both post-step verdicts,
// and both can only ever subtract from this. The post-step recomputes it.
const substratePass = rows.length > 0 && rows.every(r => r.pass)
const overallPass = substratePass
const verdict = !substratePass ? 'GAPS FOUND' : (minorCount ? 'DRAFTED (advisory minor notes)' : 'DRAFTED')

const scoreTable = [
  '| Section | Drafted | Coverage | Fidelity | Transition | Gate |',
  '|---------|---------|----------|----------|------------|------|',
  ...rows.map(r => `| ${r.section} | ${r.drafted ? '✅' : '❌'} | ${r.coverage ? '✅' : '❌'} | ${r.fidelity ? '✅' : '❌'} | ${r.transition ? '✅' : '❌'} | ${r.pass ? '✅' : '❌'} |`),
  `| **Overall** | ${rows.filter(r => r.drafted).length}/${rows.length} | blocking ${blockingCount} / advisory ${minorCount} | | | ${overallPass ? '✅ DRAFTED' : '❌ GAPS'} |`,
].join('\n')

log(overallPass
  ? (minorCount ? `✅ writing-draft: all ${rows.length} section(s) drafted; substrate clean; ${minorCount} advisory minor note(s)` : `✅ writing-draft: all ${rows.length} section(s) drafted and verified`)
  : `❌ writing-draft: ${rows.filter(r => !r.pass).length}/${rows.length} section(s) failed — ${blockingCount} blocking finding(s)${underGranular.length ? ` (incl. ${underGranular.length} under-granular outline)` : ''}`)

return {
  planPath: PLAN_PATH,
  planHash: PLAN_HASH,
  // Entry hashes for the authenticated INPUTS. The post-step overwrites finalPlanHash and
  // each review's outlineHash/draftHash with '' for anything that drifted, fills in the
  // draftHash of every live section from the file it actually reads, and flips the gate.
  // Until it has run this verdict is provisional — that is what verifyRequired announces.
  finalPlanHash: PLAN_SNAPSHOT.hash,
  verifyRequired: true,
  driftVerified: false,
  // Live sections wrote OUTPUTS this script cannot hash: the post-step must read each
  // section's draftFile and confirm it equals that row's reportedContent.
  pendingDraftVerification,
  overallPass,
  substratePass,
  verdict,
  summary: { sectionsTotal: rows.length, drafted: rows.filter(r => r.drafted).length, passed: rows.filter(r => r.pass).length, ...severityCounts, total: severityCounts.critical + severityCounts.major + severityCounts.minor, blocking: blockingCount, advisoryMinors: minorCount, underGranular: underGranular.length },
  scoreTable,
  sections: rows,                     // per-section status the skill renders
  findings,                           // severity-ordered; blocking = critical+major
  underGranular: underGranular.map(s => ({ section: s.name, note: s.granularityNote })), // bounce-to-outline list
  // Raw per-section records for selective retries. Live evidence is keyed by
  // the section captured at dispatch; a transform's self-reported section is
  // never permitted to rename a record or select snapshots/verification.
  reviews: [
    ...liveResults.map(result => {
      const section = result.expectedSection
      const transformBound = String(result.transform?.section) === section
      return {
        ...result.transform,
        section,
        status: transformBound ? result.transform?.status : 'error',
        planHash: PLAN_HASH,
        outlineHash: outlineSnapshots[section].hash,
        // No entry snapshot exists for a draft this run wrote — the post-step fills this in
        // from the file. An empty draftHash here means "not yet verified", never "verified".
        draftHash: '',
        verify: transformBound ? (verifyByName[section] || null) : null,
      }
    }),
    ...carried.map(record => {
      const section = String(record.section)
      const snapshot = draftSnapshots[section]
      return {
        ...record,
        section,
        planHash: PLAN_HASH,
        outlineHash: outlineSnapshots[section].hash,
        // Carried sections DO have an authenticated entry snapshot; the post-step zeroes it
        // if the file moved while the live sections were being drafted.
        draftHash: snapshot ? snapshot.hash : '',
        verify: record.verify || null,
      }
    }),
  ],
  sectionsThatFailed: rows.filter(r => !r.pass).map(r => r.section), // pass as onlyChecks on a re-run
}
