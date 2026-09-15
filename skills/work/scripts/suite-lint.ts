#!/usr/bin/env bun
/**
 * suite-lint.ts — the four decidable test-quality rules of issue 134, over test suites.
 *
 * Each rule decides a shape that can be settled by reading the file the assertion lives in, with no
 * judgement and no lens. The doctrine these partially mechanise is
 * `skills/dev/references/writing-good-tests.md`; its Warning Signs list is the spec, and the eleven
 * signs a grep can never decide stay there rather than being approximated here.
 *
 *   R1 positive-match-failure-vocabulary — a positive regex assertion whose pattern also matches a
 *      failure-vocabulary literal in the same file, so the failure branch passes the test.
 *   R2 single-distinct-literal          — a callee invoked more than once where every literal
 *      argument in the file is the same value, so no input distinguishes the two behaviours.
 *   R3 existence-only-artifact          — the only assertion about a produced artifact is that it
 *      exists, which `touch` satisfies. The suite-level twin of plan-lint's
 *      `redcommand-existence-only`.
 *   R4 injected-key-never-varied        — a config key injected in exactly one literal, so nothing
 *      in the suite varies the configuration it injects.
 *
 * Rule 5 is deliberately absent: it needs coverage instrumentation or an AST reachability argument
 * and is not mechanically decidable.
 *
 * `Finding` and `coveredBy` come from plan-lint.ts rather than being redeclared, so a suite-lint
 * finding and a plan-lint finding stay structurally interchangeable.
 *
 * The rules are dialect-neutral: they consume `Extracted` and nothing else. Adding a dialect means
 * adding an extractor, never a second copy of a rule. Two dialects ship: JS/TS and Python, routed by
 * file extension. Python suites that import Python modules are linted where they are — porting one
 * to TypeScript to avoid a second extractor would drop it from a module boundary to a CLI boundary,
 * which is the "Exercise the Real Thing" violation of `skills/dev/references/writing-good-tests.md`.
 */
import { readdirSync, readFileSync, type Dirent } from 'node:fs'
import { join as nodeJoin } from 'node:path'
import { coveredBy, type Finding } from './plan-lint.ts'

// ---------------------------------------------------------------- the rule ids

export const RULE_IDS = [
  'positive-match-failure-vocabulary',
  'single-distinct-literal',
  'existence-only-artifact',
  'injected-key-never-varied',
] as const

export type RuleId = (typeof RULE_IDS)[number]

// ---------------------------------------------------------------- the extracted shape

export type LiteralKind = 'string' | 'template' | 'regex'

/** A literal in the source, with where it sits and what the surrounding call made of it. */
export type Literal = {
  kind: LiteralKind
  /** the literal's value: string contents, or a regex body without its delimiters */
  value: string
  /** the literal exactly as written, delimiters included */
  raw: string
  flags: string
  start: number
  end: number
  line: number
  role: 'plain' | 'test-title' | 'existence-arg'
}

export type ArgKind = 'string' | 'number' | 'bool' | 'regex' | 'other'

export type Arg = {
  text: string
  kind: ArgKind
  value: string
  flags: string
  line: number
}

export type CallSite = {
  /** the full dotted callee as written, e.g. `not.toMatch` or `os.path.exists` */
  callee: string
  /** the last segment of the callee, which is what the rules group on */
  name: string
  /** the callee chain passes through a negation, e.g. `expect(x).not.toMatch(...)` */
  negated: boolean
  line: number
  text: string
  args: Arg[]
}

export type ConfigKeyUse = {
  key: string
  value: string
  line: number
  text: string
}

export type Extracted = {
  path: string
  dialect: string
  source: string
  literals: Literal[]
  calls: CallSite[]
  configKeys: ConfigKeyUse[]
}

/**
 * Optional context. When `artifactPaths` is supplied, R3 only speaks about artifacts the task
 * actually produces, decided with plan-lint's `coveredBy` so "produces this path" means the same
 * thing in both tools.
 */
export type LintContext = { artifactPaths?: string[] }

// ---------------------------------------------------------------- shared vocabulary

/**
 * Words that mark a literal as belonging to an error or failure branch. Deliberately tight: a
 * broader list (`timeout`, `bad`, bare `no`) matches ordinary prose in test titles and turns R1
 * into noise.
 */
const FAILURE_VOCAB =
  /\b(?:not|never|fail(?:s|ed|ing|ure|ures)?|error|errors|missing|absent|unset|invalid|denied|refus\w*|reject\w*|cannot|can't|unable|abort\w*|unavailable|broken|corrupt\w*|isn't|doesn't|didn't|wasn't|won't|no such)\b/i

/** Matchers that assert a pattern MATCHES. A negated form asserts the opposite and is not a defect. */
const POSITIVE_MATCHERS = new Set([
  'toMatch',
  'stringMatching',
  'assertRegex',
  'assertRegexpMatches',
  'assertRegexMatches',
  'search',
  'match',
  'findall',
])

/**
 * Matchers that assert one string CONTAINS another. The substring form of R1: `assertIn('SAVED', …)`
 * and `toContain('saved')` pass on the failure string just as `/saved/i` does, so the rule reads them
 * through the same code path rather than growing a dialect-specific copy.
 */
const SUBSTRING_MATCHERS = new Set(['assertIn', 'assertContains', 'toContain', 'toInclude'])

/** Calls that ask only whether a path is there. R3's whole subject. */
const EXISTENCE_FNS = new Set([
  'existsSync',
  'exists',
  'statSync',
  'lstatSync',
  'accessSync',
  'isfile',
  'isdir',
  'is_file',
  'is_dir',
])

const TEST_DECL_FNS = new Set(['test', 'it', 'describe', 'bench', 'suite'])

/**
 * R2 asks whether the file varies the INPUT under test. A matcher argument is an expected value,
 * not an input, so grouping on `toBe` would report every suite that asserts `true` twice.
 */
const isAssertionCallee = (name: string): boolean =>
  /^to[A-Z]/.test(name) || /^assert/i.test(name) || name === 'expect' || name === 'toBe'

const isPathLike = (v: string): boolean => v.includes('/') || /\.[A-Za-z0-9]{1,6}$/.test(v)

const literalKey = (a: Arg): string => `${a.kind}:${a.value}`

const isLiteralArg = (a: Arg): boolean => a.kind === 'string' || a.kind === 'number' || a.kind === 'bool'

/**
 * Split a group body on its TOP-LEVEL `|`, so `(a|(b|c))` yields two alternatives, not three.
 * Escapes and character classes are stepped over: `[a|b]` is one atom, `\|` is a literal bar.
 */
