// The writing-verify contract, executed rather than asserted about.
//
// Builds a real writing project on disk, runs the deterministic authenticate
// pre-step (`writing_section_index.py --authenticate`), drives the workflow
// script through a shim with NO `import`, NO `process`, NO `Buffer` in scope —
// the constraints the Workflow runtime actually imposes — and then runs the
// `--verify --findings` post-step that owns drift detection now that the
// orchestrator cannot re-stat anything.
//
// The second block is the guarantee the extraction had to preserve: a draft
// mutated AFTER the reviewers ran must lose its findings (they describe bytes
// that no longer exist), zero its finalDraftHash, gain a critical
// artifact-integrity finding, and flip the gate — while an untouched sibling
// section keeps everything.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const COMPILER = ROOT + 'scripts/writing/writing_section_index.py'
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const src = readFileSync(ROOT + 'workflows/writing-verify.js', 'utf8').replace(/^export const meta/m, 'const meta')

const PLAN = `# Article

## Writing Intent
- **Thesis**: T.
- **Audience**: A.
- **Purpose**: P.
- **Hook**: H.
- **Scope**: S.
- **Domain**: legal

## Claims
- **CLAIM-01**: C.

## Counterarguments
- O → response.

## Document Structure
### Introduction
Opening.

### Part I
Argument.

## Claim → Section Map
| Claim | Section |
|---|---|
| CLAIM-01 | Part I |

## Source Plan
- **Bibliography**: references/sources.bib
- **Notebook**: none
- **Notebook URL**: none
- **Key Sources**: case2024

## Section Outputs
| Section | Outline | Draft | Depends On |
|---|---|---|---|
| Introduction | outlines/intro-outline.md | drafts/01-introduction.md | - |
| Part I | outlines/argument.md | drafts/02-argument.md | Introduction |

## Review Surfaces
- Claim and structure coverage.
- Citation fidelity.
`

const TEMPS = []
function fixture() {
  const project = mkdtempSync(join(tmpdir(), 'writing-review-run-'))
  for (const dir of ['.planning/.state', 'outlines', 'drafts', 'references']) mkdirSync(join(project, dir), { recursive: true })
  const planPath = join(project, '.planning/peaceful-engine-plan.md')
  writeFileSync(planPath, PLAN)
  const planHash = createHash('sha256').update(Buffer.from(PLAN, 'utf8')).digest('hex')
  writeFileSync(join(project, '.planning', '.state', 'review.json'), JSON.stringify({
    workflow: 'writing', plan_file: 'peaceful-engine-plan.md', plan_hash: planHash,
    approved_session_id: 'approval-session', approved_at: '2026-07-31T10:00:00.000Z',
    status: 'APPROVED', reviewer_session_id: 'review-session', reviewed_at: '2026-07-31T10:01:00.000Z',
  }))
  writeFileSync(join(project, 'references', 'sources.bib'), '@article{case2024,title={Case}}\n')
  writeFileSync(join(project, 'outlines', 'intro-outline.md'), `---\nimplements: []\nplan_hash: ${planHash}\n---\n- One\n- Two\n- Three\n`)
  writeFileSync(join(project, 'outlines', 'argument.md'), `---\nimplements: [CLAIM-01]\nplan_hash: ${planHash}\n---\n- One\n- Two\n- Three\n`)
  writeFileSync(join(project, 'drafts', '01-introduction.md'), `---\nimplements: []\nplan_hash: ${planHash}\n---\nIntroduction.\n`)
  writeFileSync(join(project, 'drafts', '02-argument.md'), `---\nimplements: [CLAIM-01]\nplan_hash: ${planHash}\n---\nCLAIM-01 argument.\n`)
  TEMPS.push(project)
  return { project, planPath, planHash }
}

