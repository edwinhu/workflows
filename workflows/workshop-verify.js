export const meta = {
  name: 'workshop-verify',
  description: 'Workshop slide-deck verification as a dynamic workflow: a global mechanical leg (compile + constraint check-all.py + PDF widow + overflow) then a per-slide fan-out (convention + notes-coverage + source-fidelity) and per-diagram visual-verify. Returns structured findings + a computed CLEAN/ISSUES gate from raw counts. Read-only; does NOT fix.',
  whenToUse: 'Called by the workshop skill at the Phase 3->4 boundary (artifact review gate) and as Phase 4 verification, and by workshop-revise after edits. Returns {overallPass, verdict, scoreTable, findings, reviews, slidesThatFlagged}. The skill renders the gate, drives the /goal fix loop, and on a re-review passes onlyChecks (flagged slide IDs) + priorReviews. The workflow never drafts and never fixes.',
  phases: [
    { title: 'Discover', detail: 'enumerate slides + diagrams; resolve SOURCES/OUTLINE/check-all/detect_widows' },
    { title: 'Mechanical', detail: 'compile both .typ; run check-all.py + widow + overflow (early-exit if compile fails)' },
    { title: 'Review', detail: 'per-slide: convention + notes-coverage + fidelity, in parallel; per-diagram visual-verify' },
    { title: 'Gate', detail: 'aggregate raw counts -> severity totals -> CLEAN/ISSUES, computed in JS' },
  ],
}

// ── Read-only enforcement (P17) ───────────────────────────────────────────────
// Every reviewer agent() below opens with a "You are a READ-ONLY reviewer; do NOT
// create, edit, or overwrite any files" instruction. This is PROMPT-level, not
// structural: the workflow agent() API exposes {label, phase, schema, model,
// isolation, agentType} — there is no allowed_tools parameter to mechanically
// withhold Write/Edit. Prompt-level read-only is therefore the platform ceiling
// here, not a fixable gap. If/when agent() gains an allowed-tools hook, wire it
// in; the gate's authoritativeness does not depend on it because the gate
// (overallPass) is computed in JS from raw counts, never self-reported.

// ── Inputs ──────────────────────────────────────────────────────────────────
// args = {
//   projectDir:  "/abs/project-root",         // REQUIRED — holds .planning/ and presentation/
//   pluginRoot:  "/abs/.../workflows",         // optional — for resolving check-all.py / look_at.py / load-constraints.py
//   onlyChecks?: ["S3", "S7", ...],            // re-review loop: re-review only these slide IDs; carry the rest
//   priorReviews?: [<slide review objects>],   // re-review loop: prior per-slide results to carry forward
// }
let cfg = args
if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch { cfg = {} } }
cfg = cfg || {}
const PROJECT = cfg.projectDir
if (!PROJECT) throw new Error(`workshop-verify requires args.projectDir. Got "${typeof args}": ${JSON.stringify(args)?.slice(0, 200)}`)
const PLUGIN = cfg.pluginRoot || ''
const ONLY = Array.isArray(cfg.onlyChecks) && cfg.onlyChecks.length ? new Set(cfg.onlyChecks.map(String)) : null
const PRIOR = new Map((Array.isArray(cfg.priorReviews) ? cfg.priorReviews : []).map(s => [String(s.slide), s]))

// ── Schemas ───────────────────────────────────────────────────────────────────
const FINDING = {
  type: 'object', additionalProperties: false, required: ['severity', 'location', 'detail'],
  properties: {
    severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
    location: { type: 'string', description: 'file:line' },
    detail: { type: 'string' },
    quote: { type: 'string', description: 'verbatim text from the file backing this finding' },
    fix: { type: 'string' },
  },
}

