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
import { proseCodexAdapter, proseGeminiAdapter, extractText, parseReply, extractUsage, tailRaw, headTailRaw } from '../scripts/beat/adapters/prose.ts'
import { reviewWithGemini } from '../scripts/beat/adapters/gemini.ts'
import { adapterNames, resolveAdapter } from '../scripts/beat/adapters/registry.ts'
import { resolveSkillBriefs } from '../scripts/beat/skill-brief.ts'

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
  // The exact set is asserted, not a count: this test exists to catch an adapter added by
  // accident. Prose adapters are SEPARATE entries rather than a mode of the code ones, so a plan
  // naming "codex" for a draft fails loudly instead of reviewing a diff nobody asked about.
  ok('the registry ships exactly the four adapters',
    JSON.stringify(adapterNames()) === JSON.stringify(['codex', 'gemini', 'prose-codex', 'prose-gemini']))
  ok('an unknown adapter does not resolve', resolveAdapter('nope') === undefined)
  ok('every adapter exposes the same shape',
    ['codex', 'gemini', 'prose-codex', 'prose-gemini'].every(name => typeof resolveAdapter(name)?.review === 'function' && resolveAdapter(name)?.name === name))
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


console.log('the prose adapters survive the failures that were actually observed')
{
  const docDir = mkdtempSync(join(tmpdir(), 'prose-'))
  const docPath = join(docDir, 'draft.md')
  writeFileSync(docPath, 'The organisation recognised its behaviour.\n')
  const scope = { kind: 'document', path: docPath }
  const run = (stdout, code = 0) => proseGeminiAdapter.review({ projectDir: ROOT, scope, invoke: () => ({ code, stdout, stderr: '' }) })

  // THE OBSERVED GEMINI FAILURE. A real transcript: the text arrives, then an EMPTY thinking
  // block, and the harness's own `result` field comes back "". Reading `result` would have made
  // every Gemini review report zero findings while exit 0 / success / billed tokens all agreed.
  const withTrailingThinking = [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '```json\n{"verdict":"needs-attention","summary":"s","findings":[{"severity":"high","title":"t","body":"b"}]}\n```' }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: '' }] } }),
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '' }),
  ].join('\n')
  const recovered = run(withTrailingThinking)
  ok('text is recovered despite an empty trailing thinking block', recovered.status === 'reviewed')
  ok('and the finding survives', recovered.findings.length === 1)

  // A provider that returns NOTHING must be unavailable, never a clean pass.
  const silent = run(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '' }))
  ok('no assistant text is UNAVAILABLE, not zero findings', silent.status === 'unavailable')
  ok('zero findings only ever alongside a status that explains it', silent.findings.length === 0 && silent.status !== 'reviewed')

  // Commentary instead of JSON is unparseable, and the words are kept for a human.
  const chatty = run(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Looks fine to me overall.' }] } }))
  ok('prose commentary is UNPARSEABLE', chatty.status === 'unparseable')
  ok('the raw text is preserved', chatty.raw?.includes('Looks fine'))

  // A code scope handed to a prose adapter must refuse rather than review the wrong thing.
  const wrongScope = proseCodexAdapter.review({ projectDir: ROOT, scope: { kind: 'working-tree' }, invoke: () => ({ code: 0, stdout: '', stderr: '' }) })
  ok('a prose adapter refuses a diff scope', wrongScope.status === 'unavailable' && /scope/.test(wrongScope.reason ?? ''))

  // ...and the converse, which is why these are separate adapters at all.
  const codeOnDoc = reviewWithCodex({ projectDir: ROOT, scope, invoke: () => ({ code: 0, stdout: '', stderr: '' }) })
  ok('a code adapter refuses a document scope', codeOnDoc.status === 'unavailable' && /documents/.test(codeOnDoc.reason ?? ''))

  // The invocation itself is load-bearing: stdin must be closed or the wrapper stalls on it.
  let seen
  proseCodexAdapter.review({ projectDir: ROOT, scope, invoke: spec => { seen = spec; return { code: 0, stdout: '', stderr: '' } } })
  ok('it shells the harness wrapper, not the raw provider CLI', seen.command === 'codex-code')
  ok('stream-json is requested, because `result` is unreliable', seen.args.includes('stream-json') && seen.args.includes('--verbose'))
  ok('stdin is closed explicitly', seen.input === '')
  ok('the draft is in the prompt', seen.args.at(-1).includes('The organisation recognised'))

  ok('extractText concatenates multiple text blocks',
    extractText([
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'a' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'b' }] } }),
    ].join('\n')) === 'ab')
  ok('parseReply reads a fenced block', parseReply('pre\n```json\n{"findings":[]}\n```\npost')?.findings.length === 0)

  // ── THE ANSWER IS NOT ALWAYS THE FIRST FENCE ───────────────────────────────
  // Reproduces the v5.131.0 prose-codex loss verbatim. Its reply carried six fenced blocks that
  // were not the answer; the first held an arithmetic aside. Taking the first fence and committing
  // to it threw away seven real findings — one anchored to span S009, one naming a truncated
  // sentence in the letter that no internal gate had caught — and reported "no JSON findings
  // block" while `raw` displayed a valid JSON object. prose-gemini survived the same release only
  // because its reply happened to contain exactly one fence.
  {
    const answer = { verdict: 'needs-attention', summary: 's', spanIds: ['S009'], findings: [{ severity: 'medium', title: 'The replication caveat is broken', spanIds: ['S009'] }] }
    const realShape = [
      'PROSE QUALITY REVIEW: the letter\n',
      '```text\n49,135,555 − 19,751 − 9,150 = 49,106,654\n```\n',
      'SOURCE-FIDELITY REVIEW: checking the cites\n',
      '```\nsome quoted snippet\n```\n',
      '## Bottom line\n\n',
      '```json\n' + JSON.stringify(answer, null, 2) + '\n```\n',
    ].join('')

    const parsed = parseReply(realShape)
    ok('a non-JSON earlier fence no longer kills the reply', Array.isArray(parsed?.findings))
    ok('the findings survive it', parsed?.findings.length === 1)
    ok('the span anchoring survives it', parsed?.findings[0].spanIds[0] === 'S009')
    ok('the considered-span list survives it', parsed?.spanIds[0] === 'S009')

    // Selection is BY CONTRACT, not by position: an earlier fence holding valid JSON that is not
    // the answer must also lose. This is the case "take the LAST fence" would get wrong too.
    const decoyJson = '```json\n{"note":"a schema I was quoting"}\n```\n```json\n' + JSON.stringify(answer) + '\n```'
    ok('an earlier VALID-JSON fence does not win either', parseReply(decoyJson)?.findings.length === 1)

    // Shapes a provider actually produces when it half-follows the instruction.
    ok('a reply cut off before its closing fence still parses',
       parseReply('```json\n' + JSON.stringify(answer))?.findings.length === 1)
    ok('bare JSON with no fence at all still parses',
       parseReply(JSON.stringify(answer))?.findings.length === 1)
    ok('prose with no JSON anywhere is still undefined', parseReply('I think it reads well.') === undefined)
  }

  // ── THE TWO PARSE FAILURES ARE DIFFERENT FAILURES ──────────────────────────
  // "No JSON at all" means the prompt needs work; "JSON in the wrong shape" means the schema does.
  // One reason string for both is what made the v5.131.0 report self-contradictory.
  {
    const stream = t => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } })
    const run = t => proseGeminiAdapter.review({ projectDir: ROOT, scope, invoke: () => ({ code: 0, stdout: stream(t), stderr: '' }) })

    const chatty = run('Honestly it reads fine to me.')
    ok('prose with no JSON says so', chatty.status === 'unparseable' && /no JSON object/.test(chatty.reason))

    const wrongShape = run('```json\n{"verdict":"approve","notes":[]}\n```')
    ok('JSON in the wrong shape is a DIFFERENT reason', wrongShape.status === 'unparseable' && /no "findings" array/.test(wrongShape.reason))
    ok('and it names the keys it did get', /verdict/.test(wrongShape.reason) && /notes/.test(wrongShape.reason))
  }

  // ── THE FAILURE PATH KEEPS BOTH ENDS ───────────────────────────────────────
  // `tailRaw` is right when the answer parsed. On a parse failure the preserved text is the ONLY
  // artifact and the cause is at the HEAD — so the old truncation destroyed exactly the evidence
  // for the failure it was reporting, which is worse than no `raw`, because it looks like evidence.
  {
    const head = 'CAUSE-OF-FAILURE-AT-THE-HEAD\n' + 'h'.repeat(4000)
    const tail = 't'.repeat(4000) + '\nEND-OF-STREAM'
    const both = headTailRaw(`${head}\n${tail}`)
    ok('the head survives the failure path', both.includes('CAUSE-OF-FAILURE-AT-THE-HEAD'))
    ok('the tail survives it too', both.includes('END-OF-STREAM'))
    ok('the elision is marked, not silent', /characters elided from the middle/.test(both))
    ok('text under the cap is untouched', headTailRaw('short') === 'short')

    // And the stdout transcript is carried SEPARATELY on that path, because `raw` there is the
    // extracted text and so can never contain a tool_use block. Without this, "did the reviewer
    // open any files?" was answerable only when the run succeeded — an audit trail present
    // exactly where it was least needed.
    const withTools = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', id: 't1', input: {} }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'no json here' }] } }),
    ].join('\n')
    const failed = proseGeminiAdapter.review({ projectDir: ROOT, scope, invoke: () => ({ code: 0, stdout: withTools, stderr: '' }) })
    ok('the failure path carries the stdout transcript too', failed.status === 'unparseable' && failed.transcript.includes('tool_use'))
    ok('and raw stays the text that failed to parse', failed.raw.includes('no json here') && !failed.raw.includes('tool_use'))
  }

  // ── raw KEEPS THE TAIL, BECAUSE THAT IS WHERE THE ACCOUNTING IS ────────────
  // `raw` was the first 4000 bytes, which on a real review is SessionStart hook chatter — measured,
  // `"total_cost_usd" in raw` was false for both adapters. The cost, the turn count and the
  // tool-use record all live in the final events.
  {
    const noise = 'x'.repeat(6000)
    const resultLine = JSON.stringify({ type: 'result', subtype: 'success', total_cost_usd: 0.66881, duration_ms: 139000, num_turns: 3 })
    const stdout = `${noise}\n${resultLine}\n`
    ok('the tail is kept, not the head', tailRaw(stdout).includes('total_cost_usd'))
    ok('the head is dropped when it does not fit', !tailRaw(stdout).startsWith('xxxx'))
    ok('a transcript under the cap is kept whole', tailRaw('short\n') === 'short\n')
    // Slicing mid-token would leave an unparseable fragment; the cut lands on a line boundary.
    for (const line of tailRaw(stdout).split('\n')) {
      if (line.trim().startsWith('{')) JSON.parse(line)
    }
    ok('every JSON line in the tail is still parseable', true)

    const usage = extractUsage(stdout)
    ok('cost is extracted', usage.totalCostUsd === 0.66881, JSON.stringify(usage))
    ok('duration and turns come with it', usage.durationMs === 139000 && usage.numTurns === 3)
    ok('a transcript with no result event yields nulls, never zeros',
       extractUsage('{"type":"assistant"}').totalCostUsd === null)
  }

  // ── EVIDENCE IN, INSTRUCTION OUT ───────────────────────────────────────────
  // The prompt used to open "FIRST, load these skills and apply them". Nothing checked whether
  // that happened, and the success path threw away the transcript from which anyone could have
  // checked — which is exactly why the rule611 review could not be audited after the fact. The
  // deterministic audit now runs here and its spans go into the prompt with their ids.
  const promptOf = spec => spec.args.at(-1)
  {
    let spec
    proseCodexAdapter.review({ projectDir: ROOT, scope, invoke: s => { spec = s; return { code: 0, stdout: '', stderr: '' } } })
    const prompt = promptOf(spec)
    ok('the prompt no longer instructs the reviewer to load skills', !/load these skills/i.test(prompt))
    ok('the audit spans are INJECTED, with their ids', /\bS001\b/.test(prompt), prompt.slice(0, 400))
    // The fixture draft is "The organisation recognised its behaviour." — three US-register
    // spelling spans, so the injected block is real audit output, not a placeholder.
    ok('the injected spans are the real audit output', /organisation|recognised|behaviour/.test(prompt))
    // The corpus rules are NO LONGER inlined here — they are the caller's bundle, and with no
    // bundle supplied the prompt is the generic second-opinion frame. See the domain-neutrality
    // section below for the assertion that keeps them out of the source.
    ok('with no bundle supplied the prompt carries no domain rules', !/RULES YOU ARE BEING GIVEN/.test(prompt))
    ok('each finding must name the span ids it rests on', /"spanIds"/.test(prompt))
    // The harness wrapper is only worth its skill-roster tokens if the reviewer is given a reason
    // to use the tool loop. It was not, and measured zero tool_use blocks on a real run.
    ok('the prompt asks the reviewer to check claims against the repo',
       /READ THE REPOSITORY/.test(prompt) && /open the source and\ncheck it/.test(prompt), prompt.slice(0, 200))
  }
  {
    // A document with no spans must say so rather than leave the reviewer guessing.
    const cleanDir = mkdtempSync(join(tmpdir(), 'prose-clean-'))
    const cleanPath = join(cleanDir, 'clean.md')
    writeFileSync(cleanPath, 'Rain fell all night and the river rose by dawn.\n')
    let spec
    proseCodexAdapter.review({ projectDir: ROOT, scope: { kind: 'document', path: cleanPath }, invoke: s => { spec = s; return { code: 0, stdout: '', stderr: '' } } })
    ok('no spans is stated, not implied', /produced no spans/.test(promptOf(spec)), promptOf(spec).slice(0, 300))
  }
  {
    // COST AND THE TOOL-USE RECORD SURVIVE A SUCCESSFUL REVIEW. `raw` was carried only by the two
    // failure paths, so the one case where the provider worked was the one that left no trace.
    const transcript = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '```json\n{"verdict":"approve","summary":"s","spanIds":["S001"],"findings":[{"severity":"low","title":"t","body":"b","spanIds":["S001"]}]}\n```' }] } }),
      JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.1234 }),
    ].join('\n')
    const reviewed = run(transcript)
    ok('a reviewed result carries raw', reviewed.status === 'reviewed' && typeof reviewed.raw === 'string')
    ok('and total_cost_usd survives in it', reviewed.raw.includes('total_cost_usd'))
    ok('the accounting is lifted into typed fields, not left to survive truncation',
       reviewed.usage.totalCostUsd === 0.1234, JSON.stringify(reviewed.usage))
    ok('spanIds survive the neutral shape', normalizeFindings(reviewed.findings)[0].spanIds[0] === 'S001')
    ok('a finding without spanIds gets [] rather than undefined',
       normalizeFindings([{ severity: 'low', title: 't', body: 'b' }])[0].spanIds.length === 0)
  }
}


