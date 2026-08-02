export const meta = {
  name: 'workshop-generate',
  description: "Generate workshop slides and notes from the receipt-selected native PLAN's pinned seven-column Slide Spec. It groups rows by SECTION, fans out section rendering, assembles both Typst deliverables, and gates both compilations without discovering alternative planning authority.",
  whenToUse: "Called after independent whole-plan review. Requires matching planPath, planHash, and canonical slideIndex; returns generation evidence for the independent workshop verifier.",
  phases: [
    { title: 'Discover', detail: 'read the authenticated PLAN Slide Spec + Source Inventory + paper + theme header; group slides by Section' },
    { title: 'Sections', detail: 'one agent per SECTION (parallel) — write the whole subsection (all its slide blocks + notes) to a fragment file from the pinned rows' },
    { title: 'Assemble', detail: 'one agent concatenates the section files in order into slides.typ + notes.typ and compiles the deck' },
    { title: 'Gate', detail: 'every section fragment written AND the deck compiles — computed in JS' },
  ],
}

// ── Inputs ──────────────────────────────────────────────────────────────────
// args = {
//   projectDir:  "/abs/project-root",          // REQUIRED — holds .planning/ and presentation/
//   projectReal: "/abs/resolved-project-root", // REQUIRED — bundle.projectReal from the authenticate pre-step
//   artifacts:   { receipt: {...}, plan: {...} },
//                                              // REQUIRED — bundle.artifacts from `workshop_plan_auth.py --authenticate`
//   pluginRoot:  "/abs/.../workflows",         // optional
//   planPath, planHash, slideIndex,            // REQUIRED — the canonical TypeScript slide index + its plan identity
//   onlyChecks?, priorReviews?,                // re-run loop: regenerate only these section ids; carry the rest
// }
let cfg = args
if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch { cfg = {} } }
cfg = cfg || {}
const PROJECT = cfg.projectDir
if (!PROJECT) throw new Error(`workshop-generate requires args.projectDir. Got "${typeof args}": ${JSON.stringify(args)?.slice(0, 200)}`)
const PLUGIN = cfg.pluginRoot || ''
const RECEIPT_KEYS = ['workflow','plan_file','plan_hash','approved_session_id','approved_at','status','reviewer_session_id','reviewed_at']
const HASH = /^[0-9a-f]{64}$/
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const RESERVED_PLAN_FILES = new Set(['PLAN.md','PLAN_REVIEWED.md','REVIEW.md','AUTOMATED_REVIEW.md','HUMAN_REVIEW.md','IMPLEMENT_COMPLETE.md','VALIDATION.md'])
// ── Authenticated artifact bundle (no filesystem access in here) ─────────────
// Workflow scripts are pure control flow: the runtime rejects import(), import.meta,
// process, and Buffer. The node:fs/node:crypto `authenticatePlan` that used to run here
// — duplicated near-identically in workshop-generate.js and workshop-verify.js, and
// therefore executed by NEITHER (both threw at the import line before dispatching an
// agent) — now runs ONCE, in the deterministic pre-step
// `scripts/workshop/workshop_plan_auth.py --authenticate`, and arrives via args.artifacts.
// Only the file opening, hashing, containing-directory symlink lstat, and realpath
// containment moved. Every check that is pure data comparison stays right here: the
// strict receipt parse runs again over the authenticated BYTES (artifacts.receipt.text),
// not over a verdict handed to this script, so the pre-step is trusted to deliver bytes
// and nothing more. Authentication is NOT delegated to an agent — asking a dispatched
// agent to vouch for its own inputs is not authentication.
// Drift detection is symmetrically deterministic: the post-step re-snapshots via
// `--verify --findings`, which is why this run returns verifyRequired: true.
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
// Strict containment: an empty relative path (same file), a '..' escape, or an
// unauthenticated sentinel all fail closed.
const containedBy = (root, path) => typeof path === 'string' && path !== INVALID && path !== root && path.startsWith(`${root}/`)