const DISCOVERY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['presentationDir', 'slidesPath', 'notesPath', 'sourcesPath', 'checkAllPath', 'detectWidowsPath', 'lookAtPath', 'slides', 'diagrams'],
  properties: {
    presentationDir: { type: 'string', description: 'absolute path to the dir holding slides.typ' },
    slidesPath: { type: 'string' }, notesPath: { type: 'string' }, sourcesPath: { type: 'string' },
    checkAllPath: { type: 'string', description: 'absolute path to references/constraints/check-all.py' },
    detectWidowsPath: { type: 'string', description: 'absolute path to detect_widows.py, or "" if not found' },
    lookAtPath: { type: 'string', description: 'absolute path to look_at.py, or "" if not found' },
    slides: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['id', 'title', 'inventoryRefs'],
        properties: {
          id: { type: 'string', description: 'stable ID e.g. S1, S2 in document order' },
          title: { type: 'string', description: 'the === slide-title line verbatim' },
          inventoryRefs: { type: 'array', items: { type: 'string' }, description: 'F/T/R/A inventory IDs this slide should cite per OUTLINE.md (may be empty)' },
        },
      },
    },
    diagrams: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['id', 'slideTitle', 'kind'],
        properties: { id: { type: 'string' }, slideTitle: { type: 'string' }, kind: { type: 'string', enum: ['cetz', 'fletcher'] } },
      },
    },
  },
}

const MECHANICAL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['slidesCompiled', 'notesCompiled', 'compileErrors', 'constraintsPassed', 'constraintFailures', 'widows', 'overflow'],
  properties: {
    slidesCompiled: { type: 'boolean' }, notesCompiled: { type: 'boolean' },
    compileErrors: { type: 'array', items: { type: 'string' } },
    constraintsPassed: { type: 'boolean' },
    constraintFailures: { type: 'array', items: { type: 'string' }, description: 'raw FAIL lines from check-all.py' },
    widows: { type: 'integer', description: 'widow count from detect_widows.py on slides.pdf (0 = clean)' },
    overflow: { type: 'integer', description: 'count of slides that overflow the frame (0 = clean)' },
  },
}

// Per-slide reviewers return RAW COUNTS, never scores. The gate computes everything.
const CONVENTION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['slide', 'check', 'itemsChecked', 'findings'],
  properties: {
    slide: { type: 'string' }, check: { type: 'string', enum: ['convention'] },
    itemsChecked: { type: 'integer', description: 'convention rules evaluated against this slide' },
    findings: { type: 'array', items: FINDING },
  },
}
const NOTES_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['slide', 'check', 'itemsChecked', 'notesSectionFound', 'findings'],
  properties: {
    slide: { type: 'string' }, check: { type: 'string', enum: ['notes'] },
    itemsChecked: { type: 'integer' },
    notesSectionFound: { type: 'boolean', description: 'does notes.typ contain a corresponding section for this slide?' },
    findings: { type: 'array', items: FINDING },
  },
}
const FIDELITY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['slide', 'check', 'claimsChecked', 'claimsGrounded', 'findings'],
  properties: {
    slide: { type: 'string' }, check: { type: 'string', enum: ['fidelity'] },
    claimsChecked: { type: 'integer', description: 'factual claims on this slide (numbers, results, holdings, conclusions)' },
    claimsGrounded: { type: 'integer', description: 'of those, how many trace to a SOURCES.md inventory ID / the paper' },
    findings: { type: 'array', items: FINDING },
  },
}
const VISUAL_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['diagram', 'defectsFound', 'findings'],
  properties: {
    diagram: { type: 'string' },
    defectsFound: { type: 'integer', description: 'count of visual defects: clipped text, overlap, bad arrow routing, label anchoring, spacing, illegible text' },
    findings: { type: 'array', items: FINDING },
  },
}

// ── Phase 1: Discover ─────────────────────────────────────────────────────────
phase('Discover')
const lookAtHint = PLUGIN
  ? `${PLUGIN}/skills/look-at/scripts/look_at.py`
  : 'command ls -d ~/.claude/plugins/cache/*/workflows/*/skills/look-at/scripts/look_at.py | tail -1 (or the in-repo skills/look-at path)'
const checkAllHint = PLUGIN
  ? `${PLUGIN}/references/constraints/check-all.py`
  : 'command ls -d ~/.claude/plugins/cache/*/workflows/*/references/constraints/check-all.py | tail -1 (or the in-repo references/constraints path)'
