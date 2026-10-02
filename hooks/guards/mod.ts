// The plugin's tool-call guards as one mod: each guard that used to be a hooks.json settings hook
// runs here in-process, on `tool.call`, over the same payload the settings hook read on stdin.
//
// NEVER AN APPROVAL. A guard here can only deny or add context: the handler returns `{ deny }` or
// what `next(e)` resolved to, and it hooks no `tool.check`, the one event that can allow past an ask
// rule. A crashed PreToolUse gate denies (as `denyOnCrash` made the script deny); a crashed
// PostToolUse guard adds nothing (as the script's exit 1 was non-blocking).
import type { EngineInterface, On, ToolCallResult } from 'claude-code'
import { absolute, crashDeny, type EnvName, type FileStat, type Guard, type GuardIO, type Payload } from './core.ts'
import { atomicConstraintGuard } from './atomic-constraint.ts'
import { bunParallelGuard } from './bun-test.ts'
import { cronDeleteGuard, cronRecord } from './cron-delete.ts'
import { imageReadGuard } from './image-read.ts'
import { pgrepSelfMatch } from './pgrep.ts'
import { readGuard } from './read-guard.ts'
import { validateSkillPaths } from './skill-paths.ts'
import { suggestCompact } from './suggest-compact.ts'
import { typstConventionGuard } from './typst-convention.ts'

type $ = EngineInterface

export interface GuardSpec {
  /** The settings-hook script this guard was, under hooks/ (its gate name for a crash deny). */
  script: string
  gate: string
  event: 'PreToolUse' | 'PostToolUse'
  /** The hooks.json matcher it had, as tool names. */
  tools: string[]
  guard: Guard
}

/** In hooks.json order: a call several guards match gets the first deny, contexts in this order. */
export const GUARDS: GuardSpec[] = [
  { script: 'image-read-guard.ts', gate: 'IMAGE READ GUARD', event: 'PreToolUse', tools: ['Read'], guard: imageReadGuard },
  { script: 'read-guard.ts', gate: 'READ GUARD', event: 'PreToolUse', tools: ['Read', 'Bash'], guard: readGuard },
  { script: 'suggest-compact.ts', gate: 'SUGGEST COMPACT', event: 'PreToolUse', tools: ['Edit', 'Write'], guard: suggestCompact },
  { script: 'pgrep-self-match.ts', gate: 'PGREP GUARD', event: 'PreToolUse', tools: ['Bash', 'Monitor'], guard: pgrepSelfMatch },
  { script: 'bun-parallel-guard.ts', gate: 'BUN PARALLEL GUARD', event: 'PreToolUse', tools: ['Bash'], guard: bunParallelGuard },
  { script: 'cron-delete-guard.ts', gate: 'CRON DELETE GUARD', event: 'PreToolUse', tools: ['CronDelete'], guard: cronDeleteGuard },
  { script: 'atomic-constraint-guard.ts', gate: 'ATOMIC CONSTRAINT GUARD', event: 'PostToolUse', tools: ['Edit', 'Write'], guard: atomicConstraintGuard },
  { script: 'typst-convention-guard.ts', gate: 'TYPST CONVENTION GUARD', event: 'PostToolUse', tools: ['Edit', 'Write'], guard: typstConventionGuard },
  { script: 'validate-skill-paths.ts', gate: 'VALIDATE SKILL PATHS', event: 'PostToolUse', tools: ['Edit', 'Write'], guard: validateSkillPaths },
  { script: 'cron-delete-guard.ts --record', gate: 'CRON RECORD', event: 'PostToolUse', tools: ['CronCreate'], guard: cronRecord },
]

/** Every tool some guard matches. registerGuards spells it as a literal regex, which is what
 *  `claude plugin validate` can read; tests/mod-guards-parity.test.ts holds the two equal. */
export const TOOLS = [...new Set(GUARDS.flatMap(g => g.tools))]

/** The tool.call input's reserved keys; everything else is the tool's own arguments. */
const RESERVED = new Set(['tool', 'tool_use_id', 'consent'])

/** Each variable read by its literal name: `claude plugin validate` lists them, and requires it. */
async function readEnv($: $): Promise<Record<EnvName, string | undefined>> {
  const [a, b, c, d, e, f, g, h, i] = await Promise.all([
    $.env.get('LOOK_AT_NESTED'),
    $.env.get('READ_GUARD_BYTES'),
    $.env.get('COMPACT_THRESHOLD'),
    $.env.get('COMPACT_INTERVAL'),
    $.env.get('CLAUDE_CODE_SESSION_ID'),
    $.env.get('TMPDIR'),
    $.env.get('TEMP'),
    $.env.get('TMP'),
    $.env.get('WORK_ALLOW_CRON_DELETE'),
  ])
  return {
    LOOK_AT_NESTED: a, READ_GUARD_BYTES: b, COMPACT_THRESHOLD: c, COMPACT_INTERVAL: d,
    CLAUDE_CODE_SESSION_ID: e, TMPDIR: f, TEMP: g, TMP: h, WORK_ALLOW_CRON_DELETE: i,
  }
}