const topLevelAlternatives = (body: string): string[] => {
  const parts: string[] = []
  let cur = ''
  let depth = 0
  let inClass = false
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '\\') {
      cur += c + (body[i + 1] ?? '')
      i++
      continue
    }
    if (inClass) {
      cur += c
      if (c === ']') inClass = false
      continue
    }
    if (c === '[') { inClass = true; cur += c; continue }
    if (c === '(') { depth++; cur += c; continue }
    if (c === ')') { depth--; cur += c; continue }
    if (c === '|' && depth === 0) { parts.push(cur); cur = ''; continue }
    cur += c
  }
  parts.push(cur)
  return parts
}

/**
 * A quantifier read off the pattern.
 *   `repeats`  — it can apply its atom twice, so a group carrying it is a repetition.
 *   `variable` — the atom's width is not fixed, so it offers the engine a CHOICE. `{3}` repeats but
 *                is not variable: it consumes exactly three, which is why `(,[0-9]{3})+` is linear
 *                and must not be refused.
 */
type Quantifier = { end: number; repeats: boolean; variable: boolean }

/**
 * Reads the quantifier at `i`, if there is one. A regex-only reading of `[+*]` saw no brace form at
 * all, which is how `(a+){2,}` and `(a{1,})+` walked through the old guard.
 */
const quantifierAt = (src: string, i: number): Quantifier | null => {
  const c = src[i]
  if (c === undefined) return null
  const lazy = (end: number): number => (src[end] === '?' || src[end] === '+' ? end + 1 : end)
  if (c === '+' || c === '*') return { end: lazy(i + 1), repeats: true, variable: true }
  if (c === '?') return { end: lazy(i + 1), repeats: false, variable: true }
  if (c !== '{') return null
  const m = /^\{(\d*)(,?)(\d*)\}/.exec(src.slice(i))
  if (!m || (m[1] === '' && m[3] === '')) return null
  const min = m[1] === '' ? 0 : Number(m[1])
  const max = m[2] === '' ? min : m[3] === '' ? Infinity : Number(m[3])
  return { end: lazy(i + m[0].length), repeats: max >= 2, variable: min !== max }
}

/** Group-opening syntax to step over so `(?:x)` and `(?<name>x)` are read as the group they are. */
const GROUP_PREFIX_RE = /^\((?:\?:|\?=|\?!|\?<=|\?<!|\?<[^>]*>|\?[a-zA-Z]*(?:-[a-zA-Z]+)?:)?/

/**
 * Every VARIABLE quantifier in `src`, counted outside character classes and escapes. `[A-Z]{2,4}`
 * carries one; `saved` and `[0-9]{3}` carry none. The count is the exponent in the cost estimate
 * below: a backtracking engine explores roughly `n^q` positions for `q` independent choices, once
 * the exponential shapes have been refused outright.
 *
 * It steps over group PREFIXES for the same reason `groupUses` does: the `?` of `(?:` and `(?=` is
 * syntax, not a quantifier on an atom, and counting it overcharged every pattern holding one.
 */
const variableQuantifiers = (src: string): number => {
  let count = 0
  let i = 0
  let inClass = false
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') { i += 2; continue }
    if (inClass) { if (c === ']') inClass = false; i++; continue }
    if (c === '[') { inClass = true; i++; continue }
    if (c === '(') {
      const prefix = GROUP_PREFIX_RE.exec(src.slice(i))
      i += prefix ? prefix[0].length : 1
      continue
    }
    const q = quantifierAt(src, i)
    if (q) {
      if (q.variable) count++
      i = q.end
      continue
    }
    i++
  }
  return count
}

/** Index of the `)` closing the group opening at `open`, or `src.length` when it never closes. */
const groupEnd = (src: string, open: number): number => {
  let depth = 0
  let inClass = false
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '\\') { i++; continue }
    if (inClass) { if (c === ']') inClass = false; continue }
    if (c === '[') { inClass = true; continue }
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return src.length
}

