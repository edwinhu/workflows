// The Workflow runtime that executes `workflows/*.js` is PURE CONTROL FLOW. A direct probe of it
// returned:
//     import('node:fs') / import('node:crypto') / import('node:path')
//                          -> "import() is not available in workflow scripts."
//     import.meta          -> SyntaxError: import.meta is only valid inside modules
//     globalThis.process   -> undefined
//     globalThis.Buffer    -> undefined
//
// Five of six scripts violated that and had NEVER executed: they died at import/parse before
// dispatching a single agent. They stayed green because the suites that exercised them read the
// script as TEXT, rewrote its `new URL('./lib/x.ts', import.meta.url).href` specifiers into absolute
// paths, and ran it through `AsyncFunction` in Node — where `import()` exists. The test built an
// environment where the broken code works.
//
// This suite is the thing that cannot do that. It asserts purity two independent ways: a STATIC
// scan of the source, and EXECUTION under a shim where the forbidden constructs are genuinely
// unavailable. Run: bun test tests/workflow-runtime-purity.test.mjs
import { readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const WORKFLOWS = new URL('../workflows/', import.meta.url).pathname
const SCRIPTS = readdirSync(WORKFLOWS).filter(name => name.endsWith('.js')).sort()

// KNOWN_NONCOMPLIANT — scripts that are STILL impure on purpose, with the reason and the exit
// condition. Every member is ASSERTED to be non-compliant below, so the day one is converted this
// suite FAILS and tells you to delete the entry. A silently-skipped exception would recreate the
// exact defect this file exists to prevent.
//
// THE REGISTRY IS NOW EMPTY. Every script in workflows/ is guarded by the scan and the shim below.
// Keep it that way: a new entry needs the reason and the exit condition written out, the way the one
// former member's did. What follows is that member's record, kept because it explains what "retired"
// had to mean and why an empty registry was not reachable by deleting a file.
//
//   beat-implement.js — RETIRED 2026-08-02, migrated rather than deleted.
//     It needed four `workflows/lib/*.ts` modules, `process.env.CLAUDE_CODE_SESSION_ID`
//     for its dispatching-session identity, and `Buffer.from` for task-contract digests. It cannot be
//     converted, because it calls captureGitObservation BETWEEN agent dispatches and a pure-control-
//     flow script has no filesystem access at any point. It has been REPLACED rather than fixed: the
//     shared IMPLEMENT beat now routes by plan shape (scripts/beat/route-implementation.ts) and
//     generates a plan-bound script into the project's .claude/workflows/
//     (scripts/beat/emit-implementation-workflow.ts), which is pure by construction because the
//     generator resolves every plan-specific value before emitting.
//
//     WHY IT OUTLIVED ITS LAST CALLER BY A WEEK. No skill invoked it, but four suites pinned ~105
//     assertions of dispatch policy against it — sequential dispatch, approval authentication,
//     reviewer separation, retry scope, writable-path enforcement, post-dispatch observation.
//     Deleting the file would have deleted that coverage, which is the "remove the test to make it
//     pass" move this whole episode exists to prevent. So retirement was a MIGRATION, and the
//     assertions were re-homed along the one line that actually divides them — what can be decided
//     BEFORE any agent runs, versus what can only be decided BETWEEN dispatches:
//
//       scripts/beat/preflight.ts        <- tests/beat-implement-preflight.test.mjs
//       hooks/work-implement-observation <- tests/work-implement-observation.test.mjs
//
//     Both files carry a PROVENANCE header pointing back here. If a property from the old suites is
//     in neither, it was lost — that is the failure those headers exist to make visible.
//
//     SCOPE CORRECTION — an earlier version of this comment said "/work's step-3 runner stays
//     broken", which badly understated it. This was the SHARED implement primitive, invoked from
//     dev-implement, work/beats/goal-work.md, ds-implement and beat-implement itself, with
//     workflow-creator and ds-fix routing through it. Every workflow's IMPLEMENT step was dead.
const KNOWN_NONCOMPLIANT = new Set([])

const FORBIDDEN = [
  { construct: 'import()', pattern: /\bimport\s*\(/g },
  { construct: 'import.meta', pattern: /\bimport\s*\.\s*meta\b/g },
  { construct: 'process.', pattern: /\bprocess\s*\./g },
  { construct: 'Buffer', pattern: /\bBuffer\b/g },
]

// Blank out line and block comments, preserving byte offsets and newlines so reported line numbers
// stay true. Several scripts now carry comments that literally name these constructs while
// describing the constraint; scanning raw text would flag the prose that documents the rule.
// String and template literals are consumed but NOT blanked: code inside a `${...}` interpolation
// is still code, and a forbidden construct there is still a violation.
export function stripComments(source) {
  const out = []
  const templates = []          // brace depth at which each open interpolation started
  let braces = 0
  let prev = ''                 // last significant code character
  let prevWord = ''             // last identifier/keyword, for the regex-literal heuristic
  let i = 0
  const n = source.length
  const regexAllowed = () =>
    prev === '' ||
    '(,=:[!&|?{};+-*%~^<>'.includes(prev) ||
    ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'do', 'else', 'yield', 'await'].includes(prevWord)

  while (i < n) {
    const ch = source[i]
    const next = source[i + 1]

    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') { out.push(' '); i++ }
      continue
    }
    if (ch === '/' && next === '*') {
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) { out.push(source[i] === '\n' ? '\n' : ' '); i++ }
      if (i < n) { out.push('  '); i += 2 }
      continue
    }
    if (ch === '"' || ch === "'") {
      out.push(ch); i++
      while (i < n) {
        if (source[i] === '\\') { out.push(source[i], source[i + 1] ?? ''); i += 2; continue }
        out.push(source[i])
        if (source[i] === ch) { i++; break }
        i++
      }
      prev = ch; prevWord = ''
      continue
    }
    if (ch === '`') { templates.push(braces); out.push(ch); i++; i = consumeTemplate(source, i, out, templates, () => { braces = templates.pop() }); prev = '`'; prevWord = ''; continue }
    if (ch === '/' && regexAllowed()) {
      out.push(ch); i++
      let inClass = false
      while (i < n) {
        if (source[i] === '\\') { out.push(source[i], source[i + 1] ?? ''); i += 2; continue }
        if (source[i] === '[') inClass = true
        else if (source[i] === ']') inClass = false
        else if (source[i] === '/' && !inClass) { out.push(source[i]); i++; break }
        else if (source[i] === '\n') break
        out.push(source[i]); i++
      }
      while (i < n && /[dgimsuvy]/.test(source[i])) { out.push(source[i]); i++ }
      prev = '/'; prevWord = ''
      continue
    }
    if (ch === '{') braces++
    if (ch === '}') {
      if (templates.length && braces === templates[templates.length - 1]) {
        // closes a `${...}` interpolation: fall back into the enclosing template literal
        templates.pop(); out.push(ch); i++
        templates.push(braces)
        i = consumeTemplate(source, i, out, templates, () => { braces = templates.pop() })
        prev = '`'; prevWord = ''
        continue
      }
      braces--
    }
    if (/\s/.test(ch)) { out.push(ch); i++; continue }
    if (/[A-Za-z0-9_$]/.test(ch)) {
      let word = ''
      while (i < n && /[A-Za-z0-9_$]/.test(source[i])) { word += source[i]; out.push(source[i]); i++ }
      prev = word[word.length - 1]; prevWord = word
      continue
    }
    out.push(ch); prev = ch; prevWord = ''
    i++
  }
  return out.join('')
}

