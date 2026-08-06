// WHICH WORKFLOW DOES AN EPISODE THINK IT IS?
//
// THE MEASURED DEFECT. `episode-phase` runs twice — plugin-wide with no argument, and skill-scoped
// as `--workflow <name>`. The plugin-wide copy derives identity through
// `workflowFromPlanningEvidence`, which falls back to `POLICIES.work` when it finds no clarify
// sentinel — and every built-in sentinel is retired, so that branch is now taken ALWAYS. The
// `identityIsWrong` correction repairs it only when the skill-scoped copy also runs, which it does
// NOT in a cleared-context session (`showClearContextOnPlanAccept` starts a new session whose first
// message is "Implement the following plan: …", with no skill loaded and therefore no frontmatter
// hook registered). Measured 2026-08-06: a real `/writing` episode recorded `"workflow": "work"`.
//
// WHY IT IS NOT COSMETIC. v5.139.0's plugin-wide mutation guard picks its policy from that field,
// and `work` and `writing` have materially different Bash rules — `writing` permits only a named
// read-only allowlist, `work` runs the denylist classifier. A mislabelled episode is enforced under
// the wrong contract.
//
// Run: bun tests/episode-identity.test.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
let PASS = 0, FAIL = 0
const ok = (name, condition, extra = '') => {
  if (condition) PASS++
  else { FAIL++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`) }
}

const made = []
const project = ({ receipt = null, episode = null } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'episode-identity-'))
  made.push(root)
  mkdirSync(join(root, '.planning', '.state'), { recursive: true })
  writeFileSync(join(root, '.claude-workflows.json'), JSON.stringify({ schemaVersion: 1, governed: true }))
  if (receipt !== null) writeFileSync(join(root, '.planning', '.state', 'review.json'), typeof receipt === 'string' ? receipt : JSON.stringify(receipt))
  if (episode !== null) writeFileSync(join(root, '.planning', '.state', 'episode.json'), typeof episode === 'string' ? episode : JSON.stringify(episode))
  return root
}
/** The plugin-wide registration: no `--workflow`, exactly as `hooks/hooks.json` wires it. */
const pluginWide = (root, ...args) => execFileSync('bun', [join(ROOT, 'hooks', 'episode-phase.ts'), ...args], {
  cwd: root, encoding: 'utf8', input: JSON.stringify({ tool_name: 'AskUserQuestion', session_id: 's1', cwd: root }),
})
const episodeOf = root => JSON.parse(readFileSync(join(root, '.planning', '.state', 'episode.json'), 'utf8'))
const RECEIPT = (workflow, over = {}) => ({
  workflow, plan_file: 'ancient-doodling-meerkat.md', plan_hash: 'a'.repeat(64),
  approved_session_id: 's1', approved_at: '2026-08-03T00:00:00Z', status: 'PENDING',
  reviewer_session_id: '', reviewed_at: '', ...over,
})

console.log('the receipt names the workflow when no skill hook is registered to say so')
{
  const writing = project({ receipt: RECEIPT('writing') })
  pluginWide(writing)
  ok('a receipt naming writing records writing, not work', episodeOf(writing).workflow === 'writing', episodeOf(writing).workflow)

  for (const name of ['ds', 'dev', 'workshop', 'workflow-creator']) {
    const root = project({ receipt: RECEIPT(name) })
    pluginWide(root)
    ok(`a receipt naming ${name} records ${name}`, episodeOf(root).workflow === name, episodeOf(root).workflow)
  }

  // The bare primitive is still the right answer for a genuinely ad-hoc plan.
  const bare = project()
  pluginWide(bare)
  ok('with no receipt at all it still falls back to work', episodeOf(bare).workflow === 'work', episodeOf(bare).workflow)
}

console.log('the receipt is read shallowly and never trusted beyond the name')
{
  // An unparseable or nameless receipt must not throw and must not invent an identity — the same
  // silence-on-failure direction `unboundGeneratedPlan` takes, for the same reason: this hook runs
  // on every AskUserQuestion in every governed project.
  const corrupt = project({ receipt: 'not json at all' })
  pluginWide(corrupt)
  ok('an unparseable receipt falls back to work rather than throwing', episodeOf(corrupt).workflow === 'work', episodeOf(corrupt).workflow)

  const nameless = project({ receipt: { status: 'PENDING' } })
  pluginWide(nameless)
  ok('a receipt with no workflow falls back to work', episodeOf(nameless).workflow === 'work', episodeOf(nameless).workflow)

  // `WORKFLOW_IDENTITY` under schema-v2 is an arbitrary string, and `Object.hasOwn` is what stops
  // `constructor` resolving to a prototype member — the defect `_workflow_policies.ts:33-40` records.
  const hostile = project({ receipt: RECEIPT('constructor') })
  pluginWide(hostile)
  ok('a receipt naming constructor does not reach the prototype', episodeOf(hostile).workflow === 'work', episodeOf(hostile).workflow)

  // `--workflow` stays authoritative: the skill knows what it is, and a receipt cannot outrank it.
  const argued = project({ receipt: RECEIPT('writing') })
  pluginWide(argued, '--workflow', 'dev')
  ok('an explicit --workflow still outranks the receipt', episodeOf(argued).workflow === 'dev', episodeOf(argued).workflow)
}

console.log('a MISRECORDED identity is corrected from the receipt, and only where it is safe')
{
  // THE CASE T3 EXISTS FOR, AND THE ONE A CREATION-TIME PREFERENCE ALONE WOULD HAVE MISSED. CLARIFY
  // precedes PLAN, so the `work` episode is always already on disk by the time a receipt appears —
  // `existing?.workflow` would win every time and the correction would never run. Found by the codex
  // adapter reviewing this very diff.
  const EPISODE = (over = {}) => ({
    schemaVersion: 1, workflow: 'work', planFile: null, planHash: null, sessionId: 's1',
    phases: { clarified: '2026-08-03T00:00:00.000Z' }, reviewOwed: false, reviewBlocks: 0, exit: null,
    editsSinceVerify: 0, planBindingBlocks: 0, ...over,
  })

  const misrecorded = project({ episode: EPISODE(), receipt: RECEIPT('writing') })
  pluginWide(misrecorded)
  ok('a recorded work is corrected to the receipt\'s writing', episodeOf(misrecorded).workflow === 'writing', episodeOf(misrecorded).workflow)
  ok('and the clarify timestamp is not re-stamped', episodeOf(misrecorded).phases.clarified === '2026-08-03T00:00:00.000Z')

  // A receipt from an EARLIER episode must not relabel a DIFFERENT bound one — the same laundering
  // `unboundGeneratedPlan` refuses when it asks which plan a receipt binds rather than whether one
  // exists at all.
  const boundElsewhere = project({
    episode: EPISODE({ workflow: 'dev', planFile: 'other-plan-here.md', planHash: 'b'.repeat(64) }),
    receipt: RECEIPT('writing'),
  })
  pluginWide(boundElsewhere)
  ok('a receipt for ANOTHER plan does not relabel a bound episode', episodeOf(boundElsewhere).workflow === 'dev', episodeOf(boundElsewhere).workflow)

  const boundHere = project({
    episode: EPISODE({ planFile: 'ancient-doodling-meerkat.md', planHash: 'a'.repeat(64) }),
    receipt: RECEIPT('writing'),
  })
  pluginWide(boundHere)
  ok('the receipt for THIS plan does relabel it', episodeOf(boundHere).workflow === 'writing', episodeOf(boundHere).workflow)

  // The correction must not resurrect an episode the user closed.
  const exited = project({
    episode: EPISODE({ exit: { at: '2026-08-03T01:00:00.000Z', reason: 'abandoned' } }),
    receipt: RECEIPT('writing'),
  })
  pluginWide(exited)
  ok('an exited episode is still corrected but not reopened', episodeOf(exited).exit !== null)

  // Agreement is not a reason to rewrite the file.
  const agreeing = project({ episode: EPISODE({ workflow: 'writing' }), receipt: RECEIPT('writing') })
  pluginWide(agreeing)
  ok('a receipt that agrees changes nothing', episodeOf(agreeing).workflow === 'writing')
}

console.log('registration parity: every workflow entry skill wires its own name')
{
  // The gap this closes is not hypothetical: `_workflow_policies.ts:59` cites two contract tests as
  // pinning the skill-scoped registrations, and BOTH cover `approved-artifact-persist` only — for
  // `dev` and `workflow-creator`. Nothing pinned `episode-phase` on any workflow, so a skill could
  // lose the registration (or gain a wrong `--workflow`) with no test turning red.
  const EXPECTED = {
    ds: 'ds', dev: 'dev', writing: 'writing', workshop: 'workshop',
    'workflow-creator': 'workflow-creator', 'workflow-creator-improve': 'workflow-creator',
  }
  for (const [skill, workflow] of Object.entries(EXPECTED)) {
    const body = readFileSync(join(ROOT, 'skills', skill, 'SKILL.md'), 'utf8')
    const wired = [...body.matchAll(/hooks\/episode-phase\.ts --workflow (\S+?)"/g)].map(match => match[1])
    ok(`${skill} wires episode-phase exactly once`, wired.length === 1, JSON.stringify(wired))
    ok(`${skill} wires --workflow ${workflow}`, wired[0] === workflow, JSON.stringify(wired[0]))
  }
  // And the plugin-wide copy must still be registered, or the cleared-context session — the one that
  // starts at IMPLEMENT with no skill loaded — records nothing at all.
  const hooks = readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')
  ok('hooks.json keeps the plugin-wide registration', /hooks\/episode-phase\.ts"/.test(hooks))
}

for (const dir of made) rmSync(dir, { recursive: true, force: true })
console.log(`\n${PASS} passed, ${FAIL} failed`)
if (FAIL) process.exit(1)
