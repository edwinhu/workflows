export const meta = {
  name: 'writing-review',
  description: 'Independent review of authenticated PLAN-bound drafts: per-section structure, prose, source fidelity, quote verification, transitions, and whole-document checks.',
  whenToUse: 'Called after mechanical checks with planPath, planHash, and a deterministic sectionIndex. Findings return to TaskList and selective re-review requires the same plan hash.',
  phases: [
    { title: 'Discover', detail: 'load authenticated PLAN section, source, and output context' },
    { title: 'L1-Review', detail: 'per-section: structure + prose + fidelity reviewers, in parallel' },
    { title: 'Verify', detail: 'mechanically confirm quoted evidence resolves to the draft' },
    { title: 'L2-L3', detail: 'transition analysis + whole-document checks over L1 data' },
  ],
}

// ── Inputs ──────────────────────────────────────────────────────────────────
// args = {
//   projectDir: "/abs/writing-project-dir",   // REQUIRED — holds .planning/, outlines/, drafts/, references/sources.bib
//   projectReal: "/abs/resolved-project-dir", // REQUIRED — bundle.projectReal from the authenticate pre-step
//   artifacts: { receipt|plan|bib|"section:<name>:outline"|"section:<name>:draft": {path, real, hash, text} },
//                                              // REQUIRED — bundle.artifacts from `writing_section_index.py --authenticate`
//   pluginRoot: "/abs/.../workflows",          // optional — for resolving domain skill + bridge_repetition_check.py
//   onlyChecks?: ["Section Name", ...],         // re-review loop: re-review only these sections; carry the rest
//   priorReviews?: [<section objects>],         // re-review loop: prior per-section results to carry forward
// }
let cfg = args
if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch { cfg = {} } }
cfg = cfg || {}
const PROJECT = cfg.projectDir
if (!PROJECT) throw new Error(`writing-review requires args.projectDir. Got "${typeof args}": ${JSON.stringify(args)?.slice(0, 200)}`)
const ONLY = Array.isArray(cfg.onlyChecks) && cfg.onlyChecks.length ? new Set(cfg.onlyChecks.map(String)) : null
const PRIOR = new Map((Array.isArray(cfg.priorReviews) ? cfg.priorReviews : []).map(s => [s.section, s]))
const PLUGIN = cfg.pluginRoot || ''
// Canonical review requires the authenticated PLAN-bound index. Missing, malformed,
// stale, or alternate discovery inputs fail closed.
const PLAN_PATH = typeof cfg.planPath === 'string' ? cfg.planPath : ''
const PLAN_HASH = typeof cfg.planHash === 'string' ? cfg.planHash : ''
const SECTION_INDEX = (cfg.sectionIndex && Array.isArray(cfg.sectionIndex.sections) && cfg.sectionIndex.sections.length) ? cfg.sectionIndex : null
if (!PLAN_PATH || !PLAN_HASH || !SECTION_INDEX) {
  throw new Error('writing-review requires args.planPath, args.planHash, and a non-empty deterministic args.sectionIndex; canonical review never falls back to an LLM or retired planning files.')
}
if (SECTION_INDEX.ok !== true || SECTION_INDEX.planPath !== PLAN_PATH || SECTION_INDEX.planHash !== PLAN_HASH) {
  throw new Error('writing-review rejected a malformed or stale section index: ok, planPath, and planHash must match the authenticated PLAN input.')
}
if (cfg.style && cfg.style !== SECTION_INDEX.style) throw new Error('writing-review style override conflicts with authenticated PLAN Writing Intent.')
for (const prior of (Array.isArray(cfg.priorReviews) ? cfg.priorReviews : [])) {
  if (prior.planHash !== PLAN_HASH) throw new Error('writing-review rejected priorReviews from a different plan hash.')
}
for (const key of ['precisPath', 'outlinePath', 'activeWorkflowPath', 'legacyPlanPath']) {
  if (cfg[key]) throw new Error(`writing-review rejected mixed active authority: args.${key} is retired.`)
}
if (SECTION_INDEX.precisPath || (SECTION_INDEX.outlinePath && SECTION_INDEX.outlinePath !== PLAN_PATH)) {
  throw new Error('writing-review rejected an index carrying retired active planning authority.')
}

