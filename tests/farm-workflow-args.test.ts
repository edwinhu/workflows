import { test, expect, setDefaultTimeout } from 'bun:test'
import { writeFileSync, readFileSync, mkdirSync, chmodSync, readdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { useTmp } from './helpers/tmp.ts'
import { WORKFLOW, baseArgs, task } from '../skills/work/scripts/workflow-harness.mjs'

const mkTmp = useTmp()
setDefaultTimeout(60_000)

const FARM = join(import.meta.dir, '..', 'skills', 'farm-out', 'scripts', 'farm.sh')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

// Observed 2026-10-07/08 (nevada): --args were retyped by the child model into its Workflow call,
// and above ~30 KB they arrived garbled — a 93 KB set as a string, a 32.8 KB one unparseable.
// The args must reach the script without passing through the model at all.

/** Run farm.sh --workflow --args under a stub child that keeps the script it was told to call. */
function dispatch(argsText: string) {
  const root = mkTmp('farm-wfargs-')
  const bin = join(root, 'bin'); mkdirSync(bin, { recursive: true })
  const tmp = join(root, 'tmp'); mkdirSync(tmp, { recursive: true })
  const out = join(root, 'result.json')
  writeFileSync(join(bin, 'claude-code'), `#!/usr/bin/env bash
cat > "${root}/stdin"
sp=$(grep -o 'scriptPath [^ ]*' "${root}/stdin" | head -1 | cut -d' ' -f2)
cp -- "$sp" "${root}/called.js"
printf '{}\\n' > "${out}"
printf '%s\\n' '{"type":"result","result":"ok"}'
`)
  chmodSync(join(bin, 'claude-code'), 0o755)
  const wf = join(root, 'wf.js'); writeFileSync(wf, 'export const meta = { name: "x", description: "x" }\n')
  const args = join(root, 'args.json'); writeFileSync(args, argsText)
  const res = spawnSync('bash', [FARM, '--provider', 'claude', '--no-cron', '--workflow', wf, '--args', args,
    '--out', out, '--cwd', root], { encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: tmp, FARM_OUT_CHILD: '1',
           FARM_OUTCOMES: join(root, 'farm-outcomes.jsonl'), CLAUDE_CODE_SESSION_ID: '' } })
  return { res, root, tmp, wf: realpathSync(wf), stdin: readFileSync(join(root, 'stdin'), 'utf8'),
           called: readFileSync(join(root, 'called.js'), 'utf8') }
}

/** Execute the script the child called, as the Workflow runtime would, capturing its workflow() call. */
async function execute(src: string) {
  const calls: Array<{ ref: any, args: any }> = []
  const workflow = async (ref: any, a: any) => { calls.push({ ref, args: a }); return { ran: ref.scriptPath } }
  const ret = await new AsyncFunction('workflow', 'args', src.replace('export const meta =', 'const meta ='))(workflow, undefined)
  return { calls, ret }
}

function priorResultsArgs(bytes: number) {
  const priorResults: Record<string, unknown> = {}
  for (let i = 0; JSON.stringify(priorResults).length < bytes; i++) {
    priorResults[`T${i}`] = { status: 'verified', evidence: `ev-${(i * 2654435761 >>> 0).toString(36)}`, files: [`src/f${i}.ts`] }
  }
  return { ...baseArgs, tasks: [task({ redCommand: 'bun test x' })], round: { plan: true }, priorResults }
}

test('a 120 KB args file reaches the script byte-identical, and never through the prompt', async () => {
  const text = JSON.stringify(priorResultsArgs(120_000))
  expect(text.length).toBeGreaterThan(120_000)
  const d = dispatch(text)
  expect(d.res.status, d.res.stderr).toBe(0)
  // the model is told to pass nothing, and is never shown the payload
  expect(d.stdin).toContain('and no args')
  expect(d.stdin.length).toBeLessThan(8_000)
  expect(d.stdin).not.toContain('"priorResults"')
  const { calls, ret } = await execute(d.called)
  expect(calls.length).toBe(1)
  expect(calls[0].ref).toEqual({ scriptPath: d.wf })
  expect(JSON.stringify(calls[0].args)).toBe(text)
  expect(ret).toEqual({ ran: d.wf })
  // the generated script is a run temp file, removed with the run
  expect(readdirSync(d.tmp).filter(f => f.endsWith('.workflow.js'))).toEqual([])
})

test('awkward JSON survives the generated script exactly: __proto__, U+2028, quotes, ${, </script>', async () => {
  const text = `{\n  "__proto__": {"polluted": true},\n  "s": "a b c \\" \\\\ \${x} </script> \`tick\` é 🦀",\n  "n": [1.5e300, -0, null, false]\n}\n`
  const d = dispatch(text)
  expect(d.res.status, d.res.stderr).toBe(0)
  const { calls } = await execute(d.called)
  const got = calls[0].args
  expect(Object.hasOwn(got, '__proto__')).toBe(true)
  expect(JSON.stringify(got)).toBe(JSON.stringify(JSON.parse(text)))
  expect(got).toEqual(JSON.parse(text))
})

// Inline args — the Workflow tool's own `args`, as an object or as the JSON string a model sometimes
// produces — must still work: work's workflow.js decodes a string or fails closed.
const planStage = (a: unknown) => {
  const src = readFileSync(WORKFLOW, 'utf8').replace('export const meta =', 'const meta =')
  const no = () => { throw new Error('plan stage dispatched') }
  return new AsyncFunction('args', 'agent', 'phase', 'parallel', 'pipeline', 'log', src)(a, no, () => {}, no, no, () => {})
}

test('work: 120 KB args agree across the args-file wrapper, an inline object and an inline JSON string', async () => {
  const obj = priorResultsArgs(120_000)
  const text = JSON.stringify(obj)
  const d = dispatch(text)
  expect(d.res.status, d.res.stderr).toBe(0)
  const { calls } = await execute(d.called)
  const fromObj = await planStage(obj)
  expect(fromObj.stage).toBe('plan')
  expect(await planStage(calls[0].args)).toEqual(fromObj)
  expect(await planStage(text)).toEqual(fromObj)
})