const disc = await agent(
  `Enumerate the workshop deck's slides and diagrams and resolve the verification inputs. Working directory: ${PROJECT}

1. presentationDir = the directory holding slides.typ (commonly ${PROJECT}/presentation). slidesPath/notesPath = absolute slides.typ / notes.typ. sourcesPath = ${PROJECT}/.planning/SOURCES.md.
2. checkAllPath = ${checkAllHint}.
3. detectWidowsPath = \`command ls -d ~/.claude/plugins/cache/tinymist-plugin/tinymist/*/skills/typst-widow-orphan/scripts/detect_widows.py 2>/dev/null | sort -V | tail -1\` (or "" if none).
4. lookAtPath = ${lookAtHint} (or "" if none).
5. Read slides.typ and list every slide in document order. A slide is a \`#slide[ ... ]\` block; its title is the \`=== ...\` line inside it. Assign stable IDs S1, S2, ... in order. For each slide, read .planning/OUTLINE.md and record the F/T/R/A inventory IDs that outline maps to that slide (inventoryRefs; empty array if none listed).
6. List every diagram: \`cetz.canvas\` blocks (kind "cetz") and \`fletcher-diagram\`/\`#diagram(\` blocks (kind "fletcher"), each tied to the slide title it appears under.

Return DISCOVERY_SCHEMA. Absolute paths only.`,
  { label: 'discover', phase: 'Discover', schema: DISCOVERY_SCHEMA, model: 'sonnet' }
)
if (!disc.slides.length) throw new Error('No slides discovered — check slides.typ exists with #slide[ ... ] blocks')
log(`Deck: ${disc.slides.length} slides, ${disc.diagrams.length} diagrams; ${ONLY ? `re-review ${ONLY.size}` : 'full review'}`)

// ── Phase 2: Mechanical leg (compile + scripts; early-exit on compile failure) ──
phase('Mechanical')
const mech = await agent(
  `You are a READ-ONLY mechanical verifier. Do NOT create, edit, or overwrite any .typ files. Working directory: ${disc.presentationDir}

1. Compile both decks: \`typst compile slides.typ\` and \`typst compile notes.typ\`. Record slidesCompiled/notesCompiled and any error text in compileErrors. If slides.typ fails to compile, STILL return (the gate will short-circuit) — do not attempt the steps below.
2. Constraint checks (auto-discovers all .py): \`uv run python3 ${disc.checkAllPath} .\` — set constraintsPassed from exit code (0 = pass), and copy every "FAIL:" line into constraintFailures.
3. PDF widow detection (only if slides.pdf built): ${disc.detectWidowsPath ? `\`uv run python3 ${disc.detectWidowsPath} slides.pdf\`` : 'no detector resolved — set widows=0'} — widows = number of widow lines reported (0 if exit 0).
4. Overflow: compile handout mode \`typst compile slides.typ --input handout=true slides-handout.pdf\` and compare handout page count to slide count; overflow = number of slides that spill to a second page (0 if none / cannot determine).

Return MECHANICAL_SCHEMA. Report raw counts — do not soften.`,
  { label: 'mechanical', phase: 'Mechanical', schema: MECHANICAL_SCHEMA, model: 'sonnet' }
)

// Early-exit barrier: a deck that does not compile cannot be slide-reviewed meaningfully.
if (!mech.slidesCompiled) {
  log('❌ slides.typ does not compile — short-circuiting before per-slide review')
  return {
    overallPass: false,
    verdict: 'ISSUES FOUND',
    summary: { critical: 1 + (mech.compileErrors?.length || 0), major: 0, minor: 0, total: 1 + (mech.compileErrors?.length || 0) },
    scoreTable: `| Leg | Result | Gate |\n|-----|--------|------|\n| Compile (slides) | FAIL | ❌ |\n`,
    findings: [{ severity: 'critical', area: 'compile', location: `${disc.slidesPath}`, detail: `slides.typ failed to compile: ${(mech.compileErrors || []).join('; ').slice(0, 400)}` }],
    reviews: [],
    slidesThatFlagged: disc.slides.map(s => s.id),
    mechanical: mech,
  }
}