// ── Authenticated artifact bundle (no filesystem access in here) ─────────────
// Workflow scripts are pure control flow: the runtime rejects import(), import.meta,
// process, and Buffer. The TOCTOU-hardened snapshot/hash/read that used to run here
// now runs in scripts/writing/writing_section_index.py --authenticate, the same
// deterministic pre-step that compiles this index, and arrives via args.artifacts.
// It is NOT delegated to an agent: the section index already comes from an agent, and
// asking the untrusted party to vouch for its own artifacts is not authentication.
// Drift detection is symmetrically deterministic — the post-step re-snapshots via
// --verify --findings, which is why this run returns verifyRequired: true.
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
  throw new Error('writing-review requires args.projectReal: the absolute resolved projectDir emitted by writing_section_index.py --authenticate.')
}
const ARTIFACTS = (cfg.artifacts && typeof cfg.artifacts === 'object' && !Array.isArray(cfg.artifacts)) ? cfg.artifacts : null
if (!ARTIFACTS) throw new Error('writing-review requires args.artifacts: the authenticated bundle from writing_section_index.py --authenticate.')
const HEX64 = /^[0-9a-f]{64}$/
const artifact = key => {
  const snapshot = ARTIFACTS[key]
  if (!snapshot || typeof snapshot !== 'object') throw new Error(`writing-review is missing an authenticated artifact: ${key}`)
  const { path, real, hash, text } = snapshot
  if (!isAbs(path) || !isAbs(real) || typeof text !== 'string' || !HEX64.test(String(hash))) {
    throw new Error(`writing-review rejected a malformed authenticated artifact: ${key}`)
  }
  if (!containedBy(PROJECT_REAL, normalizePath(real))) throw new Error(`writing-review artifact escapes projectDir: ${key} (${real})`)
  return { path, real: normalizePath(real), hash, text }
}
const SECTION_KEY = (name, kind) => `section:${name}:${kind}`
const PLAN_FILE = typeof SECTION_INDEX.planFile === 'string' ? SECTION_INDEX.planFile : ''
if (!/^\.planning\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(PLAN_FILE) || PLAN_FILE === '.planning/PLAN.md' || SECTION_INDEX.reviewStatus !== 'APPROVED') {
  throw new Error('writing-review requires an APPROVED receipt-selected generated planFile; fixed PLAN.md and non-approved review state cannot authorize review.')
}
const EXPECTED_PLAN = resolvePath(PROJECT_REAL, PLAN_FILE)
const PLAN_SNAPSHOT = artifact('plan')
const PLAN_REAL = PLAN_SNAPSHOT.real
if (resolvePath(PLAN_PATH) !== resolvePath(PLAN_SNAPSHOT.path) || PLAN_REAL !== EXPECTED_PLAN || !containedBy(joinPath(PROJECT_REAL, '.planning'), PLAN_REAL)) {
  throw new Error('writing-review planPath must equal the receipt-selected generated planFile and may not escape through a symlink.')
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
if (resolvePath(RECEIPT_SNAPSHOT.path) !== RECEIPT_PATH) throw new Error('writing-review authenticated receipt is not the projectDir combined review state.')
const receiptKeys = ['workflow', 'plan_file', 'plan_hash', 'approved_session_id', 'approved_at', 'status', 'reviewer_session_id', 'reviewed_at']
const strictUtc = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const receiptApproved = value => Object.keys(value).length === receiptKeys.length && receiptKeys.every(key => Object.hasOwn(value, key)) && value.workflow === 'writing' && `.planning/${value.plan_file}` === PLAN_FILE && value.plan_hash === PLAN_HASH && value.status === 'APPROVED' && typeof value.approved_session_id === 'string' && !!value.approved_session_id.trim() && typeof value.reviewer_session_id === 'string' && !!value.reviewer_session_id.trim() && value.approved_session_id !== value.reviewer_session_id && strictUtc(value.approved_at) && strictUtc(value.reviewed_at) && Date.parse(value.reviewed_at) > Date.parse(value.approved_at)
let receipt
try { receipt = parseFlatStringJson(RECEIPT_SNAPSHOT.text) } catch { throw new Error('writing-review rejected malformed or duplicate combined review state.') }
if (!receiptApproved(receipt)) {
  throw new Error('writing-review combined review state does not authenticate the supplied generated plan identity.')
}
const PLAN_TEXT = PLAN_SNAPSHOT.text
const ACTUAL_PLAN_HASH = PLAN_SNAPSHOT.hash
if (ACTUAL_PLAN_HASH !== PLAN_HASH) throw new Error('writing-review generated plan bytes no longer match args.planHash.')
const REQUIRED_H2 = ['Writing Intent', 'Claims', 'Counterarguments', 'Document Structure', 'Claim → Section Map', 'Source Plan', 'Section Outputs', 'Review Surfaces']
const OBSERVED_H2 = [...PLAN_TEXT.matchAll(/^##\s+(.+?)\s*$/gm)].map(m => m[1])
if (JSON.stringify(OBSERVED_H2) !== JSON.stringify(REQUIRED_H2)) throw new Error('writing-review PLAN grammar changed after compilation.')
const structureBlock = PLAN_TEXT.match(/^## Document Structure\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m)?.[1] || ''
const plannedNames = [...structureBlock.matchAll(/^###\s+(.+?)\s*$/gm)].map(m => m[1])
const indexedNames = SECTION_INDEX.sections.map(s => String(s.name))
if (JSON.stringify(plannedNames) !== JSON.stringify(indexedNames)) throw new Error('writing-review section index is truncated, reordered, or not compiled from PLAN Document Structure.')
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
if (SECTION_INDEX.style !== plannedStyle) throw new Error('writing-review section index style does not match PLAN Writing Intent.')
const sourceBlock = PLAN_TEXT.match(/^## Source Plan\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m)?.[1] || ''
const plannedSourcePlan = {}
for (const match of sourceBlock.matchAll(/^\s*(?:[-*]\s*)?(?:\*\*)?([A-Za-z][A-Za-z /_-]*?)(?:\*\*)?\s*:\s*(.+?)\s*$/gm)) {
  plannedSourcePlan[match[1].trim().replace(/\s+/g, ' ').toLowerCase()] = match[2].trim()
}
const plannedBib = plannedSourcePlan.bibliography || ''
const normalizedSourceEntries = value => JSON.stringify(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)))
const EXPECTED_BIB = resolvePath(PROJECT_REAL, plannedBib)
if (resolvePath(SECTION_INDEX.bibPath || '') !== EXPECTED_BIB || normalizedSourceEntries(SECTION_INDEX.sourcePlan) !== normalizedSourceEntries(plannedSourcePlan)) {
  throw new Error('writing-review section index Source Plan context does not match the generated plan.')
}
const BIB_SNAPSHOT = artifact('bib')
if (resolvePath(BIB_SNAPSHOT.path) !== EXPECTED_BIB) throw new Error('writing-review authenticated bibliography is not the PLAN Source Plan bibliography.')
const reviewBlock = PLAN_TEXT.match(/^## Review Surfaces\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m)?.[1] || ''
const plannedSurfaces = [...reviewBlock.matchAll(/^\s*[-*]\s+(\S.*?)\s*$/gm)].map(match => match[1])
if (JSON.stringify(SECTION_INDEX.reviewSurfaces || []) !== JSON.stringify(plannedSurfaces)) throw new Error('writing-review section index Review Surfaces do not match the generated plan.')
const mapBlock = PLAN_TEXT.match(/^## Claim → Section Map\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m)?.[1] || ''
const mapLines = mapBlock.split('\n').map(line => line.trim()).filter(line => line.startsWith('|'))
const mapHeaders = mapLines.length ? cells(mapLines[0]).map(h => h.toLowerCase()) : []
const mapRows = mapLines.slice(2).map(line => Object.fromEntries(mapHeaders.map((h, i) => [h, cells(line)[i] || ''])))
const expectedClaims = Object.fromEntries(indexedNames.map(name => [name, []]))
const artifactSnapshots = {}
for (const row of mapRows) if (expectedClaims[row.section]) expectedClaims[row.section].push(row.claim)
if (outputRows.length !== SECTION_INDEX.sections.length) throw new Error('writing-review section index does not contain every PLAN Section Outputs row.')
for (let i = 0; i < SECTION_INDEX.sections.length; i++) {
  const section = SECTION_INDEX.sections[i]
  const row = outputRows[i]
  if (!row || row.section !== section.name) throw new Error('writing-review section index order does not match PLAN Section Outputs.')
  const expectedOutline = resolvePath(PROJECT_REAL, row.outline)
  const expectedDraft = resolvePath(PROJECT_REAL, row.draft)
  for (const path of [expectedOutline, expectedDraft, resolvePath(section.outlineFile), resolvePath(section.draftFile)]) {
    if (!containedBy(PROJECT_REAL, path)) throw new Error('writing-review rejected an artifact path outside projectDir.')
  }
  if (resolvePath(section.outlineFile) !== expectedOutline || resolvePath(section.draftFile) !== expectedDraft) {
    throw new Error('writing-review section index artifact paths do not match PLAN Section Outputs.')
  }
  const expectedDependencies = !row['depends on'] || ['-', 'none', 'n/a'].includes(row['depends on'].toLowerCase()) ? [] : row['depends on'].split(/\s*(?:,|;)\s*/).filter(Boolean)
  if (JSON.stringify(section.dependencies || []) !== JSON.stringify(expectedDependencies)) throw new Error('writing-review section index dependencies do not match PLAN Section Outputs.')
  const claimsForSection = expectedClaims[section.name] || []
  if (JSON.stringify(section.primaryClaims || []) !== JSON.stringify(claimsForSection)) throw new Error('writing-review section index claims do not match PLAN Claim → Section Map.')
  if (section.outlineCurrent !== true || section.draftCurrent !== true) {
    throw new Error(`writing-review requires current PLAN-bound outline and draft artifacts for ${section.name}.`)
  }
  const outlineSnapshot = artifact(SECTION_KEY(section.name, 'outline'))
  const draftSnapshot = artifact(SECTION_KEY(section.name, 'draft'))
  if (resolvePath(outlineSnapshot.path) !== expectedOutline || resolvePath(draftSnapshot.path) !== expectedDraft) {
    throw new Error(`writing-review authenticated artifacts for ${section.name} are not the PLAN Section Outputs paths.`)
  }
  artifactSnapshots[section.name] = { outline: outlineSnapshot, draft: draftSnapshot }
  const outlineText = outlineSnapshot.text
  const draftText = draftSnapshot.text
  const artifactCurrent = text => {
    const identity = artifactIdentity(text)
    return identity.valid && identity.planHash === PLAN_HASH && JSON.stringify(identity.implements) === JSON.stringify(claimsForSection)
  }
  if (!artifactCurrent(outlineText) || !artifactCurrent(draftText)) throw new Error(`writing-review artifacts for ${section.name} are stale or do not implement mapped PLAN claims.`)
}
const onlyInput = Array.isArray(cfg.onlyChecks) ? cfg.onlyChecks.map(String) : []
if (new Set(onlyInput).size !== onlyInput.length || onlyInput.some(name => !indexedNames.includes(name))) {
  throw new Error('writing-review onlyChecks must contain unique current PLAN section names.')
}
const priorInput = Array.isArray(cfg.priorReviews) ? cfg.priorReviews : []
if (new Set(priorInput.map(prior => String(prior.section))).size !== priorInput.length) {
  throw new Error('writing-review priorReviews contains duplicate section records.')
}

// ── Schemas ───────────────────────────────────────────────────────────────────
const ISSUE = {
  type: 'object', additionalProperties: false, required: ['severity', 'location', 'quote', 'detail'],
  properties: {
    severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
    location: { type: 'string', description: 'file:line' },
    quote: { type: 'string', description: 'verbatim text from the draft backing this issue' },
    detail: { type: 'string' },
    fix: { type: 'string' },
  },
}

// Structure reviewer — the rich one (carries boundary summary + concepts + argument summary for L2/L3).
const STRUCTURE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['section', 'check', 'itemsChecked', 'issues', 'planClaimAdvanced', 'boundary', 'argumentSummary'],
  properties: {
    section: { type: 'string' }, check: { type: 'string', enum: ['structure'] },
    itemsChecked: { type: 'integer' },
    issues: { type: 'array', items: ISSUE },
    planClaimAdvanced: { type: 'boolean' },
    boundary: {
      type: 'object', additionalProperties: false,
      required: ['firstSentence', 'lastSentence', 'assumesFromPrev', 'handsOffToNext', 'argumentState', 'conceptsIntroduced', 'conceptsUsed', 'coreTerms'],
      properties: {
        firstSentence: { type: 'string' }, lastSentence: { type: 'string' },
        assumesFromPrev: { type: 'string' }, handsOffToNext: { type: 'string' }, argumentState: { type: 'string' },
        conceptsIntroduced: { type: 'array', items: { type: 'string' } },
        conceptsUsed: { type: 'array', items: { type: 'string' } },
        coreTerms: { type: 'array', items: { type: 'string' } },
      },
    },
    argumentSummary: { type: 'array', items: { type: 'string' }, description: 'main points this section makes (for L3 repetition/thesis)' },
  },
}

// Prose + fidelity reviewers — lean issue lists.
const FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['section', 'check', 'itemsChecked', 'issues'],
  properties: {
    section: { type: 'string' }, check: { type: 'string', enum: ['prose', 'fidelity'] },
    itemsChecked: { type: 'integer' }, issues: { type: 'array', items: ISSUE },
  },
}

const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['section', 'quotesChecked', 'fabricated'],
  properties: {
    section: { type: 'string' }, quotesChecked: { type: 'integer' },
    fabricated: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['quote', 'location'],
      properties: { quote: { type: 'string' }, location: { type: 'string' } } }, description: 'quotes that do NOT resolve to the cited draft location' },
  },
}

const TRANSITION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['transitions'],
  properties: { transitions: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['from', 'to', 'verdict', 'closes', 'opens', 'problem', 'suggestion'],
    properties: { from: { type: 'string' }, to: { type: 'string' }, verdict: { type: 'string', enum: ['SMOOTH', 'ABRUPT', 'DISCONNECTED'] },
      closes: { type: 'string' }, opens: { type: 'string' }, problem: { type: 'string' }, planned: { type: 'string' }, suggestion: { type: 'string' } } } } },
}

