export const meta = {
  name: 'workshop-generate',
  description: "workshop Phase-3 slide+notes generation as an ultracode TRANSFORM workflow: read the approved per-slide Slide Spec table, group its slides by SECTION (the `=`/`==` heading), and fan out one agent per SECTION (each WRITES its whole subsection — every slide block + its notes — to a section fragment FILE under .planning/slide-fragments/, from the PINNED Slide Spec rows + the paper, citing ONLY the allowed inventory IDs). A single assembly agent then CONCATENATES the section files in order into slides.typ + notes.typ and COMPILES the deck. Section is the right unit — slide-level is too granular (loses intra-section flow), whole-deck too coarse. Gate = every section fragment written AND the deck compiles, in JS. Deep per-slide review remains workshop-verify's job (Phase 4).",
  whenToUse: "Called by the workshop skill in Phase 3 (after OUTLINE_APPROVED.md) to generate slides.typ + notes.typ. Returns { overallPass, sections, compiled, findings, sectionsThatFailed, assembledPaths, reviews }. The skill then runs workshop-verify under /goal. On a re-run it passes onlyChecks (failed section ids) + priorReviews. The workflow never reviews content quality — only that each section is generated from its specs and the deck compiles.",
  phases: [
    { title: 'Discover', detail: 'read the Slide Spec table + SOURCES inventory + paper + theme header; group slides by Section' },
    { title: 'Sections', detail: 'one agent per SECTION (parallel) — write the whole subsection (all its slide blocks + notes) to a fragment file from the pinned rows' },
    { title: 'Assemble', detail: 'one agent concatenates the section files in order into slides.typ + notes.typ and compiles the deck' },
    { title: 'Gate', detail: 'every section fragment written AND the deck compiles — computed in JS' },
  ],
}

let cfg = args
if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch { cfg = {} } }
cfg = cfg || {}
const PROJECT = cfg.projectDir
if (!PROJECT) throw new Error(`workshop-generate requires args.projectDir. Got "${typeof args}": ${JSON.stringify(args)?.slice(0, 200)}`)
const PLUGIN = cfg.pluginRoot || ''
const ONLY = Array.isArray(cfg.onlyChecks) && cfg.onlyChecks.length ? new Set(cfg.onlyChecks.map(String)) : null
const PRIOR = new Map((Array.isArray(cfg.priorReviews) ? cfg.priorReviews : []).map(s => [String(s.section), s]))

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
const ASSEMBLE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['slidesWritten', 'notesWritten', 'compiled', 'compileError', 'slidesPdf'],
  properties: {
    slidesWritten: { type: 'boolean' }, notesWritten: { type: 'boolean' },
    compiled: { type: 'boolean' }, compileError: { type: 'string' }, slidesPdf: { type: 'string' },
  },
}