// `audit` is the deterministic prose-audit relay; `proseSpanIds` is what the prose reviewer
// claims to have considered. Both are parameterised because the reviewer-integrity rule under
// test is precisely the relationship between them.
function reviewAgent(label, opts = {}) {
  if (label === 'prose-audit') return { sections: Object.entries(opts.audit ?? {}).map(([section, spans]) => ({ section, spans })) }
  if (label.endsWith(':structure')) return { section: label.split(':')[0], check: 'structure', itemsChecked: 4, issues: [{ severity: 'minor', location: 'x:1', quote: 'q', detail: 'd' }], planClaimAdvanced: true, boundary: { firstSentence: 'A.', lastSentence: 'B.', assumesFromPrev: '', handsOffToNext: '', argumentState: '', conceptsIntroduced: [], conceptsUsed: [], coreTerms: [] }, argumentSummary: ['point'] }
  if (label.endsWith(':prose')) return { section: label.split(':')[0], check: 'prose', itemsChecked: 4, issues: [], spanIds: opts.proseSpanIds ?? [] }
  if (label.endsWith(':fidelity')) return { section: label.split(':')[0], check: 'fidelity', itemsChecked: 2, issues: [], spanIds: [] }
  if (label.endsWith(':verify')) return { section: label.split(':')[0], quotesChecked: 0, fabricated: [] }
  if (label === 'L2:transitions') return { transitions: [{ from: 'Introduction', to: 'Part I', verdict: 'SMOOTH', closes: 'A.', opens: 'B.', problem: '', planned: '', suggestion: '' }] }
  if (label === 'L3:document') return { conceptOrderIssues: [], repetition: [], thesisIssues: [], completeness: { claimsAddressed: 'all', counterargsConfronted: 'all', scopeHonored: true, hookDelivered: true, conclusionFollows: true, issues: [] }, reviewSurfaces: [{ surface: 'Claim and structure coverage.', status: 'INSPECTED', evidence: 'e' }, { surface: 'Citation fidelity.', status: 'INSPECTED', evidence: 'e' }] }
  throw new Error(`unexpected agent ${label}`)
}

// `process`, `Buffer`, and `require` are declared as parameters so they shadow the
// Node globals and are `undefined` inside the script — matching the Workflow
// runtime, where `globalThis.process` and `globalThis.Buffer` do not exist. `import()`
// is syntax and cannot be shadowed; tests/workflow-runtime-purity.test.mjs is what
// forbids it, and `import.meta` is a hard SyntaxError in a Function body regardless.
async function exec(args, stub = {}) {
  const trace = { labels: [], prompts: {} }
  const agent = async (prompt, opts = {}) => {
    trace.labels.push(opts.label || '')
    trace.prompts[opts.label || ''] = prompt
    return reviewAgent(opts.label || '', stub)
  }
  const parallel = async (thunks) => Promise.all(thunks.map(t => t()))
  const fn = new AsyncFunction(
    'agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget',
    'process', 'Buffer', 'require', 'module', 'exports',
    src,
  )
  const result = await fn(
    agent, parallel, async () => { throw new Error('unused') }, () => {}, () => {}, args,
    { total: null, spent: () => 0, remaining: () => Infinity },
    undefined, undefined, undefined, undefined, undefined,
  )
  return { result, trace }
}