/** A zero-width assertion group: `(?=`, `(?!`, `(?<=`, `(?<!`. Its match is a mandatory constraint. */
const isAssertionPrefix = (prefix: string): boolean => /^\(\?<?[=!]/.test(prefix)

/** Printable ASCII plus the two whitespace characters a suite literal realistically carries. */
const SAMPLE_CHARS = (() => {
  const cs: string[] = ['\n', '\t']
  for (let c = 0x20; c <= 0x7e; c++) cs.push(String.fromCharCode(c))
  return cs
})()

const charSetCache = new Map<string, Set<string> | null>()

/**
 * Which sample characters one atom can match, or `null` when the atom cannot be sampled. `null` is
 * read as "overlaps everything", so an atom this cannot decide never earns a pin.
 */
const atomCharSet = (atomSource: string): Set<string> | null => {
  const hit = charSetCache.get(atomSource)
  if (hit !== undefined) return hit
  let set: Set<string> | null = null
  try {
    const re = new RegExp(`^(?:${atomSource})$`)
    set = new Set(SAMPLE_CHARS.filter(c => re.test(c)))
    if (set.size === 0) set = null
  } catch {
    set = null
  }
  charSetCache.set(atomSource, set)
  return set
}

/** Conservative: two atoms are DISJOINT only when both sample cleanly and share no character. */
const atomsDisjoint = (a: string, b: string): boolean => {
  const sa = atomCharSet(a)
  const sb = atomCharSet(b)
  if (!sa || !sb) return false
  for (const c of sb) if (sa.has(c)) return false
  return true
}

/**
 * What one alternative of a group body offers a backtracking engine: how many of its elements are
 * VARIABLE-width, and whether anything in it PINS where a repetition must end — a fixed consuming
 * atom, an anchor, or a zero-width assertion. `(a+b)+` and `(\w+(?=x))+` are pinned; `(a+)+` and
 * `(\w+\s?)+` are not, and only the unpinned shape multiplies out.
 *
 * A consuming atom only pins when the alternative's variable atoms cannot match it too. Measured
 * 2026-08-27, `/([^x]+y)+$/` against `'ay'.repeat(n) + '!'`: 10 ms at 41 characters, 39 ms at 45,
 * 157 ms at 49, 317 ms at 53 — because `[^x]` matches the `y` that was supposed to be the pin, so
 * the repetitions overlap exactly as `(a+)+`'s do. `/(a+b)+$/` is 0 ms at every one of those lengths.
 */
const analyzeAlternative = (alt: string): { variable: number; consumingPin: boolean; assertionPin: boolean } => {
  let variable = 0
  let consumingPin = false
  let assertionPin = false
  /** Sources of the variable-width atoms, so a candidate pin can be tested against every one. */
  const variableAtoms: string[] = []
  /** Sources of the fixed consuming atoms, decided only once the variable atoms are all known. */
  const fixedAtoms: string[] = []
  let i = 0
  while (i < alt.length) {
    const c = alt[i]
    if (c === '^' || c === '$') { consumingPin = true; i++; continue }
    let atomEnd: number
    let inner: string | null = null
    let assertion = false
    if (c === '\\') atomEnd = i + 2
    else if (c === '[') {
      let j = i + 1
      if (alt[j] === '^') j++
      if (alt[j] === ']') j++
      while (j < alt.length && alt[j] !== ']') { if (alt[j] === '\\') j++; j++ }
      atomEnd = Math.min(j + 1, alt.length)
    } else if (c === '(') {
      const prefix = GROUP_PREFIX_RE.exec(alt.slice(i))?.[0] ?? '('
      assertion = isAssertionPrefix(prefix)
      const close = groupEnd(alt, i)
      inner = alt.slice(i + prefix.length, close)
      atomEnd = Math.min(close + 1, alt.length)
    } else atomEnd = i + 1
    const q = quantifierAt(alt, atomEnd)
    const next = q ? q.end : atomEnd
    const atomSource = alt.slice(i, atomEnd)
    if (assertion) assertionPin = true
    else if (q?.variable) { variable++; variableAtoms.push(atomSource) }
    else if (inner !== null && isUnpinnedRepetition(inner)) { variable++; variableAtoms.push(atomSource) }
    else fixedAtoms.push(atomSource)
    i = next
  }
  if (fixedAtoms.some(f => variableAtoms.every(v => atomsDisjoint(v, f)))) consumingPin = true
  return { variable, consumingPin, assertionPin }
}

/**
 * True when some alternative of `body` is variable-width with nothing pinning where a repetition
 * ends. Repeating such a body is what makes a match failure exponential; repeating a pinned one
 * (`(a+b)+`, `(foo|bar)+`) is linear, and refusing those would disable R1 across the repository.
 */
const isUnpinnedRepetition = (body: string): boolean =>
  topLevelAlternatives(body).some(alt => {
    const a = analyzeAlternative(alt)
    return a.variable > 0 && !(a.consumingPin || a.assertionPin)
  })

/**
 * A repeated group whose only pin is a ZERO-WIDTH assertion, e.g. `(\w+(?=x))+`. The assertion
 * constrains where a repetition may end without consuming anything, so it does not collapse the
 * engine's choices the way a literal does. Measured 2026-08-27 against `/(\w+(?=x))+$/` on
 * `'ax'.repeat(n) + '!'`: 13 ms at 41 characters, 53 ms at 45, 212 ms at 49 — a 4x step per four
 * characters, which is exponential, not the `n^q` the ordinary cost model assumes.
 *
 * `isCatastrophicPattern` must PERMIT this shape: refusing every repeated group holding a lookahead
 * or a non-capturing group disables R1 on ordinary patterns. So the budget is where it is priced.
 */
const hasAssertionPinnedRepetition = (src: string): boolean =>
  groupUses(src).some(
    use =>
      use.repeated &&
      topLevelAlternatives(use.body).some(alt => {
        const a = analyzeAlternative(alt)
        return a.variable > 0 && a.assertionPin && !a.consumingPin
      }),
  )

type GroupUse = { body: string; repeated: boolean }

/**
 * Every group in `src` with the quantifier that follows it, found by a stack walk rather than by a
 * regex. `[^)]*` inside a pattern-matching-a-pattern stops at the FIRST `)`, so `((a+))+` read as a
 * group body of `(a` and reported nothing; a stack sees the real nesting.
 */
const groupUses = (src: string): GroupUse[] => {
  const uses: GroupUse[] = []
  const open: number[] = []
  let i = 0
  let inClass = false
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') { i += 2; continue }
    if (inClass) { if (c === ']') inClass = false; i++; continue }
    if (c === '[') { inClass = true; i++; continue }
    if (c === '(') {
      const prefix = GROUP_PREFIX_RE.exec(src.slice(i))
      const bodyStart = i + (prefix ? prefix[0].length : 1)
      open.push(bodyStart)
      i = bodyStart
      continue
    }
    if (c === ')') {
      const bodyStart = open.pop()
      const q = quantifierAt(src, i + 1)
      if (bodyStart !== undefined) uses.push({ body: src.slice(bodyStart, i), repeated: !!q?.repeats })
      i = q ? q.end : i + 1
      continue
    }
    i++
  }
  return uses
}

/**
 * Alternatives that OVERLAP — one equal to, or a prefix of, another — give the engine two ways to
 * consume the same input at every repetition. `(a|a)+` and `(a|aa)+` carry no quantifier inside the
 * group, so a nested-quantifier test alone never sees them.
 */
const hasOverlappingAlternatives = (body: string): boolean => {
  const alts = topLevelAlternatives(body)
  if (alts.length < 2) return false
  for (let i = 0; i < alts.length; i++) {
    for (let j = i + 1; j < alts.length; j++) {
      if (alts[i].startsWith(alts[j]) || alts[j].startsWith(alts[i])) return true
    }
  }
  return false
}

/**
 * Decides which attacker-authored patterns are safe to RUN. The lint builds regexes out of files it
 * did not write, so a shape that can backtrack catastrophically is refused rather than executed: a
 * REPEATED group whose body itself repeats, or whose alternatives overlap, is exponential on a
 * failing match however the repetition is spelled — `+`, `*`, `{2,}` or `{1,}`, capturing or not,
 * nested one level or three.
 *
 * It must stay PERMISSIVE for ordinary suite patterns: a guard that refuses everything silently
 * disables R1 repo-wide, which is the same defect wearing a safe hat. A group nobody repeats
 * (`(foo|bar)`) and a quantifier on no group at all (`a+b*c`, `[A-Z]{2,4}`) are left alone.
 *
 * It is also NOT the whole defence. A blocklist over an infinite grammar cannot be completed, so
 * `evaluationBudget` below bounds what survives this function.
 */
export const isCatastrophicPattern = (src: string): boolean => {
  if (src.length > 200) return true
  if (/(\[[^\]]*\][+*]){3,}/.test(src)) return true
  for (const use of groupUses(src)) {
    if (!use.repeated) continue
    if (isUnpinnedRepetition(use.body)) return true
    if (hasOverlappingAlternatives(use.body)) return true
  }
  return false
}

// ---------------------------------------------------------------- the evaluation budget

/**
 * Wall-clock ceiling on ONE file's pattern evaluations. The guard decides shapes; this decides that
 * the file terminates whatever the guard concluded, because the next unlisted shape is always free.
 */
const BUDGET_MS = Number(process.env.CRAFT_SUITE_LINT_BUDGET_MS ?? '') || 1500

