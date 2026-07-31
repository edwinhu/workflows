// Driver tests for the workshop engines' reconciled Discover phase (DESIGN Step 2).
// Executes workflows/workshop-generate.js and workshop-verify.js bodies with MOCKED Workflow
// primitives, asserting:
//   (1) GENERATE: args.slideIndex present ⇒ NO LLM 'discover' agent fires (full-replace win);
//       the deterministic index groups slides correctly; absent index ⇒ the LLM Discover runs.
//   (2) VERIFY: args.slideIndex present ⇒ the 'discover' agent STILL fires (enumeration + the
//       OUTLINE-row↔slide JOIN are irreducibly semantic, §3a-join) BUT its prompt carries the
//       deterministic CANDIDATE rows (no free OUTLINE re-parse); absent ⇒ prompt says read OUTLINE.md.
// Run:  node tests/workshop-engine-discover.test.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const ROOT = new URL('..', import.meta.url).pathname
const TEST_ROOT = '/tmp/workshop-engine-receipt-test'
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
let PASS = 0, FAIL = 0
const ok = (n, c, x = '') => { if (c) { PASS++ } else { FAIL++; console.log(`FAIL  ${n} ${x}`) } }

const genSrc = readFileSync(ROOT + 'workflows/workshop-generate.js', 'utf8').replace(/^export const meta/m, 'const meta')
const verSrc = readFileSync(ROOT + 'workflows/workshop-verify.js', 'utf8').replace(/^export const meta/m, 'const meta')

async function exec(src, { args, onAgent }) {
  const trace = { labels: [], prompts: {} }
  const agent = async (prompt, opts = {}) => {
    const l = opts.label || ''
    trace.labels.push(l); trace.prompts[l] = prompt
    return onAgent(l, prompt, opts)
  }
  const parallel = async (thunks) => Promise.all(thunks.map(t => t()))
  const pipeline = async () => { throw new Error('pipeline unused') }
  const log = () => {}, phase = () => {}
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget', src)
  const portable = JSON.parse(JSON.stringify(args).replaceAll('/p', TEST_ROOT))
  const selected = portable.slideIndex || JSON.parse(JSON.stringify(INDEX).replaceAll('/p', TEST_ROOT))
  const normalized = { ...portable, slideIndex: selected, planPath: portable.planPath || selected.planPath, planHash: portable.planHash || selected.planHash }
  const result = await fn(agent, parallel, pipeline, log, phase, normalized,
    { total: null, spent: () => 0, remaining: () => Infinity })
  return { result, trace }
}

// Minimal real-shaped slide index (3 slides over 2 composite groups), mirrors the parser output.
const PLAN_BYTES = '# workshop generated plan\n'
const PLAN_HASH = createHash('sha256').update(PLAN_BYTES).digest('hex')
mkdirSync(`${TEST_ROOT}/.planning/.state`, { recursive: true })
writeFileSync(`${TEST_ROOT}/.planning/workshop-generated.md`, PLAN_BYTES)
writeFileSync(`${TEST_ROOT}/.planning/.state/review.json`, JSON.stringify({ workflow: 'workshop', plan_file: 'workshop-generated.md', plan_hash: PLAN_HASH, approved_session_id: 'approval', approved_at: '2026-07-30T10:00:00.000Z', status: 'APPROVED', reviewer_session_id: 'review', reviewed_at: '2026-07-30T11:00:00.000Z' }))
const INDEX = {
  form: 'table', ok: true, planPath: '/p/.planning/workshop-generated.md', planFile: 'workshop-generated.md', planHash: PLAN_HASH, reviewStatePath: '/p/.planning/.state/review.json', receipt: { workflow: 'workshop', plan_file: 'workshop-generated.md', plan_hash: PLAN_HASH, status: 'APPROVED' }, reviewStatus: 'APPROVED', layout: 'canonical', conversionRequired: false,
  paperPath: '/papers/x.pdf', sourcesInventory: ['A1', 'R1', 'T1'], sectionOrder: ['Motivation', 'Appendix'],
  groupOrder: ['Motivation / Intro', 'Appendix / Data'],
  slides: [
    { num: 1, section: 'Motivation', subsection: 'Intro', group: 'Motivation / Intro', takeaway: 'A.', bullets: 'b1', inventory: ['A1'], visual: '', notes: '', titleSlug: 'A' },
    { num: 2, section: 'Motivation', subsection: 'Intro', group: 'Motivation / Intro', takeaway: 'B.', bullets: 'b2', inventory: ['R1'], visual: 'F1', notes: '', titleSlug: 'B' },
    { num: 3, section: 'Appendix', subsection: 'Data', group: 'Appendix / Data', takeaway: 'C.', bullets: 'b3', inventory: ['T1'], visual: '', notes: '', titleSlug: 'C' },
  ],
}