const PROJECT_REAL = typeof cfg.projectReal === 'string' ? cfg.projectReal : ''
if (!isAbs(PROJECT_REAL) || normalizePath(PROJECT_REAL) !== PROJECT_REAL) {
  throw new Error('workshop-generate requires args.projectReal: the absolute resolved projectDir emitted by workshop_plan_auth.py --authenticate.')
}
const ARTIFACTS = (cfg.artifacts && typeof cfg.artifacts === 'object' && !Array.isArray(cfg.artifacts)) ? cfg.artifacts : null
if (!ARTIFACTS) throw new Error('workshop-generate requires args.artifacts: the authenticated bundle from workshop_plan_auth.py --authenticate.')
const artifact = key => {
  const snapshot = ARTIFACTS[key]
  if (!snapshot || typeof snapshot !== 'object') throw new Error(`workshop-generate is missing an authenticated artifact: ${key}`)
  const { path, real, hash, text } = snapshot
  if (!isAbs(path) || !isAbs(real) || typeof text !== 'string' || !HASH.test(String(hash))) {
    throw new Error(`workshop-generate rejected a malformed authenticated artifact: ${key}`)
  }
  if (!containedBy(PROJECT_REAL, normalizePath(real))) throw new Error(`workshop-generate artifact escapes projectDir: ${key} (${real})`)
  return { path: normalizePath(path), real: normalizePath(real), hash, text }
}
function parseStrictReceipt(content) {
  const text = String(content).trim(); let index = 0
  const skip = () => { while (/\s/.test(text[index] || '')) index++ }
  const string = () => {
    skip(); if (text[index] !== '"') throw new Error('workshop generated-plan review.json values must be strings')
    const start = index++; let escaped = false
    while (index < text.length) {
      const char = text[index++]
      if (escaped) { escaped = false; continue }
      if (char === '\\') { escaped = true; continue }
      if (char === '"') return JSON.parse(text.slice(start, index))
    }
    throw new Error('workshop generated-plan review.json contains an unterminated string')
  }
  skip(); if (text[index++] !== '{') throw new Error('workshop generated-plan review.json must be one object')
  const receipt = {}; skip()
  while (text[index] !== '}') {
    const key = string(); if (Object.hasOwn(receipt, key)) throw new Error('workshop generated-plan review.json contains duplicate fields')
    skip(); if (text[index++] !== ':') throw new Error('workshop generated-plan review.json field is missing a colon')
    receipt[key] = string(); skip()
    if (text[index] === ',') { index++; skip(); continue }
    if (text[index] !== '}') throw new Error('workshop generated-plan review.json fields must be comma separated')
  }
  index++; skip(); if (index !== text.length) throw new Error('workshop generated-plan review.json has trailing content')
  return receipt
}
// Pure data comparison over the authenticated bundle. The pre-step already proved
// these bytes came from a regular, non-symlink, project-contained file whose identity
// held still across the read (O_NOFOLLOW open, fstat-vs-lstat before AND after,
// realpath containment); it proved nothing about what they SAY. That is this function.
function authenticatePlan(planPath, planHash) {
  const root = PROJECT_REAL, planning = joinPath(root, '.planning'), state = joinPath(planning, '.state', 'review.json')
  const receiptSnapshot = artifact('receipt')
  // real !== path means the pre-step resolved through a link; the lstat symlink
  // rejection it performs is re-asserted here from the snapshot's own identity fields.
  if (receiptSnapshot.path !== state || receiptSnapshot.real !== state) throw new Error('workshop generated-plan authenticated receipt is not the projectDir combined review state')
  const receipt = parseStrictReceipt(receiptSnapshot.text)
  const approvedAt = Date.parse(receipt.approved_at), reviewedAt = Date.parse(receipt.reviewed_at)
  if (Object.keys(receipt).length !== RECEIPT_KEYS.length || RECEIPT_KEYS.some(key => typeof receipt[key] !== 'string') || receipt.workflow !== 'workshop' || receipt.status !== 'APPROVED' || !HASH.test(receipt.plan_hash) || !UTC.test(receipt.approved_at) || !UTC.test(receipt.reviewed_at) || new Date(approvedAt).toISOString() !== receipt.approved_at || new Date(reviewedAt).toISOString() !== receipt.reviewed_at || !receipt.approved_session_id.trim() || !receipt.reviewer_session_id.trim() || receipt.approved_session_id === receipt.reviewer_session_id || reviewedAt <= approvedAt || !/^[^./\\][^/\\]*\.md$/.test(receipt.plan_file) || RESERVED_PLAN_FILES.has(receipt.plan_file)) throw new Error('workshop generated-plan review.json has invalid strict receipt schema')
  const selected = joinPath(planning, receipt.plan_file)
  const planSnapshot = artifact('plan')
  if (resolvePath(planPath) !== selected || planSnapshot.path !== selected || planSnapshot.real !== selected || !containedBy(planning, selected)) throw new Error('workshop generated-plan path is not the receipt-selected safe direct child')
  const current = planSnapshot.hash
  if (current !== receipt.plan_hash || current !== planHash) throw new Error('workshop generated-plan receipt does not authenticate current plan bytes')
  return { root, state, receipt, hash: current, planPath: selected, receiptSnapshot, planSnapshot }
}
const AUTH = authenticatePlan(cfg.planPath, cfg.planHash)
const ONLY = Array.isArray(cfg.onlyChecks) && cfg.onlyChecks.length ? new Set(cfg.onlyChecks.map(String)) : null
const PRIOR = new Map((Array.isArray(cfg.priorReviews) ? cfg.priorReviews : []).map(s => [String(s.section), s]))
// Deterministic slide index from scripts/workshop/workshop-slide-table.ts — the compiled "Discover".
// The parser's work-list IS the shared-v1 generate enumerator (DESIGN §3a). Missing or empty input is
// an integrity failure, never permission to substitute an LLM enumerator. The fileHeader (theme preamble)
// is not a work-list concern; the assembly agent constructs it from templates + authenticated PLAN metadata.
if (!cfg.planPath || !cfg.planHash) throw new Error('workshop-generate requires receipt-selected args.planPath and args.planHash')
if (!cfg.slideIndex || !Array.isArray(cfg.slideIndex.slides) || !cfg.slideIndex.slides.length) throw new Error('workshop-generate requires the canonical TypeScript slideIndex with at least one slide')
if (cfg.slideIndex.planPath !== cfg.planPath || cfg.slideIndex.planHash !== cfg.planHash) throw new Error('workshop-generate planPath/planHash must match the canonical slideIndex')
if (cfg.slideIndex.ok !== true || cfg.slideIndex.planPath !== AUTH.planPath || cfg.slideIndex.planHash !== AUTH.hash || cfg.slideIndex.planFile !== AUTH.receipt.plan_file || cfg.slideIndex.reviewStatePath !== AUTH.state || (cfg.slideIndex.violations || []).length) throw new Error('workshop-generate index disagrees with strict current review.json authentication')
const SLIDE_INDEX = cfg.slideIndex
const SEV_RANK = { critical: 0, major: 1, minor: 2 }