// Consume template-literal text from `i` until either its closing backtick (calls `onClose`) or a
// `${`, at which point control returns to the caller's code loop.
function consumeTemplate(source, i, out, templates, onClose) {
  const n = source.length
  while (i < n) {
    if (source[i] === '\\') { out.push(source[i], source[i + 1] ?? ''); i += 2; continue }
    if (source[i] === '$' && source[i + 1] === '{') { out.push('$', '{'); return i + 2 }
    if (source[i] === '`') { out.push('`'); onClose(); return i + 1 }
    out.push(source[i]); i++
  }
  onClose()
  return i
}

export function scanViolations(source) {
  const code = stripComments(source)
  const violations = []
  for (const { construct, pattern } of FORBIDDEN) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(code)) !== null) {
      const line = code.slice(0, match.index).split('\n').length
      violations.push({ construct, line, text: source.split('\n')[line - 1].trim().slice(0, 140) })
    }
  }
  return violations.sort((a, b) => a.line - b.line)
}

const report = (file, violations) => violations.map(v => `${file}:${v.line}  ${v.construct}  ${v.text}`).join('\n')

// ---------------------------------------------------------------------------------------------
// A. STATIC
// ---------------------------------------------------------------------------------------------
describe('workflow scripts contain no construct the runtime rejects', () => {
  test('there is at least one script to scan', () => {
    expect(SCRIPTS.length).toBeGreaterThan(0)
  })

  for (const file of SCRIPTS.filter(name => !KNOWN_NONCOMPLIANT.has(name))) {
    test(file, () => {
      const violations = scanViolations(readFileSync(join(WORKFLOWS, file), 'utf8'))
      expect(report(file, violations)).toBe('')
    })
  }
})

