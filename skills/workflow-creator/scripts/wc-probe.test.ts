#!/usr/bin/env bun
/**
 * wc-probe.test.ts — the probe's own suite.
 *
 *   bun test ${CLAUDE_PLUGIN_ROOT}/skills/workflow-creator/scripts/wc-probe.test.ts
 *
 * Each test names the numbered defect (D1..D23) it pins. Every test asserts the
 * CORRECT behaviour, so the whole suite is red before the fixes land.
 *
 * Predicates are reached through a loose alias (`probe`) rather than named
 * imports on purpose: a test for a not-yet-written export must fail as ONE
 * failing test, not as a module-load error that takes the whole file down.
 *
 * DECLARED EXEMPTIONS — this file quotes broken paths and fake documented
 * return shapes as fixtures, so P2 and P5 would fire on the fixtures themselves.
 * Both are declared here, file-scoped, and are reported by the CLI:
 */
// <!-- wc-probe: ignore-paths -->
// <!-- wc-probe: ignore-returns -->

/**
 * DISCRIMINATION SWEEP — measured 2026-08-08, every describe block in this file.
 *
 * Method, run per block: `git archive <rev> .claude/skills/workflow-creator` into a scratch tree,
 * drop THIS test file into its scripts/, and run the block there. `<rev>` is the parent of the
 * commit that introduced the block (`git log --reverse -S"describe('<title>'"`); for the three
 * blocks still uncommitted at the time of the sweep it is HEAD. Because the file spawns the CLI
 * out of its own directory and imports the probe through a namespace alias, the block runs against
 * the OLD probe with no edit to the test.
 *
 * A test that survives its own pre-change revision pins nothing about the change. Two kinds do so
 * legitimately and are CONTROLS: a negative ("...is clean", "...draws nothing", "...produces no
 * finding") and a "still" ("...is STILL a critical"), both of which assert unchanged behaviour on
 * purpose. Everything else that survives is listed by name below.
 *
 * Survivors per block (survived / ran):
 *
 *   D1 — the walk admits TypeScript                                    41baec9f^   0/2
 *   D2 — fenced-block extraction in Markdown                           41baec9f^   0/4
 *   D3 — P2 sees bare absolute paths                                   41baec9f^   0/4
 *   D4 — P2 glob probe                                                 41baec9f^   0/2
 *   D13 — placeholder tail must be a path                              41baec9f^   0/2
 *   D14 — exemption markers are whole-line declarations                41baec9f^   2/7
 *   D5 — exemptions are reported in every output mode                  41baec9f^   0/2
 *   D6/D7 — P1 is registration-driven                                  41baec9f^   4/8
 *   D8 — P3 requires the load-bearing frontmatter keys                 41baec9f^   1/3
 *   D9 — coverage is accounted for, not swallowed                      41baec9f^   0/2
 *   D10 — P5 has no vacuous empty-set pass                             41baec9f^   1/2
 *   D15 — the probe is clean on its own source                         41baec9f^   0/1
 *   D11 — P6 reports what it actually found                            41baec9f^   7/14
 *   D12 — write-time and gate-time agree                               41baec9f^   1/3
 *   the documented exit-code contract                                  2b139862^   2/3
 *   R1-1 — a shell variable is unresolvable, not a broken path         b0dc51f6^   2/6
 *   R1-2 — P5 follows a single-assignment binding to its object l...   b0dc51f6^   1/3
 *   R2-1 — exemptions are parsed once, from raw                        b0dc51f6^   3/7
 *   R2-2 — a fence is code because of what it holds, not how it i...   b0dc51f6^   1/6
 *   R2-3 — P5 tells prose from code by file type                       b0dc51f6^   0/6
 *   R2-4 — the scriptPath a Markdown file names                        b0dc51f6^   0/5
 *   R2-5 — the contract return is the one at indentation zero          b0dc51f6^   1/7
 *   R2-6 — P5 follows the reference across files, both directions      b0dc51f6^   4/8
 *   R2-7 — a read outside the target is visible                        b0dc51f6^   0/3
 *   V1 — the same-file P5 path sees every form of returned key         b0dc51f6^   0/4
 *   V2 — an exemption in a hook registry is honoured AND reported      b0dc51f6^   2/4
 *   V3 — maskLiterals tracks ${…} interpolation                        cef7ad75^   3/5
 *   V5 — in code, an annotation lives in a comment, not a string       1a105660^   2/5
 *   V4 — an arrow inside a call argument is not the enclosing return   cef7ad75^   3/6
 *   V6 — the two halves of P5 read the same return forms and the ...   e3f36d70^   3/6
 *   V6 — P2 reports an unresolvable variable instead of skipping ...   e3f36d70^   1/2
 *   V6 — findKeyValueSpan agrees with objectTopLevelKeys about ke...   e3f36d70^   0/1
 *   V7 — the coverage floor                                            88d87502^   1/3
 *   V7 — symlinks are followed, and dangling ones are reported         88d87502^   1/3
 *   V7 — P2 covers code, and the gate dispatches like the hook         88d87502^   1/4
 *   V7 — P1 reads a command the way a shell would                      88d87502^   0/2
 *   the probe against its own skill                                    41baec9f^   1/3
 *   V3-A — the walk cannot climb above its target                      90f23ad2^   0/4
 *   V3-B — SKIP_DIRS decides on what an entry RESOLVES to, not wh...   90f23ad2^   0/2
 *   V3-C — an aliased directory does not silently switch a rule off    90f23ad2^   0/1
 *   V3-D — a hook command that does not lex is never read as a ho...   90f23ad2^   2/4
 *   V3-E — the ${CLAUDE_SKILL_DIR} hook rule covers BOTH spellings     90f23ad2^   2/3
 *   V3-F — P2 on a code file does not police paths the file merel...   90f23ad2^   1/2
 *   V3-G — P2 announces the reference it could not resolve             90f23ad2^   0/1
 *   V3-H — the write-time hook is ungated wherever the gate is         90f23ad2^   0/1
 *   V3-I — a dangling link is judged by the same skip list its re...   90f23ad2^   1/2
 *   V3-J — the coverage floor describes the dispatch it actually has   90f23ad2^   1/2
 *   D16 — an agent file outside the skill is gated with --agent        39043bcf^   2/20
 *   D17 — --expect agents changes what the floor demands, not whe...   39043bcf^   1/5
 *   D18 — a documentation placeholder is a template, not a broken...   bb4d5b9e^   6/11
 *   D19 — P2 skips are reported, and its scanners cover relative ...   945a4e76^   2/6
 *   D20 — shell scripts are inside the walk                            c57300aa^   0/3
 *   D21 — cycle-2 regressions                                          309766cf^   5/9
 *   D22 — an agent hooks: command may not use ${CLAUDE_PLUGIN_ROOT}    6d242b40^   2/4
 *   D23 — one notion of agenthood, not three                           32663497^   2/3
 *   D24 — every CommonMark link form the scanner claims to cover       b83cd43f^   3/9
 *   D25 — every Markdown reference form, in every polarity             HEAD        33/64
 *   D26 — the coverage denominator does not silently choose its o...   HEAD        1/8
 *   D27 — P4 is a NON-plugin rule                                      HEAD        2/6
 *
 * SURVIVORS THAT ARE NOT CONTROLS — each asserts a behaviour its commit claims to introduce, and
 * each passes against the code from before that commit. Listed, not silently repaired: repairing
 * them is a change to what those blocks test, which is outside this task's writable scope of one
 * fix plus this record.
 *
 *   D16  '--agent against a target with no SKILL.md does not crash the probe'      39043bcf^
 *        Vacuous: neither --agent nor --expect exists at that revision, so the CLI exits 2 on the
 *        unknown flag — which satisfies both `code !== 3` and "no 'failed to probe'".
 *   R2-1 'a marker inside a fence suppresses nothing'                              b0dc51f6^
 *   R2-1 'what suppressed and what is reported are the same list'                  b0dc51f6^
 *   R2-1 'the widened alphabet still binds rule and region for a suffixed marker'  b0dc51f6^
 *   V2   'a SKILL.md is both registry and source, and its marker is reported once' b0dc51f6^
 *   V3   'the real top-level return stays visible after an interpolated template'  cef7ad75^
 *        The interpolation defect that commit is named for does not reach this fixture.
 *   V4   'the depth cursor stays correct across many arrows in one file'           cef7ad75^
 *   V6   'an arrow is not a module return — measured, not assumed'                 e3f36d70^
 *   V7   'a symlink cycle terminates'                                              88d87502^
 *   V3-D 'end to end: a -c payload naming a missing body is a critical, not a
 *         CLEAN exit'                                                              90f23ad2^
 *   D21  'a path in a shell # comment IS checked, and says so loudly'              309766cf^
 *   D21  'a # inside a string does not blind the rest of the line'                 309766cf^
 *   D21  'an agent in a subfolder of agents/ is still an agent'                    309766cf^
 *        Non-discriminating but pinning the RIGHT answer: sub-agents discovery is recursive, so
 *        this is a case where the delta says nothing and the harness documentation decides.
 *   D22  'in-target and --agent draw the same rules for the byte-identical file'   6d242b40^
 *   D23  'the classifier and the registry test agree'                              32663497^
 *   D24  'angle + fragment destination is checked' — FIXED in this pass, see D24.  b83cd43f^
 *
 * Two blocks could not be measured the ordinary way, and neither is a silence:
 *   V3-A at 90f23ad2^ HANGS — the pre-fix walk follows the ancestor symlink and never terminates.
 *          Two of its four tests time out (>60s each), two fail; 0 of 4 survive.
 *   V3-E's own title defeats `bun test -t`: `${CLAUDE_SKILL_DIR}` is read as a regex, `$` then an
 *          invalid quantifier, so the filter selects nothing and the run reads as a pass. Re-run
 *          filtered on 'hook rule covers BOTH spellings': 2 of 3 survive, both controls (the
 *          braced form predates the commit, which widened to the UNBRACED spelling).
 *
 * D25/D26/D27 were swept against HEAD (they are uncommitted). D25's survivors are its matrix
 * controls — every 'resolvable draws nothing' and fenced row, plus the six broken-destination rows
 * for the forms b83cd43f already covered.
 *
 * WHOLE-SUITE CROSS-CHECK (the per-block sweep above picks the revision per block; this one uses a
 * single floor). Ran all 331 against dc426eff — the oldest probe in this arc, 32KB, 2026-08-07
 * 01:03 — via `--reporter=junit`, which is the only way to get runtime names for PASSING tests:
 * grepping source test names cannot work, because a parameterized `test(\`${f.name} …\`)` never
 * matches its expanded name and every such row reads as a false survivor.
 *
 *   75 of 341 pass against that floor (re-measured 2026-08-08 after the fence, tilde and
 *   notes-channel changes; it was 72 of 331). RE-RUN THIS WHENEVER THE SUITE GROWS — a stale count
 *   is the same vacuous reassurance the sweep exists to catch.
 *
 * Every one is a NEGATIVE CONTROL — 'is still clean', 'is not treated as', 'still draws', 'does not
 * crash'. Those cannot discriminate by construction: they assert an absence or an unchanged
 * behaviour, so they pass against any code that never had the behaviour either. That is what a
 * control is for, and it is not the defect T7 hunts.
 *
 * The result worth stating: NO test asserting a NEW behaviour survives the floor, beyond the two
 * already labelled above (D21's agenthood control, D24's angle+fragment). So the suite's positive
 * assertions all discriminate. Its controls do not, by design, and are now labelled as controls
 * rather than counted as pins.
 */

import { describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'

import * as WcProbe from './wc-probe.ts'

// Loose alias: a missing export surfaces as one failed assertion, not a load error.
const probe: any = WcProbe

const SELF_DIR = import.meta.dir
const SKILL_DIR = dirname(SELF_DIR)

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'wc-probe-test-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

const skillMd = (name: string, body = '') =>
  ['---', `name: ${name}`, 'description: a fixture skill', '---', '', `# ${name}`, '', body, ''].join('\n')

const read = (f: string) => readFileSync(f, 'utf8')

/** Run the CLI out-of-process so the test covers main()/argv, not just runProbe(). */
function cli(args: string[]): { code: number; out: string; err: string } {
  const r = Bun.spawnSync(['bun', join(SELF_DIR, 'wc-probe.ts'), ...args])
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() }
}

// ------------------------------------------------------------------ D1

describe('D1 — the walk admits TypeScript', () => {
  test('a .ts file under the target is scanned', () => {
    const dir = fixture({ 'SKILL.md': skillMd('ts-walk'), 'scripts/a.ts': 'export const x = 1\n' })
    const result = probe.runProbe(dir)
    expect(result.filesScanned).toBe(2)
  })

  test('P5/P6/P7 actually run on a .ts file', () => {
    const dir = fixture({
      'SKILL.md': skillMd('ts-preds'),
      'scripts/a.ts': 'export const cfg = { implementWorkflow: "some-name" }\n',
    })
    const result = probe.runProbe(dir)
    expect(result.findings.some((f: any) => f.rule.startsWith('P6'))).toBe(true)
  })
})

// ------------------------------------------------------------------ D2

describe('D2 — fenced-block extraction in Markdown', () => {
  test('maskNonFenced keeps code fence interiors and preserves line geometry', () => {
    const md = ['prose here', '', '```js', 'const a = { b: 1 }', '```', '', '```', 'plain sample text', '```', ''].join('\n')
    const view = probe.maskNonFenced(md)
    expect(typeof view).toBe('string')
    expect(view.length).toBe(md.length)
    expect(view.split('\n').length).toBe(md.split('\n').length)
    expect(view).toContain('const a = { b: 1 }')
    expect(view).not.toContain('prose here')
    expect(view).not.toContain('plain sample text')
  })

  test('a fence is kept because it holds a Workflow( call, whatever its label', () => {
    const md = ['prose here', '', '```', 'Workflow("bare")', '```', ''].join('\n')
    expect(probe.maskNonFenced(md)).toContain('Workflow("bare")')
  })

  test('P7 sees a refs-less task row inside a labelled js fence', () => {
    const body = ['```js', 'Workflow({', '  tasks: [', '    { id: "t1", work: "do it", acceptance: "done" },', '  ],', '})', '```'].join('\n')
    const dir = fixture({ 'SKILL.md': skillMd('fenced', body) })
    const result = probe.runProbe(dir)
    const p7 = result.findings.filter((f: any) => f.rule.startsWith('P7'))
    expect(p7.length).toBeGreaterThan(0)
    expect(p7[0].detail).toContain('t1')
  })

  test('P7 finds the object literals in this skill’s own SKILL.md fences', () => {
    const file = join(SKILL_DIR, 'SKILL.md')
    const text = read(file)
    const view = probe.maskNonFenced(text)
    const literals = probe.findObjectLiterals(view)
    const rows = literals.filter((o: any) => probe.isTaskRow(o.keys) || probe.isLens(o.keys))
    expect(rows.length).toBeGreaterThan(0)
  })

})

// ------------------------------------------------------------------ D3 / D4 / D13

describe('D3 — P2 sees bare absolute paths', () => {
  test('a broken absolute path under a known root is a finding', () => {
    const dir = fixture({ 'SKILL.md': skillMd('bare') })
    const file = join(dir, 'SKILL.md')
    writeFileSync(file, skillMd('bare', `See ${join(dir, 'references', 'nope.md')} for details.`))
    const ctx = probe.skillContextFor(file, dir)
    const findings = probe.checkPathResolution(file, read(file), ctx, probe.parseExemptions(file, read(file)))
    expect(findings.length).toBe(1)
    expect(findings[0].detail).toContain('nope.md')
  })

  test('an absolute path that resolves is not a finding', () => {
    const dir = fixture({ 'SKILL.md': skillMd('bare-ok'), 'references/here.md': 'ok\n' })
    const file = join(dir, 'SKILL.md')
    writeFileSync(file, skillMd('bare-ok', `See ${join(dir, 'references', 'here.md')}.`))
    const ctx = probe.skillContextFor(file, dir)
    expect(probe.checkPathResolution(file, read(file), ctx, probe.parseExemptions(file, read(file)))).toEqual([])
  })

  test('a longer filename is not truncated at a known extension', () => {
    const dir = fixture({ 'SKILL.md': skillMd('suffix'), 'references/notes.md.backup': 'kept\n' })
    const file = join(dir, 'SKILL.md')
    writeFileSync(file, skillMd('suffix', `archived at ${join(dir, 'references', 'notes.md.backup')} for now.`))
    const ctx = probe.skillContextFor(file, dir)
    expect(probe.checkPathResolution(file, read(file), ctx, probe.parseExemptions(file, read(file)))).toEqual([])
  })

  test('an absolute path outside every known root is left alone', () => {
    const dir = fixture({ 'SKILL.md': skillMd('foreign', 'quoted evidence: /tmp/wc-does-not-exist-xyz/refs/a.md') })
    const file = join(dir, 'SKILL.md')
    const ctx = probe.skillContextFor(file, dir)
    expect(probe.checkPathResolution(file, read(file), ctx, probe.parseExemptions(file, read(file)))).toEqual([])
  })
})

describe('D4 — P2 glob probe', () => {
  test('a glob into a directory that does not exist is a finding', () => {
    const dir = fixture({ 'SKILL.md': skillMd('glob', 'inline: !`cat ${CLAUDE_SKILL_DIR}/no-such-dir/*.md`') })
    const file = join(dir, 'SKILL.md')
    const ctx = probe.skillContextFor(file, dir)
    const findings = probe.checkPathResolution(file, read(file), ctx, probe.parseExemptions(file, read(file)))
    expect(findings.length).toBe(1)
  })

  test('a glob into a directory that does exist is clean', () => {
    const dir = fixture({ 'SKILL.md': skillMd('glob-ok', 'inline: !`cat ${CLAUDE_SKILL_DIR}/references/*.md`'), 'references/a.md': 'x\n' })
    const file = join(dir, 'SKILL.md')
    const ctx = probe.skillContextFor(file, dir)
    expect(probe.checkPathResolution(file, read(file), ctx, probe.parseExemptions(file, read(file)))).toEqual([])
  })
})

describe('D13 — placeholder tail must be a path', () => {
  test('${CLAUDE_PLUGIN_ROOT}-in-body prose is not a path reference', () => {
    const ctx = { skillDir: '/nowhere-at-all', pluginRoot: '/nowhere-at-all' }
    const text = 'P4 flags the ${CLAUDE_PLUGIN_ROOT}-in-body anti-pattern.\n'
    expect(probe.checkPathResolution('/nowhere-at-all/SKILL.md', text, ctx, [])).toEqual([])
  })

  test('the real validate-skill-write.ts source produces no P2 finding about its own prose', () => {
    const file = join(SELF_DIR, 'validate-skill-write.ts')
    const ctx = probe.skillContextFor(file, SKILL_DIR)
    expect(probe.checkPathResolution(file, read(file), ctx, probe.parseExemptions(file, read(file)))).toEqual([])
  })
})

// ------------------------------------------------------------------ D14 / D5

describe('D14 — exemption markers are whole-line declarations', () => {
  test('a whole line marker exempts the file', () => {
    expect(probe.isPathCheckExempt('# doc\n<!-- wc-probe: ignore-paths -->\nbody\n')).toBe(true)
  })

  test('the marker embedded in a longer line does NOT exempt the file', () => {
    expect(probe.isPathCheckExempt("export const M = '<!-- wc-probe: ignore-paths -->'\n")).toBe(false)
  })

  test('wc-probe.ts does not exempt itself', () => {
    expect(probe.isPathCheckExempt(read(join(SELF_DIR, 'wc-probe.ts')))).toBe(false)
  })

  test('references/hook-reach.md is still exempt', () => {
    expect(probe.isPathCheckExempt(read(join(SKILL_DIR, 'references', 'hook-reach.md')))).toBe(true)
  })

  test('a marker inside a Markdown fence is an example, not a declaration', () => {
    const doc = ['# how to declare one', '', '```md', '<!-- wc-probe: ignore-paths -->', '```', ''].join('\n')
    expect(probe.parseExemptions('/tmp/x/doc.md', doc)).toEqual([])
    // the same line outside a fence still declares
    expect(probe.parseExemptions('/tmp/x/doc.md', '<!-- wc-probe: ignore-paths -->\n').length).toBe(1)
  })

  test('a file documenting the marker in a fence does not exempt itself', () => {
    const body = ['```md', '<!-- wc-probe: ignore-paths -->', '```', '', 'broken: ${CLAUDE_SKILL_DIR}/no-such-file.md'].join('\n')
    const dir = fixture({ 'SKILL.md': skillMd('doc-fence', body) })
    const file = join(dir, 'SKILL.md')
    const ctx = probe.skillContextFor(file, dir)
    expect(probe.checkPathResolution(file, read(file), ctx, probe.parseExemptions(file, read(file))).length).toBe(1)
  })

  test('a region marker scopes the exemption to its range', () => {
    const text = [
      'a ${CLAUDE_SKILL_DIR}/gone-a.md',
      '<!-- wc-probe: ignore-paths:start -->',
      'b ${CLAUDE_SKILL_DIR}/gone-b.md',
      '<!-- wc-probe: ignore-paths:end -->',
      'c ${CLAUDE_SKILL_DIR}/gone-c.md',
      '',
    ].join('\n')
    const dir = fixture({ 'SKILL.md': skillMd('region') })
    const file = join(dir, 'SKILL.md')
    writeFileSync(file, skillMd('region') + text)
    const ctx = probe.skillContextFor(file, dir)
    const findings = probe.checkPathResolution(file, read(file), ctx, probe.parseExemptions(file, read(file)))
    const named = findings.map((f: any) => f.detail).join(' ')
    expect(findings.length).toBe(2)
    expect(named).toContain('gone-a.md')
    expect(named).toContain('gone-c.md')
    expect(named).not.toContain('gone-b.md')
  })
})

describe('D5 — exemptions are reported in every output mode', () => {
  test('runProbe returns a structured exemption list', () => {
    const dir = fixture({ 'SKILL.md': skillMd('ex'), 'references/x.md': '<!-- wc-probe: ignore-paths -->\ncontent\n' })
    const result = probe.runProbe(dir)
    expect(Array.isArray(result.exemptions)).toBe(true)
    expect(result.exemptions.length).toBe(1)
    expect(result.exemptions[0].rule).toBe('paths')
    expect(result.exemptions[0].scope).toBe('file')
    expect(result.exemptions[0].file).toBe(join(dir, 'references', 'x.md'))
  })

  test('--json carries the exemption list', () => {
    const dir = fixture({ 'SKILL.md': skillMd('ex-json'), 'references/x.md': '<!-- wc-probe: ignore-paths -->\ncontent\n' })
    const r = cli(['--target', dir, '--json'])
    const parsed = JSON.parse(r.out)
    expect(parsed.exemptions).toBeDefined()
    expect(parsed.exemptions.length).toBe(1)
  })
})

// ------------------------------------------------------------------ D6 / D7