const SLIDE = {
  type: 'object', additionalProperties: false,
  required: ['num', 'section', 'takeaway', 'bullets', 'inventory', 'visual', 'notes'],
  properties: {
    num: { type: 'string' }, section: { type: 'string', description: 'the `=` Part + `==` subsection this slide sits under (the fan-out grouping key)' },
    takeaway: { type: 'string' }, bullets: { type: 'string' },
    inventory: { type: 'array', items: { type: 'string' } }, visual: { type: 'string' }, notes: { type: 'string' },
  },
}
const DISCOVERY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['outlineReadable', 'sourcesPath', 'paperPath', 'slidesPath', 'notesPath', 'fileHeader', 'fragmentsDir', 'sectionOrder', 'slides'],
  properties: {
    outlineReadable: { type: 'boolean' }, sourcesPath: { type: 'string' }, paperPath: { type: 'string' },
    slidesPath: { type: 'string' }, notesPath: { type: 'string' },
    fileHeader: { type: 'string', description: 'the slides.typ preamble (import theme + #show + config-info incl qr:none)' },
    fragmentsDir: { type: 'string', description: 'absolute scratch dir for per-section fragment files' },
    sectionOrder: { type: 'array', items: { type: 'string' }, description: 'distinct Section keys in presentation order' },
    slides: { type: 'array', items: SLIDE },
  },
}
// Each SECTION agent writes its whole subsection (all its slides + notes) to two fragment files.
const SECTION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['section', 'status', 'slidesPath', 'notesPath', 'slideNums', 'citedInventory', 'summary'],
  properties: {
    section: { type: 'string', description: 'echo the section index id verbatim' },
    status: { type: 'string', enum: ['drafted', 'error'] },
    slidesPath: { type: 'string', description: 'fragment file with this section\'s `==` heading-less `#slide[]` blocks, in order' },
    notesPath: { type: 'string', description: 'fragment file with this section\'s notes (one block per slide)' },
    slideNums: { type: 'array', items: { type: 'string' }, description: 'the slide numbers this section file covers (must equal the section\'s spec rows)' },
    citedInventory: { type: 'array', items: { type: 'string' }, description: 'inventory ids cited across the section (⊆ the union of its slides\' allowed ids)' },
    summary: { type: 'string' },
  },
}
// Independent mechanical probe (mirrors run-core's gateProbe doctrine): the section agent's
// citedInventory is self-reported (it greps its own fragment and echoes tokens) — nothing deterministic
// re-checked it. workshop-verify's whitelist covers authenticated PLAN inventoryRefs, not grepped fragment tokens.
// This workflow has no filesystem access itself, so a second, CHEAP, low-effort agent re-runs the exact
// grep independently and its tokens (not the section agent's self-report) are what the gate trusts.
const PROBE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['section', 'tokens'],
  properties: {
    section: { type: 'string' },
    tokens: { type: 'array', items: { type: 'string' }, description: 'exact, verbatim output of the grep command — do not add, remove, or further dedupe' },
  },
}
const ASSEMBLE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['slidesWritten', 'notesWritten', 'compiled', 'compileError', 'notesCompiled', 'notesCompileError', 'slidesPdf'],
  properties: {
    slidesWritten: { type: 'boolean' }, notesWritten: { type: 'boolean' },
    compiled: { type: 'boolean' }, compileError: { type: 'string' },
    notesCompiled: { type: 'boolean', description: 'notes.typ compiled cleanly (a first-class teleprompter deliverable — gated, not slides-only)' },
    notesCompileError: { type: 'string' },
    slidesPdf: { type: 'string' },
  },
}