const DOCUMENT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['conceptOrderIssues', 'repetition', 'thesisIssues', 'completeness', 'reviewSurfaces'],
  properties: {
    conceptOrderIssues: { type: 'array', items: { type: 'string' } },
    repetition: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['quote', 'locations', 'verdict'],
      properties: { quote: { type: 'string' }, locations: { type: 'array', items: { type: 'string' } }, verdict: { type: 'string', enum: ['REDUNDANT', 'INTENTIONAL_CALLBACK'] } } } },
    thesisIssues: { type: 'array', items: { type: 'string' } },
    completeness: { type: 'object', additionalProperties: false,
      required: ['claimsAddressed', 'counterargsConfronted', 'scopeHonored', 'hookDelivered', 'conclusionFollows', 'issues'],
      properties: { claimsAddressed: { type: 'string' }, counterargsConfronted: { type: 'string' },
        scopeHonored: { type: 'boolean' }, hookDelivered: { type: 'boolean' }, conclusionFollows: { type: 'boolean' },
        issues: { type: 'array', items: { type: 'string' } } } },
    reviewSurfaces: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['surface', 'status', 'evidence'], properties: {
        surface: { type: 'string' }, status: { type: 'string', enum: ['INSPECTED', 'MISSING'] }, evidence: { type: 'string' }
      } } },
  },
}

