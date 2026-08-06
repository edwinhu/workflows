// The writing engines are pure control flow: the Workflow runtime rejects `import()`,
// `import.meta`, `process`, and `Buffer`, so neither script can open, hash, or re-stat a
// file. Every test here therefore drives the real three-step contract —
//   1. authenticate  (`writing_section_index.py --authenticate <project>`)
//   2. dispatch      (the workflow, over the bundle, with no filesystem in scope)
//   3. verify        (`writing_section_index.py --verify <bundle> --findings <result>`)
// — rather than a harness that hands the script an environment it will never have. Checks
// that used to run inside the orchestrator are asserted in whichever layer now owns them:
// TOCTOU snapshotting and drift in the Python pre/post-step, and every pure data
// comparison (receipt schema, PLAN grammar, path identity, claim mapping) still in the JS.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'bun:test'

const ROOT = new URL('..', import.meta.url).pathname
const COMPILER = ROOT + 'scripts/writing/writing_section_index.py'
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const draftSrc = readFileSync(ROOT + 'workflows/writing-draft.js', 'utf8').replace(/^export const meta/m, 'const meta')
const reviewSrc = readFileSync(ROOT + 'workflows/writing-verify.js', 'utf8').replace(/^export const meta/m, 'const meta')

// The compiler exits non-zero whenever it refuses (failed authentication, detected drift);
// those are the interesting cases, so the exit status is captured with the payload instead
// of thrown away.
function compiler(...argv) {
  try { return { payload: JSON.parse(execFileSync('python3', [COMPILER, ...argv], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })), status: 0 } }
  catch (error) { return { payload: JSON.parse(error.stdout), status: error.status } }
}
// `drafts` selects which section drafts belong in the ENTRY bundle, and it is the
// difference between an input and an output. writing-verify authenticates every draft
// (default `all`). A full writing-draft run authenticates NONE — those files are what the
// run produces, and a pre-run snapshot of one would be reported as drift the moment the
// drafting agent legitimately rewrote it. A selective retry authenticates exactly the
// CARRIED sections' drafts.
const authenticate = (project, drafts) => compiler('--authenticate', project, ...(drafts ? ['--drafts', drafts] : []))

// The rule above, applied once rather than restated at twenty call sites: a drafting run
// authenticates the drafts it is NOT redrafting.
function draftsFor(src, args) {
  if (src !== draftSrc) return undefined
  const only = Array.isArray(args.onlyChecks) ? args.onlyChecks.map(String) : []
  if (!only.length) return 'none'
  const carried = (args.sectionIndex?.sections || []).map(section => String(section.name)).filter(name => !only.includes(name))
  return carried.length ? carried.join(',') : 'none'
}

// The post-step: re-snapshot every authenticated artifact and finalize the provisional
// verdict the workflow returned. This is where drift detection lives now — the workflow
// cannot re-stat anything, which is exactly what its `verifyRequired: true` announces.
function finalize(bundle, result) {
  const scratch = mkdtempSync(join(tmpdir(), 'writing-engine-verify-'))
  TEMPS.push(scratch)
  const bundlePath = join(scratch, 'bundle.json')
  const resultPath = join(scratch, 'result.json')
  writeFileSync(bundlePath, JSON.stringify(bundle))
  writeFileSync(resultPath, JSON.stringify(result))
  return compiler('--verify', bundlePath, '--findings', resultPath)
}

// A bundle whose receipt snapshot carries different bytes than the pre-step read. The
// pre-step is trusted to deliver BYTES and nothing more: every statement about what those
// bytes SAY is re-derived inside the workflow, and these helpers are how that boundary is
// exercised directly (the pre-step itself refuses these inputs — asserted alongside).
const withReceiptText = (bundle, text) => ({
  ...bundle,
  artifacts: { ...bundle.artifacts, receipt: { ...bundle.artifacts.receipt, text, hash: createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex') } },
})
const withReceiptReal = (bundle, real) => ({
  ...bundle,
  artifacts: { ...bundle.artifacts, receipt: { ...bundle.artifacts.receipt, real } },
})

// `process`, `Buffer`, `require`, `module`, and `exports` are declared as trailing
// parameters so they are `undefined` inside the script — matching the Workflow runtime,
// where those globals do not exist. (`import()` and `import.meta` are syntax, not
// bindings, and cannot be shadowed; tests/workflow-runtime-purity.test.mjs forbids them.)
async function exec(src, { args, onAgent = () => ({}), bundle, drafts }) {
  const trace = { labels: [], prompts: [] }
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || ''
    trace.labels.push(label)
    trace.prompts.push(String(prompt))
    return onAgent(label, prompt, opts)
  }
  const parallel = async (thunks) => Promise.all(thunks.map((thunk) => thunk()))
  const pipeline = async () => { throw new Error('pipeline unused') }
  const log = () => {}
  const phase = () => {}
  const fn = new AsyncFunction(
    'agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget',
    'process', 'Buffer', 'require', 'module', 'exports',
    src,
  )
  // Authentication happens immediately before dispatch, as the skill runs it, so a test
  // that mutates the project between fixture() and exec() is authenticated as mutated.
  const auth = bundle || authenticate(args.projectDir, drafts ?? draftsFor(src, args)).payload
  const result = await fn(
    agent, parallel, pipeline, log, phase,
    { projectReal: auth.projectReal, artifacts: auth.artifacts, ...args },
    { total: null, spent: () => 0, remaining: () => Infinity },
    undefined, undefined, undefined, undefined, undefined,
  )
  return { result, trace, bundle: auth }
}

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
// `withDrafts: false` is a project that has been planned and outlined but never drafted —
// the state a FIRST writing-draft run actually starts from.
function fixture({ withDrafts = true } = {}) {
  // Resolved path: every authenticated artifact path is compared against a path built from
  // bundle.projectReal, so the fixture must speak in resolved paths too.
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'writing-engine-')))
  TEMPS.push(project)
  for (const dir of ['.planning/.state', 'outlines', 'drafts', 'references']) mkdirSync(join(project, dir), { recursive: true })
  const planFile = '.planning/peaceful-engine-plan.md'
  const planPath = join(project, planFile)
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
  if (withDrafts) {
    writeFileSync(join(project, 'drafts', '01-introduction.md'), `---\nimplements: []\nplan_hash: ${planHash}\n---\nIntroduction.\n`)
    writeFileSync(join(project, 'drafts', '02-argument.md'), `---\nimplements: [CLAIM-01]\nplan_hash: ${planHash}\n---\nCLAIM-01 argument.\n`)
  }
  // The section index is no longer hand-built: it comes from the same deterministic
  // compiler run that authenticates the artifacts, which is the only index the engines
  // will ever be handed in production.
  const { payload, status } = authenticate(project, withDrafts ? undefined : 'none')
  if (status !== 0 || payload.ok !== true) throw new Error(`fixture failed to authenticate: ${JSON.stringify(payload.violations)}`)
  return { project, planFile, planPath, planHash, bundle: payload, index: payload.index }
}

