export const meta = {
  name: 'workshop-verify',
  description: 'Workshop slide-deck verification as an ultracode workflow: a global mechanical leg (compile + constraint check-all.py + PDF widow + overflow) then a per-slide fan-out (ONE agent runs convention + notes-coverage + source-fidelity, findings tagged by area) and per-diagram visual-verify. Returns structured findings + a computed CLEAN/ISSUES gate from raw counts. Read-only; does NOT fix.',
  whenToUse: 'Called by the workshop skill at the Phase 3->4 boundary (artifact review gate) and as Phase 4 verification, and by workshop-revise after edits. Returns {overallPass, verdict, scoreTable, findings, reviews, slidesThatFlagged}. The skill renders the gate, drives the /goal fix loop, and on a re-review passes onlyChecks (flagged slide IDs) + priorReviews. The workflow never drafts and never fixes.',
  phases: [
    { title: 'Discover', detail: 'enumerate slides + diagrams; inline each slide\'s body + notes section once; resolve authenticated PLAN/check-all/detect_widows' },
    { title: 'Mechanical', detail: 'compile both .typ; run check-all.py + widow + overflow (early-exit if compile fails)' },
    { title: 'Review', detail: 'one agent per slide runs convention + notes-coverage + fidelity (area-tagged findings), in parallel; per-diagram visual-verify' },
    { title: 'Gate', detail: 'aggregate raw counts -> severity totals -> CLEAN/ISSUES, computed in JS' },
  ],
}