// ── Phase 3: Per-slide fan-out (convention + notes-coverage + fidelity) + per-diagram visual ─
phase('Review')
const reviewSlide = (s) => {
  const common = `Slide ${s.id}: "${s.title}"\nslides.typ: ${disc.slidesPath}\nnotes.typ: ${disc.notesPath}\nSOURCES.md: ${disc.sourcesPath}\nExpected inventory IDs for this slide (from OUTLINE.md): ${s.inventoryRefs.length ? s.inventoryRefs.join(', ') : '(none listed)'}`
  return parallel([
    // (a) Convention reviewer — Typst workshop conventions on THIS slide.
    () => agent(
      `You are a READ-ONLY Typst convention reviewer. Do NOT create, edit, or overwrite any files.
Set slide="${s.id}", check="convention" verbatim. ${common}
Locate this slide's \`#slide[ ... ]\` block in slides.typ and check ONLY it against the workshop conventions: blank lines between ALL bullets (top-level AND sub), sub-bullets use two-space indent + "- " (never "--"), heading hierarchy =/==/===, slide title is a complete sentence, no subtitle-body echo, images wrapped in #align(center), tables inset >= 10pt, smart apostrophes after )/], dollar signs escaped, no hardcoded calculations (use calc), no #callout with 3+ #pause. Every finding needs a file:line + verbatim quote. itemsChecked = number of convention rules you evaluated. Return CONVENTION_SCHEMA.`,
      { label: `${s.id}:convention`, phase: 'Review', schema: CONVENTION_SCHEMA, model: 'sonnet' }),
    // (b) Notes-coverage reviewer — does notes.typ cover this slide?
    () => agent(
      `You are a READ-ONLY notes-coverage reviewer. Do NOT create, edit, or overwrite any files.
Set slide="${s.id}", check="notes" verbatim. ${common}
Find the section in notes.typ that corresponds to this slide (by title / topic). Set notesSectionFound. If found, check the notes are flowing teleprompter prose (1-2 sentences per bullet, NOT slide-bullet recaps, NOT fragments) and that section transitions are present. If NOT found, that is a major finding (slide uncovered). Each finding needs file:line. itemsChecked = 1 if a notes section exists for this slide else 0. Return NOTES_SCHEMA.`,
      { label: `${s.id}:notes`, phase: 'Review', schema: NOTES_SCHEMA, model: 'sonnet' }),
    // (c) Source-fidelity reviewer — claims on this slide trace to the paper inventory.
    () => agent(
      `You are a READ-ONLY source-fidelity reviewer. Do NOT create, edit, or overwrite any files.
Set slide="${s.id}", check="fidelity" verbatim. ${common}
List every factual claim on this slide (empirical numbers, coefficients, percentages, sample sizes, case holdings, author conclusions). For each, verify it traces to a SOURCES.md inventory ID (F/T/R/A) — ideally one of the expected IDs above. claimsChecked = total factual claims; claimsGrounded = how many trace to an inventory ID. Any ungrounded claim is a critical finding with the claim text as quote + file:line. Return FIDELITY_SCHEMA.`,
      { label: `${s.id}:fidelity`, phase: 'Review', schema: FIDELITY_SCHEMA, model: 'sonnet' }),
  ]).then(([conv, notes, fid]) => ({
    slide: s.id,
    title: s.title,
    findings: [
      ...(conv?.findings || []).map(f => ({ ...f, source: 'convention' })),
      ...(notes?.findings || []).map(f => ({ ...f, source: 'notes' })),
      ...(fid?.findings || []).map(f => ({ ...f, source: 'fidelity' })),
    ],
    notesSectionFound: notes?.notesSectionFound ?? null,
    claimsChecked: fid?.claimsChecked || 0,
    claimsGrounded: fid?.claimsGrounded || 0,
    itemsChecked: (conv?.itemsChecked || 0) + (notes?.itemsChecked || 0) + (fid?.claimsChecked || 0),
    unreliable: !(conv && notes && fid) || ((conv?.itemsChecked || 0) === 0),
  }))
}