// ── Phase 1: Discover ─────────────────────────────────────────────────────────
// Map the authenticated PLAN index into the read-only review shape.
function discFromIndex(idx) {
  const style = idx.style && idx.style !== 'unspecified' ? idx.style : 'general'
  return {
    style,
    planPath: idx.planPath,
    sourcePlan: idx.sourcePlan || {},
    reviewSurfaces: idx.reviewSurfaces || [],
    sourcesBib: idx.bibPath || '',
    domainSkillPath: PLUGIN ? `${PLUGIN}/../skills/writing-${style}/SKILL.md` : '',
    repetitionScript: PLUGIN ? `${PLUGIN}/../skills/writing-review/scripts/bridge_repetition_check.py` : '',
    sections: idx.sections.map(s => ({
      name: String(s.name),
      outlineFile: s.outlineFile || '',
      draftFile: s.draftFile || '',
      planClaims: (s.primaryClaims && s.primaryClaims.length ? s.primaryClaims : (s.implements || [])).join(', '),
    })),
  }
}

phase('Discover')
const disc = discFromIndex(SECTION_INDEX)
const REVIEW_IDENTITY = `IMMUTABLE RECEIPT-SELECTED PLAN IDENTITY\nPLAN_FILE: ${PLAN_FILE}\nPLAN_PATH: ${PLAN_PATH}\nPLAN_HASH: ${PLAN_HASH}`
if (!disc.sections.length) throw new Error('No sections in the authenticated PLAN index.')
let sections = disc.sections
log(`Discover: authenticated PLAN index (${sections.length} sections, ${disc.style}, ${PLAN_HASH})`)
log(`Document: ${sections.length} sections (${disc.style}); ${ONLY ? `re-review ${ONLY.size}` : 'full review'}`)