/**
 * Estimated backtracking positions one pattern may explore against one subject. Refusing a pair
 * over this ceiling is what keeps a SINGLE evaluation bounded — the wall clock cannot interrupt a
 * regex already running, so the expensive pair has to be declined before it starts. Measured
 * 2026-08-27: `/a*a*a*a*a*a*a*a*a*a*$/` against one 45-character subject takes 43,545 ms, and the
 * guard permits it, because it has no group for the nested-quantifier test to see.
 */
const PAIR_COST_CAP = 1e6

/** Total estimated positions one file may spend, so many merely-borderline pairs cannot add up. */
const FILE_COST_CAP = 2e14

/**
 * A per-file budget. Exceeding it behaves exactly like the guard refusing: the pair is skipped, no
 * finding is emitted, nothing is thrown. A hung lint stalls every dispatch in the repository, and a
 * false negative is the cheaper failure.
 *
 * The two cost ceilings are deterministic and do the work; the wall clock is the last resort for a
 * shape the cost model underestimates, and it is the one term that could in principle make two runs
 * over one hostile file disagree. It cannot fire on a file the cost ceilings already cleared, which
 * is why corpus mode stays byte-reproducible over anything this repository actually contains.
 */
const evaluationBudget = () => {
  const started = Date.now()
  let spent = 0
  return {
    /** True when the file can still afford `patternCost`; charges it when it can. */
    afford(patternCost: number): boolean {
      if (spent + patternCost > FILE_COST_CAP) return false
      if (Date.now() - started > BUDGET_MS) return false
      spent += patternCost
      return true
    },
  }
}

/** `n^q`, the cost model `variableQuantifiers` documents, clamped so it never overflows to NaN. */
const pairCost = (quantifiers: number, subjectLength: number): number =>
  quantifiers === 0 ? 1 : Math.min(Math.pow(Math.max(subjectLength, 1), quantifiers), Number.MAX_SAFE_INTEGER)

/**
 * Whether every top-level alternative begins with a start anchor, so the engine has exactly ONE
 * start position to try. `^a|^b` is anchored; `^a|b` is not, because the second branch is retried
 * everywhere. `\A` is accepted for the dialects that spell it that way.
 */
const isStartAnchored = (src: string): boolean =>
  topLevelAlternatives(src).every(alt => alt.startsWith('^') || alt.startsWith('\\A'))

/**
 * What one evaluation of `pattern` against a subject of `subjectLength` characters is charged.
 *
 * The START-POSITION SCAN is the term the first cost model omitted, and omitting it is what let a
 * 97-second pair be priced as affordable. `re.test` on an UNANCHORED pattern restarts the whole
 * match at every offset, so it costs one more power of n than the same pattern anchored. MEASURED
 * 2026-08-27 with `bun /tmp/measure-scan.ts`, one `/a*b/` against one all-`a` subject: 17 ms at
 * n=12,500, 63 ms at 25,000, 264 ms at 50,000, 1,005 ms at 100,000, 4,021 ms at 200,000 — every
 * doubling of n quadruples the time, which is `n^2` for a pattern `n^q` prices at `n^1`. The same
 * pattern written `/^a*b/` takes 0 ms at 400,000 and 1 ms at 1,000,000.
 */
const pairCostOf = (pattern: string, subjectLength: number): number => {
  const n = Math.max(subjectLength, 1)
  // An assertion-pinned repetition is exponential in the subject, so `n^q` under-prices it by orders
  // of magnitude and the guard is required to let it through. Charge what it actually costs.
  if (hasAssertionPinnedRepetition(pattern)) return Math.min(Math.pow(2, n), Number.MAX_SAFE_INTEGER)
  return pairCost(variableQuantifiers(pattern) + (isStartAnchored(pattern) ? 0 : 1), n)
}

/**
 * Whether ONE pattern may be run against ONE subject of `subjectLength` characters. Exported for the
 * same reason `isCatastrophicPattern` is: declining a pair emits no finding, which is
 * indistinguishable from a pattern that simply did not match, so the decision is untestable through
 * `lintSource`. `/a*a*a*a*a*!$/` passes the guard — it has no group for the repeated-group rule to
 * see — and is declined here before it is ever compiled against a subject. So does `/a*b/`, which
 * has no group at all: widening the guard could never reach it, and the budget is what stops it.
 */
export const isAffordablePair = (pattern: string, subjectLength: number): boolean =>
  pairCostOf(pattern, subjectLength) <= PAIR_COST_CAP

// ---------------------------------------------------------------- source scanning (JS/TS)

const JS_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'await', 'yield',
  'new', 'delete', 'void', 'in', 'of', 'do', 'else', 'case', 'with',
])

const lineIndexer = (source: string) => {
  const starts = [0]
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1)
  return (offset: number): number => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
}

const JS_ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0' }

const REGEX_PRECEDERS = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^',
])

type Scan = { masked: string; literals: Literal[] }

/**
 * One character per masked character, so every offset into `masked` is the same offset into the
 * original source. A byte no source realistically contains, so a masked span is recognisable.
 */
const MASK = '\u0001'

/**
 * Blanks out every string, template, regex and comment body while preserving offsets exactly, so a
 * comma inside a string cannot split an argument list and a paren inside a comment cannot unbalance
 * one. Every literal's real text is recovered by slicing the ORIGINAL source at the same offsets.
 *
 * Throws when the source ends inside a literal or comment: a file that cannot be scanned is not a
 * clean file, and the caller counts it rather than dropping it.
 */
