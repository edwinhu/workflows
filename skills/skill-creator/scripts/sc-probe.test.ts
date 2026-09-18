import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseBangs, fencedRegions, inlineSpans, bangCommandWord, hasFallback, quotesBalanced, resolvesOnPath,
  frontmatterKeys, checkConstraintDocs, checkProseCounts, runProbe, parseArgs, main,
  ArgError, HelpRequested,
} from './sc-probe.ts'

// A literal bang is assembled rather than typed, so this FILE can never be mistaken for one that
// carries live bangs — and so a grep for `!` + backtick over the repo does not hit the test suite.
const BANG = '!' + '`'
const B = (cmd: string) => `${BANG}${cmd}\``
/** The canonical TOC bang, which every skill carries — so a fixture testing anything else is clean. */
const TOC = B('d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; echo "(unavailable)"')

function skillTree(): string {
  const d = mkdtempSync(join(tmpdir(), 'sc-probe-'))
  mkdirSync(join(d, 'skills', 'demo'), { recursive: true })
  return d
}

function writeSkill(root: string, name: string, body: string): string {
  const dir = join(root, 'skills', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), body)
  return dir
}

// ---------------------------------------------------------------- bang extraction

test('a bang is extracted the way the parser does: up to the NEXT backtick', () => {
  const bangs = parseBangs('f.md', `# T\n\n${B('skill-toc /x')}\n`)
  expect(bangs.length).toBe(1)
  expect(bangs[0].command).toBe('skill-toc /x')
  expect(bangs[0].line).toBe(3)
})

test('an unterminated bang on one line is not a bang', () => {
  expect(parseBangs('f.md', `${BANG}skill-toc /x\nnext line\n`)).toEqual([])
})

// Every expectation below is MEASURED, 2026-09-15 against claude@2.1.257, by loading a probe skill
// carrying one bang per shape and reading which markers came back expanded.
test('a bang inside a ``` fence FIRES — a fence does not protect it', () => {
  const bangs = parseBangs('f.md', `# T\n\n\`\`\`\n${B('skill-toc ${CLAUDE_SKILL_DIR}')}\n\`\`\`\n`)
  expect(bangs.length).toBe(1)
  expect(bangs[0].inProse).toBe(true)
  expect(bangs[0].inert).toBe(false)
})

test('a bang inside a ~~~ fence, and one in a four-space indented block, both FIRE', () => {
  expect(parseBangs('f.md', `~~~\n${B('echo a')}\n~~~\n`)[0].inProse).toBe(true)
  expect(parseBangs('f.md', `text\n\n    ${B('echo b')}\n`)[0].inProse).toBe(true)
})

test('a bang inside an INLINE code span is inert — the one protection there is', () => {
  // The exact shape at plugin-creator:39, which reads like a hazard and is not one.
  const table = parseBangs('f.md', `| \`${B('command')}\` (bang) | Skill load |\n`)
  expect(table.length).toBe(1)
  expect(table[0].inert).toBe(true)
  // And not only at the span's start: tuicr:97 and court-dockets:149 are this shape.
  const mid = parseBangs('f.md', `the \`run ${B('echo FIRED_E')} done\`.\n`)
  expect(mid[0].inert).toBe(true)
})

test('a live bang on its own line is neither prose nor inert', () => {
  const bangs = parseBangs('f.md', `**What this skill carries**\n${B('skill-toc /x')}\n`)
  expect(bangs[0].inProse).toBe(false)
  expect(bangs[0].inert).toBe(false)
})

test('a bang MID-SENTENCE outside any span fires, so it is judged live', () => {
  const bangs = parseBangs('f.md', `prefix ${B('echo FIRED_F')} suffix\n`)
  expect(bangs[0].inProse).toBe(false)
  expect(bangs[0].inert).toBe(false)
})

test('inlineSpans closes a span at end of line, never across lines', () => {
  expect(inlineSpans('a `b\nc` d\n').length).toBe(0)
})

test('inside a fence a backtick is not a span delimiter', () => {
  expect(inlineSpans('```\na `b` c\n```\n').length).toBe(0)
  expect(fencedRegions('```\na\n```\n').length).toBe(1)
})

// ---------------------------------------------------------------- command resolution