// ── Phase 2: L1 Section Review (per-section × 3 reviewers, parallel) ───────────
phase('L1-Review')
const reviewOne = (s) => {
  const snapshots = artifactSnapshots[s.name]
  const outlineHash = snapshots.outline.hash
  const draftHash = snapshots.draft.hash
  const common = `Section: "${s.name}"\nOutline source: ${s.outlineFile}\nImmutable outline snapshot:\n${snapshots.outline.text}\nDraft source: ${s.draftFile}\nImmutable draft snapshot:\n${snapshots.draft.text}\nPLAN claim(s): ${s.planClaims || '(none; claimless section)'}`
  return parallel([
    // (a) Structure reviewer — runs the section checklist; carries boundary + argument summaries.
    () => agent(
      `${REVIEW_IDENTITY}
You are a READ-ONLY structure reviewer. Do NOT create, edit, or overwrite any files.
Set section="${s.name}", check="structure" verbatim in your record.
${common}
Use the immutable draft and outline snapshots above; do not reread mutable artifact paths. Run the section review checklist: outline compliance, a topic-sentence inventory (every paragraph), subsection boundaries, domain style (read ${disc.domainSkillPath}), prose-constraint and AI-anti-pattern checks. Every issue needs a verbatim quote + file:line location. Also produce the boundary summary (first/last sentence verbatim, what it assumes from prev / hands to next, argument state, concepts introduced/used, core terms) and argumentSummary (main points, for whole-doc repetition/thesis checks). itemsChecked = paragraphs reviewed. Return STRUCTURE_SCHEMA.`,
      { label: `${s.name}:structure`, phase: 'L1-Review', schema: STRUCTURE_SCHEMA, model: 'sonnet' }),
    // (b) Prose-quality reviewer — the real agent.
    () => agent(
      `${REVIEW_IDENTITY}\nSet section="${s.name}", check="prose". Grade the immutable draft snapshot below (source location ${s.draftFile}; domain: ${disc.style}). Do not reread the mutable draft path. Read the domain skill, ai-anti-patterns, and prose constraints first. Grade every paragraph; report violations with file:line + verbatim quote. Map grades to severity: F→critical, C→major, lesser→minor. itemsChecked = paragraphs graded.\n${snapshots.draft.text}\nReturn FINDINGS_SCHEMA.`,
      { label: `${s.name}:prose`, phase: 'L1-Review', schema: FINDINGS_SCHEMA, model: 'sonnet', agentType: 'workflows:writing-prose-reviewer' }),
    // (c) Source-fidelity reviewer — the real agent.
    () => agent(
      `${REVIEW_IDENTITY}\nSet section="${s.name}", check="fidelity". Verify citation fidelity for this immutable draft snapshot (source location ${s.draftFile}); do not reread mutable artifact paths. Use this immutable authenticated bibliography snapshot (${disc.sourcesBib}) for resolution:\n${BIB_SNAPSHOT.text}\nPLAN Source Plan context: ${JSON.stringify(disc.sourcePlan)}. Check every pandoc cite-key resolves to a bib entry; verify hand-written footnotes match. Severity: unanchored citation→critical, detail mismatch→major, claim-fidelity concern→minor. Each issue needs file:line + the citation text as quote. itemsChecked = citations checked.\n${snapshots.draft.text}\nReturn FINDINGS_SCHEMA.`,
      { label: `${s.name}:fidelity`, phase: 'L1-Review', schema: FINDINGS_SCHEMA, model: 'sonnet', agentType: 'workflows:writing-source-fidelity-reviewer' }),
  ]).then(([rawStructure, rawProse, rawFidelity]) => {
    // Evidence is authorized by its dispatch target and reviewer role, not a
    // self-reported section/check that could be swapped with a sibling result.
    const structure = rawStructure && String(rawStructure.section) === s.name && rawStructure.check === 'structure' ? rawStructure : null
    const prose = rawProse && String(rawProse.section) === s.name && rawProse.check === 'prose' ? rawProse : null
    const fidelity = rawFidelity && String(rawFidelity.section) === s.name && rawFidelity.check === 'fidelity' ? rawFidelity : null
    return {
      section: s.name,
      planHash: PLAN_HASH,
      outlineHash,
      draftHash,
      // Emitted so a later selective re-review can prove this result was computed against the SAME
      // bibliography. Without it the carry-forward check above could never pass, and — worse, before
      // that check existed — a fidelity result outlived the bibliography it was derived from.
      bibHash: BIB_SNAPSHOT.hash,
      planClaims: s.planClaims,
      issues: [
        ...(structure?.issues || []).map(i => ({ ...i, source: 'structure' })),
        ...(prose?.issues || []).map(i => ({ ...i, source: 'prose' })),
        ...(fidelity?.issues || []).map(i => ({ ...i, source: 'fidelity' })),
      ],
      boundary: structure?.boundary || null,
      argumentSummary: structure?.argumentSummary || [],
      planClaimAdvanced: structure?.planClaimAdvanced ?? null,
      itemsChecked: (structure?.itemsChecked || 0) + (prose?.itemsChecked || 0) + (fidelity?.itemsChecked || 0),
      unreliable: !(structure && prose && fidelity) || !((structure?.itemsChecked || 0) > 0),
    }
  })
}

