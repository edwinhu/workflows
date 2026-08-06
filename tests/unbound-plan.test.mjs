// The unbound-plan predicate, and the runnable repro for the 2026-08-03 routing/provenance gap.
//
// THIS FILE DOUBLES AS THE INCIDENT REPRO. It reconstructs the shape that `~/projects/example-project` was
// left in — a `.planning/` holding `compressed-riding-mitten.md` and nothing that binds it — and
// prints a shape -> verdict matrix, so the claim "this predicate identifies the incident and is
// silent on everything else" is something you can read rather than take on trust.
//
// The last row is this repository's OWN `.planning/`, read live. It holds `snoopy-prancing-cookie.md`
// alongside a pile of pre-receipt ledgers, and it MUST come back null: those files are preserved as
// provenance and are conversion input, never authority. If that row ever flips, the turn-end gate
// starts refusing turns in this repo for a file nobody is going to bind.
//
// Run: bun tests/unbound-plan.test.mjs
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unboundGeneratedPlan } from '../hooks/lib/unbound-plan.ts'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
let PASS = 0, FAIL = 0
const rows = []
const made = []

const shape = (label, build) => {
  const root = mkdtempSync(join(tmpdir(), 'unbound-plan-'))
  made.push(root)
  mkdirSync(join(root, '.planning'), { recursive: true })
  build(root, join(root, '.planning'))
  return { label, root }
}
const check = (label, root, expected) => {
  const actual = unboundGeneratedPlan(root)
  const good = actual === expected
  if (good) PASS++
  else { FAIL++; console.log(`FAIL  ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`) }
  rows.push([label, actual === null ? '(silent)' : actual, good ? 'ok' : 'FAIL'])
}
const file = (dir, name, body = 'x') => writeFileSync(join(dir, name), body)
const RECEIPT = JSON.stringify({
  workflow: 'work', plan_file: 'compressed-riding-mitten.md', plan_hash: 'a'.repeat(64),
  approved_session_id: 's1', approved_at: '2026-08-03T00:00:00Z', status: 'PENDING',
  reviewer_session_id: '', reviewed_at: '',
})
const EPISODE = JSON.stringify({
  schemaVersion: 1, workflow: 'work', planFile: null, planHash: null, sessionId: 's1',
  phases: { clarified: '2026-08-03T00:00:00.000Z' }, reviewOwed: false, reviewBlocks: 0, exit: null,
  editsSinceVerify: 0, planBindingBlocks: 0,
})

// THE INCIDENT SHAPE. Hand-written plan, no receipt, nothing else.
{
  const { root } = shape('the example-project incident: plan hand-written, no receipt', (_root, planning) => {
    file(planning, 'compressed-riding-mitten.md', '# Plan\n')
    file(planning, 'episode.json', EPISODE)
  })
  check('the example-project incident: plan hand-written, no receipt', root, 'compressed-riding-mitten.md')
}

// THE CLEAN SHAPES. Every one of these must be silent.
{
  const bound = shape('a BOUND plan (plan + review.json)', (_root, planning) => {
    file(planning, 'compressed-riding-mitten.md', '# Plan\n')
    mkdirSync(join(planning, '.state'))
    file(join(planning, '.state'), 'review.json', RECEIPT)
  })
  check('a BOUND plan (plan + review.json)', bound.root, null)

  const empty = shape('an EMPTY .planning', () => {})
  check('an EMPTY .planning', empty.root, null)

  const clarifyOnly = shape('a CLARIFY-only .planning (sentinel + episode.json)', (_root, planning) => {
    file(planning, 'DS_CLARIFIED.json', JSON.stringify({ status: 'clarified', sessionId: 's1' }))
    mkdirSync(join(planning, '.state'))
    file(join(planning, '.state'), 'episode.json', EPISODE)
  })
  check('a CLARIFY-only .planning (sentinel + episode.json)', clarifyOnly.root, null)

  const noPlanning = mkdtempSync(join(tmpdir(), 'unbound-plan-'))
  made.push(noPlanning)
  check('no .planning at all', noPlanning, null)
}