const SEV_RANK = { critical: 0, major: 1, minor: 2 }

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
const { readFileSync, lstatSync, realpathSync } = await import('node:fs')
const { createHash } = await import('node:crypto')
const RECEIPT_KEYS = ['workflow','plan_file','plan_hash','approved_session_id','approved_at','status','reviewer_session_id','reviewed_at']
const HASH = /^[0-9a-f]{64}$/
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const RESERVED_PLAN_FILES = new Set(['PLAN.md','PLAN_REVIEWED.md','REVIEW.md','AUTOMATED_REVIEW.md','HUMAN_REVIEW.md','IMPLEMENT_COMPLETE.md','VALIDATION.md'])
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
function authenticatePlan(projectDir, planPath, planHash) {
  const root = realpathSync(projectDir), planning = `${root}/.planning`, state = `${planning}/.state/review.json`
  for (const path of [planning, `${planning}/.state`, state]) if (lstatSync(path).isSymbolicLink()) throw new Error('workshop generated-plan authentication rejects symbolic links')
  const receipt = parseStrictReceipt(readFileSync(state, 'utf8'))
  const approvedAt = Date.parse(receipt.approved_at), reviewedAt = Date.parse(receipt.reviewed_at)
  if (Object.keys(receipt).length !== RECEIPT_KEYS.length || RECEIPT_KEYS.some(key => typeof receipt[key] !== 'string') || receipt.workflow !== 'workshop' || receipt.status !== 'APPROVED' || !HASH.test(receipt.plan_hash) || !UTC.test(receipt.approved_at) || !UTC.test(receipt.reviewed_at) || new Date(approvedAt).toISOString() !== receipt.approved_at || new Date(reviewedAt).toISOString() !== receipt.reviewed_at || !receipt.approved_session_id.trim() || !receipt.reviewer_session_id.trim() || receipt.approved_session_id === receipt.reviewer_session_id || reviewedAt <= approvedAt || !/^[^./\\][^/\\]*\.md$/.test(receipt.plan_file) || RESERVED_PLAN_FILES.has(receipt.plan_file)) throw new Error('workshop generated-plan review.json has invalid strict receipt schema')
  const selected = `${planning}/${receipt.plan_file}`
  if (planPath !== selected || lstatSync(selected).isSymbolicLink()) throw new Error('workshop generated-plan path is not the receipt-selected safe direct child')
  const current = createHash('sha256').update(readFileSync(selected)).digest('hex')
  if (current !== receipt.plan_hash || current !== planHash) throw new Error('workshop generated-plan receipt does not authenticate current plan bytes')
  return { state, receipt, hash: current, planPath: selected }
}
const AUTH = authenticatePlan(PROJECT, cfg.planPath, cfg.planHash)
const ONLY = Array.isArray(cfg.onlyChecks) && cfg.onlyChecks.length ? new Set(cfg.onlyChecks.map(String)) : null
const PRIOR = new Map((Array.isArray(cfg.priorReviews) ? cfg.priorReviews : []).map(s => [String(s.slide), s]))
// Deterministic side-table from scripts/workshop/workshop-slide-table.ts (cfg.slideIndex).
// DESIGN §3a/§3a-join — verify is the CARDINALITY-CORRECTION case: slide ENUMERATION stays sourced from
// slides.typ (the built deck, e.g. 38 slides incl. 17 drifted appendix), and the PLAN Slide-Spec-row↔built-slide
// JOIN stays an UNBIASED SEMANTIC step. A parity variance-study (opv-parity, n=3) showed that injecting the
// parser's rows as a candidate MENU into Discover CONTAMINATES the join — the agent greedily
// forces unspecced appendix slides onto the nearest row (false COVERED, once 38/38). The parser therefore
// does NOT feed a candidate menu; the reviewer reads the authenticated PLAN directly and treats [] as common.
// The parser's contribution is instead a DETERMINISTIC WHITELIST applied in JS AFTER Discover — drop any
// inventoryRef that is not a real authenticated Source Inventory id (the no-hallucination guard), without biasing the join.
if (!cfg.planPath || !cfg.planHash) throw new Error('workshop-verify requires receipt-selected args.planPath and args.planHash')
if (!cfg.slideIndex || !Array.isArray(cfg.slideIndex.slides) || !cfg.slideIndex.slides.length) throw new Error('workshop-verify requires the canonical TypeScript slideIndex with at least one slide')
if (!Array.isArray(cfg.slideIndex.sourcesInventory)) throw new Error('workshop-verify requires slideIndex.sourcesInventory from the canonical TypeScript parser')
if (cfg.slideIndex.planPath !== cfg.planPath || cfg.slideIndex.planHash !== cfg.planHash) throw new Error('workshop-verify planPath/planHash must match the canonical slideIndex')
if (cfg.slideIndex.ok !== true || cfg.slideIndex.planPath !== AUTH.planPath || cfg.slideIndex.planHash !== AUTH.hash || cfg.slideIndex.planFile !== AUTH.receipt.plan_file || cfg.slideIndex.reviewStatePath !== AUTH.state || (cfg.slideIndex.violations || []).length) throw new Error('workshop-verify index disagrees with strict current review.json authentication')
const SLIDE_INDEX = cfg.slideIndex
const INV_WHITELIST = new Set(SLIDE_INDEX.sourcesInventory.map(String))

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
        type: 'object', additionalProperties: false, required: ['id', 'title', 'inventoryRefs', 'slideBody', 'notesBody'],
        properties: {
          id: { type: 'string', description: 'stable ID e.g. S1, S2 in document order' },
          title: { type: 'string', description: 'the === slide-title line verbatim' },
          inventoryRefs: { type: 'array', items: { type: 'string' }, description: 'F/T/R/A inventory IDs semantically mapped from the authenticated PLAN (may be empty)' },
          slideBody: { type: 'string', description: 'the verbatim text of this slide\'s #slide[ ... ] block (inlined so the per-slide reviewer does not re-Read slides.typ per check)' },
          notesBody: { type: 'string', description: 'the verbatim text of this slide\'s corresponding notes.typ section (by title/topic match), or "" if no section was found' },
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
  required: ['slidesCompiled', 'notesCompiled', 'compileErrors', 'constraintsPassed', 'constraintFailures', 'constraintErrors', 'widows', 'overflow'],
  properties: {
    slidesCompiled: { type: 'boolean' }, notesCompiled: { type: 'boolean' },
    compileErrors: { type: 'array', items: { type: 'string' } },
    constraintsPassed: { type: 'boolean', description: 'true iff the parsed JSON failed[] array is empty (NOT the process exit code — exit 1 also fires on errors[]-only, which is infra, not a deck defect)' },
    constraintFailures: { type: 'array', items: { type: 'string' }, description: 'one entry per check-all.py JSON failed[] item: "<name>: <violations summary>" — real constraint violations, blocking' },
    constraintErrors: { type: 'array', items: { type: 'string' }, description: 'one entry per check-all.py JSON errors[] item: "<name>: <error>" — constraint-module infra failures (import/exception), NOT deck defects, non-blocking' },
    widows: { type: 'integer', description: 'widow count from detect_widows.py on slides.pdf (0 = clean)' },
    overflow: { type: 'integer', description: 'count of slides that overflow the frame (0 = clean)' },
  },
}

