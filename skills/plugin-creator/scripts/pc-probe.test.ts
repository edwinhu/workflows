#!/usr/bin/env bun
/**
 * pc-probe.test.ts — the checker-shape probe's own suite.
 *
 *   bun test ${CLAUDE_PLUGIN_ROOT}/skills/plugin-creator/scripts/pc-probe.test.ts
 *
 * One fixture per invariant, each modelled on the REAL defect that invariant is named after (see
 * pc-probe.ts's header for the citations). Plus the two fixtures that matter most: a CLEAN one, so
 * the probe can be shown not to fire on correct structure, and an UNRESOLVABLE one, so I7 is shown
 * reporting could-not-run rather than passing.
 *
 * Predicates are reached through a loose alias (`probe`) rather than named imports, for the reason
 * wc-probe.test.ts gives: a test for a not-yet-written export must fail as ONE failing test, not as
 * a module-load error that takes the whole file down.
 */

import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import * as CcProbe from './pc-probe.ts'

const probe: any = CcProbe

const SELF_DIR = import.meta.dir

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'pc-probe-test-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

/** Run the CLI out-of-process so the test covers main()/argv, not just runProbe(). */
function cli(args: string[]): { code: number; out: string; err: string } {
  const r = Bun.spawnSync(['bun', join(SELF_DIR, 'pc-probe.ts'), ...args])
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() }
}

const PLUGIN_JSON = JSON.stringify({ name: 'fx', version: '0.0.1', description: 'fixture' })

const skillMd = (name: string, body = '') =>
  ['---', `name: ${name}`, `description: fixture skill ${name}`, '---', '', `# ${name}`, '', body, ''].join('\n')

/**
 * A pattern-table module carrying the check-all contract.
 *
 * Padded to three entries because the probe requires three: one regex in a module is a helper, a
 * table is a rule set, and every real table in this plugin carries dozens. The filler rows are
 * inert — they match nothing any invariant looks at.
 */
const tableModule = (constraint: string, entries: string[], severity = 'soft') =>
  [
    '"""A fixture pattern table."""',
    `CONSTRAINT = "${constraint}"`,
    'APPLIES_TO = ["writing-draft"]',
    `SEVERITY = "${severity}"`,
    '',
    '_PATTERNS = [',
    ...entries,
    '    (r"\\bzzqqfiller1\\b", "filler"),',
    '    (r"\\bzzqqfiller2\\b", "filler"),',
    '    (r"\\bzzqqfiller3\\b", "filler"),',
    ']',
    '',
    '',
    'def check(context):',
    '    return []',
    '',
    'if __name__ == "__main__":',
    '    print(check({}))',
    '',
  ].join('\n')

/** The rejected: half of an ai-tic corpus dictionary, in tics.yaml's real shape. */
const TICS_YAML = [
  'meta:',
  '  human_corpus_sentences: 14294148',
  'rejected:',
  '  - {label: "\'it is important to note that\'", human_count: 247, rate_per_M: 44.42}',
  '  - {label: "caveat opener \'Of course,\'", human_count: 5531, rate_per_M: 386.94}',
  '',
].join('\n')

const findingsFor = (result: any, rule: string) =>
  (result.findings as any[]).filter(f => String(f.rule).startsWith(rule))

// ------------------------------------------------------------------ I1

