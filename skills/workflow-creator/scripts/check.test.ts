// check.test.ts — the entry point's own suite. Its job is to prove that a failure in EACH of the
// seven legs reaches check.sh's exit code, so no leg can be silently dropped or stubbed out.
//
// It never runs check.sh against this skill itself: check.sh's suite leg runs
// `bun test <target>/scripts/*.test.ts`, which is this file, and a self-target would recurse.
// Every case below points a COPY of check.sh at a throwaway fixture target instead.
import { afterAll, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPTS = import.meta.dir
const CHECK = join(SCRIPTS, 'check.sh')

const trash: string[] = []
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  trash.push(d)
  return d
}
afterAll(() => {
  for (const d of trash) rmSync(d, { recursive: true, force: true })
})

// A copy of the scripts dir. check.sh resolves each leg's command relative to its OWN location, so
// stubbing one helper in a copy is how a single leg is forced to fail while the others stay real —
// without that, the parity leg (whose command takes no target) could not be failed at all.
//
// The copy is wrapped in a PLUGIN ROOT (`.claude-plugin/plugin.json`) holding the two sibling
// probes where check.sh's upward walk expects them. Omitting it would make the harness exercise
// only the could-not-look branch, which is the one case that must not stand in for the others.
// `noSiblings` omits exactly that, so the refusal itself is under test.
function harness(opts: { parityStub?: string; noSiblings?: boolean } = {}): string {
  const d = tmp('wc-check-harness-')
  const s = join(d, 'scripts')
  mkdirSync(s)
  if (!opts.noSiblings) {
    mkdirSync(join(d, '.claude-plugin'))
    writeFileSync(join(d, '.claude-plugin', 'plugin.json'), '{"name":"harness","version":"0.0.1"}')
    for (const [skill, probe] of [
      ['skill-creator', 'sc-probe.ts'],
      ['plugin-creator', 'pc-probe.ts'],
    ] as const) {
      mkdirSync(join(d, 'skills', skill), { recursive: true })
      symlinkSync(join(SCRIPTS, '..', '..', skill, 'scripts'), join(d, 'skills', skill, 'scripts'))
      void probe
    }
  }
  copyFileSync(CHECK, join(s, 'check.sh'))
  symlinkSync(join(SCRIPTS, 'wc-probe.ts'), join(s, 'wc-probe.ts'))
  symlinkSync(join(SCRIPTS, 'validate-skill-write.ts'), join(s, 'validate-skill-write.ts'))
  symlinkSync(join(SCRIPTS, 'authoring-lint.ts'), join(s, 'authoring-lint.ts'))
  if (opts.parityStub === undefined) {
    symlinkSync(join(SCRIPTS, 'parity-check.sh'), join(s, 'parity-check.sh'))
  } else {
    writeFileSync(join(s, 'parity-check.sh'), opts.parityStub, { mode: 0o755 })
    chmodSync(join(s, 'parity-check.sh'), 0o755)
  }
  return join(s, 'check.sh')
}

// DECLARED EXEMPTION, scoped to this line: it is the deliberately broken reference the wc-probe
// leg has to fire on. It is fixture data, not a path this file uses.
// <!-- wc-probe: ignore-paths:start -->
const BROKEN_AGENT = '---\nname: guard\ndescription: d\n---\n\nuses ${CLAUDE_PLUGIN_ROOT}/x.sh\n'
// <!-- wc-probe: ignore-paths:end -->

// The canonical TOC bang, which sc-probe's S1 requires of every skill unconditionally. Assembled
// from fragments so this file never holds a literal bang line: a bang written out in a file the
// harness loads EXECUTES, which is the S2(a) defect sc-probe itself exists to catch.
const TOC_BANG =
  '!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; ' +
  's=$HOME/' +
  '.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; ' +
  'echo "(skill-toc unavailable)"`'

const CLEAN_SKILL = `---\nname: fixture\ndescription: a fixture skill\n---\n\n# fixture\n\n${TOC_BANG}\n`
const PASSING_TEST = "import { expect, test } from 'bun:test'\ntest('fixture passes', () => { expect(1).toBe(1) })\n"
const FAILING_TEST = "import { expect, test } from 'bun:test'\ntest('fixture fails', () => { expect(1).toBe(2) })\n"

