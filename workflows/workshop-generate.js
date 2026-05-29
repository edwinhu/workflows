export const meta = {
  name: 'workshop-generate',
  description: "workshop Phase-3 slide+notes generation as a dynamic TRANSFORM workflow: read the approved per-slide Slide Spec table, fan out one fragment-agent per slide (each builds its `#slide[...]` block + speaker-notes block from the PINNED Takeaway/Bullets/Inventory/Visual + the paper, citing ONLY its inventory IDs), then a single assembly agent stitches the fragments under their Section headers into slides.typ + notes.typ and COMPILES the deck. The 'what' comes from the Slide Spec row; the agent adds only Typst rendering + the pinned visual. Gate = every slide fragment produced AND the assembled deck compiles, computed in JS. Deep per-slide review remains workshop-verify's job (Phase 4).",
  whenToUse: "Called by the workshop skill in Phase 3 (after OUTLINE_APPROVED.md) to generate slides.typ + notes.typ. Returns { overallPass, slides, compiled, findings, slidesThatFailed, assembledPaths, reviews }. The skill then runs workshop-verify (the per-slide review fan-out) under /goal. On a re-run it passes onlyChecks (failed slide ids) + priorReviews. The workflow never reviews content quality — only that each slide was generated from its spec and the deck compiles.",
  phases: [
    { title: 'Discover', detail: 'read the Slide Spec table + SOURCES inventory + paper path + theme header' },
    { title: 'Fragments', detail: 'one fragment-agent per slide (parallel) — build its #slide[] block + notes block from the pinned row, citing only its inventory IDs' },
    { title: 'Assemble', detail: 'one agent stitches fragments under Section headers into slides.typ + notes.typ and compiles the deck' },
    { title: 'Gate', detail: 'every slide fragment produced AND the deck compiles — computed in JS' },
  ],
}

// args = { projectDir (REQUIRED — presentation project root), pluginRoot?, onlyChecks?: ["2"], priorReviews?: [...] }
let cfg = args
if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch { cfg = {} } }
cfg = cfg || {}
const PROJECT = cfg.projectDir
if (!PROJECT) throw new Error(`workshop-generate requires args.projectDir. Got "${typeof args}": ${JSON.stringify(args)?.slice(0, 200)}`)
const PLUGIN = cfg.pluginRoot || ''
const ONLY = Array.isArray(cfg.onlyChecks) && cfg.onlyChecks.length ? new Set(cfg.onlyChecks.map(String)) : null
const PRIOR = new Map((Array.isArray(cfg.priorReviews) ? cfg.priorReviews : []).map(s => [String(s.slide), s]))

const SLIDE = {
  type: 'object', additionalProperties: false,
  required: ['num', 'section', 'takeaway', 'bullets', 'inventory', 'visual', 'notes'],
  properties: {
    num: { type: 'string' }, section: { type: 'string', description: 'the `=` Part + `==` subsection this slide sits under (assembly grouping key)' },
    takeaway: { type: 'string' }, bullets: { type: 'string' },
    inventory: { type: 'array', items: { type: 'string' }, description: 'F/T/R/A ids this slide may cite' },
    visual: { type: 'string', description: 'figure/diagram to render, or "none"' }, notes: { type: 'string' },
  },
}
const DISCOVERY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['outlineReadable', 'sourcesPath', 'paperPath', 'slidesPath', 'notesPath', 'fileHeader', 'sectionOrder', 'slides'],
  properties: {
    outlineReadable: { type: 'boolean', description: 'true iff OUTLINE.md has a parseable Slide Spec table' },
    sourcesPath: { type: 'string' }, paperPath: { type: 'string', description: 'source paper path (for grounding), or ""' },
    slidesPath: { type: 'string', description: 'absolute target for slides.typ' }, notesPath: { type: 'string', description: 'absolute target for notes.typ' },
    fileHeader: { type: 'string', description: 'the slides.typ preamble (import theme + #show + config-info incl qr:none) from the template — assembly prepends this verbatim' },
    sectionOrder: { type: 'array', items: { type: 'string' }, description: 'distinct Section keys in presentation order (assembly groups slides under these)' },
    slides: { type: 'array', items: SLIDE },
  },
}
const FRAGMENT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['slide', 'status', 'slideBlock', 'notesBlock', 'citedInventory', 'summary'],
  properties: {
    slide: { type: 'string' }, status: { type: 'string', enum: ['drafted', 'error'] },
    slideBlock: { type: 'string', description: 'the complete `=== takeaway\\n#slide[ ... ]` Typst block for this slide (NO file header, NO section heading — assembly adds those)' },
    notesBlock: { type: 'string', description: 'the speaker-notes block for this slide (flowing prose + timing), under its section' },
    citedInventory: { type: 'array', items: { type: 'string' }, description: 'the inventory ids actually cited (must be ⊆ the slide\'s allowed ids)' },
    summary: { type: 'string' },
  },
}
const ASSEMBLE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['slidesWritten', 'notesWritten', 'compiled', 'compileError', 'slidesPdf'],
  properties: {
    slidesWritten: { type: 'boolean' }, notesWritten: { type: 'boolean' },
    compiled: { type: 'boolean', description: 'did slides.typ compile to PDF (tinymist/typst exit 0)?' },
    compileError: { type: 'string', description: 'compiler error tail if compiled=false, else ""' },
    slidesPdf: { type: 'string', description: 'path to the produced slides.pdf, or ""' },
  },
}

