// Driver tests for the writing engines' reconciled Discover phase.
// Executes workflows/writing-draft.js and writing-review.js bodies with MOCKED Workflow
// primitives, asserting: (1) when args.sectionIndex is present, NO LLM 'discover' agent
// fires (the compiled-Discover win); (2) the deterministic index maps to the right gate
// outcome incl. the granularity bounce; (3) absent index ⇒ the LLM Discover still runs
// (back-compat). Run:  node tests/writing-engine-discover.test.mjs
import { readFileSync } from 'fs'

const ROOT = new URL('..', import.meta.url).pathname
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
let PASS = 0, FAIL = 0
const ok = (n, c, x = '') => { if (c) { PASS++; console.log(`  ok  ${n}`) } else { FAIL++; console.log(`FAIL  ${n} ${x}`) } }

const draftSrc = readFileSync(ROOT + 'workflows/writing-draft.js', 'utf8').replace(/^export const meta/m, 'const meta')
const reviewSrc = readFileSync(ROOT + 'workflows/writing-review.js', 'utf8').replace(/^export const meta/m, 'const meta')

async function exec(src, { args, onAgent }) {
  const trace = { labels: [] }
  const agent = async (prompt, opts = {}) => { const l = opts.label || ''; trace.labels.push(l); return onAgent(l, prompt, opts) }
  const parallel = async (thunks) => Promise.all(thunks.map(t => t()))
  const pipeline = async () => { throw new Error('pipeline unused') }
  const log = () => {}, phase = () => {}
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget',
    src + '\n;return (typeof __ret!=="undefined")?__ret:undefined')
  // The engines `return` their result at top level; AsyncFunction makes that the resolved value.
  const result = await fn(agent, parallel, pipeline, log, phase, args, { total: null, spent: () => 0, remaining: () => Infinity })
  return { result, trace }
}

const SECTIONS = [
  { name: 'Introduction', outlineFile: '/p/outlines/Introduction.md', draftFile: '/p/drafts/Introduction (Draft).md', primaryClaims: [], implements: ['CLAIM-01', 'CLAIM-02'], sourcesPinned: false, granular: true, granularityNote: '', prevName: '', nextName: 'Part I' },
  { name: 'Part I', outlineFile: '/p/outlines/Part I.md', draftFile: '/p/drafts/Part I (Draft).md', primaryClaims: ['CLAIM-01'], implements: ['CLAIM-01'], sourcesPinned: true, granular: true, granularityNote: '', prevName: 'Introduction', nextName: 'Stub' },
  { name: 'Stub', outlineFile: '/p/outlines/Stub.md', draftFile: '/p/drafts/Stub (Draft).md', primaryClaims: [], implements: [], sourcesPinned: false, granular: false, granularityNote: 'placeholder: TBA', prevName: 'Part I', nextName: '' },
]
const INDEX = { style: 'legal', precisPath: '/p/.planning/PRECIS.md', outlinePath: '/p/.planning/OUTLINE.md', bibPath: '/p/references/sources.bib', sections: SECTIONS }

// ── writing-draft.js: deterministic Discover ────────────────────────────────────
console.log('writing-draft — deterministic Discover')
{
  const draftAgent = (label) => {
    if (label.startsWith('verify:')) {
      const section = label.slice(7)
      return { section, coverageOk: true, fidelityOk: true, transitionOk: true, findings: [], boundary: { firstSentence: 'First.', lastSentence: 'Last.' } }
    }
    // transform agent: label is the section name
    return { section: label, draftFile: `/p/drafts/${label} (Draft).md`, status: 'drafted', content: 'Prose body.', pointsExpanded: 3, summary: 'advances CLAIM-01' }
  }
  const { result, trace } = await exec(draftSrc, { args: { projectDir: '/p', pluginRoot: '/plug/workflows', sectionIndex: INDEX }, onAgent: draftAgent })
  ok('no LLM discover agent fired', !trace.labels.includes('discover'), JSON.stringify(trace.labels))
  ok('2 draftable transformed (Stub bounced)', trace.labels.filter(l => l === 'Introduction' || l === 'Part I').length === 2)
  ok('Stub never transformed', !trace.labels.includes('Stub'))
  ok('underGranular = [Stub]', result.underGranular.length === 1 && result.underGranular[0].section === 'Stub', JSON.stringify(result.underGranular))
  ok('overallPass false (a structureless outline present)', result.overallPass === false)
  ok('scoreTable has all 3 rows', (result.scoreTable.match(/\n\| /g) || []).length >= 3)
}

