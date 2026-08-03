// The beat transition machinery: governance marker, episode state, phase recording, the blocking
// Stop gate, and the exit discharge.
//
// THE FIRST SECTION IS THE ONE THAT MATTERS MOST. Every hook here runs in EVERY project of EVERY
// user, and one of them can refuse to let a turn end. A project that never opted in must be
// completely untouched — no denials, no files, no output. That is not a nice-to-have; a regression
// there means strangers' sessions stop working for a feature they never asked for. It is asserted
// first and asserted for every component.
//
// The measured defect this whole design answers: an episode was planned, approved and implemented
// entirely from main chat with no gate firing once, because `governed` is defined by a receipt
// surface that only the workflow's own approval step creates. Enforcement was bootstrapped by the
// thing it enforces. See docs/DESIGN-beat-transitions.md.
//
// Run: bun tests/beat-transitions.test.mjs
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { governedRoot, isGoverned } from '../hooks/lib/governance-marker.ts'
import { MAX_REVIEW_BLOCKS, initEpisodeState, matchesPlan, validEpisodeState } from '../hooks/lib/episode-state.ts'
import { exitEpisode } from '../scripts/beat/episode-exit.ts'
import { completeReview } from '../scripts/beat/episode-review-complete.ts'

const ROOT = new URL('..', import.meta.url).pathname
let PASS = 0, FAIL = 0
const ok = (name, condition, extra = '') => {
  if (condition) PASS++
  else { FAIL++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`) }
}

const made = []
function project({ governed = null, episode = undefined, sentinels = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'beat-transitions-'))
  made.push(root)
  mkdirSync(join(root, '.planning', '.state'), { recursive: true })
  if (governed !== null) writeFileSync(join(root, '.claude-workflows.json'), typeof governed === 'string' ? governed : JSON.stringify({ schemaVersion: 1, governed }))
  if (episode !== undefined) writeFileSync(join(root, '.planning', '.state', 'episode.json'), typeof episode === 'string' ? episode : JSON.stringify(episode))
  for (const name of sentinels) writeFileSync(join(root, '.planning', `${name}_CLARIFIED.json`), JSON.stringify({ status: 'clarified', sessionId: 's1' }))
  return root
}
const hook = (name, root, payload) =>
  execFileSync('bun', [join(ROOT, 'hooks', name)], { cwd: root, input: JSON.stringify(payload), encoding: 'utf8' })
const episodeOf = root => JSON.parse(readFileSync(join(root, '.planning', '.state', 'episode.json'), 'utf8'))
const hasEpisode = root => existsSync(join(root, '.planning', '.state', 'episode.json'))

const OWED = {
  schemaVersion: 1, workflow: 'work', planFile: null, planHash: null, sessionId: 's1',
  phases: { implemented: '2026-08-03T00:00:00.000Z' }, reviewOwed: true, reviewBlocks: 0, exit: null, editsSinceVerify: 0,
}
const ASK = root => ({ tool_name: 'AskUserQuestion', session_id: 's9', cwd: root })

console.log('an UNGOVERNED project is untouched by every component')
{
  const root = project({ governed: null, episode: JSON.stringify(OWED) })
  ok('Stop gate stays silent with a review owed', hook('episode-transition-gate.ts', root, { stop_hook_active: false, cwd: root }) === '')
  const noEpisode = project({ governed: null })
  hook('episode-phase.ts', noEpisode, ASK(noEpisode))
  ok('phase recorder writes no episode file', !hasEpisode(noEpisode))
  ok('isGoverned is false with no marker', isGoverned(noEpisode) === false)
}

console.log('the governance marker')
{
  ok('explicit governed:false is NOT governed', isGoverned(project({ governed: false })) === false)
  ok('governed:true is governed', isGoverned(project({ governed: true })) === true)
  // Corrupting the marker must not be a way to switch enforcement off. A typo arms the gates, which
  // is discoverable; silently disabling them is not.
  ok('a malformed marker fails CLOSED (governed)', isGoverned(project({ governed: 'not json at all' })) === true)
}

console.log('the governed root is resolved by walking up, and the walk is bounded at the repository')
{
  // Found by the gemini adapter: every hook asked `process.cwd()`, so running Claude from a
  // subdirectory silently turned governance off — the receipt was never written, the episode looked
  // governed to the user, and nothing said otherwise. A silent skip is the worst available shape.
  const root = project({ governed: true })
  mkdirSync(join(root, 'src', 'deep', 'nested'), { recursive: true })
  ok('a subdirectory resolves to the governed root', governedRoot(join(root, 'src', 'deep', 'nested')) === root)
  ok('the root resolves to itself', governedRoot(root) === root)
  ok('an unmarked project resolves to nothing at any depth', governedRoot(join(project({ governed: null }), 'src')) === undefined)

  // The walk must not escape into a parent, or one stray marker in $HOME governs every project
  // beneath it — the same shape as the ~/.planning symlink that once cost every session there its Bash.
  const outer = mkdtempSync(join(tmpdir(), 'beat-transitions-outer-'))
  made.push(outer)
  writeFileSync(join(outer, '.claude-workflows.json'), JSON.stringify({ schemaVersion: 1, governed: true }))
  const inner = join(outer, 'inner')
  mkdirSync(join(inner, '.git'), { recursive: true })
  ok('the walk stops at the repository and does not inherit a marker from above', governedRoot(inner) === undefined)
}

console.log('the Stop gate blocks only when a debt is real, readable and undischarged')
{
  const owed = project({ governed: true, episode: OWED })
  const blocked = JSON.parse(hook('episode-transition-gate.ts', owed, { stop_hook_active: false, cwd: owed }))
  ok('blocks when a review is owed', blocked.decision === 'block')
  ok('the block names the exit script, so the debt is dischargeable', blocked.reason.includes('episode-exit.ts'))
  ok('the block names both legal moves', /review/i.test(blocked.reason) && /abandoned/.test(blocked.reason))

  // BOUNDED RETRY. The old guard passed unconditionally on `stop_hook_active`, which bounded the
  // loop but reduced enforcement to a SINGLE prompt — codex found that the gate was trivially
  // ignored by stopping twice. The counter replaces it: refuse MAX_REVIEW_BLOCKS times, then stand
  // down permanently. `stop_hook_active` is no longer consulted at all.
  const budget = project({ governed: true, episode: OWED })
  let blocks = 0
  for (let attempt = 0; attempt < MAX_REVIEW_BLOCKS + 3; attempt++) {
    if (hook('episode-transition-gate.ts', budget, { stop_hook_active: attempt > 0, cwd: budget }).includes('"block"')) blocks++
  }
  ok(`it refuses exactly MAX_REVIEW_BLOCKS (${MAX_REVIEW_BLOCKS}) times, then stands down`, blocks === MAX_REVIEW_BLOCKS, `blocked ${blocks}x`)
  ok('the spent budget is recorded', episodeOf(budget).reviewBlocks === MAX_REVIEW_BLOCKS)
  ok('the debt itself is untouched by the budget running out', episodeOf(budget).reviewOwed === true)

  // The escape must survive an unwritable state directory, or the counter can never advance and the
  // gate refuses forever — the exact infinite loop the bound exists to prevent.
  const unwritable = project({ governed: true, episode: OWED })
  chmodSync(join(unwritable, '.planning', '.state'), 0o500)
  const underFailedWrite = hook('episode-transition-gate.ts', unwritable, { stop_hook_active: false, cwd: unwritable })
  chmodSync(join(unwritable, '.planning', '.state'), 0o700)
  ok('a failed counter write passes rather than blocking forever', underFailedWrite === '')

  const unreadable = project({ governed: true, episode: 'not json' })
  ok('an unreadable episode does not wedge the session',
    hook('episode-transition-gate.ts', unreadable, { stop_hook_active: false, cwd: unreadable }) === '')

  const exited = project({ governed: true, episode: { ...OWED, reviewOwed: false, exit: { at: '2026-08-03T01:00:00.000Z', reason: 'abandoned' } } })
  ok('an exited episode does not block',
    hook('episode-transition-gate.ts', exited, { stop_hook_active: false, cwd: exited }) === '')

  const clean = project({ governed: true, episode: { ...OWED, reviewOwed: false } })
  ok('no debt, no block', hook('episode-transition-gate.ts', clean, { stop_hook_active: false, cwd: clean }) === '')
}

console.log('exit discharges the debt, records why, and never launders it')
{
  const root = project({ governed: true, episode: OWED })
  const first = exitEpisode(root, 'abandoned', '2026-08-03T02:00:00.000Z')
  ok('abandoning WITH a review owed succeeds', first.ok === true)
  ok('the outstanding debt is surfaced, not swallowed', first.ok && first.reviewWasOwed === true)
  ok('the debt is cleared', episodeOf(root).reviewOwed === false)
  ok('Stop gate no longer blocks after exit',
    hook('episode-transition-gate.ts', root, { stop_hook_active: false, cwd: root }) === '')

  // A second exit must not rewrite history into something more flattering.
  exitEpisode(root, 'completed', '2026-08-03T03:00:00.000Z')
  ok('a later exit cannot launder abandoned into completed', episodeOf(root).exit.reason === 'abandoned')

  ok('an invalid reason refuses', exitEpisode(root, 'whatever', '2026-08-03T04:00:00.000Z').ok === false)
  ok('an ungoverned project has no episode to exit', exitEpisode(project({ governed: null }), 'completed', '2026-08-03T04:00:00.000Z').ok === false)
  const corrupt = project({ governed: true, episode: 'not json' })
  const refused = exitEpisode(corrupt, 'completed', '2026-08-03T04:00:00.000Z')
  ok('exit refuses to overwrite an unreadable episode', refused.ok === false && /does not parse/.test(refused.reason))
}

console.log('a COMPLETED review discharges the debt — not only an exit')
{
  // Regression for the gap the codex third-party adapter found: both beat skills documented
  // "complete the review, or record an exit" while only the exit path existed, so a genuinely
  // reviewed episode kept blocking and the only way out was filing it as ABANDONED — a completed
  // review recorded as an abandonment, which corrupts the audit trail in the worst direction.
  const root = project({ governed: true, episode: OWED })
  const done = completeReview(root, 'ACCEPT', '2026-08-03T05:00:00.000Z')
  ok('completing a review succeeds', done.ok === true, done.ok ? '' : done.reason)
  ok('it records the reviewed phase', episodeOf(root).phases.reviewed === '2026-08-03T05:00:00.000Z')
  ok('it clears the debt', episodeOf(root).reviewOwed === false)
  ok('the Stop gate stops blocking', hook('episode-transition-gate.ts', root, { stop_hook_active: false, cwd: root }) === '')
  ok('no exit is fabricated — the episode is reviewed, not abandoned', episodeOf(root).exit === null)

  // A rejection still discharges: beat-review routes it to CLARIFY through a NEW plan, and leaving
  // the debt outstanding would block the very turn doing what the rejection asked for.
  const rejected = project({ governed: true, episode: OWED })
  ok('REJECT also discharges', completeReview(rejected, 'REJECT', '2026-08-03T05:00:00.000Z').ok === true)

  ok('an invalid decision refuses', completeReview(project({ governed: true, episode: OWED }), 'MAYBE', '2026-08-03T05:00:00.000Z').ok === false)
  ok('an ungoverned project has nothing to review', completeReview(project({ governed: null }), 'ACCEPT', '2026-08-03T05:00:00.000Z').ok === false)
  const corrupt = project({ governed: true, episode: 'not json' })
  ok('it refuses to overwrite an unreadable episode', completeReview(corrupt, 'ACCEPT', '2026-08-03T05:00:00.000Z').ok === false)
  const closed = project({ governed: true, episode: { ...OWED, reviewOwed: false, exit: { at: '2026-08-03T01:00:00.000Z', reason: 'abandoned' } } })
  ok('it refuses to reopen an exited episode', completeReview(closed, 'ACCEPT', '2026-08-03T05:00:00.000Z').ok === false)
  // A review of one plan must not satisfy another plan's obligation.
  const bound = project({ governed: true, episode: { ...OWED, planFile: 'a.md', planHash: 'a'.repeat(64) } })
  ok('a mismatched plan identity refuses',
    completeReview(bound, 'ACCEPT', '2026-08-03T05:00:00.000Z', { planFile: 'b.md', planHash: 'b'.repeat(64) }).ok === false)
  ok('the matching plan identity is accepted',
    completeReview(bound, 'ACCEPT', '2026-08-03T05:00:00.000Z', { planFile: 'a.md', planHash: 'a'.repeat(64) }).ok === true)
}

console.log('CLARIFY is recorded from an observed AskUserQuestion, not from self-assertion')
{
  const root = project({ governed: true })
  hook('episode-phase.ts', root, ASK(root))
  const first = episodeOf(root).phases.clarified
  ok('the clarify phase is recorded', typeof first === 'string' && first.length > 0)
  ok('the session is captured', episodeOf(root).sessionId === 's9')

  hook('episode-phase.ts', root, ASK(root))
  ok('a later question does not re-stamp the phase', episodeOf(root).phases.clarified === first)

  // Workflow identity is derived from evidence on disk, never defaulted blindly — the plugin-wide and
  // skill-scoped hooks both fire on the same call and must compute the same answer whatever the order.
  const dev = project({ governed: true, sentinels: ['DEV'] })
  hook('episode-phase.ts', dev, ASK(dev))
  ok('workflow derives from the clarify sentinel', episodeOf(dev).workflow === 'dev')
  const bare = project({ governed: true })
  hook('episode-phase.ts', bare, ASK(bare))
  ok('with no evidence it falls back to the bare primitive', episodeOf(bare).workflow === 'work')

  const corrupt = project({ governed: true, episode: 'not json' })
  hook('episode-phase.ts', corrupt, ASK(corrupt))
  ok('an unreadable episode is not overwritten', readFileSync(join(corrupt, '.planning', '.state', 'episode.json'), 'utf8') === 'not json')
}

console.log('CLARIFY evidence: the observed record is preferred, the sentinel still works')
{
  // WHY BOTH PATHS EXIST — the first case is the reason the sentinel cannot simply be retired.
  // This guard is SKILL-scoped (fires in every project running /dev or /ds); the phase recorder is
  // MARKER-gated (writes nothing without .claude-workflows.json). Drop the sentinel and clarified()
  // can never become true in an unmarked project, so /dev is permanently denied reconnaissance.
  const guard = (root, session = 's1') => {
    const out = execFileSync('bun', [join(ROOT, 'hooks', 'clarify-before-recon-guard.ts'), '--workflow', 'dev'], {
      cwd: root, encoding: 'utf8',
      input: JSON.stringify({ tool_name: 'Read', session_id: session, cwd: root, tool_input: { file_path: 'src/a.ts' } }),
    })
    return out.includes('"deny"') ? 'DENY' : 'ALLOW'
  }
  const sentinel = (root, session = 's1') =>
    writeFileSync(join(root, '.planning', 'DEV_CLARIFIED.json'), JSON.stringify({ status: 'clarified', sessionId: session }))

  ok('no evidence denies recon', guard(project({ governed: null })) === 'DENY')

  const unmarked = project({ governed: null })
  sentinel(unmarked)
  ok('an UNMARKED project still clears via the sentinel — the no-regression case', guard(unmarked) === 'ALLOW')

  const marked = project({ governed: true })
  execFileSync('bun', [join(ROOT, 'hooks', 'episode-phase.ts')], {
    cwd: marked, encoding: 'utf8', input: JSON.stringify({ tool_name: 'AskUserQuestion', session_id: 's1', cwd: marked }),
  })
  ok('a marked project clears via the observed record, with no sentinel', guard(marked) === 'ALLOW')
  // The sentinel's session binding must survive the move to episode evidence.
  ok('evidence bound to another session does not clear', guard(marked, 'SOMEONE-ELSE') === 'DENY')

  const both = project({ governed: true, episode: 'not json' })
  sentinel(both)
  ok('an unreadable episode falls through to the sentinel rather than denying', guard(both) === 'ALLOW')
}

console.log('episode state is strictly parsed')
{
  const base = initEpisodeState({ workflow: 'work', sessionId: 's1' })
  ok('a fresh episode validates', validEpisodeState(base) === true)
  ok('an unknown key is rejected', validEpisodeState({ ...base, sneaky: 1 }) === false)
  ok('a missing key is rejected', validEpisodeState({ ...base, phases: undefined }) === false)
  // Requiring a session was a real defect: the edit-counter hook receives a payload without one, so
  // a mandatory field made it silently stop counting.
  ok('a null session is allowed', validEpisodeState({ ...base, sessionId: null }) === true)
  ok('a bad plan hash is rejected', validEpisodeState({ ...base, planHash: 'short' }) === false)
  ok('an unknown exit reason is rejected', validEpisodeState({ ...base, exit: { at: '2026-08-03T00:00:00.000Z', reason: 'nope' } }) === false)
  ok('an unbound episode matches any plan', matchesPlan(base, 'p.md', 'a'.repeat(64)) === true)
  ok('a bound episode rejects another plan',
    matchesPlan({ ...base, planFile: 'p.md', planHash: 'a'.repeat(64) }, 'q.md', 'b'.repeat(64)) === false)
}

for (const dir of made) rmSync(dir, { recursive: true, force: true })
console.log(`\n${PASS} passed, ${FAIL} failed`)
if (FAIL) process.exit(1)