// THIS REPOSITORY, READ LIVE — AND THE ROW THAT FLIPPED.
//
// It used to assert `null` on the grounds that `snoopy-prancing-cookie.md` sits beside SPEC.md,
// HYPOTHESES.md and the rest of the pre-receipt ledgers, so the directory was "legacy". That
// reasoning is exactly the kill switch T2 removed: `.planning/` is gitignored here, so its contents
// are one developer's local residue rather than repo provenance, and no assertion about a specific
// filename would hold in a fresh clone (which has no `.planning/` at all and reads `null`).
//
// So the live row now asserts the SHAPE of the answer rather than a value, and PRINTS what it got.
// That printout is the record: it is what "the check is live in this repo again" is verified by.
{
  const live = unboundGeneratedPlan(ROOT)
  const good = live === null || /^[a-z]+-[a-z]+-[a-z]+\.md$/.test(live)
  if (good) PASS++
  else { FAIL++; console.log(`FAIL  this repo, read live — got ${JSON.stringify(live)}`) }
  rows.push(["this repo's own .planning (read live)", live === null ? '(silent)' : live, good ? 'ok' : 'FAIL'])
  // A named plan here costs ONE bounded refusal at turn end (MAX_PLAN_BINDING_BLOCKS), dischargeable
  // with `scripts/beat/episode-exit.ts`. That is the check working, not the check misfiring.
}

// THE ALIAS ROUTE, refused rather than followed — the same route `hasReceiptSurface` guards.
{
  const aliased = mkdtempSync(join(tmpdir(), 'unbound-plan-'))
  made.push(aliased)
  mkdirSync(join(aliased, 'decoy'), { recursive: true })
  file(join(aliased, 'decoy'), 'compressed-riding-mitten.md', '# Plan\n')
  symlinkSync(join(aliased, 'decoy'), join(aliased, '.planning'))
  check('a .planning ALIASED to a directory holding a plan', aliased, null)

  const linkedPlan = shape('a plan entry that is itself a SYMLINK', (root, planning) => {
    file(root, 'real.md', '# Plan\n')
    symlinkSync(join(root, 'real.md'), join(planning, 'compressed-riding-mitten.md'))
  })
  check('a plan entry that is itself a SYMLINK', linkedPlan.root, null)

  const notADirectory = mkdtempSync(join(tmpdir(), 'unbound-plan-'))
  made.push(notADirectory)
  file(notADirectory, '.planning', 'not a directory')
  check('.planning is a regular FILE', notADirectory, null)
}

