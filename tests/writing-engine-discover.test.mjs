import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const ROOT = new URL('..', import.meta.url).pathname
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const draftSrc = readFileSync(ROOT + 'workflows/writing-draft.js', 'utf8').replace(/^export const meta/m, 'const meta')
const reviewSrc = readFileSync(ROOT + 'workflows/writing-review.js', 'utf8').replace(/^export const meta/m, 'const meta')

async function exec(src, { args, onAgent = () => ({}) }) {
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
    src + '\n;return (typeof __ret!=="undefined")?__ret:undefined',
  )
  const result = await fn(agent, parallel, pipeline, log, phase, args, {
    total: null,
    spent: () => 0,
    remaining: () => Infinity,
  })
  return { result, trace }
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

function fixture() {
  const project = mkdtempSync(join(tmpdir(), 'writing-engine-'))
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
  writeFileSync(join(project, 'drafts', '01-introduction.md'), `---\nimplements: []\nplan_hash: ${planHash}\n---\nIntroduction.\n`)
  writeFileSync(join(project, 'drafts', '02-argument.md'), `---\nimplements: [CLAIM-01]\nplan_hash: ${planHash}\n---\nCLAIM-01 argument.\n`)
  const sections = [
    {
      name: 'Introduction',
      outlineFile: join(project, 'outlines', 'intro-outline.md'),
      draftFile: join(project, 'drafts', '01-introduction.md'),
      primaryClaims: [],
      implements: [],
      dependencies: [],
      sourcesPinned: true,
      granular: true,
      granularityNote: '',
      outlineCurrent: true,
      draftCurrent: true,
      outlineIssues: [],
      draftIssues: [],
      prevName: '',
      nextName: 'Part I',
    },
    {
      name: 'Part I',
      outlineFile: join(project, 'outlines', 'argument.md'),
      draftFile: join(project, 'drafts', '02-argument.md'),
      primaryClaims: ['CLAIM-01'],
      implements: ['CLAIM-01'],
      dependencies: ['Introduction'],
      sourcesPinned: true,
      granular: true,
      granularityNote: '',
      outlineCurrent: true,
      draftCurrent: true,
      outlineIssues: [],
      draftIssues: [],
      prevName: 'Introduction',
      nextName: '',
    },
  ]
  const index = {
    ok: true,
    style: 'legal',
    planFile,
    planPath,
    planHash,
    reviewStatus: 'APPROVED',
    precisPath: '',
    outlinePath: '',
    bibPath: join(project, 'references', 'sources.bib'),
    sourcePlan: { bibliography: 'references/sources.bib', notebook: 'none', 'notebook url': 'none', 'key sources': 'case2024' },
    reviewSurfaces: ['Claim and structure coverage.', 'Citation fidelity.'],
    sections,
  }
  return { project, planPath, planHash, index }
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

function reviewAgent(label, { missingSurface = false } = {}) {
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
  if (label.endsWith(':prose')) return { section: label.split(':')[0], check: 'prose', itemsChecked: 4, issues: [] }
  if (label.endsWith(':fidelity')) return { section: label.split(':')[0], check: 'fidelity', itemsChecked: 2, issues: [] }
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

  test('rejects escaped duplicate receipt keys', async () => {
    for (const src of [draftSrc, reviewSrc]) {
      const f = fixture()
      const receiptPath = join(f.project, '.planning', '.state', 'review.json')
      const receipt = readFileSync(receiptPath, 'utf8').replace('"workflow":"writing"', '"workflow":"attacker","workfl\\u006fw":"writing"')
      writeFileSync(receiptPath, receipt)
      await expect(exec(src, {
        args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
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
      await expect(exec(src, {
        args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      })).rejects.toThrow(/regular non-symlink artifact|artifact escapes projectDir/)
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
        writeFileSync(receiptPath, JSON.stringify(receipt))
        await expect(exec(src, {
          args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
        })).rejects.toThrow(/does not authenticate/)
      }
    }
  })

  test('gate rejects wrong path, wrong plan hash, or unchanged canonical output', async () => {
    for (const options of [{ wrongPath: true }, { wrongHash: true }, { skipWrite: true }]) {
      const f = fixture()
      const { result } = await exec(draftSrc, {
        args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
        onAgent: draftAgentFor(f, options),
      })
      expect(result.overallPass).toBe(false)
    }
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
    const full = await exec(draftSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: draftAgentFor(f),
    })
    const { result } = await exec(draftSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index, onlyChecks: ['Part I'], priorReviews: full.result.reviews },
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
    const full = await exec(draftSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: draftAgentFor(f),
    })
    const { result } = await exec(draftSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index, onlyChecks: ['Part I'], priorReviews: full.result.reviews },
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
    writeFileSync(join(extra.project, 'outlines', 'intro-outline.md'), `---\nimplements: [CLAIM-01]\nplan_hash: ${extra.planHash}\n---\n- One\n- Two\n- Three\n`)
    await expect(exec(draftSrc, {
      args: { projectDir: extra.project, planPath: extra.planPath, planHash: extra.planHash, sectionIndex: extra.index },
    })).rejects.toThrow(/stale, unmapped, or under-granular/)

    const changed = fixture()
    const { result } = await exec(draftSrc, {
      args: { projectDir: changed.project, planPath: changed.planPath, planHash: changed.planHash, sectionIndex: changed.index },
      onAgent: (label, prompt, opts) => {
        const response = draftAgentFor(changed)(label, prompt, opts)
        if (label === 'verify:Part I') writeFileSync(join(changed.project, 'outlines', 'argument.md'), readFileSync(join(changed.project, 'outlines', 'argument.md'), 'utf8') + '\nchanged\n')
        return response
      },
    })
    expect(result.overallPass).toBe(false)
  })

  test('post-transform draft symlink substitution blocks the gate', async () => {
    const f = fixture()
    const { result } = await exec(draftSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: (label, prompt, opts) => {
        const response = draftAgentFor(f)(label, prompt, opts)
        if (label === 'verify:Part I') {
          const draftPath = join(f.project, 'drafts', '02-argument.md')
          const target = join(f.project, 'drafts', 'same-bytes-draft-target.md')
          writeFileSync(target, readFileSync(draftPath))
          rmSync(draftPath)
          symlinkSync(target, draftPath)
        }
        return response
      },
    })
    expect(result.overallPass).toBe(false)
    expect(result.sections.find(section => section.section === 'Part I')?.drafted).toBe(false)
  })

  test('combined review receipt mutation during draft verification blocks the gate', async () => {
    const f = fixture()
    const receiptPath = join(f.project, '.planning', '.state', 'review.json')
    const { result } = await exec(draftSrc, {
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
    expect(result.overallPass).toBe(false)
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ section: 'RECEIPT', severity: 'critical' })]))
  })

  test('mid-async receipt status, path, and hash mutations block draft and review', async () => {
    for (const [field, value] of [['status', 'ISSUES_FOUND'], ['plan_file', 'other-plan.md'], ['plan_hash', 'f'.repeat(64)]]) {
      for (const [src, trigger, baseAgent] of [[draftSrc, 'verify:Part I', draftAgentFor], [reviewSrc, 'L3:document', null]]) {
        const f = fixture()
        const receiptPath = join(f.project, '.planning', '.state', 'review.json')
        const { result } = await exec(src, {
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
        expect(result.overallPass).toBe(false)
        expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'critical', area: 'artifact-integrity' })]))
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
    const full = await exec(draftSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: draftAgentFor(f),
    })
    const intro = full.result.reviews.find((review) => review.section === 'Introduction')
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