describe('D6/D7 — P1 is registration-driven', () => {
  const withHook = (command: string) =>
    [
      '---',
      'name: hooked',
      'description: a fixture skill with a hook',
      'hooks:',
      '  PostToolUse:',
      '    - matcher: "Write|Edit"',
      '      hooks:',
      '        - type: command',
      `          command: "${command}"`,
      '---',
      '',
      '# hooked',
      '',
    ].join('\n')

  test('a registered hook whose body is missing is a finding', () => {
    const dir = fixture({ 'SKILL.md': withHook('bun ${CLAUDE_PLUGIN_ROOT}/scripts/guard.ts') })
    const findings = probe.checkHookRegistration(dir)
    expect(findings.length).toBe(1)
    expect(findings[0].detail).toContain('guard.ts')
  })

  test('a registered hook whose body exists is clean', () => {
    const dir = fixture({
      'SKILL.md': withHook('bun ${CLAUDE_PLUGIN_ROOT}/scripts/guard.ts'),
      'scripts/guard.ts': 'process.exit(0)\n',
    })
    expect(probe.checkHookRegistration(dir)).toEqual([])
  })

  test('a hook registered in hooks.json is resolved too', () => {
    const dir = fixture({
      'SKILL.md': skillMd('json-reg'),
      'hooks.json': JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'bash ${CLAUDE_SKILL_DIR}/scripts/gone.sh' }] }] } }),
    })
    const findings = probe.checkHookRegistration(dir)
    expect(findings.length).toBe(1)
    expect(findings[0].detail).toContain('gone.sh')
  })

  test('a statusLine command is not a hook registration', () => {
    const dir = fixture({
      'SKILL.md': skillMd('statusline'),
      'settings.json': JSON.stringify({
        statusLine: { type: 'command', command: 'bun ${CLAUDE_SKILL_DIR}/scripts/no-such-line.ts' },
      }),
    })
    expect(probe.checkHookRegistration(dir)).toEqual([])
  })

  test('a hook command in the same settings.json is still checked', () => {
    const dir = fixture({
      'SKILL.md': skillMd('statusline-2'),
      'settings.json': JSON.stringify({
        statusLine: { type: 'command', command: 'bun ${CLAUDE_SKILL_DIR}/scripts/no-such-line.ts' },
        hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'bun ${CLAUDE_SKILL_DIR}/scripts/no-such-hook.ts' }] }] },
      }),
    })
    const findings = probe.checkHookRegistration(dir)
    expect(findings.length).toBe(1)
    expect(findings[0].detail).toContain('no-such-hook.ts')
  })

  test('a non-hook script under scripts/ registers nothing and is not a finding', () => {
    const dir = fixture({ 'SKILL.md': skillMd('plain'), 'scripts/probe.ts': 'export const x = 1\n' })
    expect(probe.checkHookRegistration(dir)).toEqual([])
  })

  test('a prose mention of a basename does not count as registration', () => {
    const dir = fixture({
      'SKILL.md': withHook('bun ${CLAUDE_PLUGIN_ROOT}/scripts/guard.ts') + '\nDo NOT use guard.ts; it was deleted from the hook config.\n',
    })
    const findings = probe.checkHookRegistration(dir)
    expect(findings.length).toBe(1)
  })

  test('this skill’s own registered hook resolves', () => {
    expect(probe.checkHookRegistration(SKILL_DIR)).toEqual([])
  })
})

// ------------------------------------------------------------------ D8

describe('D8 — P3 requires the load-bearing frontmatter keys', () => {
  test('frontmatter without description is a critical finding', () => {
    const findings = probe.checkFrontmatter('/tmp/x/SKILL.md', '---\nname: only-a-name\n---\n\nbody\n')
    expect(findings.some((f: any) => /description/.test(f.detail) && f.severity === 'critical')).toBe(true)
  })

  test('frontmatter without name is a critical finding', () => {
    const findings = probe.checkFrontmatter('/tmp/x/SKILL.md', '---\ndescription: only a description\n---\n\nbody\n')
    expect(findings.some((f: any) => /\bname\b/.test(f.detail) && f.severity === 'critical')).toBe(true)
  })

  test('frontmatter with both is clean', () => {
    expect(probe.checkFrontmatter('/tmp/x/SKILL.md', '---\nname: n\ndescription: d\n---\n\nbody\n')).toEqual([])
  })
})

// ------------------------------------------------------------------ D9

describe('D9 — coverage is accounted for, not swallowed', () => {
  test('an unreadable source file is a named skip and a finding', () => {
    const dir = fixture({ 'SKILL.md': skillMd('cover'), 'references/locked.md': 'secret\n' })
    const locked = join(dir, 'references', 'locked.md')
    chmodSync(locked, 0o000)
    const result = probe.runProbe(dir)
    chmodSync(locked, 0o644)
    expect(result.filesEligible).toBe(2)
    expect(result.filesScanned).toBe(1)
    expect(result.filesSkipped).toContain(locked)
    expect(result.findings.some((f: any) => f.file === locked)).toBe(true)
  })

  test('filesEligible equals filesScanned on a healthy tree', () => {
    const dir = fixture({ 'SKILL.md': skillMd('healthy'), 'references/a.md': 'x\n' })
    const result = probe.runProbe(dir)
    expect(result.filesEligible).toBe(result.filesScanned)
    expect(result.filesSkipped).toEqual([])
  })
})

// ------------------------------------------------------------------ D10 / D15

describe('D10 — P5 has no vacuous empty-set pass', () => {
  test('documented return keys with no return literal at all are findings', () => {
    const src = '// returns {alpha, beta}\nexport function f(): void { }\n'
    const findings = probe.checkReturnShapeDrift('/tmp/x/a.ts', src, { exemptions: [] })
    expect(findings.length).toBe(2)
    expect(findings.map((f: any) => f.detail).join(' ')).toContain('alpha')
  })

  test('documented keys that match an actual return are clean', () => {
    const src = '// returns {alpha, beta}\nexport function f() { return { alpha: 1, beta: 2 } }\n'
    expect(probe.checkReturnShapeDrift('/tmp/x/a.ts', src, { exemptions: [] })).toEqual([])
  })
})

describe('D15 — the probe is clean on its own source', () => {
  test('P5 reports nothing on wc-probe.ts', () => {
    const self = join(SELF_DIR, 'wc-probe.ts')
    expect(probe.checkReturnShapeDrift(self, read(self), { exemptions: [] })).toEqual([])
  })
})

// ------------------------------------------------------------------ D11

describe('D11 — P6 reports what it actually found', () => {
  test('a path-valued implementWorkflow is not called a bare name', () => {
    const findings = probe.checkBareWorkflowRefs('/tmp/x/a.js', 'const o = { implementWorkflow: "/abs/path/w.js" }\n', [])
    expect(findings.length).toBe(1)
    expect(findings[0].detail).toContain('/abs/path/w.js')
    expect(findings[0].detail).not.toMatch(/bare string/)
  })

  test('a genuinely bare name is still called a bare name', () => {
    const findings = probe.checkBareWorkflowRefs('/tmp/x/a.js', 'const o = { implementWorkflow: "my-workflow" }\n', [])
    expect(findings.length).toBe(1)
    expect(findings[0].detail).toMatch(/bare/)
  })

  // The OBJECT form. Both string patterns require a quote after the colon/paren, so the exact
  // spelling the doctrine calls the canonical wrong move exited 0.
  test('Workflow({name: "x"}) is flagged', () => {
    const findings = probe.checkBareWorkflowRefs('/tmp/x/a.js', 'Workflow({name: "x"})\n', [])
    expect(findings.length).toBe(1)
    expect(findings[0].rule).toBe('P6 bare-name workflow refs')
    expect(findings[0].detail).toContain('"x"')
    expect(findings[0].detail).toContain('no scriptPath')
  })

  test('implementWorkflow: {name: "x"} is flagged — the sibling site, same defect', () => {
    const findings = probe.checkBareWorkflowRefs('/tmp/x/a.js', 'const o = { implementWorkflow: {name: "x"} }\n', [])
    expect(findings.length).toBe(1)
    expect(findings[0].detail).toContain('implementWorkflow')
    expect(findings[0].detail).toContain('"x"')
  })

  test('verifyWorkflow: {name: "x"} is flagged — the third site', () => {
    const findings = probe.checkBareWorkflowRefs('/tmp/x/a.js', 'const o = { verifyWorkflow: {name: "x"} }\n', [])
    expect(findings.length).toBe(1)
    expect(findings[0].detail).toContain('verifyWorkflow')
  })

  // The NEGATIVES the object pattern must not break. Nothing pinned these before.
  test('Workflow({scriptPath: "..."}) produces no finding', () => {
    expect(probe.checkBareWorkflowRefs('/tmp/x/a.js', 'Workflow({scriptPath: "/tmp/w.js"})\n', [])).toEqual([])
  })

  test('name AND scriptPath together produce no finding', () => {
    const src = 'Workflow({name: "x", scriptPath: "/tmp/w.js"})\n'
    expect(probe.checkBareWorkflowRefs('/tmp/x/a.js', src, [])).toEqual([])
  })

  test('implementWorkflow: {scriptPath: "..."} produces no finding', () => {
    const src = 'const o = { implementWorkflow: {scriptPath: "/tmp/w.js"} }\n'
    expect(probe.checkBareWorkflowRefs('/tmp/x/a.js', src, [])).toEqual([])
  })

  // SHORTHAND. `flagObject` originally called `objectTopLevelKeys` without `includeShorthand`, so a
  // shorthand key was counted as no key at all — and that broke the check in BOTH directions at
  // once. These four pin each direction separately, because a single test over `{name, scriptPath}`
  // passes under the bug too: with neither key counted, the object is skipped before the scriptPath
  // bail-out is ever reached, so it looks correct for the wrong reason.
  test('a shorthand scriptPath is seen, so a correct call is not flagged', () => {
    const src = 'const scriptPath = "/tmp/w.js"\nWorkflow({name: "x", scriptPath})\n'
    expect(probe.checkBareWorkflowRefs('/tmp/x/a.js', src, [])).toEqual([])
  })

  test('both keys shorthand produces no finding', () => {
    expect(probe.checkBareWorkflowRefs('/tmp/x/a.js', 'Workflow({name, scriptPath})\n', [])).toEqual([])
  })

  test('Workflow({name}) in pure shorthand IS flagged — the paradigm violation', () => {
    const findings = probe.checkBareWorkflowRefs('/tmp/x/a.js', 'const name = "x"\nWorkflow({name})\n', [])
    expect(findings.length).toBe(1)
    expect(findings[0].rule).toBe('P6 bare-name workflow refs')
    expect(findings[0].detail).toContain('no scriptPath')
  })

  test('implementWorkflow: {name} in shorthand is flagged — the sibling site', () => {
    const findings = probe.checkBareWorkflowRefs('/tmp/x/a.js', 'const o = { implementWorkflow: {name} }\n', [])
    expect(findings.length).toBe(1)
    expect(findings[0].detail).toContain('implementWorkflow')
  })

  // A nested `name` belongs to the nested object, not to the call — `objectTopLevelKeys` is what
  // keeps this clean, and this pins that it stays so.
  test('a name nested under args does not flag a correct call', () => {
    const src = 'Workflow({scriptPath: "/tmp/w.js", args: {name: "x", tasks: []}})\n'
    expect(probe.checkBareWorkflowRefs('/tmp/x/a.js', src, [])).toEqual([])
  })

  test('the object form is exemptible like the string form', () => {
    const text = '// <!-- wc-probe: ignore-workflow-refs -->\nWorkflow({name: "x"})\n'
    const exemptions = probe.parseExemptions('/tmp/x/a.js', text)
    expect(probe.checkBareWorkflowRefs('/tmp/x/a.js', text, exemptions)).toEqual([])
  })
})

// ------------------------------------------------------------------ D12

describe('D12 — write-time and gate-time agree', () => {
  const hookSkill = [
    '---',
    'name: ctx',
    'description: a fixture skill whose hook uses the plugin-root placeholder',
    'hooks:',
    '  PostToolUse:',
    '    - matcher: "Write"',
    '      hooks:',
    '        - type: command',
    '          command: "bash ${CLAUDE_PLUGIN_ROOT}/scripts/guard.sh"',
    '---',
    '',
    '# ctx',
    '',
  ].join('\n')

  test('skillContextFor resolves the same pluginRoot from either caller', () => {
    const dir = fixture({ 'SKILL.md': hookSkill, 'scripts/guard.sh': 'exit 0\n' })
    const file = join(dir, 'SKILL.md')
    const gate = probe.skillContextFor(file, dir)
    const write = probe.skillContextFor(file, sep)
    expect(write.skillDir).toBe(gate.skillDir)
    expect(write.pluginRoot).toBe(gate.pluginRoot)
    expect(write.pluginRoot).toBe(dir)
  })

  test('P2 returns identical verdicts write-time and gate-time', () => {
    const dir = fixture({ 'SKILL.md': hookSkill, 'scripts/guard.sh': 'exit 0\n' })
    const file = join(dir, 'SKILL.md')
    const text = read(file)
    const gate = probe.checkPathResolution(file, text, probe.skillContextFor(file, dir), [])
    const write = probe.checkPathResolution(file, text, probe.skillContextFor(file, sep), [])
    expect(write).toEqual(gate)
    expect(write).toEqual([])
  })

  test('the write-time hook emits no finding on this skill’s own SKILL.md', () => {
    const payload = JSON.stringify({ tool_input: { file_path: join(SKILL_DIR, 'SKILL.md') } })
    const r = Bun.spawnSync(['bun', join(SELF_DIR, 'validate-skill-write.ts')], { stdin: Buffer.from(payload) })
    expect(r.exitCode).toBe(0)
    // "no FINDING", not "no output". The hook emits NOT CHECKED notes now, deliberately — the gate
    // prints them and the two surfaces must not disagree about what did not run. Asserting empty
    // stdout pinned the absence of the notes channel, not the absence of findings.
    const out = r.stdout.toString().trim()
    if (out !== '') {
      expect(out).toContain('0 finding(s)')
      expect(out).not.toMatch(/\[(critical|major|minor)\]/)
    }
  })
})

// ------------------------------------------------------------------ exit codes

describe('the documented exit-code contract', () => {
  test('--help is a successful invocation, not a usage error', () => {
    const r = cli(['--help'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('usage:')
  })

  test('a bad argument exits 2', () => {
    expect(cli(['--nope']).code).toBe(2)
    expect(cli([]).code).toBe(2)
  })

  test('findings exit 1, clean exits 0', () => {
    const clean = fixture({ 'SKILL.md': skillMd('exit-clean') })
    expect(cli(['--target', clean]).code).toBe(0)
    const dirty = fixture({ 'SKILL.md': '---\nname: only\n---\n\nbody\n' })
    expect(cli(['--target', dirty]).code).toBe(1)
  })
})

// ------------------------------------------------------------------ R1-1 / R1-2

const hookedSkill = (command: string) =>
  [
    '---',
    'name: hooked-var',
    'description: a fixture skill with a hook',
    'hooks:',
    '  PostToolUse:',
    '    - matcher: "Write|Edit"',
    '      hooks:',
    '        - type: command',
    `          command: "${command}"`,
    '---',
    '',
    '# hooked-var',
    '',
  ].join('\n')

describe('R1-1 — a shell variable is unresolvable, not a broken path', () => {
  test('an unbraced $HOME token yields no finding and one reported skip', () => {
    const dir = fixture({ 'SKILL.md': hookedSkill('bash $HOME/scripts/g.sh') })
    const skips: any[] = []
    expect(probe.checkHookRegistration(dir, skips)).toEqual([])
    expect(skips.length).toBe(1)
    expect(skips[0].reason).toContain('$HOME')
  })

  test('$CLAUDE_PROJECT_DIR is unresolvable too', () => {
    const dir = fixture({ 'SKILL.md': hookedSkill('bun $CLAUDE_PROJECT_DIR/scripts/g.ts') })
    const skips: any[] = []
    expect(probe.checkHookRegistration(dir, skips)).toEqual([])
    expect(skips.length).toBe(1)
  })

  test('${CLAUDE_PLUGIN_ROOT} is still substituted and still checked', () => {
    const dir = fixture({ 'SKILL.md': hookedSkill('bash ${CLAUDE_PLUGIN_ROOT}/scripts/g.sh') })
    const findings = probe.checkHookRegistration(dir)
    expect(findings.length).toBe(1)
    expect(findings[0].detail).toContain('g.sh')
  })

  test('${CLAUDE_SKILL_DIR} in a hooks: frontmatter command is itself the finding', () => {
    // Measured in references/hook-reach.md: it does not substitute there, arrives empty, and the
    // command silently finds no script. Resolving it against the skill dir passed a hook that
    // cannot fire — even when the file it names exists.
    const dir = fixture({
      'SKILL.md': hookedSkill('bash ${CLAUDE_SKILL_DIR}/scripts/g.sh'),
      'scripts/g.sh': 'exit 0\n',
    })
    const findings = probe.checkHookRegistration(dir)
    expect(findings.length).toBe(1)
    expect(findings[0].severity).toBe('critical')
    expect(findings[0].detail).toContain('does not substitute')
  })

  test('the same placeholder in a hooks.json is NOT flagged — that context was not measured', () => {
    const dir = fixture({
      'SKILL.md': skillMd('json-ctx'),
      'hooks.json': JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'bash ${CLAUDE_SKILL_DIR}/scripts/g.sh' }] }] } }),
      'scripts/g.sh': 'exit 0\n',
    })
    expect(probe.checkHookRegistration(dir)).toEqual([])
  })

  test('runProbe surfaces the skip so no suppression is silent', () => {
    const dir = fixture({ 'SKILL.md': hookedSkill('bash $HOME/scripts/g.sh') })
    const result = probe.runProbe(dir)
    expect(result.findings.filter((f: any) => f.rule.startsWith('P1'))).toEqual([])
    expect(Array.isArray(result.unresolvedRefs)).toBe(true)
    expect(result.unresolvedRefs.length).toBe(1)
    expect(probe.formatText(result)).toContain('$HOME')
  })
})

describe('R1-2 — P5 follows a single-assignment binding to its object literal', () => {
  test('const r = {...}; return r satisfies the documented shape', () => {
    const src = '// returns {alpha, beta}\nexport function f() { const r = { alpha: 1, beta: 2 }\n  return r\n}\n'
    expect(probe.checkReturnShapeDrift('/tmp/x/a.ts', src, { exemptions: [] })).toEqual([])
  })

  test('a documented key genuinely absent from the binding is still flagged', () => {
    const src = '// returns {alpha, beta, gamma}\nexport function f() { const r = { alpha: 1, beta: 2 }\n  return r\n}\n'
    const findings = probe.checkReturnShapeDrift('/tmp/x/a.ts', src, { exemptions: [] })
    expect(findings.length).toBe(1)
    expect(findings[0].detail).toContain('gamma')
  })

  test('a reassigned binding is not followed', () => {
    const src = '// returns {alpha}\nexport function f() { let r = { alpha: 1 }\n  r = other()\n  return r\n}\n'
    expect(probe.checkReturnShapeDrift('/tmp/x/a.ts', src, { exemptions: [] }).length).toBe(1)
  })
})

// ------------------------------------------------------------------ R2-1 exemption threading

const refslessRow = ['```js', 'Workflow({', '  tasks: [', '    { id: "t1", work: "do it", acceptance: "done" },', '  ],', '})', '```'].join('\n')

describe('R2-1 — exemptions are parsed once, from raw', () => {
  test('a marker inside a fence suppresses nothing', () => {
    const body = ['```md', '<!-- wc-probe: ignore-refs -->', '```', '', refslessRow].join('\n')
    const dir = fixture({ 'SKILL.md': skillMd('fenced-marker', body) })
    const result = probe.runProbe(dir)
    expect(result.exemptions).toEqual([])
    expect(result.findings.filter((f: any) => f.rule.startsWith('P7')).length).toBeGreaterThan(0)
  })

  test('what suppressed and what is reported are the same list', () => {
    const body = ['<!-- wc-probe: ignore-refs -->', '', refslessRow].join('\n')
    const dir = fixture({ 'SKILL.md': skillMd('real-marker', body) })
    const result = probe.runProbe(dir)
    expect(result.exemptions.length).toBe(1)
    expect(result.findings.filter((f: any) => f.rule.startsWith('P7'))).toEqual([])
  })

  test('a misspelled rule name is refused, not silently accepted', () => {
    const dir = fixture({ 'SKILL.md': skillMd('typo', '<!-- wc-probe: ignore-reffs -->') })
    const result = probe.runProbe(dir)
    const f = result.findings.filter((x: any) => /exemption/i.test(x.rule))
    expect(f.length).toBe(1)
    expect(f[0].detail).toContain('ignore-reffs')
  })

  test('every known rule name is accepted', () => {
    for (const rule of probe.KNOWN_EXEMPTION_RULES) {
      const dir = fixture({ 'SKILL.md': skillMd(`ok-${rule}`, `<!-- wc-probe: ignore-${rule} -->`) })
      const result = probe.runProbe(dir)
      expect(result.findings.filter((x: any) => /exemption/i.test(x.rule))).toEqual([])
    }
  })

  test('a name outside the vocabulary is parsed and then rejected, in both channels', () => {
    // `ignore-P5` is the spelling SKILL.md's own P2/P5/P9 naming invites. It must not fall through
    // the line match: an unparsed marker is invisible in `exemptions` AND in `findings`.
    for (const name of ['P5', 'Paths', 'p5']) {
      const dir = fixture({ 'SKILL.md': skillMd(`vocab-${name}`, `<!-- wc-probe: ignore-${name} -->`) })
      const result = probe.runProbe(dir)
      const f = result.findings.filter((x: any) => x.rule === 'P9 exemption vocabulary')
      expect(f.length).toBe(1)
      expect(f[0].detail).toContain(`ignore-${name}`)
      expect(result.exemptions.map((e: any) => e.rule)).toEqual([name])
    }
  })

  test('the widened alphabet still binds rule and region for a suffixed marker', () => {
    const text = ['<!-- wc-probe: ignore-paths:start -->', '<!-- wc-probe: ignore-paths:end -->', ''].join('\n')
    expect(probe.parseExemptions('/tmp/x/doc.md', text)).toEqual([
      { rule: 'paths', file: '/tmp/x/doc.md', scope: 'region', startLine: 1, endLine: 2 },
    ])
    // and a bare name whose close-comment abuts the `-` class does not swallow the delimiter
    expect(probe.parseExemptions('/tmp/x/doc.md', '<!-- wc-probe: ignore-x-->\n').map((e: any) => e.rule)).toEqual(['x'])
  })

  test('an indented Markdown marker is an example, not a declaration', () => {
    expect(probe.parseExemptions('/tmp/x/doc.md', '    <!-- wc-probe: ignore-paths -->\n')).toEqual([])
  })
})

// ------------------------------------------------------------------ R2-2 content-based fences