describe('I1 — at most one deterministic engine per domain', () => {
  // Modelled on scripts/prose-lint.py: a second prose engine loading the SAME pattern tables as
  // scripts/prose-audit.py, with no delegation between them.
  test('two engines consuming the same pattern table is a finding', () => {
    const dir = fixture({
      'plugin.json': PLUGIN_JSON,
      'skills/writing/SKILL.md': skillMd('writing'),
      'skills/writing/references/volokh.py': tableModule('volokh', ['    (r"\\bpursuant to\\b", "legalese"),']),
      'scripts/prose-audit.py': [
        'from pathlib import Path',
        'TABLES = [Path(__file__).parent.parent / "skills" / "writing" / "references" / "volokh.py"]',
        'ATTR = "_PATTERNS"',
        '',
        'if __name__ == "__main__":',
        '    print(TABLES)',
        '',
      ].join('\n'),
      'scripts/prose-lint.py': [
        'from pathlib import Path',
        'TABLES = [Path(__file__).parent.parent / "skills" / "writing" / "references" / "volokh.py"]',
        'ATTR = "_PATTERNS"',
        '',
        'if __name__ == "__main__":',
        '    print(TABLES)',
        '',
      ].join('\n'),
      'hooks/hooks.json': JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: 'Edit',
              hooks: [{ type: 'command', command: 'python3 ${CLAUDE_PLUGIN_ROOT}/scripts/prose-audit.py' }],
            },
          ],
        },
      }),
      'scripts/run.sh': '#!/bin/bash\npython3 "$(dirname "$0")/prose-lint.py" "$@"\n',
    })
    const result = probe.runProbe(dir)
    const i1 = findingsFor(result, 'I1')
    expect(i1.length).toBe(1)
    expect(i1[0].detail).toContain('volokh.py')
  })

  test('a second engine that delegates to the first is not a finding', () => {
    const dir = fixture({
      'plugin.json': PLUGIN_JSON,
      'skills/writing/SKILL.md': skillMd('writing'),
      'skills/writing/references/volokh.py': tableModule('volokh', ['    (r"\\bpursuant to\\b", "legalese"),']),
      'scripts/prose-audit.py': [
        'from pathlib import Path',
        'TABLES = [Path(__file__).parent.parent / "skills" / "writing" / "references" / "volokh.py"]',
        'ATTR = "_PATTERNS"',
        '',
      ].join('\n'),
      'scripts/de-ai-audit.py': [
        '# A documented shim: it SPAWNS the one engine rather than re-deriving it.',
        'import subprocess',
        'from pathlib import Path',
        'ENGINE = Path(__file__).parent / "prose-audit.py"',
        'TABLES = [Path(__file__).parent.parent / "skills" / "writing" / "references" / "volokh.py"]',
        'ATTR = "_PATTERNS"',
        'subprocess.run(["python3", str(ENGINE)])',
        '',
      ].join('\n'),
      'hooks/hooks.json': JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: 'Edit',
              hooks: [
                { type: 'command', command: 'python3 ${CLAUDE_PLUGIN_ROOT}/scripts/prose-audit.py' },
                { type: 'command', command: 'python3 ${CLAUDE_PLUGIN_ROOT}/scripts/de-ai-audit.py' },
              ],
            },
          ],
        },
      }),
    })
    expect(findingsFor(probe.runProbe(dir), 'I1').length).toBe(0)
  })

  test('two modules declaring the same CONSTRAINT is a finding', () => {
    const dir = fixture({
      'plugin.json': PLUGIN_JSON,
      'skills/writing/SKILL.md': skillMd('writing'),
      'skills/writing/references/a.py': tableModule('no-bold-lead', ['    (r"^\\*\\*", "bold lead"),']),
      'constraints/b.py': tableModule('no-bold-lead', ['    (r"^\\*\\*", "bold lead"),']),
      'scripts/run-constraints.py': 'APPLIES_TO_ATTR = "APPLIES_TO"\nSEVERITY_ATTR = "SEVERITY"\n',
      'hooks/hooks.json': JSON.stringify({
        hooks: {
          PostToolUse: [
            { matcher: 'Edit', hooks: [{ type: 'command', command: 'python3 ${CLAUDE_PLUGIN_ROOT}/scripts/run-constraints.py' }] },
          ],
        },
      }),
    })
    const i1 = findingsFor(probe.runProbe(dir), 'I1')
    expect(i1.length).toBe(1)
    expect(i1[0].detail).toContain('no-bold-lead')
  })
})

// ------------------------------------------------------------------ I2

