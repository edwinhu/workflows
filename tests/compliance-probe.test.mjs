// The compliance probe, run against THIS repo. Self-hosting is the point.
//
// `workflow-creator` is a meta workflow, so an auditor that only inspects generated workflows catches
// the next workflow's version of a bug and never its own host's. Every defect this probe encodes was
// in the host:
//
//   beat-implement.js correct and never run (4 months) · writing/workshop dispatching with no bounds ·
//   work-implement-observation.ts registered in nothing (shipped in v5.106.0) · teaching's contract pin
//   never compared to the lifecycle it documents
//
// KNOWN_FINDINGS works like KNOWN_GAPS and KNOWN_NONCOMPLIANT: each entry is asserted to STILL be a
// finding, so fixing one turns this suite red and names the entry to delete. A NEW finding fails
// immediately rather than joining the list unnoticed.
//
// Run: bun tests/compliance-probe.test.mjs
import { probeCompliance, discoverWorkflows, checkBeatAdoption, checkHookRegistration } from '../scripts/wc/compliance-probe.ts'

const ROOT = new URL('..', import.meta.url).pathname
let PASS = 0, FAIL = 0
const ok = (name, condition, extra = '') => {
  if (condition) PASS++
  else { FAIL++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`) }
}

// EMPTY, and that is the state to keep. The registry stays because it is the mechanism, not the
// backlog: each entry is asserted to STILL be a finding, so fixing one turns this suite red and names
// the entry to delete. Its one member — `hooks/typst-convention-guard.ts`, wired to no event and
// therefore never run — was retired that way in v5.106.4. Adding an entry is deliberate and needs its
// reason and exit condition written beside it, exactly like KNOWN_GAPS and KNOWN_NONCOMPLIANT.
const KNOWN_FINDINGS = new Set([
  // OPEN, and it is a DESIGN question rather than a line of code — which is why it is recorded here
  // instead of quietly fixed. `scripts/beat/implement-gate.ts` implements the absence-is-failure
  // refusal correctly and has ZERO runtime-reached callers: no hooks.json entry, no import outside
  // its own test, and one bash line in skills/beat-implement/SKILL.md that runs only if a model
  // chooses to run it. So the observation hook's fail-open design has no live backstop.
  //
  // This rule used to exempt the hook because a gate file CONTAINED its name. That substring
  // exemption was the class it exists to catch, inside the check for the class. Fixed; the finding
  // it was hiding is now visible and is this entry.
  //
  // Exit condition: give the gate a runtime-reached invocation — a Stop/SubagentStop hook is the
  // obvious candidate, since the gate is a whole-wave verdict — or make the observation hook deny on
  // its own errors and retire the fail-open design. Writing the gate was never the missing part.
  'fail-open-without-gate:hooks/work-implement-observation.ts',
])

const findings = probeCompliance(ROOT)
const key = f => `${f.rule}:${f.subject}`

console.log('the probe finds nothing in this repo that is not already accounted for')
for (const finding of findings) {
  ok(`unexpected finding: ${key(finding)}`, KNOWN_FINDINGS.has(key(finding)),
    `${finding.detail} -> ${finding.remedy}`)
}
for (const known of KNOWN_FINDINGS) {
  ok(`${known} is still a finding (delete it from KNOWN_FINDINGS if fixed)`,
    findings.some(f => key(f) === known))
}

// GUARDS THE GUARD. A probe that silently stopped matching would report zero findings and look
// perfect — which is the exact failure mode it exists to catch, one level up. So assert it still sees
// the things it must see.
console.log('the probe itself is not silently inert')
{
  const workflows = discoverWorkflows(ROOT)
  ok('discovers exactly the six real workflows', workflows.join(',') === 'dev,ds,work,workflow-creator,workshop,writing', workflows.join(','))
  // Discovery had eleven false positives on its first cut: utilities with no approval regime
  // (skill-creator, law-review-docx) and family members mistaken for workflows (writing-revise,
  // workflow-creator-improve). Both classes are pinned so the fix cannot silently regress.
  for (const notAWorkflow of ['skill-creator', 'law-review-docx', 'writing-revise', 'workflow-creator-improve', 'workshop-revise']) {
    ok(`${notAWorkflow} is not counted as a workflow`, !workflows.includes(notAWorkflow))
  }
  ok('beat adoption is clean, and the check can still see the beats',
    checkBeatAdoption(ROOT).length === 0, JSON.stringify(checkBeatAdoption(ROOT).map(key)))
  ok('the registration check still finds hook files at all', checkHookRegistration(ROOT) !== undefined)
}

// The registration check must catch the defect it was written for. Synthesised rather than asserted
// against the real tree, because the real tree is (now) compliant and a check that only ever sees
// compliant input proves nothing.
console.log('the registration check catches an unwired hook')
{
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const fake = mkdtempSync(join(tmpdir(), 'probe-'))
  mkdirSync(join(fake, 'hooks'), { recursive: true })
  mkdirSync(join(fake, 'skills/thing'), { recursive: true })
  writeFileSync(join(fake, 'hooks/hooks.json'), JSON.stringify({ hooks: {} }))
  writeFileSync(join(fake, 'hooks/orphan-guard.ts'), 'export const x = 1\n')
  writeFileSync(join(fake, 'skills/thing/SKILL.md'), '---\nname: thing\n---\n# Thing\n')
  const orphans = checkHookRegistration(fake)
  ok('an unregistered hook is reported', orphans.some(f => f.subject === 'hooks/orphan-guard.ts'), JSON.stringify(orphans))
  ok('it is reported as critical', orphans[0]?.severity === 'critical')

  // And a registered one is NOT reported — otherwise the check would flag everything and mean nothing.
  writeFileSync(join(fake, 'skills/thing/SKILL.md'),
    '---\nname: thing\nhooks:\n  PreToolUse:\n    - matcher: "Write"\n      hooks:\n        - type: command\n          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orphan-guard.ts"\n---\n# Thing\n')
  ok('a registered hook is not reported', !checkHookRegistration(fake).some(f => f.subject === 'hooks/orphan-guard.ts'))
  rmSync(fake, { recursive: true, force: true })
}

// A GREEN RESULT MUST MEAN "CHECKED AND CLEAN", NEVER "DID NOT UNDERSTAND THE TARGET".
// Pointed at teaching (19 skills, 6 hooks) the probe first discovered zero workflows and reported
// 0 findings — ignorance rendered as reassurance, in the tool built to catch exactly that.
console.log('the probe refuses to report clean on a target it does not understand')
{
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const opaque = mkdtempSync(join(tmpdir(), 'probe-opaque-'))
  mkdirSync(join(opaque, 'skills/mystery'), { recursive: true })
  writeFileSync(join(opaque, 'skills/mystery/SKILL.md'), '---\nname: mystery\n---\n# Mystery\n')
  const blind = probeCompliance(opaque)
  ok('skills present but no workflow discovered is a finding', blind.some(f => f.rule === 'probe-blind'), JSON.stringify(blind))
  ok('it is critical, not advisory', blind[0]?.severity === 'critical')
  ok('it says the other results are meaningless', /reported clean|empty set/.test(blind[0]?.detail ?? ''))
  rmSync(opaque, { recursive: true, force: true })

  // An empty directory is genuinely nothing to check, and must NOT be reported.
  const empty = mkdtempSync(join(tmpdir(), 'probe-empty-'))
  ok('a repo with no skills at all is not flagged', probeCompliance(empty).length === 0)
  rmSync(empty, { recursive: true, force: true })
}

// THE CHECK MUST ITSELF BE WIRED — this file exists because that is not automatic.
//
// `checkDeclaredGuarantees` shipped defined, exported, and called by NOTHING: not its CLI, not this
// suite, not compliance-probe.ts. It was "demonstrated working" by a hand-run `bun -e`, which is the
// model-mediated path the tool exists to flag. A detector for correct-but-never-invoked components,
// itself correct and never invoked, caught by an independent reviewer within the hour.
console.log('the guarantee check is reachable from the CLI, not just exported')
{
  const src = await import('node:fs').then(fs => fs.readFileSync(new URL('../scripts/wc/executable-position.ts', import.meta.url), 'utf8'))
  const main = src.slice(src.indexOf('import.meta.main'))
  ok('the CLI invokes checkDeclaredGuarantees', main.includes('checkDeclaredGuarantees('), 'exported but unreachable — the exact defect this tool detects')
  ok('an unmet guarantee makes the CLI exit nonzero', /process\.exit\(guarantees\.length/.test(main))
  const { checkDeclaredGuarantees, SAFETY_DEPENDS_ON } = await import('../scripts/wc/executable-position.ts')
  ok('the registry is non-empty, so the check is not vacuous', SAFETY_DEPENDS_ON.length > 0)
  ok('and it reports the known-unmet dependency today',
    checkDeclaredGuarantees(ROOT).some(g => g.requires.includes('implement-gate')))
}

console.log(`\n${PASS}/${PASS + FAIL} passed — ${findings.length} finding(s), ${KNOWN_FINDINGS.size} accepted`)
if (FAIL) throw new Error(`${FAIL} compliance-probe check(s) failed`)
