// The optional third-party review: opt-in parsing, the neutral contract, both shipped adapters, and
// the advisory guarantee.
//
// ZERO LIVE PROVIDER CALLS. Every provider interaction goes through an injected `invoke`, and the
// adapter fixtures are recorded shapes. A test that made a paid external call would be a test nobody
// runs.
//
// The property under test that is easiest to get wrong: an adapter that FAILED and an adapter that
// reviewed CLEANLY both present as `findings: []`. If those are indistinguishable, a broken
// integration looks exactly like a passing review — so `status` is asserted everywhere alongside the
// findings, never instead of them.
//
// Run: bun tests/third-party-review.test.mjs
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeFindings, readOptIn, runThirdPartyReview } from '../scripts/beat/third-party-review.ts'
import { reviewWithCodex } from '../scripts/beat/adapters/codex.ts'
import { reviewWithGemini } from '../scripts/beat/adapters/gemini.ts'
import { adapterNames, resolveAdapter } from '../scripts/beat/adapters/registry.ts'

const ROOT = new URL('..', import.meta.url).pathname
let PASS = 0, FAIL = 0
const ok = (name, condition, extra = '') => {
  if (condition) PASS++
  else { FAIL++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`) }
}

console.log('the opt-in defaults OFF, and off is the ABSENCE of the line')
{
  ok('a plan with no line is disabled', readOptIn('# Plan\n\nSome content.\n').enabled === false)
  ok('an empty plan is disabled', readOptIn('').enabled === false)
  const on = readOptIn('## Review Surfaces\n\n**Third-party review:** codex\n')
  ok('a named adapter is read', on.enabled === true && JSON.stringify(on.adapters) === '["codex"]')
  ok('bare prose form parses', readOptIn('Third-party review: gemini').adapters[0] === 'gemini')
  ok('list-item form parses', readOptIn('- Third-party review: gemini').adapters[0] === 'gemini')
  ok('explicit none is disabled', readOptIn('**Third-party review:** none').enabled === false)
  ok('case is normalised', readOptIn('**Third-Party Review:** CODEX').adapters[0] === 'codex')

  // A LIST ON ONE LINE IS NOT A CONFLICT — it is the request to run several. Across three review
  // rounds only one finding of eight was raised by BOTH adapters; the value is in the disagreement,
  // so choosing between them throws most of it away.
  const both = readOptIn('**Third-party review:** codex, gemini')
  ok('a comma list requests several', JSON.stringify(both.adapters) === '["codex","gemini"]')
  ok('"and" separates too', JSON.stringify(readOptIn('Third-party review: codex and gemini').adapters) === '["codex","gemini"]')
  ok('a slash separates too', JSON.stringify(readOptIn('Third-party review: codex/gemini').adapters) === '["codex","gemini"]')
  ok('duplicates collapse to one paid call', JSON.stringify(readOptIn('Third-party review: codex, codex').adapters) === '["codex"]')
  // "none" beside a provider is a plan that says two things. Refusing beats guessing which half.
  let mixed = false
  try { readOptIn('Third-party review: none, codex') } catch { mixed = true }
  ok('none mixed with an adapter refuses', mixed)
  // A stale line in an earlier section silently winning is the failure mode here.
  let threw = false
  try { readOptIn('Third-party review: codex\n\nThird-party review: gemini\n') } catch { threw = true }
  ok('two conflicting values REFUSE rather than picking the first', threw)
  // Reading a garbled opt-in as "off" is the same silent-zero the status field exists to prevent.
  let threwBad = false
  try { readOptIn('Third-party review: ' + 'x'.repeat(80)) } catch { threwBad = true }
  ok('a malformed adapter name refuses rather than defaulting off', threwBad)
}

console.log('the contract is provider-neutral')
{
  const source = readFileSync(`${ROOT}scripts/beat/third-party-review.ts`, 'utf8')
  for (const literal of ['codex', 'gemini', 'agy', 'openai', 'antigravity']) {
    ok(`the core names no provider: ${literal}`, !source.toLowerCase().includes(literal))
  }
  ok('the registry ships exactly the two adapters', JSON.stringify(adapterNames()) === JSON.stringify(['codex', 'gemini']))
  ok('an unknown adapter does not resolve', resolveAdapter('nope') === undefined)
  ok('both adapters expose the same shape',
    ['codex', 'gemini'].every(name => typeof resolveAdapter(name)?.review === 'function' && resolveAdapter(name)?.name === name))
}

console.log('normalizeFindings maps both key styles onto one neutral shape')
{
  const [snake] = normalizeFindings([{ severity: 'critical', title: 't', body: 'b', file: 'a.ts', line_start: 3, line_end: 4, confidence: 0.9, recommendation: 'r' }])
  ok('snake_case maps with no field dropped',
    snake.severity === 'critical' && snake.lineStart === 3 && snake.lineEnd === 4 && snake.confidence === 0.9 && snake.recommendation === 'r' && snake.file === 'a.ts')
  const [camel] = normalizeFindings([{ severity: 'high', title: 't', body: 'b', lineStart: 7 }])
  ok('camelCase maps too', camel.lineStart === 7 && camel.severity === 'high')
  // Losing a finding because its severity label was unexpected is worse than mis-ranking it.
  ok('an unknown severity is kept as medium', normalizeFindings([{ severity: 'spicy', title: 't', body: 'b' }])[0].severity === 'medium')
  // An empty row is indistinguishable from a real finding that failed to serialise, and downstream a
  // human is asked to act on it.
  ok('a finding with neither title nor body is dropped', normalizeFindings([{ severity: 'low' }]).length === 0)
  ok('non-array input yields no findings', normalizeFindings(undefined).length === 0)
}

console.log('the codex adapter maps its documented schema')
{
  // The companion payload shape, recorded — `--json` prints {review,target,codex,result,rawOutput,parseError}.
  const payload = {
    review: 'Adversarial Review',
    codex: { status: 0 },
    result: {
      verdict: 'needs-attention',
      summary: 'Two issues.',
      findings: [
        { severity: 'critical', title: 'Race', body: 'Read-modify-write', file: 'a.ts', line_start: 10, line_end: 12, confidence: 0.8, recommendation: 'Lock it' },
        { severity: 'low', title: 'Nit', body: 'Naming', file: 'b.ts', line_start: 1, line_end: 1, confidence: 0.3, recommendation: 'Rename' },
      ],
      next_steps: ['fix the race'],
    },
    rawOutput: null, parseError: null,
  }
  const invoke = () => ({ code: 0, stdout: JSON.stringify(payload), stderr: '' })
  const cacheDir = `${ROOT}tests/fixtures/codex-plugin-cache`
  const result = reviewWithCodex({ projectDir: ROOT, invoke, cacheDir })
  ok('a present companion reviews', result.status === 'reviewed', JSON.stringify(result).slice(0, 160))
  ok('verdict and summary carry', result.verdict === 'needs-attention' && result.summary === 'Two issues.')
  const mapped = normalizeFindings(result.findings)
  ok('every finding survives the round trip', mapped.length === 2)
  ok('no field is dropped', mapped[0].file === 'a.ts' && mapped[0].lineStart === 10 && mapped[0].confidence === 0.8 && mapped[0].recommendation === 'Lock it')

  // The companion reports its own structured-output failure in-band; trusting `result` without
  // checking `parseError` reads a failed parse as a clean review.
  const broken = reviewWithCodex({ projectDir: ROOT, cacheDir, invoke: () => ({ code: 0, stdout: JSON.stringify({ result: null, parseError: 'model returned prose', rawOutput: 'I think it is fine' }), stderr: '' }) })
  ok('an in-band parseError is unparseable, not clean', broken.status === 'unparseable')
  ok('the raw text is preserved', broken.raw === 'I think it is fine')

  ok('a missing plugin is unavailable', reviewWithCodex({ projectDir: ROOT, invoke, cacheDir: `${ROOT}tests/fixtures/does-not-exist` }).status === 'unavailable')
  ok('a throwing invoke is unavailable',
    reviewWithCodex({ projectDir: ROOT, cacheDir, invoke: () => { throw new Error('ENOENT node') } }).status === 'unavailable')
  // "did not run" and "ran and said something unreadable" call for different responses.
  ok('a non-zero exit with no JSON is unavailable, not unparseable',
    reviewWithCodex({ projectDir: ROOT, cacheDir, invoke: () => ({ code: 1, stdout: '', stderr: 'boom' }) }).status === 'unavailable')
}

console.log('review scope: working-tree by default, branch on request')
{
  // The adapters could ONLY see uncommitted work, so reviewing a pull request was impossible through
  // the shipped path — PR #130 had to be reviewed by hand-injecting a branch diff through `invoke`.
  // The commands are asserted here rather than the outputs: what these adapters ASK FOR is the whole
  // behaviour, and a scope that silently reviews the wrong diff still returns a plausible review.
  const seen = []
  const record = out => spec => { seen.push(`${spec.command} ${spec.args.join(' ')}`); return out }
  const cacheDir = `${ROOT}tests/fixtures/codex-plugin-cache`
  const payload = { codex: { status: 0 }, result: { verdict: 'approve', summary: 'ok', findings: [], next_steps: [] }, rawOutput: null, parseError: null }

  seen.length = 0
  reviewWithCodex({ projectDir: ROOT, cacheDir, invoke: record({ code: 0, stdout: JSON.stringify(payload), stderr: '' }) })
  ok('codex defaults to working-tree', seen[0].includes('--scope working-tree'), seen[0])
  seen.length = 0
  reviewWithCodex({ projectDir: ROOT, cacheDir, scope: { kind: 'branch', base: 'origin/main' }, invoke: record({ code: 0, stdout: JSON.stringify(payload), stderr: '' }) })
  ok('codex branch scope passes --scope branch --base', seen[0].includes('--scope branch --base origin/main'), seen[0])

  const geminiInvoke = out => spec => {
    seen.push(`${spec.command} ${spec.args.join(' ')}`)
    return spec.command === 'git' ? { code: 0, stdout: 'diff --git a/a b/a\n+x\n', stderr: '' } : out
  }
  const clean = { code: 0, stdout: '```json\n{"verdict":"approve","summary":"ok","findings":[]}\n```', stderr: '' }
  seen.length = 0
  reviewWithGemini({ projectDir: ROOT, invoke: geminiInvoke(clean) })
  ok('gemini defaults to git diff HEAD', seen[0] === 'git diff HEAD', seen[0])
  seen.length = 0
  reviewWithGemini({ projectDir: ROOT, scope: { kind: 'branch', base: 'origin/main' }, invoke: geminiInvoke(clean) })
  // Three dots, not two: the merge base, so commits that landed on the base after the fork are not
  // presented to the reviewer as part of this change.
  ok('gemini branch scope diffs against the MERGE BASE', seen[0] === 'git diff origin/main...HEAD', seen[0])

  // The no-silent-zero rule has to hold for BOTH scopes, or branch scope is a fresh way to
  // manufacture a clean pass out of an empty diff.
  const empty = reviewWithGemini({
    projectDir: ROOT, scope: { kind: 'branch', base: 'origin/main' },
    invoke: spec => (spec.command === 'git' ? { code: 0, stdout: '', stderr: '' } : clean),
  })
  ok('an empty BRANCH diff is unavailable, not a clean review', empty.status === 'unavailable')
  ok('and it names the range it found empty', (empty.reason || '').includes('origin/main...HEAD'), empty.reason)
}

console.log('the gemini adapter degrades HONESTLY on prose')
{
  const diff = { code: 0, stdout: 'diff --git a/a.ts b/a.ts\n+const x = 1\n', stderr: '' }
  const withAgy = agyOut => spec => (spec.command === 'git' ? diff : agyOut)

  const prose = reviewWithGemini({ projectDir: ROOT, invoke: withAgy({ code: 0, stdout: 'Overall this looks reasonable, though the locking worries me.', stderr: '' }) })
  ok('prose is UNPARSEABLE, not a clean review', prose.status === 'unparseable')
  ok('the raw prose is preserved for a human', prose.raw?.includes('locking worries me'))
  // The dangerous pair: zero findings is only ever acceptable ALONGSIDE a status that explains it.
  ok('zero findings appear only with a non-reviewed status', prose.findings.length === 0 && prose.status !== 'reviewed')

  const json = { verdict: 'needs-attention', summary: 'One issue.', findings: [{ severity: 'high', title: 'Unchecked', body: 'No bounds check', file: 'a.ts', lineStart: 2, lineEnd: 2, confidence: 0.7, recommendation: 'Check it' }] }
  const good = reviewWithGemini({ projectDir: ROOT, invoke: withAgy({ code: 0, stdout: 'Sure, here you go:\n\n```json\n' + JSON.stringify(json) + '\n```\n', stderr: '' }) })
  ok('a fenced JSON block parses to real findings', good.status === 'reviewed' && good.findings.length === 1)
  ok('its fields map through the neutral shape', normalizeFindings(good.findings)[0].lineStart === 2)

  // Accepting {"answer":"looks fine"} as a clean review is the same fabrication as reading prose.
  ok('JSON without a findings array is unparseable',
    reviewWithGemini({ projectDir: ROOT, invoke: withAgy({ code: 0, stdout: '{"answer":"looks fine"}', stderr: '' }) }).status === 'unparseable')
  ok('a missing agy binary is unavailable',
    reviewWithGemini({ projectDir: ROOT, invoke: spec => { if (spec.command === 'git') return diff; throw new Error('ENOENT agy') } }).status === 'unavailable')
  // An empty diff is not a clean review — there was nothing to review, and saying "reviewed, 0
  // findings" would credit the provider with a pass it never performed.
  ok('an empty working tree is unavailable, not clean',
    reviewWithGemini({ projectDir: ROOT, invoke: () => ({ code: 0, stdout: '', stderr: '' }) }).status === 'unavailable')
}

console.log('several adapters per episode: one failing never hides the other')
{
  // THE REASON THIS EXISTS. Across three review rounds of this feature, eight findings were raised
  // and only ONE was raised by both shipped adapters. Every other one came from exactly one of them.
  // So a failure in one must never suppress the other's findings, and the overall status must report
  // the WEAKEST claim rather than the most flattering one.
  const approvedProject = adapters => {
    const root = mkdtempSync(join(tmpdir(), 'tpr-multi-'))
    mkdirSync(join(root, '.planning', '.state'), { recursive: true })
    const plan = `# p\n\n**Third-party review:** ${adapters}\n`
    writeFileSync(join(root, '.planning', 'p.md'), plan)
    const planHash = createHash('sha256').update(Buffer.from(plan, 'utf8')).digest('hex')
    writeFileSync(join(root, '.planning', '.state', 'review.json'), JSON.stringify({
      workflow: 'work', plan_file: 'p.md', plan_hash: planHash,
      approved_session_id: 'approver', approved_at: '2026-08-03T00:00:00.000Z',
      status: 'APPROVED', reviewer_session_id: 'reviewer', reviewed_at: '2026-08-03T00:01:00.000Z',
    }))
    return { root, planHash }
  }
  const run = (root, planHash, invoke) => runThirdPartyReview({
    projectDir: root, workflow: 'work', planReset: { planFile: 'p.md', planHash }, dispatchSession: 'dispatch', invoke,
  })
  const codexPayload = JSON.stringify({
    codex: { status: 0 },
    result: {
      verdict: 'needs-attention', summary: 'one issue',
      findings: [{ severity: 'high', title: 'T', body: 'B', file: 'a.ts', line_start: 1, line_end: 1, confidence: 0.9, recommendation: 'R' }],
      next_steps: [],
    }, rawOutput: null, parseError: null,
  })
  // One provider reviews and finds something; the other's binary is missing entirely.
  const oneDown = ({ command }) => {
    if (command === 'git') return { code: 0, stdout: 'diff --git a/a b/a\n+x\n', stderr: '' }
    if (command === 'agy') throw new Error('ENOENT agy')
    return { code: 0, stdout: codexPayload, stderr: '' }
  }

  const { root, planHash } = approvedProject('codex, gemini')
  const result = run(root, planHash, oneDown)
  ok('both adapters are attempted', result.reviews.length === 2)
  ok('each keeps its own status', result.reviews.map(r => `${r.adapter}=${r.status}`).join(',') === 'codex=reviewed,gemini=unavailable')
  ok('the working adapter\'s findings SURVIVE the other failing', result.findings.length === 1)
  ok('and every finding is attributed', result.findings[0].adapter === 'codex')
  // The single most dangerous way to read this: one adapter down reported as a clean pass by both.
  ok('overall status reports the WEAKEST claim', result.status === 'unavailable')
  ok('advisory is still true', result.advisory === true)

  const skipped = approvedProject('none')
  const off = run(skipped.root, skipped.planHash, () => { throw new Error('must not be called') })
  ok('an opt-out runs no adapter at all', off.enabled === false && off.reviews.length === 0 && off.status === 'skipped')

  // A typo in the SECOND name must be caught before the FIRST makes a paid call.
  const typo = approvedProject('codex, nosuchadapter')
  let calls = 0
  let refused = false
  try { run(typo.root, typo.planHash, () => { calls += 1; return { code: 0, stdout: codexPayload, stderr: '' } }) }
  catch { refused = true }
  ok('an unknown adapter refuses', refused)
  ok('and refuses BEFORE spending a paid call on the valid one', calls === 0)
}

console.log(`\n${PASS} passed, ${FAIL} failed`)
if (FAIL) process.exit(1)