// A fixture workflow skill. `skill` defaults to a body wc-probe reports CLEAN; `js` and `tests`
// add the artifacts the node-check and suite legs look for.
// `noPluginRoot` omits the marker so the pc-probe leg's could-not-look refusal is exercised.
function target(opts: { skill?: string; js?: string; tests?: Record<string, string>; emptyScripts?: boolean; noPluginRoot?: boolean } = {}): string {
  const d = tmp('wc-check-target-')
  if (!opts.noPluginRoot) {
    mkdirSync(join(d, '.claude-plugin'))
    writeFileSync(join(d, '.claude-plugin', 'plugin.json'), '{"name":"fixture","version":"0.0.1"}')
  }
  writeFileSync(join(d, 'SKILL.md'), opts.skill ?? CLEAN_SKILL)
  if (opts.js !== undefined) writeFileSync(join(d, 'workflow.js'), opts.js)
  if (opts.tests || opts.emptyScripts) {
    mkdirSync(join(d, 'scripts'))
    for (const [name, body] of Object.entries(opts.tests ?? {})) writeFileSync(join(d, 'scripts', name), body)
  }
  return d
}

function run(check: string, args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync('bash', [check, ...args], { encoding: 'utf8', timeout: 120_000 })
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function legLines(stdout: string): string[] {
  return stdout.split('\n').filter((l) => /^leg /.test(l))
}

function legStatus(stdout: string, name: string): string {
  const line = legLines(stdout).find((l) => l.startsWith(`leg ${name} `))
  if (!line) throw new Error(`no leg line for ${name} in:\n${stdout}`)
  return line
}

test('leg-count: check.sh statically declares exactly the seven legs', () => {
  // Decided by READING check.sh, not by running it: check.sh is the run's own mechanical gate, so a
  // check.sh that dropped a leg would still exit 0 and certify its own completeness.
  const src = readFileSync(CHECK, 'utf8')
  const names = new Set<string>()
  for (const m of src.matchAll(/^[ \t]*report[ \t]+([A-Za-z0-9_-]+)\b/gm)) names.add(m[1]!)
  expect([...names].sort()).toEqual(['authoring-lint', 'node-check', 'parity', 'pc-probe', 'probe-tests', 'sc-probe', 'wc-probe'])
  expect(names.size).toBe(7)
})

test('leg-count: a clean target prints exactly seven leg lines and exits 0', () => {
  const r = run(harness(), ['--target', target({ tests: { 'fixture.test.ts': PASSING_TEST } })])
  expect(r.stdout + r.stderr).toContain('leg')
  expect(legLines(r.stdout).length).toBe(7)
  for (const leg of ['wc-probe', 'sc-probe', 'pc-probe', 'parity', 'authoring-lint', 'node-check', 'probe-tests']) {
    expect(legStatus(r.stdout, leg)).toContain('exit=0')
  }
  expect(r.code).toBe(0)
})

test('a forced failure in the sc-probe leg propagates', () => {
  // A skill with no TOC bang is sc-probe's S1. wc-probe has never judged it, so if this failure
  // did not reach the exit code the structure legs would be decoration.
  const t = target({
    skill: '---\nname: fixture\ndescription: a fixture skill\n---\n\n# fixture\n',
    tests: { 'fixture.test.ts': PASSING_TEST },
  })
  const r = run(harness(), ['--target', t])
  expect(legStatus(r.stdout, 'sc-probe')).not.toContain('exit=0')
  expect(legStatus(r.stdout, 'wc-probe')).toContain('exit=0')
  expect(legLines(r.stdout).length).toBe(7)
  expect(r.code).not.toBe(0)
})

test('the pc-probe leg is judged at the PLUGIN ROOT, resolved upward from the target', () => {
  // The target is nested two levels below the marker, so a leg that counted `..` hops instead of
  // walking would resolve to the wrong directory or to none.
  const root = tmp('wc-check-root-')
  mkdirSync(join(root, '.claude-plugin'))
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), '{"name":"nested","version":"0.0.1"}')
  const t = join(root, 'skills', 'nested-workflow')
  mkdirSync(t, { recursive: true })
  writeFileSync(join(t, 'SKILL.md'), CLEAN_SKILL)
  const r = run(harness(), ['--target', t])
  expect(legStatus(r.stdout, 'pc-probe')).toContain('exit=0')
  expect(legStatus(r.stdout, 'pc-probe')).toContain(root)
  expect(r.code).toBe(0)
})

test('the pc-probe leg REFUSES with exit 2 when no plugin root resolves above the target', () => {
  // Never 0 and never skipped. A leg that cannot look is not a leg that passed, and the refusal
  // must name what was missing rather than reporting a clean structure nobody checked.
  const r = run(harness(), ['--target', target({ noPluginRoot: true })])
  expect(legStatus(r.stdout, 'pc-probe')).toContain('exit=2')
  expect(r.stderr).toContain('.claude-plugin/plugin.json')
  expect(legLines(r.stdout).length).toBe(7)
  expect(r.code).toBe(2)
})

