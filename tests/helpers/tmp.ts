/**
 * Fixture temp dirs that remove themselves.
 *
 *   import { useTmp } from '<rel>/tests/helpers/tmp.ts'
 *   const mkTmp = useTmp()            // once, at the top level of the test file
 *   const dir = mkTmp('my-prefix-')   // anywhere: mkdtempSync(join(tmpdir(), 'my-prefix-'))
 *
 * `useTmp()` registers an afterAll that removes every dir made so far. It must be called per test
 * FILE: `bun test` evaluates a shared module once per process, so a hook registered at a helper's
 * top level binds to whichever file imported it first, and `process.on('exit')` never fires inside a
 * `bun test` worker (measured 2026-10-02). Outside the runner — a standalone `.mjs` harness run by
 * `bun` — it falls back to an exit hook, which does fire there. KEEP_TMP=1 keeps everything.
 *
 * A helper module that makes dirs on a test's behalf calls `tmpDir` directly; the importing file's
 * `useTmp()` sweep removes them, so such a helper must not cache a path past existsSync.
 *
 * scripts/test.sh fails the run on anything left in its TMPDIR, so a creator that bypasses this is
 * caught there.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'bun:test'

const made: string[] = []

function sweep(): void {
  if (process.env.KEEP_TMP === '1') return
  for (const d of made.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }) } catch {}
  }
}

/** A fresh dir under `parent` (default: tmpdir()), removed by the next sweep. */
export function tmpDir(prefix: string, parent: string = tmpdir()): string {
  const d = mkdtempSync(join(parent, prefix))
  made.push(d)
  return d
}

/** Register this file's sweep and hand back `tmpDir`. Call once, at the file's top level. */
export function useTmp(): typeof tmpDir {
  try {
    afterAll(sweep)
  } catch {
    process.on('exit', sweep)
  }
  return tmpDir
}