describe('I2 — at most one lens per domain', () => {
  // Modelled on the prose-register lens and the slide-register system making the same claim about
  // the same three string literals: two lenses that quote the same literal are one claim, twice.
  test('two lenses quoting the same literal is a finding', () => {
    const lens = (key: string, quoted: string) =>
      `  reviewLenses: [\n    { key: "${key}", agentType: "Explore", refs: [], prompt: "Judge the register; flag a bullet like ${quoted}." },\n  ],\n`
    const dir = fixture({
      'plugin.json': PLUGIN_JSON,
      'skills/writing/SKILL.md': skillMd('writing', '```js\nWorkflow({\n' + lens('prose-register', "'The answer:'") + '})\n```'),
      'skills/slides/SKILL.md': skillMd('slides', '```js\nWorkflow({\n' + lens('slide-register', "'The answer:'") + '})\n```'),
    })
    const i2 = findingsFor(probe.runProbe(dir), 'I2')
    expect(i2.length).toBe(1)
    expect(i2[0].detail).toContain('The answer:')
  })

  test('two lenses with distinct claims draw nothing', () => {
    const dir = fixture({
      'plugin.json': PLUGIN_JSON,
      'skills/writing/SKILL.md': skillMd(
        'writing',
        '```js\nWorkflow({\n  reviewLenses: [\n' +
          '    { key: "scope-fidelity", agentType: "Explore", refs: [], prompt: "Did the changes stay inside the plan?" },\n' +
          '    { key: "writing-judgement", agentType: "Explore", refs: [], prompt: "Judge COVER, FIDELITY, TRANSITION and COUNTER." },\n' +
          '  ],\n})\n```',
      ),
    })
    expect(findingsFor(probe.runProbe(dir), 'I2').length).toBe(0)
  })
})

// ------------------------------------------------------------------ I3

describe('I3 — every engine has at least one live caller', () => {
  // Modelled on scripts/prose-lint.py, ai-tic/linter/score.py and scripts/check-all.sh: ~330 dead
  // lines, one of them named by a test file that never calls it.
  test('an engine named only by a comment, a doc and a test has no live caller', () => {
    const dir = fixture({
      'plugin.json': PLUGIN_JSON,
      'skills/writing/SKILL.md': skillMd('writing', 'Historically we ran prose-lint.py here.'),
      'scripts/prose-lint.py': 'CONSTRAINT = "prose-lint"\nSEVERITY = "soft"\n\ndef check(c):\n    return []\n',
      'scripts/prose-audit.py': '# the engine that replaced prose-lint.py\nCONSTRAINT = "prose-audit"\nSEVERITY = "soft"\n\ndef check(c):\n    return []\n',
      'hooks/hooks.json': JSON.stringify({
        hooks: {
          PostToolUse: [
            { matcher: 'Edit', hooks: [{ type: 'command', command: 'python3 ${CLAUDE_PLUGIN_ROOT}/scripts/prose-audit.py' }] },
          ],
        },
      }),
      'tests/test_prose_lint.py': '# tests the hook, not prose-lint.py — it is never invoked here\n',
      // Backticked, because that is the form that fooled the probe: a design doc naming the engine
      // in an inline code span read as a live caller for the deadest file in the repo.
      'CHANGELOG.md': '- removed the `scripts/prose-lint.py` caller\n',
      'docs/DESIGN.md': '| `scripts/prose-lint.py` | B + D | `hooks/writing-prose-check.ts` |\n',
    })
    const i3 = findingsFor(probe.runProbe(dir), 'I3')
    expect(i3.length).toBe(1)
    expect(i3[0].file.endsWith(join('scripts', 'prose-lint.py'))).toBe(true)
  })

  test('a contract module discovered by a live runner is called', () => {
    const dir = fixture({
      'plugin.json': PLUGIN_JSON,
      'skills/writing/SKILL.md': skillMd('writing'),
      'skills/writing/references/topic-sentences.py': tableModule('topic-sentences', ['    (r"\\bfoo\\b", "foo"),']),
      'constraints/run-constraints.py': [
        'from pathlib import Path',
        'def run(root):',
        '    for py in sorted(Path(root).glob("*/references/*.py")):',
        '        mod = load(py)',
        '        if getattr(mod, "APPLIES_TO", None) and getattr(mod, "SEVERITY", None):',
        '            mod.check({})',
        '',
      ].join('\n'),
      'hooks/hooks.json': JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: 'Edit',
              hooks: [{ type: 'command', command: 'python3 ${CLAUDE_PLUGIN_ROOT}/constraints/run-constraints.py' }],
            },
          ],
        },
      }),
    })
    expect(findingsFor(probe.runProbe(dir), 'I3').length).toBe(0)
  })
})