// ── Phase 1: Discover ─────────────────────────────────────────────────────────
// Map the deterministic slide index → the DISCOVERY_SCHEMA shape (no LLM). The parser's COMPOSITE
// group ("<= section> / <== subsection>") is the fan-out key. The receipt-selected PLAN is the only
// structure source; fileHeader is left "" for the assembly agent to construct.
function discFromIndex(idx) {
  return {
    outlineReadable: true,
    sourcesPath: idx.planPath,
    paperPath: idx.paperPath || '',
    slidesPath: `${PROJECT}/presentation/slides.typ`,
    notesPath: `${PROJECT}/presentation/notes.typ`,
    fileHeader: '',                                  // assembly agent constructs it (DESIGN §3a)
    fragmentsDir: `${PROJECT}/presentation/.workshop-fragments`,
    sectionOrder: idx.groupOrder,                    // composite fan-out keys, document order
    slides: idx.slides.map(s => ({
      num: String(s.num),
      section: s.group,                              // the composite grouping key
      takeaway: s.takeaway,
      bullets: s.bullets || '',
      inventory: Array.isArray(s.inventory) ? s.inventory : [],
      visual: (s.visual && s.visual.trim()) || 'none',
      notes: s.notes || '',
    })),
  }
}

phase('Discover')
const disc = discFromIndex(SLIDE_INDEX)
if (!disc.outlineReadable) throw new Error('workshop-generate requires a readable receipt-selected native Slide Spec')
if (SLIDE_INDEX) log(`Discover: deterministic slide index (${disc.slides.length} slides, ${disc.sectionOrder.length} groups) — no LLM Discover`)