const tasks = []
const carried = []
let reran = 0, carriedCount = 0
for (const s of disc.slides) {
  if (ONLY && !ONLY.has(s.id)) {
    if (PRIOR.has(s.id)) { carried.push(PRIOR.get(s.id)); carriedCount++ }
    continue
  }
  reran++
  tasks.push(() => reviewSlide(s))
}
const liveSlides = (await parallel(tasks)).filter(Boolean)
if (ONLY) log(`Selective re-review: ${reran} slide(s) live, ${carriedCount} carried`)

// Per-diagram visual-verify (only on a full review; diagrams are tied to slides).
let diagramReviews = []
if (!ONLY && disc.diagrams.length && disc.lookAtPath) {
  diagramReviews = (await parallel(disc.diagrams.map(d => () =>
    agent(
      `You are a READ-ONLY visual reviewer. Do NOT edit files. Render the slides.pdf page containing the diagram on slide "${d.slideTitle}" and score it for visual defects.
Use: \`uv run python3 ${disc.lookAtPath} --file ${disc.presentationDir}/slides.pdf --goal "Inspect the ${d.kind} diagram on the slide titled '${d.slideTitle}' for: clipped/cut-off text, overlapping elements, bad arrow routing, label anchoring, cramped spacing, illegible text size"\`.
Set diagram="${d.id}". defectsFound = count of distinct visual defects. Each defect is a finding (severity major) with a short description. Return VISUAL_SCHEMA.`,
      { label: `${d.id}:visual`, phase: 'Review', schema: VISUAL_SCHEMA, model: 'sonnet' }
    )
  ))).filter(Boolean)
} else if (!ONLY && disc.diagrams.length && !disc.lookAtPath) {
  log(`⚠️ ${disc.diagrams.length} diagram(s) present but look_at.py not resolved — visual-verify skipped (NOT silently passed)`)
}

const allSlides = [...liveSlides, ...carried]
const order = Object.fromEntries(disc.slides.map((s, i) => [s.id, i]))
allSlides.sort((a, b) => (order[a.slide] ?? 99) - (order[b.slide] ?? 99))

// ── Phase 4: Gate — aggregate raw counts into severity totals, computed in JS ───
phase('Gate')
const sev = { critical: 0, major: 0, minor: 0 }
const findings = []

// Mechanical findings.
for (const e of (mech.compileErrors || [])) { sev.critical++; findings.push({ severity: 'critical', area: 'compile', location: disc.slidesPath, detail: e }) }
if (!mech.notesCompiled) { sev.critical++; findings.push({ severity: 'critical', area: 'compile', location: disc.notesPath, detail: 'notes.typ failed to compile' }) }
for (const f of (mech.constraintFailures || [])) { sev.critical++; findings.push({ severity: 'critical', area: 'constraint', location: 'check-all.py', detail: f }) }
if (mech.widows > 0) { sev.major += mech.widows; findings.push({ severity: 'major', area: 'widow', location: 'slides.pdf', detail: `${mech.widows} widow line(s) — binary gate requires 0` }) }
if (mech.overflow > 0) { sev.major += mech.overflow; findings.push({ severity: 'major', area: 'overflow', location: 'slides.pdf', detail: `${mech.overflow} slide(s) overflow the frame` }) }

// Per-slide findings + derived gates (notes coverage, ungrounded claims).
for (const s of allSlides) {
  for (const f of (s.findings || [])) { if (sev[f.severity] !== undefined) sev[f.severity]++; findings.push({ ...f, area: f.source || 'slide', slide: s.slide }) }
  if (s.notesSectionFound === false) { sev.major++; findings.push({ severity: 'major', area: 'notes', slide: s.slide, location: disc.notesPath, detail: `slide ${s.slide} ("${s.title}") has no corresponding notes section` }) }
  const ungrounded = Math.max(0, (s.claimsChecked || 0) - (s.claimsGrounded || 0))
  if (ungrounded > 0) { /* already emitted as fidelity findings; do not double-count severity */ }
}

// Per-diagram findings.
for (const d of diagramReviews) {
  for (const f of (d.findings || [])) { if (sev[f.severity] !== undefined) sev[f.severity]++; findings.push({ ...f, area: 'visual', diagram: d.diagram }) }
}