// ------------------------------------------------------------------ I4

describe('I4 — a computed path literal must resolve', () => {
  // Modelled on skills/writing/references/writing-no-bold-lead.py:30 — parents[2] where all ten
  // siblings use parents[3]. It resolves to a path that does not exist, the subprocess raises, a
  // bare except swallows it, and the constraint is filed under `passed`.
  test('parents[2] where the file needs parents[3] is a finding', () => {
    const dir = fixture({
      'plugin.json': PLUGIN_JSON,
      'scripts/prose-audit.py': 'CONSTRAINT = "prose-audit"\nSEVERITY = "soft"\n',
      'skills/writing/SKILL.md': skillMd('writing'),
      'skills/writing/references/no-bold-lead.py': [
        'from pathlib import Path',
        'CONSTRAINT = "no-bold-lead"',
        'APPLIES_TO = ["writing-draft"]',
        'SEVERITY = "hard"',
        'PROSE_AUDIT = Path(__file__).resolve().parents[2] / "scripts" / "prose-audit.py"',
        '',
        'def check(context):',
        '    return []',
        '',
      ].join('\n'),
      'hooks/hooks.json': JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: 'Edit',
              hooks: [{ type: 'command', command: 'python3 ${CLAUDE_PLUGIN_ROOT}/skills/writing/references/no-bold-lead.py' }],
            },
          ],
        },
      }),
    })
    const i4 = findingsFor(probe.runProbe(dir), 'I4')
    expect(i4.length).toBe(1)
    expect(i4[0].detail).toContain('prose-audit.py')
  })

  test('the same reference with parents[3] resolves and draws nothing', () => {
    const dir = fixture({
      'plugin.json': PLUGIN_JSON,
      'scripts/prose-audit.py': 'CONSTRAINT = "prose-audit"\nSEVERITY = "soft"\n',
      'skills/writing/SKILL.md': skillMd('writing'),
      'skills/writing/references/no-bold-lead.py': [
        'from pathlib import Path',
        'CONSTRAINT = "no-bold-lead"',
        'APPLIES_TO = ["writing-draft"]',
        'SEVERITY = "hard"',
        'PROSE_AUDIT = Path(__file__).resolve().parents[3] / "scripts" / "prose-audit.py"',
        '',
        'def check(context):',
        '    return []',
        '',
      ].join('\n'),
      'hooks/hooks.json': JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: 'Edit',
              hooks: [
                { type: 'command', command: 'python3 ${CLAUDE_PLUGIN_ROOT}/skills/writing/references/no-bold-lead.py' },
              ],
            },
          ],
        },
      }),
    })
    expect(findingsFor(probe.runProbe(dir), 'I4').length).toBe(0)
  })
})

// ------------------------------------------------------------------ I5