describe('R2-2 — a fence is code because of what it holds, not how it is labelled', () => {
  test('fenceLineMap covers fences of every info string', () => {
    const md = ['a', '```text', 'b', '```', 'c', '```', 'd', '```', 'e', ''].join('\n')
    const map = probe.fenceLineMap(md)
    expect(map[1]).toBe(false) // a
    expect(map[3]).toBe(true) // b, inside ```text
    expect(map[5]).toBe(false) // c
    expect(map[7]).toBe(true) // d, inside a bare fence
    expect(map[9]).toBe(false) // e
  })

  test('P6 fires inside a bare fence', () => {
    const body = ['```', 'Workflow("bare-name")', '```'].join('\n')
    const dir = fixture({ 'SKILL.md': skillMd('bare-fence', body) })
    const result = probe.runProbe(dir)
    expect(result.findings.some((f: any) => f.rule.startsWith('P6'))).toBe(true)
  })

  test('P6 fires inside a `text` fence', () => {
    const body = ['```text', 'Workflow("bare-name")', '```'].join('\n')
    const dir = fixture({ 'SKILL.md': skillMd('text-fence', body) })
    const result = probe.runProbe(dir)
    expect(result.findings.some((f: any) => f.rule.startsWith('P6'))).toBe(true)
  })

  test('P7 fires on a task row inside a bare fence', () => {
    const body = ['```', 'Workflow({ tasks: [{ id: "t9", work: "w", acceptance: "a" }] })', '```'].join('\n')
    const dir = fixture({ 'SKILL.md': skillMd('bare-row', body) })
    const result = probe.runProbe(dir)
    expect(result.findings.some((f: any) => f.rule.startsWith('P7') && f.detail.includes('t9'))).toBe(true)
  })

  test('a fence with no Workflow( call and no code label stays prose', () => {
    const body = ['```', 'const a = { id: "t1", work: "w" }', '```'].join('\n')
    const dir = fixture({ 'SKILL.md': skillMd('prose-fence', body) })
    const result = probe.runProbe(dir)
    expect(result.findings.filter((f: any) => f.rule.startsWith('P7'))).toEqual([])
  })

  test('no P8 fence-labelling rule remains', () => {
    expect(probe.checkFenceLabels).toBeUndefined()
    const body = ['```', 'Workflow({ scriptPath: "/tmp/x.js" })', '```'].join('\n')
    const dir = fixture({ 'SKILL.md': skillMd('no-p8', body) })
    const result = probe.runProbe(dir)
    expect(result.findings.filter((f: any) => f.rule.startsWith('P8'))).toEqual([])
  })
})

// ------------------------------------------------------------------ R2-3 P5 discriminator

describe('R2-3 — P5 tells prose from code by file type', () => {
  test('the code-span form the corpus actually writes is parsed', () => {
    const md = 'It returns `{ workflow, planPath,\nverdict }`. Render the gate.\n'
    const shapes = probe.documentedShapes(md, true)
    expect(shapes.length).toBe(1)
    expect(shapes[0].keys).toEqual(['workflow', 'planPath', 'verdict'])
  })

  test('a shape inside a fence of any info string is sample output, not a contract', () => {
    for (const info of ['', 'text', 'js', 'json']) {
      const md = ['prose', '```' + info, 'returns { a, b }', '```', ''].join('\n')
      expect(probe.documentedShapes(md, true)).toEqual([])
    }
  })

  test('a shape whose braces straddle a fence boundary is refused', () => {
    const md = ['returns {', '```', 'a, b }', '```', ''].join('\n')
    expect(probe.documentedShapes(md, true)).toEqual([])
  })

  test('in a code file, prose is prose and code is code', () => {
    const src = '// returns {alpha, beta}\nexport function f() { return { alpha: 1, beta: 2 } }\n'
    const shapes = probe.documentedShapes(src, false)
    expect(shapes.length).toBe(1)
    expect(shapes[0].keys).toEqual(['alpha', 'beta'])
  })

  test('exhaustiveness is recorded, not guessed', () => {
    expect(probe.documentedShapes('returns `{ a, b }`\n', true)[0].exhaustive).toBe(true)
    expect(probe.documentedShapes('returns `{ a, b, ... }`\n', true)[0].exhaustive).toBe(false)
    expect(probe.documentedShapes('returns `{ a, b, etc }`\n', true)[0].exhaustive).toBe(false)
    expect(probe.documentedShapes('returns `{ a, b: number }`\n', true)[0].exhaustive).toBe(true)
  })

  test('a partial annotation with no braces is not a shape at all', () => {
    expect(probe.documentedShapes('It returns the verdict and the score table.\n', true)).toEqual([])
  })
})

// ------------------------------------------------------------------ R2-4 resolving the reference

describe('R2-4 — the scriptPath a Markdown file names', () => {
  const ctx = { skillDir: '/nowhere', pluginRoot: '/nowhere' }

  test('findScriptPathRefs reads raw text, fences included', () => {
    const md = ['```', 'Workflow({ scriptPath: "/tmp/a.js" })', '```', 'and `scriptPath: "/tmp/b.js"`', ''].join('\n')
    const refs = probe.findScriptPathRefs(md)
    expect(refs.map((r: any) => r.raw)).toEqual(['/tmp/a.js', '/tmp/b.js'])
    expect(refs[0].line).toBe(2)
  })

  test('a prose placeholder is classified first, before any variable test', () => {
    expect(probe.resolveScriptTarget('<absolute path>.js', '/tmp', ctx).kind).toBe('placeholder')
    expect(probe.resolveScriptTarget('${genDir}/<name>.js', '/tmp', ctx).kind).toBe('placeholder')
  })

  test('an unsubstituted variable is its own kind', () => {
    expect(probe.resolveScriptTarget('${genDir}/w.js', '/tmp', ctx).kind).toBe('unsubstituted')
    expect(probe.resolveScriptTarget('$HOME/w.js', '/tmp', ctx).kind).toBe('unsubstituted')
  })

  test('an existing file resolves and a missing one does not', () => {
    const dir = fixture({ 'w.js': 'return { a: 1 }\n' })
    const c = { skillDir: dir, pluginRoot: dir }
    const ok = probe.resolveScriptTarget('${CLAUDE_SKILL_DIR}/w.js', dir, c)
    expect(ok.kind).toBe('resolved')
    expect(ok.path).toBe(join(dir, 'w.js'))
    expect(probe.resolveScriptTarget('${CLAUDE_SKILL_DIR}/gone.js', dir, c).kind).toBe('missing')
  })

  test('a bare Workflow name is not resolved to a path', () => {
    expect(probe.findScriptPathRefs('Workflow({ name: "work" })')).toEqual([])
  })
})

// ------------------------------------------------------------------ R2-5 the contract return

describe('R2-5 — the contract return is the one at indentation zero', () => {
  test('a helper’s indented return is excluded', () => {
    const src = ['function h() {', '  return { lens: 1 }', '}', '', 'return {', '  a: 1,', '  b: 2,', '}', ''].join('\n')
    const c = probe.contractReturn(src)
    expect(c.returns).toBe(1)
    expect(c.keys.sort()).toEqual(['a', 'b'])
    expect(c.topLevelSpread).toBe(false)
  })

  test('a spread nested inside a value is not a top-level spread', () => {
    const src = ['return {', '  carriedForward: [...CARRIED.keys()],', '  b: 2,', '}', ''].join('\n')
    const c = probe.contractReturn(src)
    expect(c.topLevelSpread).toBe(false)
    expect(c.keys.sort()).toEqual(['b', 'carriedForward'])
  })

  test('a genuine top-level spread is seen', () => {
    const c = probe.contractReturn('return {\n  ...base,\n  b: 2,\n}\n')
    expect(c.topLevelSpread).toBe(true)
  })

  test('two top-level returns are counted, not merged silently', () => {
    const c = probe.contractReturn('if (x) {\n}\nreturn { a: 1 }\nreturn { b: 2 }\n')
    expect(c.returns).toBe(2)
    expect(c.keys.sort()).toEqual(['a', 'b'])
  })

  test('shorthand properties are contract keys, and their VALUES are not', () => {
    const c = probe.contractReturn('const x = 1\nreturn {\n  workflow: WORKFLOW,\n  overallPass,\n  verdict,\n  findings: surviving,\n}\n')
    expect(c.keys).toEqual(['findings', 'overallPass', 'verdict', 'workflow'])
  })

  test('a documented shape sketch is still not a task row', () => {
    // `{ id, name, work }` is how a document sketches a shape; counting shorthand there would turn
    // every sketch into a task row P7 then demands refs from.
    const lits = probe.findObjectLiterals('const t = { id, name, work, acceptance }\n')
    expect(lits.some((o: any) => probe.isTaskRow(o.keys))).toBe(false)
  })

  test('no top-level return at all is representable', () => {
    expect(probe.contractReturn('function f() {\n  return { a: 1 }\n}\n').returns).toBe(0)
  })
})

// ------------------------------------------------------------------ R2-6 both directions, cross-file

/** A skill whose SKILL.md documents a shape and names the script that implements it. */
function crossFileFixture(documented: string, contract: string): { dir: string; skill: string } {
  const body = [
    'It returns `' + documented + '`. Render the gate.',
    '',
    '```',
    'Workflow({',
    '  scriptPath: "${CLAUDE_SKILL_DIR}/w.js",',
    '  args: {},',
    '})',
    '```',
    '',
  ].join('\n')
  const dir = fixture({ 'SKILL.md': skillMd('cross', body), 'w.js': contract })
  return { dir, skill: join(dir, 'SKILL.md') }
}

describe('R2-6 — P5 follows the reference across files, both directions', () => {
  test('direction B: a contract key the docs never mention is named', () => {
    const { dir } = crossFileFixture('{ a, b }', 'return {\n  a: 1,\n  b: 2,\n  domainRun: 3,\n  domainVerify: 4,\n}\n')
    const result = probe.runProbe(dir)
    const p5 = result.findings.filter((f: any) => f.rule.startsWith('P5'))
    expect(p5.length).toBe(1)
    expect(p5[0].severity).toBe('major')
    expect(p5[0].detail).toContain('domainRun')
    expect(p5[0].detail).toContain('domainVerify')
  })

  test('direction A: a documented key the contract does not implement is named', () => {
    const { dir } = crossFileFixture('{ a, b, ghost }', 'return {\n  a: 1,\n  b: 2,\n}\n')
    const result = probe.runProbe(dir)
    const p5 = result.findings.filter((f: any) => f.rule.startsWith('P5'))
    expect(p5.some((f: any) => f.detail.includes('ghost'))).toBe(true)
  })

  test('an agreeing pair is clean', () => {
    const { dir } = crossFileFixture('{ a, b }', 'return {\n  a: 1,\n  b: 2,\n}\n')
    const result = probe.runProbe(dir)
    expect(result.findings.filter((f: any) => f.rule.startsWith('P5'))).toEqual([])
  })

  test('a non-exhaustive documented shape suppresses direction B only', () => {
    const { dir } = crossFileFixture('{ a, b, ... }', 'return {\n  a: 1,\n  b: 2,\n  extra: 3,\n}\n')
    const result = probe.runProbe(dir)
    expect(result.findings.filter((f: any) => f.rule.startsWith('P5'))).toEqual([])
  })

  test('a top-level spread in the contract suppresses direction B', () => {
    const { dir } = crossFileFixture('{ a, b }', 'return {\n  ...base,\n  a: 1,\n  b: 2,\n  extra: 3,\n}\n')
    const result = probe.runProbe(dir)
    expect(result.findings.filter((f: any) => f.rule.startsWith('P5') && /extra/.test(f.detail))).toEqual([])
  })

  test('every P5 finding quotes the resolved target so a mis-bind is auditable', () => {
    const { dir } = crossFileFixture('{ a, b }', 'return {\n  a: 1,\n  b: 2,\n  extra: 3,\n}\n')
    const result = probe.runProbe(dir)
    const p5 = result.findings.filter((f: any) => f.rule.startsWith('P5'))
    expect(p5.length).toBe(1)
    expect(p5[0].detail).toContain(join(dir, 'w.js'))
  })

  test('an unresolvable target is reported when the file has a parseable shape', () => {
    const body = ['It returns `{ a, b }`.', '', '```', 'Workflow({ scriptPath: "${CLAUDE_SKILL_DIR}/gone.js" })', '```', ''].join('\n')
    const dir = fixture({ 'SKILL.md': skillMd('gone-target', body) })
    const result = probe.runProbe(dir)
    expect(result.findings.some((f: any) => f.rule.startsWith('P5') && /gone\.js/.test(f.detail))).toBe(true)
  })

  test('a file with no documented shape says nothing about its target', () => {
    const body = ['```', 'Workflow({ scriptPath: "${CLAUDE_SKILL_DIR}/gone.js" })', '```', ''].join('\n')
    const dir = fixture({ 'SKILL.md': skillMd('no-shape', body) })
    const result = probe.runProbe(dir)
    expect(result.findings.filter((f: any) => f.rule.startsWith('P5'))).toEqual([])
  })
})

// ------------------------------------------------------------------ R2-7 cross-file reporting

describe('R2-7 — a read outside the target is visible', () => {
  test('crossFileTargets lists the out-of-scope file, and it is read once', () => {
    const outer = fixture({ 'w.js': 'return { a: 1, b: 2 }\n' })
    const target = fixture({
      'SKILL.md': skillMd('outside', ['It returns `{ a, b }`.', '', '```', `Workflow({ scriptPath: "${join(outer, 'w.js')}" })`, '```', ''].join('\n')),
      'other.md': ['It returns `{ a, b }`.', '', '```', `Workflow({ scriptPath: "${join(outer, 'w.js')}" })`, '```', ''].join('\n'),
    })
    const result = probe.runProbe(target)
    expect(result.crossFileTargets).toEqual([join(outer, 'w.js')])
  })

  test('a target inside --target is not reported as a cross-file read', () => {
    const { dir } = crossFileFixture('{ a, b }', 'return { a: 1, b: 2 }\n')
    expect(probe.runProbe(dir).crossFileTargets).toEqual([])
  })

  test('both output modes carry it', () => {
    const outer = fixture({ 'w.js': 'return { a: 1, b: 2 }\n' })
    const target = fixture({
      'SKILL.md': skillMd('modes', ['It returns `{ a, b }`.', '', '```', `Workflow({ scriptPath: "${join(outer, 'w.js')}" })`, '```', ''].join('\n')),
    })
    expect(probe.formatText(probe.runProbe(target))).toContain(join(outer, 'w.js'))
    const parsed = JSON.parse(cli(['--target', target, '--json']).out)
    expect(parsed.crossFileTargets).toEqual([join(outer, 'w.js')])
  })
})

// ------------------------------------------------------------------ V1 (independent verification)

describe('V1 — the same-file P5 path sees every form of returned key', () => {
  test('shorthand keys in a return literal are implemented, not missing', () => {
    const src = '// returns {alpha, beta, gamma}\nexport function f() { return { alpha: 1, beta, gamma } }\n'
    expect(probe.checkReturnShapeDrift('/tmp/x/a.ts', src, { exemptions: [] })).toEqual([])
  })

  test('shorthand keys behind a single-assignment binding count too', () => {
    const src = '// returns {alpha, beta}\nexport function f() { const r = { alpha, beta }\n  return r\n}\n'
    expect(probe.checkReturnShapeDrift('/tmp/x/a.ts', src, { exemptions: [] })).toEqual([])
  })

  test('an arrow with an implicit object return is a return literal', () => {
    const src = '/** Returns {overallPass, verdict, findings}. */\nexport const build = () => ({ overallPass: 1, verdict, findings: [] })\n'
    expect(probe.checkReturnShapeDrift('/tmp/x/a.ts', src, { exemptions: [] })).toEqual([])
  })

  test('a key that really is absent is still flagged through every form', () => {
    const src = '// returns {alpha, ghost}\nexport const f = () => ({ alpha })\n'
    const findings = probe.checkReturnShapeDrift('/tmp/x/a.ts', src, { exemptions: [] })
    expect(findings.length).toBe(1)
    expect(findings[0].detail).toContain('ghost')
  })
})

describe('V2 — an exemption in a hook registry is honoured AND reported', () => {
  const hooksJson = (command: string) =>
    JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ type: 'command', command }] }] } }, null, 2)

  test('without a marker, the missing hook body is a critical finding', () => {
    const dir = fixture({ 'SKILL.md': skillMd('reg'), 'hooks.json': hooksJson('bash ${CLAUDE_SKILL_DIR}/scripts/gone.sh') })
    const result = probe.runProbe(dir)
    expect(result.findings.filter((f: any) => f.rule.startsWith('P1')).length).toBe(1)
  })

  test('with a marker, the suppression is applied and VISIBLE in both modes', () => {
    const dir = fixture({
      'SKILL.md': skillMd('reg-ex'),
      'hooks.json': '// <!-- wc-probe: ignore-hooks -->\n' + hooksJson('bash ${CLAUDE_SKILL_DIR}/scripts/gone.sh'),
    })
    const result = probe.runProbe(dir)
    expect(result.findings.filter((f: any) => f.rule.startsWith('P1'))).toEqual([])
    // .json is not an eligible SOURCE file, so this is the only path by which the marker can be seen.
    const fromJson = result.exemptions.filter((e: any) => e.file === join(dir, 'hooks.json'))
    expect(fromJson.length).toBe(1)
    expect(fromJson[0].rule).toBe('hooks')
    expect(probe.formatText(result)).toContain('hooks.json')
    expect(JSON.parse(cli(['--target', dir, '--json']).out).exemptions.some((e: any) => /hooks\.json$/.test(e.file))).toBe(true)
  })

  test('a misspelled rule in a registry gets a P9, not a silent no-op', () => {
    const dir = fixture({
      'SKILL.md': skillMd('reg-typo'),
      'hooks.json': '// <!-- wc-probe: ignore-hook -->\n' + hooksJson('bash ${CLAUDE_SKILL_DIR}/scripts/gone.sh'),
    })
    const result = probe.runProbe(dir)
    expect(result.findings.some((f: any) => f.rule.startsWith('P9'))).toBe(true)
    expect(result.findings.filter((f: any) => f.rule.startsWith('P1')).length).toBe(1) // still not suppressed
  })

  test('a SKILL.md is both registry and source, and its marker is reported once', () => {
    const dir = fixture({ 'SKILL.md': skillMd('dup', '<!-- wc-probe: ignore-refs -->') })
    const result = probe.runProbe(dir)
    expect(result.exemptions.filter((e: any) => e.file === join(dir, 'SKILL.md')).length).toBe(1)
  })
})

// ------------------------------------------------------------------ V3 / V4 (second verification)

describe('V3 — maskLiterals tracks ${…} interpolation', () => {
  test('a nested template inside an interpolation does not close the outer one', () => {
    const m = probe.maskLiterals('const p = `a ${c ? `X` : `Y`} b`\nreturn { alpha: 1 }\n')
    // interpolation CODE survives; template TEXT is blanked; the file does not desync after it
    expect(m).toContain('${c ? ')
    expect(m).not.toContain('X')
    expect(m).toContain('return { alpha: 1 }')
  })

  test('interpolation containing an object literal and a deeper template', () => {
    const m = probe.maskLiterals('const p = `x ${o.f({k: `deep ${z}`})} y`\nreturn { beta: 2 }\n')
    expect(m).toContain('o.f({k: ')
    expect(m).toContain('${z}')
    expect(m).not.toContain('deep')
    expect(m).toContain('return { beta: 2 }')
  })

  test('the real top-level return stays visible after an interpolated template', () => {
    const src = 'const q = `${a ? `p` : `q`}`\nfunction h(){ return { inner: 1 } }\nreturn { alpha: 1, beta: 2 }\n'
    const c = probe.contractReturn(src)
    expect(c.returns).toBe(1)
    expect(c.keys).toEqual(['alpha', 'beta'])
  })

  test('a plain template still has its text blanked', () => {
    expect(probe.maskLiterals('const p = `plain`\n')).toBe('const p = `     `\n')
  })

  test('an unterminated template does not throw or bleed a brace', () => {
    expect(() => probe.maskLiterals('const p = `a ${b\n')).not.toThrow()
  })
})

describe('V5 — in code, an annotation lives in a comment, not a string', () => {
  test('a line comment still documents a shape', () => {
    expect(probe.documentedShapes('// returns {alpha, beta}\nexport function f(){}\n', false).length).toBe(1)
  })

  test('a block comment still documents a shape', () => {
    expect(probe.documentedShapes('/** Returns {alpha, beta}. */\nexport function f(){}\n', false).length).toBe(1)
  })

  test('a return inside a template literal is emitted code, not an annotation', () => {
    // The generator case: the shape belongs to the script this file writes out.
    const src = ['const source = `', 'return {', '  planFile: PLAN_FILE,', '  overallPass: true,', '}', '`', 'return { path, source }', ''].join('\n')
    expect(probe.documentedShapes(src, false)).toEqual([])
    expect(probe.checkReturnShapeDrift('/tmp/x/emit.ts', src, { exemptions: [] })).toEqual([])
  })

  test('a return inside a plain string is not an annotation either', () => {
    expect(probe.documentedShapes('const s = "returns {alpha, beta}"\n', false)).toEqual([])
  })

  test('scanLiterals reports comment and string blanks distinctly', () => {
    const s = probe.scanLiterals('// c\nconst x = "s"\n')
    expect(s.comment[0]).toBe(1) // inside the comment
    expect(s.comment[16]).toBe(0) // inside the string
    expect(s.masked).toBe(probe.maskLiterals('// c\nconst x = "s"\n'))
  })
})

describe('V4 — an arrow inside a call argument is not the enclosing return', () => {
  test('a map callback does not supply the documented keys', () => {
    const src = [
      '/** Returns {overallPass, verdict}. */',
      'export function run(){',
      '  const rows = items.map(x => ({ overallPass: x.ok, verdict: x.v }))',
      '  return { rows }',
      '}',
      '',
    ].join('\n')
    const findings = probe.checkReturnShapeDrift('/tmp/x/a.ts', src, { exemptions: [] })
    expect(findings.length).toBe(2)
    expect(findings.map((f: any) => f.detail).join(' ')).toContain('overallPass')
  })

  test('the BLOCK-body twin of the map callback is caught too', () => {
    // Gating only the concise-arrow form left `=> { return {…} }` reproducing the defect verbatim.
    const src = [
      '/** Returns {overallPass, verdict}. */',
      'export function run(){',
      '  const rows = items.map(x => { return { overallPass: x.ok, verdict: x.v } })',
      '  return { rows }',
      '}',
      '',
    ].join('\n')
    const f = probe.checkReturnShapeDrift('/tmp/x/a.ts', src, { exemptions: [] })
    expect(f.length).toBe(2)
    expect(f[0].detail).toContain('only from a nested callback')
  })

  test('a return-a-binding inside a callback is nested too', () => {
    const src = [
      '/** Returns {overallPass}. */',
      'export function run(){',
      '  const rows = items.map(x => { const r = { overallPass: 1 }\n    return r\n  })',
      '  return { rows }',
      '}',
      '',
    ].join('\n')
    expect(probe.checkReturnShapeDrift('/tmp/x/a.ts', src, { exemptions: [] }).length).toBe(1)
  })

  test('a file whose value is produced indirectly is not called empty', () => {
    // Dropping nested returns outright made this report "contains no return {...} literal at all".
    const src = '/** Returns {overallPass, verdict}. */\nexport default defineWorkflow(() => ({ overallPass: 1, verdict: 2 }))\n'
    expect(probe.checkReturnShapeDrift('/tmp/x/a.ts', src, { exemptions: [] })).toEqual([])
  })

  test('a module-level exported arrow still counts', () => {
    const src = '/** Returns {overallPass, verdict}. */\nexport const build = () => ({ overallPass: 1, verdict: "x" })\n'
    expect(probe.checkReturnShapeDrift('/tmp/x/a.ts', src, { exemptions: [] })).toEqual([])
  })

  test('the depth cursor stays correct across many arrows in one file', () => {
    // Carrying depth forward across matches is what makes this linear; a cursor that drifts would
    // mis-classify every arrow after the first.
    const src = [
      '/** Returns {kept}. */',
      'const a = xs.map(x => ({ dropped1: 1 }))',
      'const b = ys.filter(y => ({ dropped2: 2 }))',
      'export const c = () => ({ kept: 3 })',
      'const d = zs.map(z => ({ dropped3: 4 }))',
      '',
    ].join('\n')
    expect(probe.checkReturnShapeDrift('/tmp/x/a.ts', src, { exemptions: [] })).toEqual([])
    const src2 = src.replace('{ kept: 3 }', '{ other: 3 }')
    const f = probe.checkReturnShapeDrift('/tmp/x/a.ts', src2, { exemptions: [] })
    expect(f.length).toBe(1)
    expect(f[0].detail).toContain('kept')
  })
})