const scanJs = (source: string): Scan => {
  const out = source.split('')
  const literals: Literal[] = []
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ''
  }
  let i = 0
  let lastSig = ''
  while (i < source.length) {
    const c = source[i]
    if (c === '/' && source[i + 1] === '/') {
      let j = i + 2
      while (j < source.length && source[j] !== '\n') j++
      blank(i, j)
      i = j
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      const j = source.indexOf('*/', i + 2)
      if (j < 0) throw new Error('unterminated block comment')
      blank(i, j + 2)
      i = j + 2
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      let value = ''
      while (j < source.length) {
        const d = source[j]
        if (d === '\\') {
          const e = source[j + 1]
          value += JS_ESCAPES[e] ?? e ?? ''
          j += 2
          continue
        }
        if (d === c) break
        if (d === '\n') throw new Error(`unterminated string on line ${i}`)
        value += d
        j++
      }
      if (j >= source.length) throw new Error('unterminated string')
      literals.push({ kind: 'string', value, raw: source.slice(i, j + 1), flags: '', start: i, end: j + 1, line: 0, role: 'plain' })
      blank(i + 1, j)
      i = j + 1
      lastSig = c
      continue
    }
    if (c === '`') {
      let j = i + 1
      let depth = 0
      while (j < source.length) {
        const d = source[j]
        if (d === '\\') { j += 2; continue }
        if (d === '$' && source[j + 1] === '{') { depth++; j += 2; continue }
        if (d === '}' && depth > 0) { depth--; j++; continue }
        if (d === '`' && depth === 0) break
        j++
      }
      if (j >= source.length) throw new Error('unterminated template literal')
      literals.push({ kind: 'template', value: source.slice(i + 1, j), raw: source.slice(i, j + 1), flags: '', start: i, end: j + 1, line: 0, role: 'plain' })
      blank(i + 1, j)
      i = j + 1
      lastSig = '`'
      continue
    }
    if (c === '/' && (lastSig === '' || REGEX_PRECEDERS.has(lastSig))) {
      let j = i + 1
      let inClass = false
      let closed = false
      while (j < source.length) {
        const d = source[j]
        if (d === '\\') { j += 2; continue }
        if (d === '\n') break
        if (d === '[') inClass = true
        else if (d === ']') inClass = false
        else if (d === '/' && !inClass) { closed = true; break }
        j++
      }
      if (!closed) throw new Error('unterminated regular expression')
      let k = j + 1
      while (k < source.length && /[a-z]/.test(source[k])) k++
      literals.push({
        kind: 'regex',
        value: source.slice(i + 1, j),
        raw: source.slice(i, k),
        flags: source.slice(j + 1, k),
        start: i,
        end: k,
        line: 0,
        role: 'plain',
      })
      blank(i + 1, k)
      i = k
      lastSig = 'x'
      continue
    }
    if (!/\s/.test(c)) lastSig = c
    i++
  }
  return { masked: out.join(''), literals }
}

