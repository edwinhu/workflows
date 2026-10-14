import { expect, setDefaultTimeout, test } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { useTmp } from './helpers/tmp.ts'

// Every constraint under checks/writing/**/constraints fails on a draft that breaks it and passes a draft that does not,
// run through its own CLI; every Jev rule under checks/writing/**/rules reports an explicit absence on prose-free input,
// a non-zero examined count on its compliant fixture, and has a violating and a compliant calibration case on disk.
// A check neutered to report nothing turns the first red, a rule whose state stops counting turns the second.
setDefaultTimeout(480_000)
const mkTmp = useTmp()
const ROOT = join(import.meta.dir, '..')
const CON = join(ROOT, 'checks/writing')

const run = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 100_000 })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error?.message ?? '') }
}
function project(files: Record<string, string>) {
  const d = mkTmp('wcov-')
  for (const [n, body] of Object.entries(files)) { mkdirSync(dirname(join(d, n)), { recursive: true }); writeFileSync(join(d, n), body) }
  return d
}
const constraint = (rel: string, p: string, file: string) => run('python3', [join(CON, rel), '--project-dir', p, '--files', join(p, file)])

const GOOD = 'We find a different result from the expected one, and the court held the statute applied.\n'

// [constraint, bad file, bad body, finding text that names the violated rule]
const TABLES: [string, string, string, RegExp][] = [
  ['constraints/strunk-elements-of-style.py', 'drafts/a.md', 'We find a different than expected result.\n', /'different than'/],
  ['constraints/scored-tics-patterns.py', 'drafts/a.md', 'This is a rich tapestry of ideas.\n', /rich-tapestry/],
  ['constraints/wikipedia-chatgpt-artifacts.py', 'drafts/a.md', 'See citeturn0search0 for the holding.\n', /citeturn0search0/],
  ['constraints/wikipedia-communication-patterns.py', 'drafts/a.md', 'As an AI language model, I cannot provide this.\n', /AI identity leak/],
  ['constraints/wikipedia-promotional-language.py', 'drafts/a.md', 'The rich tapestry of this nestled town.\n', /nestled/],
  ['constraints/wikipedia-puffery-and-exaggeration.py', 'drafts/a.md', 'The case stands as a testament to the law.\n', /stands as a testament/],
  ['constraints/wikipedia-structural-patterns.py', 'drafts/a.md', 'In conclusion, the court ruled.\n', /In summary\/conclusion/],
  ['constraints/wikipedia-template-artifacts.py', 'drafts/a.md', 'Fill in [Insert name here] and TODO.\n', /placeholder/],
  ['econ/constraints/mccloskey-economical-writing.py', 'drafts/a.md', 'The transition process was lengthy.\n', /'X process'/],
  ['legal/constraints/volokh-distilled.py', 'drafts/a.md', 'The court acted on the grounds that it could.\n', /on the grounds that/],
  ['constraints/writing-no-bold-lead.py', 'drafts/a.md', '**Bold lead.** Body text follows here.\n', /bold-lead pattern/],
  ['constraints/writing-anchored-numbers.py', 'drafts/a.md', '# Part I\n\n## A. Setup\n\nThe rate rose 45.3% over the period.\n', /un-anchored subsection/],
]
for (const [rel, file, bad, why] of TABLES) {
  test(`${rel}: a violating draft fails at its line, a clean draft passes`, () => {
    const p = project({ [file]: bad, 'drafts/ok.md': GOOD })
    const hit = constraint(rel, p, file)
    expect(hit.status, hit.stdout + hit.stderr).toBe(1)
    expect(hit.stdout).toMatch(/^drafts\/a\.md:\d+: \S+ /m)
    expect(hit.stdout).toMatch(why)
    const ok = constraint(rel, p, 'drafts/ok.md')
    expect(ok.status, ok.stdout + ok.stderr).toBe(0)
    expect(ok.stdout).not.toMatch(/^drafts\/ok\.md:\d+:/m)
  })
}

test('writing-anchored-numbers: the same number with a Table reference in its subsection passes', () => {
  const p = project({ 'drafts/a.md': '# Part I\n\n## A. Setup\n\nThe rate rose 45.3% over the period (Table 1).\n' })
  const r = constraint('constraints/writing-anchored-numbers.py', p, 'drafts/a.md')
  expect(r.status, r.stdout + r.stderr).toBe(0)
})