test('the command word skips a leading assignment', () => {
  expect(bangCommandWord('d=${CLAUDE_SKILL_DIR}; command -v skill-toc', '/s')).toBe('command')
  expect(bangCommandWord('skill-toc ${CLAUDE_SKILL_DIR}', '/s')).toBe('skill-toc')
})

test('${CLAUDE_SKILL_DIR} is substituted into the command TEXT', () => {
  // A real file, because wc-probe resolves every ${CLAUDE_SKILL_DIR} literal it finds in this repo
  // and a plausible-looking fixture path is indistinguishable from a broken reference.
  expect(bangCommandWord('${CLAUDE_SKILL_DIR}/scripts/sc-probe.ts', '/s')).toBe('/s/scripts/sc-probe.ts')
})

test('a fallback branch is recognised in each of its spellings', () => {
  expect(hasFallback('command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; echo "(unavailable)"')).toBe(true)
  expect(hasFallback('[ -x "$s" ] && exec "$s"')).toBe(true)
  expect(hasFallback('cat /nope || echo fallback')).toBe(true)
  expect(hasFallback('skill-toc /x')).toBe(false)
})

test('quotesBalanced catches the truncation signature and passes a clean command', () => {
  expect(quotesBalanced('echo "hello"')).toBe(true)
  expect(quotesBalanced('echo "hello')).toBe(false)
  expect(quotesBalanced("echo 'it\\'s fine'")).toBe(true)
})

test('resolvesOnPath knows a builtin, an absolute path, and a missing tool apart', () => {
  expect(resolvesOnPath('echo')).toBe(true)
  expect(resolvesOnPath('/definitely/not/here')).toBe(false)
  expect(resolvesOnPath('zzz-no-such-command-zzz')).toBe(false)
})

// ---------------------------------------------------------------- S2, end to end