const matchParen = (masked: string, open: number): number => {
  let depth = 0
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === '(') depth++
    else if (masked[i] === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Top-level comma split over the masked text; returns offset ranges into the original source. */
const splitArgs = (masked: string, from: number, to: number): [number, number][] => {
  const spans: [number, number][] = []
  let depth = 0
  let start = from
  for (let i = from; i < to; i++) {
    const c = masked[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === ',' && depth === 0) {
      spans.push([start, i])
      start = i + 1
    }
  }
  if (to > start || spans.length > 0) spans.push([start, to])
  return spans.filter(([a, b]) => masked.slice(a, b).trim().length > 0)
}

// ---------------------------------------------------------------- extraction (JS/TS)

const CONFIG_KEY_RE = /(?:^|[{,;(\s])(['"]?)([A-Z][A-Z0-9_]{2,})\1\s*:/gm

/** `process.env.KEY = ...` and `env: { KEY: ... }` are the same injection; both are one use. */
const ENV_ASSIGN_RE = /process\.env\.([A-Z][A-Z0-9_]{2,})\s*=/g

const classifyArg = (
  source: string,
  span: [number, number],
  litByStart: Map<number, Literal>,
  lineOf: (o: number) => number,
): Arg => {
  let [s, e] = span
  while (s < e && /\s/.test(source[s])) s++
  while (e > s && /\s/.test(source[e - 1])) e--
  const text = source.slice(s, e)
  const lit = litByStart.get(s)
  if (lit && lit.end === e) {
    if (lit.kind === 'regex') return { text, kind: 'regex', value: lit.value, flags: lit.flags, line: lineOf(s) }
    return { text, kind: 'string', value: lit.value, flags: '', line: lineOf(s) }
  }
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return { text, kind: 'number', value: text, flags: '', line: lineOf(s) }
  // `True`/`False` are the same literal in the other dialect; folding case keeps one literal key.
  if (/^(?:true|false)$/i.test(text)) return { text, kind: 'bool', value: text.toLowerCase(), flags: '', line: lineOf(s) }
  return { text, kind: 'other', value: text, flags: '', line: lineOf(s) }
}

const configKeysFrom = (source: string, literals: Literal[], masked: string, lineOf: (o: number) => number): ConfigKeyUse[] => {
  const uses: ConfigKeyUse[] = []
  const inStringBody = (offset: number, key: string): boolean =>
    literals.some(l => l.kind !== 'regex' && offset > l.start && offset < l.end - 1 && l.value !== key)
  let m: RegExpExecArray | null
  CONFIG_KEY_RE.lastIndex = 0
  while ((m = CONFIG_KEY_RE.exec(source))) {
    const key = m[2]
    const keyStart = m.index + m[0].indexOf(key)
    if (inStringBody(keyStart, key)) continue
    const colon = m.index + m[0].length
    let end = colon
    let depth = 0
    while (end < masked.length) {
      const c = masked[end]
      if (c === '(' || c === '[' || c === '{') depth++
      else if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) break
        depth--
      } else if ((c === ',' || c === '\n') && depth === 0) break
      end++
    }
    const value = source.slice(colon, end).trim()
    if (!/^(?:['"`].*|-?\d+(?:\.\d+)?|true|false)$/s.test(value)) continue
    uses.push({ key, value, line: lineOf(keyStart), text: `${key}: ${value}` })
  }
  ENV_ASSIGN_RE.lastIndex = 0
  while ((m = ENV_ASSIGN_RE.exec(source))) {
    if (inStringBody(m.index, m[1])) continue
    uses.push({ key: m[1], value: '', line: lineOf(m.index), text: m[0] })
  }
  return uses
}

/**
 * A test title is prose about the test, and an existence argument is R3's own subject. Both would
 * otherwise read as ordinary literals to the rules that consume them. Dialect-neutral: it reads only
 * the extracted calls and literals, so both extractors call it rather than restating it.
 */
const assignRoles = (calls: CallSite[], literals: Literal[]): void => {
  for (const call of calls) {
    if (TEST_DECL_FNS.has(call.name)) {
      const first = call.args[0]
      if (first?.kind === 'string') {
        const lit = literals.find(l => l.line === first.line && l.value === first.value && l.kind !== 'regex')
        if (lit) lit.role = 'test-title'
      }
    }
    if (EXISTENCE_FNS.has(call.name)) {
      for (const a of call.args) {
        if (a.kind !== 'string') continue
        for (const lit of literals) {
          if (lit.kind === 'string' && lit.value === a.value && lit.line === a.line) lit.role = 'existence-arg'
        }
      }
    }
  }
}

const extractJs = (path: string, source: string): Extracted => {
  const { masked, literals } = scanJs(source)
  const lineOf = lineIndexer(source)
  for (const l of literals) l.line = lineOf(l.start)
  const litByStart = new Map(literals.map(l => [l.start, l] as const))

  const calls: CallSite[] = []
  const CALL_RE = /([A-Za-z_$][A-Za-z0-9_$.]*)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = CALL_RE.exec(masked))) {
    const callee = m[1]
    const segs = callee.split('.').filter(Boolean)
    const name = segs[segs.length - 1] ?? ''
    if (!name || JS_KEYWORDS.has(name) || JS_KEYWORDS.has(segs[0])) continue
    const open = m.index + m[0].length - 1
    const close = matchParen(masked, open)
    if (close < 0) continue
    const args = splitArgs(masked, open + 1, close).map(span => classifyArg(source, span, litByStart, lineOf))
    calls.push({
      callee,
      name,
      negated: segs.includes('not'),
      line: lineOf(m.index),
      text: source.slice(m.index, Math.min(close + 1, m.index + 160)),
      args,
    })
  }

  assignRoles(calls, literals)

  return { path, dialect: 'js', source, literals, calls, configKeys: configKeysFrom(source, literals, masked, lineOf) }
}

// ---------------------------------------------------------------- source scanning (Python)

const PY_KEYWORDS = new Set([
  'if', 'elif', 'else', 'for', 'while', 'return', 'yield', 'assert', 'with', 'del', 'raise',
  'lambda', 'not', 'and', 'or', 'in', 'is', 'class', 'def', 'import', 'from', 'global',
  'nonlocal', 'pass', 'except', 'finally', 'try', 'await', 'async',
])

/** Python keeps the backslash on an escape it does not recognise; `"\d+"` is `\d+`, not `d+`. */
const PY_ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0' }

const pyEscape = (e: string | undefined): string => {
  if (e === undefined) return '\\'
  if (PY_ESCAPES[e] !== undefined) return PY_ESCAPES[e]
  return e === '\\' || e === "'" || e === '"' ? e : `\\${e}`
}

const PY_STRING_PREFIXES = /^[rRbBuUfF]{0,2}$/

/**
 * The Python twin of `scanJs`: blanks every string body and comment with `MASK`, one character for
 * one character, so an offset into `masked` is the same offset into `source`. Handles the string
 * prefixes (`r`, `b`, `u`, `f`) and triple quotes, and keeps a raw string's backslashes, which is
 * what makes `r"\bsaved"` usable as a pattern.
 *
 * Throws when the source ends inside a literal, for the same reason `scanJs` does: a file that
 * cannot be scanned is not a clean file, and the caller counts it rather than dropping it.
 */
const scanPy = (source: string): Scan => {
  const out = source.split('')
  const literals: Literal[] = []
  const lineOf = lineIndexer(source)
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = MASK
  }
  let i = 0
  while (i < source.length) {
    const c = source[i]
    if (c === '#') {
      let j = i
      while (j < source.length && source[j] !== '\n') j++
      blank(i, j)
      i = j
      continue
    }
    if (c !== '"' && c !== "'") {
      i++
      continue
    }
    let prefixStart = i
    while (prefixStart > 0 && /[A-Za-z]/.test(source[prefixStart - 1])) prefixStart--
    const prefix = source.slice(prefixStart, i)
    const prefixed =
      PY_STRING_PREFIXES.test(prefix) && (prefixStart === 0 || !/[A-Za-z0-9_]/.test(source[prefixStart - 1]))
    const start = prefixed ? prefixStart : i
    const isRaw = prefixed && /[rR]/.test(prefix)
    const isFmt = prefixed && /[fF]/.test(prefix)
    const quote = source.startsWith(c + c + c, i) ? c + c + c : c
    let j = i + quote.length
    let value = ''
    let closed = false
    while (j < source.length) {
      const d = source[j]
      if (d === '\\') {
        value += isRaw ? d + (source[j + 1] ?? '') : pyEscape(source[j + 1])
        j += 2
        continue
      }
      if (quote.length === 1 && d === '\n') break
      if (source.startsWith(quote, j)) {
        closed = true
        break
      }
      value += d
      j++
    }
    if (!closed) throw new Error(`unterminated string on line ${lineOf(i)}`)
    const end = j + quote.length
    literals.push({
      kind: isFmt ? 'template' : 'string',
      value,
      raw: source.slice(start, end),
      flags: '',
      start,
      end,
      line: 0,
      role: 'plain',
    })
    blank(i + quote.length, j)
    i = end
  }
  return { masked: out.join(''), literals }
}

// ---------------------------------------------------------------- extraction (Python)

/** `re.I` and friends, so a Python pattern reaches R1 with the flags it was compiled under. */
const PY_RE_FLAGS: [RegExp, string][] = [
  [/\bre\.(?:I|IGNORECASE)\b/, 'i'],
  [/\bre\.(?:M|MULTILINE)\b/, 'm'],
  [/\bre\.(?:S|DOTALL)\b/, 's'],
]

/**
 * A Python string only becomes a pattern because of the call it sits in. Kept tight to `re.*` and
 * the unittest regex asserts: `name === 'split'` alone would reclassify every `str.split(',')`.
 */
const isPyRegexCall = (call: CallSite): boolean =>
  /^re\./.test(call.callee) || /^assert(?:Not)?Regex/i.test(call.name)

/** `assertNotIn`, `assertNotRegex` and `assertFalse` are the Python spelling of the `.not.` chain. */
const isPyNegated = (callee: string): boolean => /(?:^|\.)assert(?:Not[A-Z]|False)/.test(callee)

const extractPy = (path: string, source: string): Extracted => {
  const { masked, literals } = scanPy(source)
  const lineOf = lineIndexer(source)
  for (const l of literals) l.line = lineOf(l.start)
  const litByStart = new Map(literals.map(l => [l.start, l] as const))

  const calls: CallSite[] = []
  /** paren span of each call, parallel to `calls`, so a negated wrapper can be seen to enclose. */
  const spans: { start: number; close: number }[] = []
  const CALL_RE = /([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = CALL_RE.exec(masked))) {
    const callee = m[1]
    const segs = callee.split('.').filter(Boolean)
    const name = segs[segs.length - 1] ?? ''
    if (!name || PY_KEYWORDS.has(name) || PY_KEYWORDS.has(segs[0])) continue
    const open = m.index + m[0].length - 1
    const close = matchParen(masked, open)
    if (close < 0) continue
    const args = splitArgs(masked, open + 1, close).map(span => classifyArg(source, span, litByStart, lineOf))
    calls.push({
      callee,
      name,
      negated: isPyNegated(callee),
      line: lineOf(m.index),
      text: source.slice(m.index, Math.min(close + 1, m.index + 160)),
      args,
    })
    spans.push({ start: m.index, close })
  }

  // A negated Python assert negates its subject, and in `assertFalse(re.search(...))` the subject is
  // itself a call — the one carrying the pattern R1 reads. Negation therefore has to reach inside.
  for (let outer = 0; outer < calls.length; outer++) {
    if (!calls[outer].negated) continue
    for (let inner = 0; inner < calls.length; inner++) {
      if (inner === outer) continue
      if (spans[inner].start > spans[outer].start && spans[inner].close <= spans[outer].close) {
        calls[inner].negated = true
      }
    }
  }

  for (const call of calls) {
    if (!isPyRegexCall(call)) continue
    const pattern = call.args.find(a => a.kind === 'string')
    if (!pattern) continue
    pattern.kind = 'regex'
    pattern.flags = PY_RE_FLAGS.filter(([re]) => call.args.some(a => re.test(a.text))).map(([, f]) => f).join('')
  }

  assignRoles(calls, literals)

  return { path, dialect: 'python', source, literals, calls, configKeys: configKeysFrom(source, literals, masked, lineOf) }
}

// ---------------------------------------------------------------- dialect routing

const JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'])

const PY_EXTENSIONS = new Set(['.py', '.pyi'])

const extensionOf = (path: string): string => {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot).toLowerCase()
}

/**
 * Routes by extension and hands back the dialect-neutral shape the rules consume. THROWS on a
 * source it cannot scan, so a caller can count what it failed to read instead of silently
 * reporting it clean.
 */
export function extract(path: string, source: string): Extracted {
  const ext = extensionOf(path)
  if (JS_EXTENSIONS.has(ext)) return extractJs(path, source)
  if (PY_EXTENSIONS.has(ext)) return extractPy(path, source)
  throw new Error(`suite-lint: no extractor for ${path} (extension ${ext || 'none'})`)
}

// ---------------------------------------------------------------- the rules

const at = (e: Extracted, line: number): string => `${e.path}:${line}`

const r1 = (e: Extracted): Finding[] => {
  const findings: Finding[] = []
  const failureLiterals = e.literals.filter(
    l => l.kind === 'string' && l.role === 'plain' && l.value.length >= 4 && FAILURE_VOCAB.test(l.value),
  )
  if (failureLiterals.length === 0) return findings
  // One budget per file: `r1` is called once per extracted source, so its lifetime IS the file's.
  const budget = evaluationBudget()
  for (const call of e.calls) {
    const asPattern = POSITIVE_MATCHERS.has(call.name)
    const asSubstring = SUBSTRING_MATCHERS.has(call.name)
    if ((!asPattern && !asSubstring) || call.negated) continue
    for (const arg of call.args) {
      // A needle carrying failure vocabulary of its own is asserting the failure branch on purpose.
      if (FAILURE_VOCAB.test(arg.value)) continue
      let matches: (value: string) => boolean
      let shown: string
      /** What one evaluation against a subject of length `n` is charged. */
      let cost: (n: number) => number
      /** Whether this pattern may run against a subject of length `n` at all. */
      let affordable: (n: number) => boolean
      if (asPattern && arg.kind === 'regex') {
        if (isCatastrophicPattern(arg.value)) continue
        let re: RegExp
        try {
          re = new RegExp(arg.value, arg.flags.replace(/[gy]/g, ''))
        } catch {
          continue
        }
        // One cost model, asked twice: the file budget must charge what the pair decision priced,
        // or a pair declined as unaffordable could still be billed at the old, lower estimate.
        matches = value => re.test(value)
        cost = n => pairCostOf(arg.value, n)
        affordable = n => isAffordablePair(arg.value, n)
        shown = `/${arg.value}/${arg.flags}`
      } else if (asSubstring && arg.kind === 'string' && arg.value.length >= 3) {
        matches = value => value.includes(arg.value)
        cost = () => 1
        affordable = () => true
        shown = JSON.stringify(arg.value)
      } else continue
      for (const lit of failureLiterals) {
        // Over budget behaves like the guard refusing: no finding, no throw, no further evaluation.
        if (!affordable(lit.value.length)) break
        if (!budget.afford(cost(lit.value.length))) break
        if (!matches(lit.value)) continue
        findings.push({
          rule: 'positive-match-failure-vocabulary',
          severity: 'major',
          where: at(e, call.line),
          message: `\`${call.name}\` asserts a positive match, but its pattern also matches a failure-vocabulary literal in this file, so the failure branch passes the test.`,
          evidence: `${shown} matches ${JSON.stringify(lit.value)} (line ${lit.line})`,
        })
        break
      }
    }
  }
  return findings
}

const r2 = (e: Extracted): Finding[] => {
  const findings: Finding[] = []
  const groups = new Map<string, CallSite[]>()
  for (const call of e.calls) {
    if (isAssertionCallee(call.name) || TEST_DECL_FNS.has(call.name)) continue
    if (!call.args.some(isLiteralArg)) continue
    const list = groups.get(call.name)
    if (list) list.push(call)
    else groups.set(call.name, [call])
  }
  for (const [name, calls] of groups) {
    if (calls.length < 2) continue
    const values = new Set<string>()
    for (const call of calls) for (const a of call.args) if (isLiteralArg(a)) values.add(literalKey(a))
    if (values.size !== 1) continue
    const only = [...values][0].split(':').slice(1).join(':')
    findings.push({
      rule: 'single-distinct-literal',
      severity: 'major',
      where: at(e, calls[0].line),
      message: `\`${name}\` is called ${calls.length} times and every literal argument in this file is the same value, so no input here distinguishes the behaviours the tests claim differ.`,
      evidence: `${name}(${only}) — ${calls.length} calls, 1 distinct literal, lines ${calls.map(c => c.line).join(', ')}`,
    })
  }
  return findings
}

const r3 = (e: Extracted, ctx: LintContext = {}): Finding[] => {
  const findings: Finding[] = []
  const seen = new Set<string>()
  for (const call of e.calls) {
    if (!EXISTENCE_FNS.has(call.name)) continue
    for (const arg of call.args) {
      if (arg.kind !== 'string' || !isPathLike(arg.value)) continue
      if (seen.has(arg.value)) continue
      if (ctx.artifactPaths?.length && !coveredBy(arg.value, ctx.artifactPaths)) continue
      const contentUses = e.literals.filter(
        l => l.kind === 'string' && l.value === arg.value && l.role !== 'existence-arg',
      )
      if (contentUses.length > 0) continue
      seen.add(arg.value)
      findings.push({
        rule: 'existence-only-artifact',
        severity: 'major',
        where: at(e, call.line),
        message: `The only assertion about this artifact is that it exists, which \`touch\` satisfies — nothing here reads its content.`,
        evidence: `${call.name}(${JSON.stringify(arg.value)}) is the only reference to ${arg.value} in this file`,
      })
    }
  }
  return findings
}

const r4 = (e: Extracted): Finding[] => {
  const findings: Finding[] = []
  const byKey = new Map<string, ConfigKeyUse[]>()
  for (const use of e.configKeys) {
    const list = byKey.get(use.key)
    if (list) list.push(use)
    else byKey.set(use.key, [use])
  }
  for (const [key, uses] of byKey) {
    if (uses.length !== 1) continue
    const use = uses[0]
    findings.push({
      rule: 'injected-key-never-varied',
      severity: 'major',
      where: at(e, use.line),
      message: `\`${key}\` is injected in exactly one literal across this suite, so no test varies the configuration it injects and the key could be ignored entirely without failing anything.`,
      evidence: `${use.text} — the only occurrence of ${key} (line ${use.line})`,
    })
  }
  return findings
}

export const RULES: readonly { id: RuleId; check(e: Extracted, ctx?: LintContext): Finding[] }[] = [
  { id: 'positive-match-failure-vocabulary', check: e => r1(e) },
  { id: 'single-distinct-literal', check: e => r2(e) },
  { id: 'existence-only-artifact', check: (e, ctx) => r3(e, ctx) },
  { id: 'injected-key-never-varied', check: e => r4(e) },
]

// ---------------------------------------------------------------- entry point

/**
 * Lints one source. Findings come back in rule order, then line order, so two runs over one tree
 * print the same bytes.
 */
export function lintSource(path: string, source: string, ctx: LintContext = {}): Finding[] {
  const extracted = extract(path, source)
  const findings: Finding[] = []
  for (const rule of RULES) {
    const own = rule.check(extracted, ctx)
    own.sort((a, b) => Number(a.where.split(':').pop()) - Number(b.where.split(':').pop()))
    findings.push(...own)
  }
  return findings
}

// ---------------------------------------------------------------- corpus mode

/**
 * What the walker considers a suite. A production module is not one: linting `helper.ts` would
 * measure rules written about assertions against a file that makes none, and every such file would
 * enter the denominator of the false-positive rate the corpus mode exists to produce.
 */
const JS_SUITE_RE = /\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/
const PY_SUITE_RE = /^test_[^/]*\.py$|_test\.py$/

const isSuiteFile = (base: string): boolean => JS_SUITE_RE.test(base) || PY_SUITE_RE.test(base)

/** Directories a corpus run must never descend into: not ours, and large enough to dominate the walk. */
const SKIP_DIRS = new Set(['node_modules', 'vendor', '__pycache__', '.git'])

export type CorpusSummary = {
  root: string
  filesLinted: number
  unparseable: number
  /** root-relative, sorted */
  unparseableFiles: string[]
  /** every rule id present, zero included */
  counts: Record<RuleId, number>
  /** sorted by file, then line, then rule; `where` paths are ROOT-RELATIVE */
  findings: Finding[]
}

/** Sorted `readdir`, so the walk order is the same on every filesystem and in every run. */
const suiteFilesUnder = (root: string): string[] => {
  const found: string[] = []
  const walk = (relDir: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(relDir ? nodeJoin(root, relDir) : root, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      // `isDirectory()` is false for a symlink, which is what keeps a link cycle out of the walk.
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        walk(rel)
      } else if (entry.isFile() && isSuiteFile(entry.name)) {
        found.push(rel)
      }
    }
  }
  walk('')
  return found.sort()
}

const lineNumberOf = (where: string): number => {
  const n = Number(where.slice(where.lastIndexOf(':') + 1))
  return Number.isFinite(n) ? n : 0
}

const fileOf = (where: string): string => where.slice(0, where.lastIndexOf(':'))

/**
 * Walks every suite under `root`, lints it in whichever dialect its extension selects, and returns
 * per-rule counts alongside the number of files that could NOT be read or scanned.
 *
 * The unparseable count is not bookkeeping. A file that was never linted contributes zero findings,
 * which is byte-identical to a clean verdict, so dropping it silently would let the corpus report
 * "no defects" over a suite nothing looked at — the same reason `workflow.js` synthesizes a critical
 * for a dead lens rather than treating its silence as approval.
 *
 * Paths are root-relative and every collection is sorted, so two runs over one tree serialize to the
 * same bytes and the false-positive number can be recomputed by anyone who disputes it.
 */
export function lintCorpus(root: string, ctx: LintContext = {}): CorpusSummary {
  const counts = Object.fromEntries(RULE_IDS.map(id => [id, 0])) as Record<RuleId, number>
  const findings: Finding[] = []
  const unparseableFiles: string[] = []
  let filesLinted = 0

  for (const rel of suiteFilesUnder(root)) {
    let own: Finding[]
    try {
      own = lintSource(rel, readFileSync(nodeJoin(root, rel), 'utf8'), ctx)
    } catch {
      unparseableFiles.push(rel)
      continue
    }
    filesLinted++
    for (const f of own) {
      if (f.rule in counts) counts[f.rule as RuleId]++
      findings.push(f)
    }
  }

  findings.sort((a, b) => {
    const fa = fileOf(a.where)
    const fb = fileOf(b.where)
    if (fa !== fb) return fa < fb ? -1 : 1
    const la = lineNumberOf(a.where)
    const lb = lineNumberOf(b.where)
    if (la !== lb) return la - lb
    return a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0
  })

  return { root, filesLinted, unparseable: unparseableFiles.length, unparseableFiles: unparseableFiles.sort(), counts, findings }
}

/**
 * The human half first, the machine half second. A reader gets the per-rule counts without parsing
 * anything, and a consumer takes everything from the first `{` to the last `}`. No wall-clock and no
 * randomness appears in either half, which is what makes two consecutive runs byte-identical.
 */
export function formatCorpusSummary(s: CorpusSummary): string {
  const width = Math.max(...RULE_IDS.map(id => id.length))
  const lines = [
    `suite-lint corpus: ${s.root}`,
    `files linted: ${s.filesLinted}`,
    `unparseable files: ${s.unparseable}`,
    ...s.unparseableFiles.map(f => `  ! ${f}`),
    '',
    'findings by rule:',
    ...RULE_IDS.map(id => `  ${id.padEnd(width)}  ${s.counts[id]}`),
    `  ${'total'.padEnd(width)}  ${s.findings.length}`,
    '',
    JSON.stringify(s, null, 2),
  ]
  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------- CLI

function main(argv: string[]): void {
  const i = argv.indexOf('--corpus')
  if (i < 0 || !argv[i + 1]) {
    console.error('usage: suite-lint.ts --corpus <root>')
    process.exit(2)
  }
  process.stdout.write(formatCorpusSummary(lintCorpus(argv[i + 1])))
  process.exit(0)
}

if (import.meta.main) main(process.argv.slice(2))