function draftAgentFor(f, { wrongHash = false, wrongPath = false, skipWrite = false } = {}) {
  return (label) => {
    if (label.startsWith('verify:')) {
      return {
        section: label.slice(7), coverageOk: true, fidelityOk: true, transitionOk: true,
        findings: [], boundary: { firstSentence: 'First.', lastSentence: 'Last.' },
      }
    }
    const spec = f.index.sections.find((section) => section.name === label)
    const claims = spec.primaryClaims.join(', ')
    const content = `---\nimplements: [${claims}]\nplan_hash: ${wrongHash ? 'f'.repeat(64) : f.planHash}\n---\n${claims || 'Introduction'} prose body.\n`
    if (!skipWrite) writeFileSync(spec.draftFile, content)
    return {
      section: label,
      draftFile: wrongPath ? join(f.project, 'drafts', 'wrong.md') : spec.draftFile,
      status: 'drafted', content, pointsExpanded: 3, summary: 'advances PLAN claims',
    }
  }
}

// A full drafting run, FINALIZED — the only form a prior result may be carried forward in.
// A live section's draft is an OUTPUT: the workflow returns `draftHash: ''` for it because
// it cannot hash a file, and the post-step is what reads each `pendingDraftVerification`
// section's draftFile, confirms the bytes equal that row's `reportedContent`, and records
// the hash. A selective retry then re-authenticates and requires the carried section's
// prior draftHash to equal the bytes the pre-step opened.
async function carriedRun(f) {
  const full = await exec(draftSrc, {
    args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
    onAgent: draftAgentFor(f),
  })
  expect(full.result.verifyRequired).toBe(true)
  const { payload: final, status } = finalize(full.bundle, full.result)
  // The GATE, not just the hashes. A draftHash can be filled in while overallPass is false
  // from drift the run itself caused — asserting only the hash is what let a bundle
  // carrying pre-run draft snapshots ship.
  expect(status).toBe(0)
  expect(final.overallPass).toBe(true)
  expect(final.verdict).toBe('DRAFTED')
  expect(final.driftedArtifacts).toEqual([])
  expect(final.unverifiedOutputs).toEqual([])
  for (const review of final.reviews) {
    expect(review.draftHash, `${review.section} draftHash must be filled in by the post-step`).toMatch(/^[0-9a-f]{64}$/)
  }
  return final
}

function reviewAgent(label, { missingSurface = false } = {}) {
  // The deterministic prose audit runs before the reviewers and its spans are injected into the
  // prose reviewer's prompt. These fixtures have clean drafts, so an empty relay is the honest
  // stub: no spans handed over means nothing for a reviewer to have ignored.
  if (label === 'prose-audit') return { sections: [{ section: 'Introduction', spans: [] }, { section: 'Part I', spans: [] }] }
  if (label.endsWith(':structure')) {
    return {
      section: label.split(':')[0], check: 'structure', itemsChecked: 4, issues: [],
      planClaimAdvanced: true,
      boundary: {
        firstSentence: 'A.', lastSentence: 'B.', assumesFromPrev: '', handsOffToNext: '',
        argumentState: '', conceptsIntroduced: [], conceptsUsed: [], coreTerms: [],
      },
      argumentSummary: ['point'],
    }
  }
  if (label.endsWith(':prose')) return { section: label.split(':')[0], check: 'prose', itemsChecked: 4, issues: [], spanIds: [] }
  if (label.endsWith(':fidelity')) return { section: label.split(':')[0], check: 'fidelity', itemsChecked: 2, issues: [], spanIds: [] }
  if (label.endsWith(':verify')) return { section: label.split(':')[0], quotesChecked: 0, fabricated: [] }
  if (label === 'L2:transitions') return { transitions: [{ from: 'Introduction', to: 'Part I', verdict: 'SMOOTH', closes: 'A.', opens: 'B.', problem: '', planned: '', suggestion: '' }] }
  if (label === 'L3:document') {
    return {
      conceptOrderIssues: [], repetition: [], thesisIssues: [],
      completeness: {
        claimsAddressed: 'all', counterargsConfronted: 'all', scopeHonored: true,
        hookDelivered: true, conclusionFollows: true, issues: [],
      },
      reviewSurfaces: missingSurface
        ? [{ surface: 'Claim and structure coverage.', status: 'INSPECTED', evidence: 'section results' }]
        : [
            { surface: 'Claim and structure coverage.', status: 'INSPECTED', evidence: 'section results' },
            { surface: 'Citation fidelity.', status: 'INSPECTED', evidence: 'fidelity results' },
          ],
    }
  }
  throw new Error(`unexpected agent ${label}`)
}

function priorSection(section, planHash, project) {
  const outlinePath = section === 'Part I' ? join(project, 'outlines', 'argument.md') : join(project, 'outlines', 'intro-outline.md')
  const draftPath = section === 'Part I' ? join(project, 'drafts', '02-argument.md') : join(project, 'drafts', '01-introduction.md')
  return {
    section,
    planHash,
    outlineHash: createHash('sha256').update(readFileSync(outlinePath)).digest('hex'),
    draftHash: createHash('sha256').update(readFileSync(draftPath)).digest('hex'),
    // The bibliography is part of what a fidelity result depends on, so it is part of what
    // authenticates carrying that result forward — plan, outline and draft can all be untouched
    // while references/sources.bib changes underneath them. `workflows/writing-verify.js` began
    // requiring `bibHash` on a carried prior review; this fixture was never updated to emit it, so
    // the carry-forward case rejected its own valid input and the suite shipped red.
    bibHash: createHash('sha256').update(readFileSync(join(project, 'references', 'sources.bib'))).digest('hex'),
    issues: [],
    boundary: { firstSentence: 'A.', lastSentence: 'B.' },
    argumentSummary: ['point'],
    unreliable: false,
    planClaims: section === 'Part I' ? 'CLAIM-01' : 'Introduction',
  }
}

