/**
 * A grind iteration is itself a delegated worker — functionally a farm-out child.
 *
 * `farm.sh` exports FARM_OUT_CHILD=1 into every agent it spawns, and the main-thread guards exempt
 * any process carrying that marker. An iteration is dispatched the same way and is subject to the
 * same guards, so grind.sh must set it on the runner command too, alongside GRIND_ITERATION.
 *
 * Scope is the point of both markers: they belong to the runner command ONLY. The grind process's
 * own commands — the check, the gate — run on the operator's behalf, not the agent's, and a marker
 * leaking into them would exempt the operator's shell from the very guards the marker exists to
 * gate.
 *
 * Nothing here touches the network. `--runner` points at a stub in every case.
 *
 * Run: bun test /home/eh/projects/workflows/skills/grind/scripts/grind-farm-child.test.ts
 */
import { describe, expect, test, afterAll } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { grindEnv } from './grind-test-env'

const GRIND = `${import.meta.dir}/grind.sh`

const scratch: string[] = []
afterAll(() => scratch.forEach(d => rmSync(d, { recursive: true, force: true })))

function workdir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), `${prefix}-`))
  scratch.push(d)
  return d
}

function script(dir: string, name: string, body: string): string {
  const p = join(dir, name)
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(p, 0o755)
  return p
}

/** The environment an operator's shell actually has: no FARM_OUT_CHILD anywhere in it. Anything the
 *  test then observes under that name was set by grind.sh, not inherited. */
function envWithoutMarker(): Record<string, string> {
  const e: Record<string, string> = {}
  for (const [k, v] of Object.entries(grindEnv())) {
    if (k === 'FARM_OUT_CHILD' || v === undefined) continue
    e[k] = v
  }
  return e
}

function grind(args: string[]) {
  return spawnSync('bash', [GRIND, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    env: envWithoutMarker(),
  })
}

describe('grind.sh — an iteration is a farm-out child', () => {
  test('the runner is invoked with FARM_OUT_CHILD=1 alongside GRIND_ITERATION', () => {
    const d = workdir('grind-foc-runner')
    const journal = join(d, 'journal.jsonl')
    const seen = join(d, 'runner-env.txt')
    const check = script(d, 'check.sh', 'exit 1')
    const runner = script(d, 'runner.sh', `printf '%s|%s' "$FARM_OUT_CHILD" "$GRIND_ITERATION" > ${seen}`)
    writeFileSync(join(d, 'prompt.txt'), 'do one unit of work')

    grind([
      'run',
      '--journal', journal,
      '--check', check,
      '--runner', runner,
      '--prompt-file', join(d, 'prompt.txt'),
      '--max-iters', '1',
      '--sleep', '0',
    ])

    expect(readFileSync(seen, 'utf8')).toBe('1|1')
  })

  test('the marker is scoped to the runner — the grind process’s own check never sees it', () => {
    const d = workdir('grind-foc-scope')
    const journal = join(d, 'journal.jsonl')
    const seen = join(d, 'check-env.txt')
    const check = script(d, 'check.sh', `printf '%s' "\${FARM_OUT_CHILD:-unset}" > ${seen}; exit 1`)
    const runner = script(d, 'runner.sh', 'exit 0')
    writeFileSync(join(d, 'prompt.txt'), 'do one unit of work')

    grind([
      'run',
      '--journal', journal,
      '--check', check,
      '--runner', runner,
      '--prompt-file', join(d, 'prompt.txt'),
      '--max-iters', '1',
      '--sleep', '0',
    ])

    expect(readFileSync(seen, 'utf8')).toBe('unset')
  })
})
