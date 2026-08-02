// A repository containing a SUBMODULE must still be observable.
//
// THE DEFECT THIS EXISTS FOR
//   Gitlinks (mode 160000) name a COMMIT that lives in another repository. `loadGitObjects` feeds
//   every changed path's oid to `git cat-file --batch`, which reports the gitlink's commit missing
//   and throws `invalid Git blob`. captureGitObservation then fails outright — and because the
//   implement gate correctly treats a failed observation as a HARD refusal, every dispatch in any
//   repo containing a submodule was unadjudicable. The enforcement did not weaken; it stopped.
//
//   It was found by running the live hook against the workflows repo itself, whose `skills/bmll`
//   submodule pointer had moved. Every fixture test passed throughout: fixtures had no submodules.
//
//   `workflows/lib/candidate-manifest.ts` already carried this fix, with a comment naming this same
//   submodule. The observation path — its sibling, walking the same index — never got it.
//
// Run: bun tests/git-observation-submodule.test.mjs
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureGitObservation } from '../workflows/lib/git-observation.ts'

let PASS = 0, FAIL = 0
const ok = (name, condition, extra = '') => {
  if (condition) PASS++
  else { FAIL++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`) }
}
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const base = mkdtempSync(join(tmpdir(), 'obs-submodule-'))
try {
  // A real submodule, not a simulated one: the bug lives in what `git cat-file` says about a real
  // gitlink, so a hand-written index entry would not reproduce it.
  const inner = join(base, 'inner'); mkdirSync(inner)
  git(inner, 'init', '-q'); git(inner, 'config', 'user.email', 't@t'); git(inner, 'config', 'user.name', 't')
  writeFileSync(join(inner, 'a.txt'), 'one\n')
  git(inner, 'add', '-A'); git(inner, 'commit', '-qm', 'inner')

  const outer = join(base, 'outer'); mkdirSync(outer)
  git(outer, 'init', '-q'); git(outer, 'config', 'user.email', 't@t'); git(outer, 'config', 'user.name', 't')
  writeFileSync(join(outer, 'src.txt'), 'hello\n')
  git(outer, 'add', '-A'); git(outer, 'commit', '-qm', 'outer')
  git(outer, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', inner, 'sub')
  git(outer, 'commit', '-qm', 'add submodule')

  // Move the submodule pointer, which is what puts the gitlink in the CHANGED set — the exact
  // condition under which the old code threw.
  writeFileSync(join(inner, 'a.txt'), 'two\n')
  git(inner, 'add', '-A'); git(inner, 'commit', '-qm', 'inner 2')
  git(join(outer, 'sub'), 'fetch', '-q', 'origin')
  git(join(outer, 'sub'), 'checkout', '-q', git(inner, 'rev-parse', 'HEAD').trim())

  const status = git(outer, 'status', '--porcelain')
  ok('the moved submodule pointer really is a changed path', /\bsub\b/.test(status), JSON.stringify(status))

  let observation
  try { observation = captureGitObservation(outer) } catch (error) {
    ok('observing a repo with a submodule does not throw', false, String(error))
  }
  if (observation) {
    ok('observing a repo with a submodule does not throw', true)
    ok('it produces a digest', typeof observation.digest === 'string' && observation.digest.length > 0)
    // The pointer is DROPPED, not read: a submodule's contents are another repository's, so they are
    // not this repo's changed content and must not appear as an observed entry.
    ok('the gitlink is not reported as an observed entry',
       !observation.entries.some(e => e.path === 'sub'), JSON.stringify(observation.entries.map(e => e.path)))
  }

  // A normal edit alongside the submodule must still be observed — the guard drops gitlinks only.
  writeFileSync(join(outer, 'src.txt'), 'changed\n')
  const withEdit = captureGitObservation(outer)
  ok('an ordinary changed file is still observed', withEdit.entries.some(e => e.path === 'src.txt'),
     JSON.stringify(withEdit.entries.map(e => e.path)))
} finally {
  rmSync(base, { recursive: true, force: true })
}

console.log(`\n${PASS}/${PASS + FAIL} passed`)
if (FAIL) process.exit(1)
