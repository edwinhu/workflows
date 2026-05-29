export const meta = {
  name: 'workshop-generate',
  description: "workshop Phase-3 slide+notes generation as a dynamic TRANSFORM workflow: read the approved per-slide Slide Spec table, fan out one fragment-agent per slide (each WRITES its `#slide[...]` block + speaker-notes block to a fragment FILE under .planning/slide-fragments/ — parallel-safe, like writing-draft's per-section files — from the PINNED Takeaway/Bullets/Inventory/Visual + the paper, citing ONLY its inventory IDs), then a single assembly agent CONCATENATES the fragment files under their Section headers into slides.typ + notes.typ and COMPILES the deck. The 'what' comes from the Slide Spec row; the agent adds only Typst rendering + the pinned visual. Gate = every slide fragment written AND the assembled deck compiles, computed in JS. Deep per-slide review remains workshop-verify's job (Phase 4).",
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
    fragmentsDir: { type: 'string', description: 'absolute scratch dir for per-slide fragment files (e.g. <project>/.planning/slide-fragments)' },
    sectionOrder: { type: 'array', items: { type: 'string' }, description: 'distinct Section keys in presentation order (assembly groups slides under these)' },
    slides: { type: 'array', items: SLIDE },
  },
}
// Each fragment-agent WRITES its slide+notes blocks to fragment files (like writing-draft's per-section
// files) — parallel-safe, no conflict — and assembly CONCATENATES the files. No big block text in prompts.
const FRAGMENT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['slide', 'status', 'slidePath', 'notesPath', 'citedInventory', 'summary'],
  properties: {
    slide: { type: 'string' }, status: { type: 'string', enum: ['drafted', 'error'] },
    slidePath: { type: 'string', description: 'absolute path of the slide-block file this agent wrote (fragmentsDir/slide-<n>.typ)' },
    notesPath: { type: 'string', description: 'absolute path of the notes-block file this agent wrote (fragmentsDir/notes-<n>.typ)' },
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
6. fragmentsDir = ${PROJECT}/.planning/slide-fragments (fragment-agents write one slide-<n>.typ + notes-<n>.typ here; assembly concatenates them).

Return DISCOVERY_SCHEMA with absolute paths.`,
  { label: 'discover', phase: 'Discover', schema: DISCOVERY_SCHEMA, model: 'sonnet' }
)
if (!disc.outlineReadable) throw new Error(`workshop-generate: ${PROJECT}/.planning/OUTLINE.md has no Slide Spec table. Phase 2 + workshop-outline-executable-guard must produce one before generation.`)
const bySlide = Object.fromEntries(disc.slides.map(s => [String(s.num), s]))
const targets = ONLY ? disc.slides.filter(s => ONLY.has(String(s.num))) : disc.slides
log(`${disc.slides.length} slide(s) across ${disc.sectionOrder.length} section(s); generating ${targets.length}${ONLY ? ` (re-run ${ONLY.size})` : ''}`)

// ── Phase 2: Fragments (one agent per slide, parallel — each WRITES its block to a file) ─
phase('Fragments')
const liveFrags = (await parallel(targets.map(s => () => agent(
  `You are a workshop slide fragment generator. Produce the Typst for EXACTLY ONE slide from its PINNED spec and WRITE it to a fragment file. The "what" is fixed by the row — you only render it as Touying Typst + the named visual. Do NOT invent content, claims, or visuals not in the spec, and cite ONLY this slide's inventory ids.
Set slide="${s.num}" verbatim.

SLIDE ${s.num} — Section: ${s.section}
Takeaway (this is the \`===\` title, a full sentence): ${s.takeaway}
Bullets (expand each \`;\`-separated point to one body bullet — NOT prose): ${s.bullets}
Allowed inventory ids (cite ONLY these; look them up in ${disc.sourcesPath} for the exact figure/number/claim): ${(s.inventory || []).join(', ')}
Visual: ${s.visual}${disc.paperPath ? `\nGround every number/claim in the paper at ${disc.paperPath} (read the relevant part) — do not hallucinate.` : ''}

Typst conventions: \`=== <takeaway sentence>\` then \`#slide[ ... ]\`; body bullets with \`-\`; a calculated number MUST be a \`calc\` expression, never a typed literal; if Visual names a figure, reference the inventory figure / build the named diagram (cetz.canvas from the theme, min length 2em, with a \`// Storytelling:\` comment); if Visual is "none", text-only. Produce a block that will compile once assembled under the file header (do NOT include imports or the \`==\` section heading — assembly adds those).

WRITE two files (mkdir -p ${disc.fragmentsDir} first):
- ${disc.fragmentsDir}/slide-${s.num}.typ — the \`=== <takeaway>\` + \`#slide[...]\` block ONLY.
- ${disc.fragmentsDir}/notes-${s.num}.typ — flowing speaker-notes prose for this slide + the timing from the spec's Notes (NO section heading).
Return FRAGMENT_SCHEMA: slidePath + notesPath (the two files you wrote), citedInventory (⊆ the allowed ids), summary.`,
  { label: `slide:${s.num}`, phase: 'Fragments', schema: FRAGMENT_SCHEMA, model: 'sonnet' }))) ).filter(Boolean)
