/**
 * scripts/lib/init-submodules.sh: the canary's clean suite worktree must carry the submodules, from the
 * modules the superproject already holds (offline; a submodule commit never pushed must still resolve).
 *
 * Run: bun test tests/canary-submodules.test.ts
 */
import { afterAll, expect, test, setDefaultTimeout } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

setDefaultTimeout(120_000)

const LIB = join(import.meta.dir, '..', 'scripts', 'lib', 'init-submodules.sh')
const CANARY = join(import.meta.dir, '..', 'scripts', 'canary.sh')
const tmp = mkdtempSync(join(tmpdir(), 'canary-submod-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const sh = (cmd: string, cwd = tmp) =>
  spawnSync('bash', ['-c', cmd], { cwd, encoding: 'utf8', timeout: 15_000, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })

test('a fresh worktree gets a submodule whose commit exists only locally', () => {
  const sub = join(tmp, 'sub'), sup = join(tmp, 'sup'), wt = join(tmp, 'wt')
  expect(sh(`git init -q sub && cd sub && echo a > f && git add f && git commit -qm a`).status).toBe(0)
  expect(sh(`git init -q sup && cd sup && git -c protocol.file.allow=always submodule add -q ${sub} deps/sub && git commit -qm s`).status).toBe(0)
  // a commit inside the checked-out submodule that its url (sub) never receives, like bmll's unpushed caef1ec
  expect(sh(`cd ${sup}/deps/sub && echo b > local-only && git add local-only && git commit -qm local && cd ../.. && git add deps/sub && git commit -qm bump`).status).toBe(0)
  expect(sh(`git worktree add -q --detach ${wt} HEAD`, sup).status).toBe(0)
  expect(existsSync(join(wt, 'deps/sub/local-only'))).toBe(false)
  const r = sh(`. ${LIB}; init_worktree_submodules ${wt} ${sup}`)
  expect(r.stderr + r.stdout).not.toMatch(/fatal/)
  expect(r.status).toBe(0)
  expect(existsSync(join(wt, 'deps/sub/local-only'))).toBe(true)
  // teardown with an initialised submodule needs --force, as drop_suite_wt uses
  expect(sh(`git worktree remove --force ${wt}`, sup).status).toBe(0)
  expect(existsSync(wt)).toBe(false)
})

test('canary.sh initialises submodules after minting the suite worktree and fails [suites] by name', () => {
  const src = Bun.file(CANARY).text()
  return src.then((s) => {
    expect(s).toContain('init-submodules.sh')
    const mint = s.indexOf('worktree add --detach "$SUITE_WT"')
    const init = s.indexOf('init_worktree_submodules "$SUITE_WT"')
    expect(mint).toBeGreaterThan(0)
    expect(init).toBeGreaterThan(mint)
    expect(s.slice(init, init + 400)).toContain('FAIL [suites] could not initialise submodules')
  })
})