describe('I5 — a suppression entry must match at least one live label', () => {
  // Modelled on hooks/writing-prose-check.ts:49-53 — the tables moved from skills/writing-*/ to
  // skills/writing/references/ (slash, not hyphen), so both surviving entries match nothing and
  // Strunk/Volokh/McCloskey have been double-reported ever since.
  test('a prefix that matches no label is a finding, per entry', () => {
    const dir = fixture({
      'plugin.json': PLUGIN_JSON,
      'skills/writing/SKILL.md': skillMd('writing'),
      'skills/writing/references/volokh.py': tableModule('volokh', ['    (r"\\bpursuant to\\b", "legalese"),']),
      'skills/ai-anti-patterns/SKILL.md': skillMd('ai-anti-patterns'),
      'skills/ai-anti-patterns/references/wikipedia-puffery.py': tableModule('wiki-puffery', ['    (r"\\brich tapestry\\b", "puffery"),']),
      'hooks/writing-prose-check.ts': [
        'const PROSE_ENGINE_PREFIXES = [',
        '  "skills/ai-anti-patterns/",',
        '  "skills/writing-",',
        '  "constraints/writing-no-bold-lead",',
        ']',
        'export const suppressed = (label: string) => PROSE_ENGINE_PREFIXES.some(p => label.startsWith(p))',
        '',
      ].join('\n'),
      'hooks/hooks.json': JSON.stringify({
        hooks: {
          PostToolUse: [
            { matcher: 'Edit', hooks: [{ type: 'command', command: 'bun ${CLAUDE_PLUGIN_ROOT}/hooks/writing-prose-check.ts' }] },
          ],
        },
      }),
    })
    const i5 = findingsFor(probe.runProbe(dir), 'I5')
    expect(i5.length).toBe(2)
    expect(i5.map((f: any) => f.detail).join(' ')).toContain('skills/writing-')
    expect(i5.map((f: any) => f.detail).join(' ')).toContain('constraints/writing-no-bold-lead')
  })
})

// ------------------------------------------------------------------ I6

describe('I6 — a lens prompt may not quote a literal a pattern table already decides', () => {
  // Modelled on 'The answer:' appearing both in the prose-register lens prompt and in
  // slide-register's regex: that is a copy, and it is the computable half of "a lens carries routing
  // and scope, never a rule".
  test('a literal in both the lens prompt and an in-domain table is a finding', () => {
    const dir = fixture({
      'plugin.json': PLUGIN_JSON,
      'skills/slides/SKILL.md': skillMd(
        'slides',
        '```js\nWorkflow({\n  reviewLenses: [\n' +
          '    { key: "prose-register", agentType: "Explore", refs: [], prompt: "Flag a bullet whose whole content announces the list beneath it, like \'The answer:\'." },\n' +
          '  ],\n})\n```',
      ),
      'skills/slides/references/slide-register.py': tableModule('slide-register', [
        '    (r"^\\s*-\\s*The answer:\\s*$", "slide-register: announce"),',
      ]),
      'hooks/hooks.json': JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: 'Edit',
              hooks: [{ type: 'command', command: 'python3 ${CLAUDE_PLUGIN_ROOT}/skills/slides/references/slide-register.py' }],
            },
          ],
        },
      }),
    })
    const i6 = findingsFor(probe.runProbe(dir), 'I6')
    expect(i6.length).toBe(1)
    expect(i6[0].detail).toContain('The answer:')
  })

  test('a lens that carries only routing and scope draws nothing', () => {
    const dir = fixture({
      'plugin.json': PLUGIN_JSON,
      'skills/slides/SKILL.md': skillMd(
        'slides',
        '```js\nWorkflow({\n  reviewLenses: [\n' +
          '    { key: "prose-register", agentType: "Explore", refs: ["${CLAUDE_PLUGIN_ROOT}/skills/slides/references/slide-register.py"], prompt: "Apply the literal-phrase test in the refs; do not restate it." },\n' +
          '  ],\n})\n```',
      ),
      'skills/slides/references/slide-register.py': tableModule('slide-register', [
        '    (r"^\\s*-\\s*The answer:\\s*$", "slide-register: announce"),',
      ]),
      'hooks/hooks.json': JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: 'Edit',
              hooks: [{ type: 'command', command: 'python3 ${CLAUDE_PLUGIN_ROOT}/skills/slides/references/slide-register.py' }],
            },
          ],
        },
      }),
    })
    expect(findingsFor(probe.runProbe(dir), 'I6').length).toBe(0)
  })
})