// ---------------------------------------------------------------------------------------------
// D. SELF-CHECK — the scanner must actually fire. Run in-process against synthetic sources; never
// mutate a real file on disk. A scanner that silently matches nothing is the same class of defect
// as the harness this suite replaces.
// ---------------------------------------------------------------------------------------------
describe('the static scanner fires', () => {
  for (const [name, snippet, construct] of [
    ['dynamic import', "const { readFileSync } = await import('node:fs')\n", 'import()'],
    ['import.meta', "const here = import.meta.url\n", 'import.meta'],
    ['process access', 'const id = process.env.CLAUDE_CODE_SESSION_ID\n', 'process.'],
    ['Buffer', "const bytes = Buffer.from('x', 'utf8')\n", 'Buffer'],
    ['module-relative specifier', "await import(new URL('./lib/x.ts', import.meta.url).href)\n", 'import()'],
    ['construct inside a template interpolation', 'const s = `session ${process.env.X}`\n', 'process.'],
  ]) {
    test(`reports ${name}`, () => {
      const violations = scanViolations(`const meta = {}\n${snippet}`)
      expect(violations.map(v => v.construct)).toContain(construct)
      expect(violations[0].line).toBe(2)
    })
  }

  for (const [name, snippet] of [
    ['a line comment naming the constructs', '// the runtime rejects import(), import.meta, process, and Buffer\n'],
    ['a block comment naming the constructs', '/* import.meta and process.env are unavailable\n   and so is Buffer */\n'],
    ['a trailing comment after real code', 'const x = 1 // process.env would throw here\n'],
  ]) {
    test(`does not report ${name}`, () => {
      expect(scanViolations(`const meta = {}\n${snippet}`)).toEqual([])
    })
  }

  // The stripper is a hand-rolled state machine over strings, templates, `${}` interpolations and
  // regex literals. It replaces comment bytes 1:1 with spaces and copies everything else verbatim,
  // so its output MUST be byte-length-identical to its input. Any desync — a template literal
  // closed early, a regex mistaken for a comment — breaks that invariant, and a desynced stripper
  // fails OPEN by dropping real code from the scan.
  for (const file of SCRIPTS) {
    test(`strips ${file} without losing sync`, () => {
      const source = readFileSync(join(WORKFLOWS, file), 'utf8')
      const stripped = stripComments(source)
      expect(stripped.length).toBe(source.length)
      expect(stripped.split('\n').length).toBe(source.split('\n').length)
    })
  }

  test('preserves line numbers across a stripped block comment', () => {
    const source = 'const meta = {}\n/* filler\n   filler\n   filler */\nconst id = process.env.X\n'
    expect(scanViolations(source)).toEqual([{ construct: 'process.', line: 5, text: 'const id = process.env.X' }])
  })
})