test('both structure legs REFUSE with exit 2 when the probes are unreachable', () => {
  // check.sh resolves the two sibling probes through its OWN plugin root. A copy dropped outside
  // one can still run every other leg, and the danger is exactly that: four green legs and two
  // structure checks that silently never happened.
  const r = run(harness({ noSiblings: true }), ['--target', target({ tests: { 'fixture.test.ts': PASSING_TEST } })])
  expect(legStatus(r.stdout, 'sc-probe')).toContain('exit=2')
  expect(legStatus(r.stdout, 'pc-probe')).toContain('exit=2')
  expect(legStatus(r.stdout, 'wc-probe')).toContain('exit=0')
  expect(r.code).toBe(2)
})

test('a forced failure in the wc-probe leg propagates', () => {
  // The missing script is named inside the TARGET's own skill dir, a root wc-probe always checks. A
  // path in this checkout was checked only when the checkout sat under $HOME, so the case failed
  // from any worktree under /tmp.
  const t = target({ tests: { 'fixture.test.ts': PASSING_TEST } })
  writeFileSync(join(t, 'SKILL.md'), `${CLEAN_SKILL}\nRun \`bash ${join(t, 'scripts', 'does-not-exist.sh')}\`.\n`)
  const r = run(harness(), ['--target', t])
  expect(legStatus(r.stdout, 'wc-probe')).not.toContain('exit=0')
  expect(legLines(r.stdout).length).toBe(7)
  expect(r.code).not.toBe(0)
})

test('a forced failure in the authoring-lint leg propagates', () => {
  // A retired excuse/reality table on an added line; the fixture target is untracked, so every line is added.
  const t = target({ skill: `${CLEAN_SKILL}\n| Excuse | Reality |\n|---|---|\n| later | now |\n`, tests: { 'fixture.test.ts': PASSING_TEST } })
  const r = run(harness(), ['--target', t])
  expect(legStatus(r.stdout, 'authoring-lint')).toContain('exit=1')
  expect(legStatus(r.stdout, 'wc-probe')).toContain('exit=0')
  expect(legLines(r.stdout).length).toBe(7)
  expect(r.code).toBe(1)
})

test('a forced failure in the parity leg propagates', () => {
  const r = run(harness({ parityStub: '#!/usr/bin/env bash\necho "forced parity failure" >&2\nexit 1\n' }), [
    '--target',
    target({ tests: { 'fixture.test.ts': PASSING_TEST } }),
  ])
  expect(legStatus(r.stdout, 'parity')).not.toContain('exit=0')
  expect(legStatus(r.stdout, 'wc-probe')).toContain('exit=0')
  expect(legLines(r.stdout).length).toBe(7)
  expect(r.code).not.toBe(0)
})

test('a forced failure in the node-check leg propagates', () => {
  const r = run(harness(), [
    '--target',
    target({ js: 'const x = ;;;\n', tests: { 'fixture.test.ts': PASSING_TEST } }),
  ])
  expect(legStatus(r.stdout, 'node-check')).not.toContain('exit=0')
  expect(legLines(r.stdout).length).toBe(7)
  expect(r.code).not.toBe(0)
})

test('a forced failure in the probe-tests leg propagates', () => {
  const r = run(harness(), ['--target', target({ tests: { 'fixture.test.ts': FAILING_TEST } })])
  expect(legStatus(r.stdout, 'probe-tests')).not.toContain('exit=0')
  expect(legLines(r.stdout).length).toBe(7)
  expect(r.code).not.toBe(0)
})

test('node-check passes when the target ships no .js, and a valid .js still passes', () => {
  const none = run(harness(), ['--target', target({ tests: { 'fixture.test.ts': PASSING_TEST } })])
  expect(legStatus(none.stdout, 'node-check')).toContain('exit=0')
  const valid = run(harness(), [
    '--target',
    target({ js: 'export const x = 1\n', tests: { 'fixture.test.ts': PASSING_TEST } }),
  ])
  expect(legStatus(valid.stdout, 'node-check')).toContain('exit=0')
  expect(valid.code).toBe(0)
})

test('the suite leg fails when the target ships scripts/ with no test file', () => {
  const r = run(harness(), ['--target', target({ emptyScripts: true })])
  expect(legStatus(r.stdout, 'probe-tests')).not.toContain('exit=0')
  expect(r.code).not.toBe(0)
})

test('the suite leg passes when the target ships no scripts/ directory at all', () => {
  const r = run(harness(), ['--target', target()])
  expect(legStatus(r.stdout, 'probe-tests')).toContain('exit=0')
  expect(legLines(r.stdout).length).toBe(7)
  expect(r.code).toBe(0)
})

