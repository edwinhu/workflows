export const meta = {
  name: 'writing-review',
  description: 'Hierarchical document review (Levels 1-3) as an ultracode workflow: per-section fan-out (structure + prose-quality + source-fidelity), mechanical quote-verification, transition analysis, and whole-document checks. Returns structured findings the skill renders into REVIEW.md. Read-only; does NOT fix.',
  whenToUse: 'Called by the writing-review skill after setup + the Leg-1 constraint hard gate. Returns structured findings (sections/transitions/document-level) + a CLEAN/ISSUES-FOUND verdict. The skill renders REVIEW.md and drives the /writing-revise /goal loop; on a re-review it passes onlyChecks (changed section names) + priorReviews.',
  phases: [
    { title: 'Discover', detail: 'enumerate sections + resolve PRECIS/OUTLINE/domain/bib' },
    { title: 'L1-Review', detail: 'per-section: structure + prose + fidelity reviewers, in parallel' },
    { title: 'Verify', detail: 'mechanically confirm quoted evidence resolves to the draft' },
    { title: 'L2-L3', detail: 'transition analysis + whole-document checks over L1 data' },
  ],
}

// ── Inputs ──────────────────────────────────────────────────────────────────
// args = {
//   projectDir: "/abs/writing-project-dir",   // REQUIRED — holds .planning/, outlines/, drafts/, references/sources.bib
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

const DISCOVERY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['style', 'precisPath', 'outlinePath', 'sourcesBib', 'domainSkillPath', 'repetitionScript', 'sections'],
  properties: {
    style: { type: 'string', description: 'legal | econ | general' },
    precisPath: { type: 'string' }, outlinePath: { type: 'string' },
    sourcesBib: { type: 'string', description: 'references/sources.bib absolute path, or "" if absent' },
    domainSkillPath: { type: 'string', description: 'absolute path to writing-{style}/SKILL.md' },
    repetitionScript: { type: 'string', description: 'absolute path to bridge_repetition_check.py' },
    sections: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['name', 'outlineFile', 'draftFile', 'precisClaim'],
      properties: { name: { type: 'string' }, outlineFile: { type: 'string' }, draftFile: { type: 'string' }, precisClaim: { type: 'string' } } } },
  },
}

// Structure reviewer — the rich one (carries boundary summary + concepts + argument summary for L2/L3).
const STRUCTURE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['section', 'check', 'itemsChecked', 'issues', 'precisClaimAdvanced', 'boundary', 'argumentSummary'],
  properties: {
    section: { type: 'string' }, check: { type: 'string', enum: ['structure'] },
    itemsChecked: { type: 'integer' },
    issues: { type: 'array', items: ISSUE },
    precisClaimAdvanced: { type: 'boolean' },
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
  required: ['conceptOrderIssues', 'repetition', 'thesisIssues', 'completeness'],
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
  },
}

// ── Phase 1: Discover ─────────────────────────────────────────────────────────
phase('Discover')
const disc = await agent(
  `Enumerate the document's sections and resolve the review inputs. Working directory: ${PROJECT}

1. Determine \`style\` (legal|econ|general): read .planning/ACTIVE_WORKFLOW.md if it exists; if it does NOT exist, infer from .planning/PRECIS.md's "Domain" line — pure law → legal, pure empirical → econ, and a **hybrid/mixed domain → general** (the safe baseline). ${cfg.style ? `Caller override: use style="${cfg.style}".` : ''}
2. Resolve absolute paths: .planning/PRECIS.md, .planning/OUTLINE.md, references/sources.bib (or "" if absent).
3. domainSkillPath = the writing-{style}/SKILL.md under the plugin. ${cfg.pluginRoot ? `Plugin root: ${cfg.pluginRoot}` : 'Resolve via: command ls -d ~/.claude/plugins/cache/*/workflows/*/skills/writing-{style}/SKILL.md or the in-repo skills/ dir.'}
4. repetitionScript = the bridge_repetition_check.py under skills/writing-review/scripts/.
5. From OUTLINE.md + Glob(outlines/*.md, drafts/*.md): list every section with its outlineFile, draftFile (absolute), and the PRECIS claim it advances. Every section MUST have both files — if a draft is missing, still list it but note in precisClaim "MISSING DRAFT".

Return DISCOVERY_SCHEMA. Absolute paths.`,
  { label: 'discover', phase: 'Discover', schema: DISCOVERY_SCHEMA, model: 'sonnet' }
)
if (!disc.sections.length) throw new Error('No sections discovered — check OUTLINE.md / drafts/')
let sections = disc.sections
log(`Document: ${sections.length} sections (${disc.style}); ${ONLY ? `re-review ${ONLY.size}` : 'full review'}`)