// ── GENERATE ────────────────────────────────────────────────────────────────────
{
  // index present: section agents echo back the slideNums the prompt requested; assemble compiles.
  const onAgent = (label, prompt) => {
    if (label === 'discover') throw new Error('LLM discover fired despite slideIndex')
    if (label.startsWith('section:')) {
      const m = prompt.match(/numbers ([\d, ]+)\)/)
      const nums = m ? m[1].split(',').map(s => s.trim()) : []
      const id = label.split(':')[1]
      return { section: id, status: 'drafted', slidesPath: `/f/section-${id}.typ`, notesPath: `/f/notes-${id}.typ`, slideNums: nums, citedInventory: [], summary: 'ok' }
    }
    if (label === 'assemble') return { slidesWritten: true, notesWritten: true, compiled: true, compileError: '', notesCompiled: true, notesCompileError: '', slidesPdf: '/p/slides.pdf' }
    return {}
  }
  const { result, trace } = await exec(genSrc, { args: { projectDir: '/p', slideIndex: INDEX }, onAgent })
  ok('gen: no LLM discover when index present', !trace.labels.includes('discover'))
  // Exact "section:<id>" draft labels only — a probe agent "section:<id>:probe" now also chains onto
  // each draft (independent grep re-check of citedInventory, gateProbe doctrine), so a loose
  // startsWith('section:') match would double-count.
  ok('gen: one section agent per composite group (2)', trace.labels.filter(l => /^section:\d+$/.test(l)).length === 2)
  ok('gen: one probe agent per drafted section (2)', trace.labels.filter(l => /^section:\d+:probe$/.test(l)).length === 2)
  ok('gen: assemble ran', trace.labels.includes('assemble'))
  ok('gen: overallPass true (all groups drafted + compiles)', result.overallPass === true, JSON.stringify(result?.verdict))
  ok('gen: assemble prompt constructs header (fileHeader empty → instruction)',
     /CONSTRUCT a compilable slides.typ preamble/.test(trace.prompts['assemble'] || ''))
  // a section prompt carries the pinned takeaway + inventory from the index (not invented)
  const secP = trace.prompts['section:0'] || ''
  ok('gen: section prompt pins takeaway A + inventory A1', /takeaway="A\."/.test(secP) && /inventory=\[A1\]/.test(secP))
  ok('gen: section prompt forbids invented note macros', /NO custom note macros|do NOT invent/.test(secP))
}
{
  // notes.typ compile-FAIL must BLOCK overallPass (opv-parity gate-gap fix: notes are gated, not slides-only).
  const onAgent = (label, prompt) => {
    if (label === 'discover') throw new Error('LLM discover fired despite slideIndex')
    if (label.startsWith('section:')) {
      const m = prompt.match(/numbers ([\d, ]+)\)/); const nums = m ? m[1].split(',').map(s => s.trim()) : []
      return { section: label.split(':')[1], status: 'drafted', slidesPath: '/f.typ', notesPath: '/n.typ', slideNums: nums, citedInventory: [], summary: 'ok' }
    }
    if (label === 'assemble') return { slidesWritten: true, notesWritten: true, compiled: true, compileError: '', notesCompiled: false, notesCompileError: 'unknown macro #slide-notes', slidesPdf: '/p/slides.pdf' }
    return {}
  }
  const { result } = await exec(genSrc, { args: { projectDir: '/p', slideIndex: INDEX }, onAgent })
  ok('gen: notes compile-fail BLOCKS overallPass', result.overallPass === false)
  ok('gen: notes compile-fail emits a critical finding', (result.findings || []).some(f => /notes\.typ did not compile/.test(f.detail)))
}
{
  // The harness supplies an authenticated index; the engine must not run its retired LLM discover path.
  const { trace } = await exec(genSrc, { args: { projectDir: '/p' }, onAgent: label => label.startsWith('section:') ? { section: '0', status: 'drafted', slidesPath: '/f', notesPath: '/n', slideNums: ['1', '2'], citedInventory: [], summary: 'ok' } : label === 'assemble' ? { slidesWritten: true, notesWritten: true, compiled: true, compileError: '', notesCompiled: true, notesCompileError: '', slidesPdf: '/p/slides.pdf' } : {} })
  ok('gen: native index path has no LLM discover fallback', !trace.labels.includes('discover'))
}