test('S2a: a bang written out in documentation is CRITICAL', () => {
  const d = skillTree()
  try {
    writeSkill(d, 'doc', `---\nname: doc\n---\n\n# Doc\n\nLike so:\n\n\`\`\`\n${B('cmd')}\n\`\`\`\n`)
    const r = runProbe(d)
    const f = r.findings.filter(x => x.rule.startsWith('S2a'))
    expect(f.length).toBe(1)
    expect(f[0].severity).toBe('critical')
    expect(f[0].remedy).toContain('<bang>')
    // The same command inside an inline span is inert and must NOT be flagged.
    writeSkill(d, 'safe', `# S\n\nUse \`${B('cmd')}\` to inject content.\n`)
    expect(runProbe(d).findings.filter(x => x.rule.startsWith('S2a')).length).toBe(1)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('S2b: $CLAUDE_SKILL_DIR as a shell variable is CRITICAL, and the braced form is not', () => {
  const d = skillTree()
  try {
    writeSkill(d, 'bad', `# B\n\n${B('echo "$CLAUDE_SKILL_DIR"')}\n`)
    writeSkill(d, 'good', `# G\n\n${B('echo "${CLAUDE_SKILL_DIR}"')}\n`)
    const r = runProbe(d)
    const f = r.findings.filter(x => x.rule.startsWith('S2b'))
    expect(f.length).toBe(1)
    expect(f[0].file).toContain('/bad/')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('S2c: an absent command with no fallback is CRITICAL; with a fallback it is clean', () => {
  const d = skillTree()
  try {
    writeSkill(d, 'bare', `# B\n\n${B('zzz-no-such-command-zzz /x')}\n`)
    writeSkill(d, 'guarded', `# G\n\n${B('command -v zzz-no-such-command-zzz >/dev/null 2>&1 && exec zzz-no-such-command-zzz /x; echo "(unavailable)"')}\n`)
    const r = runProbe(d)
    const f = r.findings.filter(x => x.rule.startsWith('S2c'))
    expect(f.length).toBe(1)
    expect(f[0].file).toContain('/bare/')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('S2d: a command the parser truncated is CRITICAL', () => {
  const d = skillTree()
  try {
    // An inner backtick: the parser stops there, leaving an unbalanced quote behind.
    writeSkill(d, 'trunc', `# T\n\n${BANG}echo "a \`b" \`\n`)
    const r = runProbe(d)
    expect(r.findings.some(x => x.rule.startsWith('S2d'))).toBe(true)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ---------------------------------------------------------------- S1

test('S1: files a skill owns that neither a TOC bang nor the prose names', () => {
  const d = skillTree()
  try {
    const dir = writeSkill(d, 'quiet', '# Q\n\nSome prose.\n')
    mkdirSync(join(dir, 'references'))
    writeFileSync(join(dir, 'references', 'alpha.md'), '# Alpha\n')
    writeFileSync(join(dir, 'references', 'beta.md'), '# Beta\n')
    const r = runProbe(d)
    const f = r.findings.filter(x => x.rule.startsWith('S1'))
    expect(f.length).toBe(1)
    expect(f[0].detail).toContain('2 of 2')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('S1: only the TOC bang clears it — naming the files in prose does not', () => {
  const d = skillTree()
  try {
    const a = writeSkill(d, 'toc', `# T\n\n${B('d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; echo "(unavailable)"')}\n`)
    mkdirSync(join(a, 'references'))
    writeFileSync(join(a, 'references', 'alpha.md'), '# Alpha\n')
    const b = writeSkill(d, 'named', '# N\n\nRead `references/alpha.md` for the detail.\n')
    mkdirSync(join(b, 'references'))
    writeFileSync(join(b, 'references', 'alpha.md'), '# Alpha\n')
    const f = runProbe(d).findings.filter(x => x.rule.startsWith('S1'))
    expect(f.length).toBe(1)
    expect(f[0].file).toContain('/named/')
    // Named-in-prose today is one rename away from named by nothing, so it is the weaker grade.
    expect(f[0].severity).toBe('minor')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// `skill-toc` prints "(this skill carries no references/ or scripts/)" and exits 0 for such a
// skill, so the line is never wrong and the rule needs no exception to fall out of.
test('S1: a skill owning nothing still carries the bang', () => {
  const d = skillTree()
  try {
    writeSkill(d, 'plain', '# P\n\nJust prose.\n')
    const f = runProbe(d).findings.filter(x => x.rule.startsWith('S1'))
    expect(f.length).toBe(1)
    expect(f[0].severity).toBe('minor')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ---------------------------------------------------------------- S3

test('S3: a body naming a path that is not on disk is a finding; an existing one is not', () => {
  const d = skillTree()
  try {
    const dir = writeSkill(d, 'paths', '# P\n\nSee `references/gone.md` and `references/here.md`.\n')
    mkdirSync(join(dir, 'references'))
    writeFileSync(join(dir, 'references', 'here.md'), '# Here\n')
    const r = runProbe(d)
    const f = r.findings.filter(x => x.rule.startsWith('S3'))
    expect(f.length).toBe(1)
    expect(f[0].detail).toContain('references/gone.md')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// WHO the prose hands a path to decides whether there is anything to fix. Silencing the
// unfixable case is only safe if the fixable one still fires, so both are pinned.

test('S3: a path handed to ANOTHER SKILL is still reported — it can be written', () => {
  const d = skillTree()
  try {
    writeSkill(d, 'reach', "# R\n\nUse the `wrds` skill's `references/tfn-ownership.md` for D5.\n")
    const r = runProbe(d)
    const a = r.advisories.filter(x => x.rule.startsWith('S3'))
    expect(a.length).toBe(1)
    expect(a[0].detail).toContain('references/tfn-ownership.md')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test("S3: a convention in the READER'S OWN project is not reported — no path exists to write", () => {
  const d = skillTree()
  try {
    writeSkill(d, 'conv', '# C\n\nResolved in the document project: `references/sources.bib`.\n')
    const r = runProbe(d)
    expect(r.advisories.filter(x => x.rule.startsWith('S3'))).toEqual([])
    expect(r.findings.filter(x => x.rule.startsWith('S3'))).toEqual([])
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('S3: a line naming BOTH a skill and a project is reported, not silenced', () => {
  const d = skillTree()
  try {
    writeSkill(d, 'both',
      "# B\n\nThe `agent-spawn` skill's `references/prompt-delivery.md`, not this project's.\n")
    const r = runProbe(d)
    expect(r.advisories.filter(x => x.rule.startsWith('S3')).length).toBe(1)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('S3: a glob or a placeholder is not judged', () => {
  const d = skillTree()
  try {
    writeSkill(d, 'glob', '# G\n\nGrep `references/*.md`, or `scripts/<your-script>.sh`.\n')
    const r = runProbe(d)
    expect(r.findings.filter(x => x.rule.startsWith('S3'))).toEqual([])
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ---------------------------------------------------------------- S4

test('frontmatterKeys reads only the frontmatter block', () => {
  expect(frontmatterKeys('---\napplies-to: [slides]\n---\n\nname: not a key\n').map(k => k.key)).toEqual(['applies-to'])
  expect(frontmatterKeys('# no frontmatter\n')).toEqual([])
})

test('S4: a constraint with an extra key and one with none are both findings', () => {
  const d = mkdtempSync(join(tmpdir(), 'sc-probe-c-'))
  try {
    mkdirSync(join(d, 'constraints'), { recursive: true })
    writeFileSync(join(d, 'constraints', 'a.md'), '---\napplies-to: [slides]\ntype: hard\n---\n\nRule.\n')
    writeFileSync(join(d, 'constraints', 'b.md'), '# No frontmatter\n')
    writeFileSync(join(d, 'constraints', 'c.md'), '---\napplies-to: [notes]\n---\n\nRule.\n')
    const f = checkConstraintDocs([join(d, 'constraints', 'a.md'), join(d, 'constraints', 'b.md'), join(d, 'constraints', 'c.md')])
    expect(f.map(x => x.rule.includes('nothing reads')).filter(Boolean).length).toBe(1)
    expect(f.map(x => x.rule.includes('no applies-to')).filter(Boolean).length).toBe(1)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('S4 runs over a plugin root, finding constraints/ wherever it sits', () => {
  const d = skillTree()
  try {
    mkdirSync(join(d, 'skills', 'demo', 'constraints'), { recursive: true })
    writeFileSync(join(d, 'skills', 'demo', 'SKILL.md'), '# D\n')
    writeFileSync(join(d, 'skills', 'demo', 'constraints', 'x.md'), '---\napplies-to: [a]\ntestable: true\n---\n')
    const r = runProbe(d)
    expect(r.constraintDocs).toBe(1)
    expect(r.findings.some(x => x.detail.includes('`testable:`'))).toBe(true)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// THE SPLIT. Rules moved from `constraints/` to `rules/`, and for a day S4/S5 enumerated the old
// name only: 0 constraint docs across all four plugins while typst held 20, workflows 48,
// teaching 14 -- CLEAN over nothing. These three hold the repaired shape.

test('S4 enumerates rules/ as well as constraints/', () => {
  const d = skillTree()
  try {
    mkdirSync(join(d, 'rules'), { recursive: true })
    writeFileSync(join(d, 'rules', 'shared.md'), '---\napplies-to: [a]\ntestable: true\n---\n')
    const r = runProbe(d)
    expect(r.constraintDocs).toBe(1)
    expect(r.findings.some(x => x.detail.includes('`testable:`'))).toBe(true)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('a rule under skills/<skill>/rules/ is LOCAL, so it needs no applies-to:', () => {
  const d = skillTree()
  try {
    mkdirSync(join(d, 'skills', 'demo', 'rules'), { recursive: true })
    writeFileSync(join(d, 'skills', 'demo', 'SKILL.md'), '# D\n')
    writeFileSync(join(d, 'skills', 'demo', 'rules', 'local.md'), '---\n---\n\nRule.\n')
    const r = runProbe(d)
    expect(r.constraintDocs).toBe(1)
    expect(r.findings.filter(x => x.rule.startsWith('S4 shared'))).toEqual([])
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('paths: declares scope for the install tier, and S4 still fires when neither key is there', () => {
  const d = skillTree()
  try {
    mkdirSync(join(d, 'rules'), { recursive: true })
    writeFileSync(join(d, 'rules', 'always-on.md'), '---\npaths: ["**/*.typ"]\n---\n\nRule.\n')
    writeFileSync(join(d, 'rules', 'unscoped.md'), '---\n---\n\nRule.\n')
    const r = runProbe(d)
    const shared = r.findings.filter(x => x.rule.startsWith('S4 shared'))
    expect(shared.length).toBe(1)
    expect(shared[0].file).toContain('unscoped.md')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ---------------------------------------------------------------- S5 (advisory)

test('S5 is an advisory and does not gate', () => {
  const d = skillTree()
  try {
    writeSkill(d, 'counted', `# C\n\n${TOC}\n\nThis plugin ships 22 constraints today.\n`)
    const r = runProbe(d)
    expect(r.advisories.length).toBe(1)
    expect(r.findings).toEqual([])
    expect(main(['--target', d, '--json'])).toBe(0)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('checkProseCounts sees a spelled-out number too', () => {
  expect(checkProseCounts('f.md', 'the corpus holds fifteen modules').length).toBe(1)
})

// S5 reported that a number EXISTS, which made every hit a manual check: 34 advisories over
// this corpus, one of them wrong. These pin the narrowing, and the computed leg that replaced
// the guesswork where the filesystem can answer.

test('a singular is prose about a design, not a corpus tally', () => {
  expect(checkProseCounts('f.md', 'one module ships here')).toEqual([])
  expect(checkProseCounts('f.md', 'One skill owns it')).toEqual([])
  // ...and the plural on the same noun still fires.
  expect(checkProseCounts('f.md', 'it ships three modules').length).toBe(1)
})

// THE FILESYSTEM HAS TO BE ABLE TO ANSWER, or the advisory has no remedy to offer. Measured
// 2026-09-16: 21 advisories remained after two narrowings and NOT ONE was a wrong count — every
// one was a heading over the list it counted, a back-reference to that list, a historical note,
// or already correct. These are the three shapes that produced them.
test('a heading introducing its own list is not a corpus count', () => {
  expect(checkProseCounts('f.md', '## Two rules that are not optional')).toEqual([])
  expect(checkProseCounts('f.md', '### the ordering, in three modules')).toEqual([])
})

test('a back-reference points at this document, not at a directory', () => {
  expect(checkProseCounts('f.md', 'the cost the four modules above pay for it')).toEqual([])
  expect(checkProseCounts('f.md', 'three modules declared in the block')).toEqual([])
})

test('`rules` and `lenses` name design facts no directory holds', () => {
  expect(checkProseCounts('f.md', 'it ships three rules')).toEqual([])
  expect(checkProseCounts('f.md', 'the gate runs four lenses')).toEqual([])
  // ...while a noun the filesystem CAN answer still fires.
  expect(checkProseCounts('f.md', 'it ships three modules').length).toBe(1)
})

test('a dated measurement is a record, not a claim about the tree today', () => {
  expect(checkProseCounts('f.md', 'measured 2026-09-14, 219 references across it')).toEqual([])
  expect(checkProseCounts('f.md', 'there are 219 references')).not.toEqual([])
})

test('a reference count is COUNTED, and silence means it was right', () => {
  const d = mkdtempSync(join(tmpdir(), 'sc-s5-'))
  try {
    mkdirSync(join(d, 'references'))
    for (const n of ['a.md', 'b.md', 'c.md']) writeFileSync(join(d, 'references', n), 'x')
    const md = join(d, 'SKILL.md')
    // Correct: computed, agrees, says nothing.
    expect(checkProseCounts(md, 'This skill has three references.')).toEqual([])
    // Wrong: computed, disagrees, and BOTH numbers are in the message so it is actionable.
    const bad = checkProseCounts(md, 'This skill has eight references.')
    expect(bad.length).toBe(1)
    expect(bad[0].rule).toContain('disagrees with the corpus')
    expect(bad[0].detail).toContain('holds 3')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('a tally spanning more skills is not compared against one skill directory', () => {
  const d = mkdtempSync(join(tmpdir(), 'sc-s5x-'))
  try {
    mkdirSync(join(d, 'references'))
    writeFileSync(join(d, 'references', 'a.md'), 'x')
    const r = checkProseCounts(join(d, 'SKILL.md'), '16 reference files across 10 skills are named by none')
    // Reported as unverified — never as a drift, which would be the probe's own error.
    expect(r.every(a => !a.rule.includes('disagrees'))).toBe(true)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('a skill with no references/ is reported unverified, not silently dropped', () => {
  const d = mkdtempSync(join(tmpdir(), 'sc-s5n-'))
  try {
    const r = checkProseCounts(join(d, 'SKILL.md'), 'the corpus holds eight references')
    // Not compared against a directory that does not exist...
    expect(r.every(a => !a.rule.includes('disagrees'))).toBe(true)
    // ...and not swallowed either: a claim the probe could not check is still a claim.
    expect(r.length).toBe(1)
    expect(r[0].detail).toContain('cannot reach')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ---------------------------------------------------------------- symlinks and coverage

test('a symlinked skill directory is NOT CHECKED, not silently skipped', () => {
  const d = skillTree()
  try {
    const real = join(d, 'vendor')
    mkdirSync(real, { recursive: true })
    writeFileSync(join(real, 'SKILL.md'), `# V\n\n${B('zzz-no-such-command-zzz')}\n`)
    symlinkSync(real, join(d, 'skills', 'linked'))
    const r = runProbe(join(d, 'skills'))
    expect(r.unresolvedRefs.length).toBe(1)
    expect(r.unresolvedRefs[0].reason).toContain('vendored')
    expect(r.findings).toEqual([])
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ---------------------------------------------------------------- CLI contract

test('parseArgs refuses a missing, non-existent or non-directory target', () => {
  expect(() => parseArgs([])).toThrow(ArgError)
  expect(() => parseArgs(['--target', '/definitely/not/here'])).toThrow(ArgError)
  expect(() => parseArgs(['--target'])).toThrow(ArgError)
  expect(() => parseArgs(['--nope'])).toThrow(ArgError)
})

test('--help is a successful invocation', () => {
  expect(() => parseArgs(['--help'])).toThrow(HelpRequested)
  expect(main(['--help'])).toBe(0)
})

test('exit codes: 0 clean, 1 findings, 2 argument error, 3 crash', () => {
  const d = skillTree()
  try {
    writeSkill(d, 'clean', `# C\n\n${TOC}\n\nProse only.\n`)
    expect(main(['--target', d])).toBe(0)
    writeSkill(d, 'dirty', `# D\n\n${B('zzz-no-such-command-zzz')}\n`)
    expect(main(['--target', d])).toBe(1)
    expect(main(['--target', '/definitely/not/here'])).toBe(2)
    const boom = (() => { throw new Error('probe exploded') }) as unknown as typeof runProbe
    expect(main(['--target', d], boom)).toBe(3)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ---------------------------------------------------------------- S3, the shared case

test('S3: a path living at the PLUGIN ROOT is its own finding, not a dead path', () => {
  const d = skillTree()
  try {
    mkdirSync(join(d, 'references'), { recursive: true })
    writeFileSync(join(d, 'references', 'shared.md'), '# Shared\n')
    writeSkill(d, 'shares', `# S\n\n${TOC}\n\nSee \`references/shared.md\`.\n`)
    const f = runProbe(d).findings.filter(x => x.rule.startsWith('S3'))
    expect(f.length).toBe(1)
    expect(f[0].rule).toContain('shared path')
    expect(f[0].remedy).toContain('CLAUDE_PLUGIN_ROOT')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('S3: a path inside a fenced block is an example and is not judged', () => {
  const d = skillTree()
  try {
    writeSkill(d, 'example', `# E\n\n${TOC}\n\n\`\`\`bash\npython3 scripts/my_script.py --arg v\n\`\`\`\n`)
    expect(runProbe(d).findings.filter(x => x.rule.startsWith('S3'))).toEqual([])
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('S4: an ALL-CAPS .md in constraints/ is a register, not a rule, and is not judged', () => {
  const d = skillTree()
  try {
    mkdirSync(join(d, 'constraints'), { recursive: true })
    writeFileSync(join(d, 'constraints', 'DROPPED.md'), '# Retirement register\n')
    writeFileSync(join(d, 'constraints', 'real-rule.md'), '---\napplies-to: [x]\n---\n')
    const r = runProbe(d)
    expect(r.constraintDocs).toBe(1)
    expect(r.findings.filter(x => x.rule.startsWith('S4'))).toEqual([])
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('S4: the allowed key set is DERIVED from what a loader reads', () => {
  const d = skillTree()
  try {
    mkdirSync(join(d, 'scripts'), { recursive: true })
    mkdirSync(join(d, 'constraints'), { recursive: true })
    // A loader is any source mentioning applies-to; the literals it names are the read keys.
    writeFileSync(join(d, 'scripts', 'load.ts'), 'const a = meta["applies-to"]; const n = meta["name"]\n')
    writeFileSync(join(d, 'constraints', 'r.md'), '---\napplies-to: [x]\nname: r\ndescription: d\n---\n')
    const f = runProbe(d).findings.filter(x => x.rule.startsWith('S4'))
    expect(f.length).toBe(1)
    expect(f[0].detail).toContain('`description:`')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ---------------------------------------------------------------- S4 scope

test('S4 derives the allowed keys from the PLUGIN, not from the probe target', () => {
  const d = skillTree()
  try {
    mkdirSync(join(d, '.claude-plugin'), { recursive: true })
    writeFileSync(join(d, '.claude-plugin', 'plugin.json'), '{"name":"demo"}\n')
    mkdirSync(join(d, 'scripts'), { recursive: true })
    // The loader sits at the plugin root, two levels above the skill being probed.
    writeFileSync(join(d, 'scripts', 'load.py'), 'a = meta["applies-to"]\nn = meta["name"]\n')
    const skill = writeSkill(d, 'scoped', `# S\n\n${TOC}\n`)
    mkdirSync(join(skill, 'constraints'), { recursive: true })
    writeFileSync(join(skill, 'constraints', 'r.md'), '---\napplies-to: [x]\nname: r\n---\n')

    // Probing the SKILL directly must reach the same verdict as probing the plugin root.
    expect(runProbe(skill).findings.filter(x => x.rule.startsWith('S4'))).toEqual([])
    expect(runProbe(d).findings.filter(x => x.rule.startsWith('S4'))).toEqual([])
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('S4 still fires when NO loader anywhere in the plugin reads the key', () => {
  const d = skillTree()
  try {
    mkdirSync(join(d, '.claude-plugin'), { recursive: true })
    writeFileSync(join(d, '.claude-plugin', 'plugin.json'), '{"name":"demo"}\n')
    mkdirSync(join(d, 'scripts'), { recursive: true })
    writeFileSync(join(d, 'scripts', 'load.py'), 'a = meta["applies-to"]\n')
    const skill = writeSkill(d, 'scoped', `# S\n\n${TOC}\n`)
    mkdirSync(join(skill, 'constraints'), { recursive: true })
    writeFileSync(join(skill, 'constraints', 'r.md'), '---\napplies-to: [x]\nname: r\n---\n')
    expect(runProbe(skill).findings.filter(x => x.rule.startsWith('S4')).length).toBe(1)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// S4's scope half: shared corpora declare applies-to, skill-local ones are scoped by their path.
test('a SKILL-LOCAL constraint needs no applies-to', () => {
  const d = skillTree()
  try {
    mkdirSync(join(d, 'scripts'), { recursive: true })
    writeFileSync(join(d, 'scripts', 'load.py'), 'a = meta["applies-to"]; n = meta["name"]\n')
    const skill = writeSkill(d, 'local', `# L\n\n${TOC}\n`)
    mkdirSync(join(skill, 'constraints'), { recursive: true })
    writeFileSync(join(skill, 'constraints', 'r.md'), '---\nname: r\n---\n\n## Rule\n')
    expect(runProbe(d).findings.filter(x => x.rule.startsWith('S4'))).toEqual([])
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('a SHARED constraint without applies-to is still a finding', () => {
  const d = skillTree()
  try {
    mkdirSync(join(d, 'scripts'), { recursive: true })
    writeFileSync(join(d, 'scripts', 'load.py'), 'a = meta["applies-to"]; n = meta["name"]\n')
    mkdirSync(join(d, 'constraints'), { recursive: true })
    writeFileSync(join(d, 'constraints', 'r.md'), '---\nname: r\n---\n\n## Rule\n')
    const f = runProbe(d).findings.filter(x => x.rule.startsWith('S4'))
    expect(f.length).toBe(1)
    expect(f[0].detail).toContain('plugin root')
  } finally { rmSync(d, { recursive: true, force: true }) }
})