describe('writing-review authenticated PLAN discovery', () => {
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

  test('post-review artifact mutation blocks clean and returns a normalized finding', async () => {
    const f = fixture()
    const { result, trace } = await exec(reviewSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: (label) => {
        const response = reviewAgent(label)
        if (label === 'L3:document') {
          const draftPath = join(f.project, 'drafts', '02-argument.md')
          const original = readFileSync(draftPath, 'utf8')
          writeFileSync(draftPath, original + '\ntransient change during review\n')
          writeFileSync(draftPath, original)
        }
        return response
      },
    })
    expect(result.overallPass).toBe(false)
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ area: 'artifact-integrity', severity: 'critical', planHash: f.planHash })]))
    expect(trace.prompts.find(prompt => prompt.includes('document reviewer'))).toContain(join(f.project, 'drafts', '02-argument.md'))
  })

  test('combined review receipt mutation during asynchronous review blocks clean', async () => {
    const f = fixture()
    const receiptPath = join(f.project, '.planning', '.state', 'review.json')
    const { result } = await exec(reviewSrc, {
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
    expect(result.overallPass).toBe(false)
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ area: 'artifact-integrity', severity: 'critical', location: receiptPath })]))
  })

  test('post-compilation symlink substitution blocks clean review', async () => {
    const f = fixture()
    const { result } = await exec(reviewSrc, {
      args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
      onAgent: (label) => {
        const response = reviewAgent(label)
        if (label === 'L3:document') {
          const draftPath = join(f.project, 'drafts', '02-argument.md')
          const target = join(f.project, 'drafts', 'same-bytes-target.md')
          writeFileSync(target, readFileSync(draftPath))
          rmSync(draftPath)
          symlinkSync(target, draftPath)
        }
        return response
      },
    })
    expect(result.overallPass).toBe(false)
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ area: 'artifact-integrity', severity: 'critical' })]))
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
      const { result } = await exec(src, {
        args: { projectDir: f.project, planPath: f.planPath, planHash: f.planHash, sectionIndex: f.index },
        onAgent: (label, prompt, opts) => {
          const response = baseAgent ? baseAgent(f)(label, prompt, opts) : reviewAgent(label)
          if (label === trigger) writeFileSync(bibPath, `${readFileSync(bibPath, 'utf8')}@article{changed,title={Changed}}\n`)
          return response
        },
      })
      expect(result.overallPass).toBe(false)
      expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'critical', area: 'artifact-integrity', location: bibPath })]))
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