// ---------------------------------------------------------------------------------------------
// B. EXECUTION under a shim that reproduces the runtime.
//
// `new AsyncFunction(body)` is the closest available reproduction: `import.meta` is a hard
// SyntaxError inside a Function constructor, which is exactly what the runtime does, so parse-only
// already catches it. `process` and `Buffer` are bound to `undefined` — the runtime's actual value
// for both — so any access throws rather than silently resolving to Node's globals.
// ---------------------------------------------------------------------------------------------
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const RUNTIME_PARAMS = ['agent', 'parallel', 'pipeline', 'log', 'phase', 'args', 'budget', 'workflow', 'process', 'Buffer']

async function runUnderPureRuntime(file, args = {}) {
  // The ONLY adjustment: the runtime consumes the `meta` header itself, and `export` is illegal in
  // a Function body. Nothing about the script's specifiers, identifiers, or literals is touched —
  // rewriting those is precisely the laundering this suite exists to make impossible.
  const source = readFileSync(join(WORKFLOWS, file), 'utf8').replace(/^export const meta/m, 'const meta')
  const body = new AsyncFunction(...RUNTIME_PARAMS, source)
  const stub = async () => { throw new Error('workflow primitive invoked past argument validation') }
  return body(stub, stub, stub, () => {}, () => {}, args, { spend: () => {} }, file.replace(/\.js$/, ''), undefined, undefined)
}

describe('workflow scripts parse and run under the pure runtime', () => {
  for (const file of SCRIPTS.filter(name => !KNOWN_NONCOMPLIANT.has(name))) {
    const name = basename(file, '.js')
    test(`${file} reaches its own argument validation`, async () => {
      // The specific throw, not merely "some error": a SyntaxError from an unsupported construct
      // and a descriptive argument-validation error are both rejections, and only one is a pass.
      await expect(runUnderPureRuntime(file, {})).rejects.toThrow(new RegExp(`^${name} requires args\\.`))
    })
  }
})

// ---------------------------------------------------------------------------------------------
// C. The quarantine is asserted, not skipped.
// ---------------------------------------------------------------------------------------------
describe('KNOWN_NONCOMPLIANT members are in fact still non-compliant', () => {
  // An empty registry makes every loop below vacuous, so it gets its own assertion rather than
  // quietly contributing zero tests. This is the state we want — it says every script in workflows/
  // is guarded — and it is the state that must be noticed if someone adds an exemption.
  test('every workflow script is guarded; the quarantine is empty', () => {
    expect([...KNOWN_NONCOMPLIANT]).toEqual([])
    expect(SCRIPTS.length).toBeGreaterThan(0)
  })

  for (const file of KNOWN_NONCOMPLIANT) {
    test(`${file} is present`, () => {
      expect(SCRIPTS).toContain(file)
    })

    test(`${file} still contains a construct the runtime rejects`, () => {
      const violations = scanViolations(readFileSync(join(WORKFLOWS, file), 'utf8'))
      expect(violations.length, `${file} is now PURE — delete it from KNOWN_NONCOMPLIANT so this suite starts guarding it.`).toBeGreaterThan(0)
    })

    test(`${file} still fails to load under the pure runtime`, async () => {
      // Proves the shim reproduces the runtime rather than merely re-stating the static scan:
      // this is the failure production actually gets, before a single agent is dispatched.
      await expect(runUnderPureRuntime(file, {})).rejects.toThrow(
        /import\.meta is only valid inside modules|Cannot use 'import\.meta' outside a module/,
      )
    })
  }
})