// Per-slide reviewer returns RAW COUNTS, never scores. The gate computes everything.
// ONE agent per slide runs all three checks (convention + notes-coverage + source-fidelity) in a single
// context — findings are tagged with `area` so downstream gating/scoreTable logic (which only reads
// findings[].severity, notesSectionFound, claimsChecked, claimsGrounded) stays unchanged.
const SLIDE_FINDING = {
  type: 'object', additionalProperties: false, required: ['area', 'severity', 'location', 'detail'],
  properties: {
    area: { type: 'string', enum: ['convention', 'notes', 'fidelity'], description: 'which of the three checks this finding came from' },
    severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
    location: { type: 'string', description: 'file:line' },
    detail: { type: 'string' },
    quote: { type: 'string', description: 'verbatim text from the file backing this finding' },
    fix: { type: 'string' },
  },
}
const SLIDE_REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['slide', 'itemsChecked', 'notesSectionFound', 'claimsChecked', 'claimsGrounded', 'findings'],
  properties: {
    slide: { type: 'string' },
    itemsChecked: { type: 'integer', description: 'convention rules evaluated against this slide' },
    notesSectionFound: { type: 'boolean', description: 'does notes.typ contain a corresponding section for this slide?' },
    claimsChecked: { type: 'integer', description: 'factual claims on this slide (numbers, results, holdings, conclusions)' },
    claimsGrounded: { type: 'integer', description: 'of those, how many trace to an authenticated PLAN Source Inventory ID / the paper' },
    findings: { type: 'array', items: SLIDE_FINDING },
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

1. presentationDir = the directory holding slides.typ (commonly ${PROJECT}/presentation). slidesPath/notesPath = absolute slides.typ / notes.typ. sourcesPath = the authenticated PLAN at ${cfg.planPath}.
2. checkAllPath = ${checkAllHint}.
3. detectWidowsPath = \`command ls -d ~/.claude/plugins/cache/tinymist-plugin/tinymist/*/skills/typst-widow-orphan/scripts/detect_widows.py 2>/dev/null | sort -V | tail -1\` (or "" if none).
4. lookAtPath = ${lookAtHint} (or "" if none).
5. Read slides.typ and list every slide in document order. A slide is a \`#slide[ ... ]\` block; its title is the \`=== ...\` line inside it. Assign stable IDs S1, S2, ... in order. Read the authenticated PLAN's Slide Spec and Source Inventory at ${cfg.planPath}; semantically map each built slide to its F/T/R/A inventory IDs (inventoryRefs; empty array is correct for unmatched appendix/Q&A slides — do not force a match). ALSO capture slideBody = the verbatim text of that slide's \`#slide[ ... ]\` block, and notesBody = the verbatim text of its corresponding section in notes.typ (matched by title/topic; "" if no section is found) — inlining both here means the per-slide reviewer does not re-read whole files per check.
6. List every diagram: \`cetz.canvas\` blocks (kind "cetz") and \`fletcher-diagram\`/\`#diagram(\` blocks (kind "fletcher"), each tied to the slide title it appears under.

Return DISCOVERY_SCHEMA. Absolute paths only.`,
  { label: 'discover', phase: 'Discover', schema: DISCOVERY_SCHEMA, model: 'sonnet' }
)
if (!disc) throw new Error('Discover agent returned null — re-invoke')
if (!disc.slides.length) throw new Error('No slides discovered — check slides.typ exists with #slide[ ... ] blocks')