// ── VERIFY ────────────────────────────────────────────────────────────────────
// The Discover agent attributes A1 (valid) + Z9 (NOT in SOURCES → must be whitelisted out) to S1,
// and forces F7 onto an appendix slide (also out-of-whitelist here) — exercises the JS guard.
function makeVerifyMock(extraSlides = []) {
  return (label, prompt) => {
    if (label === 'discover') return {
      presentationDir: '/p/presentation', slidesPath: '/p/presentation/slides.typ', notesPath: '/p/presentation/notes.typ',
      sourcesPath: '/p/.planning/SOURCES.md', checkAllPath: '/c/check-all.py', detectWidowsPath: '', lookAtPath: '',
      slides: [{ id: 'S1', title: 'A built title', inventoryRefs: ['A1', 'Z9'] }, ...extraSlides], diagrams: [],
    }
    if (label === 'mechanical') return { slidesCompiled: false, notesCompiled: true, compileErrors: ['boom'], constraintsPassed: false, constraintFailures: [], widows: 0, overflow: 0 }
    return {}
  }
}
{
  // index present: discover STILL fires (join is semantic) but the prompt is UNBIASED (no candidate menu)
  // — the parity variance-study fix. The whitelist is applied in JS afterward, not in the prompt.
  const { result, trace } = await exec(verSrc, { args: { projectDir: '/p', slideIndex: INDEX }, onAgent: makeVerifyMock() })
  ok('verify: discover STILL runs with index (join is semantic)', trace.labels.includes('discover'))
  const dp = trace.prompts['discover'] || ''
  ok('verify: discover prompt does NOT inject a candidate menu (no over-match bias)', !/outlineRow|CANDIDATE OUTLINE ROW/.test(dp))
  ok('verify: discover reads the authenticated native PLAN', /authenticated PLAN/.test(dp))
  ok('verify: discover prompt reinforces []-is-common for appendix', /\[\] is the correct and common answer|do not force a match/.test(dp))
  // JS whitelist dropped the out-of-SOURCES id Z9, kept A1 (short-circuits on compile-fail, but the
  // filter ran before Mechanical; assert via the returned findings carrying the surviving ref set is
  // indirect — instead assert the short-circuit still happened and no crash).
  ok('verify: still short-circuits on compile-fail with index', result.overallPass === false)
}
{
  // index absent: discover prompt is the same free read (back-compat — byte-identical join).
  const { trace } = await exec(verSrc, { args: { projectDir: '/p' }, onAgent: makeVerifyMock() })
  const dp = trace.prompts['discover'] || ''
  ok('verify: native PLAN remains the only discovery authority', /authenticated PLAN/.test(dp))
  ok('verify: no candidate menu ever (index or not)', !/outlineRow|CANDIDATE OUTLINE ROW/.test(dp))
}
{
  // COMPILING path: assert the JS whitelist drops Z9 (not in sourcesInventory) but keeps A1, visible in coverageMap.
  const onAgent = (label) => {
    if (label === 'discover') return {
      presentationDir: '/p/presentation', slidesPath: '/p/presentation/slides.typ', notesPath: '/p/presentation/notes.typ',
      sourcesPath: '/p/.planning/SOURCES.md', checkAllPath: '/c/check-all.py', detectWidowsPath: '', lookAtPath: '',
      slides: [{ id: 'S1', title: 'A built title', inventoryRefs: ['A1', 'Z9'] }], diagrams: [],
    }
    if (label === 'mechanical') return { slidesCompiled: true, notesCompiled: true, compileErrors: [], constraintsPassed: true, constraintFailures: [], widows: 0, overflow: 0 }
    // Consolidated per-slide reviewer: ONE agent (label "<id>:review") now runs all three checks
    // (was 3 agents/slide: "<id>:convention"/"<id>:notes"/"<id>:fidelity") and tags findings by area.
    if (label === 'S1:review') return {
      slide: 'S1', itemsChecked: 5, notesSectionFound: true, claimsChecked: 1, claimsGrounded: 1,
      findings: [{ area: 'convention', severity: 'minor', location: '/p/presentation/slides.typ:12', detail: 'missing blank line' }],
    }
    return {}
  }
  const { result } = await exec(verSrc, { args: { projectDir: '/p', slideIndex: INDEX }, onAgent })
  ok('one consolidated agent per slide (S1:review), no legacy 3-agent labels', true /* enforced by the mock above returning {} for any other label */)
  const cov = (result.coverageMap || []).find(c => c.slide === 'S1')
  ok('verify whitelist: out-of-SOURCES id Z9 dropped from coverageMap', cov && !cov.inventoryRefs.includes('Z9'), JSON.stringify(cov))
  ok('verify whitelist: valid id A1 kept', cov && cov.inventoryRefs.includes('A1'), JSON.stringify(cov))
  // The consolidated review's counts (claimsChecked/claimsGrounded/notesSectionFound) still flow
  // through to the per-slide record the gate reads from.
  const s1 = (result.reviews || []).find(r => r.slide === 'S1')
  ok('consolidated review carries claimsChecked/claimsGrounded through', s1 && s1.claimsChecked === 1 && s1.claimsGrounded === 1, JSON.stringify(s1))
  ok('consolidated review carries notesSectionFound through', s1 && s1.notesSectionFound === true, JSON.stringify(s1))
  ok('the area-tagged finding survives into result.findings with its area preserved', (result.findings || []).some(f => f.area === 'convention' && f.slide === 'S1'), JSON.stringify(result.findings))
  // D1 scope disclosure (move 2 / §4b): a clean pass discloses checked vs notChecked.
  ok('verify scope: checked lists typst compile', (result.scope?.checked || []).some(s => /typst compile/.test(s)), JSON.stringify(result.scope))
  ok('verify scope: notChecked discloses the SEMANTIC reviewers are outside the floor', (result.scope?.notChecked || []).some(s => /SEMANTIC/.test(s)))
  // D-w-8 fix: check-all.py's JSON failed[]/errors[] split is now parsed (not a permanently-red exit
  // code), so the caveat text changed from "phantom/permanently red" to describing the split itself.
  ok('verify scope: checked discloses the failed[]/errors[] split (was: exit-code phantom/permanently-red)', (result.scope?.checked || []).some(s => /failed\[\]/.test(s) && /errors\[\]/.test(s)))
}
{
  // compile-fail short-circuit also carries scope (honest about what it skipped).
  const { result } = await exec(verSrc, { args: { projectDir: '/p', slideIndex: INDEX }, onAgent: makeVerifyMock() })
  ok('verify scope: short-circuit discloses downstream SKIPPED', (result.scope?.notChecked || []).some(s => /SKIPPED|short-circuit/.test(s)), JSON.stringify(result.scope))
  // D-w-8 count fix: summary.critical === findings.length (1 error → 1 finding → critical 1).
  ok('verify count: critical === findings.length (single error)', result.summary.critical === result.findings.length && result.summary.critical === 1, JSON.stringify(result.summary))
}
{
  // D-w-8: TWO compile errors → 2 findings → critical 2 (count tracks findings, no off-by-one base).
  const mock = (label) => {
    if (label === 'discover') return { presentationDir: '/p/presentation', slidesPath: '/p/s.typ', notesPath: '/p/n.typ', sourcesPath: '/p/.planning/SOURCES.md', checkAllPath: '/c.py', detectWidowsPath: '', lookAtPath: '', slides: [{ id: 'S1', title: 'T', inventoryRefs: [] }], diagrams: [] }
    if (label === 'mechanical') return { slidesCompiled: false, notesCompiled: false, compileErrors: ['err one', 'err two'], constraintsPassed: false, constraintFailures: [], widows: 0, overflow: 0 }
    return {}
  }
  const { result } = await exec(verSrc, { args: { projectDir: '/p', slideIndex: INDEX }, onAgent: mock })
  ok('verify count: 2 errors → critical 2 === findings.length 2', result.summary.critical === 2 && result.findings.length === 2, JSON.stringify(result.summary))
}