// ── Phase 2: L1 Section Review (per-section × 3 reviewers, parallel) ───────────
phase('L1-Review')
const reviewOne = (s) => {
  const common = `Section: "${s.name}"\nOutline: ${s.outlineFile}\nDraft: ${s.draftFile}\nPRECIS claim: ${s.precisClaim}`
  return parallel([
    // (a) Structure reviewer — runs the section checklist; carries boundary + argument summaries.
    () => agent(
      `You are a READ-ONLY structure reviewer. Do NOT create, edit, or overwrite any files.
Set section="${s.name}", check="structure" verbatim in your record.
${common}
Read the draft + outline. Run the section review checklist: outline compliance, a topic-sentence inventory (every paragraph), subsection boundaries, domain style (read ${disc.domainSkillPath}), prose-constraint and AI-anti-pattern checks. Every issue needs a verbatim quote + file:line location. Also produce the boundary summary (first/last sentence verbatim, what it assumes from prev / hands to next, argument state, concepts introduced/used, core terms) and argumentSummary (main points, for whole-doc repetition/thesis checks). itemsChecked = paragraphs reviewed. Return STRUCTURE_SCHEMA.`,
      { label: `${s.name}:structure`, phase: 'L1-Review', schema: STRUCTURE_SCHEMA, model: 'sonnet' }),
    // (b) Prose-quality reviewer — the real agent.
    () => agent(
      `Set section="${s.name}", check="prose". Grade prose quality for ${s.draftFile} (domain: ${disc.style}). Read the domain skill, ai-anti-patterns, and prose constraints first. Grade every paragraph; report violations with file:line + verbatim quote. Map grades to severity: F→critical, C→major, lesser→minor. itemsChecked = paragraphs graded. Return FINDINGS_SCHEMA.`,
      { label: `${s.name}:prose`, phase: 'L1-Review', schema: FINDINGS_SCHEMA, model: 'sonnet', agentType: 'workflows:writing-prose-reviewer' }),
    // (c) Source-fidelity reviewer — the real agent.
    () => agent(
      `Set section="${s.name}", check="fidelity". Verify citation fidelity for ${s.draftFile}. Read ${disc.sourcesBib || 'references/sources.bib'} first. Check every pandoc cite-key resolves to a bib entry; verify hand-written footnotes match. Severity: unanchored citation→critical, detail mismatch→major, claim-fidelity concern→minor. Each issue needs file:line + the citation text as quote. itemsChecked = citations checked. Return FINDINGS_SCHEMA.`,
      { label: `${s.name}:fidelity`, phase: 'L1-Review', schema: FINDINGS_SCHEMA, model: 'sonnet', agentType: 'workflows:writing-source-fidelity-reviewer' }),
  ]).then(([structure, prose, fidelity]) => ({
    section: s.name,
    precisClaim: s.precisClaim,
    issues: [
      ...(structure?.issues || []).map(i => ({ ...i, source: 'structure' })),
      ...(prose?.issues || []).map(i => ({ ...i, source: 'prose' })),
      ...(fidelity?.issues || []).map(i => ({ ...i, source: 'fidelity' })),
    ],
    boundary: structure?.boundary || null,
    argumentSummary: structure?.argumentSummary || [],
    precisClaimAdvanced: structure?.precisClaimAdvanced ?? null,
    itemsChecked: (structure?.itemsChecked || 0) + (prose?.itemsChecked || 0) + (fidelity?.itemsChecked || 0),
    unreliable: !(structure && prose && fidelity) || !((structure?.itemsChecked || 0) > 0),
  }))
}

