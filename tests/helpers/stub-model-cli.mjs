#!/usr/bin/env bun
// A stub for the provider wrappers farm.sh launches (claude-code, codex-code, gemini-code): the same
// argv (`-p --output-format stream-json --verbose [--agent X] [--model M] [--json-schema S]`), the
// prompt on stdin, and the stream-json a real CLI writes — assistant messages carrying tool_use
// blocks and usage, then a `result` event (`structured_output` when a schema was passed).
//
// It answers the two prompts a work round sends:
//   AGENTS  "Call the Workflow tool with scriptPath <wrapper>" — runs farm.sh's generated wrapper
//           through work-stage.mjs's loader, with agent() answered here: implement:<id> writes the
//           edits in STUB_EDITS ({relpath: content}, relative to the cwd) and reports them; every
//           other label takes workflow-harness.mjs's default reply. The return value goes to the
//           path the prompt names, as a Write would.
//   LENS    anything else with --json-schema: STUB_LENS (JSON) or a lens that found nothing.
//
// STUB_FAULT injects one canary failure class: tool-error (a hook error line in the reply),
// zero-usage (tool calls at 0 tokens), kill-farm (SIGKILL the farm.sh that launched the lens row,
// so its START never gets a DONE). No network, no model.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { load } from '../../skills/work/scripts/work-stage.mjs'
import { replies } from '../../skills/work/scripts/workflow-harness.mjs'

const argv = process.argv.slice(2)
const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
const prompt = readFileSync(0, 'utf8')
const fault = process.env.STUB_FAULT || ''
const model = flag('--model') || 'stub-model'
let n = 0
const usage = () => fault === 'zero-usage'
  ? { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 }
  : { input_tokens: 1200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 80 }
const say = obj => process.stdout.write(JSON.stringify(obj) + '\n')
const toolUse = (name, input) => say({ type: 'assistant', message: { id: `m${++n}`, model, content: [{ type: 'tool_use', id: `t${n}`, name, input }], usage: usage() } })

const wf = prompt.match(/Call the Workflow tool with scriptPath (\S+)/)
if (wf) {
  const out = prompt.match(/write the SCRIPT'S OWN RETURN VALUE to (\S+) as/)?.[1]
  if (!out) { process.stderr.write('stub-model: the Workflow prompt names no output path\n'); process.exit(3) }
  toolUse('Workflow', { scriptPath: wf[1] })
  const edits = JSON.parse(process.env.STUB_EDITS || '{}')
  const fallback = replies()
  const agent = async (_p, opts) => {
    toolUse('Agent', { description: opts.label })
    if (opts.label.startsWith('implement:')) {
      for (const [p, body] of Object.entries(edits)) {
        mkdirSync(dirname(resolve(p)), { recursive: true })
        writeFileSync(resolve(p), body)
      }
      return { id: opts.label.slice('implement:'.length), done: true, changedFiles: Object.keys(edits), evidence: 'stub implementer wrote the edit' }
    }
    return fallback(opts.label, _p, opts)
  }
  const parallel = ts => Promise.all(ts.map(async t => { try { return await t() } catch { return null } }))
  const pipeline = async (items, ...stages) => {
    const o = []
    for (let i = 0; i < items.length; i++) {
      let v = items[i]
      try { for (const s of stages) v = await s(v, items[i], i); o.push(v) } catch { o.push(null) }
    }
    return o
  }
  const workflow = (spec, a) => load(spec.scriptPath)(a, agent, () => {}, parallel, pipeline, () => {})
  const src = readFileSync(wf[1], 'utf8').replace('export const meta =', 'const meta =')
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  let ret
  try { ret = await new AsyncFunction('workflow', src)(workflow) } catch (e) { ret = { error: String(e?.stack || e) } }
  toolUse('Write', { file_path: out })
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(ret))
} else {
  toolUse('Read', { file_path: join(process.cwd(), 'README') })
  if (fault === 'kill-farm') process.kill(process.ppid, 'SIGKILL')
}

const so = argv.includes('--json-schema')
  ? JSON.parse(process.env.STUB_LENS || '{"routes":[],"findings":[],"carried":[],"dispositions":[]}')
  : null
if (so) toolUse('StructuredOutput', so)
const text = (fault === 'tool-error' ? 'PreToolUse:Bash hook error: stub-injected. ' : '') + (so ? JSON.stringify(so) : 'done')
say({ type: 'result', subtype: 'success', result: text, ...(so ? { structured_output: so } : {}) })