// Group slides by Section, in sectionOrder. Section id = its index in sectionOrder (stable for onlyChecks).
const sectionList = disc.sectionOrder.map((key, idx) => ({
  id: String(idx), key, slides: disc.slides.filter(s => s.section === key).sort((a, b) => Number(a.num) - Number(b.num)),
})).filter(sec => sec.slides.length)
const targets = ONLY ? sectionList.filter(s => ONLY.has(s.id)) : sectionList
log(`${disc.slides.length} slide(s) in ${sectionList.length} section(s); generating ${targets.length} section(s)${ONLY ? ` (re-run ${ONLY.size})` : ''}`)

// ── Phase 2: Sections (one agent per section, parallel — writes the whole subsection to files) ─
phase('Sections')
const liveSecs = (await parallel(targets.map(sec => () => {
  const rows = sec.slides.map(s => `  - Slide ${s.num}: takeaway="${s.takeaway}"; bullets="${s.bullets}"; inventory=[${(s.inventory || []).join(', ')}]; visual="${s.visual}"; notes="${s.notes}"`).join('\n')
  const allowed = [...new Set(sec.slides.flatMap(s => s.inventory || []))]
  return agent(
    `TASK section-${sec.id}: ${sec.key}
You are a workshop SECTION generator. Produce the Typst for an ENTIRE subsection — ALL of its slides, in order — from their PINNED specs, and WRITE them to two fragment files. The "what" is fixed by the rows; you render them as Touying Typst (keeping the section's flow coherent across its slides) and cite ONLY the listed inventory ids. Do NOT invent slides, content, or visuals beyond the specs.
Set section="${sec.id}" verbatim.

SECTION: ${sec.key}   (${sec.slides.length} slides, numbers ${sec.slides.map(s => s.num).join(', ')})
Allowed inventory ids across this section (look them up in ${disc.sourcesPath}): ${allowed.join(', ')}${disc.paperPath ? `\nGround every number/claim in the paper at ${disc.paperPath}.` : ''}

Per-slide specs (one \`=== takeaway\` + \`#slide[...]\` block each, IN THIS ORDER):
${rows}

Typst conventions: each slide is \`=== <takeaway sentence>\` then \`#slide[ ... ]\`; body bullets with \`-\`; a calculated number MUST be a \`calc\` expression; if a slide's Visual names a figure, reference the inventory figure / build the named diagram (cetz.canvas from the theme, min length 2em, \`// Storytelling:\` comment); if "none", text-only. Keep the section's narrative flowing across its slides (transitions between consecutive slides). Do NOT include imports or the \`==\` section heading inside the blocks (assembly adds the heading) — but DO emit the slides in order.

WRITE two files (mkdir -p ${disc.fragmentsDir} first):
- ${disc.fragmentsDir}/section-${sec.id}.typ — ALL this section's \`=== ...\` + \`#slide[...]\` blocks, in order (NO file header, NO \`==\` heading).
- ${disc.fragmentsDir}/notes-section-${sec.id}.typ — flowing speaker-notes for this section (one block per slide, with timing from each slide's Notes). Write PLAIN Typst prose + bullets ONLY — NO custom note macros (do NOT invent \`#slide-notes\`/\`#speaker-note\`/etc.; assembly adds the \`= Section\` heading + the standard notes preamble, and the gate now COMPILES notes.typ, so an invented macro breaks the build).
GROUND citedInventory IN THE FILE (not memory): after writing, run \`grep -ohE '[FTRA][0-9]+' ${disc.fragmentsDir}/section-${sec.id}.typ | sort -u\` and set citedInventory to EXACTLY that grep output — the actual inventory ids present in the fragment you wrote. (The gate checks this ⊆ the allowed set; a memory-reported list that disagrees with the file is the fidelity bug this step closes.)
Return SECTION_SCHEMA: slidesPath, notesPath, slideNums (must equal ${JSON.stringify(sec.slides.map(s => s.num))}), citedInventory (the grep result, ⊆ the allowed set), summary.`,
    { label: `section:${sec.id}`, phase: 'Sections', schema: SECTION_SCHEMA }
  ).then(secResult => {
    // Pipeline the independent probe onto this section's draft (no extra barrier): only probe a
    // section that actually reports a drafted fragment file.
    if (!secResult || secResult.status !== 'drafted' || !(secResult.slidesPath || '').trim()) return secResult
    return agent(
      `Run this EXACT command and report its output — do not inspect the file's content beyond running the command, do not reason about correctness, just grep and report: \`grep -ohE '[FTRA][0-9]+' ${secResult.slidesPath} | sort -u\`
Set section="${sec.id}" verbatim. tokens = the command's stdout, one token per line, verbatim (the command already sorts + dedupes — do not add/remove/reorder). Return PROBE_SCHEMA.`,
      { label: `section:${sec.id}:probe`, phase: 'Sections', schema: PROBE_SCHEMA, model: 'haiku', effort: 'low' }
    ).then(probe => ({ ...secResult, probedInventory: probe ? probe.tokens : null }))
  })
}))).filter(Boolean)
const secById = Object.fromEntries(liveSecs.map(s => [String(s.section), s]))
const allSecs = sectionList.map(s => secById[s.id] || (PRIOR.has(s.id) ? PRIOR.get(s.id) : null))
const haveAll = allSecs.every(Boolean)