/** GuardIO over `$`. Relative paths resolve against the session's cwd, as the scripts' did. */
export function modIO($: $, env: Record<EnvName, string | undefined>, cwd: string, sessionId: string): GuardIO {
  const abs = (p: string): string | null => (typeof p === 'string' && p !== '' ? absolute(cwd, p) : null)
  const read = async (p: string): Promise<string | null> => {
    const a = abs(p)
    if (a === null) return null
    try {
      return await $.fs.read(a)
    } catch {
      return null
    }
  }
  return {
    env: name => env[name],
    cwd,
    pluginRoot: $.plugin.root,
    // node's os.tmpdir() on POSIX: TMPDIR, TMP, TEMP, then /tmp, a trailing slash dropped.
    osTmpdir: ((env.TMPDIR || env.TMP || env.TEMP || '/tmp').replace(/(.)\/+$/, '$1')),
    fallbackKey: sessionId,
    nowMs: () => Date.now(),
    stat: async (p): Promise<FileStat | null> => {
      const a = abs(p)
      if (a === null) return null
      try {
        const s = await $.fs.stat(a)
        return { kind: s.kind, size: s.size, mtimeMs: s.mtimeMs }
      } catch {
        return null
      }
    },
    read,
    list: async p => {
      const a = abs(p)
      if (a === null) return null
      try {
        return (await $.fs.list(a)).map(e => e.name)
      } catch {
        return null
      }
    },
    write: async (p, text) => {
      const a = abs(p)
      if (a === null) throw new Error(`cannot write ${String(p)}`)
      await $.fs.write(a, text)
    },
    // $.fs has no append: read, then write the whole file. Only the record half appends, to a file
    // of one id per line that this session alone writes.
    append: async (p, text) => {
      const a = abs(p)
      if (a === null) throw new Error(`cannot append ${String(p)}`)
      await $.fs.write(a, ((await read(a)) ?? '') + text)
    },
  }
}

/** The settings-hook payload for a tool.call event, as Claude Code would have sent it on stdin. */
export function payloadFor(
  e: Record<string, unknown>,
  event: 'PreToolUse' | 'PostToolUse',
  sessionId: string,
  cwd: string,
  toolResponse?: unknown,
): Payload {
  const toolInput: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(e)) if (!RESERVED.has(k)) toolInput[k] = v
  const p: Payload = {
    session_id: sessionId,
    cwd,
    hook_event_name: event,
    tool_name: e.tool,
    tool_input: toolInput,
  }
  if (e.tool_use_id !== undefined) p.tool_use_id = e.tool_use_id
  if (event === 'PostToolUse') p.tool_response = toolResponse
  return p
}

/** Run every guard of `event` matching `tool`; the first deny ends a PreToolUse round. */
export async function runGuards(
  specs: readonly GuardSpec[],
  event: 'PreToolUse' | 'PostToolUse',
  tool: string,
  payload: Payload,
  io: GuardIO,
): Promise<{ deny?: string; context: string[] }> {
  const context: string[] = []
  for (const spec of specs) {
    if (spec.event !== event || !spec.tools.includes(tool)) continue
    let out
    try {
      out = await spec.guard(payload, io)
    } catch (error) {
      if (event === 'PreToolUse') return { deny: crashDeny(spec.gate, 'throw', error), context }
      continue
    }
    if (event === 'PreToolUse' && out.deny !== undefined) return { deny: out.deny, context }
    if (out.context !== undefined) context.push(out.context)
  }
  return { context }
}

/** `specs` narrows the set for the parity test; the plugin registers all of GUARDS. */
export function registerGuards(on: On, specs: readonly GuardSpec[] = GUARDS): void {
  // What next(e) settled to, per call, for the catch handler: once the tool has run, a failure
  // after it must hand back that result, never run the call a second time.
  const settled = new Map<string, ToolCallResult>()

  on('tool.call', { tool: /^(Read|Bash|Edit|Write|Monitor|CronDelete|CronCreate)$/ }, async ($, e, next) => {
    const [sessionId, cwd, env] = await Promise.all([$.session.id(), $.session.cwd(), readEnv($)])
    const io = modIO($, env, cwd, sessionId)
    const input = e as unknown as Record<string, unknown>

    const pre = await runGuards(specs, 'PreToolUse', e.tool, payloadFor(input, 'PreToolUse', sessionId, cwd), io)
    if (pre.deny !== undefined) return { deny: pre.deny }

    const result = await next(e)
    const key = String(e.tool_use_id ?? '')
    settled.set(key, result)
    try {
      // PostToolUse fires only on a call that ran and succeeded; a refused call gets neither the
      // post guards nor the pre context, which has nowhere to go.
      if (result.deny !== undefined) return result
      const post = result.isError
        ? { context: [] as string[] }
        : await runGuards(specs, 'PostToolUse', e.tool, payloadFor(input, 'PostToolUse', sessionId, cwd, result.result), io)
      const added = [...pre.context, ...post.context]
      return added.length ? { ...result, context: [...(result.context ?? []), ...added] } : result
    } finally {
      settled.delete(key)
    }
  }).catch(async ($, e, next) => {
    // Before next(e): the call has not run, so a gate that could not decide denies. After: the
    // result next(e) settled to stands.
    const ran = settled.get(String(e.tool_use_id ?? ''))
    if (next.called && ran) return ran
    return { deny: crashDeny('PLUGIN GUARDS', next.error.kind, next.error.message) }
  })
}