// ------------------------------------------------------------------ I7

describe('I7 — a shipped pattern may not carry a corpus-rejected phrase (ADVISORY)', () => {
  // Modelled on the six phrases banned as AI tells that the corpus recorded as human, four of which
  // fire in a live audit. ADVISORY: it is reported, and it does not gate.
  test('a pattern matching a rejected phrase is an advisory, not a finding', () => {
    const dir = fixture({
      'plugin.json': PLUGIN_JSON,
      'skills/writing/SKILL.md': skillMd('writing'),
      'skills/writing/references/promotional.py': tableModule('promotional', [
        '    (r"\\bit\\s+is\\s+important\\s+to\\s+(note|remember)\\b", "promotional marker"),',
      ]),
      'hooks/hooks.json': JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: 'Edit',
              hooks: [{ type: 'command', command: 'python3 ${CLAUDE_PLUGIN_ROOT}/skills/writing/references/promotional.py' }],
            },
          ],
        },
      }),
      'corpus/tics.yaml': TICS_YAML,
    })
    const result = probe.runProbe(dir, { corpus: join(dir, 'corpus/tics.yaml') })
    expect(findingsFor(result, 'I7').length).toBe(0)
    expect(result.advisories.length).toBe(1)
    expect(result.advisories[0].detail).toContain('it is important to note')
  })

  test('an unreachable corpus is reported as NOT CHECKED, never as a pass', () => {
    const dir = fixture({
      'plugin.json': PLUGIN_JSON,
      'skills/writing/SKILL.md': skillMd('writing'),
      'skills/writing/references/promotional.py': tableModule('promotional', [
        '    (r"\\bit\\s+is\\s+important\\s+to\\s+(note|remember)\\b", "promotional marker"),',
      ]),
      'hooks/hooks.json': JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: 'Edit',
              hooks: [{ type: 'command', command: 'python3 ${CLAUDE_PLUGIN_ROOT}/skills/writing/references/promotional.py' }],
            },
          ],
        },
      }),
    })
    const result = probe.runProbe(dir, { corpus: join(dir, 'no/such/tics.yaml') })
    expect(result.advisories.length).toBe(0)
    const u = (result.unresolvedRefs as any[]).filter(r => String(r.rule).startsWith('I7'))
    expect(u.length).toBe(1)
    expect(u[0].reason).toContain('corpus')
    // And it must be visible in the text output, in BOTH branches.
    expect(probe.formatText(result)).toContain('NOT CHECKED')
  })
})

// ------------------------------------------------------------------ clean

describe('the clean fixture', () => {
  test('correct structure produces zero findings and zero advisories', () => {
    const dir = fixture({
      'plugin.json': PLUGIN_JSON,
      'skills/writing/SKILL.md': skillMd(
        'writing',
        '```js\nWorkflow({\n  reviewLenses: [\n' +
          '    { key: "writing-judgement", agentType: "Explore", refs: ["${CLAUDE_PLUGIN_ROOT}/skills/writing/references/writing-checks.md"], prompt: "Judge only the checks no runner can settle, against the definitions in the refs." },\n' +
          '  ],\n' +
          '  mechanicalChecks: [\n' +
          '    { name: "prose", cmd: "python3 ${CLAUDE_PLUGIN_ROOT}/skills/writing/scripts/prose-gate.py" },\n' +
          '  ],\n})\n```',
      ),
      'skills/writing/references/writing-checks.md': '# checks\n',
      'skills/writing/references/volokh.py': tableModule('volokh', ['    (r"\\bheretofore\\b", "legalese"),']),
      'skills/writing/scripts/prose-gate.py': [
        'from pathlib import Path',
        'CONSTRAINT = "prose-gate"',
        'APPLIES_TO = ["writing-draft"]',
        'SEVERITY = "hard"',
        'TABLE = Path(__file__).resolve().parents[1] / "references" / "volokh.py"',
        'ATTR = "_PATTERNS"',
        '',
        'def check(context):',
        '    return []',
        '',
      ].join('\n'),
      'corpus/tics.yaml': TICS_YAML,
    })
    const result = probe.runProbe(dir, { corpus: join(dir, 'corpus/tics.yaml') })
    expect(result.findings).toEqual([])
    expect(result.advisories).toEqual([])
    expect(result.unresolvedRefs).toEqual([])
  })
})