const fragBySlide = Object.fromEntries(liveFrags.map(f => [String(f.slide), f]))

// Carry prior fragments for slides not regenerated this run (selective re-run; their files persist on disk).
const allFrags = disc.slides.map(s => fragBySlide[String(s.num)] || (PRIOR.has(String(s.num)) ? PRIOR.get(String(s.num)) : null))
const haveAll = allFrags.every(Boolean)

// ── Phase 3: Assemble (one agent — stitch fragments under Section headers, write + compile) ─
phase('Assemble')
let asm = null
if (haveAll) {
  // Order slides by sectionOrder then slide number; the assembler CONCATENATES the fragment FILES
  // under their `=`/`==` headers — content lives on disk, not in this prompt.
  const ordered = [...disc.slides].sort((a, b) =>
    (disc.sectionOrder.indexOf(a.section) - disc.sectionOrder.indexOf(b.section)) || (Number(a.num) - Number(b.num)))
  const order = ordered.map(s => ({ num: s.num, section: s.section,
    slideFile: `${disc.fragmentsDir}/slide-${s.num}.typ`, notesFile: `${disc.fragmentsDir}/notes-${s.num}.typ` }))
  asm = await agent(
    `You are the workshop deck assembler. Build slides.typ + notes.typ by CONCATENATING the per-slide fragment files (already written) under their Section headers, then COMPILE. Do NOT rewrite slide content — only concatenate, emit section headings, and fix compile-blocking syntax.

FILE HEADER (write to the top of slides.typ verbatim):
${disc.fileHeader}

ORDER (each entry's slideFile/notesFile already exist on disk — cat them in this order; emit each distinct Section's \`=\`/\`==\` heading once, before its first slide):
${JSON.stringify(order)}

Steps (use Bash to read/concat the fragment files — do NOT paste their content from memory):
1. Write ${disc.slidesPath}: the file header, then for each Section in order emit its \`= Part\` / \`== subsection\` heading once, then \`cat\` that section's slideFiles in order.
2. Write ${disc.notesPath}: the notes preamble, then for each Section a \`= Section\` heading + \`cat\` its notesFiles in order.
3. Compile: \`tinymist compile ${disc.slidesPath}\` (or \`typst compile\`) from ${PROJECT}. If it fails, fix ONLY compile-blocking syntax (imports, brackets, qr:none) in the assembled file — do not alter slide content — and recompile.
Return ASSEMBLE_SCHEMA with slidesWritten, notesWritten, compiled (real exit 0), compileError (tail if failed), slidesPdf path.`,
    { label: 'assemble', phase: 'Assemble', schema: ASSEMBLE_SCHEMA, model: 'sonnet' })
}

// ── Phase 4: Gate (pure JS — every slide fragment produced AND the deck compiles) ─
phase('Gate')
const rows = []
const findings = []
for (const s of disc.slides) {
  const f = fragBySlide[String(s.num)] || (PRIOR.has(String(s.num)) ? PRIOR.get(String(s.num)) : null)
  const drafted = !!f && f.status === 'drafted' && !!(f.slidePath || '').trim()
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
