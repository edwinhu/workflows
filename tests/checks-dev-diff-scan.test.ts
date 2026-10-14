import { expect, setDefaultTimeout, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { useTmp } from './helpers/tmp.ts'

setDefaultTimeout(150_000)
const mkTmp = useTmp()
const SCAN = join(import.meta.dir, '..', 'checks', 'dev', 'constraints', 'diff-scan.py')

// A committed README, then `files` left in the working tree so diff-scan sees them as added lines.
function project(files: Record<string, string>, committed: Record<string, string> = {}) {
  const d = mkTmp('dscan-')
  const git = (...a: string[]) => spawnSync('git', ['-C', d, ...a], { encoding: 'utf8', timeout: 30_000 })
  const put = (m: Record<string, string>) => {
    for (const [n, b] of Object.entries(m)) { mkdirSync(dirname(join(d, n)), { recursive: true }); writeFileSync(join(d, n), b) }
  }
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  put({ 'README.md': 'x', ...committed }); git('add', '-A'); git('commit', '-qm', 'i')
  put(files)
  return d
}
const scan = (d: string, ...rel: string[]) => {
  const r = spawnSync('python3', [SCAN, '--project-dir', d, '--files', ...rel.map(f => join(d, f))], { encoding: 'utf8', timeout: 30_000 })
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' }
}

// [check name, path, added line]: every row is a bad line diff-scan must name, then the matching good line it must pass.
const BAD: [string, string, string, string][] = [
  ['focused-or-skipped-test', 'src/a.test.ts', "describe.skip('x', () => {})", "describe('x', () => {})"],
  ['focused-or-skipped-test', 'src/a.test.ts', "xit('x', () => {})", "it('x', () => {})"],
  ['focused-or-skipped-test', 'tests/test_a.py', '@pytest.mark.skip', '@pytest.mark.parametrize("a", [1])'],
  ['focused-or-skipped-test', 'a_test.go', '\tt.Skip("later")', '\tt.Log("now")'],
  ['tls-verification-off', 'src/a.ts', 'const o = { rejectUnauthorized: false }', 'const o = { rejectUnauthorized: true }'],
  ['tls-verification-off', 'src/a.py', 'requests.get(u, verify=False)', 'requests.get(u, verify=True)'],
  ['tls-verification-off', 'src/a.go', 'c := &tls.Config{InsecureSkipVerify: true}', 'c := &tls.Config{}'],
  ['tls-verification-off', 'src/a.sh', 'curl -k https://x.example/', 'curl https://x.example/'],
  ['tls-verification-off', 'src/a.ts', 'process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"', 'process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1"'],
  ['secret', 'src/key.txt', '-----BEGIN RSA PRIVATE KEY-----', '-----BEGIN PUBLIC KEY-----'],
  ['secret', 'src/cfg.ts', 'const k = "AKIAABCDEFGHIJKLMNOP"', 'const k = "AKIA-not-a-key"'],
]

for (const [name, path, bad, good] of BAD) {
  test(`diff-scan: ${name} fires on an added ${JSON.stringify(bad.trim().slice(0, 28))} and not on ${JSON.stringify(good.trim().slice(0, 28))}`, () => {
    const hit = scan(project({ [path]: bad + '\n' }), path)
    expect(hit.status, hit.out + hit.err).toBe(1)
    expect(hit.out).toMatch(new RegExp(`^${path.replace(/[./]/g, '\\$&')}:1: ${name} `, 'm'))
    const ok = scan(project({ [path]: good + '\n' }), path)
    expect(ok.status, ok.out + ok.err).toBe(0)
    expect(ok.out).not.toContain(name)
  })
}

test('diff-scan: a skip in a non-test file is not a finding, the same line in a test file is', () => {
  const r = scan(project({ 'src/lib.ts': "it.skip('x', () => {})\n", 'src/lib.test.ts': "it.skip('x', () => {})\n" }), 'src/lib.ts')
  expect(r.status, r.out).toBe(0)
  expect(scan(project({ 'src/lib.test.ts': "it.skip('x', () => {})\n" }), 'src/lib.test.ts').status).toBe(1)
})

test('diff-scan: fixtures/ paths and `scan: allow` lines are exempt and counted, not flagged', () => {
  const r = scan(project({
    'tests/fixtures/bad.ts': "test.only('x', () => {})\nrequests.get(u, verify=False)\n",
    'src/ok.ts': 'const o = { rejectUnauthorized: false } // scan: allow\nexport const b = 1\n',
  }), 'tests/fixtures/bad.ts', 'src/ok.ts')
  expect(r.status, r.out).toBe(0)
  expect(r.out.split('\n')[0]).toMatch(/^diff-scan: 1 added line\(s\) examined.*3 exempt/)
})

test('diff-scan: only lines the change adds count; a bad line already committed is not re-reported', () => {
  const d = project({ 'src/a.test.ts': "test.only('old', () => {})\nexport const n = 2\n" }, { 'src/a.test.ts': "test.only('old', () => {})\n" })
  const r = scan(d, 'src/a.test.ts')
  expect(r.status, r.out).toBe(0)
  expect(r.out.split('\n')[0]).toMatch(/: 1 added line\(s\) examined/)
})

test('diff-scan: a path that does not exist is exit 2, could not run, not a pass', () => {
  const r = scan(project({}), 'nope.ts')
  expect(r.status).toBe(2)
  expect(r.err).toContain('COULD-NOT-RUN')
})