// ── Phase 3: Assemble (concat section files in order, write + compile) ─────────
phase('Assemble')
let asm = null
if (haveAll) {
  const order = sectionList.map(s => ({ id: s.id, key: s.key,
    slidesFile: `${disc.fragmentsDir}/section-${s.id}.typ`, notesFile: `${disc.fragmentsDir}/notes-section-${s.id}.typ` }))
  const headerInstruction = disc.fileHeader
    ? `FILE HEADER (write to the top of slides.typ verbatim):\n${disc.fileHeader}`
    : `FILE HEADER: none was pre-resolved — CONSTRUCT a compilable slides.typ preamble yourself: \`#import "templates/theme.typ": *\`, the \`#show: university-theme.with(...)\` block with \`config-info(...)\` populated from ${disc.sourcesPath} metadata (title/subtitle/authors/affiliations) and **\`qr: none\` (REQUIRED — the theme expects this field)**, the standard \`#show\`/\`#set\` rules, then \`#title-slide()\`. Read presentation/templates/ + any existing presentation/slides.typ preamble first; reuse it if present.`
  asm = await agent(
    `TASK assemble: deck and notes assembly
You are the workshop deck assembler. Build slides.typ + notes.typ by CONCATENATING the per-section fragment files (already written) under their Section headers, then COMPILE. Do NOT rewrite content — only concatenate, emit the \`=\`/\`==\` heading once per section, and fix compile-blocking syntax.

${headerInstruction}

SECTION ORDER (each slidesFile/notesFile exists; cat them in this order; emit each section's \`=\` Part / \`==\` subsection heading once before its slides):
${JSON.stringify(order)}

Steps (use Bash to cat the files — do NOT paste content from memory):
1. Write ${disc.slidesPath}: the header, then for each section in order emit its heading + \`cat\` its slidesFile.
2. Write ${disc.notesPath}: the notes preamble, then per section a \`= Section\` heading + \`cat\` its notesFile.
3. Compile: \`tinymist compile ${disc.slidesPath}\` (or \`typst compile\`) AND the notes deck \`tinymist compile ${disc.notesPath}\` (notes are a first-class deliverable, gated — NOT slides-only), from ${PROJECT}; fix ONLY compile-blocking syntax and recompile each. Set compiled/compileError for slides and notesCompiled/notesCompileError for notes. Do NOT invent note macros (e.g. #slide-notes/#speaker-note) to force notes to compile — notes use plain \`=\`/\`==\` headings + prose; an undefined-macro reference is a fragment bug to surface in notesCompileError, not to paper over with a defensive alias.
Return ASSEMBLE_SCHEMA.`,
    { label: 'assemble', phase: 'Assemble', schema: ASSEMBLE_SCHEMA })
}