// happy path: all granular ⇒ overallPass true
console.log('writing-draft — all granular ⇒ pass')
{
  const idx2 = { ...INDEX, sections: SECTIONS.slice(0, 2).map(s => ({ ...s, nextName: s.name === 'Part I' ? '' : s.nextName })) }
  const draftAgent = (label) => label.startsWith('verify:')
    ? { section: label.slice(7), coverageOk: true, fidelityOk: true, transitionOk: true, findings: [], boundary: { firstSentence: 'A.', lastSentence: 'B.' } }
    : { section: label, draftFile: `/p/drafts/${label} (Draft).md`, status: 'drafted', content: 'Body.', pointsExpanded: 3, summary: 's' }
  const { result, trace } = await exec(draftSrc, { args: { projectDir: '/p', pluginRoot: '/plug/workflows', sectionIndex: idx2 }, onAgent: draftAgent })
  ok('no discover agent', !trace.labels.includes('discover'))
  ok('overallPass true', result.overallPass === true, result.verdict)
}

// back-compat: no index ⇒ LLM discover runs
console.log('writing-draft — back-compat LLM Discover')
{
  const draftAgent = (label) => {
    if (label === 'discover') return { style: 'legal', precisPath: '', outlinePath: '', domainSkillPath: '', bibPath: '', sections: [{ name: 'Introduction', outlineFile: '/p/o/Introduction.md', draftFile: '/p/d/Introduction (Draft).md', precisClaim: 'CLAIM-01', outlineGranular: true, sourcesPinned: true, granularityNote: '', prevName: '', nextName: '' }] }
    if (label.startsWith('verify:')) return { section: label.slice(7), coverageOk: true, fidelityOk: true, transitionOk: true, findings: [], boundary: { firstSentence: 'A.', lastSentence: 'B.' } }
    return { section: label, draftFile: '/p/d/x.md', status: 'drafted', content: 'b', pointsExpanded: 1, summary: 's' }
  }
  const { trace } = await exec(draftSrc, { args: { projectDir: '/p', pluginRoot: '/plug/workflows' }, onAgent: draftAgent })
  ok('LLM discover agent fired (no index)', trace.labels.includes('discover'))
}

// ── writing-review.js: deterministic Discover ───────────────────────────────────
console.log('writing-review — deterministic Discover')
{
  const reviewAgent = (label) => {
    if (label === 'discover') throw new Error('discover should be skipped')
    if (label.endsWith(':structure')) return { section: label.split(':')[0], check: 'structure', itemsChecked: 4, issues: [], precisClaimAdvanced: true, boundary: { firstSentence: 'A.', lastSentence: 'B.', assumesFromPrev: '', handsOffToNext: '', argumentState: '', conceptsIntroduced: [], conceptsUsed: [], coreTerms: [] }, argumentSummary: ['pt'] }
    if (label.endsWith(':prose')) return { section: label.split(':')[0], check: 'prose', itemsChecked: 4, issues: [] }
    if (label.endsWith(':fidelity')) return { section: label.split(':')[0], check: 'fidelity', itemsChecked: 4, issues: [] }
    if (label.endsWith(':verify')) return { section: label.split(':')[0], quotesChecked: 0, fabricated: [] }
    if (label === 'L2:transitions') return { transitions: [] }
    if (label === 'L3:document') return { conceptOrderIssues: [], repetition: [], thesisIssues: [], completeness: { claimsAddressed: 'all', counterargsConfronted: 'all', scopeHonored: true, hookDelivered: true, conclusionFollows: true, issues: [] } }
    return {}
  }
  const idx = { ...INDEX, sections: SECTIONS.slice(0, 2) }
  const { result, trace } = await exec(reviewSrc, { args: { projectDir: '/p', pluginRoot: '/plug/workflows', sectionIndex: idx }, onAgent: reviewAgent })
  ok('no LLM discover agent fired', !trace.labels.includes('discover'))
  ok('both sections reviewed (structure agents)', trace.labels.filter(l => l.endsWith(':structure')).length === 2)
  ok('overallPass true (clean review)', result.overallPass === true, result.verdict)
  ok('verdict CLEAN', /CLEAN/.test(result.verdict), result.verdict)
}

console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
