// spine-contract.test.ts — pins what SKILL.md says about `work` to what `work` ships. The skill states
// work's facts only as deltas; these tests fail when a restated copy (arg name, FAIL selector set,
// required-return-key count) drifts from workflow.js / work-result.sh.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SKILL_DIR = join(import.meta.dir, '..')
const WORK = join(SKILL_DIR, '..', 'work')
const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8')
const workJs = readFileSync(join(WORK, 'workflow.js'), 'utf8')
const resultSh = readFileSync(join(WORK, 'scripts', 'work-result.sh'), 'utf8')

// Args work accepts: workflow.js's top-level destructure and every `args.<name>`, plus the keys of
// work/SKILL.md's Phase 4 schema fence (dispatcher-resolved ones like lensProvider never reach workflow.js).
function acceptedArgs(): Set<string> {
  const out = new Set<string>()
  const workSkill = readFileSync(join(WORK, 'SKILL.md'), 'utf8')
  for (const m of workSkill.matchAll(/```js\n(\{\n[\s\S]*?)\n```/g)) {
    if (/\bspecHash:/.test(m[1])) for (const k of topLevelKeys(m[1], 0)) out.add(k)
  }
  const d = workJs.match(/const \{([^}]*)\} = args\b/)
  if (d) for (const n of d[1].split(',')) if (n.trim()) out.add(n.trim())
  for (const m of workJs.matchAll(/\bargs\.(\w+)/g)) out.add(m[1])
  return out
}

// Skip a string/template/comment starting at s[i]; return the index after it, or i if none starts there.
function skipLiteral(s: string, i: number): number {
  const c = s[i]
  if (c === '/' && s[i + 1] === '/') { const e = s.indexOf('\n', i); return e < 0 ? s.length : e }
  if (c === '"' || c === "'") {
    let j = i + 1
    while (j < s.length && s[j] !== c) j += s[j] === '\\' ? 2 : 1
    return j + 1
  }
  if (c === '`') {
    let j = i + 1
    while (j < s.length && s[j] !== '`') {
      if (s[j] === '\\') j += 2
      else if (s[j] === '$' && s[j + 1] === '{') {
        let depth = 1
        j += 2
        while (j < s.length && depth) {
          const k = skipLiteral(s, j)
          if (k !== j) { j = k; continue }
          if (s[j] === '{') depth++
          else if (s[j] === '}') depth--
          j++
        }
      } else j++
    }
    return j + 1
  }
  return i
}

// Top-level keys of the object literal opening at s[open] === '{'.
function topLevelKeys(s: string, open: number): string[] {
  const keys: string[] = []
  let depth = 0
  let atEntryStart = false
  for (let i = open; i < s.length; ) {
    const k = skipLiteral(s, i)
    if (k !== i) { i = k; continue }
    const c = s[i]
    if ('{[('.includes(c)) { depth++; if (depth === 1) atEntryStart = true; i++; continue }
    if ('}])'.includes(c)) { depth--; if (depth === 0) break; i++; continue }
    if (depth === 1 && c === ',') { atEntryStart = true; i++; continue }
    if (depth === 1 && atEntryStart && /[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(s.slice(i))![0]
      keys.push(m)
      atEntryStart = false
      i += m.length
      continue
    }
    if (depth === 1 && atEntryStart && !/\s/.test(c)) atEntryStart = false
    i++
  }
  return keys
}

// Every ```js fence in SKILL.md that builds the args object.
function argsFences(): { line: number; keys: string[] }[] {
  const out: { line: number; keys: string[] }[] = []
  for (const m of skill.matchAll(/```js\n([\s\S]*?)\n```/g)) {
    const at = m[1].search(/const args = \{/)
    if (at < 0) continue
    const open = m[1].indexOf('{', at)
    out.push({ line: skill.slice(0, m.index).split('\n').length, keys: topLevelKeys(m[1], open) })
  }
  return out
}

test('the audit and Phase 4 fences are both found, with keys', () => {
  const f = argsFences()
  expect(f.length).toBeGreaterThanOrEqual(2)
  for (const x of f) expect(x.keys).toContain('goal')
})

test('every top-level key an args fence sets is an arg work accepts', () => {
  const accepted = acceptedArgs()
  expect(accepted.has('specHash')).toBe(true)
  const bad: string[] = []
  for (const f of argsFences()) for (const k of f.keys) if (!accepted.has(k)) bad.push(`fence@${f.line}: ${k}`)
  expect(bad).toEqual([])
})

// The FAIL selector set is work-result.sh's CONTRACT keys ending in ThatFlagged/ThatFailed.
function contractSelectors(): string[] {
  const block = resultSh.match(/CONTRACT='\{([\s\S]*?)\}'/)![1]
  return [...block.matchAll(/"(\w+That(?:Flagged|Failed))"/g)].map(m => m[1])
}

test('work-result.sh CONTRACT yields the four required selectors', () => {
  expect(contractSelectors().sort()).toEqual(['lensesThatFlagged', 'mechanicalThatFailed', 'rulesThatFailed', 'tasksThatFlagged'])
})

test('every line of SKILL.md enumerating the selector set names every channel', () => {
  const sel = contractSelectors()
  // A block is a blank-line-separated paragraph or one table row.
  const lines: { text: string; n: number }[] = []
  let para: string[] = [], start = 0
  const flush = () => { if (para.length) lines.push({ text: para.join(' '), n: start }); para = [] }
  skill.split('\n').forEach((t, i) => {
    if (!t.trim()) return flush()
    if (t.startsWith('|')) { flush(); lines.push({ text: t, n: i + 1 }); return }
    if (!para.length) start = i + 1
    para.push(t)
  })
  flush()
  const enumerating = lines.filter(l => sel.filter(s => l.text.includes(s)).length >= 2)
  expect(enumerating.length).toBeGreaterThan(0)
  const bad = enumerating.filter(l => sel.some(s => !l.text.includes(s))).map(l => `line ${l.n}: missing ${sel.filter(s => !l.text.includes(s)).join(',')}`)
  expect(bad).toEqual([])
})

test('no hand count of selector channels or required return keys', () => {
  const count = '(?:one|two|three|four|five|six|seven|eight|nine)'
  const re = new RegExp(`\\*{0,2}${count}\\*{0,2}[^.\\n]{0,40}\\b(?:selectors?|channels?|return keys?|required keys?)\\b|\\b(?:selectors?|channels?)\\b[^.\\n]{0,30}\\b(?:has|have|are|is|of)\\b[^.\\n]{0,10}\\*{0,2}${count}\\b`, 'i')
  const bad = skill.split('\n').map((t, i) => ({ t, n: i + 1 })).filter(l => re.test(l.t)).map(l => `line ${l.n}: ${l.t.slice(0, 100)}`)
  expect(bad).toEqual([])
})

test('the audit section tells the charter to carry workflow: authoring', () => {
  expect(skill).toMatch(/charter's frontmatter must say `workflow: authoring`/)
})

test('the parameter table does not say an agent runs the mechanical command', () => {
  expect(skill).not.toMatch(/mechanicalChecks`[^|\n]*agent runs the command/)
})

test('no args-fence cmd string carries a <placeholder> — bash reads < and > as redirection', () => {
  const cmds = [...skill.matchAll(/\bcmd: ("[^"\n]*"|`[^`\n]*`)/g)].map(m => m[1])
  expect(cmds.length).toBeGreaterThan(3)
  expect(cmds.filter(c => /<[A-Za-z][\w-]*>/.test(c))).toEqual([])
})