const tasks = []
const carried = []
let reran = 0, carriedCount = 0
for (const s of sections) {
  if (ONLY && !ONLY.has(s.name)) {
    const prior = PRIOR.get(s.name)
    const currentOutlineHash = artifactSnapshots[s.name].outline.hash
    const currentDraftHash = artifactSnapshots[s.name].draft.hash
    // THE BIBLIOGRAPHY IS PART OF WHAT A FIDELITY RESULT DEPENDS ON, so it has to be part of what
    // authenticates carrying that result forward. Plan, outline and draft can all be untouched while
    // references/sources.bib changes underneath them — an entry corrected, a key renamed, a source
    // removed — and the carried `fidelity` issues were computed against the OLD bibliography. They
    // would be presented as a current, reliable review of citations that no longer resolve the same
    // way. Every other input to the result is hash-bound here; this one was not.
    if (!prior || prior.planHash !== PLAN_HASH || prior.outlineHash !== currentOutlineHash || prior.draftHash !== currentDraftHash || prior.bibHash !== BIB_SNAPSHOT.hash || prior.unreliable !== false || !Array.isArray(prior.issues) || !prior.boundary || !Array.isArray(prior.argumentSummary)) {
      throw new Error(`writing-review selective re-review requires one complete reliable current-content prior review for ${s.name}, produced against the CURRENT bibliography.`)
    }
    carried.push(prior)
    carriedCount++
    continue
  }
  reran++
  tasks.push(() => reviewOne(s))
}
const liveSections = (await parallel(tasks)).filter(Boolean)
if (ONLY) log(`Selective re-review: ${reran} section(s) live, ${carriedCount} carried`)

// ── Phase 3: Verify quotes resolve to the draft (mechanical — kills fabrication) ─
phase('Verify')
const draftByName = Object.fromEntries(sections.map(s => [s.name, s.draftFile]))
const verificationResults = (await parallel(liveSections.map(sec => () =>
  agent(
    `${REVIEW_IDENTITY}\nREAD-ONLY. Set section="${sec.section}". Verify quoted evidence only against this immutable draft snapshot (source location ${draftByName[sec.section]}). Do not reread the mutable draft path. List any quote that does NOT resolve (fabricated/misattributed) in \`fabricated\`.\nSNAPSHOT:\n${artifactSnapshots[sec.section].draft.text}\nIssues to check (quote @ location):\n${JSON.stringify((sec.issues || []).map(i => ({ quote: i.quote, location: i.location })), null, 2)}\nReturn VERIFY_SCHEMA.`,
    { label: `${sec.section}:verify`, phase: 'Verify', schema: VERIFY_SCHEMA, model: 'sonnet' }
  ).then(verify => ({ expectedSection: sec.section, verify }))
))).filter(result => result.verify && String(result.verify.section) === result.expectedSection)
// Bind verification evidence to the section captured at dispatch, never the
// verifier's returned identifier; swapped echoes are treated as missing evidence.
const fabByName = Object.fromEntries(verificationResults.map(result => [result.expectedSection, result.verify.fabricated || []]))
const verifiedNames = new Set(verificationResults.map(result => result.expectedSection))
// Drop fabricated-quote issues; flag missing or fabricated verification evidence.
for (const sec of liveSections) {
  if (!verifiedNames.has(sec.section)) sec.unreliable = true
  const fab = new Set((fabByName[sec.section] || []).map(f => `${f.quote}@@${f.location}`))
  if (fab.size) {
    const before = sec.issues.length
    sec.issues = sec.issues.filter(i => !fab.has(`${i.quote}@@${i.location}`))
    sec.quotesDropped = before - sec.issues.length
    sec.unreliable = true
  }
}

const allSections = [...liveSections, ...carried]
// Stable document order from discovery.
const order = Object.fromEntries(sections.map((s, i) => [s.name, i]))
allSections.sort((a, b) => (order[a.section] ?? 99) - (order[b.section] ?? 99))
if (JSON.stringify(allSections.map(section => section.section)) !== JSON.stringify(indexedNames)) {
  throw new Error('writing-review did not assemble exactly one review for every current PLAN section.')
}

// ── Phase 4: L2 transitions + L3 whole-document (single agents over L1 data) ───
phase('L2-L3')
const boundaries = allSections.map(s => ({ section: s.section, boundary: s.boundary }))
const argSummaries = allSections.map(s => ({ section: s.section, points: s.argumentSummary, claim: s.planClaims }))

