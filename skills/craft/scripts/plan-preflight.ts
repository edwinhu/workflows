#!/usr/bin/env bun
/**
 * plan-preflight.ts — TIER 2 of craft's plan review: run the plan's own gates at BASELINE, before
 * any implementer is dispatched, and read the exit codes.
 *
 *   bun .../plan-preflight.ts <plan.md | args.json> --cwd <repo> [--json] [--timeout 120]
 *                             [--skip <key,key>] [--only redCommand|mechanical|acceptance] [--unsafe]
 *
 * Exit 0 = baseline is consistent with the plan, 1 = defects reported, 2 = could not parse.
 *
 * craft already executes these commands — as probes AFTER dispatching implementers, where a bad
 * gate surfaces as `red-not-red` and costs a whole round. The commands are the same; only the
 * moment changes, and at this moment a defect costs zero agents.
 *
 * What the exit codes decide, with no agent and no judgement:
 *   - a redCommand that is ALREADY GREEN at baseline gates nothing (there is no red to go from)
 *   - a redCommand that cannot even run (127) names a binary this tree does not provide
 *   - a mechanical check already green is a regression guard, which the plan must SAY it is
 *   - two checks that no single tree can satisfy are visible as a contradiction in one matrix
 *   - an acceptance clause whose every command is already green, on a task with no red gate, cannot
 *     tell "the work landed" from "the work was never started"
 *
 * SAFETY. This runs commands verbatim from a plan against a live tree. Anything matching DANGEROUS
 * is skipped unless --unsafe, because a plan under review is exactly the artifact whose commands
 * have not been vetted yet.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseArgs, parseMarkdown, commandsIn, type Plan } from './plan-lint.ts'

type Probe = {
  kind: 'redCommand' | 'mechanical' | 'acceptance'
  key: string
  cmd: string
  status: number | null
  skipped?: string
  ms: number
}
type Defect = {
  rule: string
  severity: 'critical' | 'major' | 'minor'
  where: string
  message: string
  evidence: string
}

/** Commands that touch the user's live services, the network, or send mail. */
const DANGEROUS =
  /\b(systemctl|launchctl|reboot|shutdown|rm\s+-rf|git\s+(push|commit|reset\s+--hard)|sendmail|swaks|mail\s+-s)\b|:1143\b|--port\s+1143/