const tasks = []
const carried = []
let reran = 0, carriedCount = 0
for (const s of sections) {
  if (ONLY && !ONLY.has(s.name)) {
    if (PRIOR.has(s.name)) { carried.push(PRIOR.get(s.name)); carriedCount++ }
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
const verifs = (await parallel(liveSections.map(sec => () =>
  agent(
    `READ-ONLY. Set section="${sec.section}". Verify the quoted evidence in these review issues actually appears in the draft file ${draftByName[sec.section]} at (or near) the cited location. Use grep/Read. List any quote that does NOT resolve (fabricated/misattributed) in \`fabricated\`. Issues to check (quote @ location):\n${JSON.stringify((sec.issues || []).map(i => ({ quote: i.quote, location: i.location })), null, 2)}\nReturn VERIFY_SCHEMA.`,
    { label: `${sec.section}:verify`, phase: 'Verify', schema: VERIFY_SCHEMA, model: 'sonnet' }
  )
))).filter(Boolean)
const fabByName = Object.fromEntries(verifs.map(v => [v.section, v.fabricated || []]))
// Drop fabricated-quote issues; flag the section as needing attention.
for (const sec of liveSections) {
  const fab = new Set((fabByName[sec.section] || []).map(f => `${f.quote}@@${f.location}`))
  if (fab.size) {
    const before = sec.issues.length
    sec.issues = sec.issues.filter(i => !fab.has(`${i.quote}@@${i.location}`))
    sec.quotesDropped = before - sec.issues.length
  }
}

const allSections = [...liveSections, ...carried]
// Stable document order from discovery.
const order = Object.fromEntries(sections.map((s, i) => [s.name, i]))
allSections.sort((a, b) => (order[a.section] ?? 99) - (order[b.section] ?? 99))

// ── Phase 4: L2 transitions + L3 whole-document (single agents over L1 data) ───
phase('L2-L3')
const boundaries = allSections.map(s => ({ section: s.section, boundary: s.boundary }))
const argSummaries = allSections.map(s => ({ section: s.section, points: s.argumentSummary, claim: s.precisClaim }))

const [l2, l3] = await parallel([
  () => agent(
    `READ-ONLY transition reviewer (Level 2). Using these per-section boundary summaries (in document order), evaluate each adjacent boundary (Section N → N+1): does N+1's opening pick up N's close? verdict SMOOTH/ABRUPT/DISCONNECTED. Cross-check OUTLINE.md (${disc.outlinePath}) for the planned transition, and core-term consistency. Quote the actual closing/opening sentences from the boundary data.\nBoundaries:\n${JSON.stringify(boundaries, null, 2)}\nReturn TRANSITION_SCHEMA.`,
    { label: 'L2:transitions', phase: 'L2-L3', schema: TRANSITION_SCHEMA, model: 'sonnet' }),
  () => agent(
    `READ-ONLY document reviewer (Level 3). Working dir ${PROJECT}.
1. Run the repetition detector and parse its file:line pairs: \`uv run ${disc.repetitionScript} drafts/*.md\` — classify each flagged pair REDUNDANT vs INTENTIONAL_CALLBACK.
2. Concept introduction order: using the per-section concepts + argument summaries, flag concepts used before introduced.
3. Thesis threading: read ${disc.precisPath}; for each section does it advance the thesis? flag drift.
4. Structural completeness: all PRECIS claims addressed? all counterarguments confronted? scope honored? hook delivered? conclusion follows?
Per-section argument summaries + claims:\n${JSON.stringify(argSummaries, null, 2)}\nReturn DOCUMENT_SCHEMA.`,
    { label: 'L3:document', phase: 'L2-L3', schema: DOCUMENT_SCHEMA, model: 'sonnet' }),
])

// ── Assemble structured findings + computed verdict (binary gate, in JS) ───────
const sev = { critical: 0, major: 0, minor: 0 }
for (const s of allSections) for (const i of (s.issues || [])) if (sev[i.severity] !== undefined) sev[i.severity]++
// Document + transition issues count toward severity too.
const docIssues = [
  ...(l3?.conceptOrderIssues || []).map(d => ({ severity: 'major', area: 'concept-order', detail: d })),
  ...(l3?.repetition || []).filter(r => r.verdict === 'REDUNDANT').map(r => ({ severity: 'major', area: 'repetition', detail: r.quote, locations: r.locations })),
  ...(l3?.thesisIssues || []).map(d => ({ severity: 'major', area: 'thesis', detail: d })),
  ...((l3?.completeness?.issues) || []).map(d => ({ severity: 'critical', area: 'completeness', detail: d })),
]
const transIssues = (l2?.transitions || []).filter(t => t.verdict !== 'SMOOTH')
for (const d of docIssues) sev[d.severity]++
for (const t of transIssues) sev.major++

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
const unreliableSections = allSections.filter(s => s.unreliable).map(s => s.section)

log(substratePass
  ? (sev.minor === 0 ? '✅ Review CLEAN — no issues' : `✅ Review CLEAN — 0 critical / 0 major; ${sev.minor} advisory minor polish note(s)`)
  : `Review: ISSUES FOUND — ${sev.critical} critical / ${sev.major} major (blocking) / ${sev.minor} minor (advisory)`)

return {
  overallPass,                      // == substratePass: critical===0 && major===0 (minors are advisory, NOT blocking)
  substratePass,
  verdict,
  summary: { ...sev, total, blocking: sev.critical + sev.major, advisoryMinors: sev.minor },
  style: disc.style,
  sections: allSections,            // per-section issues + boundary + argumentSummary (skill renders REVIEW.md from this)
  transitions: l2?.transitions || [],
  documentLevel: l3 || null,
  unreliableSections,               // sections where a reviewer returned nothing — flag, don't trust
  sectionsThatFlagged: allSections.filter(s => (s.issues || []).length || s.unreliable).map(s => s.section), // pass as onlyChecks on re-review
}