describe('writing-draft authenticated PLAN discovery', () => {
  test('requires planPath, planHash, and deterministic index', async () => {
    const { project } = fixture()
    await expect(exec(draftSrc, { args: { projectDir: project } })).rejects.toThrow(/requires args\.planPath/)
  })

  // The run the whole three-step contract exists to make possible, and the case whose
  // absence let a broken pre-step ship: a project that has been planned and outlined but
  // never drafted, drafted once, and finalized. Everything must be clean end to end —
  // authentication, the workflow's provisional verdict, and the finalized gate.
  test('a first full drafting run authenticates, drafts, and finalizes clean', async () => {
    const f = fixture({ withDrafts: false })
    expect(f.bundle.ok).toBe(true)
    expect(f.bundle.draftsAuthenticated).toEqual([])
    // The drafts are OUTPUTS: nothing may vouch for them at entry.
    expect(Object.keys(f.bundle.artifacts).filter(key => key.endsWith(':draft'))).toEqual([])
    expect(Object.keys(f.bundle.artifacts).filter(key => key.endsWith(':outline')).sort()).toEqual(['section:Introduction:outline', 'section:Part I:outline'])

    const { result, bundle } = await exec(draftSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: draftAgentFor(f),
    })
    expect(result.overallPass).toBe(true)
    expect(result.verdict).toBe('DRAFTED')
    // Provisional until the post-step reads the files the agents claim to have written.
    expect(result.verifyRequired).toBe(true)
    expect(result.driftVerified).toBe(false)
    expect(result.pendingDraftVerification).toEqual(['Introduction', 'Part I'])
    expect(result.reviews.every(review => review.draftHash === '')).toBe(true)

    const { payload: final, status } = finalize(bundle, result)
    expect(status).toBe(0)
    expect(final.driftVerified).toBe(true)
    expect(final.verifyRequired).toBe(false)
    expect(final.overallPass).toBe(true)
    expect(final.verdict).toBe('DRAFTED')
    expect(final.driftedArtifacts).toEqual([])
    expect(final.unverifiedOutputs).toEqual([])
    expect(final.pendingDraftVerification).toEqual([])
    expect(final.findings).toEqual([])
    expect(final.finalPlanHash).toBe(f.planHash)
    for (const review of final.reviews) expect(review.draftHash).toMatch(/^[0-9a-f]{64}$/)
    // The recorded hash is the file's, not the agent's echo.
    for (const row of final.sections) {
      expect(row.contentAuthenticated).toBe(true)
      expect(row.finalDraftHash).toBe(createHash('sha256').update(readFileSync(row.draftFile)).digest('hex'))
    }
  })

  // The selection itself must fail closed: a carried-section name that is not in the
  // current PLAN would otherwise silently authenticate nothing and leave the workflow
  // asking for an artifact the bundle never had.
  test('rejects a drafts selection that names a section outside the PLAN', async () => {
    const f = fixture()
    const { payload, status } = authenticate(f.project, 'Introduction,Part IX')
    expect(status).toBe(1)
    expect(payload.ok).toBe(false)
    expect(payload.violations.join(' ')).toMatch(/not in the current PLAN.*Part IX/)
    expect(payload.artifacts).toEqual({})
  })

  test('rejects a stale index before dispatch', async () => {
    const f = fixture()
    await expect(exec(draftSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: 'b'.repeat(64), sectionIndex: f.index },
    })).rejects.toThrow(/malformed or stale/)
  })

  test('uses exact PLAN output paths and returns hash-bound reviews', async () => {
    const f = fixture()
    const { result, trace } = await exec(draftSrc, {
      args: { projectDir: f.project, pluginRoot: '/plug/workflows', planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: draftAgentFor(f),
    })
    expect(trace.labels).not.toContain('discover')
    expect(result.overallPass).toBe(true)
    expect(result.planHash).toBe(f.planHash)
    expect(result.reviews.every((review) => review.planHash === f.planHash)).toBe(true)
    expect(trace.prompts.join('\n')).toContain(join(f.project, 'drafts', '01-introduction.md'))
    expect(trace.prompts.join('\n')).not.toContain('Introduction (Draft).md')
    expect(trace.prompts.find(prompt => prompt.includes('section="Introduction"'))).toContain('implements: []')
  })

  // A JSON.parse-based reader silently keeps the LAST duplicate key, so an escaped
  // duplicate is how a forged receipt smuggles an attacker value past a naive parser.
  // Both layers refuse it: the pre-step will not authenticate the project at all, and the
  // engines re-run their own strict parse over whatever receipt BYTES they are handed.
  test('rejects escaped duplicate receipt keys', async () => {
    for (const src of [draftSrc, reviewSrc]) {
      const f = fixture()
      const receiptPath = join(f.project, '.planning', '.state', 'review.json')
      const hostile = readFileSync(receiptPath, 'utf8').replace('"workflow":"writing"', '"workflow":"attacker","workfl\\u006fw":"writing"')
      writeFileSync(receiptPath, hostile)

      const { payload, status } = authenticate(f.project)
      expect(status).toBe(1)
      expect(payload.ok).toBe(false)
      expect(payload.artifacts).toEqual({})
      expect(payload.violations.join(' ')).toMatch(/review\.json/)

      // The pre-step is trusted for bytes only. Hand the engine a bundle carrying the
      // hostile bytes and its own strict parse must still refuse them.
      await expect(exec(src, {
        args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
        bundle: withReceiptText(f.bundle, hostile),
      })).rejects.toThrow(/duplicate combined review state/)
    }
  })

  test('rejects a symlinked combined review receipt that escapes projectDir', async () => {
    for (const src of [draftSrc, reviewSrc]) {
      const f = fixture()
      const receiptPath = join(f.project, '.planning', '.state', 'review.json')
      const outside = join(tmpdir(), `writing-receipt-${Date.now()}-${Math.random()}.json`)
      writeFileSync(outside, readFileSync(receiptPath))
      rmSync(receiptPath)
      symlinkSync(outside, receiptPath)

      // Symlink rejection is an O_NOFOLLOW open — a filesystem act, and therefore the
      // pre-step's job now. It refuses the project outright: no bundle, no dispatch.
      const { payload, status } = authenticate(f.project)
      expect(status).toBe(1)
      expect(payload.ok).toBe(false)
      expect(payload.artifacts).toEqual({})
      expect(payload.violations.join(' ')).toMatch(/review\.json/)
      // …and an engine handed a snapshot that resolved outside projectDir refuses it too,
      // so a pre-step that ever returned one could not be consumed.
      await expect(exec(src, {
        args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
        bundle: withReceiptReal(f.bundle, outside),
      })).rejects.toThrow(/artifact escapes projectDir/)
      rmSync(outside)
    }
  })

  test('rejects fixed plan names and non-approved receipt state', async () => {
    const f = fixture()
    await expect(exec(draftSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: { ...f.index, planFile: '.planning/PLAN.md' } },
    })).rejects.toThrow(/receipt-selected generated planFile/)
    const receiptPath = join(f.project, '.planning', '.state', 'review.json')
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
    receipt.status = 'PENDING'; receipt.reviewer_session_id = ''; receipt.reviewed_at = ''
    writeFileSync(receiptPath, JSON.stringify(receipt))
    await expect(exec(draftSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: { ...f.index, reviewStatus: 'PENDING' } },
    })).rejects.toThrow(/APPROVED/)
  })

  // NO SELF-REVIEW, and no approval that post-dates its own review. These are pure data
  // comparisons over the receipt, so they still run inside the engine — over the
  // authenticated bytes — and the pre-step refuses the same project independently.
  test('rejects invalid approval and review lifecycle fields', async () => {
    for (const src of [draftSrc, reviewSrc]) {
      for (const mutate of [
        receipt => { receipt.reviewer_session_id = receipt.approved_session_id },
        receipt => { receipt.reviewed_at = receipt.approved_at },
        receipt => { receipt.approved_at = 'not-a-timestamp' },
      ]) {
        const f = fixture()
        const receiptPath = join(f.project, '.planning', '.state', 'review.json')
        const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
        mutate(receipt)
        const bytes = JSON.stringify(receipt)
        writeFileSync(receiptPath, bytes)

        const { payload, status } = authenticate(f.project)
        expect(status).toBe(1)
        expect(payload.ok).toBe(false)

        await expect(exec(src, {
          args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
          bundle: withReceiptText(f.bundle, bytes),
        })).rejects.toThrow(/does not authenticate/)
      }
    }
  })

  test('gate rejects wrong path, wrong plan hash, or unchanged canonical output', async () => {
    // Wrong path and wrong plan hash are visible in the agent's own record, so they stay
    // pure data comparisons inside the engine.
    for (const options of [{ wrongPath: true }, { wrongHash: true }]) {
      const f = fixture()
      const { result } = await exec(draftSrc, {
        args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
        onAgent: draftAgentFor(f, options),
      })
      expect(result.overallPass).toBe(false)
    }
    // "Unchanged canonical output" is different in kind: the agent reports well-formed
    // prose at the right path with the right frontmatter, and never writes the file. There
    // is nothing wrong with the echo, so only reading the file can catch it — which is the
    // output verification the post-step owns over pendingDraftVerification / reportedContent.
    const f = fixture()
    const { result, bundle } = await exec(draftSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: draftAgentFor(f, { skipWrite: true }),
    })
    expect(result.verifyRequired).toBe(true)
    expect(result.pendingDraftVerification).toEqual(['Introduction', 'Part I'])
    // A live section's draftHash is "not yet verified", never "verified".
    expect(result.reviews.every(review => review.draftHash === '')).toBe(true)
    const reported = result.sections.find(row => row.section === 'Part I').reportedContent
    expect(reported).not.toBe(readFileSync(join(f.project, 'drafts', '02-argument.md'), 'utf8'))

    // The post-step reads the file, finds bytes that are not what the agent reported, and
    // fails the section closed: no draft, no authenticated content, no hash — exactly what
    // the in-process `draftUnchanged && t.content === canonicalDraftText` test used to do.
    const { payload: final, status } = finalize(bundle, result)
    expect(status).toBe(1)
    expect(final.unverifiedOutputs).toEqual(['Introduction', 'Part I'])
    expect(final.pendingDraftVerification).toEqual([])
    const partI = final.sections.find(row => row.section === 'Part I')
    expect(partI).toEqual(expect.objectContaining({ pass: false, drafted: false, contentAuthenticated: false }))
    expect(final.reviews.every(review => review.draftHash === '')).toBe(true)
    // A row that failed authentication carries no hash at all. Under the correct
    // `--drafts none` there was never an entry snapshot to inherit one from, so this
    // asserts the field is explicitly emptied rather than left absent; the STALE-hash
    // case it guards against needs an entry snapshot and is covered by the next test.
    expect(final.sections.every(row => row.finalDraftHash === '')).toBe(true)
    expect(final.unreliableSections).toEqual(['Introduction', 'Part I'])
    expect(final.findings).toEqual(expect.arrayContaining([expect.objectContaining({
      severity: 'critical', area: 'draft-integrity', section: 'Part I', planHash: f.planHash,
      location: join(f.project, 'drafts', '02-argument.md'), retryKey: 'section:Part I:draft-integrity',
      detail: expect.stringContaining('do not equal the content the drafting agent reported writing'),
    })]))
    expect(final.overallPass).toBe(false)
    expect(final.verdict).toBe('GAPS FOUND')
  })

  test('a failed output never inherits the pre-run draft hash as evidence', async () => {
    // DEFENSIVE, and deliberately mis-invoked: `--drafts all` on a drafting run is what
    // skills/writing-draft/SKILL.md forbids, and it is the ONLY way a live section can hold
    // an authenticated ENTRY snapshot of its own draft. That combination is what makes the
    // failure interesting — an agent that reports prose it never wrote leaves the PRE-RUN
    // file untouched, so nothing drifts, the drift branch happily fills finalDraftHash from
    // that stale snapshot, and the row ends up carrying a valid 64-hex hash certifying the
    // very file the agent was pretending to replace. The gate is still correct; the hash is
    // the lie. Carry-forward reads it, so it must be cleared alongside the verdict.
    const f = fixture()
    const { result, bundle } = await exec(draftSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: draftAgentFor(f, { skipWrite: true }),
      drafts: 'all',
    })
    // Precondition: the entry bundle really does carry a snapshot for each live section,
    // otherwise this test degrades into the absent-field case above without saying so.
    expect(bundle.draftsAuthenticated).toEqual(['Introduction', 'Part I'])
    for (const name of ['Introduction', 'Part I']) {
      expect(bundle.artifacts[`section:${name}:draft`].hash).toMatch(/^[0-9a-f]{64}$/)
    }

    const { payload: final, status } = finalize(bundle, result)
    expect(status).toBe(1)
    expect(final.driftedArtifacts).toEqual([])          // nothing moved — the agent simply didn't write
    expect(final.unverifiedOutputs).toEqual(['Introduction', 'Part I'])
    // The assertion this test exists for: no surviving hash from the entry snapshot.
    for (const row of final.sections) {
      expect(row.finalDraftHash, `${row.section} must not certify the pre-run draft it failed to replace`).toBe('')
    }
    expect(final.reviews.every(review => review.draftHash === '')).toBe(true)
    expect(final.unreliableSections).toEqual(['Introduction', 'Part I'])
    expect(final.overallPass).toBe(false)
  })

  test('missing or wrong-section draft verification emits a blocking finding', async () => {
    const f = fixture()
    const { result } = await exec(draftSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: (label, prompt, opts) => {
        const response = draftAgentFor(f)(label, prompt, opts)
        if (label === 'verify:Part I') return null
        return response
      },
    })
    expect(result.overallPass).toBe(false)
    expect(result.summary.blocking).toBeGreaterThan(0)
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ section: 'Part I', severity: 'critical', area: 'reviewer-integrity', planHash: f.planHash, location: join(f.project, 'drafts', '02-argument.md'), retryKey: 'section:Part I:reviewer-missing', detail: expect.stringContaining('verification was missing') })]))
    const counted = result.findings.reduce((counts, finding) => ({ ...counts, [finding.severity]: counts[finding.severity] + 1 }), { critical: 0, major: 0, minor: 0 })
    expect(result.summary).toEqual(expect.objectContaining({ ...counted, blocking: counted.critical + counted.major, total: counted.critical + counted.major + counted.minor }))
  })

  test('unknown or sibling-swapped transform echoes produce normalized failed records', async () => {
    for (const echoedSection of ['Unknown Section', 'Introduction']) {
      const f = fixture()
      const { result } = await exec(draftSrc, {
        args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
        onAgent: (label, prompt, opts) => {
          const response = draftAgentFor(f)(label, prompt, opts)
          if (label === 'Part I') return { ...response, section: echoedSection }
          return response
        },
      })
      expect(result.overallPass).toBe(false)
      expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ section: 'Part I', area: 'draft-integrity', severity: 'critical' })]))
      expect(result.reviews.find(review => review.section === 'Part I')).toEqual(expect.objectContaining({ section: 'Part I', status: 'error', verify: null }))
      expect(result.reviews.map(review => review.section)).toEqual(['Introduction', 'Part I'])
    }
  })

  test('swapped draft verifier section echoes are rejected at their dispatch binding', async () => {
    const f = fixture()
    const { result } = await exec(draftSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: (label, prompt, opts) => {
        const response = draftAgentFor(f)(label, prompt, opts)
        if (label === 'verify:Part I') return { ...response, section: 'Introduction' }
        return response
      },
    })
    expect(result.overallPass).toBe(false)
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ section: 'Part I', area: 'reviewer-integrity', severity: 'critical' })]))
  })

  test('verifier receives the complete immutable draft snapshot past 8k', async () => {
    const f = fixture()
    const tail = '[CITE-NEEDED: tail defect]'
    const { result, trace } = await exec(draftSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: (label, prompt, opts) => {
        if (label.startsWith('verify:')) {
          const response = draftAgentFor(f)(label, prompt, opts)
          return prompt.includes(tail) ? { ...response, fidelityOk: false } : response
        }
        const spec = f.index.sections.find(section => section.name === label)
        const claims = spec.primaryClaims.join(', ')
        const content = `---\nimplements: [${claims}]\nplan_hash: ${f.planHash}\n---\n${'x'.repeat(8_100)}${tail}\n`
        writeFileSync(spec.draftFile, content)
        return { section: label, draftFile: spec.draftFile, status: 'drafted', content, pointsExpanded: 3, summary: 'tail test' }
      },
    })
    expect(trace.prompts.filter(prompt => prompt.includes('GENERATED PROSE SNAPSHOT')).every(prompt => prompt.includes(tail))).toBe(true)
    expect(result.overallPass).toBe(false)
  })

  test('live draft verification cannot fall back to a prior result after a swapped echo', async () => {
    const f = fixture()
    const full = await carriedRun(f)
    const { result } = await exec(draftSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index, onlyChecks: ['Part I'], priorReviews: full.reviews },
      onAgent: (label, prompt, opts) => {
        const response = draftAgentFor(f)(label, prompt, opts)
        if (label === 'verify:Part I') return { ...response, section: 'Introduction' }
        return response
      },
    })
    expect(result.overallPass).toBe(false)
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ section: 'Part I', area: 'reviewer-integrity', severity: 'critical' })]))
  })

  test('a selected live draft with no transform cannot use prior verifier evidence', async () => {
    const f = fixture()
    const full = await carriedRun(f)
    const { result } = await exec(draftSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index, onlyChecks: ['Part I'], priorReviews: full.reviews },
      onAgent: (label, prompt, opts) => label === 'Part I' ? null : draftAgentFor(f)(label, prompt, opts),
    })
    expect(result.overallPass).toBe(false)
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ section: 'Part I', area: 'reviewer-integrity', severity: 'critical' })]))
  })

  test('false verifier components emit actionable stable findings', async () => {
    const f = fixture()
    const { result } = await exec(draftSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: (label, prompt, opts) => {
        const response = draftAgentFor(f)(label, prompt, opts)
        if (label === 'verify:Part I') return { ...response, coverageOk: false, fidelityOk: false, transitionOk: false, findings: [] }
        return response
      },
    })
    expect(result.overallPass).toBe(false)
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ section: 'Part I', area: 'coverage', retryKey: 'section:Part I:coverage' }),
      expect.objectContaining({ section: 'Part I', area: 'fidelity', retryKey: 'section:Part I:fidelity' }),
      expect.objectContaining({ section: 'Part I', area: 'transition', retryKey: 'section:Part I:transition' }),
    ]))
    const counted = result.findings.reduce((counts, finding) => ({ ...counts, [finding.severity]: counts[finding.severity] + 1 }), { critical: 0, major: 0, minor: 0 })
    expect(result.summary).toEqual(expect.objectContaining({ ...counted, blocking: counted.critical + counted.major, total: counted.critical + counted.major + counted.minor }))
  })

  test('requires exact implements frontmatter and rehashes outlines after verification', async () => {
    const extra = fixture()
    // An outline whose `implements` does not equal its mapped claims. The compiled index
    // reports it first…
    writeFileSync(join(extra.project, 'outlines', 'intro-outline.md'), `---\nimplements: [CLAIM-01]\nplan_hash: ${extra.planHash}\n---\n- One\n- Two\n- Three\n`)
    const reauthenticated = authenticate(extra.project).payload
    expect(reauthenticated.index.sections[0].outlineCurrent).toBe(false)
    await expect(exec(draftSrc, {
      args: { projectDir: extra.project, planPath: extra.planPath, planHash: extra.planHash, sectionIndex: reauthenticated.index },
      bundle: reauthenticated,
    })).rejects.toThrow(/requires a current PLAN-bound detailed outline for Introduction/)
    // …and the engine re-derives the same verdict from the authenticated BYTES, so an index
    // that lied about `outlineCurrent` still cannot get the outline admitted.
    const lying = structuredClone(reauthenticated.index)
    lying.sections[0].outlineCurrent = true
    lying.sections[0].outlineIssues = []
    await expect(exec(draftSrc, {
      args: { projectDir: extra.project, planPath: extra.planPath, planHash: extra.planHash, sectionIndex: lying },
      bundle: reauthenticated,
    })).rejects.toThrow(/stale, unmapped, or under-granular/)

    // An outline that moves WHILE the section it specifies is being drafted: every agent
    // expanded a snapshot that no longer describes the file, which the post-step catches.
    const changed = fixture()
    const outlinePath = join(changed.project, 'outlines', 'argument.md')
    const { result, bundle } = await exec(draftSrc, {
      args: { projectDir: changed.project, planPath: changed.planPath, planHash: changed.planHash, sectionIndex: changed.index },
      onAgent: (label, prompt, opts) => {
        const response = draftAgentFor(changed)(label, prompt, opts)
        if (label === 'verify:Part I') writeFileSync(outlinePath, readFileSync(outlinePath, 'utf8') + '\nchanged\n')
        return response
      },
    })
    const { payload: final, status } = finalize(bundle, result)
    expect(status).toBe(1)
    expect(final.driftedArtifacts).toContain('section:Part I:outline')
    expect(final.sections.find(section => section.section === 'Part I').finalOutlineHash).toBe('')
    expect(final.findings).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'critical', area: 'artifact-integrity', section: 'Part I', location: outlinePath })]))
    expect(final.overallPass).toBe(false)
  })

  test('post-transform draft symlink substitution blocks the gate', async () => {
    const f = fixture()
    const draftPath = join(f.project, 'drafts', '02-argument.md')
    const { result, bundle } = await exec(draftSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: (label, prompt, opts) => {
        const response = draftAgentFor(f)(label, prompt, opts)
        if (label === 'verify:Part I') {
          const target = join(f.project, 'drafts', 'same-bytes-draft-target.md')
          writeFileSync(target, readFileSync(draftPath))
          rmSync(draftPath)
          symlinkSync(target, draftPath)
        }
        return response
      },
    })
    expect(result.verifyRequired).toBe(true)
    // A written draft is an OUTPUT, so no entry snapshot speaks for it and there is no
    // drift to detect — this is the post-step's OUTPUT-VERIFICATION branch, which reads
    // the draftFile under the same O_NOFOLLOW discipline. The bytes behind the link are
    // identical; the refusal is about identity, not content.
    const { payload: final, status } = finalize(bundle, result)
    expect(status).toBe(1)
    expect(final.driftedArtifacts).toEqual([])            // no authenticated INPUT drifted…
    expect(final.unverifiedOutputs).toContain('Part I')   // …the written draft is what failed
    expect(final.findings).toEqual(expect.arrayContaining([expect.objectContaining({
      severity: 'critical', area: 'draft-integrity', section: 'Part I', location: draftPath,
      detail: expect.stringContaining('regular non-symlink'),
    })]))
    // The gate row flips exactly as the in-process gate used to flip it.
    expect(final.sections.find(section => section.section === 'Part I').drafted).toBe(false)
    expect(final.sections.find(section => section.section === 'Part I').pass).toBe(false)
    expect(final.reviews.find(review => review.section === 'Part I').draftHash).toBe('')
    expect(final.sectionsThatFailed).toContain('Part I')
    expect(final.overallPass).toBe(false)
  })

  test('combined review receipt mutation during draft verification blocks the gate', async () => {
    const f = fixture()
    const receiptPath = join(f.project, '.planning', '.state', 'review.json')
    const { result, bundle } = await exec(draftSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: (label, prompt, opts) => {
        const response = draftAgentFor(f)(label, prompt, opts)
        if (label === 'verify:Part I') {
          const original = readFileSync(receiptPath, 'utf8')
          writeFileSync(receiptPath, `${original} `)
          writeFileSync(receiptPath, original)
        }
        return response
      },
    })
    const { payload: final, status } = finalize(bundle, result)
    expect(status).toBe(1)
    expect(final.driftedArtifacts).toContain('receipt')
    expect(final.findings).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'critical', area: 'artifact-integrity', location: receiptPath })]))
    expect(final.overallPass).toBe(false)
  })

  test('mid-async receipt status, path, and hash mutations block draft and review', async () => {
    for (const [field, value] of [['status', 'ISSUES_FOUND'], ['plan_file', 'other-plan.md'], ['plan_hash', 'f'.repeat(64)]]) {
      for (const [src, trigger, baseAgent] of [[draftSrc, 'verify:Part I', draftAgentFor], [reviewSrc, 'L3:document', null]]) {
        const f = fixture()
        const receiptPath = join(f.project, '.planning', '.state', 'review.json')
        const { result, bundle } = await exec(src, {
          args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
          onAgent: (label, prompt, opts) => {
            const response = baseAgent ? baseAgent(f)(label, prompt, opts) : reviewAgent(label)
            if (label === trigger) {
              const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
              receipt[field] = value
              writeFileSync(receiptPath, JSON.stringify(receipt))
            }
            return response
          },
        })
        // The approval the run was authorized by is revoked or repointed mid-flight; the
        // post-step re-reads the receipt and the gate cannot stay clean.
        const { payload: final, status } = finalize(bundle, result)
        expect(status).toBe(1)
        expect(final.driftedArtifacts).toContain('receipt')
        expect(final.findings).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'critical', area: 'artifact-integrity', location: receiptPath })]))
        expect(final.overallPass).toBe(false)
      }
    }
  })

  test('rejects truncated or redirected indexes', async () => {
    const f = fixture()
    await expect(exec(draftSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: { ...f.index, sections: f.index.sections.slice(0, 1) } },
    })).rejects.toThrow(/truncated|every PLAN/)
    const redirected = structuredClone(f.index)
    redirected.sections[0].draftFile = '/tmp/outside.md'
    await expect(exec(draftSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: redirected },
    })).rejects.toThrow(/outside projectDir|do not match/)
  })

  test('replacement plan may overwrite stale drafts when outlines are current', async () => {
    const f = fixture()
    const index = structuredClone(f.index)
    index.sections[1].draftCurrent = false
    index.sections[1].draftIssues = ['stale plan hash']
    writeFileSync(join(f.project, 'drafts', '02-argument.md'), `---\nimplements: [CLAIM-01]\nplan_hash: ${'f'.repeat(64)}\n---\nstale\n`)
    const { result } = await exec(draftSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: index },
      onAgent: draftAgentFor(f),
    })
    expect(result.overallPass).toBe(true)
  })

  test('selective drafting carries only unchanged complete section results', async () => {
    const f = fixture()
    const full = await carriedRun(f)
    const intro = full.reviews.find((review) => review.section === 'Introduction')
    // A retry authenticates exactly the CARRIED section's draft — Part I is being
    // rewritten, so its draft is an output again.
    expect(authenticate(f.project, 'Introduction').payload.draftsAuthenticated).toEqual(['Introduction'])
    const valid = await exec(draftSrc, {
      args: {
        projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index,
        onlyChecks: ['Part I'], priorReviews: [intro],
      },
      onAgent: draftAgentFor(f),
    })
    expect(valid.result.overallPass).toBe(true)

    writeFileSync(join(f.project, 'drafts', '01-introduction.md'), `---\nimplements: []\nplan_hash: ${f.planHash}\n---\nChanged after drafting.\n`)
    await expect(exec(draftSrc, {
      args: {
        projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index,
        onlyChecks: ['Part I'], priorReviews: [intro],
      },
      onAgent: draftAgentFor(f),
    })).rejects.toThrow(/current-content prior result/)
  })

  test('rejects mixed active legacy authority', async () => {
    const f = fixture()
    await expect(exec(draftSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index, precisPath: join(f.project, '.planning', 'PRECIS.md') },
    })).rejects.toThrow(/mixed active authority/)
  })
})