const [l2, l3] = await parallel([
  () => agent(
    `${REVIEW_IDENTITY}\nREAD-ONLY transition reviewer (Level 2). Using these per-section boundary summaries (in document order), evaluate each adjacent boundary (Section N → N+1): does N+1's opening pick up N's close? verdict SMOOTH/ABRUPT/DISCONNECTED. Cross-check this immutable authenticated plan snapshot for planned transitions and core-term consistency (source ${disc.planPath}):\n${PLAN_TEXT} Quote the actual closing/opening sentences from the boundary data.\nBoundaries:\n${JSON.stringify(boundaries, null, 2)}\nReturn TRANSITION_SCHEMA.`,
    { label: 'L2:transitions', phase: 'L2-L3', schema: TRANSITION_SCHEMA, model: 'sonnet' }),
  () => agent(
    `${REVIEW_IDENTITY}\nREAD-ONLY document reviewer (Level 3). Working dir ${PROJECT}.
Judge only the immutable authenticated plan and draft corpus embedded below; do not reread mutable plan or draft paths. Summaries below are navigation aids only and cannot substitute for reviewing the full snapshots.
AUTHENTICATED PLAN SNAPSHOT (${disc.planPath}):\n${PLAN_TEXT}
ORDERED FULL DRAFT SNAPSHOTS:\n${sections.map(section => `===== ${section.name} :: ${section.draftFile} =====\n${artifactSnapshots[section.name].draft.text}`).join('\n')}
1. Detect repeated passages across the embedded draft snapshots and classify each pair REDUNDANT vs INTENTIONAL_CALLBACK.
2. Concept introduction order: using the full drafts plus per-section concepts and argument summaries, flag concepts used before introduced.
3. Thesis threading: for each full section does it advance the authenticated plan thesis? flag drift.
4. Structural completeness: all plan claims addressed? all counterarguments confronted? scope honored? hook delivered? conclusion follows?\n5. Inspect every plan Review Surfaces bullet and return one reviewSurfaces record per exact surface, with status INSPECTED or MISSING and concrete evidence. Required surfaces: ${JSON.stringify(disc.reviewSurfaces)}. Source Plan context: ${JSON.stringify(disc.sourcePlan)}
Per-section argument summaries + claims:\n${JSON.stringify(argSummaries, null, 2)}\nReturn DOCUMENT_SCHEMA.`,
    { label: 'L3:document', phase: 'L2-L3', schema: DOCUMENT_SCHEMA, model: 'sonnet' }),
])

// ── Assemble structured findings + computed verdict (binary gate, in JS) ───────
// Drift detection is the same guarantee, run on the other side of the workflow:
// this script cannot re-stat anything, so it carries the entry hashes and the
// deterministic post-step (`--verify --findings`) re-snapshots every artifact,
// zeroes the finalOutlineHash/finalDraftHash of anything that moved, discards that
// section's findings, and appends the critical artifact-integrity findings this
// block used to append. verifyRequired below is the assertion that it must run.
const artifactChanges = []
for (const section of allSections) {
  const snapshots = artifactSnapshots[section.section]
  section.finalOutlineHash = snapshots.outline.hash
  section.finalDraftHash = snapshots.draft.hash
}
const sev = { critical: 0, major: 0, minor: 0 }
for (const s of allSections) for (const i of (s.issues || [])) if (sev[i.severity] !== undefined) sev[i.severity]++
// Document + transition issues count toward severity too.
const surfaceResults = Array.isArray(l3?.reviewSurfaces) ? l3.reviewSurfaces : []
const surfaceByName = new Map(surfaceResults.map(surface => [surface.surface, surface]))
const missingSurfaces = disc.reviewSurfaces.filter(surface => surfaceByName.get(surface)?.status !== 'INSPECTED' || !surfaceByName.get(surface)?.evidence)
const expectedTransitions = indexedNames.slice(0, -1).map((from, index) => `${from}@@${indexedNames[index + 1]}`)
const transitionRecords = Array.isArray(l2?.transitions) ? l2.transitions : []
const observedTransitions = transitionRecords.map(transition => `${transition.from}@@${transition.to}`)
const transitionCoverageOk = observedTransitions.length === expectedTransitions.length && new Set(observedTransitions).size === observedTransitions.length && expectedTransitions.every(pair => observedTransitions.includes(pair))
const incompleteClaims = String(l3?.completeness?.claimsAddressed || '').trim().toLowerCase() !== 'all'
const incompleteCounterarguments = String(l3?.completeness?.counterargsConfronted || '').trim().toLowerCase() !== 'all'
const docIssues = [
  ...artifactChanges,
  ...missingSurfaces.map(surface => ({ severity: 'critical', area: 'review-surface', detail: `Review surface not inspected: ${surface}` })),
  ...(!transitionCoverageOk ? [{ severity: 'major', area: 'transition-coverage', detail: 'Transition review did not return exactly one result for every adjacent PLAN section pair.' }] : []),
  ...allSections.filter(section => section.planClaimAdvanced === false).map(section => ({ severity: 'critical', area: 'claim-coverage', detail: `${section.section} does not advance its mapped PLAN claim.` })),
  ...(incompleteClaims ? [{ severity: 'critical', area: 'completeness', detail: 'Whole-document reviewer did not confirm all PLAN claims addressed.' }] : []),
  ...(incompleteCounterarguments ? [{ severity: 'critical', area: 'completeness', detail: 'Whole-document reviewer did not confirm all counterarguments confronted.' }] : []),
  // CONFIRMATION MUST BE AFFIRMATIVE. These were `=== false`, so a reviewer that OMITTED the field
  // — returned it as null, misspelled it, or never populated `completeness` at all — cleared three
  // gates it never answered. Absence of a denial is not a confirmation. Their own neighbours two
  // lines up (`claimsAddressed`/`counterargsConfronted`) already require the affirmative value and
  // fail on missing; these three were the odd ones out in the same object literal.
  ...(l3?.completeness?.scopeHonored !== true ? [{ severity: 'major', area: 'scope', detail: 'Whole-document reviewer did not confirm the draft honors PLAN scope.' }] : []),
  ...(l3?.completeness?.hookDelivered !== true ? [{ severity: 'major', area: 'hook', detail: 'Whole-document reviewer did not confirm the draft delivers the PLAN hook.' }] : []),
  ...(l3?.completeness?.conclusionFollows !== true ? [{ severity: 'major', area: 'conclusion', detail: 'Whole-document reviewer did not confirm the conclusion follows from the reviewed argument.' }] : []),
  ...(l3?.conceptOrderIssues || []).map(d => ({ severity: 'major', area: 'concept-order', detail: d })),
  ...(l3?.repetition || []).filter(r => r.verdict === 'REDUNDANT').map(r => ({ severity: 'major', area: 'repetition', detail: r.quote, locations: r.locations })),
  ...(l3?.thesisIssues || []).map(d => ({ severity: 'major', area: 'thesis', detail: d })),
  ...((l3?.completeness?.issues) || []).map(d => ({ severity: 'critical', area: 'completeness', detail: d })),
]
const transIssues = (l2?.transitions || []).filter(t => t.verdict !== 'SMOOTH')
const unreliableSections = allSections.filter(s => s.unreliable).map(s => s.section)
for (const d of docIssues) sev[d.severity]++
for (const t of transIssues) sev.major++
sev.critical += unreliableSections.length