// ------------------------------------------------------------------ exit codes

describe('the documented exit-code contract', () => {
  test('--help is a successful invocation, not a usage error (0)', () => {
    const r = cli(['--help'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('usage:')
  })

  test('a bad argument exits 2', () => {
    expect(cli(['--nope', '--target', '/tmp']).code).toBe(2)
    expect(cli([]).code).toBe(2)
    expect(cli(['--target', '/no/such/dir/at/all']).code).toBe(2)
  })

  test('findings exit 1, clean exits 0', () => {
    const clean = fixture({ 'plugin.json': PLUGIN_JSON, 'skills/a/SKILL.md': skillMd('a') })
    expect(cli(['--target', clean]).code).toBe(0)

    const dirty = fixture({
      'plugin.json': PLUGIN_JSON,
      'skills/writing/SKILL.md': skillMd('writing'),
      'skills/writing/references/no-bold-lead.py': [
        'from pathlib import Path',
        'CONSTRAINT = "no-bold-lead"',
        'APPLIES_TO = ["writing-draft"]',
        'SEVERITY = "hard"',
        'ENGINE = Path(__file__).resolve().parents[2] / "scripts" / "nowhere.py"',
        '',
        'def check(context):',
        '    return []',
        '',
      ].join('\n'),
      'hooks/hooks.json': JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: 'Edit',
              hooks: [{ type: 'command', command: 'python3 ${CLAUDE_PLUGIN_ROOT}/skills/writing/references/no-bold-lead.py' }],
            },
          ],
        },
      }),
    })
    expect(cli(['--target', dirty]).code).toBe(1)
  })

  test('a probe that crashed exits 3, distinctly from an argument error', () => {
    // main() routes a runProbe throw to 3. The contract is what the test pins, so the crash is
    // injected rather than hunted for: 2 says "you invoked me wrong", 3 says "I could not do my
    // job", and a gate that did not run must not be read as a gate that passed.
    const boom = () => {
      throw new Error('injected')
    }
    expect(probe.main(['--target', '/tmp'], boom)).toBe(3)
  })

  test('--json emits the whole result', () => {
    const clean = fixture({ 'plugin.json': PLUGIN_JSON, 'skills/a/SKILL.md': skillMd('a') })
    const r = cli(['--target', clean, '--json'])
    expect(r.code).toBe(0)
    const parsed = JSON.parse(r.out)
    expect(parsed.findings).toEqual([])
    expect(Array.isArray(parsed.advisories)).toBe(true)
    expect(Array.isArray(parsed.unresolvedRefs)).toBe(true)
    expect(Array.isArray(parsed.engines)).toBe(true)
  })
})

