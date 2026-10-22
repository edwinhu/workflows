/**
 * Children the suite spawns write tool state into whatever TMPDIR they inherit, and scripts/test.sh's
 * leak guard then fails the run on it. npm's lib/cli.js calls module.enableCompileCache(), so the npx
 * that hooks/lint-check.ts runs (via tests/hook-golden.test.ts) left `node-compile-cache/`; onnxruntime,
 * which `import pymupdf` loads (tests/checks-workshop-elide-authoring.test.ts), left `.ses`. Neither is a
 * fixture a test could sweep, so test.sh's own environment must keep them out of the run's TMPDIR.
 */
import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { useTmp } from './helpers/tmp.ts'

const mkTmp = useTmp()
const ROOT = dirname(import.meta.dir)

/** Run scripts/test.sh on a probe test whose body spawns `child`; the caller's env carries none of the switches. */
function runProbe(child: string[]) {
  const dir = mkTmp('test-sh-tool-caches-')
  const probe = join(dir, 'probe.test.ts')
  writeFileSync(probe, `import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
test('probe', () => {
  const r = spawnSync(${JSON.stringify(child[0])}, ${JSON.stringify(child.slice(1))}, { encoding: 'utf8', timeout: 100_000 })
  expect(r.status, String(r.stderr ?? r.error)).toBe(0)
}, 110_000)
`)
  const env: Record<string, string | undefined> = { ...process.env }
  for (const k of ['NODE_DISABLE_COMPILE_CACHE', 'NODE_COMPILE_CACHE', 'ORT_DISABLE_TELEMETRY', 'KEEP_TMP']) delete env[k]
  const r = spawnSync('bash', [join(ROOT, 'scripts', 'test.sh'), probe], {
    cwd: ROOT, encoding: 'utf8', timeout: 150_000, env: env as NodeJS.ProcessEnv,
  })
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` }
}

const NPM_OK = spawnSync('npm', ['--version'], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, TMPDIR: mkTmp('npm-probe-') } }).status === 0
const PYMUPDF_CHILD = ['uv', 'run', '--quiet', '--with', 'pymupdf', 'python3', '-c', 'import pymupdf']
const PYMUPDF_OK = spawnSync(PYMUPDF_CHILD[0], PYMUPDF_CHILD.slice(1), {
  encoding: 'utf8', timeout: 100_000, env: { ...process.env, TMPDIR: mkTmp('pymupdf-probe-') },
}).status === 0
if (!NPM_OK) console.error('SKIPPED: npm compile-cache leak test -- npm is unavailable here')
if (!PYMUPDF_OK) console.error('SKIPPED: onnxruntime .ses leak test -- uv or pymupdf is unavailable here')

test.skipIf(!NPM_OK)('an npm child run inside the suite leaves no node-compile-cache in the run\'s TMPDIR', () => {
  const { status, out } = runProbe(['npm', '--version'])
  expect(out).not.toContain('LEAK GUARD FAILED')
  expect(out).toContain('leak guard ok')
  expect(out).toMatch(/\b1 pass\b/)
  expect(status, out).toBe(0)
}, 160_000)

test.skipIf(!PYMUPDF_OK)('importing pymupdf inside the suite leaves no onnxruntime .ses in the run\'s TMPDIR', () => {
  const { status, out } = runProbe(PYMUPDF_CHILD)
  expect(out).not.toContain('LEAK GUARD FAILED')
  expect(out).toContain('leak guard ok')
  expect(out).toMatch(/\b1 pass\b/)
  expect(status, out).toBe(0)
}, 160_000)