test('writing-shortjournal: an @article with no or blank shortjournal fails, one with it passes, an SSRN one is exempt', () => {
  const p = project({
    'bad.bib': '@article{a,\n  journal = {Harvard Law Review},\n  title = {X},\n}\n',
    'blank.bib': '@article{a,\n  journal = {Harvard Law Review},\n  shortjournal = {},\n}\n',
    'good.bib': '@article{a,\n  journal = {Harvard Law Review},\n  shortjournal = {Harv. L. Rev.},\n}\n',
    'ssrn.bib': '@article{a,\n  journal = {SSRN Electronic Journal},\n  title = {X},\n}\n',
  })
  const bad = constraint('constraints/writing-shortjournal.py', p, 'bad.bib')
  expect(bad.status, bad.stdout + bad.stderr).toBe(1)
  expect(bad.stdout).toMatch(/^bad\.bib:1: \S+ @article\{a\} missing `shortjournal`/m)
  const blank = constraint('constraints/writing-shortjournal.py', p, 'blank.bib')
  expect(blank.status, blank.stdout).toBe(1)
  expect(blank.stdout).toContain('blank `shortjournal`')
  for (const f of ['good.bib', 'ssrn.bib']) expect(constraint('constraints/writing-shortjournal.py', p, f).status, f).toBe(0)
})

test('writing-outline-sync: a draft ## subsection the OUTLINE does not list fails; a matching draft passes', () => {
  const outline = '### Part I\n- **A. Setup** plan\n'
  const rel = 'constraints/writing-outline-sync.py'
  const bad = project({ '.planning/OUTLINE.md': outline, 'drafts/Part_I.md': '# Part I\n\n## A. Setup\n\ntext\n\n## B. Extra\n\ntext\n' })
  const hit = constraint(rel, bad, 'drafts/Part_I.md')
  expect(hit.status, hit.stdout + hit.stderr).toBe(1)
  expect(hit.stdout).toMatch(/^drafts\/Part_I\.md:1: \S+ .*## B\. exists in draft but is not listed in OUTLINE/m)
  const orphan = project({ '.planning/OUTLINE.md': outline, 'drafts/Part_II.md': '# Part II\n\ntext\n' })
  const o = constraint(rel, orphan, 'drafts/Part_II.md')
  expect(o.status, o.stdout + o.stderr).toBe(1)
  expect(o.stdout).toContain("part 'part ii'")
  const ok = project({ '.planning/OUTLINE.md': outline, 'drafts/Part_I.md': '# Part I\n\n## A. Setup\n\ntext\n' })
  const g = constraint(rel, ok, 'drafts/Part_I.md')
  expect(g.status, g.stdout + g.stderr).toBe(0)
})

// ---- Jev rules --------------------------------------------------------------------------------------------------

const WRITING_SETS: [string, string, string][] = [
  ['writing', 'checks/writing/rules', 'W-'],
  ['writing', 'checks/writing/rules/uncalibrated', 'W-'],
  ['legal', 'checks/writing/legal/rules', 'L-'],
  ['econ', 'checks/writing/econ/rules', 'E-'],
]
const ruleIds = (dir: string) => readdirSync(join(ROOT, dir)).filter(f => /^[A-Z]-[A-Z]+\.py$/.test(f)).map(f => f.slice(0, -3)).sort()
const fixDir = (rule: string, kase: string) => join(ROOT, 'tests/fixtures/jev', rule, kase)
const evidence = (dir: string, file: string, root: string) => {
  const r = run('python3', [join(ROOT, 'checks/_jev/evidence.py'), '--files', file, '--root', root, '--rules-dir', join(ROOT, dir)])
  expect(r.status, r.stderr).toBe(0)
  return JSON.parse(r.stdout)
}

for (const [set, dir] of WRITING_SETS) {
  test(`${dir}: every rule reports an explicit zero on prose-free input and a non-zero examined count on its compliant fixture`, () => {
    const ids = ruleIds(dir)
    expect(ids.length, `rules in ${dir}`).toBeGreaterThan(1)
    const empty = project({ 'test.md': '# Heading only\n' })
    const none = evidence(dir, join(empty, 'test.md'), empty)
    expect(Object.keys(none).sort()).toEqual(ids)
    for (const id of ids) {
      expect(none[id].examinedKey, `${id} declares EXAMINED`).toBeTruthy()
      expect(none[id].examined, `${id} examined on prose-free input`).toBe(0)
      expect(none[id].proposition.length, id).toBeGreaterThan(80)
      const sat = evidence(dir, join(fixDir(id, 'sat'), 'test.md'), fixDir(id, 'sat'))
      expect(sat[id].examined, `${id} examined on its compliant fixture`).toBeGreaterThan(0)
    }
  })

  test(`${dir}: every rule has a violating and a compliant calibration case on disk`, () => {
    const spec = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/jev/calibration.json'), 'utf8')).sets[set]
    for (const id of ruleIds(dir)) {
      const cases: { kind: string; path: string }[] = spec.rules[id] ?? []
      for (const kind of ['violating', 'compliant']) {
        const c = cases.filter(x => x.kind === kind)
        expect(c.length, `${id} ${kind} cases`).toBeGreaterThan(0)
        for (const x of c) expect(existsSync(join(ROOT, x.path)), `${id}: ${x.path}`).toBe(true)
      }
    }
  })
}