// A runner that globs a checker directory and dispatches on a callable `check` is as live as one
// that reads APPLIES_TO. Keying I3 on APPLIES_TO alone reported all 36 of typst's checkers as
// uncalled while run-constraints.py was importing and running every one of them.
test('a glob-and-dispatch-on-check runner registers contract modules', () => {
  const d = mkdtempSync(join(tmpdir(), 'pc-probe-glob-'))
  try {
    mkdirSync(join(d, 'constraints'), { recursive: true })
    writeFileSync(join(d, 'constraints', 'run-constraints.py'),
      'import glob\nfor f in glob.glob("constraints/*.py"):\n    mod.check(f)\n')
    writeFileSync(join(d, 'constraints', 'spacing.py'),
      'CONSTRAINT = "spacing"\nSEVERITY = "hard"\nAPPLIES_TO = ["slides"]\ndef check(p):\n    return []\n')
    const r = probe.runProbe(d)
    expect(r.findings.filter(f => f.rule.startsWith('I3'))).toEqual([])
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('with NO runner at all, a contract module is still reported uncalled', () => {
  const d = mkdtempSync(join(tmpdir(), 'pc-probe-norunner-'))
  try {
    mkdirSync(join(d, 'constraints'), { recursive: true })
    writeFileSync(join(d, 'constraints', 'spacing.py'),
      'CONSTRAINT = "spacing"\nSEVERITY = "hard"\nAPPLIES_TO = ["slides"]\ndef check(p):\n    return []\n')
    const r = probe.runProbe(d)
    expect(r.findings.filter(f => f.rule.startsWith('I3')).length).toBe(1)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('an English possessive is not a quote delimiter', () => {
  // `plan's task table and each task's writablePaths` yielded "s task table and each task".
  const lits = probe.quotedLiterals("did edits stay inside the plan's task table and each task's writablePaths?")
  expect(lits.some((l: string) => l.startsWith('s task table'))).toBe(false)
})

test('a heading or a path is shared vocabulary, not a claim', () => {
  expect(probe.quotedLiterals('cite the `## Lectures In Scope` table')).toEqual([])
  expect(probe.quotedLiterals('read `skills/notes/references/checks.md` first')).toEqual([])
  // A shipped pattern still counts — the defect this rule is named for.
  expect(probe.quotedLiterals("flag a bullet like 'The answer: it depends'")).toContain('The answer: it depends')
})

test('identical prompts over different refs are FAN-OUT, not rival lenses', () => {
  const d = mkdtempSync(join(tmpdir(), 'pc-probe-fanout-'))
  try {
    const lens = (k: string, ref: string) =>
      `    { key: "${k}", agentType: "Explore", refs: ["${ref}"], prompt: "Judge it; flag a bullet like 'The answer: it depends'." },\n`
    mkdirSync(join(d, 'skills', 'exams'), { recursive: true })
    writeFileSync(join(d, 'skills', 'exams', 'SKILL.md'),
      '---\nname: exams\ndescription: x\n---\n\n```js\nWorkflow({\n  reviewLenses: [\n' +
      lens('sf-01', 'q/01.typ') + lens('sf-02', 'q/02.typ') + '  ],\n})\n```\n')
    expect(probe.runProbe(d).findings.filter((f: any) => f.rule.startsWith('I2'))).toEqual([])
    // The same two lenses over the SAME refs are rivals again.
    writeFileSync(join(d, 'skills', 'exams', 'SKILL.md'),
      '---\nname: exams\ndescription: x\n---\n\n```js\nWorkflow({\n  reviewLenses: [\n' +
      lens('sf-01', 'q/01.typ') + lens('sf-02', 'q/01.typ') + '  ],\n})\n```\n')
    expect(probe.runProbe(d).findings.filter((f: any) => f.rule.startsWith('I2')).length).toBe(1)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('a list of bare directory prefixes is a PATH suppression, not a label one', () => {
  // validate-skill-paths.ts's USER_PROJECT_PREFIXES. Matching no label is correct for it, so I5
  // must not ask — otherwise it can only decline, leaving a NOT CHECKED that never resolves.
  const src = 'const USER_PROJECT_PREFIXES = [".planning/", "drafts/", "src/"]\n'
  expect(probe.suppressionEntries(src)).toEqual([])
})

test('a list of label prefixes is STILL read as a label suppression', () => {
  // The I5 defect this rule is named for: entries that name rules, not directories.
  const src = 'const SUPPRESS_PREFIXES = ["skills/writing-", "skills/slides-"]\n'
  expect(probe.suppressionEntries(src).map((e: any) => e.entry))
    .toEqual(['skills/writing-', 'skills/slides-'])
})

test('a mixed list is not exempted — one label entry keeps the whole list in scope', () => {
  const src = 'const IGNORE_PREFIXES = [".planning/", "skills/writing-"]\n'
  expect(probe.suppressionEntries(src).length).toBe(2)
})
