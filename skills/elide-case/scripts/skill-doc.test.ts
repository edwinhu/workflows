import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

test("serial-loop exemption is region-scoped around the retrieve row, not whole-file", () => {
  const s = read("SKILL.md")
  expect(s).not.toMatch(/<!--\s*wc-probe:\s*ignore-serial-loop\s*-->/)
  const start = s.indexOf("<!-- wc-probe: ignore-serial-loop:start -->")
  const end = s.indexOf("<!-- wc-probe: ignore-serial-loop:end -->")
  const row = s.indexOf('id: "retrieve"')
  expect(start).toBeGreaterThan(-1)
  expect(start).toBeLessThan(row)
  expect(end).toBeGreaterThan(row)
  expect(end).toBeLessThan(s.indexOf("// ── WAVE 2"))
})

test("the lens receives editing-marks.md, the basis of the verdicts it may rule on", () => {
  const s = read("SKILL.md")
  const lens = s.slice(s.indexOf("lens: {"))
  expect(lens.slice(0, 400)).toContain("references/editing-marks.md")
})