// ── Phase 4: Gate (pure JS — every section written AND the deck compiles) ──────
phase('Gate')
const rows = []
const findings = []
for (const sec of sectionList) {
  const f = secById[sec.id] || (PRIOR.has(sec.id) ? PRIOR.get(sec.id) : null)
  const drafted = !!f && f.status === 'drafted' && !!(f.slidesPath || '').trim()
  const expected = new Set(sec.slides.map(s => String(s.num)))
  const wrote = new Set((f?.slideNums || []).map(String))
  const completeSlides = drafted && [...expected].every(n => wrote.has(n))
  const allowed = new Set(sec.slides.flatMap(s => (s.inventory || []).map(String)))
  // Trust the INDEPENDENT probe's grepped tokens over the section agent's self-reported citedInventory
  // when a probe ran (gateProbe doctrine) — self-report is not ground truth. Fall back to the
  // self-report only when no probe result exists (e.g. a carried PRIOR review from before this fix).
  const citedTokens = (f && Array.isArray(f.probedInventory)) ? f.probedInventory : (f?.citedInventory || [])
  const fidelityOk = !f || citedTokens.every(id => allowed.has(String(id)))
  rows.push({ section: sec.id, key: sec.key, slideCount: sec.slides.length, drafted, completeSlides, fidelityOk })
  if (!drafted) findings.push({ severity: 'critical', section: sec.id, detail: `Section "${sec.key}": fragment not produced (status=${f ? f.status : 'missing'})` })
  else if (!completeSlides) findings.push({ severity: 'major', section: sec.id, detail: `Section "${sec.key}": missing slides ${[...expected].filter(n => !wrote.has(n)).join(', ')}` })
  if (f && !fidelityOk) findings.push({ severity: 'major', section: sec.id, detail: `Section "${sec.key}": cited inventory outside its slides' allowed ids` })
}
const compiled = !!asm && asm.compiled === true
const notesCompiled = !!asm && asm.notesCompiled === true
if (haveAll && !compiled) findings.push({ severity: 'critical', section: 'deck', detail: `slides.typ did not compile: ${(asm?.compileError || 'unknown').slice(0, 300)}` })
// notes.typ is a first-class teleprompter deliverable — gate it, don't ship malformed notes (opv-parity).
if (haveAll && compiled && !notesCompiled) findings.push({ severity: 'critical', section: 'deck', detail: `notes.typ did not compile: ${(asm?.notesCompileError || 'unknown').slice(0, 300)}` })
if (!haveAll) findings.push({ severity: 'critical', section: 'deck', detail: 'Not all sections have fragments — assembly skipped' })
findings.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])

const allDrafted = rows.length > 0 && rows.every(r => r.drafted && r.completeSlides && r.fidelityOk)
const overallPass = allDrafted && compiled && notesCompiled
const verdict = overallPass ? 'GENERATED (compiles)' : 'GAPS'
const scoreTable = [
  '| Section | Slides | Fragment | Complete | Inventory-fidelity |',
  '|---------|--------|----------|----------|--------------------|',
  ...rows.map(r => `| ${r.key.slice(0, 28)} | ${r.slideCount} | ${r.drafted ? '✅' : '❌'} | ${r.completeSlides ? '✅' : '❌'} | ${r.fidelityOk ? '✅' : '❌'} |`),
  `| **Deck** | slides / notes compile | ${compiled ? '✅' : '❌'} / ${notesCompiled ? '✅' : '❌'} | | ${overallPass ? '✅ GENERATED' : '❌ GAPS'} |`,
].join('\n')

log(overallPass
  ? `✅ workshop-generate: ${rows.length} section(s) generated + deck compiles — SKILL now runs workshop-verify (per-slide review) under /goal`
  : `❌ workshop-generate: ${findings.length} finding(s); fix + re-invoke onlyChecks=sectionsThatFailed`)

return {
  // Entry hashes. This script cannot re-stat anything, so the verdict is provisional
  // until the deterministic post-step (`workshop_plan_auth.py --verify --findings`)
  // re-snapshots the receipt + plan, zeroes finalPlanHash on drift, appends the critical
  // artifact-integrity finding, and forces the gate false. verifyRequired announces that.
  finalPlanHash: AUTH.planSnapshot.hash,
  verifyRequired: true,
  driftVerified: false,
  overallPass, verdict, compiled, notesCompiled, scoreTable,
  sections: rows,
  findings,
  sectionsThatFailed: rows.filter(r => !r.drafted || !r.completeSlides || !r.fidelityOk).map(r => r.section),
  assembledPaths: { slides: disc.slidesPath, notes: disc.notesPath, pdf: asm?.slidesPdf || '' },
  reviews: liveSecs,
}