// Deterministic inventory WHITELIST (DESIGN §3a-join): the semantic join remains unbiased;
// here we drop any inventoryRef the agent attributed that is NOT a real Source Inventory id (no-hallucination
// guard) — applied in JS, OUTSIDE the agent, so it cannot bias the join. No-op when no index is passed.
if (INV_WHITELIST) {
  let dropped = 0
  for (const s of disc.slides) {
    const refs = Array.isArray(s.inventoryRefs) ? s.inventoryRefs : []
    const kept = refs.filter(r => INV_WHITELIST.has(String(r)))
    dropped += refs.length - kept.length
    s.inventoryRefs = kept
  }
  if (dropped) log(`Inventory whitelist: dropped ${dropped} non-PLAN-inventory id(s) attributed by Discover`)
}
log(`Deck: ${disc.slides.length} slides, ${disc.diagrams.length} diagrams; ${ONLY ? `re-review ${ONLY.size}` : 'full review'}`)

// ── Phase 2: Mechanical leg (compile + scripts; early-exit on compile failure) ──
phase('Mechanical')
const mech = await agent(
  `You are a READ-ONLY mechanical verifier. Do NOT create, edit, or overwrite any .typ files. Working directory: ${disc.presentationDir}

1. Compile both decks: \`typst compile slides.typ\` and \`typst compile notes.typ\`. Record slidesCompiled/notesCompiled and any error text in compileErrors. If slides.typ fails to compile, STILL return (the gate will short-circuit) — do not attempt the steps below.
2. Constraint checks (auto-discovers all .py): \`uv run python3 ${disc.checkAllPath} .\` — this prints a JSON object (NOT "FAIL:" lines) with keys passed/failed/conventions/errors/skipped, followed by a summary line. Parse the JSON. For each entry in failed[] (each is {name, violations}), add one string "<name>: <violations summary>" to constraintFailures — these are real constraint violations. For each entry in errors[] (each is {name, error}), add one string "<name>: <error>" to constraintErrors — these are constraint-module infra failures (import/exception), NOT deck defects; do not put them in constraintFailures. Set constraintsPassed = (failed[] is empty) — do NOT use the process exit code, which is also 1 when only errors[] is non-empty.
3. PDF widow detection (only if slides.pdf built): ${disc.detectWidowsPath ? `\`uv run python3 ${disc.detectWidowsPath} slides.pdf\`` : 'no detector resolved — set widows=0'} — widows = number of widow lines reported (0 if exit 0).
4. Overflow (PER-SLIDE, THEME-AGNOSTIC — do NOT use page-count arithmetic; it both over-counts theme pages and can MASK real spill): compile handout mode \`typst compile slides.typ --input handout=true slides-handout.pdf\`, then decide PER SLIDE whether its OWN content spills. Method: extract ALL page text in ONE pass — \`pdftotext -layout slides-handout.pdf -\` (form-feed \\x0c separates pages; split on it to get per-page text) rather than N separate \`-f/-l\` invocations — and map each \`#slide[]\` block to the handout page(s) carrying its \`=== <takeaway>\` title. A slide OVERFLOWS iff its content occupies ≥2 CONSECUTIVE handout pages AND the slide block contains NO \`#pause\` (\`#pause\` legitimately produces multiple BUILD pages — that is NOT spill; grep the block for \`#pause\` and exclude those). Pages with no \`===\` title (title slide, TOC/\`#outline\`, \`=\`/\`==\` dividers) are STRUCTURAL — ignore them entirely; never infer overflow from \`handout_pages − slide_count\`. overflow = count of slides that occupy ≥2 pages with no \`#pause\`. If you genuinely cannot map a slide to its pages, set overflow=0 and say so (a false NEGATIVE that hides a clipped slide is worse than a missed warning — but a guessed page-arithmetic positive/negative is worst). Report the offending slide titles in context if overflow>0.

Return MECHANICAL_SCHEMA. Report raw counts — do not soften.`,
  { label: 'mechanical', phase: 'Mechanical', schema: MECHANICAL_SCHEMA, model: 'sonnet' }
)