// ── Phase 1: Discover ─────────────────────────────────────────────────────────
phase('Discover')
const disc = await agent(
  `Read the approved workshop Slide Spec and prepare for fragment generation. Working directory: ${PROJECT}

1. Read ${PROJECT}/.planning/OUTLINE.md. If it has no Slide Spec table (columns Slide | Section | Takeaway | Bullets | Inventory | Visual | Notes), set outlineReadable=false. For each row, extract a slide: num, section (the `=` Part + `==` subsection text), takeaway, bullets, inventory (the F/T/R/A ids), visual, notes.
2. sourcesPath = ${PROJECT}/.planning/SOURCES.md ; paperPath = the source-paper path from SOURCES.md (or "").
3. slidesPath = ${PROJECT}/presentation/slides.typ ; notesPath = ${PROJECT}/presentation/notes.typ (adjust if the project uses a different presentation dir — check for an existing presentation/ or slides.typ).
4. fileHeader = the slides.typ preamble: the \`#import "templates/theme.typ": *\`, any #show rules, and the config-info block (title/authors/venue/date + qr: none) — read presentation/templates/ + any existing slides.typ header, or reconstruct from the SOURCES.md metadata. Assembly will prepend this verbatim, so it MUST be a compilable preamble.
5. sectionOrder = the distinct Section keys in presentation order (the order Parts/subsections appear in the table).

Return DISCOVERY_SCHEMA with absolute paths.`,
  { label: 'discover', phase: 'Discover', schema: DISCOVERY_SCHEMA, model: 'sonnet' }
)
if (!disc.outlineReadable) throw new Error(`workshop-generate: ${PROJECT}/.planning/OUTLINE.md has no Slide Spec table. Phase 2 + workshop-outline-executable-guard must produce one before generation.`)
const bySlide = Object.fromEntries(disc.slides.map(s => [String(s.num), s]))
const targets = ONLY ? disc.slides.filter(s => ONLY.has(String(s.num))) : disc.slides
log(`${disc.slides.length} slide(s) across ${disc.sectionOrder.length} section(s); generating ${targets.length}${ONLY ? ` (re-run ${ONLY.size})` : ''}`)

// ── Phase 2: Fragments (one read-only-ish agent per slide, parallel — returns block TEXT) ─
phase('Fragments')
const liveFrags = (await parallel(targets.map(s => () => agent(
  `You are a workshop slide fragment generator. Produce the Typst for EXACTLY ONE slide from its PINNED spec. The "what" is fixed by the row — you only render it as Touying Typst + the named visual. Do NOT invent content, claims, or visuals not in the spec, and cite ONLY this slide's inventory ids.
Set slide="${s.num}" verbatim.

SLIDE ${s.num} — Section: ${s.section}
Takeaway (this is the \`===\` title, a full sentence): ${s.takeaway}
Bullets (expand each \`;\`-separated point to one body bullet — NOT prose): ${s.bullets}
Allowed inventory ids (cite ONLY these; look them up in ${disc.sourcesPath} for the exact figure/number/claim): ${(s.inventory || []).join(', ')}
Visual: ${s.visual}${disc.paperPath ? `\nGround every number/claim in the paper at ${disc.paperPath} (read the relevant part) — do not hallucinate.` : ''}

Typst conventions: \`=== <takeaway sentence>\` then \`#slide[ ... ]\`; body bullets with \`-\`; a calculated number MUST be a \`calc\` expression, never a typed literal; if Visual names a figure, reference the inventory figure / build the named diagram (cetz.canvas from the theme, min length 2em, with a \`// Storytelling:\` comment); if Visual is "none", text-only. Produce a block that will compile once assembled under the file header (do NOT include imports or the \`==\` section heading — assembly adds those).

Return FRAGMENT_SCHEMA: slideBlock (the \`=== ...\\n#slide[...]\` text), notesBlock (flowing speaker-notes prose for this slide + the timing from the spec's Notes), citedInventory (⊆ the allowed ids), summary.`,
  { label: `slide:${s.num}`, phase: 'Fragments', schema: FRAGMENT_SCHEMA, model: 'sonnet' }))) ).filter(Boolean)
const fragBySlide = Object.fromEntries(liveFrags.map(f => [String(f.slide), f]))

// Carry prior fragments for slides not regenerated this run (selective re-run).
const allFrags = disc.slides.map(s => fragBySlide[String(s.num)] || (PRIOR.has(String(s.num)) ? PRIOR.get(String(s.num)) : null))
const haveAll = allFrags.every(Boolean)

