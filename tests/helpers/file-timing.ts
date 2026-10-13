/**
 * scripts/test.sh preloads this into every test file: one `start` and one `end` line per file, in ms,
 * appended to $TEST_FILE_TIMING_LOG. When the wall cap fires, test.sh reads it for the slowest
 * finished files and for what is still running; bun itself names only the in-flight files.
 */
import { appendFileSync } from 'node:fs'
import { afterAll } from 'bun:test'

const log = process.env.TEST_FILE_TIMING_LOG
if (log) {
  const mark = (k: string) => {
    try { appendFileSync(log, `${k} ${Date.now()} ${process.pid} ${Bun.main}\n`) } catch {}
  }
  mark('start')
  afterAll(() => mark('end'))
}