// Guard against a null mechanical-leg result (agent() can return null; fan-outs .filter(Boolean) this
// away but a single agent() call does not) — synthesize a critical finding and short-circuit through the
// same early-exit shape as a compile failure, rather than crashing on mech.slidesCompiled below.
if (!mech) {
  log('❌ Mechanical leg agent returned null — short-circuiting before per-slide review')
  return {
    overallPass: false,
    verdict: 'ISSUES FOUND',
    summary: { critical: 1, major: 0, minor: 0, total: 1 },
    scoreTable: `| Leg | Result | Gate |\n|-----|--------|------|\n| Mechanical | agent returned null | ❌ |\n`,
    findings: [{ severity: 'critical', area: 'mechanical', location: disc.presentationDir, detail: 'Mechanical leg agent returned null — re-invoke workshop-verify' }],
    reviews: [],
    slidesThatFlagged: disc.slides.map(s => s.id),
    scope: { checked: [], notChecked: ['everything downstream — mechanical leg returned null, could not run compile/constraint/widow/overflow checks'] },
    mechanical: null,
  }
}
// Early-exit barrier: a deck that does not compile cannot be slide-reviewed meaningfully.
if (!mech.slidesCompiled) {
  log('❌ slides.typ does not compile — short-circuiting before per-slide review')
  // D-w-8: one finding per compile error so summary.critical === findings.length (was 1+errors.length,
  // which disagreed with the always-1 findings array — a self-inconsistent count that also FLOATED
  // because compileErrors is agent-bucketed). Fall back to one generic finding when none are itemised.
  const compileFindings = (mech.compileErrors && mech.compileErrors.length)
    ? mech.compileErrors.map(e => ({ severity: 'critical', area: 'compile', location: disc.slidesPath, detail: `slides.typ failed to compile: ${String(e).slice(0, 400)}` }))
    : [{ severity: 'critical', area: 'compile', location: disc.slidesPath, detail: 'slides.typ failed to compile (no error text captured)' }]
  return {
    overallPass: false,
    verdict: 'ISSUES FOUND',
    summary: { critical: compileFindings.length, major: 0, minor: 0, total: compileFindings.length },
    scoreTable: `| Leg | Result | Gate |\n|-----|--------|------|\n| Compile (slides) | FAIL | ❌ |\n`,
    findings: compileFindings,
    reviews: [],
    slidesThatFlagged: disc.slides.map(s => s.id),
    scope: { checked: ['typst compile (slides) — FAILED'], notChecked: ['everything downstream — per-slide review, constraints, widows, overflow, visual: SKIPPED (short-circuit on compile failure)'] },
    mechanical: mech,
  }
}

