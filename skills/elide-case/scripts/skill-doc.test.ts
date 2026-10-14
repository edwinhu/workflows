import { test, expect } from "bun:test"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

test("serial-loop exemption is region-scoped (not whole-file) over the fence holding the retrieve row", () => {
  const s = read("SKILL.md")
  expect(s).not.toMatch(/<!--\s*wc-probe:\s*ignore-serial-loop\s*-->/)
  const start = s.indexOf("<!-- wc-probe: ignore-serial-loop:start -->")
  const end = s.indexOf("<!-- wc-probe: ignore-serial-loop:end -->")
  const row = s.indexOf('id: "retrieve"')
  expect(start).toBeGreaterThan(-1)
  expect(start).toBeLessThan(row)
  expect(end).toBeGreaterThan(row)
  // markers inside a fence are not declarable, so the region closes at the fence that holds the row
  expect(end).toBeGreaterThan(s.indexOf("authorityExtra:"))
  expect(end).toBeLessThan(s.indexOf("\n```bash", end))
})

test("the lens receives editing-marks.md, the basis of the verdicts it may rule on", () => {
  const s = read("SKILL.md")
  const lens = s.slice(s.indexOf("lens: {"))
  expect(lens.slice(0, 400)).toContain("references/editing-marks.md")
})

test("context-loaded files carry no dated incident narrative", () => {
  for (const f of ["SKILL.md", "references/retrieval.md", "references/editing-marks.md"]) {
    expect(read(f)).not.toMatch(/\b20\d\d-\d\d-\d\d\b/)
  }
})

const plugin = join(root, "..", "..")
const SCRIPT_TOKEN = /[~\w${}/.-]*\bscripts\/[\w.-]+\.(?:sh|py|ts)\b/g

test("every script path in SKILL.md and the references resolves from any cwd", () => {
  for (const f of ["SKILL.md", "references/retrieval.md", "references/verification.md", "references/authenticity.md", "references/editing-marks.md"]) {
    for (const m of read(f).matchAll(SCRIPT_TOKEN)) {
      const tok = m[0]
      if (!tok.startsWith("${CLAUDE_PLUGIN_ROOT}/") && !tok.startsWith("/") && !tok.startsWith("~/")) throw new Error(`${f}: relative script path ${tok}`)
      const abs = tok.replace("${CLAUDE_PLUGIN_ROOT}", plugin).replace("~/.claude/skills/workflows", plugin)
      expect(existsSync(abs), `${f}: ${tok} does not exist`).toBe(true)
    }
  }
})

test("the fallback fetch script is named by absolute path, with no unsubstituted SKILL_DIR in a reference", () => {
  const abs = "${CLAUDE_PLUGIN_ROOT}/skills/elide-case/scripts/fetch-opinion.sh"
  expect(read("SKILL.md")).toContain(abs)
  const r = read("references/retrieval.md")
  expect(r).not.toContain("${CLAUDE_SKILL_DIR}")
  expect(r).toContain("${CLAUDE_PLUGIN_ROOT}/skills/elide-case/scripts")
})

test("Route 2: the cut acceptance and the fidelity prompt follow the plan's source, not a hard-coded .westlaw.docx", () => {
  const s = read("SKILL.md")
  const acc = s.match(/acceptance: "python3 [^\n]*check-quotes\.py[^\n]*"/)![0]
  expect(acc).not.toContain("<name>.westlaw.docx")
  expect(acc).toContain("<source>")
  expect(acc).toContain(".txt")
  const fid = s.match(/prompt: "Verbatim matching cannot see misrepresentation[^\n]*"/)![0]
  expect(fid).not.toContain("<name>.westlaw.docx")
  expect(fid).toContain("<source>")
  expect(fid).toContain("westlaw-docx-text.py")
  expect(fid).toMatch(/\.txt[^.]*directly|directly[^.]*\.txt/)
  const cut = s.match(/work: "ONE READING, CUT ONLY[^\n]*"/)![0]
  expect(cut).not.toContain("docs/<name>.westlaw.docx")
})