const total = sev.critical + sev.major + sev.minor
// Substrate gate (the convergence signal): argument-breaking (critical) + structural (major) findings must be 0.
// These are real and they converge as you fix them. MINOR findings are advisory prose polish — the per-section
// prose reviewers (LLM) regenerate subjective minors run-to-run, so requiring minor===0 is a treadmill (the
// writing analog of chasing composite 9.5; see project_wc_mode3_asymptote). The /writing-revise loop drives
// criticals+majors to 0 HARD, then treats residual minors as best-effort polish the writer accepts at the cap.
// (Mechanical fabrication/citation/constraint checks are the SEPARATE Leg-1 hard gate that runs before this workflow.)
const substratePass = sev.critical === 0 && sev.major === 0
const verdict = !substratePass ? 'ISSUES FOUND' : (sev.minor === 0 ? 'CLEAN' : 'CLEAN (advisory polish notes)')
const overallPass = substratePass
const rank = { critical: 0, major: 1, minor: 2 }
const findings = [
  ...allSections.filter(section => section.unreliable).map(section => ({ severity: 'critical', planHash: PLAN_HASH, section: section.section, claimIds: String(section.planClaims || '').split(/\s*,\s*/).filter(claim => /^CLAIM-[0-9]{2}$/.test(claim)), area: 'reviewer-integrity', detail: `${section.section} review evidence was missing or fabricated; a fresh independent review is required.`, location: draftByName[section.section], retryKey: `section:${section.section}:reviewer-unreliable` })),
  ...allSections.flatMap(section => (section.issues || []).map((issue, index) => ({ ...issue, planHash: PLAN_HASH, section: section.section, claimIds: String(section.planClaims || '').split(/\s*,\s*/).filter(claim => /^CLAIM-[0-9]{2}$/.test(claim)), retryKey: `section:${section.section}:${issue.source || 'review'}:${index}` }))),
  ...transIssues.map((transition, index) => ({ severity: 'major', planHash: PLAN_HASH, area: 'transition', detail: transition.problem || `${transition.from} → ${transition.to} is ${transition.verdict}`, location: `${transition.from} → ${transition.to}`, retryKey: `transition:${index}` })),
  ...docIssues.map((issue, index) => ({ ...issue, planHash: PLAN_HASH, retryKey: `document:${issue.area}:${index}` })),
].sort((left, right) => (rank[left.severity] ?? 9) - (rank[right.severity] ?? 9))

log(substratePass
  ? (sev.minor === 0 ? '✅ Review CLEAN — no issues' : `✅ Review CLEAN — 0 critical / 0 major; ${sev.minor} advisory minor polish note(s)`)
  : `Review: ISSUES FOUND — ${sev.critical} critical / ${sev.major} major (blocking) / ${sev.minor} minor (advisory)`)

return {
  planPath: PLAN_PATH,
  planHash: PLAN_HASH,
  // Entry hashes. The post-step overwrites finalPlanHash / per-section final*Hash
  // with '' for anything that drifted and flips the gate; until it has run this
  // verdict is provisional, which is what verifyRequired announces.
  finalPlanHash: PLAN_SNAPSHOT.hash,
  verifyRequired: true,
  driftVerified: false,
  overallPass,                    // == substratePass: critical===0 && major===0 (minors are advisory, NOT blocking)
  substratePass,
  verdict,
  summary: { ...sev, total, blocking: sev.critical + sev.major, advisoryMinors: sev.minor },
  style: disc.style,
  sections: allSections,            // per-section issues + boundary + argumentSummary for TaskList reconciliation
  transitions: l2?.transitions || [],
  documentLevel: l3 || null,
  findings,                         // normalized TaskList-ready section, transition, document, and integrity findings
  unreliableSections,               // sections where a reviewer returned nothing — flag, don't trust
  sectionsThatFlagged: allSections.filter(s => (s.issues || []).length || s.unreliable).map(s => s.section), // pass as onlyChecks on re-review
}