// ── Phase 3: Per-slide fan-out (ONE agent runs convention + notes-coverage + fidelity) + per-diagram visual ─
// Consolidated from 3 agents/slide to 1 agent/slide (3N→N) — each agent re-reading whole files 3x per
// slide was the waste; now Discover inlines the slide body + notes section ONCE (§ above) and this single
// prompt runs all three checks over that inlined text, tagging findings by area for downstream parity.
phase('Review')
const reviewSlide = (s) => {
  const inlinedSlide = (s.slideBody && s.slideBody.trim())
    ? `\nSLIDE BLOCK (inlined verbatim from slides.typ):\n${s.slideBody}\n`
    : `\n(slide body was not inlined by Discover — Read ${disc.slidesPath} directly for this slide's #slide[ ... ] block)\n`
  const inlinedNotes = (s.notesBody && s.notesBody.trim())
    ? `\nNOTES SECTION (inlined verbatim from notes.typ):\n${s.notesBody}\n`
    : `\n(no notes section was inlined by Discover — Read ${disc.notesPath} directly to look for this slide's section before concluding notesSectionFound=false)\n`
  const common = `Slide ${s.id}: "${s.title}"\nslides.typ: ${disc.slidesPath}\nnotes.typ: ${disc.notesPath}\nAuthenticated PLAN: ${disc.sourcesPath}\nExpected inventory IDs for this slide (from the PLAN Slide Spec): ${s.inventoryRefs.length ? s.inventoryRefs.join(', ') : '(none listed)'}${inlinedSlide}${inlinedNotes}`
  return agent(
    `You are a READ-ONLY workshop-slide reviewer. Do NOT create, edit, or overwrite any files.
Set slide="${s.id}" verbatim. ${common}
Run all THREE checks below on this ONE slide in a single pass and tag every finding's \`area\` accordingly:

(a) area="convention" — Typst workshop conventions on the slide block above: blank lines between ALL bullets (top-level AND sub), sub-bullets use two-space indent + "- " (never "--"), heading hierarchy =/==/===, slide title is a complete sentence, no subtitle-body echo, images wrapped in #align(center), tables inset >= 10pt, smart apostrophes after )/], dollar signs escaped, no hardcoded calculations (use calc), no #callout with 3+ #pause. itemsChecked = number of convention rules you evaluated.

(b) area="notes" — does the notes section above (or notes.typ if you had to fall back) cover this slide? Set notesSectionFound. If found, check the notes are flowing teleprompter prose (1-2 sentences per bullet, NOT slide-bullet recaps, NOT fragments) and that section transitions are present. If NOT found, that is a major finding (slide uncovered).

(c) area="fidelity" — list every factual claim on this slide (empirical numbers, coefficients, percentages, sample sizes, case holdings, author conclusions). For each, verify it traces to an authenticated PLAN Source Inventory ID (F/T/R/A) — ideally one of the expected IDs above. claimsChecked = total factual claims; claimsGrounded = how many trace to an inventory ID. Any ungrounded claim is a critical finding with the claim text as quote + file:line.

Every finding needs area + file:line (+ verbatim quote where applicable). Return SLIDE_REVIEW_SCHEMA.`,
    { label: `${s.id}:review`, phase: 'Review', schema: SLIDE_REVIEW_SCHEMA, model: 'sonnet' }
  ).then(sr => ({
    slide: s.id,
    title: s.title,
    findings: (sr?.findings || []).map(f => ({ ...f, source: f.area })),
    notesSectionFound: sr?.notesSectionFound ?? null,
    claimsChecked: sr?.claimsChecked || 0,
    claimsGrounded: sr?.claimsGrounded || 0,
    itemsChecked: (sr?.itemsChecked || 0) + (sr?.claimsChecked || 0),
    unreliable: !sr || ((sr?.itemsChecked || 0) === 0),
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

// Per-diagram visual-verify. On a full review, all diagrams run. On a selective re-review (ONLY set),
// still review diagrams belonging to a slide in ONLY (a re-verify of S3 should re-check S3's diagram) —
// otherwise a selective re-review of an edited slide vacuously passes Visual (empty .every() === true).
// Diagrams on slides NOT in ONLY are left unreviewed this run (no carry-forward mechanism for diagram
// reviews exists yet); the scoreTable below distinguishes that from a genuine zero-defect pass.
const titleToSlideId = Object.fromEntries(disc.slides.map(s => [s.title, s.id]))
const diagramsToReview = ONLY
  ? disc.diagrams.filter(d => ONLY.has(titleToSlideId[d.slideTitle]))
  : disc.diagrams
let diagramReviews = []
if (diagramsToReview.length && disc.lookAtPath) {
  diagramReviews = (await parallel(diagramsToReview.map(d => () =>
    agent(
      `You are a READ-ONLY visual reviewer. Do NOT edit files. Render the slides.pdf page containing the diagram on slide "${d.slideTitle}" and score it for visual defects.
Use: \`uv run --script ${disc.lookAtPath} --file ${disc.presentationDir}/slides.pdf --goal "Inspect the ${d.kind} diagram on the slide titled '${d.slideTitle}' for: clipped/cut-off text, overlapping elements, bad arrow routing, label anchoring, cramped spacing, illegible text size"\`.
Set diagram="${d.id}". defectsFound = count of distinct visual defects. Each defect is a finding (severity major) with a short description. Return VISUAL_SCHEMA.`,
      { label: `${d.id}:visual`, phase: 'Review', schema: VISUAL_SCHEMA, model: 'sonnet' }
    )
  ))).filter(Boolean)
} else if (diagramsToReview.length && !disc.lookAtPath) {
  log(`⚠️ ${diagramsToReview.length} diagram(s) present but look_at.py not resolved — visual-verify skipped (NOT silently passed)`)
}
const visualSkippedCarryForward = ONLY && diagramReviews.length === 0 && disc.diagrams.length > 0

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
// Constraint-module infra failures (errors[]) are NOT deck defects — one non-blocking minor finding
// summarizing all of them, so a broken check-all.py module can't masquerade as (or hide) a real violation.
if ((mech.constraintErrors || []).length) {
  sev.minor++
  findings.push({ severity: 'minor', area: 'constraint-infra', location: 'check-all.py', detail: `${mech.constraintErrors.length} constraint module error(s) (infra, not deck defects): ${mech.constraintErrors.join(' | ').slice(0, 400)}` })
}
if (mech.widows > 0) { sev.major += mech.widows; findings.push({ severity: 'major', area: 'widow', location: 'slides.pdf', detail: `${mech.widows} widow line(s) — binary gate requires 0` }) }
if (mech.overflow > 0) { sev.major += mech.overflow; findings.push({ severity: 'major', area: 'overflow', location: 'slides.pdf', detail: `${mech.overflow} slide(s) overflow the frame` }) }

// Per-slide findings + derived gates (notes coverage, ungrounded claims).
for (const s of allSlides) {
  for (const f of (s.findings || [])) { if (sev[f.severity] !== undefined) sev[f.severity]++; findings.push({ ...f, area: f.source || 'slide', slide: s.slide }) }
  if (s.notesSectionFound === false) { sev.major++; findings.push({ severity: 'major', area: 'notes', slide: s.slide, location: disc.notesPath, detail: `slide ${s.slide} ("${s.title}") has no corresponding notes section` }) }
  // Ungrounded claims are already emitted as fidelity findings above — not double-counted here.
}

// Per-diagram findings.
for (const d of diagramReviews) {
  for (const f of (d.findings || [])) { if (sev[f.severity] !== undefined) sev[f.severity]++; findings.push({ ...f, area: 'visual', diagram: d.diagram }) }
}

const total = sev.critical + sev.major + sev.minor
// Substrate split: compile / constraints / widows / overflow / source-fidelity / notes-coverage / visual-defects
// are deterministic or categorical gates → critical+major are BLOCKING. Per-slide convention/style minors are
// advisory polish notes — they do NOT block the gate (chasing them is the over-enforcement treadmill).
const blocking = sev.critical + sev.major
const substratePass = blocking === 0
const overallPass = substratePass
const verdict = total === 0
  ? 'CLEAN'
  : substratePass
    ? 'CLEAN (advisory minor notes)'
    : 'ISSUES FOUND'
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
  `| Constraints | check-all.py | ${mech.constraintsPassed ? 'pass' : `${mech.constraintFailures.length} FAIL`}${(mech.constraintErrors || []).length ? ` (+${mech.constraintErrors.length} infra-error, non-blocking)` : ''} | ${mech.constraintsPassed ? '✅' : '❌'} |`,
  `| Widows | detect_widows.py | ${mech.widows} | ${mech.widows === 0 ? '✅' : '❌'} |`,
  `| Overflow | handout page count | ${mech.overflow} | ${mech.overflow === 0 ? '✅' : '❌'} |`,
  `| Source fidelity | claims grounded | ${claimsGrounded}/${claimsChecked} | ${claimsGrounded === claimsChecked ? '✅' : '❌'} |`,
  `| Notes coverage | slides with notes | ${allSlides.filter(s => s.notesSectionFound !== false).length}/${allSlides.length} | ${allSlides.every(s => s.notesSectionFound !== false) ? '✅' : '❌'} |`,
  visualSkippedCarryForward
    ? `| Visual | diagram defects | skipped (carry-forward — no diagrams on re-reviewed slides) | ⚠️ |`
    : `| Visual | diagram defects | ${diagramReviews.reduce((a, d) => a + (d.defectsFound || 0), 0)} | ${diagramReviews.every(d => (d.defectsFound || 0) === 0) ? '✅' : '❌'} |`,
  `| **Overall** | blocking (crit+major) / advisory minor | ${blocking} / ${sev.minor} | ${substratePass ? (total === 0 ? '✅ CLEAN' : '✅ CLEAN (minors advisory)') : '❌ ISSUES'} |`,
].join('\n')

log(substratePass
  ? (total === 0 ? '✅ Workshop verify CLEAN — no issues' : `✅ Workshop verify CLEAN — substrate clean; ${sev.minor} advisory minor note(s) (non-blocking)`)
  : `Workshop verify: ISSUES FOUND — ${sev.critical} critical / ${sev.major} major (blocking) + ${sev.minor} minor (advisory)`)

// D1 contract / doctrine #3 addendum (DESIGN move 2 / §4b): a clean mechanical pass MUST disclose what
// the deterministic floor did and did NOT verify — so a green check never over-claims coverage.
const scope = {
  checked: [
    'typst compile (slides + notes) — real exit code',
    'check-all.py constraints — parsed JSON failed[] (real violations, blocking); errors[] reported separately as non-blocking constraint-infra minors (D-w-8: exit code alone conflated infra failures with deck defects)',
    'detect_widows.py — deterministic count',
    'overflow — handout page-count heuristic (CAVEAT: divider-naive, over-counts theme section/title pages; D-w-8)',
    'inventoryRefs whitelist — dropped non-PLAN Source Inventory ids (no-hallucination guard)',
  ],
  notChecked: [
    'per-slide convention / notes-coverage / source-fidelity — SEMANTIC (LLM reviewers, OUTSIDE the deterministic floor; the primary arbiter)',
    'PLAN Slide Spec row↔slide JOIN — semantic; appendix slides without a row are PARTIAL by design, not verified-absent',
    disc.lookAtPath ? null : 'visual-defect detection — look_at.py UNRESOLVED → diagrams NOT visually verified (skipped, not passed)',
    'spelled-out / non-F·T·R·A-token claims — the inventory floor only sees F/T/R/A id tokens',
  ].filter(Boolean),
}

return {
  overallPass,
  substratePass,
  verdict,
  scope,
  summary: { ...sev, total, blocking, advisoryMinors: sev.minor },
  scoreTable,
  findings: findings.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]),
  reviews: allSlides,                 // raw per-slide objects — pass back as priorReviews on a selective re-run
  diagramReviews,
  mechanical: mech,
  unreliableSlides,                   // slides where a reviewer returned nothing — flag, don't trust
  slidesThatFlagged: allSlides.filter(s => (s.findings || []).length || s.unreliable || s.notesSectionFound === false).map(s => s.slide), // pass as onlyChecks on re-review
  inventoryCoverage: { claimsChecked, claimsGrounded },
  coverageMap,                       // per-slide COVERED/PARTIAL — skill renders .planning/VALIDATION.md directly from this (P18)
}