console.log('the rules are the CALLER\'S, and what the reviewer got stays checkable afterwards')
{
  // WHY THIS SECTION EXISTS. The domain rules used to be ~15 lines of writing-specific corpus
  // findings welded into `prose.ts:buildPrompt`. They were inlined for a good reason — the version
  // before that merely TOLD the reviewer to load two skills, nothing checked whether it had, and
  // after the rule611 review the question turned out to be unanswerable rather than unanswered.
  // The fix was right and it is exactly what made the adapter unusable by any other domain: the
  // only way to give a reviewer a domain's rules was to edit this file. The rules moved to the
  // caller's bundle; the INVARIANT that had to survive the move is that what the reviewer was
  // given remains checkable after the run, which is what `briefSources` is.

  // ── 1. THE ADAPTER NAMES NO WRITING RULE ───────────────────────────────────
  // The mirror of the provider-neutrality assertion above, and the thing that keeps this adapter
  // reusable: a domain rule that creeps back into the source is a domain the next caller cannot
  // override without editing it.
  {
    const source = readFileSync(`${ROOT}scripts/beat/adapters/prose.ts`, 'utf8')
    for (const literal of ['Economist', 'em-dash', 'nominalisation', 'Latinate', 'semicolon']) {
      ok(`the prose adapter names no writing-domain rule: ${literal}`, !source.toLowerCase().includes(literal.toLowerCase()))
    }
  }

  // ── 2. RESOLUTION IS STRICT ────────────────────────────────────────────────
  // A typo that silently yielded no rules is the same silent zero the `status` field exists to
  // prevent, one layer up: the reviewer runs, reports cleanly, and nobody learns it was judging
  // against nothing.
  {
    const resolved = resolveSkillBriefs(ROOT, ['ai-anti-patterns/references/12-economist-2026-corpus-study.md'])
    ok('an explicit reference path resolves', resolved.length === 1 && resolved[0].bytes > 0)
    ok('and it carries a hash of the bytes handed over', /^[0-9a-f]{64}$/.test(resolved[0].sha256))
    ok('the reported path is skills-relative, not absolute', !resolved[0].path.startsWith('/'))

    const bare = resolveSkillBriefs(ROOT, ['de-ai-revise'])
    ok('a bare skill name falls back to SKILL.md', bare.length === 1 && bare[0].path === 'de-ai-revise/SKILL.md')

    ok('no bundle is not an error', resolveSkillBriefs(ROOT, undefined).length === 0)
    ok('duplicates collapse rather than spending the cap twice',
      resolveSkillBriefs(ROOT, ['de-ai-revise', 'de-ai-revise']).length === 1)

    const throws = names => { try { resolveSkillBriefs(ROOT, names); return false } catch { return true } }
    ok('a missing bundle THROWS rather than yielding zero rules', throws(['no-such-skill-at-all']))
    ok('a traversal escape throws', throws(['../../../etc/passwd']))
    ok('an absolute path outside the tree throws', throws(['/etc/passwd']))
    ok('a non-string entry throws', throws([{}]))
    // Truncating a rule set mid-sentence yields a reviewer applying half a rule, which still looks
    // like a review. Refusing is the only honest option.
    ok('over the byte cap throws rather than truncating a rule set',
      throws(['writing-general/references/elements-of-style.md']))
  }

  // ── 3. BRIEFS REACH THE PROMPT, NAMED ──────────────────────────────────────
  {
    const docDir = mkdtempSync(join(tmpdir(), 'prose-briefs-'))
    const docPath = join(docDir, 'draft.md')
    writeFileSync(docPath, 'The organisation recognised its behaviour.\n')
    const scope = { kind: 'document', path: docPath }
    const briefs = resolveSkillBriefs(ROOT, ['ai-anti-patterns/references/12-economist-2026-corpus-study.md'])

    let spec
    const reviewed = proseCodexAdapter.review({
      projectDir: ROOT, scope, briefs,
      invoke: s => { spec = s; return { code: 0, stdout: JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '```json\n{"verdict":"approve","summary":"s","findings":[]}\n```' }] } }), stderr: '' } },
    })
    const prompt = spec.args.at(-1)
    ok('the bundle text reaches the prompt', prompt.includes(briefs[0].text.trim().split('\n')[0]))
    ok('and the source file is NAMED, so a finding can be traced to its rule', prompt.includes(briefs[0].path))
    ok('the bundle is framed as data, like the spans', /RULES YOU ARE BEING GIVEN/.test(prompt))
    ok('the deterministic spans are still injected alongside it', /\bS001\b/.test(prompt))
    ok('the receipt names what was handed over',
      reviewed.briefSources.length === 1 && reviewed.briefSources[0].sha256 === briefs[0].sha256)
    ok('and the receipt carries no bytes, only the hash', reviewed.briefSources[0].text === undefined)

    // ── 4. THE RECEIPT SURVIVES FAILURE ──────────────────────────────────────
    // `raw` is carried on every path for this reason and the receipt is no different: one that
    // exists only when the run succeeded answers the audit question where nobody needs to ask it.
    const dead = proseCodexAdapter.review({ projectDir: ROOT, scope, briefs, invoke: () => ({ code: 0, stdout: '', stderr: '' }) })
    ok('a provider that returned nothing is still unavailable', dead.status === 'unavailable')
    ok('and its briefSources are STILL populated', dead.briefSources.length === 1 && dead.briefSources[0].path === briefs[0].path)

    const wrongScope = proseCodexAdapter.review({ projectDir: ROOT, scope: { kind: 'working-tree' }, briefs, invoke: () => ({ code: 0, stdout: '', stderr: '' }) })
    ok('even a refusal before the provider is reached carries the receipt', wrongScope.briefSources.length === 1)

    // ── 5. ZERO BRIEFS STILL REVIEWS ─────────────────────────────────────────
    // No regression for the callers that pass nothing, which is every existing one.
    const plain = proseGeminiAdapter.review({
      projectDir: ROOT, scope,
      invoke: () => ({ code: 0, stdout: JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '```json\n{"verdict":"approve","summary":"s","findings":[]}\n```' }] } }), stderr: '' }),
    })
    ok('omitting the bundle still yields a reviewed result', plain.status === 'reviewed')
    ok('and an empty receipt, which is the honest answer', Array.isArray(plain.briefSources) && plain.briefSources.length === 0)
  }

  // ── 6. A CODE ADAPTER REPORTS THE EMPTY RECEIPT RATHER THAN INHERITING ONE ──
  // It ignores the bundle, so `[]` is the truth: the rules did not reach the reviewer. Copying the
  // beat's resolution over it would manufacture a receipt for rules nobody saw.
  {
    const payload = { codex: { status: 0 }, result: { verdict: 'approve', summary: 'ok', findings: [], next_steps: [] }, rawOutput: null, parseError: null }
    const result = reviewWithCodex({
      projectDir: ROOT, cacheDir: `${ROOT}tests/fixtures/codex-plugin-cache`,
      briefs: resolveSkillBriefs(ROOT, ['de-ai-revise']),
      invoke: () => ({ code: 0, stdout: JSON.stringify(payload), stderr: '' }),
    })
    ok('a code adapter still reviews when handed a bundle', result.status === 'reviewed')
    ok('and reports an EMPTY receipt, because the bundle did not reach the reviewer', result.briefSources.length === 0)
  }
}

console.log(`\n${PASS} passed, ${FAIL} failed`)
if (FAIL) process.exit(1)