// ------------------------------------------------------------------ V6 (sibling sweep)

describe('V6 — the two halves of P5 read the same return forms and the same spread test', () => {
  test('contractReturn follows a single-assignment binding, as sameFileDrift does', () => {
    const c = probe.contractReturn('const result = { overallPass: 1, verdict: 2 }\nreturn result\n')
    expect(c.returns).toBe(1)
    expect(c.keys).toEqual(['overallPass', 'verdict'])
  })

  test('a helper’s return on a line that starts in column 0 is still excluded', () => {
    // The keyword must be in column 0 — testing the LINE lets `function h(){ return {…} }` in.
    const c = probe.contractReturn('function h(){ return { inner: 1 } }\nreturn { a: 1 }\n')
    expect(c.keys).toEqual(['a'])
  })

  test('an arrow is not a module return — measured, not assumed', () => {
    // Including arrows admits top-level `const x = items.map(s => ({…}))` callbacks, which put keys
    // in the contract no caller sees. Real corpus scripts each have exactly one contract return.
    expect(probe.contractReturn('const rows = items.map(s => ({ id: 1, slides: 2 }))\nreturn { a: 1 }\n').keys).toEqual(['a'])
  })

  test('both halves agree that a spread inside a value is not a top-level spread', () => {
    const src = '// returns {alpha, beta}\nreturn {\n  carriedForward: [...C.keys()],\n  rows: 1,\n}\n'
    expect(probe.contractReturn(src).topLevelSpread).toBe(false)
    const f = probe.checkReturnShapeDrift('/tmp/x/a.ts', src, { exemptions: [] })
    expect(f.length).toBe(2)
    expect(f.map((x: any) => x.severity)).toEqual(['major', 'major']) // not downgraded to minor
  })

  test('a genuine top-level spread still downgrades', () => {
    const src = '// returns {alpha}\nreturn {\n  ...base,\n  rows: 1,\n}\n'
    expect(probe.checkReturnShapeDrift('/tmp/x/a.ts', src, { exemptions: [] })[0].severity).toBe('minor')
  })

  test('returnLiterals is the single source of the three forms', () => {
    const src = 'return { a: 1 }\nconst r = { b: 2 }\nreturn r\nconst f = () => ({ c: 3 })\n'
    const forms = probe.returnLiterals(src, probe.maskLiterals(src)).map((r: any) => r.form).sort()
    expect(forms).toEqual(['arrow', 'binding', 'literal'])
  })
})

describe('V6 — P2 reports an unresolvable variable instead of skipping in silence', () => {
  test('a ${VAR} P2 cannot resolve is announced, not dropped', () => {
    const dir = fixture({ 'SKILL.md': skillMd('p2skip', 'see ${CLAUDE_SKILL_DIR}/${VERSION}/rules.md') })
    const result = probe.runProbe(dir)
    expect(result.findings.filter((f: any) => f.rule.startsWith('P2'))).toEqual([])
    const notes = result.unresolvedRefs.filter((u: any) => u.rule.startsWith('P2'))
    expect(notes.length).toBe(1)
    expect(notes[0].reason).toContain('${VERSION}')
    expect(probe.formatText(result)).toContain('${VERSION}')
  })

  test('a resolvable placeholder is still checked', () => {
    const dir = fixture({ 'SKILL.md': skillMd('p2ok', 'see ${CLAUDE_SKILL_DIR}/gone.md') })
    const result = probe.runProbe(dir)
    expect(result.findings.filter((f: any) => f.rule.startsWith('P2')).length).toBe(1)
  })
})

describe('V6 — findKeyValueSpan agrees with objectTopLevelKeys about key vs value', () => {
  test('a ternary branch named like a key does not capture the span', () => {
    const src = 'const row = { id: "t1", prompt: flag ? refs : other, refs: ["real.md"] }\n'
    const masked = probe.maskLiterals(src)
    const obj = probe.findObjectLiterals(src)[0]
    const span = probe.findKeyValueSpan(src, masked, obj, 'refs')
    expect(src.slice(span.start, span.end)).toBe('["real.md"]')
  })
})

// ------------------------------------------------------------------ V7 (deferred backlog)

describe('V7 — the coverage floor', () => {
  test('a target with no source files is a CRITICAL, not CLEAN', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wc-empty-'))
    const result = probe.runProbe(dir)
    expect(result.filesEligible).toBe(0)
    expect(result.findings.some((f: any) => f.rule.startsWith('P0') && f.severity === 'critical')).toBe(true)
    expect(cli(['--target', dir]).code).toBe(1)
  })

  test('source files but no SKILL.md is a finding — P3/P4 never ran', () => {
    const dir = fixture({ 'scripts/a.ts': 'export const x = 1\n' })
    const result = probe.runProbe(dir)
    expect(result.findings.some((f: any) => f.rule.startsWith('P0') && /no SKILL\.md/.test(f.detail))).toBe(true)
  })

  test('a healthy skill trips no floor finding', () => {
    const dir = fixture({ 'SKILL.md': skillMd('floor-ok') })
    expect(probe.runProbe(dir).findings.filter((f: any) => f.rule.startsWith('P0'))).toEqual([])
  })
})

describe('V7 — symlinks are followed, and dangling ones are reported', () => {
  test('a skill delivered entirely by symlink is scanned, not silently skipped', () => {
    const real = fixture({ 'SKILL.md': skillMd('sym', 'broken: ${CLAUDE_SKILL_DIR}/nope.md'), 'references/a.md': 'x\n' })
    const link = mkdtempSync(join(tmpdir(), 'wc-link-'))
    symlinkSync(join(real, 'SKILL.md'), join(link, 'SKILL.md'))
    symlinkSync(join(real, 'references'), join(link, 'references'))
    const result = probe.runProbe(link)
    expect(result.filesEligible).toBe(2)
    expect(result.filesScanned).toBe(2)
    expect(result.findings.some((f: any) => f.rule.startsWith('P2'))).toBe(true)
  })

  test('a dangling symlink is lost coverage, and a finding', () => {
    const dir = fixture({ 'SKILL.md': skillMd('dangling') })
    symlinkSync(join(dir, 'no-such-target'), join(dir, 'refs'))
    const result = probe.runProbe(dir)
    expect(result.brokenLinks.length).toBe(1)
    expect(result.findings.some((f: any) => f.rule.startsWith('P0') && /symlink/.test(f.detail))).toBe(true)
    expect(probe.formatText(result)).toContain('dangling symlink')
  })

  test('a symlink cycle terminates', () => {
    const dir = fixture({ 'SKILL.md': skillMd('cycle') })
    mkdirSync(join(dir, 'sub'))
    symlinkSync(dir, join(dir, 'sub', 'loop'))
    expect(() => probe.runProbe(dir)).not.toThrow()
  })
})

describe('V7 — P2 covers code, and the gate dispatches like the hook', () => {
  test('a broken absolute path in a .ts is a finding', () => {
    const dir = fixture({ 'SKILL.md': skillMd('code-p2'), 'scripts/a.ts': 'x' })
    writeFileSync(join(dir, 'scripts', 'a.ts'), `const REF = "${join(dir, 'references', 'nope.md')}"\n`)
    const result = probe.runProbe(dir)
    expect(result.findings.some((f: any) => f.rule.startsWith('P2') && f.file.endsWith('a.ts'))).toBe(true)
  })

  test('the same path inside a code COMMENT is illustration, not a reference', () => {
    const dir = fixture({ 'SKILL.md': skillMd('code-p2-cmt'), 'scripts/a.ts': 'x' })
    writeFileSync(join(dir, 'scripts', 'a.ts'), `// see ${join(dir, 'references', 'nope.md')}\nexport const x = 1\n`)
    expect(probe.runProbe(dir).findings.filter((f: any) => f.rule.startsWith('P2'))).toEqual([])
  })

  test('classifySkillFile is the one dispatch table', () => {
    expect(probe.classifySkillFile('/a/SKILL.md')).toBe('skill')
    expect(probe.classifySkillFile('/a/hooks.json')).toBe('hooks')
    expect(probe.classifySkillFile('/a/agents/impl.md')).toBe('agent')
    expect(probe.classifySkillFile('/a/references/x.md')).toBe(null)
  })

  test('P4 fires on an agent file at gate time, as it does at write time', () => {
    const dir = fixture({
      'SKILL.md': skillMd('agent-p4'),
      'agents/impl.md': '---\nname: g\ndescription: d\n---\n\nuses ${CLAUDE_PLUGIN_ROOT}/x.sh\n',
    })
    const result = probe.runProbe(dir)
    expect(result.findings.some((f: any) => f.rule.startsWith('P4') && f.file.includes('agents'))).toBe(true)
  })
})

describe('V7 — P1 reads a command the way a shell would', () => {
  test('a quoted path containing a space is one token', () => {
    expect(probe.hookScriptTokens('bun "/a b/scripts/g.ts"')).toEqual(['/a b/scripts/g.ts'])
    expect(probe.hookScriptTokens("bun '/a b/scripts/g.ts'")).toEqual(['/a b/scripts/g.ts'])
  })

  test('a directory named like a script is not a hook body', () => {
    const dir = fixture({ 'SKILL.md': skillMd('dir-body') })
    mkdirSync(join(dir, 'scripts', 'guard.ts'), { recursive: true })
    writeFileSync(
      join(dir, 'SKILL.md'),
      ['---', 'name: dir-body', 'description: d', 'hooks:', '  PostToolUse:', '    - matcher: "Write"', '      hooks:', '        - type: command', `          command: "bash ${join(dir, 'scripts', 'guard.ts')}"`, '---', '', '# x', ''].join('\n'),
    )
    const findings = probe.checkHookRegistration(dir)
    expect(findings.length).toBe(1)
    expect(findings[0].detail).toContain('not a readable file')
  })
})

// ------------------------------------------------------------------ whole-probe

describe('the probe against its own skill', () => {
  test('filesScanned covers every source file, TypeScript included', () => {
    const result = probe.runProbe(SKILL_DIR)
    expect(result.filesEligible).toBe(result.filesScanned)
    expect(result.filesScanned).toBeGreaterThanOrEqual(5)
  })

  test('wc-probe exits 0 on its own skill directory', () => {
    const r = cli(['--target', SKILL_DIR])
    expect(r.out + r.err).toContain('CLEAN')
    expect(r.code).toBe(0)
  })

  test('every exemption the probe applies to its own skill is declared and reported', () => {
    const result = probe.runProbe(SKILL_DIR)
    const files = result.exemptions.map((e: any) => e.file)
    expect(files).toContain(join(SKILL_DIR, 'references', 'hook-reach.md'))
    expect(files).not.toContain(join(SELF_DIR, 'wc-probe.ts'))
  })
})

// ------------------------------------------------------------------ V3

/** Run the write-time hook out-of-process, the way Claude Code invokes it. */
function writeHook(filePath: string): string {
  const r = Bun.spawnSync(['bun', join(SELF_DIR, 'validate-skill-write.ts')], {
    stdin: Buffer.from(JSON.stringify({ tool_input: { file_path: filePath } })),
  })
  return r.stdout.toString()
}

const rulesIn = (result: any): string[] => result.findings.map((f: any) => f.rule).sort()

describe('V3-A — the walk cannot climb above its target', () => {
  test('a link to an ancestor is refused and declared, not followed', () => {
    const dir = fixture({
      'root/SKILL.md': skillMd('anchored'),
      'outside/agents/impl.md': skillMd('leak', 'uses ${CLAUDE_PLUGIN_ROOT}/x.sh'),
    })
    symlinkSync('../..', join(dir, 'root', 'up'))
    const result = probe.runProbe(join(dir, 'root'))
    // The outside tree is NOT enumerated: one eligible file, the SKILL.md we pointed at.
    expect(result.filesEligible).toBe(1)
    expect(result.findings.every((f: any) => !f.file.includes('outside'))).toBe(true)
    // and the refusal is announced rather than silently narrowing the walk's scope
    const escape = result.findings.find((f: any) => f.file === join(dir, 'root', 'up'))
    expect(escape?.rule).toBe('P0 coverage')
    expect(escape?.severity).toBe('major')
  })

  // THE EXACT-ROOT BOUNDARY. The test above climbs `../..`, which the naive prefix test
  // (`root.startsWith(linkReal + sep)`) catches — so it could never catch this. A link to `/`
  // builds the prefix `"//"`, which no path starts with, so the guard read the filesystem root as
  // "not an ancestor", followed it, and enumerated the whole disk: no stdout, and an abort/timeout
  // exit code the gate cannot read as either pass or fail.
  test('a link to the filesystem ROOT is refused — the boundary `../..` cannot reach', () => {
    const dir = fixture({ 'root/SKILL.md': skillMd('anchored-at-root') })
    symlinkSync(sep, join(dir, 'root', 'link'))
    const result = probe.runProbe(join(dir, 'root'))
    expect(result.filesEligible).toBe(1)
    const escape = result.findings.find((f: any) => f.file === join(dir, 'root', 'link'))
    expect(escape?.rule).toBe('P0 coverage')
    expect(escape?.severity).toBe('major')
  })

  test('isAtOrAbove: the root contains everything, including itself', () => {
    // the boundary the prefix spelling got backwards
    expect(probe.isAtOrAbove(sep, '/anywhere/at/all')).toBe(true)
    expect(probe.isAtOrAbove(sep, sep)).toBe(true)
    // trailing separators are not a different path
    expect(probe.isAtOrAbove('/a/b/', '/a/b')).toBe(true)
    expect(probe.isAtOrAbove('/a/b', '/a/b/c')).toBe(true)
    // and containment still means containment: no sibling, no prefix-of-a-name match
    expect(probe.isAtOrAbove('/a/b', '/a')).toBe(false)
    expect(probe.isAtOrAbove('/a/b', '/a/bc')).toBe(false)
    expect(probe.isAtOrAbove('/a/b', '/x/y')).toBe(false)
  })

  test('a sideways link OUT of the tree is still followed — that is how a skill is delivered', () => {
    const dir = fixture({
      'sk/SKILL.md': skillMd('delivered'),
      'elsewhere/extra.ts': 'export const x = 1\n',
    })
    symlinkSync(join(dir, 'elsewhere'), join(dir, 'sk', 'linked'))
    const result = probe.runProbe(join(dir, 'sk'))
    expect(result.filesEligible).toBe(2)
    // ...and the read outside --target is declared, not silent
    expect(result.crossFileTargets).toContain(join(dir, 'sk', 'linked', 'extra.ts'))
  })
})

describe('V3-B — SKIP_DIRS decides on what an entry RESOLVES to, not what it is called', () => {
  test('a dependency tree reached through an innocently named link is not walked', () => {
    const dir = fixture({
      'SKILL.md': skillMd('aliased-vendor'),
      'node_modules/pkg/index.ts': 'export const dep = 1\n',
    })
    symlinkSync('node_modules', join(dir, 'vendor'))
    const files = probe.collectFiles(dir)
    expect(files.some((f: string) => f.includes('pkg'))).toBe(false)
  })

  test('real content behind a skip-NAMED link is not dropped in silence', () => {
    const dir = fixture({
      'sk/SKILL.md': skillMd('aliased-dist'),
      'content/only.ts': 'export const real = 1\n',
    })
    symlinkSync(join(dir, 'content'), join(dir, 'sk', 'dist'))
    const files = probe.collectFiles(dir + '/sk')
    expect(files.some((f: string) => f.endsWith('only.ts'))).toBe(true)
  })
})

describe('V3-C — an aliased directory does not silently switch a rule off', () => {
  test('P4 runs through an `agents ->` alias, and the shared finding is reported once', () => {
    const dir = fixture({
      'SKILL.md': skillMd('aliased-agents'),
      'shared/impl.md': skillMd('impl', 'uses ${CLAUDE_PLUGIN_ROOT}/x.sh'),
    })
    symlinkSync('shared', join(dir, 'agents'))
    const result = probe.runProbe(dir)
    // the alias is what makes the agent rules reachable...
    expect(rulesIn(result)).toContain('P4 anti-pattern')
    // ...and the content-keyed rule fires ONCE for the one real file, not once per name
    expect(rulesIn(result).filter(r => r === 'P2 path-resolution').length).toBe(1)
  })
})

describe('V3-D — a hook command that does not lex is never read as a hook command that passed', () => {
  test('a quoted -c payload still yields the script path it runs', () => {
    expect(probe.hookScriptTokens(`bash -c 'exec /sk/scripts/g.sh "$@"' _`)).toEqual(['/sk/scripts/g.sh'])
  })

  test('an unbalanced quote falls back to a naive split instead of inventing a path', () => {
    expect(probe.hookScriptTokens(`echo don't && bash /sk/scripts/g.sh`)).toEqual(['/sk/scripts/g.sh'])
    expect(probe.hookScriptTokens(`echo "starting && bash /sk/scripts/g.sh`)).toEqual(['/sk/scripts/g.sh'])
  })

  test('a genuine path with a space in it is still one token', () => {
    expect(probe.hookScriptTokens(`bash "/a b/scripts/g.ts"`)).toEqual(['/a b/scripts/g.ts'])
  })

  test('end to end: a -c payload naming a missing body is a critical, not a CLEAN exit', () => {
    const dir = fixture({
      'SKILL.md': [
        '---',
        'name: lexed',
        'description: a fixture skill',
        'hooks:',
        '  PostToolUse:',
        `    - command: "bash -c 'exec \${CLAUDE_PLUGIN_ROOT}/scripts/gone.sh' _"`,
        '---',
        '',
        '# lexed',
        '',
      ].join('\n'),
    })
    const p1 = probe.runProbe(dir).findings.filter((f: any) => f.rule === 'P1 hook-registration')
    expect(p1.length).toBe(1)
    expect(p1[0].severity).toBe('critical')
  })
})

describe('V3-E — the ${CLAUDE_SKILL_DIR} hook rule covers BOTH spellings', () => {
  const withCommand = (cmd: string) =>
    fixture({
      'SKILL.md': ['---', 'name: sd', 'description: a fixture skill', 'hooks:', '  PostToolUse:', `    - command: '${cmd}'`, '---', '', '# sd', ''].join('\n'),
      'scripts/g.sh': '#!/bin/sh\n',
    })

  test('the braced form is a critical', () => {
    const r = probe.runProbe(withCommand('bash ${CLAUDE_SKILL_DIR}/scripts/g.sh'))
    expect(r.findings.filter((f: any) => f.rule === 'P1 hook-registration')[0]?.severity).toBe('critical')
  })

  test('the unbraced form — which bash resolves identically — is the same critical', () => {
    const r = probe.runProbe(withCommand('bash $CLAUDE_SKILL_DIR/scripts/g.sh'))
    expect(r.findings.filter((f: any) => f.rule === 'P1 hook-registration')[0]?.severity).toBe('critical')
  })

  test('a longer variable that merely starts with the name is not caught by the unbraced form', () => {
    expect(probe.unresolvedVarIn('$CLAUDE_SKILL_DIRECTORY/x.sh', { skillDir: null, pluginRoot: '/p' })).toBe(
      '$CLAUDE_SKILL_DIRECTORY',
    )
  })
})

describe('V3-F — P2 on a code file does not police paths the file merely declares', () => {
  test('an absolute $HOME path outside the skill is not this skill’s to verify', () => {
    const dir = fixture({
      'SKILL.md': skillMd('fp'),
      'scripts/out.ts': `export const OUT = '${join(process.env.HOME ?? '/home/nobody', 'wc-probe-nonexistent', 'report.json')}'\n`,
    })
    expect(rulesIn(probe.runProbe(dir))).not.toContain('P2 path-resolution')
  })

  test('but a reference into the skill’s OWN tree still fails — the ungating keeps its point', () => {
    const dir = fixture({
      'SKILL.md': skillMd('fp2'),
      'scripts/ref.ts': 'export const REF = "${CLAUDE_PLUGIN_ROOT}/references/missing.md"\n',
    })
    expect(rulesIn(probe.runProbe(dir))).toContain('P2 path-resolution')
  })
})

describe('V3-G — P2 announces the reference it could not resolve', () => {
  test('${CLAUDE_SKILL_DIR} outside any SKILL.md directory is a reported skip, not silence', () => {
    const dir = fixture({
      'a/SKILL.md': skillMd('anchor'),
      'b/doc.md': 'reads ${CLAUDE_SKILL_DIR}/definitely-missing.md\n',
    })
    const result = probe.runProbe(dir)
    const skips = result.unresolvedRefs.filter((r: any) => r.rule === 'P2 path-resolution')
    expect(skips.length).toBe(1)
    expect(skips[0].token).toContain('definitely-missing.md')
  })
})

describe('V3-H — the write-time hook is ungated wherever the gate is', () => {
  test('a scripts/*.ts naming a missing reference is flagged at write time, not only at the gate', () => {
    const dir = fixture({
      'SKILL.md': skillMd('ungated'),
      'scripts/ref.ts': 'export const REF = "${CLAUDE_PLUGIN_ROOT}/references/missing.md"\n',
    })
    const target = join(dir, 'scripts', 'ref.ts')
    expect(rulesIn(probe.runProbe(dir))).toContain('P2 path-resolution')
    expect(writeHook(target)).toContain('P2 path-resolution')
  })
})

describe('V3-I — a dangling link is judged by the same skip list its resolvable twin is', () => {
  test('a stale node_modules link is not an unexemptable critical', () => {
    const dir = fixture({ 'SKILL.md': skillMd('stale-dep') })
    symlinkSync(join(dir, 'no-such-target'), join(dir, 'node_modules'))
    const r = cli(['--target', dir])
    expect(r.out + r.err).toContain('CLEAN')
    expect(r.code).toBe(0)
  })

  test('a dangling link the walk WOULD have read is still lost coverage', () => {
    const dir = fixture({ 'SKILL.md': skillMd('stale-refs') })
    symlinkSync(join(dir, 'no-such-target'), join(dir, 'references'))
    const coverage = probe.runProbe(dir).findings.filter((f: any) => f.rule === 'P0 coverage')
    expect(coverage.length).toBe(1)
    expect(coverage[0].severity).toBe('critical')
  })
})