const py = (...a) => execFileSync('python3', [COMPILER, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

let failures = 0
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`); if (!ok) failures++ }

// ── Clean run ────────────────────────────────────────────────────────────────
{
  const f = fixture()
  const bundle = JSON.parse(py('--authenticate', f.project))
  check('authenticate ok', bundle.ok === true, JSON.stringify(bundle.violations))
  check('bundle has every artifact', Object.keys(bundle.artifacts).sort().join(',') === 'bib,plan,receipt,section:Introduction:draft,section:Introduction:outline,section:Part I:draft,section:Part I:outline', Object.keys(bundle.artifacts).join(','))

  const { result, trace } = await exec({
    projectDir: f.project, projectReal: bundle.projectReal, pluginRoot: '/plug/workflows',
    planPath: bundle.planPath, planHash: bundle.planHash, sectionIndex: bundle.index, artifacts: bundle.artifacts,
  })
  check('agents dispatched', trace.labels.length >= 10, `${trace.labels.length}: ${trace.labels.join(' ')}`)
  check('the deterministic prose audit runs BEFORE the reviewers', trace.labels[0] === 'prose-audit', trace.labels.join(' '))
  check('structure reviewers = 2', trace.labels.filter(l => l.endsWith(':structure')).length === 2)
  check('overallPass true', result.overallPass === true, result.verdict)
  check('verifyRequired flagged', result.verifyRequired === true && result.driftVerified === false)
  check('findings returned', Array.isArray(result.findings) && result.findings.length === 2, String(result.findings?.length))

  const bpath = join(f.project, 'bundle.json'), rpath = join(f.project, 'result.json')
  writeFileSync(bpath, JSON.stringify(bundle)); writeFileSync(rpath, JSON.stringify(result))
  const finalized = JSON.parse(py('--verify', bpath, '--findings', rpath))
  check('post-verify clean', finalized.driftVerified === true && finalized.overallPass === true && finalized.driftedArtifacts.length === 0)
  check('finalPlanHash carried', finalized.finalPlanHash === f.planHash)
  check('finalDraftHash set per section', finalized.sections.every(s => /^[0-9a-f]{64}$/.test(s.finalDraftHash) && /^[0-9a-f]{64}$/.test(s.finalOutlineHash)))
}

// ── Evidence handed over and not cited ───────────────────────────────────────
// The whole point of injecting the audit spans is that ignoring them becomes CHECKABLE. A prose
// reviewer that returns zero spanIds while HARD spans exist for its section did not read the
// evidence — hard spans are provenance leaks and ~0-human-rate corpus tics, so there is no
// reading on which every one is fine and none is worth a mention. It gets the same treatment as
// a reviewer whose quoted evidence turned out to be fabricated.
const HARD_SPAN = { id: 'S001', line: 5, system: 'wikipedia-communication', severity: 'hard', labels: ['AI identity leak'], quote: 'As an AI language model' }
const SOFT_SPAN = { id: 'S001', line: 5, system: 'wikipedia-structural', severity: 'soft', labels: ['filler transition'], quote: 'Moreover,' }
{
  const f = fixture()
  const bundle = JSON.parse(py('--authenticate', f.project))
  const wire = { projectDir: f.project, projectReal: bundle.projectReal, planPath: bundle.planPath, planHash: bundle.planHash, sectionIndex: bundle.index, artifacts: bundle.artifacts }

  const { result: ignored, trace } = await exec(wire, { audit: { 'Part I': [HARD_SPAN] }, proseSpanIds: [] })
  check('the span list is INJECTED into the prose reviewer prompt, not fetched by it',
        /S001/.test(trace.prompts['Part I:prose'] || '') && /As an AI language model/.test(trace.prompts['Part I:prose'] || ''),
        (trace.prompts['Part I:prose'] || '').slice(0, 200))
  check('a section with no spans says so rather than inventing evidence',
        /no spans for this section/.test(trace.prompts['Introduction:prose'] || ''))
  check('ignoring HARD spans marks the section unreliable', ignored.unreliableSections.includes('Part I'), JSON.stringify(ignored.unreliableSections))
  check('the untouched sibling section stays reliable', !ignored.unreliableSections.includes('Introduction'))
  check('the integrity finding says the evidence was ignored, not fabricated',
        ignored.findings.some(x => x.area === 'reviewer-integrity' && x.section === 'Part I' && /cited none of the 1 HARD/.test(x.detail || '')),
        JSON.stringify(ignored.findings.filter(x => x.area === 'reviewer-integrity')))
  check('ignoring the evidence flips the gate', ignored.overallPass === false)
  check('the audit output is returned so a caller can see what was handed over',
        ignored.proseAuditHardSpans === 1 && ignored.proseAudit['Part I'][0].id === 'S001')

  const { result: cited } = await exec(wire, { audit: { 'Part I': [HARD_SPAN] }, proseSpanIds: ['S001'] })
  check('citing the span — even to dismiss it — is reliable', !cited.unreliableSections.includes('Part I') && cited.overallPass === true)

  // SOFT-only is deliberately NOT an integrity failure. Soft spans have a real false-positive
  // rate; a reviewer that reads them and reports nothing may simply be right.
  const { result: softOnly } = await exec(wire, { audit: { 'Part I': [SOFT_SPAN] }, proseSpanIds: [] })
  check('soft-only spans left uncited are not an integrity failure',
        !softOnly.unreliableSections.includes('Part I') && softOnly.overallPass === true,
        JSON.stringify(softOnly.unreliableSections))
}

// ── Drift run: mutate a draft between the workflow and the post-step ─────────
{
  const f = fixture()
  const bundle = JSON.parse(py('--authenticate', f.project))
  const { result } = await exec({
    projectDir: f.project, projectReal: bundle.projectReal, planPath: bundle.planPath,
    planHash: bundle.planHash, sectionIndex: bundle.index, artifacts: bundle.artifacts,
  })
  check('pre-drift verdict clean', result.overallPass === true)
  const draft = join(f.project, 'drafts', '02-argument.md')
  writeFileSync(draft, readFileSync(draft, 'utf8') + '\nmutated during review\n')

  const bpath = join(f.project, 'bundle.json'), rpath = join(f.project, 'result.json')
  writeFileSync(bpath, JSON.stringify(bundle)); writeFileSync(rpath, JSON.stringify(result))
  let final
  try { final = JSON.parse(py('--verify', bpath, '--findings', rpath)) }
  catch (e) { final = JSON.parse(e.stdout) ; check('drift exits non-zero', e.status === 1, `status ${e.status}`) }
  check('drift detected', final.driftedArtifacts.includes('section:Part I:draft'), JSON.stringify(final.driftedArtifacts))
  check('drifted section finalDraftHash zeroed', final.sections.find(s => s.section === 'Part I').finalDraftHash === '')
  check('clean section finalDraftHash intact', /^[0-9a-f]{64}$/.test(final.sections.find(s => s.section === 'Introduction').finalDraftHash))
  check('drifted section findings discarded', !final.findings.some(x => x.section === 'Part I' && x.area !== 'artifact-integrity'), JSON.stringify(final.findings.filter(x => x.section === 'Part I')))
  check('clean section findings survive', final.findings.some(x => x.section === 'Introduction'))
  check('integrity finding appended', final.findings.some(x => x.area === 'artifact-integrity' && x.severity === 'critical'))
  check('gate flipped', final.overallPass === false && final.verdict === 'ISSUES FOUND')
  check('drifted section marked unreliable', final.unreliableSections.includes('Part I'))
}

// ── Document-level drift: the PLAN itself changes mid-review ─────────────────
// This used to raise a critical integrity finding and keep EVERY section's findings. But claim
// mappings, transitions and review surfaces are all derived from the plan, so a finding computed
// before the change describes an artifact that no longer exists — and it was being reported as a
// current, reliable result alongside the refusal.
{
  const f = fixture()
  const bundle = JSON.parse(py('--authenticate', f.project))
  const { result } = await exec({
    projectDir: f.project, projectReal: bundle.projectReal, planPath: bundle.planPath,
    planHash: bundle.planHash, sectionIndex: bundle.index, artifacts: bundle.artifacts,
  })
  check('pre-drift verdict clean (plan case)', result.overallPass === true)
  writeFileSync(bundle.planPath, readFileSync(bundle.planPath, 'utf8') + '\n<!-- edited mid-review -->\n')

  const bpath = join(f.project, 'bundle2.json'), rpath = join(f.project, 'result2.json')
  writeFileSync(bpath, JSON.stringify(bundle)); writeFileSync(rpath, JSON.stringify(result))
  let final
  try { final = JSON.parse(py('--verify', bpath, '--findings', rpath)) }
  catch (e) { final = JSON.parse(e.stdout) }
  check('plan drift detected', final.driftedArtifacts.includes('plan'), JSON.stringify(final.driftedArtifacts))
  check('plan drift raises an integrity finding',
        final.findings.some(x => x.area === 'artifact-integrity' && /generated plan/i.test(x.detail || '')))
  check('EVERY section is marked unreliable when the plan drifts',
        final.sections.every(s => s.unreliable === true), JSON.stringify(final.sections.map(s => [s.section, s.unreliable])))
  check('no stale per-section finding survives plan drift',
        !final.findings.some(x => x.section && x.area !== 'artifact-integrity'),
        JSON.stringify(final.findings.filter(x => x.section && x.area !== 'artifact-integrity')))
  check('gate flipped on plan drift', final.overallPass === false)
}

for (const dir of TEMPS) rmSync(dir, { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall smoke checks passed')
// EXIT ONLY ON FAILURE. `process.exit(0)` here is not a no-op: under `bun test` every file shares ONE
// process, so a success-path exit TERMINATES THE RUN and bun reports exit 0 for the whole floor.
// This file sorts near-last, so its clean exit was overwriting the aggregate verdict: measured, the
// floor exited 0 while `workflow-creator-compiler` was failing inside it — a red suite reporting
// green. Three sibling files already carry this comment; this one was written without it.
if (failures) process.exit(1)