// THE NAME PATTERN. Narrow on purpose: the cost of a false positive is a refused turn.
{
  const other = shape('a .planning holding only an ordinary lowercase note', (_root, planning) => {
    file(planning, 'notes.md')
    file(planning, 'two-words.md')
    file(planning, 'four-word-name-here.md')
  })
  check('a .planning holding only an ordinary lowercase note', other.root, null)

  const two = shape('two plan-shaped files: the answer is stable, not arbitrary', (_root, planning) => {
    file(planning, 'noble-wandering-snowflake.md')
    file(planning, 'compressed-riding-mitten.md')
  })
  check('two plan-shaped files: the answer is stable, not arbitrary', two.root, 'compressed-riding-mitten.md')

  // ONE CAPITALISED FILE USED TO SILENCE THIS ENTIRE CHECK, AND THAT IS HOW IT DIED.
  // `isLegacyLedger` was applied to EVERY entry as a whole-directory kill switch: a single `SPEC.md`,
  // `README.md` or `ACTIVE_WORKFLOW.md` anywhere in `.planning/` returned `null` and the predicate
  // said nothing about anything. Measured 2026-08-06 against this repository's own `.planning/`,
  // which holds `ACTIVE_WORKFLOW.md` and `SPEC.md`: the check read `null` LIVE — the turn-end safety
  // net for a hand-written plan was dead in the very repo that owns it, and stayed dead through the
  // `/writing` episode it was built to catch.
  //
  // A capitalised sibling is not evidence that a lowercase plan-shaped file is legitimate. The
  // suppression is now a per-entry filter, which is what it always claimed to be.
  const legacyBeside = shape('a plan beside a retired ledger is still unbound', (_root, planning) => {
    file(planning, 'snoopy-prancing-cookie.md')
    file(planning, 'SPEC.md')
  })
  check('a plan beside a retired ledger is still unbound', legacyBeside.root, 'snoopy-prancing-cookie.md')

  const onlyLedgers = shape('a .planning of ledgers ALONE is still silent', (_root, planning) => {
    file(planning, 'SPEC.md')
    file(planning, 'ACTIVE_WORKFLOW.md')
    file(planning, 'MINI-tasklist-2026-07-29.md')
  })
  check('a .planning of ledgers ALONE is still silent', onlyLedgers.root, null)

  // AN UNPARSEABLE RECEIPT STAYS SILENT, AND THAT IS A CHOICE. It is already `blocked` for
  // `implementer-identity-gate`, which is where it is reported and where the cost is understood.
  // Refusing a turn on it here would put the only blocking Stop hook into the receipt-parsing
  // failure domain, and the failure mode of getting that wrong is a session that cannot finish.
  const unreadableReceipt = shape('an UNPARSEABLE receipt stays silent', (_root, planning) => {
    file(planning, 'compressed-riding-mitten.md')
    mkdirSync(join(planning, '.state'))
    file(join(planning, '.state'), 'review.json', 'not json at all')
  })
  check('an UNPARSEABLE receipt stays silent', unreadableReceipt.root, null)
}

// THE codex THIRD-PARTY FINDING, v5.114.0. The first version returned null as soon as a receipt
// EXISTED, without asking which plan it binds — so a receipt left behind by an EARLIER plan made a
// newly hand-written one invisible. That is the same trust-boundary failure the predicate exists to
// close: receipt-keyed gates stay inert while this one assumes approval happened.
{
  const receiptFor = planFile => JSON.stringify({
    workflow: 'work', plan_file: planFile, plan_hash: 'a'.repeat(64), approved_session_id: 's1',
    approved_at: '2026-08-03T00:00:00Z', status: 'PENDING', reviewer_session_id: '', reviewed_at: '',
  })
  const withReceipt = (label, planFiles, receipt) => {
    const built = shape(label, (_root, planning) => {
      for (const name of planFiles) file(planning, name, '# Plan\n')
      mkdirSync(join(planning, '.state'))
      file(join(planning, '.state'), 'review.json', receipt)
    })
    return built.root
  }

  check('a receipt binding THIS plan is silent',
    withReceipt('bound', ['compressed-riding-mitten.md'], receiptFor('compressed-riding-mitten.md')), null)
  check('a STALE receipt naming another plan does not launder a new one',
    withReceipt('stale', ['compressed-riding-mitten.md'], receiptFor('noble-wandering-snowflake.md')), 'compressed-riding-mitten.md')
  check('the bound plan is excluded and its unbound neighbour is named',
    withReceipt('both', ['compressed-riding-mitten.md', 'noble-wandering-snowflake.md'], receiptFor('compressed-riding-mitten.md')),
    'noble-wandering-snowflake.md')
  check('a receipt with no plan_file is read as binding everything',
    withReceipt('nameless', ['compressed-riding-mitten.md'], JSON.stringify({ status: 'PENDING' })), null)
}

const width = Math.max(...rows.map(row => row[0].length))
console.log(`\nshape${' '.repeat(width - 5)}  verdict`)
console.log(`${'-'.repeat(width)}  ${'-'.repeat(30)}`)
for (const [label, verdict, status] of rows) {
  console.log(`${label.padEnd(width)}  ${verdict}${status === 'ok' ? '' : `   <-- ${status}`}`)
}

for (const dir of made) rmSync(dir, { recursive: true, force: true })
console.log(`\n${PASS} passed, ${FAIL} failed`)
if (FAIL) process.exit(1)