describe('V3-J — the coverage floor describes the dispatch it actually has', () => {
  test('on an agents-only target it does not claim the plugin-root rules were un-run', () => {
    const dir = fixture({ 'agents/impl.md': skillMd('agent-only', 'uses ${CLAUDE_PLUGIN_ROOT}/x.sh') })
    const result = probe.runProbe(dir)
    const floor = result.findings.find((f: any) => f.rule === 'P0 coverage')
    // P4 demonstrably ran on this target...
    expect(rulesIn(result)).toContain('P4 anti-pattern')
    // ...so the floor must not say otherwise
    expect(floor.detail).not.toContain('and plugin-root rules never ran')
    expect(floor.detail).toContain('DID run')
  })

  test('with no agent files either, the original wording stands', () => {
    const dir = fixture({ 'notes.md': '# just docs\n' })
    const floor = probe.runProbe(dir).findings.find((f: any) => f.rule === 'P0 coverage')
    expect(floor.detail).toContain('frontmatter and plugin-root rules never ran')
  })
})

// ------------------------------------------------------------------ D16

// The guard-bearing agent .md cannot live inside the skill it guards — a file under
// `<skill>/agents/` registers no agent. So it is always outside `--target`, and `--target` is the
// only thing the walk reads. These pin the two halves of that: that the file is judged at all, and
// that it is judged against the SKILL rather than against where it happens to be installed.
describe('D16 — an agent file outside the skill is gated with --agent', () => {
  const guarded = (guardExists: boolean) => {
    const files: Record<string, string> = {
      'skill/SKILL.md': skillMd('guarded'),
      '.claude/agents/x-impl.md': [
        '---', 'name: x-impl', 'description: a fixture agent', 'hooks:',
        '  PostToolUse: bun ${CLAUDE_SKILL_DIR}/scripts/guard.ts', '---', '', 'body', '',
      ].join('\n'),
    }
    if (guardExists) files['skill/scripts/guard.ts'] = 'export const ok = 1\n'
    return fixture(files)
  }

  /** A REAL hooks: block — the nested form `hookCommandsInFrontmatter` parses. The shorthand above
   *  is not parsed as a hook command, so it exercises P2 only; this exercises P1. */
  const guardedRegistry = (command: string) =>
    fixture({
      'skill/SKILL.md': skillMd('guarded-registry'),
      'skill/scripts/guard.ts': 'export const ok = 1\n',
      '.claude/agents/x-impl.md': [
        '---', 'name: x-impl', 'description: a fixture agent', 'hooks:',
        '  PostToolUse:', '    - matcher: "Edit|Write"', '      hooks:',
        '        - type: command', `          command: "${command}"`, '---', '', 'body', '',
      ].join('\n'),
    })

  test('a broken guard path in the agent FAILS the gate', () => {
    const dir = guarded(false)
    const r = cli(['--target', join(dir, 'skill'), '--agent', join(dir, '.claude/agents/x-impl.md')])
    expect(r.code).toBe(1)
    expect(r.out).toContain('P2 path-resolution')
    // Resolved against the SKILL, not against .claude/agents — that is the whole point.
    expect(r.out).toContain(join(dir, 'skill/scripts/guard.ts'))
  })

  test('the same agent passes once the guard exists', () => {
    const dir = guarded(true)
    const r = cli(['--target', join(dir, 'skill'), '--agent', join(dir, '.claude/agents/x-impl.md')])
    expect(r.code).toBe(0)
    expect(r.out).toContain('CLEAN')
  })

  test('the included file is reported, so the exit code names its own coverage', () => {
    const dir = guarded(true)
    const r = cli(['--target', join(dir, 'skill'), '--agent', join(dir, '.claude/agents/x-impl.md')])
    expect(r.out).toContain('INCLUDED via --agent')
  })

  // Without --agent the SAME broken guard exits 0. This is the regression: the fix that moved the
  // agent to a registering location silently removed it from the gate.
  test('without --agent the broken guard is invisible and the run exits 0', () => {
    const dir = guarded(false)
    const r = cli(['--target', join(dir, 'skill')])
    expect(r.code).toBe(0)
  })

  // Pointing --target at the discovery directory instead does NOT substitute: with no skill in
  // scope, ${CLAUDE_SKILL_DIR} resolves to nothing and the rule reports NOT CHECKED.
  test('probing the discovery directory alone cannot check the guard path', () => {
    const dir = guarded(false)
    const r = cli(['--target', join(dir, '.claude/agents'), '--expect', 'agents'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('NOT CHECKED')
  })

  test('--agent naming a file that does not exist fails closed', () => {
    const dir = guarded(true)
    const r = cli(['--target', join(dir, 'skill'), '--agent', join(dir, '.claude/agents/nope.md')])
    expect(r.code).toBe(1)
    expect(r.out).toContain('does not exist')
  })

  // P1 IS THE RULE A GUARD FILE MOST NEEDS, and --agent originally skipped it:
  // checkHookRegistration walked only `target`, while included files entered the P2-P7 loop alone.
  // Worse, the ctx override made P2 resolve ${CLAUDE_SKILL_DIR} against the skill and confirm the
  // file existed — so the gate certified a guard that can never fire.
  test('${CLAUDE_SKILL_DIR} in an included agent is CRITICAL even though the file exists', () => {
    const dir = guardedRegistry('bun ${CLAUDE_SKILL_DIR}/scripts/guard.ts')
    const r = cli(['--target', join(dir, 'skill'), '--agent', join(dir, '.claude/agents/x-impl.md')])
    expect(r.code).toBe(1)
    expect(r.out).toContain('P1 hook-registration')
    expect(r.out).toContain('does not substitute')
  })

  test('an absolute hook path in the same included agent is clean', () => {
    const dir = guardedRegistry('PLACEHOLDER')
    const abs = join(dir, 'skill/scripts/guard.ts')
    const agent = join(dir, '.claude/agents/x-impl.md')
    writeFileSync(agent, read(agent).replace('PLACEHOLDER', `bun ${abs}`))
    const r = cli(['--target', join(dir, 'skill'), '--agent', agent])
    expect(r.code).toBe(0)
    expect(r.out).toContain('CLEAN')
  })

  // The same file inside the target has always been caught; --agent must not be a way around it.
  // Compares the RULE SETS, not the exit codes. The first version of this asserted only
  // `viaAgent.code === inside.code` and `=== 1` — and exit 1 is emitted for ANY finding of any rule,
  // so it held even when the two runs flagged entirely different things. It was blind by
  // construction to the defect that shipped right past it: the same agent file scoring differently
  // depending on where the walk started. A parity test must compare tuples, as parity-check.sh does
  // for the gate-vs-write-hook axis.
  const rulesForAgent = (args: string[]) => {
    const r = Bun.spawnSync(['bun', join(SELF_DIR, 'wc-probe.ts'), ...args, '--json'])
    const parsed = JSON.parse(r.stdout.toString())
    return [
      ...new Set(
        parsed.findings
          .filter((f: any) => f.file.endsWith('.md') && f.file.includes('agents'))
          .map((f: any) => `${f.rule}@${f.line ?? ''}`),
      ),
    ].sort()
  }

  test('an included agent draws the SAME RULE SET as the same file inside the target', () => {
    const dir = guardedRegistry('bun ${CLAUDE_SKILL_DIR}/scripts/guard.ts')
    const viaAgent = rulesForAgent(['--target', join(dir, 'skill'), '--agent', join(dir, '.claude/agents/x-impl.md')])
    mkdirSync(join(dir, 'skill/agents'), { recursive: true })
    writeFileSync(join(dir, 'skill/agents/inside.md'), read(join(dir, '.claude/agents/x-impl.md')))
    const inside = rulesForAgent(['--target', join(dir, 'skill')])
    expect(viaAgent).toEqual(inside)
    // and the set is non-empty, or the comparison is two empty arrays agreeing about nothing
    expect(viaAgent.length).toBeGreaterThan(0)
  })

  // F1: --agent must refuse a location where a hooks: block never fires. A plugin-shipped agent
  // registers and dispatches, but its hooks:/mcpServers:/permissionMode: are ignored by the
  // harness — so judging its guard certifies dead code. It was also the mechanism by which one
  // unchanged file returned different verdicts under different targets, because the context
  // override repointed its ${CLAUDE_PLUGIN_ROOT} at --target.
  test('--agent refuses an agent outside a hook-delivering discovery location', () => {
    const dir = fixture({
      'skill/SKILL.md': skillMd('guarded-plugin'),
      'plugin/agents/x.md': ['---', 'name: x', 'description: d', '---', '', 'body', ''].join('\n'),
    })
    const r = cli(['--target', join(dir, 'skill'), '--agent', join(dir, 'plugin/agents/x.md')])
    expect(r.code).toBe(1)
    expect(r.out).toContain('hook-DELIVERING discovery location')
  })

  // THE INVARIANT IS SYMMETRY WITH IN-TARGET, not independence from --target.
  //
  // `--agent` declares that this agent guards this skill, so its tokens resolve against that skill
  // and a different --target legitimately asks a different question. What must NEVER differ is the
  // same file judged in-target versus via --agent: that difference is a coverage hole. An earlier
  // pair of tests here pinned the other invariant, and one of them compared two empty arrays —
  // it passed against code that ran no rule at all on an included agent, which is what shipped.
  const agentRules = (args: string[], file: string) =>
    [...new Set(JSON.parse(cli([...args, '--json']).out).findings
      .filter((f: any) => f.file === file).map((f: any) => f.rule))].sort()

  test('an included agent draws the same rules as the byte-identical file in-target', () => {
    const agent = ['---', 'name: g', 'description: d', 'hooks:', '  PostToolUse:',
      '    - matcher: "Write"', '      hooks:', '        - type: command',
      '          command: "bun ${CLAUDE_PLUGIN_ROOT}/scripts/MISSING.sh"', '---', '', 'body', ''].join('\n')
    const dir = fixture({ 'skill/SKILL.md': skillMd('sym'), '.claude/agents/g.md': agent, 'skill/agents/g.md': agent })
    const inTarget = agentRules(['--target', join(dir, 'skill')], join(dir, 'skill/agents/g.md'))
    // probe the same skill WITHOUT its in-target copy, supplying the outside one instead
    const dir2 = fixture({ 'skill/SKILL.md': skillMd('sym'), '.claude/agents/g.md': agent })
    const included = agentRules(['--target', join(dir2, 'skill'), '--agent', join(dir2, '.claude/agents/g.md')],
      join(dir2, '.claude/agents/g.md'))
    expect(included).toEqual(inTarget)
    // and non-empty, or the comparison is two empty arrays agreeing about nothing
    expect(included.length).toBeGreaterThan(0)
  })

  test('a guard whose hook body is missing FAILS via --agent, not just in-target', () => {
    const dir = fixture({
      'skill/SKILL.md': skillMd('sym2'),
      '.claude/agents/g.md': ['---', 'name: g', 'description: d', 'hooks:', '  PostToolUse:',
        '    - matcher: "Write"', '      hooks:', '        - type: command',
        '          command: "bun ${CLAUDE_PLUGIN_ROOT}/scripts/MISSING.sh"', '---', '', 'body', ''].join('\n'),
    })
    const r = cli(['--target', join(dir, 'skill'), '--agent', join(dir, '.claude/agents/g.md')])
    expect(r.code).toBe(1)
    expect(r.out).toContain('P1 hook-registration')
  })

  // An agent that cannot load registers nothing, so its guard never runs. It was CLEAN at exit 0.
  test.each([
    ['frontmatter that never closes', '---\nname: x\ndescription: d\nhooks:\n  a: b\nno close\n'],
    ['no frontmatter at all', 'just a body\n'],
    ['frontmatter missing name', '---\ndescription: d\n---\n\nbody\n'],
    ['frontmatter missing description', '---\nname: x\n---\n\nbody\n'],
  ])('an agent with %s is a P3 critical', (_label, agent) => {
    const dir = fixture({ 'SKILL.md': skillMd('host'), 'agents/x.md': agent })
    const r = cli(['--target', dir])
    expect(r.code).toBe(1)
    expect(r.out).toContain('P3 frontmatter')
  })

  // P1 read zero hook commands from a file whose frontmatter never closed, and passed it silently.
  test('a hooks: command in unparseable frontmatter is still checked', () => {
    const dir = fixture({
      'SKILL.md': skillMd('host'),
      'agents/x.md': '---\nname: x\ndescription: d\nhooks:\n  PostToolUse:\n    - matcher: "Write"\n      hooks:\n        - type: command\n          command: "bun /nonexistent/guard.ts"\nno close\n',
    })
    const r = cli(['--target', dir])
    expect(r.code).toBe(1)
    expect(r.out).toContain('/nonexistent/guard.ts')
  })

  // F3: the context override hands a SYNTHETIC join(root,'SKILL.md') to findSkillDir. An unguarded
  // statSync on it threw ENOENT out of runProbe whenever --target had no SKILL.md, aborting the
  // whole probe with exit 3 — no file got any rule and no finding reached the fix loop.
  test('--agent against a target with no SKILL.md does not crash the probe', () => {
    const dir = fixture({
      '.claude/agents/x.md': ['---', 'name: x', 'description: d', '---', '', 'body', ''].join('\n'),
    })
    const r = cli(['--target', join(dir, '.claude/agents'), '--expect', 'agents',
      '--agent', join(dir, '.claude/agents/x.md')])
    expect(r.code).not.toBe(3)
    expect(r.err).not.toContain('failed to probe')
  })

  // F5: filesEligible is the denominator the coverage floor exists to make trustworthy.
  test('naming the same agent twice does not inflate the coverage count', () => {
    const dir = fixture({
      'skill/SKILL.md': skillMd('dedup'),
      '.claude/agents/x.md': ['---', 'name: x', 'description: d', '---', '', 'body', ''].join('\n'),
    })
    const a = join(dir, '.claude/agents/x.md')
    const once = JSON.parse(cli(['--target', join(dir, 'skill'), '--agent', a, '--json']).out)
    const twice = JSON.parse(cli(['--target', join(dir, 'skill'), '--agent', a, '--agent', a, '--json']).out)
    expect(twice.filesEligible).toBe(once.filesEligible)
  })

  test('--agent naming a non-agent file fails closed', () => {
    const dir = guarded(true)
    const r = cli(['--target', join(dir, 'skill'), '--agent', join(dir, 'skill/SKILL.md')])
    expect(r.code).toBe(1)
    expect(r.out).toContain('does not classify as an agent')
  })
})

// ------------------------------------------------------------------ D17

describe('D17 — --expect agents changes what the floor demands, not whether it exists', () => {
  const discoveryDir = () =>
    fixture({
      '.claude/agents/x-impl.md': ['---', 'name: x-impl', 'description: d', '---', '', 'body', ''].join('\n'),
    })

  // The defect this mode exists to fix: a discovery directory holds no SKILL.md by design, so the
  // default floor failed every valid one and the check could never pass.
  test('a valid discovery directory exits 0 under --expect agents', () => {
    const r = cli(['--target', join(discoveryDir(), '.claude/agents'), '--expect', 'agents'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('CLEAN')
  })

  test('the same directory still fails WITHOUT the flag — the default is unchanged', () => {
    const r = cli(['--target', join(discoveryDir(), '.claude/agents')])
    expect(r.code).toBe(1)
    expect(r.out).toContain('no SKILL.md')
  })

  // The floor did not disappear, it changed its question: declaring `agents` and matching none is
  // this mode's vacuous pass.
  test('--expect agents over a directory holding no agent file FAILS', () => {
    const dir = fixture({ 'notagents/readme.md': '# hi\n' })
    const r = cli(['--target', join(dir, 'notagents'), '--expect', 'agents'])
    expect(r.code).toBe(1)
    expect(r.out).toContain('passed vacuously')
  })

  test('a clean --expect agents run still reports that the frontmatter rules did not run', () => {
    const r = cli(['--target', join(discoveryDir(), '.claude/agents'), '--expect', 'agents'])
    expect(r.out).toContain('did not run')
  })

  test('an unknown --expect value is an ARG error, not a silent default', () => {
    const r = cli(['--target', discoveryDir(), '--expect', 'nonsense'])
    expect(r.code).toBe(2)
    expect(r.err).toContain('--expect must be one of')
  })
})

// ------------------------------------------------------------------ D18

// `[` is outside the tail's character class, so the match STOPS there and the leftover stub was
// resolved as if someone had written it. Found by running the probe over a real shipped skill
// (workflows 5.101.1 skills/dev:72), not by a fixture.
describe('D18 — a documentation placeholder is a template, not a broken path', () => {
  const withTail = (tail: string) =>
    fixture({ 'SKILL.md': skillMd('tpl', `see \${CLAUDE_SKILL_DIR}/${tail}`) })

  test('a bracketed placeholder does not produce a finding', () => {
    const r = cli(['--target', withTail('skills/dev-[phase_name]/SKILL.md')])
    expect(r.code).toBe(0)
    expect(r.out).toContain('CLEAN')
  })

  test('the skipped check is REPORTED, so it cannot read as a check that passed', () => {
    const r = cli(['--target', withTail('skills/dev-[phase_name]/SKILL.md')])
    expect(r.out).toContain('NOT CHECKED')
    expect(r.out).toContain('placeholder')
  })

  test('an angle-bracket placeholder is treated the same way', () => {
    const r = cli(['--target', withTail('skills/dev-<phase>/SKILL.md')])
    expect(r.code).toBe(0)
  })

  // The narrowing must not swallow real defects: without a placeholder the same shape still fails.
  test('a genuinely missing path is still a critical', () => {
    const r = cli(['--target', withTail('refs/gone.md')])
    expect(r.code).toBe(1)
    expect(r.out).toContain('P2 path-resolution')
  })

  // THE BOUNDARY THIS GUARD ACTUALLY DEFENDS. The case above has no bracket anywhere, so it
  // exercises the guard's OFF path and would pass identically against a version that skipped on any
  // bracket at all — it pinned nothing about the discriminator. These do: each is a COMPLETE path
  // whose match ends immediately before a `[` or `<`, which the first version of this guard
  // silently downgraded from a critical to a note.
  test.each([
    ['an HTML comment after a complete path', 'refs/gone.md<!-- note -->'],
    ['a footnote marker after a complete path', 'refs/gone.md[1]'],
    ['a tag after a complete path', 'refs/gone.md<br>x'],
    ['an angle placeholder after a complete path', 'refs/gone.md<version>'],
  ])('%s is still a critical', (_label, tail) => {
    const r = cli(['--target', withTail(tail)])
    expect(r.code).toBe(1)
    expect(r.out).toContain('P2 path-resolution')
    expect(r.out).toContain('gone.md')
  })

  // ...and the fragments must still be skipped, including the form that ends at a `/`.
  test.each([
    ['a placeholder mid-segment', 'skills/dev-[phase_name]/SKILL.md'],
    ['a placeholder filling a whole segment', 'refs/[name].md'],
  ])('%s is skipped, not flagged', (_label, tail) => {
    const r = cli(['--target', withTail(tail)])
    expect(r.code).toBe(0)
    expect(r.out).toContain('NOT CHECKED')
  })

  test('a path that resolves is still clean', () => {
    const dir = fixture({
      'SKILL.md': skillMd('tpl-ok', 'see ${CLAUDE_SKILL_DIR}/refs/here.md'),
      'refs/here.md': 'x\n',
    })
    expect(cli(['--target', dir]).code).toBe(0)
  })
})

// ------------------------------------------------------------------ D19

describe('D19 — P2 skips are reported, and its scanners cover relative links', () => {
  const md = (body: string) => fixture({ 'SKILL.md': skillMd('d19', body) })

  // craft shipped `(../../agent-spawn/...)`, one `..` too many, and every probe returned CLEAN:
  // P2 ran a placeholder scanner and an absolute scanner, and a relative link is neither.
  test('a broken relative markdown link is a critical', () => {
    const r = cli(['--target', md('see [x](../../nope/gone.md) for details')])
    expect(r.code).toBe(1)
    expect(r.out).toContain('P2 path-resolution')
  })

  test('a relative link that resolves is clean', () => {
    const dir = fixture({ 'SKILL.md': skillMd('ok', 'see [x](refs/here.md)'), 'refs/here.md': 'x\n' })
    expect(cli(['--target', dir]).code).toBe(0)
  })

  test('a placeholder-rooted link is left to the placeholder scanner, not double-resolved', () => {
    const dir = fixture({ 'SKILL.md': skillMd('ph', 'see [x](${CLAUDE_SKILL_DIR}/refs/here.md)'), 'refs/here.md': 'x\n' })
    expect(cli(['--target', dir]).code).toBe(0)
  })

  // Every other P2 skip announces itself; this one printed CLEAN over a path it declined to check.
  test('a path outside every known root is REPORTED, not silently dropped', () => {
    const r = cli(['--target', md('quoted: /srv/elsewhere/team/rules.md')])
    expect(r.out).toContain('NOT CHECKED')
    expect(r.out).toContain('outside this skill')
  })

  // `{name}` is as ordinary a template notation as `[name]`, and was resolved as if written.
  test('a brace-delimited template is skipped, not flagged', () => {
    const r = cli(['--target', md('see ${CLAUDE_SKILL_DIR}/refs/{name}.md')])
    expect(r.code).toBe(0)
    expect(r.out).toContain('NOT CHECKED')
  })

  // P5 and P2 used different placeholder rules, so one token drew a P2 skip AND a P5 finding.
  test('P5 and P2 agree that a bracketed template is a template', () => {
    expect(probe.isPathTemplate('${CLAUDE_SKILL_DIR}/scripts/dev-[phase]/workflow.js')).toBe(true)
    expect(probe.isPathTemplate('${CLAUDE_SKILL_DIR}/refs/{name}.md')).toBe(true)
    expect(probe.isPathTemplate('${CLAUDE_SKILL_DIR}/scripts/w.js')).toBe(false)
    expect(probe.isPathTemplate('${CLAUDE_SKILL_DIR}/scripts/guard<br>')).toBe(false)
  })
})

// ------------------------------------------------------------------ D20

describe('D20 — shell scripts are inside the walk', () => {
  // BARE_ABS_RE already matched .sh paths NAMED FROM a scanned file, so a .sh was checkable as a
  // target while never being opened as a source. craft ships two, and the probe reported "3 of 3".
  test('a broken path inside a .sh is a critical', () => {
    const dir = fixture({
      'SKILL.md': skillMd('sh'),
      'scripts/x.sh': '#!/usr/bin/env bash\nsource ${CLAUDE_SKILL_DIR}/scripts/missing.sh\n',
    })
    const r = cli(['--target', dir])
    expect(r.code).toBe(1)
    expect(r.out).toContain('missing.sh')
  })

  test('a .sh counts toward the coverage denominator', () => {
    const dir = fixture({ 'SKILL.md': skillMd('sh2'), 'scripts/x.sh': '#!/usr/bin/env bash\necho ok\n' })
    expect(JSON.parse(cli(['--target', dir, '--json']).out).filesEligible).toBe(2)
  })

  // The write-time hook imports the SAME regex, so both surfaces admit .sh together or neither does.
  test('the write-time surface admits .sh too', () => {
    expect(probe.SOURCE_EXT_RE.test('/x/scripts/a.sh')).toBe(true)
    expect(probe.SOURCE_EXT_RE.test('/x/scripts/a.bash')).toBe(true)
  })
})

// ------------------------------------------------------------------ D21

describe('D21 — cycle-2 regressions', () => {
  // The coverage floor tested `eligible`, which is the walk PLUS included agents — so one --agent
  // lifted a target that contributed nothing, and a stale --target was certified CLEAN.
  test('an empty --target is not rescued by --agent', () => {
    const dir = fixture({ '.claude/agents/a.md': '---\nname: a\ndescription: d\n---\n\nbody\n' })
    mkdirSync(join(dir, 'empty'), { recursive: true })
    const r = cli(['--target', join(dir, 'empty'), '--agent', join(dir, '.claude/agents/a.md')])
    expect(r.code).toBe(1)
    expect(r.out).toContain('vacuous')
  })

  // scanLiterals is a JS lexer: `"$SRC"/*` opened a block comment that never closed, masking the
  // rest of the shell script and silently disabling P2 from that point on.
  test('a shell glob does not mask the rest of the script', () => {
    const dir = fixture({
      'SKILL.md': skillMd('sh3'),
      'scripts/x.sh': '#!/bin/bash\ncp "$SRC"/* "$DST"/\nbash ${CLAUDE_SKILL_DIR}/scripts/gone1.sh\n',
    })
    const r = cli(['--target', dir])
    expect(r.out).toContain('gone1.sh')
    expect(r.code).toBe(1)
  })

  // Shell gets NO comment narrowing: a path in a `#` comment IS checked. That is deliberate and it
  // fails LOUD — a false critical an author can see and exempt. Both masks tried here failed
  // SILENT instead: the JS lexer read `"$SRC"/*` as an unterminated block comment and blinded the
  // rest of the file; the `#` mask that replaced it blinded the rest of any line holding a `#`
  // inside a string. An over-check is recoverable; an invisible under-check is not.
  test('a path in a shell # comment IS checked, and says so loudly', () => {
    const dir = fixture({
      'SKILL.md': skillMd('sh4'),
      'scripts/y.sh': '#!/bin/bash\n# example: bash ${CLAUDE_SKILL_DIR}/scripts/illustrative.sh\necho ok\n',
    })
    expect(cli(['--target', dir]).code).toBe(1)
  })

  test('a # inside a string does not blind the rest of the line', () => {
    const dir = fixture({
      'SKILL.md': skillMd('sh5'),
      'scripts/z.sh': '#!/bin/bash\necho "count # of items"; bash ${CLAUDE_SKILL_DIR}/scripts/MISSING.sh\n',
    })
    const r = cli(['--target', dir])
    expect(r.code).toBe(1)
    expect(r.out).toContain('MISSING.sh')
  })

  // classifySkillFile matched ANY ancestor named 'agents', so prose under docs/agents/ drew the
  // agent frontmatter rule — and it disagreed with isGuardDiscoveryPath, which wants the parent.
  test('a .md under a nested agents/ ancestor is not treated as an agent', () => {
    const dir = fixture({ 'SKILL.md': skillMd('nest'), 'docs/agents/guide/notes.md': '# Notes\n' })
    expect(cli(['--target', dir]).code).toBe(0)
  })

  // CONTROL, not a regression pin: `agents/broken.md` is an agent under the old any-ancestor rule
  // AND the new immediate-parent one, so it cannot tell them apart — it passed identically against
  // code lacking the narrowing. Kept because it catches OVER-narrowing, and strengthened to name
  // the rule so an exit 1 for some unrelated reason can no longer stand in for it.
  test('a .md whose immediate parent is agents/ still is', () => {
    const dir = fixture({ 'SKILL.md': skillMd('nest2'), 'agents/broken.md': 'no frontmatter\n' })
    const r = cli(['--target', dir])
    expect(r.code).toBe(1)
    expect(r.out).toContain('P3 frontmatter')
    expect(r.out).toContain('broken.md')
  })

  // Agent discovery is RECURSIVE under a root: "Claude Code scans `.claude/agents/` and
  // `~/.claude/agents/` recursively, so you can organize definitions into subfolders such as
  // `agents/review/`" (code.claude.com/docs/en/sub-agents). A subfolder agent is a real agent, so
  // the rules must run on it. The immediate-parent rule skipped it SILENTLY — no finding, no NOT
  // CHECKED note, and counted as scanned — which is why the root, not the depth, is the test.
  test('an agent in a subfolder of agents/ is still an agent', () => {
    const dir = fixture({ 'SKILL.md': skillMd('nest3'), 'agents/review/security.md': 'no frontmatter\n' })
    const r = cli(['--target', dir])
    expect(r.code).toBe(1)
    expect(r.out).toContain('P3 frontmatter')
    expect(r.out).toContain('security.md')
  })

  // The other direction, unchanged: `docs/` is not a discovery root at any depth.
  test('a .md under a non-root directory named agents/ is not an agent', () => {
    const dir = fixture({ 'SKILL.md': skillMd('nest4'), 'docs/agents/guide/notes.md': '# Notes\n' })
    expect(cli(['--target', dir]).code).toBe(0)
  })

  // The write-time surface must run the same agent rule the gate does. This one predates the
  // narrowing it is filed under — it exercises the export directly, so it passes against cycle-2
  // code too. That is provenance, not a hollow assertion.
  test('checkAgentFrontmatter is exported for the write-time surface', () => {
    expect(typeof probe.checkAgentFrontmatter).toBe('function')
    expect(probe.checkAgentFrontmatter('/x/agents/a.md', 'no frontmatter\n').length).toBeGreaterThan(0)
    expect(probe.checkAgentFrontmatter('/x/agents/a.md', '---\nname: a\ndescription: d\n---\n\nb\n')).toEqual([])
  })
})

// ------------------------------------------------------------------ D22

// ${CLAUDE_PLUGIN_ROOT} is documented as "the plugin's installation directory, for scripts bundled
// with a plugin" (code.claude.com/docs/en/hooks). An agent outside a plugin has none, and a
// plugin-shipped agent has its hooks: block ignored entirely — so in an agent the token can never
// name something the harness supplies. Three cycles of this probe invented a value for it instead,
// which is what made one unchanged agent CLEAN under one --target and CRITICAL under another.
describe('D22 — an agent hooks: command may not use ${CLAUDE_PLUGIN_ROOT}', () => {
  const agent = ['---', 'name: g', 'description: d', 'hooks:', '  PostToolUse:',
    '    - matcher: "Write"', '      hooks:', '        - type: command',
    '          command: "bun ${CLAUDE_PLUGIN_ROOT}/scripts/x.sh"', '---', '', 'body', ''].join('\n')

  test('it is a P1 critical in an in-target agent', () => {
    const dir = fixture({ 'SKILL.md': skillMd('pr1'), 'agents/g.md': agent })
    const r = cli(['--target', dir])
    expect(r.code).toBe(1)
    expect(r.out).toContain('P1 hook-registration')
    expect(r.out).toContain('plugin installation directory')
  })

  // The same rule set either way: the invented root was what made these differ.
  test('in-target and --agent draw the same rules for the byte-identical file', () => {
    const rules = (args: string[], f: string) =>
      [...new Set(JSON.parse(cli([...args, '--json']).out).findings
        .filter((x: any) => x.file === f).map((x: any) => x.rule))].sort()
    const a = fixture({ 'skill/SKILL.md': skillMd('pr2'), 'skill/agents/g.md': agent })
    const b = fixture({ 'skill/SKILL.md': skillMd('pr2'), '.claude/agents/g.md': agent })
    const inTarget = rules(['--target', join(a, 'skill')], join(a, 'skill/agents/g.md'))
    const included = rules(['--target', join(b, 'skill'), '--agent', join(b, '.claude/agents/g.md')],
      join(b, '.claude/agents/g.md'))
    expect(included).toEqual(inTarget)
    expect(included.length).toBeGreaterThan(0)
  })

  // A SKILL's hooks: may use it — there the placeholder is meaningful and was measured.
  test('a SKILL.md hooks: command using it is NOT refused', () => {
    const dir = fixture({
      'SKILL.md': ['---', 'name: ok', 'description: a fixture skill', 'hooks:', '  PostToolUse:',
        '    - matcher: "Write"', '      hooks:', '        - type: command',
        '          command: "bun ${CLAUDE_PLUGIN_ROOT}/scripts/g.sh"', '---', '', '# ok', ''].join('\n'),
      'scripts/g.sh': '#!/bin/bash\necho ok\n',
    })
    expect(cli(['--target', dir]).out).not.toContain('plugin installation directory')
  })

  // P1's remedy must not recommend the spelling P1 refuses.
  test('P1 does not advertise ${CLAUDE_PLUGIN_ROOT} as the fix', () => {
    const dir = fixture({
      'SKILL.md': skillMd('pr3'),
      'agents/s.md': ['---', 'name: s', 'description: d', 'hooks:', '  PostToolUse:',
        '    - matcher: "Write"', '      hooks:', '        - type: command',
        '          command: "bun ${CLAUDE_SKILL_DIR}/scripts/g.sh"', '---', '', 'b', ''].join('\n'),
    })
    const out = cli(['--target', dir]).out
    expect(out).toContain('P1 hook-registration')
    expect(out).not.toMatch(/\$\{CLAUDE_PLUGIN_ROOT\} was observed to substitute/)
  })
})

// ------------------------------------------------------------------ D23

describe('D23 — one notion of agenthood, not three', () => {
  const withHook = ['---', 'name: g', 'description: d', 'hooks:', '  PostToolUse:',
    '    - matcher: "Write"', '      hooks:', '        - type: command',
    '          command: "bash /nonexistent/guard.sh"', '---', '', 'body', ''].join('\n')

  // classifySkillFile was narrowed to the immediate parent and checkHookRegistration's own
  // substring test was left on any-ancestor, so a document was not an agent to one and WAS a hook
  // registry to the other — the shared-predicates/unshared-dispatch split, one level up.
  test('prose under a nested agents/ ancestor is not a hook registry', () => {
    const dir = fixture({ 'SKILL.md': skillMd('reg1'), 'docs/agents/guide/x.md': withHook })
    expect(cli(['--target', dir]).code).toBe(0)
  })

  test('a real agent IS a hook registry', () => {
    const dir = fixture({ 'SKILL.md': skillMd('reg2'), 'agents/g.md': withHook })
    const r = cli(['--target', dir])
    expect(r.code).toBe(1)
    expect(r.out).toContain('P1 hook-registration')
  })

  // The classifier is the single source: whatever it calls an agent is what P1 registers.
  test('the classifier and the registry test agree', () => {
    expect(probe.classifySkillFile('/x/agents/g.md')).toBe('agent')
    expect(probe.classifySkillFile('/x/docs/agents/guide/g.md')).toBe(null)
    expect(probe.classifySkillFile('/x/SKILL.md')).toBe('skill')
  })
})

// ------------------------------------------------------------------ D24

describe('D24 — every CommonMark link form the scanner claims to cover', () => {
  // The destination pattern accepted only a BARE destination with no title, so an angle-wrapped
  // link, a titled link and a reference definition were all unchecked while reading as checked.
  // `bare` and `fragment` (and the resolvable negative below) are CONTROLS: the pre-widening
  // scanner already matched them, so they cannot discriminate and are here to catch a regression.
  // `angle + fragment` read as a fourth control only because the old assertion was a substring:
  // the old pattern captured `<./nope-bare.md`, a destination nobody wrote, and "contains
  // nope-bare.md" was true of that garbage. Asserting the QUOTED destination — the text as the
  // author wrote it, angle wrapper stripped — is what makes the angle forms discriminate.
  const cases: Array<[string, string]> = [
    ['bare', '[a](./nope-bare.md)'],
    ['angle-wrapped', '[a](<./nope-bare.md>)'],
    ['titled', '[a](./nope-bare.md "t")'],
    ['fragment', '[a](./nope-bare.md#sec)'],
    ['angle + fragment', '[a](<./nope-bare.md#sec>)'],
    ['reference definition', '[a]\n\n[a]: ./nope-bare.md'],
  ]

  for (const [name, link] of cases) {
    test(`${name} destination is checked, and named as written`, () => {
      const dir = fixture({ 'SKILL.md': `${skillMd('lnk')}\n${link}\n` })
      const r = cli(['--target', dir])
      expect(r.code).toBe(1)
      expect(r.out).toContain('"./nope-bare.md"')
    })
  }

  test('a resolvable link in each form stays clean', () => {
    const dir = fixture({
      'SKILL.md': `${skillMd('lnk-ok')}\n[a](./r.md)\n[b](<./r.md>)\n[c](./r.md "t")\n\n[d]: ./r.md\n`,
      'r.md': '# real\n',
    })
    expect(cli(['--target', dir]).code).toBe(0)
  })

  // Both skips used to `continue` in silence while every sibling P2 skip announced itself.
  test('a template destination is announced, not silently skipped', () => {
    const dir = fixture({ 'SKILL.md': `${skillMd('lnk-t')}\n[a](<./{ph}/x.md>)\n` })
    const r = cli(['--target', dir])
    expect(r.out).toContain('NOT CHECKED')
    expect(r.out).toContain('./{ph}/x.md')
  })

  test('an unresolved variable destination is announced, not silently skipped', () => {
    const dir = fixture({ 'SKILL.md': `${skillMd('lnk-v')}\n[a](./\${NOPE}/x.md "t")\n` })
    const r = cli(['--target', dir])
    expect(r.out).toContain('NOT CHECKED')
    expect(r.out).toContain('NOPE')
  })
})

// ------------------------------------------------------------------ D25

/**
 * D25 — the form matrix P2's Markdown scanning is written against.
 *
 * The scanner had been widened one form at a time across three cycles, and each widening left a
 * DIFFERENT form matching nothing — which reports CLEAN, byte-identically to a form that was
 * checked. This table is the acceptance: every form crossed with every polarity, so a form that
 * stops matching fails a test instead of going quiet.
 *
 * Polarities:
 *   resolvable  the destination exists            -> no finding
 *   broken      the destination does not exist    -> a finding NAMING it
 *   in-fence    the same broken snippet, fenced   -> no finding (it is an example)
 *   template    the destination is a placeholder  -> a NOT CHECKED note NAMING it
 */
describe('D25 — every Markdown reference form, in every polarity', () => {
  interface FormCase {
    name: string
    /** Render the snippet that carries destination `d`. */
    snip: (d: string) => string
    ok: string
    broken: string
    /** What the finding must name, when unescaping or fragment-stripping changes it. */
    brokenShown?: string
    template: string
    /** What the NOT CHECKED note must name. Spelled out, not computed, so this table asserts
     *  BEHAVIOUR and not the return value of a helper it is also testing. */
    templateShown?: string
  }

  // Files every fixture in this block ships, so `ok` has something to resolve to.
  const present: Record<string, string> = {
    'r.md': '# r\n',
    'nope_x.md': '# the file the ESCAPED destination actually names\n',
    'has space.md': '# spaced\n',
    'r(1).md': '# parens\n',
    'UP.MD': '# upper\n',
    'refs/r.md': '# bare-relative target\n',
  }

  const forms: FormCase[] = [
    { name: 'inline bare', snip: d => `[a](${d})`, ok: './r.md', broken: './nope-1.md', template: './{ph}/x.md' },
    { name: 'inline angle-wrapped', snip: d => `[a](<${d}>)`, ok: './r.md', broken: './nope-2.md', template: './{ph}/x.md' },
    // The ONLY reason CommonMark has the `<…>` form. It matched nothing, so it read as clean.
    { name: 'inline angle-wrapped with a SPACE', snip: d => `[a](<${d}>)`, ok: './has space.md', broken: './no such file.md', template: './{ph}/a b.md' },
    { name: 'inline with a title', snip: d => `[a](${d} "t")`, ok: './r.md', broken: './nope-4.md', template: './{ph}/x.md' },
    { name: 'inline with a fragment', snip: d => `[a](${d}#sec)`, ok: './r.md', broken: './nope-5.md', template: './{ph}/x.md' },
    // Resolved literally, this reported a CRITICAL against `nope_x.md`, which EXISTS.
    { name: 'inline with a backslash escape', snip: d => `[a](${d})`, ok: './nope\\_x.md', broken: './gone\\_y.md', brokenShown: './gone_y.md', template: './{ph}/no\\_x.md', templateShown: './{ph}/no_x.md' },
    { name: 'inline with balanced parens', snip: d => `[a](${d})`, ok: './r(1).md', broken: './nope(1).md', template: './{ph}/x(1).md' },
    // The alternation was lowercase-only while the file-type gate is /i.
    { name: 'inline with an UPPERCASE extension', snip: d => `[a](${d})`, ok: './UP.MD', broken: './NOPE-UP.MD', template: './{PH}/X.MD' },
    { name: 'reference definition, same line', snip: d => `[l]: ${d}`, ok: './r.md', broken: './nope-9.md', template: './{ph}/x.md' },
    { name: 'reference definition, destination on the NEXT line', snip: d => `[l]:\n   ${d}`, ok: './r.md', broken: './nope-10.md', template: './{ph}/x.md' },
    { name: 'reference definition, angle-wrapped', snip: d => `[l]: <${d}>`, ok: './r.md', broken: './nope-11.md', template: './{ph}/x.md' },
    { name: 'raw HTML href', snip: d => `<a href="${d}">x</a>`, ok: './r.md', broken: './nope-12.md', template: './{ph}/x.md' },
    { name: 'raw HTML src', snip: d => `<img src="${d}">`, ok: './r.md', broken: './nope-13.md', template: './{ph}/x.md' },
  ]

  const build = (body: string) => fixture({ ...present, 'SKILL.md': `${skillMd('mx')}\n${body}\n` })

  for (const f of forms) {
    test(`${f.name} — resolvable destination draws nothing`, () => {
      const r = cli(['--target', build(f.snip(f.ok))])
      expect(r.out).not.toContain('P2 path-resolution')
      expect(r.code).toBe(0)
    })

    test(`${f.name} — broken destination is a finding that NAMES it`, () => {
      const r = cli(['--target', build(f.snip(f.broken))])
      expect(r.out).toContain('P2 path-resolution')
      expect(r.out).toContain(f.brokenShown ?? f.broken)
      expect(r.code).toBe(1)
    })

    test(`${f.name} — the same broken destination inside a fence is ANNOUNCED, not a finding`, () => {
      // A fence means "worked example", so this is illustration and must not fail the gate — but it
      // must not vanish either. `parseExemptions` ignores a marker inside a fence, so there is no
      // in-place suppression here; the note IS the record.
      const r = cli(['--target', build(['```', f.snip(f.broken), '```'].join('\n'))])
      expect(r.code).toBe(0)
      expect(r.out).toContain('NOT CHECKED')
      expect(r.out).toContain('fenced example')
      // NAMES the destination, like the sibling template rows. Without this a note that announced
      // the right rule against the wrong path — or against none — passed the whole matrix.
      expect(r.out).toContain(f.brokenShown ?? f.broken)
    })

    test(`${f.name} — a template destination is ANNOUNCED, not silently skipped`, () => {
      const r = cli(['--target', build(f.snip(f.template))])
      expect(r.out).toContain('NOT CHECKED')
      expect(r.out).toContain(f.templateShown ?? f.template)
      expect(r.code).toBe(0)
    })
  }

  // The three acceptance clauses stated on their own, so a reader can see them without the table.

  test('an escaped destination naming a file that EXISTS produces no finding', () => {
    const dir = fixture({ 'SKILL.md': `${skillMd('esc')}\n[a](./nope\\_x.md)\n`, 'nope_x.md': '# real\n' })
    const r = cli(['--target', dir])
    expect(r.out).not.toContain('P2 path-resolution')
    expect(r.code).toBe(0)
  })

  // BARE-RELATIVE PROSE IS A DELIBERATE EXCLUSION, pinned so the matrix keeps the row rather than
  // losing it silently. It was built, measured, and removed: it made criticals out of
  // `**Example**: `scripts/rotate_pdf.py`` in correct shipped skills (9 against
  // plugin-dev/skill-development, 6 against anthropic-skills/skill-creator), and the directory's
  // existence cannot separate the two because those directories exist.
  test('a bare relative reference in prose is NOT checked', () => {
    const dir = fixture({ 'SKILL.md': `${skillMd('bare')}\nSee references/nope.md for the rules.\n`, 'references/other.md': '# x\n' })
    const r = cli(['--target', dir])
    expect(r.out).not.toContain('P2 path-resolution')
    expect(r.code).toBe(0)
  })

  // The other half of why it was removed, and the reason it must not come back without an anchor:
  // it was P2's only scanner with no anchor character, so it could hit the engine's backtracking
  // cap — and when it did, `exec` returned null and the loop ENDED, abandoning the rest of the file
  // while the run still reported CLEAN. A DELIMITED form cannot do that.
  test('a pathological line does not silence checking for the rest of the file', () => {
    const dir = fixture({
      'SKILL.md': `${skillMd('bt')}\nsee ${'../'.repeat(8000)}a.a\n[a](./definitely-missing.md)\n`,
    })
    const r = cli(['--target', dir])
    expect(r.out).toContain('definitely-missing.md')
    expect(r.code).toBe(1)
  })

  // Prose describing SOME OTHER tree's layout is now simply out of scope, not announced.
  test('prose naming another tree\'s layout draws neither finding nor note', () => {
    const dir = fixture({ 'SKILL.md': `${skillMd('bare-nr')}\nDeclare it in hooks/hooks.json instead.\n` })
    const r = cli(['--target', dir])
    expect(r.code).toBe(0)
    expect(r.out).not.toContain('hooks/hooks.json')
  })

  test('the bare form does not fire on a URL, nor twice on a link it is already inside', () => {
    const dir = fixture({
      'SKILL.md': `${skillMd('bare-url')}\nSee https://example.com/docs/nope.md and [a](./nope-dup.md).\n`,
    })
    const r = cli(['--target', dir])
    expect(r.out).not.toContain('example.com')
    expect(r.out.match(/P2 path-resolution/g)?.length).toBe(1)
  })

  test('markdownPathRefs tags each form, and claims each span once', () => {
    const md = ['[a](./one.md)', '', '[l]: ./two.md', '', '<a href="./three.md">x</a>', '', 'and refs/four.md here'].join('\n')
    const got = probe.markdownPathRefs(md).map((r: any) => [r.form, r.raw])
    expect(got).toEqual([
      ['inline', './one.md'],
      ['reference-definition', './two.md'],
      ['html-attribute', './three.md'],
    ])
  })

  test('maskFences blanks fence interiors and delimiters while preserving line geometry', () => {
    const md = ['prose [a](./x.md)', '```js', 'const q = "[b](./y.md)"', '```', 'tail'].join('\n')
    const view = probe.maskFences(md)
    expect(view.split('\n').length).toBe(md.split('\n').length)
    expect(view.length).toBe(md.length)
    expect(view).toContain('./x.md')
    expect(view).not.toContain('./y.md')
  })

  // The bare form is the only P2 scanner with no anchor character, so it is attempted at every
  // index. With an ambiguous basename and no leading lookbehind, one 12k-character line of
  // `a/a/…a.a.a…` took 1.5s in the regex alone; a probe slow enough to be dropped from a loop is a
  // probe that does not run.
  test('the bare form stays linear on an adversarial line', () => {
    const line = 'a/'.repeat(4000) + 'a.'.repeat(8000) + 'zz'
    const t0 = Date.now()
    expect(probe.markdownPathRefs(line)).toEqual([])
    expect(Date.now() - t0).toBeLessThan(500)
  })

  test('unescapeDestination resolves CommonMark punctuation escapes only', () => {
    expect(probe.unescapeDestination('./nope\\_x.md')).toBe('./nope_x.md')
    expect(probe.unescapeDestination('./a\\(1\\).md')).toBe('./a(1).md')
    expect(probe.unescapeDestination('./a\\nb.md')).toBe('./a\\nb.md')
  })
})

// ------------------------------------------------------------------ D26

describe('D26 — the coverage denominator does not silently choose its own subset', () => {
  // `filesEligible` counts only what SOURCE_EXT_RE already admitted, and nothing named a file it
  // rejected. So a skill whose one broken reference lived in a `.py`, a `.json` or an uppercase
  // `.MD` printed `CLEAN — 1 of 1 eligible source files scanned`: a full-reach claim over a subset
  // the selector picked in silence.
  const denomFixture = () =>
    fixture({
      'SKILL.md': skillMd('denominator'),
      'scripts/hook.py': '# a guard body\nSPEC = "${CLAUDE_SKILL_DIR}/references/gone-py.md"\n',
      'config.json': '{ "spec": "${CLAUDE_SKILL_DIR}/references/gone-json.md" }\n',
      'references/NOTE.MD': 'See [x](./gone-upper.md) for the rule.\n',
      'assets/logo.png': 'not-really-a-png',
    })

  test('the acceptance fixture is neither CLEAN nor full-coverage', () => {
    const r = cli(['--target', denomFixture()])
    expect(r.code).toBe(1)
    expect(r.out).not.toContain('CLEAN')
    expect(r.out).toContain('4 of 4 eligible source files scanned')
    expect(r.out).toContain('present-but-excluded')
  })

  test('each of the three formerly-invisible files draws its own finding', () => {
    const findings = probe.runProbe(denomFixture()).findings
    const filesWithFindings = new Set(findings.map((f: any) => f.file.replace(/^.*\/(?=[^/]+$)/, '')))
    expect(filesWithFindings.has('hook.py')).toBe(true)
    expect(filesWithFindings.has('config.json')).toBe(true)
    expect(filesWithFindings.has('NOTE.MD')).toBe(true)
  })

  test('what stays excluded is NAMED, not dropped', () => {
    const dir = denomFixture()
    const result = probe.runProbe(dir)
    expect(result.filesExcluded.map((f: string) => f.replace(`${dir}/`, ''))).toEqual(['assets/logo.png'])
    expect(cli(['--target', dir]).out).toContain('NOT SCANNED (extension outside')
    expect(cli(['--target', dir]).out).toContain('assets/logo.png')
  })

  // A CONTROL, and the only test here that does not discriminate: it passes against the pre-fix
  // probe too, because a probe with no exclusion channel prints no exclusion line either. It is
  // kept as a false-positive guard on the coverage line — the qualifier must appear only when
  // something really was excluded — not as evidence that anything was fixed.
  test('a tree with nothing excluded says nothing about exclusions', () => {
    const r = cli(['--target', fixture({ 'SKILL.md': skillMd('all-source'), 'scripts/a.ts': 'export const x = 1\n' })])
    expect(r.out).toContain('2 of 2 eligible source files scanned under')
    expect(r.out).not.toContain('present-but-excluded')
  })

  // The write-time hook imports this same regex, so both surfaces admit a file type together or
  // neither does — and the case rule must match the `/i` every other file-type gate here uses.
  test('SOURCE_EXT_RE admits .py, .json, .markdown, and any case', () => {
    for (const p of ['/x/scripts/hook.py', '/x/config.json', '/x/a.markdown', '/x/references/NOTE.MD', '/x/scripts/A.TS']) {
      expect([p, probe.SOURCE_EXT_RE.test(p)]).toEqual([p, true])
    }
    expect(probe.SOURCE_EXT_RE.test('/x/assets/logo.png')).toBe(false)
  })

  // The sibling: `runProbe` picked the raw-vs-code view with a case-SENSITIVE `.md` test, so an
  // uppercase `.MD` would have been Markdown to P2 and not Markdown to P6/P7 in the same run. A
  // `Workflow("name")` written in PROSE is a mention, not a call, and only the Markdown branch —
  // which reads `maskNonFenced` — knows that.
  test('an uppercase .MD takes the Markdown predicate path, not the code path', () => {
    const dir = fixture({
      'SKILL.md': skillMd('upper-view'),
      'references/NOTE.MD': 'Never call Workflow("some-name") in prose.\n\nAnd see [x](./gone-view.md).\n',
    })
    const findings = probe.runProbe(dir).findings
    expect(findings.some((f: any) => f.rule.startsWith('P2') && /gone-view\.md/.test(f.detail))).toBe(true)
    expect(findings.some((f: any) => f.rule.startsWith('P6'))).toBe(false)
  })

  test('MARKDOWN_EXT_RE is one spelling, and it is case-insensitive', () => {
    expect(probe.MARKDOWN_EXT_RE.test('/x/a.MD')).toBe(true)
    expect(probe.MARKDOWN_EXT_RE.test('/x/a.markdown')).toBe(true)
    expect(probe.MARKDOWN_EXT_RE.test('/x/a.mdx')).toBe(false)
  })

  // A JS lexer is trusted to find comments on JS only. As a DENYLIST it was the default for every
  // extension nobody listed, which is how a shell file was once read as one unterminated block
  // comment — P2 blinded for the rest of the file, silently. `.py` is now eligible, so the default
  // is load-bearing: a `#` line is not a JS comment, and over-checking it fails LOUD.
  test('a path in a Python comment is over-checked, never silently dropped', () => {
    const dir = fixture({
      'SKILL.md': skillMd('py-comment'),
      'scripts/hook.py': '# see ${CLAUDE_SKILL_DIR}/references/gone-comment.md\nx = 1\n',
    })
    const findings = probe.runProbe(dir).findings
    expect(findings.some((f: any) => /gone-comment\.md/.test(f.detail))).toBe(true)
  })
})

// ------------------------------------------------------------------ D27

// P4's premise was FALSE for a plugin-shipped file, so it fired a finding against correct code and
// its remedy told the author to break it. Measured from the shipped binary (2.1.226): the plugin
// skill/command loader pushes the BODY through `UTe(W,{path,source})`, whose first replace is
// `/\$\{CLAUDE_PLUGIN_ROOT\}/g -> t.path`, and the plugin AGENT loader does the same
// (`T=UTe(u.trim(),{path:o,source:n})`). The non-plugin loader substitutes CLAUDE_SKILL_DIR /
// CLAUDE_PROJECT_DIR / CLAUDE_SESSION_ID and never CLAUDE_PLUGIN_ROOT, so the rule still holds
// outside a plugin. The same binary keeps P1 right: "Plugin agent file ... sets hooks, which is
// ignored for plugin agents."
describe('D27 — P4 is a NON-plugin rule', () => {
  const body = 'The base is ${CLAUDE_PLUGIN_ROOT} for this file.\n'
  const agentMd = ['---', 'name: g', 'description: d', '---', '', body].join('\n')
  const plugin = { '.claude-plugin/plugin.json': '{"name":"p","version":"1.0.0"}\n' }
  const p4In = (r: any) => r.findings.filter((f: any) => f.rule.startsWith('P4'))

  test('a plugin-shipped SKILL.md body using it draws NO P4', () => {
    const dir = fixture({ ...plugin, 'skill/SKILL.md': skillMd('plug-ok', body) })
    expect(p4In(probe.runProbe(join(dir, 'skill')))).toEqual([])
  })

  test('a non-plugin SKILL.md body using it still draws P4', () => {
    const dir = fixture({ 'SKILL.md': skillMd('bare', body) })
    expect(p4In(probe.runProbe(dir)).length).toBe(1)
  })

  // The agent body goes through the same UTe call in the plugin agent loader.
  test('a plugin-shipped agent body draws no P4, a bare one does', () => {
    const shipped = fixture({ ...plugin, 'skill/SKILL.md': skillMd('a1'), 'skill/agents/g.md': agentMd })
    const bare = fixture({ 'SKILL.md': skillMd('a2'), 'agents/g.md': agentMd })
    expect(p4In(probe.runProbe(join(shipped, 'skill')))).toEqual([])
    expect(p4In(probe.runProbe(bare)).length).toBe(1)
  })

  // The write-time hook and the gate must not disagree about the same file, so the exemption is
  // derived from the file's own position rather than passed in by one caller only.
  test('the predicate gates on the file position its two callers share', () => {
    const dir = fixture({ ...plugin, 'skill/SKILL.md': skillMd('p', body) })
    expect(probe.checkPluginRootInBody(join(dir, 'skill/SKILL.md'), skillMd('p', body))).toEqual([])
    expect(probe.checkPluginRootInBody(join(dir, 'skill/SKILL.md'), skillMd('p', body), false).length).toBe(1)
  })

  test('the finding no longer states the false blanket claim', () => {
    const dir = fixture({ 'SKILL.md': skillMd('claim', body) })
    const f = p4In(probe.runProbe(dir))[0]
    expect(f.detail).not.toMatch(/substitutes in hook commands only/)
    expect(f.detail).toMatch(/NOT plugin-shipped/)
    expect(f.remedy).not.toMatch(/keep \$\{CLAUDE_PLUGIN_ROOT\} to hook command strings/)
  })

  // P1's SIBLING refusal is correct for a different reason and must NOT be weakened: a
  // plugin-shipped agent's hooks: block is ignored entirely, so being inside a plugin does not
  // rescue the token there.
  test('P1 still refuses the token in a plugin-shipped agent hooks: command', () => {
    const dir = fixture({
      ...plugin,
      'skill/SKILL.md': skillMd('p1-live'),
      'skill/agents/g.md': ['---', 'name: g', 'description: d', 'hooks:', '  PostToolUse:',
        '    - matcher: "Write"', '      hooks:', '        - type: command',
        '          command: "bun ${CLAUDE_PLUGIN_ROOT}/scripts/x.sh"', '---', '', 'body', ''].join('\n'),
    })
    const out = cli(['--target', join(dir, 'skill')]).out
    expect(out).toContain('P1 hook-registration')
    expect(out).toContain('plugin installation directory')
  })
})

// ------------------------------------------------------------------ D28

/**
 * A NOT CHECKED note is the channel the design asks a reader to AUDIT, so a note naming a path
 * nobody wrote is not cosmetic: it spends the reader's trust on a token they cannot find.
 * `BARE_ABS_RE` has no left anchor, so `<skill>/agents/x-impl.md` matched at the slash and the note
 * announced `/agents/x-impl.md`.
 */
describe('D28 — a NOT CHECKED note names text the source line contains', () => {
  const noteTokens = (out: string) =>
    [...out.matchAll(/NOT CHECKED for "([^"]*)" in ([^\s:]+):(\d+)/g)]
      .map(m => ({ token: m[1], file: m[2], line: Number(m[3]) }))

  test('an angle placeholder head is kept, not stripped to an absolute-looking tail', () => {
    const dir = fixture({ 'SKILL.md': skillMd('tmpl', 'A file at `<skill>/agents/x-impl.md` registers no agent.') })
    const r = cli(['--target', dir])
    expect(r.code).toBe(0)
    expect(r.out).toContain('"<skill>/agents/x-impl.md"')
    expect(r.out).not.toContain('"/agents/x-impl.md"')
  })

  // The sibling form: the same head written with brackets, the notation P5 and `isPathTemplate`
  // already treat as a template everywhere else.
  test('a bracket placeholder head is kept too', () => {
    const dir = fixture({ 'SKILL.md': skillMd('tmpl2', 'see `[plugin]/agents/review/security.md` for the id') })
    const r = cli(['--target', dir])
    expect(r.out).toContain('"[plugin]/agents/review/security.md"')
    expect(r.out).not.toContain('"/agents/review/security.md"')
  })

  // The invariant, over this skill's own run rather than a fixture: the acceptance is a property of
  // the notes channel, not of one token.
  //
  // `includes` alone would NOT discriminate — `/agents/x-impl.md`, the token this block exists to
  // remove, is a substring of the `<skill>/agents/x-impl.md` a reader would search for, so the weak
  // form passes against the broken code. The token must be MAXIMAL: some occurrence of it must not
  // be preceded by a character that would have made it part of a longer written token.
  test('every note the real self-probe emits names a WHOLE token of its own line', () => {
    const self = join(import.meta.dir, '..')
    const found = noteTokens(cli(['--target', self]).out)
    expect(found.length).toBeGreaterThan(0)
    const truncated = found.filter(n => {
      const line = readFileSync(n.file, 'utf8').split('\n')[n.line - 1] ?? ''
      const starts: number[] = []
      for (let i = line.indexOf(n.token); i !== -1; i = line.indexOf(n.token, i + 1)) starts.push(i)
      return !starts.some(i => i === 0 || !/[A-Za-z0-9_$}~/\\:.+>\]-]/.test(line[i - 1]))
    })
    expect(truncated).toEqual([])
  })

  // CONTROLS — the head rule must not swallow a check that was running.
  test('an HTML element abutting a path is not read as a placeholder head', () => {
    const dir = fixture({ 'SKILL.md': skillMd('html', 'run <code>/srv/elsewhere/gone.md</code> now') })
    const r = cli(['--target', dir])
    expect(r.out).toContain('"/srv/elsewhere/gone.md"')
    expect(r.out).toContain('outside this skill')
  })

  test('an ordinary link destination is still resolved against the tree', () => {
    const dir = fixture({ 'SKILL.md': skillMd('lnk', 'see [x](/srv/elsewhere/gone.md)') })
    expect(cli(['--target', dir]).out).toContain('"/srv/elsewhere/gone.md"')
  })

  test('a broken absolute path inside the skill is still a CRITICAL, not a note', () => {
    const dir = fixture({ 'SKILL.md': skillMd('crit', 'x') })
    writeFileSync(join(dir, 'SKILL.md'), skillMd('crit', `see ${join(dir, 'references/gone.md')} for it`))
    const r = cli(['--target', dir])
    expect(r.code).toBe(1)
    expect(r.out).toContain('P2 path-resolution')
  })
})

// ------------------------------------------------------------------ D28

describe('D28 — P3 polices keys the harness ignores, not keys the docs omit', () => {
  // `version` is read by the 2.1.226 binary (`a.version!=null?String(a.version):void 0`, in the
  // plugin skill/command loader, beside `a.name`) but appears in no doc list. P3's whole premise is
  // "an unrecognized key is silently ignored", which is false for it — so flagging it told the
  // authors of correct skills, plugin-dev/command-development among them, to remove a key that works.
  test('a version: key is not an undocumented-key finding', () => {
    const dir = fixture({ 'SKILL.md': '---\nname: v\ndescription: d\nversion: 1.2.3\n---\n\nbody\n' })
    const r = cli(['--target', dir])
    expect(r.out).not.toContain('undocumented frontmatter key')
    expect(r.code).toBe(0)
  })

  test('a genuinely unknown key is still flagged', () => {
    const dir = fixture({ 'SKILL.md': '---\nname: v\ndescription: d\nnot_a_key: x\n---\n\nbody\n' })
    const r = cli(['--target', dir])
    expect(r.code).toBe(1)
    expect(r.out).toContain('undocumented frontmatter key "not_a_key"')
  })
})

// ------------------------------------------------------------------ D29

describe('D29 — a fence demotes PORTABLE references only, and never across occurrences', () => {
  // Cycle 5, critical 1. The blanket fence rule made this skill's OWN mechanicalChecks commands
  // uncheckable: they are absolute paths inside ```js fences, so renaming the probe read CLEAN.
  // A fence holding the literal command a workflow runs verbatim is not an example of anything.
  test('an absolute path in a fence is still a critical', () => {
    // UNDER $HOME. P2 only resolves absolutes inside the skill, its plugin root or $HOME; anything
    // else is an announced skip. The first version of this test used /nonexistent-abs/… and was
    // therefore asserting a critical the containment guard could never produce.
    //
    // Discriminates against c6767139 (the BLANKET demotion), not against c6767139^ — the pre-fence
    // probe criticalled every fenced path, so it passes there too. Check the right revision.
    const abs = join(homedir(), 'nonexistent-abs-xyz', 'scripts', 'wc-probe.ts')
    const dir = fixture({ 'SKILL.md': `${skillMd('abs')}\n\`\`\`js\ncmd: "bun ${abs} --target x"\n\`\`\`\n` })
    const r = cli(['--target', dir])
    expect(r.code).toBe(1)
    expect(r.out).toContain('nonexistent-abs-xyz')
  })

  test('a portable reference in a fence is announced, not a critical', () => {
    const dir = fixture({ 'SKILL.md': `${skillMd('port')}\n\`\`\`\nbun \${CLAUDE_SKILL_DIR}/scripts/example.ts\n\`\`\`\n` })
    const r = cli(['--target', dir])
    expect(r.code).toBe(0)
    expect(r.out).toContain('NOT CHECKED')
  })

  // Cycle 5, critical 2. The note branch shared the `seen` dedupe set with the critical branch, so
  // the FIRST occurrence of a path decided the verdict for every later one — a fenced example above
  // silenced an identical PROSE reference below, and swapping the two paragraphs flipped the exit
  // code on identical claims. Both orders must agree.
  const fence = '```sh\nbun ${CLAUDE_SKILL_DIR}/scripts/gone.ts\n```'
  const prose = 'the runner lives at ${CLAUDE_SKILL_DIR}/scripts/gone.ts in prose.'

  test('a fenced occurrence does not swallow the same reference in prose', () => {
    const dir = fixture({ 'SKILL.md': `${skillMd('ord1')}\n${fence}\n\n${prose}\n` })
    expect(cli(['--target', dir]).code).toBe(1)
  })

  test('the verdict does not depend on which paragraph comes first', () => {
    const a = cli(['--target', fixture({ 'SKILL.md': `${skillMd('ord2')}\n${fence}\n\n${prose}\n` })])
    const b = cli(['--target', fixture({ 'SKILL.md': `${skillMd('ord3')}\n${prose}\n\n${fence}\n` })])
    expect(a.code).toBe(b.code)
  })
})

// ------------------------------------------------------------------ D30

describe('D30 — an unbalanced fence does not switch P2 off for the rest of the file', () => {
  // Cycle 5, critical 3. Demotion is the fail-OPEN direction, and an unclosed fence runs to EOF —
  // so one stray ``` demoted every reference below it. A malformed document is checked, not excused.
  test('references after an UNCLOSED fence are still criticals', () => {
    const dir = fixture({
      'SKILL.md': `${skillMd('unc')}\n\`\`\`sh\necho unclosed\n\nprose [x](./really-missing.md) here.\n`,
    })
    const r = cli(['--target', dir])
    expect(r.code).toBe(1)
    expect(r.out).toContain('really-missing.md')
  })

  test('a properly closed fence still demotes, and prose after it still fails', () => {
    const dir = fixture({
      'SKILL.md': `${skillMd('cls')}\n\`\`\`sh\nbun \${CLAUDE_SKILL_DIR}/scripts/example.ts\n\`\`\`\n\nprose [y](./gone.md)\n`,
    })
    const r = cli(['--target', dir])
    expect(r.code).toBe(1)
    expect(r.out).toContain('NOT CHECKED')
    expect(r.out).toContain('gone.md')
  })
})

// ------------------------------------------------------------------ D31

describe('D31 — the NOT CHECKED channel reaches a consumer', () => {
  // The demotion rested on "announced, not silent". Nothing consumed the announcement: craft's gate
  // reads exitCode, its probe agent captures "the last ~2000 characters" (so the header, and the
  // count, were the first thing truncated), and the write-time surface discarded skips entirely.
  test('a trailing summary carries the counts, so a tail-truncated capture keeps them', () => {
    const dir = fixture({ 'SKILL.md': `${skillMd('tail')}\n\n\`\`\`\nbun \${CLAUDE_SKILL_DIR}/scripts/ex.ts\n\`\`\`\n` })
    const last = cli(['--target', dir]).out.trimEnd().split('\n').pop() ?? ''
    expect(last).toContain('wc-probe: END')
    expect(last).toContain('NOT CHECKED')
  })

  test('the tail line is present on a wholly clean run too', () => {
    const dir = fixture({ 'SKILL.md': skillMd('tail2') })
    expect((cli(['--target', dir]).out.trimEnd().split('\n').pop() ?? '')).toContain('wc-probe: END')
  })
})

// ------------------------------------------------------------------ D32

describe('D32 — a HOME-rooted path in prose is resolved, not discarded', () => {
  // `~` sat in BARE_ABS_RE's "suffix of a longer token" skip class, so `~/notes/x.md` matched the
  // absolute scanner, was thrown away as a token tail, and drew neither a finding nor a note — the
  // silent class inside the rule whose docstring says every skip announces itself.
  test('a broken ~/ path is a critical', () => {
    const dir = fixture({ 'SKILL.md': `${skillMd('tilde')}\nsee ~/nonexistent-xyz-9/rules.md for the rules.\n` })
    const r = cli(['--target', dir])
    expect(r.code).toBe(1)
    expect(r.out).toContain('~/nonexistent-xyz-9/rules.md')
  })

  test('a ~/ path that resolves is clean', () => {
    const dir = fixture({ 'SKILL.md': `${skillMd('tilde2')}\nnotes live at ~/dotfiles/CLAUDE.md today.\n` })
    expect(cli(['--target', dir]).code).toBe(0)
  })

  // The guard it sits inside still has to work: this is a URL tail, not a HOME path.
  test('a path inside a URL is still not treated as HOME-rooted', () => {
    const dir = fixture({ 'SKILL.md': `${skillMd('tilde3')}\nsee https://example.com/~user/docs/x.md online.\n` })
    expect(cli(['--target', dir]).code).toBe(0)
  })
})

// ------------------------------------------------------------------ D33

/**
 * A craft-args fence: one `mechanicalChecks` array of `count` entries and one `reviewLenses`
 * array with the given keys. Every lens declares `refs`, so P7 has nothing to say about it.
 */
const argsFence = (count: number, lensKeys: string[]) =>
  [
    '```js',
    'const args = {',
    '  mechanicalChecks: [',
    ...Array.from({ length: count }, (_, i) => `    { name: "c${i}", cmd: "true" },`),
    '  ],',
    '  reviewLenses: [',
    ...lensKeys.map(k => `    { key: "${k}", refs: [], prompt: "judge ${k}" },`),
    '  ],',
    '}',
    '```',
  ].join('\n')

const rulesOf = (dir: string, prefix: string) =>
  probe.runProbe(dir).findings.filter((f: any) => String(f.rule).startsWith(prefix))

describe('D33 — P10: a workflow declares ONE mechanical entry point', () => {
  test('P10 fires on a craft-args fence declaring two mechanicalChecks entries', () => {
    const dir = fixture({ 'SKILL.md': `${skillMd('two')}\n${argsFence(2, ['a'])}\n` })
    expect(rulesOf(dir, 'P10').length).toBe(1)
    expect(cli(['--target', dir]).code).toBe(1)
  })

  test('P10 is clean on a fence declaring exactly one entry', () => {
    const dir = fixture({ 'SKILL.md': `${skillMd('one')}\n${argsFence(1, ['a'])}\n` })
    expect(rulesOf(dir, 'P10')).toEqual([])
    expect(cli(['--target', dir]).code).toBe(0)
  })

  test('P10 is clean on a two-entry fence a marker declares', () => {
    const dir = fixture({
      'SKILL.md': `${skillMd('marked')}\n<!-- wc-probe: ignore-entry-point -->\n\n${argsFence(2, ['a'])}\n`,
    })
    expect(rulesOf(dir, 'P10')).toEqual([])
    expect(cli(['--target', dir]).code).toBe(0)
  })

  test('P10 counts entries, not commas: a trailing comma is not a third entry', () => {
    const src = ['```js', 'const args = {', '  mechanicalChecks: [', '    { name: "only", cmd: "true" },', '  ],', '}', '```'].join('\n')
    const dir = fixture({ 'SKILL.md': `${skillMd('trail')}\n${src}\n` })
    expect(rulesOf(dir, 'P10')).toEqual([])
  })

  test('the entry-point marker is honoured vocabulary, not a P9 finding', () => {
    expect(probe.KNOWN_EXEMPTION_RULES).toContain('entry-point')
    const dir = fixture({
      'SKILL.md': `${skillMd('vocab')}\n<!-- wc-probe: ignore-entry-point -->\n\n${argsFence(2, ['a'])}\n`,
    })
    expect(rulesOf(dir, 'P9')).toEqual([])
  })
})

// ------------------------------------------------------------------ D34

describe('D34 — P11: two craft-args fences declare the same lens set', () => {
  test('P11 fires when two fences declare different lens sets and nothing declares why', () => {
    const dir = fixture({
      'SKILL.md': `${skillMd('drift')}\n${argsFence(1, ['gate', 'spine', 'scope'])}\n\nprose\n\n${argsFence(1, ['gate', 'spine'])}\n`,
    })
    expect(rulesOf(dir, 'P11').length).toBe(1)
    expect(cli(['--target', dir]).code).toBe(1)
  })

  test('P11 is clean when the two sets match, whatever the order they are written in', () => {
    const dir = fixture({
      'SKILL.md': `${skillMd('same')}\n${argsFence(1, ['gate', 'spine'])}\n\nprose\n\n${argsFence(1, ['spine', 'gate'])}\n`,
    })
    expect(rulesOf(dir, 'P11')).toEqual([])
    expect(cli(['--target', dir]).code).toBe(0)
  })

  test('P11 is clean on a difference a lens-set-differs declaration NAMES', () => {
    const dir = fixture({
      'SKILL.md': `${skillMd('declared')}\n<!-- wc-probe: lens-set-differs scope -->\n\n${argsFence(1, ['gate', 'spine', 'scope'])}\n\nprose\n\n${argsFence(1, ['gate', 'spine'])}\n`,
    })
    expect(rulesOf(dir, 'P11')).toEqual([])
    expect(cli(['--target', dir]).code).toBe(0)
  })

  test('a lens-set-differs declaration names keys space-separated, and covers all of them', () => {
    const dir = fixture({
      'SKILL.md': `${skillMd('multi')}\n<!-- wc-probe: lens-set-differs scope extra -->\n\n${argsFence(1, ['gate', 'scope'])}\n\nprose\n\n${argsFence(1, ['gate', 'extra'])}\n`,
    })
    expect(rulesOf(dir, 'P11')).toEqual([])
  })

  test('a difference the declaration does NOT name is still a finding', () => {
    const dir = fixture({
      'SKILL.md': `${skillMd('partial')}\n<!-- wc-probe: lens-set-differs scope -->\n\n${argsFence(1, ['gate', 'spine', 'scope'])}\n\nprose\n\n${argsFence(1, ['gate'])}\n`,
    })
    expect(rulesOf(dir, 'P11').length).toBe(1)
    expect(rulesOf(dir, 'P11')[0].detail).toContain('spine')
  })

  // The point of the declaration: P11 polices exactly one file per skill, so a whole-file
  // suppression is indistinguishable from not having the rule.
  test('P11 STILL FIRES on a file carrying a bare ignore-lens-set-parity marker', () => {
    const dir = fixture({
      'SKILL.md': `${skillMd('unsuppressable')}\n<!-- wc-probe: ignore-lens-set-parity -->\n\n${argsFence(1, ['gate', 'spine', 'scope'])}\n\nprose\n\n${argsFence(1, ['gate', 'spine'])}\n`,
    })
    expect(rulesOf(dir, 'P11').length).toBe(1)
    expect(cli(['--target', dir]).code).toBe(1)
  })

  test('nor can ignore-all silence P11', () => {
    const dir = fixture({
      'SKILL.md': `${skillMd('ignoreall')}\n<!-- wc-probe: ignore-all -->\n\n${argsFence(1, ['gate', 'spine', 'scope'])}\n\nprose\n\n${argsFence(1, ['gate', 'spine'])}\n`,
    })
    expect(rulesOf(dir, 'P11').length).toBe(1)
  })

  test('one craft-args fence has nothing to disagree with', () => {
    const dir = fixture({ 'SKILL.md': `${skillMd('single')}\n${argsFence(1, ['gate'])}\n` })
    expect(rulesOf(dir, 'P11')).toEqual([])
  })

  test('a fence that omits reviewLenses declares the EMPTY set, and that is a difference', () => {
    const bare = ['```js', 'const args = {', '  mechanicalChecks: [', '    { name: "c", cmd: "true" },', '  ],', '}', '```'].join('\n')
    const dir = fixture({ 'SKILL.md': `${skillMd('absent')}\n${argsFence(1, ['gate'])}\n\nprose\n\n${bare}\n` })
    expect(rulesOf(dir, 'P11').length).toBe(1)
  })

  test('lens-set-parity is NOT exemption vocabulary, so ignore-lens-set-parity is a P9 finding', () => {
    expect(probe.KNOWN_EXEMPTION_RULES).not.toContain('lens-set-parity')
    const dir = fixture({
      'SKILL.md': `${skillMd('vocab2')}\n<!-- wc-probe: ignore-lens-set-parity -->\n\n${argsFence(1, ['gate'])}\n\nprose\n\n${argsFence(1, ['spine'])}\n`,
    })
    expect(rulesOf(dir, 'P9').length).toBe(1)
  })

  test('the declaration is not an exemption: it does not route through EXEMPT_LINE_RE', () => {
    const text = '<!-- wc-probe: lens-set-differs scope -->\n'
    expect(probe.parseExemptions('SKILL.md', text)).toEqual([])
    expect(probe.parseLensSetDiffers('SKILL.md', text).map((d: any) => d.keys)).toEqual([['scope']])
  })

  test('a declaration inside a fenced block is an example, not a declaration', () => {
    const dir = fixture({
      'SKILL.md': `${skillMd('fenced')}\n\`\`\`text\n<!-- wc-probe: lens-set-differs scope -->\n\`\`\`\n\n${argsFence(1, ['gate', 'scope'])}\n\nprose\n\n${argsFence(1, ['gate'])}\n`,
    })
    expect(rulesOf(dir, 'P11').length).toBe(1)
  })
})

// ------------------------------------------------------------------ D35

/** A craft-args fence carrying a `projectDir` string literal. */
const argsFenceWithProjectDir = (projectDir: string) =>
  [
    '```js',
    'const args = {',
    `  projectDir: "${projectDir}",`,
    '  mechanicalChecks: [',
    '    { name: "c0", cmd: "true" },',
    '  ],',
    '  reviewLenses: [',
    '    { key: "gate", refs: [], prompt: "judge gate" },',
    '  ],',
    '}',
    '```',
  ].join('\n')

/** A fixture that is its own repository, so P12(b) has a containing repo to measure against. */
function repoFixture(files: Record<string, string>): string {
  const dir = fixture({ ...files, '.git/HEAD': 'ref: refs/heads/main\n' })
  return dir
}

describe('D35 — P12: a craft-args fence dispatches through craft-dispatch.sh', () => {
  test('(a) naming a runner and never craft-dispatch.sh is a CRITICAL', () => {
    const dir = fixture({
      'SKILL.md': `${skillMd('handrolled', 'Dispatch with `farm.sh` and the args file.')}\n${argsFence(1, ['gate'])}\n`,
    })
    const found = rulesOf(dir, 'P12')
    expect(found.length).toBe(1)
    expect(found[0].severity).toBe('critical')
    expect(cli(['--target', dir]).code).toBe(1)
  })

  // The rule is "hand-rolled instead of craft-dispatch.sh", not "the runner that happened to exist
  // when it was written": keyed on a filename it retires itself silently at the next rename.
  test('(a) fires whatever the hand-rolled runner is called', () => {
    for (const runner of ['farm.sh', 'farm-legacy.ts', 'run-agents.mjs', 'dispatch-v2.js']) {
      const dir = fixture({
        'SKILL.md': `${skillMd('handrolled', `Dispatch with \`${runner}\` and the args file.`)}\n${argsFence(1, ['gate'])}\n`,
      })
      const found = rulesOf(dir, 'P12')
      expect(found.length).toBe(1)
      expect(found[0].severity).toBe('critical')
      expect(found[0].detail).toContain(runner)
    }
  })

  test('(a) the finding points at the line that names the runner', () => {
    const body = ['prose', '', 'Dispatch with `farm.sh`, absolute --args.'].join('\n')
    const dir = fixture({ 'SKILL.md': `${skillMd('lineno', body)}\n${argsFence(1, ['gate'])}\n` })
    const found = rulesOf(dir, 'P12')
    expect(found.length).toBe(1)
    const text = read(join(dir, 'SKILL.md')).split('\n')
    expect(text[found[0].line - 1]).toContain('farm.sh')
  })

  // A script named inside a fence is a mechanicalChecks command, not a claim about the dispatch.
  test('(a) says nothing about a script named only inside a fence', () => {
    const fence = argsFence(1, ['gate']).replace('cmd: "true"', 'cmd: "bash mech-all.sh"')
    const dir = fixture({ 'SKILL.md': `${skillMd('mech', 'Craft owns the invocation.')}\n${fence}\n` })
    expect(rulesOf(dir, 'P12')).toEqual([])
  })

  // CONTROL: naming a script is not routing through it — `workshop/SKILL.md` says it ships NO
  // workflow.js, and a rule that read the filename alone called that a hand-rolled dispatch.
  test('(a) says nothing about a script the file names without claiming as its dispatch', () => {
    const body = 'It ships no `workflow.js` and restates none of craft\'s mechanics.'
    const dir = fixture({ 'SKILL.md': `${skillMd('mentions', body)}\n${argsFence(1, ['gate'])}\n` })
    expect(rulesOf(dir, 'P12')).toEqual([])
    expect(cli(['--target', dir]).code).toBe(0)
  })

  test('(a) is clean when the file also names craft-dispatch.sh', () => {
    const body = 'Dispatch through `craft-dispatch.sh`, never a hand-written `farm.sh` line.'
    const dir = fixture({ 'SKILL.md': `${skillMd('routed', body)}\n${argsFence(1, ['gate'])}\n` })
    expect(rulesOf(dir, 'P12')).toEqual([])
    expect(cli(['--target', dir]).code).toBe(0)
  })

  test('(a) a file naming NEITHER entry point is not judged', () => {
    const body = 'Craft owns the invocation, the wait and the return shape.'
    const dir = fixture({ 'SKILL.md': `${skillMd('unnamed', body)}\n${argsFence(1, ['gate'])}\n` })
    expect(rulesOf(dir, 'P12')).toEqual([])
  })

  test('(a) a file naming a runner but emitting NO craft-args fence is not judged', () => {
    const dir = fixture({ 'SKILL.md': skillMd('nofence', 'Dispatch with `farm.sh`.') })
    expect(rulesOf(dir, 'P12')).toEqual([])
  })

  test('(a) an ignore-dispatch marker suppresses it', () => {
    const body = ['<!-- wc-probe: ignore-dispatch -->', '', 'Dispatch with `farm.sh`.'].join('\n')
    const dir = fixture({ 'SKILL.md': `${skillMd('marked', body)}\n${argsFence(1, ['gate'])}\n` })
    expect(rulesOf(dir, 'P12')).toEqual([])
    expect(cli(['--target', dir]).code).toBe(0)
  })

  test('the dispatch marker is honoured vocabulary, not a P9 finding', () => {
    expect(probe.KNOWN_EXEMPTION_RULES).toContain('dispatch')
    const body = ['<!-- wc-probe: ignore-dispatch -->', '', 'Dispatch with `farm.sh`.'].join('\n')
    const dir = fixture({ 'SKILL.md': `${skillMd('vocab3', body)}\n${argsFence(1, ['gate'])}\n` })
    expect(rulesOf(dir, 'P9')).toEqual([])
  })

  test('(b) a projectDir outside the containing repo with no --run-dir is a MAJOR', () => {
    const dir = repoFixture({
      'SKILL.md': `${skillMd('foreign', 'Routed through `craft-dispatch.sh`.')}\n${argsFenceWithProjectDir('/home/user/areas/example')}\n`,
    })
    const found = rulesOf(dir, 'P12').filter((f: any) => f.severity === 'major')
    expect(found.length).toBe(1)
    expect(found[0].detail).toContain('/home/user/areas/example')
    expect(cli(['--target', dir]).code).toBe(1)
  })

  test('(b) is clean when the file passes --run-dir somewhere', () => {
    const body = ['Routed through `craft-dispatch.sh`.', '', '    --run-dir /home/user/.local/state/craft'].join('\n')
    const dir = repoFixture({
      'SKILL.md': `${skillMd('rundir', body)}\n${argsFenceWithProjectDir('/home/user/areas/example')}\n`,
    })
    expect(rulesOf(dir, 'P12')).toEqual([])
    expect(cli(['--target', dir]).code).toBe(0)
  })

  test('(b) is clean when projectDir lies inside the containing repo', () => {
    const dir = repoFixture({ 'SKILL.md': `${skillMd('own', 'Routed through `craft-dispatch.sh`.')}\n${argsFenceWithProjectDir('__DIR__')}\n` })
    const p = join(dir, 'SKILL.md')
    writeFileSync(p, read(p).split('__DIR__').join(dir))
    expect(rulesOf(dir, 'P12')).toEqual([])
  })

  test('(b) says nothing when no repository contains the file', () => {
    const dir = fixture({
      'SKILL.md': `${skillMd('norepo', 'Routed through `craft-dispatch.sh`.')}\n${argsFenceWithProjectDir('/home/user/areas/example')}\n`,
    })
    expect(rulesOf(dir, 'P12')).toEqual([])
  })

  test('(b) says nothing about a projectDir that is not an absolute literal', () => {
    const dir = repoFixture({
      'SKILL.md': `${skillMd('template', 'Routed through `craft-dispatch.sh`.')}\n${argsFenceWithProjectDir('<proj>')}\n`,
    })
    expect(rulesOf(dir, 'P12')).toEqual([])
  })

  test('craftArgsFences reports the projectDir literal P12(b) reads', () => {
    const fences = probe.craftArgsFences(argsFenceWithProjectDir('/home/user/areas/example'))
    expect(fences.length).toBe(1)
    expect(fences[0].projectDir).toBe('/home/user/areas/example')
    expect(fences[0].projectDirLine).toBe(3)
  })

  // CONTROL: the corpus this rule was written against must stay silent on the generator itself.
  test('P12 draws nothing on workflow-creator itself', () => {
    expect(rulesOf(SKILL_DIR, 'P12')).toEqual([])
  })
})

// ------------------------------------------------------------------ D36

/**
 * A craft-args fence that enumerates instances three ways — the `--lecture NN:` specs of the one
 * mechanical command, the `scoredChecks[].items` lines, and the numeric suffix of a lens key — over
 * whatever `tasks[]` rows are given.
 */
const argsFenceWithTasks = (opts: {
  taskIds: string[]
  lectures?: string[]
  scoredIds?: string[]
  lensIds?: string[]
  hasTasksKey?: boolean
}) => {
  const lectures = opts.lectures ?? []
  const scoredIds = opts.scoredIds ?? []
  const lensIds = opts.lensIds ?? []
  const specs = lectures.map(n => `--lecture ${n}:decks/${n}.typ:inv/${n}.md`).join(' ')
  return [
    '```js',
    'const args = {',
    ...(opts.hasTasksKey === false
      ? []
      : [
          '  tasks: [',
          ...opts.taskIds.map(
            id =>
              `    { id: "${id}", name: "${id}", work: "w", writablePaths: ["/tmp/${id}"], refs: [], acceptance: "\`true\` exits 0" },`,
          ),
          '  ],',
        ]),
    '  mechanicalChecks: [',
    `    { name: "mech", cmd: "bash mech-all.sh ${specs}" },`,
    '  ],',
    ...(scoredIds.length
      ? [
          '  scoredChecks: [{',
          '    key: "audit",',
          '    items: [',
          ...scoredIds.map(n => `      "${n} | deck=/tmp/${n}.typ",`),
          '    ],',
          '    refs: [],',
          '    schema: { type: "object", properties: { missingItems: { type: "array", items: { type: "string" } } } },',
          '  }],',
        ]
      : []),
    '  reviewLenses: [',
    ...lensIds.map(n => `    { key: "coverage-fidelity-${n}", refs: [], prompt: "judge ${n}" },`),
    '    { key: "scope-fidelity", refs: [], prompt: "judge scope" },',
    '  ],',
    '}',
    '```',
  ].join('\n')
}

describe('D36 — P13: every enumerated instance has a task row', () => {
  test('an id enumerated by all three arrays and covered by no task row is a MAJOR', () => {
    const dir = fixture({
      'SKILL.md': `${skillMd('gap')}\n${argsFenceWithTasks({
        taskIds: ['content-18', 'polish-18'],
        lectures: ['18', '19'],
        scoredIds: ['18', '19'],
        lensIds: ['18', '19'],
      })}\n`,
    })
    const found = rulesOf(dir, 'P13')
    expect(found.length).toBe(1)
    expect(found[0].severity).toBe('major')
    expect(found[0].detail).toContain('19')
    expect(found[0].detail).toContain('scoredChecks[].items')
    expect(found[0].detail).toContain('reviewLenses[].key')
    expect(found[0].detail).toContain('mechanicalChecks cmd')
    expect(cli(['--target', dir]).code).toBe(1)
  })

  test('the finding points at the fence that enumerates the id', () => {
    const fence = argsFenceWithTasks({ taskIds: ['content-18'], lectures: ['18', '19'] })
    const dir = fixture({ 'SKILL.md': `${skillMd('lineno')}\n${fence}\n` })
    const found = rulesOf(dir, 'P13')
    expect(found.length).toBe(1)
    const lines = read(join(dir, 'SKILL.md')).split('\n')
    expect(lines[found[0].line - 1]).toBe('```js')
  })

  test('one finding per uncovered id, not one per array that enumerates it', () => {
    const dir = fixture({
      'SKILL.md': `${skillMd('two-gaps')}\n${argsFenceWithTasks({
        taskIds: ['content-18'],
        lectures: ['18', '19', '20'],
        scoredIds: ['18', '19', '20'],
        lensIds: ['18', '19', '20'],
      })}\n`,
    })
    const found = rulesOf(dir, 'P13')
    expect(found.length).toBe(2)
    expect(found.map((f: any) => f.detail).join(' ')).toContain('"19"')
    expect(found.map((f: any) => f.detail).join(' ')).toContain('"20"')
  })

  test('a task id carrying the id as a digit run covers it, whatever the surrounding text', () => {
    const dir = fixture({
      'SKILL.md': `${skillMd('covered')}\n${argsFenceWithTasks({
        taskIds: ['r18-align', 'c18-notes', 'deck-19', 'inventory-19'],
        lectures: ['18', '19'],
        scoredIds: ['18', '19'],
        lensIds: ['18', '19'],
      })}\n`,
    })
    expect(rulesOf(dir, 'P13')).toEqual([])
    expect(cli(['--target', dir]).code).toBe(0)
  })

  test('coverage is by whole digit run: task 190 does not cover instance 19', () => {
    const dir = fixture({
      'SKILL.md': `${skillMd('prefix')}\n${argsFenceWithTasks({ taskIds: ['deck-190'], lectures: ['19'] })}\n`,
    })
    expect(rulesOf(dir, 'P13').length).toBe(1)
  })

  test('a fence with tasks: [] is skipped entirely — a readOnly charter has none', () => {
    const dir = fixture({
      'SKILL.md': `${skillMd('charter')}\n${argsFenceWithTasks({
        taskIds: [],
        lectures: ['18', '19'],
        scoredIds: ['18', '19'],
        lensIds: ['18', '19'],
      })}\n`,
    })
    expect(rulesOf(dir, 'P13')).toEqual([])
    expect(cli(['--target', dir]).code).toBe(0)
  })

  test('a fence declaring no tasks key at all is skipped', () => {
    const dir = fixture({
      'SKILL.md': `${skillMd('notasks')}\n${argsFenceWithTasks({
        taskIds: [],
        hasTasksKey: false,
        lectures: ['18', '19'],
        lensIds: ['18', '19'],
      })}\n`,
    })
    expect(rulesOf(dir, 'P13')).toEqual([])
  })

  test('a non-numeric lens suffix is not an instance id', () => {
    const dir = fixture({
      'SKILL.md': `${skillMd('suffix')}\n${argsFenceWithTasks({ taskIds: ['content-18'], lectures: ['18'] })}\n`,
    })
    expect(rulesOf(dir, 'P13')).toEqual([])
  })

  test('an ignore-task-coverage marker suppresses it', () => {
    const dir = fixture({
      'SKILL.md': `${skillMd('marked', '<!-- wc-probe: ignore-task-coverage -->')}\n${argsFenceWithTasks({
        taskIds: ['content-18'],
        lectures: ['18', '19'],
      })}\n`,
    })
    expect(rulesOf(dir, 'P13')).toEqual([])
    expect(cli(['--target', dir]).code).toBe(0)
  })

  test('the task-coverage marker is honoured vocabulary, not a P9 finding', () => {
    expect(probe.KNOWN_EXEMPTION_RULES).toContain('task-coverage')
    const dir = fixture({
      'SKILL.md': `${skillMd('vocab4', '<!-- wc-probe: ignore-task-coverage -->')}\n${argsFenceWithTasks({
        taskIds: ['content-18'],
        lectures: ['18', '19'],
      })}\n`,
    })
    expect(rulesOf(dir, 'P9')).toEqual([])
  })

  test('craftArgsFences reports the task ids and enumerated instances P13 reads', () => {
    const fences = probe.craftArgsFences(
      argsFenceWithTasks({ taskIds: ['content-18'], lectures: ['18', '19'], scoredIds: ['19'], lensIds: ['19'] }),
    )
    expect(fences.length).toBe(1)
    expect(fences[0].taskIds).toEqual(['content-18'])
    expect(fences[0].instanceIds.map((i: any) => i.id).sort()).toEqual(['18', '19'])
    const nineteen = fences[0].instanceIds.find((i: any) => i.id === '19')
    expect(nineteen.sources.sort()).toEqual(['mechanicalChecks cmd', 'reviewLenses[].key', 'scoredChecks[].items'])
  })

  // CONTROLS: the corpus this rule was written against must stay silent where it is correct.
  test('P13 draws nothing on workflow-creator itself', () => {
    expect(rulesOf(SKILL_DIR, 'P13')).toEqual([])
  })

  test('P13 draws nothing on the notes skill, whose every lecture has a task chain', () => {
    expect(rulesOf(join(dirname(SKILL_DIR), 'notes'), 'P13')).toEqual([])
  })
})