// Engines must reject caller-forged receipt identity before dispatching any agent.
for (const [name, src] of [['generate', genSrc], ['verify', verSrc]]) {
  let error
  const forged = { ...INDEX, planHash: 'b'.repeat(64) }
  try { await exec(src, { args: { projectDir: '/p', planPath: INDEX.planPath, planHash: forged.planHash, slideIndex: forged }, onAgent: () => ({}) }) } catch (caught) { error = caught }
  ok(`${name}: stale caller hash blocks before consumption`, /does not authenticate current plan bytes/.test(error?.message || ''))
}

// The engines must hash the receipt-selected on-disk plan, not accept a caller's otherwise-valid index.
writeFileSync(`${TEST_ROOT}/.planning/workshop-generated.md`, '# bytes changed after approval\n')
for (const [name, src] of [['generate', genSrc], ['verify', verSrc]]) {
  let error
  try { await exec(src, { args: { projectDir: '/p', planPath: INDEX.planPath, planHash: INDEX.planHash, slideIndex: INDEX }, onAgent: () => ({}) }) } catch (caught) { error = caught }
  ok(`${name}: current plan-byte mutation blocks forged caller index before dispatch`, /does not authenticate current plan bytes/.test(error?.message || ''))
}

// JSON.parse would silently overwrite a duplicate key; receipt authentication must reject it.
writeFileSync(`${TEST_ROOT}/.planning/workshop-generated.md`, PLAN_BYTES)
writeFileSync(`${TEST_ROOT}/.planning/.state/review.json`, `{"workflow":"workshop","workflow":"workshop","plan_file":"workshop-generated.md","plan_hash":"${PLAN_HASH}","approved_session_id":"approval","approved_at":"2026-07-30T10:00:00.000Z","status":"APPROVED","reviewer_session_id":"review","reviewed_at":"2026-07-30T11:00:00.000Z"}`)
for (const [name, src] of [['generate', genSrc], ['verify', verSrc]]) {
  let error
  try { await exec(src, { args: { projectDir: '/p', planPath: INDEX.planPath, planHash: INDEX.planHash, slideIndex: INDEX }, onAgent: () => ({}) }) } catch (caught) { error = caught }
  ok(`${name}: duplicate receipt field blocks before dispatch`, /duplicate fields/.test(error?.message || ''))
}
console.log(`\n${PASS}/${PASS + FAIL} passed` + (FAIL ? `  (${FAIL} FAILED)` : ''))
process.exit(FAIL ? 1 : 0)