const run = (cmd: string, cwd: string, timeoutSec: number): { status: number | null; ms: number } => {
  const t0 = Date.now()
  const r = spawnSync('bash', ['-c', cmd], {
    cwd,
    timeout: timeoutSec * 1000,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return { status: r.status, ms: Date.now() - t0 }
}

/** A span whose first token is a plausible executable name. `commandsIn` only admits runners it
 * recognises, and a clause naming a binary this tree has never heard of is precisely what exit 127
 * is here to catch — so acceptance probes take those spans too. */
const INVOCATION = /^\.{0,2}\/?[\w.\/@-]*[A-Za-z][\w.\/@-]*\s+\S/

const acceptanceCommands = (acceptance: string): string[] => {
  const known = commandsIn(acceptance ?? '')
  const extra = ((acceptance ?? '').match(/`[^`]+`/g) ?? [])
    .map(s => s.replace(/`/g, '').replace(/\s+/g, ' ').trim())
    .filter(v => INVOCATION.test(v))
  return [...new Set([...known, ...extra])]
}

const preflight = (
  p: Plan,
  opts: {
    cwd: string
    timeout: number
    skip: Set<string>
    unsafe: boolean
    /** Probe one kind only. craft-dispatch runs redCommands through its own richer classifier
     * (pytest 4/5, missing runner, no-test-output), so it asks for `mechanical` and would
     * otherwise execute every redCommand a second time. */
    only?: Probe['kind']
  },
): { probes: Probe[]; defects: Defect[] } => {
  const probes: Probe[] = []
  const defects: Defect[] = []
  const add = (
    rule: string,
    severity: Defect['severity'],
    where: string,
    message: string,
    evidence: string,
  ) => defects.push({ rule, severity, where, message, evidence })

  const exec = (kind: Probe['kind'], key: string, cmd: string): Probe => {
    if (opts.skip.has(key)) {
      const pr: Probe = { kind, key, cmd, status: null, skipped: 'named in --skip', ms: 0 }
      probes.push(pr)
      return pr
    }
    if (DANGEROUS.test(cmd) && !opts.unsafe) {
      const pr: Probe = {
        kind,
        key,
        cmd,
        status: null,
        skipped: 'matches the live-service/network denylist; re-run with --unsafe to include it',
        ms: 0,
      }
      probes.push(pr)
      return pr
    }
    const { status, ms } = run(cmd, opts.cwd, opts.timeout)
    const pr: Probe = { kind, key, cmd, status, ms }
    probes.push(pr)
    return pr
  }

  const kind = (k: Probe['kind']) => opts.only == null || opts.only === k

  for (const t of kind('redCommand') ? p.tasks : []) {
    if (!t.redCommand) continue
    const pr = exec('redCommand', t.id, t.redCommand)
    if (pr.skipped != null) continue

    if (pr.status === 127)
      add(
        'gate-command-not-found',
        'critical',
        `task ${t.id}`,
        'redCommand exits 127 at baseline — the binary it names is not on PATH in this tree, so the gate tests something else or nothing',
        `${t.redCommand} -> 127`,
      )
    else if (pr.status === 0)
      add(
        'red-gate-already-green',
        'critical',
        `task ${t.id}`,
        'redCommand exits 0 at BASELINE, so there is no red to go from — the gate cannot prove this task did anything',
        `${t.redCommand} -> 0`,
      )
    else if (pr.status === null)
      add(
        'gate-timeout',
        'major',
        `task ${t.id}`,
        `redCommand did not finish within ${opts.timeout}s at baseline`,
        t.redCommand,
      )
  }

  for (const m of kind('mechanical') ? p.mechanicalChecks : []) {
    if (!m.cmd) continue
    const pr = exec('mechanical', m.name, m.cmd)
    if (pr.skipped != null) continue

    if (pr.status === 127)
      add(
        'gate-command-not-found',
        'critical',
        `mechanical ${m.name}`,
        'check exits 127 at baseline — the binary it names is not on PATH in this tree',
        `${m.cmd} -> 127`,
      )
    else if (pr.status === null)
      add(
        'gate-timeout',
        'major',
        `mechanical ${m.name}`,
        `check did not finish within ${opts.timeout}s at baseline`,
        m.cmd,
      )
  }

  for (const t of kind('acceptance') ? p.tasks : []) {
    const cmds = acceptanceCommands(t.acceptance)
    if (!cmds.length) continue
    const ran: Probe[] = []
    for (const cmd of cmds) {
      const pr = exec('acceptance', t.id, cmd)
      if (pr.skipped != null) continue
      ran.push(pr)
      if (pr.status === 127)
        add(
          'acceptance-command-not-found',
          'critical',
          `task ${t.id}`,
          'an acceptance command exits 127 at baseline — it names a binary or entry point this tree does not provide, so the clause can never mean what it claims',
          `${cmd} -> 127`,
        )
    }
    // A task with a redCommand is exempt: its red gate already proves the work was not already done.
    if (!t.redCommand && ran.length && ran.every(x => x.status === 0))
      add(
        'acceptance-green-at-baseline',
        'major',
        `task ${t.id}`,
        'every acceptance command exits 0 BEFORE any work, and the task declares no redCommand — nothing distinguishes "the work landed" from "the work was never started"',
        ran.map(x => `${x.cmd} -> 0`).join(' | '),
      )
  }

  // The baseline matrix as a contradiction detector. A plan that requires every mechanical check to
  // pass at the end, while some pass and some fail today, is normal — the run is what closes the
  // gap. What is NOT normal is a check the plan calls a red gate that is already green: report the
  // split so a contradiction between two checks is one table to read rather than an argument.
  const mech = probes.filter(x => x.kind === 'mechanical' && !x.skipped)
  const green = mech.filter(x => x.status === 0).map(x => x.key)
  const red = mech.filter(x => x.status !== 0).map(x => x.key)
  if (green.length && red.length)
    add(
      'baseline-split',
      'minor',
      'mechanical checks',
      'the plan must say which of these are REGRESSION GUARDS (green today, must stay green) and which are the run’s targets (red today) — an undeclared green check reads as a gate but proves nothing',
      `green at baseline: ${green.join(', ')} | red at baseline: ${red.join(', ')}`,
    )

  return { probes, defects }
}

const main = () => {
  const argv = process.argv.slice(2)
  const flag = (n: string) => {
    const i = argv.indexOf(n)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const VALUE_FLAGS = new Set(['--cwd', '--timeout', '--skip', '--only'])
  const path = argv.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(argv[i - 1] ?? ''))
  const cwd = flag('--cwd')
  const only = flag('--only') as Probe['kind'] | undefined
  const KINDS = new Set<string>(['redCommand', 'mechanical', 'acceptance'])
  if (!path || !cwd || (only != null && !KINDS.has(only))) {
    console.error('usage: plan-preflight.ts <plan.md | args.json> --cwd <repo> [--json] [--timeout N] [--skip a,b] [--only redCommand|mechanical|acceptance] [--unsafe]')
    process.exit(2)
  }
  let plan: Plan
  try {
    const raw = readFileSync(path, 'utf8')
    plan = path.endsWith('.json') ? parseArgs(JSON.parse(raw)) : parseMarkdown(raw)
  } catch (e) {
    console.error(`plan-preflight: cannot read or parse ${path}: ${(e as Error).message}`)
    process.exit(2)
  }
  // An empty task table is not an unreadable plan when there are mechanical checks to probe: a
  // readOnly run declares `tasks: []` BY DEFINITION, and its whole gate is mechanicalChecks. The
  // old unconditional refusal made this script exit 2 on exactly the run shape that needs it.
  if (!plan.tasks.length && !plan.mechanicalChecks.length) {
    console.error(`plan-preflight: ${path} declares no tasks and no mechanicalChecks — nothing to probe`)
    process.exit(2)
  }

  const { probes, defects } = preflight(plan, {
    cwd,
    timeout: Number(flag('--timeout') ?? 120),
    skip: new Set((flag('--skip') ?? '').split(',').filter(Boolean)),
    unsafe: argv.includes('--unsafe'),
    only,
  })

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ path, cwd, probes, defects }, null, 2))
  } else {
    console.log('BASELINE MATRIX')
    for (const pr of probes)
      console.log(
        `  ${{ redCommand: 'red ', mechanical: 'mech', acceptance: 'acc ' }[pr.kind]} ${pr.key.padEnd(16)} ` +
          `${pr.skipped ? 'SKIPPED' : `exit ${String(pr.status)}`.padEnd(8)} ${pr.ms}ms  ${pr.cmd}  ${pr.skipped ?? ''}`,
      )
    console.log()
    for (const d of defects) {
      console.log(`${d.severity.toUpperCase().padEnd(8)} ${d.rule}  [${d.where}]`)
      console.log(`         ${d.message}`)
      console.log(`         > ${d.evidence}`)
    }
    console.log(`\n${defects.length} defect(s) from ${probes.filter(x => !x.skipped).length} executed probe(s)`)
  }
  process.exit(defects.length ? 1 : 0)
}

if (import.meta.main) main()

export { preflight, type Probe, type Defect }