// ── Phase 3: Assemble (one agent — stitch fragments under Section headers, write + compile) ─
phase('Assemble')
let asm = null
if (haveAll) {
  // Order slides by sectionOrder then slide number; group the slideBlocks under their `==` headers.
  const ordered = [...disc.slides].sort((a, b) =>
    (disc.sectionOrder.indexOf(a.section) - disc.sectionOrder.indexOf(b.section)) || (Number(a.num) - Number(b.num)))
  const manifest = ordered.map(s => ({ num: s.num, section: s.section, slideBlock: fragBySlide[String(s.num)]?.slideBlock ?? PRIOR.get(String(s.num))?.slideBlock ?? '', notesBlock: fragBySlide[String(s.num)]?.notesBlock ?? PRIOR.get(String(s.num))?.notesBlock ?? '' }))
  asm = await agent(
    `You are the workshop deck assembler. Write slides.typ + notes.typ from the fragments below and COMPILE. Do NOT rewrite slide content — only stitch, add section headers, and fix compile-blocking syntax.

FILE HEADER (prepend to slides.typ verbatim):
${disc.fileHeader}

Slides in final order (each block is already written — place it under its Section's \`=\`/\`==\` headers, emitting each distinct Section heading once, in order):
${JSON.stringify(manifest).slice(0, 12000)}

Steps:
1. Write ${disc.slidesPath}: the file header, then for each Section (in order) emit its \`= Part\` / \`== subsection\` heading once, then that section's slideBlocks in order.
2. Write ${disc.notesPath}: the notes preamble + per-section notesBlocks (one \`= Section\` heading each, with the timing target).
3. Compile: \`tinymist compile ${disc.slidesPath}\` (or \`typst compile\`) from ${PROJECT}. If it fails, fix ONLY compile-blocking syntax (imports, brackets, the qr:none config) — do not alter slide content — and recompile.
Return ASSEMBLE_SCHEMA with slidesWritten, notesWritten, compiled (real exit 0), compileError (tail if failed), slidesPdf path.`,
    { label: 'assemble', phase: 'Assemble', schema: ASSEMBLE_SCHEMA, model: 'sonnet' })
}

// ── Phase 4: Gate (pure JS — every slide fragment produced AND the deck compiles) ─
phase('Gate')
const rows = []
const findings = []
for (const s of disc.slides) {
  const f = fragBySlide[String(s.num)] || (PRIOR.has(String(s.num)) ? PRIOR.get(String(s.num)) : null)
  const drafted = !!f && f.status === 'drafted' && !!(f.slideBlock || '').trim()
  const allowed = new Set((s.inventory || []).map(String))
  const cited = (f?.citedInventory || [])
  const fidelityOk = !f || cited.every(id => allowed.has(String(id)))   // cited ⊆ allowed (no invented refs)
  rows.push({ slide: s.num, section: s.section, drafted, fidelityOk })
  if (!drafted) findings.push({ severity: 'critical', slide: s.num, detail: `Slide ${s.num}: fragment not produced (status=${f ? f.status : 'missing'})` })
  if (f && !fidelityOk) findings.push({ severity: 'major', slide: s.num, detail: `Slide ${s.num}: cited inventory outside its allowed ids (${cited.filter(id => !allowed.has(String(id))).join(', ')})` })
}
const compiled = !!asm && asm.compiled === true
if (haveAll && !compiled) findings.push({ severity: 'critical', slide: 'deck', detail: `Deck did not compile: ${(asm?.compileError || 'unknown').slice(0, 300)}` })
if (!haveAll) findings.push({ severity: 'critical', slide: 'deck', detail: 'Not all slides have fragments — assembly skipped' })
findings.sort((a, b) => ({ critical: 0, major: 1, minor: 2 }[a.severity] - { critical: 0, major: 1, minor: 2 }[b.severity]))

const allDrafted = rows.length > 0 && rows.every(r => r.drafted && r.fidelityOk)
const overallPass = allDrafted && compiled
const verdict = overallPass ? 'GENERATED (compiles)' : 'GAPS'

const scoreTable = [
  '| Slide | Section | Fragment | Inventory-fidelity |',
  '|-------|---------|----------|--------------------|',
  ...rows.map(r => `| ${r.slide} | ${r.section.slice(0, 30)} | ${r.drafted ? '✅' : '❌'} | ${r.fidelityOk ? '✅' : '❌'} |`),
  `| **Deck** | compile | ${compiled ? '✅' : '❌'} | ${overallPass ? '✅ GENERATED' : '❌ GAPS'} |`,
].join('\n')

log(overallPass
  ? `✅ workshop-generate: ${rows.length} slide(s) generated + deck compiles — SKILL now runs workshop-verify (per-slide review) under /goal`
  : `❌ workshop-generate: ${findings.length} finding(s) (${rows.filter(r => !r.drafted).length} missing fragment, compile=${compiled}); fix + re-invoke onlyChecks=slidesThatFailed`)

return {
  overallPass,
  verdict,
  compiled,
  scoreTable,
  slides: rows,
  findings,
  slidesThatFailed: rows.filter(r => !r.drafted || !r.fidelityOk).map(r => r.slide),
  assembledPaths: { slides: disc.slidesPath, notes: disc.notesPath, pdf: asm?.slidesPdf || '' },
  reviews: liveFrags,   // pass as priorReviews on a selective re-run
}