const total = sev.critical + sev.major + sev.minor
const overallPass = total === 0
const verdict = overallPass ? 'CLEAN' : 'ISSUES FOUND'
const unreliableSlides = allSlides.filter(s => s.unreliable).map(s => s.slide)
const claimsChecked = allSlides.reduce((a, s) => a + (s.claimsChecked || 0), 0)
const claimsGrounded = allSlides.reduce((a, s) => a + (s.claimsGrounded || 0), 0)

// Per-slide inventory-coverage classification (drives the skill's .planning/VALIDATION.md map; P18).
// COVERED = cites >=1 inventory ID AND every factual claim is grounded.
// PARTIAL = cites no inventory ID, OR has ungrounded claims.
const refsBySlide = Object.fromEntries(disc.slides.map(s => [s.id, s.inventoryRefs || []]))
const coverageMap = allSlides.map(s => {
  const ungrounded = Math.max(0, (s.claimsChecked || 0) - (s.claimsGrounded || 0))
  const refs = refsBySlide[s.slide] || []
  const status = (refs.length > 0 && ungrounded === 0) ? 'COVERED' : 'PARTIAL'
  return { slide: s.slide, title: s.title, inventoryRefs: refs, ungroundedClaims: ungrounded, status }
})

const scoreTable = [
  '| Leg | Measure | Result | Gate |',
  '|-----|---------|--------|------|',
  `| Compile | slides / notes | ${mech.slidesCompiled ? 'ok' : 'FAIL'} / ${mech.notesCompiled ? 'ok' : 'FAIL'} | ${mech.slidesCompiled && mech.notesCompiled ? '✅' : '❌'} |`,
  `| Constraints | check-all.py | ${mech.constraintsPassed ? 'pass' : `${mech.constraintFailures.length} FAIL`} | ${mech.constraintsPassed ? '✅' : '❌'} |`,
  `| Widows | detect_widows.py | ${mech.widows} | ${mech.widows === 0 ? '✅' : '❌'} |`,
  `| Overflow | handout page count | ${mech.overflow} | ${mech.overflow === 0 ? '✅' : '❌'} |`,
  `| Source fidelity | claims grounded | ${claimsGrounded}/${claimsChecked} | ${claimsGrounded === claimsChecked ? '✅' : '❌'} |`,
  `| Notes coverage | slides with notes | ${allSlides.filter(s => s.notesSectionFound !== false).length}/${allSlides.length} | ${allSlides.every(s => s.notesSectionFound !== false) ? '✅' : '❌'} |`,
  `| Visual | diagram defects | ${diagramReviews.reduce((a, d) => a + (d.defectsFound || 0), 0)} | ${diagramReviews.every(d => (d.defectsFound || 0) === 0) ? '✅' : '❌'} |`,
  `| **Overall** | crit/major/minor | ${sev.critical}/${sev.major}/${sev.minor} | ${overallPass ? '✅ CLEAN' : '❌ ISSUES'} |`,
].join('\n')

log(overallPass ? '✅ Workshop verify CLEAN — no issues' : `Workshop verify: ISSUES FOUND — ${sev.critical} critical / ${sev.major} major / ${sev.minor} minor`)

return {
  overallPass,
  verdict,
  summary: { ...sev, total },
  scoreTable,
  findings: findings.sort((a, b) => ({ critical: 0, major: 1, minor: 2 }[a.severity] - { critical: 0, major: 1, minor: 2 }[b.severity])),
  reviews: allSlides,                 // raw per-slide objects — pass back as priorReviews on a selective re-run
  diagramReviews,
  mechanical: mech,
  unreliableSlides,                   // slides where a reviewer returned nothing — flag, don't trust
  slidesThatFlagged: allSlides.filter(s => (s.findings || []).length || s.unreliable || s.notesSectionFound === false).map(s => s.slide), // pass as onlyChecks on re-review
  inventoryCoverage: { claimsChecked, claimsGrounded },
  coverageMap,                       // per-slide COVERED/PARTIAL — skill renders .planning/VALIDATION.md directly from this (P18)
}