// ── Phase 1: Discover ─────────────────────────────────────────────────────────
phase('Discover')
const disc = await agent(
  `Read the approved workshop Slide Spec and prepare for SECTION-level generation. Working directory: ${PROJECT}

1. Read ${PROJECT}/.planning/OUTLINE.md. If it has no Slide Spec table (columns Slide | Section | Takeaway | Bullets | Inventory | Visual | Notes), set outlineReadable=false. For each row extract a slide: num, section (the `=` Part + `==` subsection text — the grouping key), takeaway, bullets, inventory, visual, notes.
2. sourcesPath = ${PROJECT}/.planning/SOURCES.md ; paperPath = the source-paper path from SOURCES.md (or "").
3. slidesPath = ${PROJECT}/presentation/slides.typ ; notesPath = ${PROJECT}/presentation/notes.typ (adjust if the project uses a different presentation dir).
4. fileHeader = the slides.typ preamble (import theme + #show + config-info incl qr:none) — read presentation/templates/ + any existing header, or reconstruct from SOURCES.md metadata. Must be a compilable preamble.
5. fragmentsDir = ${PROJECT}/.planning/slide-fragments .
6. sectionOrder = the distinct Section keys in presentation order.

Return DISCOVERY_SCHEMA with absolute paths.`,
  { label: 'discover', phase: 'Discover', schema: DISCOVERY_SCHEMA, model: 'sonnet' }
)
if (!disc.outlineReadable) throw new Error(`workshop-generate: ${PROJECT}/.planning/OUTLINE.md has no Slide Spec table. Phase 2 + workshop-outline-executable-guard must produce one first.`)

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
    `You are a workshop SECTION generator. Produce the Typst for an ENTIRE subsection — ALL of its slides, in order — from their PINNED specs, and WRITE them to two fragment files. The "what" is fixed by the rows; you render them as Touying Typst (keeping the section's flow coherent across its slides) and cite ONLY the listed inventory ids. Do NOT invent slides, content, or visuals beyond the specs.
Set section="${sec.id}" verbatim.

SECTION: ${sec.key}   (${sec.slides.length} slides, numbers ${sec.slides.map(s => s.num).join(', ')})
Allowed inventory ids across this section (look them up in ${disc.sourcesPath}): ${allowed.join(', ')}${disc.paperPath ? `\nGround every number/claim in the paper at ${disc.paperPath}.` : ''}

Per-slide specs (one \`=== takeaway\` + \`#slide[...]\` block each, IN THIS ORDER):
${rows}

Typst conventions: each slide is \`=== <takeaway sentence>\` then \`#slide[ ... ]\`; body bullets with \`-\`; a calculated number MUST be a \`calc\` expression; if a slide's Visual names a figure, reference the inventory figure / build the named diagram (cetz.canvas from the theme, min length 2em, \`// Storytelling:\` comment); if "none", text-only. Keep the section's narrative flowing across its slides (transitions between consecutive slides). Do NOT include imports or the \`==\` section heading inside the blocks (assembly adds the heading) — but DO emit the slides in order.

WRITE two files (mkdir -p ${disc.fragmentsDir} first):
- ${disc.fragmentsDir}/section-${sec.id}.typ — ALL this section's \`=== ...\` + \`#slide[...]\` blocks, in order (NO file header, NO \`==\` heading).
- ${disc.fragmentsDir}/notes-section-${sec.id}.typ — flowing speaker-notes for this section (one block per slide, with timing from each slide's Notes).
Return SECTION_SCHEMA: slidesPath, notesPath, slideNums (must equal ${JSON.stringify(sec.slides.map(s => s.num))}), citedInventory (⊆ the allowed set), summary.`,
    { label: `section:${sec.id}`, phase: 'Sections', schema: SECTION_SCHEMA, model: 'sonnet' })
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
  asm = await agent(
    `You are the workshop deck assembler. Build slides.typ + notes.typ by CONCATENATING the per-section fragment files (already written) under their Section headers, then COMPILE. Do NOT rewrite content — only concatenate, emit the \`=\`/\`==\` heading once per section, and fix compile-blocking syntax.

FILE HEADER (write to the top of slides.typ verbatim):
${disc.fileHeader}

SECTION ORDER (each slidesFile/notesFile exists; cat them in this order; emit each section's \`=\` Part / \`==\` subsection heading once before its slides):
${JSON.stringify(order)}

Steps (use Bash to cat the files — do NOT paste content from memory):
1. Write ${disc.slidesPath}: the header, then for each section in order emit its heading + \`cat\` its slidesFile.
2. Write ${disc.notesPath}: the notes preamble, then per section a \`= Section\` heading + \`cat\` its notesFile.
3. Compile: \`tinymist compile ${disc.slidesPath}\` (or \`typst compile\`) from ${PROJECT}; fix ONLY compile-blocking syntax and recompile.
Return ASSEMBLE_SCHEMA.`,
    { label: 'assemble', phase: 'Assemble', schema: ASSEMBLE_SCHEMA, model: 'sonnet' })
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
  const fidelityOk = !f || (f.citedInventory || []).every(id => allowed.has(String(id)))
  rows.push({ section: sec.id, key: sec.key, slideCount: sec.slides.length, drafted, completeSlides, fidelityOk })
  if (!drafted) findings.push({ severity: 'critical', section: sec.id, detail: `Section "${sec.key}": fragment not produced (status=${f ? f.status : 'missing'})` })
  else if (!completeSlides) findings.push({ severity: 'major', section: sec.id, detail: `Section "${sec.key}": missing slides ${[...expected].filter(n => !wrote.has(n)).join(', ')}` })
  if (f && !fidelityOk) findings.push({ severity: 'major', section: sec.id, detail: `Section "${sec.key}": cited inventory outside its slides' allowed ids` })
}
const compiled = !!asm && asm.compiled === true
if (haveAll && !compiled) findings.push({ severity: 'critical', section: 'deck', detail: `Deck did not compile: ${(asm?.compileError || 'unknown').slice(0, 300)}` })
if (!haveAll) findings.push({ severity: 'critical', section: 'deck', detail: 'Not all sections have fragments — assembly skipped' })
findings.sort((a, b) => ({ critical: 0, major: 1, minor: 2 }[a.severity] - { critical: 0, major: 1, minor: 2 }[b.severity]))

const allDrafted = rows.length > 0 && rows.every(r => r.drafted && r.completeSlides && r.fidelityOk)
const overallPass = allDrafted && compiled
const verdict = overallPass ? 'GENERATED (compiles)' : 'GAPS'
const scoreTable = [
  '| Section | Slides | Fragment | Complete | Inventory-fidelity |',
  '|---------|--------|----------|----------|--------------------|',
  ...rows.map(r => `| ${r.key.slice(0, 28)} | ${r.slideCount} | ${r.drafted ? '✅' : '❌'} | ${r.completeSlides ? '✅' : '❌'} | ${r.fidelityOk ? '✅' : '❌'} |`),
  `| **Deck** | compile | ${compiled ? '✅' : '❌'} | | ${overallPass ? '✅ GENERATED' : '❌ GAPS'} |`,
].join('\n')

log(overallPass
  ? `✅ workshop-generate: ${rows.length} section(s) generated + deck compiles — SKILL now runs workshop-verify (per-slide review) under /goal`
  : `❌ workshop-generate: ${findings.length} finding(s); fix + re-invoke onlyChecks=sectionsThatFailed`)

return {
  overallPass, verdict, compiled, scoreTable,
  sections: rows,
  findings,
  sectionsThatFailed: rows.filter(r => !r.drafted || !r.completeSlides || !r.fidelityOk).map(r => r.section),
  assembledPaths: { slides: disc.slidesPath, notes: disc.notesPath, pdf: asm?.slidesPdf || '' },
  reviews: liveSecs,
}