test('the suite leg is target-relative, not this skill hard-coded', () => {
  // The target's own failing suite must be what fails. If check.sh ran workflow-creator's suite
  // instead, this would pass green and the leg would be asserting nothing about the target.
  const r = run(harness(), ['--target', target({ tests: { 'other-name.test.ts': FAILING_TEST } })])
  expect(r.stderr).toContain('other-name.test.ts')
  expect(r.code).not.toBe(0)
})

test('--agent is forwarded to the wc-probe leg', () => {
  const d = tmp('wc-check-agent-')
  const agent = join(d, 'guard.md')
  writeFileSync(agent, BROKEN_AGENT)
  const r = run(harness(), ['--target', target(), '--agent', agent])
  expect(legStatus(r.stdout, 'wc-probe')).not.toContain('exit=0')
  expect(r.code).not.toBe(0)
})

test('--target is required', () => {
  const r = run(harness(), [])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toContain('--target')
  expect(legLines(r.stdout).length).toBe(0)
})

test('--target with no value is an error, not an empty target', () => {
  const r = run(harness(), ['--target'])
  expect(r.code).not.toBe(0)
  expect(legLines(r.stdout).length).toBe(0)
})

test('a nonexistent target is an error, not a vacuous pass', () => {
  const r = run(harness(), ['--target', `${import.meta.dir}/../../no-such-skill-here`])
  expect(r.code).not.toBe(0)
})

test('an unknown flag is an error, not a default', () => {
  const r = run(harness(), ['--target', target(), '--verbose'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toContain('--verbose')
  expect(legLines(r.stdout).length).toBe(0)
})

// NON-VACUITY (skills/work/scripts/leg_counts.py). Inside a work run every mechanicalChecks command's
// stdout+stderr goes through leg_counts.audit, and a leg with no `<leg>: N <unit> examined` line turns
// an exit 0 into 2. These cases pass check.sh's output through that same audit, the way work-checks.sh
// does, so a leg that stops counting fails here rather than in a run's gate.
const LEG_COUNTS_DIR = join(SCRIPTS, '..', '..', 'work', 'scripts')
function audit(out: string): string[] {
  const py = 'import sys, json; sys.path.insert(0, sys.argv[1]); from leg_counts import audit; print(json.dumps(audit(sys.stdin.read())))'
  const r = spawnSync('python3', ['-c', py, LEG_COUNTS_DIR], { input: out, encoding: 'utf8' })
  return JSON.parse(r.stdout)
}
const combined = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr
const COUNTED_LEGS = ['sc-probe', 'parity', 'authoring-lint', 'node-check', 'probe-tests']

test('non-vacuity: every leg of a fixture target prints a count line, so the audit has no failures', () => {
  const r = run(harness(), ['--target', target({ js: 'export const x = 1\n', tests: { 'fixture.test.ts': PASSING_TEST } })])
  expect(audit(combined(r))).toEqual([])
})

test('non-vacuity: a real skill in this repo (jev-rules) passes the audit through the real check.sh', () => {
  const r = run(CHECK, ['--target', join(SCRIPTS, '..', '..', 'jev-rules')])
  expect(audit(combined(r))).toEqual([])
})

test('non-vacuity: a leg that examined nothing says `nothing in scope (...)`, never a bare 0', () => {
  const r = run(harness(), ['--target', target()]) // no .js, no scripts/
  const out = combined(r)
  expect(out).toMatch(/^node-check: 0 .* examined.*nothing in scope \(/m)
  expect(out).toMatch(/^probe-tests: 0 .* examined.*nothing in scope \(/m)
  expect(audit(out)).toEqual([])
})

test('non-vacuity: counts are what the leg read, not a constant', () => {
  const one = run(harness(), ['--target', target({ js: 'export const x = 1\n', tests: { 'a.test.ts': PASSING_TEST } })])
  const two = run(harness(), ['--target', target({ js: 'export const x = 1\n', tests: { 'a.test.ts': PASSING_TEST, 'b.test.ts': PASSING_TEST } })])
  const n = (r: typeof one, leg: string) => Number(new RegExp(`^${leg}: .*?(\\d+) [^\\d]*? examined`, 'm').exec(combined(r))?.[1])
  expect(n(one, 'node-check')).toBe(1)
  expect(n(one, 'probe-tests')).toBe(1)
  expect(n(two, 'probe-tests')).toBe(2)
  expect(n(one, 'sc-probe')).toBe(1)
})

test('non-vacuity: the audit names exactly the legs that print no count line', () => {
  const fails = audit(COUNTED_LEGS.map((l) => `leg ${l} exit=0`).join('\n'))
  expect(fails.length).toBe(COUNTED_LEGS.length)
  for (const l of COUNTED_LEGS) expect(fails.join('\n')).toContain(`leg ${l} printed no count line`)
})
