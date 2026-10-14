import { test, expect } from 'bun:test'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Every skill's js args fence is copied into a work dispatch. A `<...>` in a goal, authorityExtra or
// cmd string value reaches work verbatim (bash reads < and > as redirection in a cmd).
const root = join(import.meta.dir, '..', 'skills')
// skills/work documents the parameter SHAPE the engine accepts (its fence sits in an ignore-entry-point
// region); it is not a block an orchestrator copies into a dispatch.
const SCHEMA_REFERENCE = new Set(['work'])
const fences: { file: string; text: string; start: number }[] = []
for (const d of readdirSync(root)) {
  if (SCHEMA_REFERENCE.has(d)) continue
  const f = join(root, d, 'SKILL.md')
  if (!existsSync(f)) continue
  const lines = readFileSync(f, 'utf8').split('\n')
  let open = -1
  lines.forEach((l, i) => {
    if (open < 0 && /^```(?:js|javascript)\s*$/.test(l)) open = i
    else if (open >= 0 && /^```\s*$/.test(l)) {
      fences.push({ file: `skills/${d}/SKILL.md`, text: lines.slice(open + 1, i).join('\n'), start: open + 2 })
      open = -1
    }
  })
}

const hits = (re: RegExp, bad: RegExp) => fences.flatMap(f =>
  [...f.text.matchAll(re)].filter(m => bad.test(m[1])).map(m => `${f.file}:${f.start + f.text.slice(0, m.index).split('\n').length - 1}: ${m[1].slice(0, 80)}`))

test('the scan sees the args fences', () => {
  expect(fences.length).toBeGreaterThan(5)
})

test('no js fence goal or authorityExtra string carries a <placeholder>', () => {
  expect(hits(/^\s*(?:goal|authorityExtra): ("[^"\n]*"|`[^`\n]*`)/gm, /<[^>\n]*>/)).toEqual([])
})

test('no js fence cmd string carries a <placeholder>', () => {
  expect(hits(/\bcmd: ("[^"\n]*"|`[^`\n]*`)/g, /<[A-Za-z][\w-]*>/)).toEqual([])
})