describe('writing-verify authenticated PLAN discovery', () => {
  test('requires canonical PLAN inputs', async () => {
    const { project } = fixture()
    await expect(exec(reviewSrc, { args: { projectDir: project } })).rejects.toThrow(/requires args\.planPath/)
  })

  test('reviews every deterministic section and every Review Surface', async () => {
    const f = fixture()
    const { result, trace } = await exec(reviewSrc, {
      args: { projectDir: f.project, pluginRoot: '/plug/workflows', planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: reviewAgent,
    })
    expect(trace.labels).not.toContain('discover')
    expect(trace.labels.filter((label) => label.endsWith(':structure'))).toHaveLength(2)
    expect(result.overallPass).toBe(true)
    expect(result.sections.every((section) => section.planHash === f.planHash)).toBe(true)
    expect(trace.prompts.join('\n')).toContain('PLAN Source Plan context')
    expect(trace.prompts.join('\n')).toContain('Claim and structure coverage.')
  })

  test('emits review prompts only from authenticated PLAN and indexed artifacts', async () => {
    const f = fixture()
    const { trace } = await exec(reviewSrc, {
      args: { projectDir: f.project, pluginRoot: '/plug/workflows', planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: reviewAgent,
    })
    expect(trace.prompts).toHaveLength(trace.labels.length)
    for (const [index, prompt] of trace.prompts.entries()) {
      const reviewer = trace.labels[index]
      expect(prompt, `${reviewer} must carry the immutable plan identity header`).toContain(`IMMUTABLE RECEIPT-SELECTED PLAN IDENTITY\nPLAN_FILE: ${f.index.planFile}\nPLAN_PATH: ${f.planPath}\nPLAN_HASH: ${f.planHash}`)
      expect(prompt, `${reviewer} must bind the exact receipt-selected plan file`).toContain(`PLAN_FILE: ${f.index.planFile}`)
      expect(prompt, `${reviewer} must bind the exact authenticated plan hash`).toContain(`PLAN_HASH: ${f.planHash}`)
      expect(prompt, `${reviewer} must not consume retired writing authority`).not.toMatch(/(?:read|consume|use)[^\n]*(?:PRECIS\.md|OUTLINE\.md|ACTIVE_WORKFLOW\.md|REVIEW\.md|AUTOMATED_REVIEW\.md)/i)
    }
    const prompts = trace.prompts.join('\n')
    expect(prompts).toContain('Immutable outline snapshot:')
    expect(prompts).toContain('Immutable draft snapshot:')
  })

  // ── Drift: mutated DURING review, adjudicated by the post-step ──────────────────
  // The orchestrator can no longer re-stat anything, so it returns entry hashes and
  // `verifyRequired: true`. `--verify --findings` is what zeroes the drifted artifact's
  // final hash, DISCARDS that section's findings (they describe bytes that no longer
  // exist), appends the critical artifact-integrity finding in their place, and flips the
  // gate. Same guarantee, asserted end-to-end on the far side of the workflow.
  test('post-review artifact mutation blocks clean and returns a normalized finding', async () => {
    const f = fixture()
    const draftPath = join(f.project, 'drafts', '02-argument.md')
    const { result, trace, bundle } = await exec(reviewSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: (label) => {
        // Part I collects an ordinary review finding, so the discard is observable.
        const response = label === 'Part I:structure'
          ? { ...reviewAgent(label), issues: [{ severity: 'minor', location: 'drafts/02-argument.md:5', quote: 'CLAIM-01 argument.', detail: 'nit' }] }
          : reviewAgent(label)
        if (label === 'L3:document') {
          // Restored byte-for-byte: only the inode metadata moved, which is precisely the
          // substitution a hash-only comparison would miss.
          const original = readFileSync(draftPath, 'utf8')
          writeFileSync(draftPath, original + '\ntransient change during review\n')
          writeFileSync(draftPath, original)
        }
        return response
      },
    })
    expect(result.verifyRequired).toBe(true)
    expect(result.findings.some(finding => finding.section === 'Part I')).toBe(true)
    expect(trace.prompts.find(prompt => prompt.includes('document reviewer'))).toContain(draftPath)

    const { payload: final, status } = finalize(bundle, result)
    expect(status).toBe(1)
    expect(final.driftVerified).toBe(true)
    expect(final.driftedArtifacts).toContain('section:Part I:draft')
    expect(final.sections.find(section => section.section === 'Part I').finalDraftHash).toBe('')
    expect(final.sections.find(section => section.section === 'Introduction').finalDraftHash).toMatch(/^[0-9a-f]{64}$/)
    expect(final.findings).toEqual(expect.arrayContaining([expect.objectContaining({ area: 'artifact-integrity', severity: 'critical', section: 'Part I', planHash: f.planHash, location: draftPath })]))
    expect(final.findings.some(finding => finding.section === 'Part I' && finding.area !== 'artifact-integrity')).toBe(false)
    expect(final.unreliableSections).toContain('Part I')
    expect(final.overallPass).toBe(false)
  })

  test('combined review receipt mutation during asynchronous review blocks clean', async () => {
    const f = fixture()
    const receiptPath = join(f.project, '.planning', '.state', 'review.json')
    const { result, bundle } = await exec(reviewSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: (label) => {
        const response = reviewAgent(label)
        if (label === 'L3:document') {
          const original = readFileSync(receiptPath, 'utf8')
          writeFileSync(receiptPath, `${original} `)
          writeFileSync(receiptPath, original)
        }
        return response
      },
    })
    const { payload: final, status } = finalize(bundle, result)
    expect(status).toBe(1)
    expect(final.driftedArtifacts).toContain('receipt')
    expect(final.findings).toEqual(expect.arrayContaining([expect.objectContaining({ area: 'artifact-integrity', severity: 'critical', location: receiptPath })]))
    expect(final.overallPass).toBe(false)
    expect(final.verdict).toBe('ISSUES FOUND')
  })

  test('post-compilation symlink substitution blocks clean review', async () => {
    const f = fixture()
    const draftPath = join(f.project, 'drafts', '02-argument.md')
    const { result, bundle } = await exec(reviewSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: (label) => {
        const response = reviewAgent(label)
        if (label === 'L3:document') {
          // Same bytes, now reached through a symlink — the re-snapshot's O_NOFOLLOW open
          // is what refuses it, not a content comparison.
          const target = join(f.project, 'drafts', 'same-bytes-target.md')
          writeFileSync(target, readFileSync(draftPath))
          rmSync(draftPath)
          symlinkSync(target, draftPath)
        }
        return response
      },
    })
    const { payload: final, status } = finalize(bundle, result)
    expect(status).toBe(1)
    expect(final.driftedArtifacts).toContain('section:Part I:draft')
    expect(final.artifactVerification.find(record => record.key === 'section:Part I:draft').reason).toMatch(/regular non-symlink/)
    expect(final.sections.find(section => section.section === 'Part I').finalDraftHash).toBe('')
    expect(final.findings).toEqual(expect.arrayContaining([expect.objectContaining({ area: 'artifact-integrity', severity: 'critical', location: draftPath })]))
    expect(final.overallPass).toBe(false)
  })

  test('unexamined Review Surface blocks a clean verdict', async () => {
    const f = fixture()
    const { result } = await exec(reviewSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: (label) => reviewAgent(label, { missingSurface: true }),
    })
    expect(result.overallPass).toBe(false)
    expect(result.summary.critical).toBe(1)
  })

  test('negative claim, completeness, and transition signals block mechanically', async () => {
    const f = fixture()
    const { result } = await exec(reviewSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: (label, prompt, opts) => {
        const base = reviewAgent(label)
        if (label === 'Part I:structure') return { ...base, planClaimAdvanced: false }
        if (label === 'L2:transitions') return { transitions: [] }
        if (label === 'L3:document') return {
          ...base,
          completeness: {
            claimsAddressed: 'partial', counterargsConfronted: 'partial', scopeHonored: false,
            hookDelivered: false, conclusionFollows: false, issues: [],
          },
        }
        return base
      },
    })
    expect(result.overallPass).toBe(false)
    expect(result.summary.critical).toBeGreaterThan(0)
    expect(result.summary.major).toBeGreaterThan(0)
  })

  test('fabricated quote evidence makes a section unreliable', async () => {
    const f = fixture()
    const { result } = await exec(reviewSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: (label) => {
        const base = reviewAgent(label)
        if (label === 'Introduction:structure') return {
          ...base,
          issues: [{ severity: 'major', location: 'drafts/01-introduction.md:1', quote: 'fabricated quote', detail: 'bad', fix: 'fix' }],
        }
        if (label === 'Introduction:verify') return {
          section: 'Introduction', quotesChecked: 1,
          fabricated: [{ quote: 'fabricated quote', location: 'drafts/01-introduction.md:1' }],
        }
        return base
      },
    })
    expect(result.overallPass).toBe(false)
    expect(result.unreliableSections).toContain('Introduction')
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ retryKey: 'section:Introduction:reviewer-unreliable', severity: 'critical' })]))
    expect(result.summary.critical).toBe(1)
    expect(result.summary.blocking).toBe(1)
    expect(result.summary.total).toBe(1)
  })

  test('missing or wrong-section quote verification makes review unreliable', async () => {
    const f = fixture()
    const { result } = await exec(reviewSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: (label) => {
        const base = reviewAgent(label)
        if (label === 'Part I:verify') return { ...base, section: 'Wrong Section' }
        return base
      },
    })
    expect(result.overallPass).toBe(false)
    expect(result.unreliableSections).toContain('Part I')
    expect(result.summary.critical).toBe(1)
  })

  test('swapped L1 reviewer section or check echoes make review unreliable', async () => {
    for (const response of [
      { field: 'section', value: 'Introduction' },
      { field: 'check', value: 'prose' },
    ]) {
      const f = fixture()
      const { result } = await exec(reviewSrc, {
        args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
        onAgent: (label) => {
          const base = reviewAgent(label)
          if (label === 'Part I:structure') return { ...base, [response.field]: response.value }
          return base
        },
      })
      expect(result.overallPass).toBe(false)
      expect(result.unreliableSections).toContain('Part I')
    }
  })

  test('bibliography mutation during verification blocks draft and review', async () => {
    for (const [src, trigger, baseAgent] of [[draftSrc, 'verify:Part I', draftAgentFor], [reviewSrc, 'L3:document', null]]) {
      const f = fixture()
      const bibPath = join(f.project, 'references', 'sources.bib')
      const { result, bundle } = await exec(src, {
        args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
        onAgent: (label, prompt, opts) => {
          const response = baseAgent ? baseAgent(f)(label, prompt, opts) : reviewAgent(label)
          if (label === trigger) writeFileSync(bibPath, `${readFileSync(bibPath, 'utf8')}@article{changed,title={Changed}}\n`)
          return response
        },
      })
      // Every reviewer judged citations against a bibliography snapshot that no longer
      // describes the file; the post-step is what catches that now.
      const { payload: final, status } = finalize(bundle, result)
      expect(status).toBe(1)
      expect(final.driftedArtifacts).toContain('bib')
      expect(final.findings).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'critical', area: 'artifact-integrity', location: bibPath })]))
      expect(final.overallPass).toBe(false)
    }
  })

  test('selective review requires complete current-hash carry-forward', async () => {
    const f = fixture()
    await expect(exec(reviewSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index, onlyChecks: ['Part I'], priorReviews: [] },
    })).rejects.toThrow(/requires one complete reliable current-content/)

    const { result } = await exec(reviewSrc, {
      args: {
        projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index,
        onlyChecks: ['Part I'], priorReviews: [priorSection('Introduction', f.planHash, f.project)],
      },
      onAgent: reviewAgent,
    })
    expect(result.sections.map((section) => section.section)).toEqual(['Introduction', 'Part I'])

    const prior = priorSection('Introduction', f.planHash, f.project)
    writeFileSync(join(f.project, 'drafts', '01-introduction.md'), `---\nimplements: []\nplan_hash: ${f.planHash}\n---\nChanged after review.\n`)
    await expect(exec(reviewSrc, {
      args: {
        projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index,
        onlyChecks: ['Part I'], priorReviews: [prior],
      },
    })).rejects.toThrow(/current-content prior review/)
  })

  test('rejects domain overrides and stale draft artifacts', async () => {
    const f = fixture()
    await expect(exec(reviewSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index, style: 'econ' },
    })).rejects.toThrow(/style override conflicts/)

    const stale = structuredClone(f.index)
    stale.sections[1].draftCurrent = false
    stale.sections[1].draftIssues = ['stale plan hash']
    await expect(exec(reviewSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: stale },
    })).rejects.toThrow(/current PLAN-bound outline and draft/)
  })

  test('rejects unknown checks, duplicate prior records, and stale carry-forward', async () => {
    const f = fixture()
    await expect(exec(reviewSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index, onlyChecks: ['Missing'] },
    })).rejects.toThrow(/current PLAN section names/)
    const prior = priorSection('Introduction', f.planHash, f.project)
    await expect(exec(reviewSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index, onlyChecks: ['Part I'], priorReviews: [prior, prior] },
    })).rejects.toThrow(/duplicate section records/)
    await expect(exec(reviewSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index, onlyChecks: ['Part I'], priorReviews: [priorSection('Introduction', 'd'.repeat(64), f.project)] },
    })).rejects.toThrow(/different plan hash/)
  })
})

afterAll(() => { for (const dir of TEMPS) rmSync(dir, { recursive: true, force: true }) })
