// `workflows/work.js` — the shared IMPLEMENT → VERIFY → REVIEW beats as one program.
//
// WHY THIS FILE IS WORTH A CONTRACT. The beat spine was enforced by restraining a free agent:
// guards denying reconnaissance, a mutation guard denying main-chat writes, an order gate, a
// blocking Stop hook, an episode record, and a filesystem predicate hunting for unbound plans.
// Every one of those exists because the orchestrator COULD do otherwise. A workflow script has no
// filesystem and no shell, so ordering and delegation stop being rules and become structure.
//
// What this pins is the part that can still drift: that the adapter table covers every workflow
// (a missing domain silently falls back to nothing, which is how a six-router spine drifts into six
// procedures), that the declared phases are the phases actually run, and that the authority inputs
// FAIL CLOSED. The last one is the important one — a `work.js` that ran without `planPath`/
// `planHash` would launder an unapproved plan into a delegated implementation, which is precisely
// the incident the receipt chain exists to prevent.
//
// Run: bun tests/work-workflow-contract.test.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
let PASS = 0, FAIL = 0
const ok = (name, condition, extra = '') => {
  if (condition) PASS++
  else { FAIL++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`) }
}

const source = readFileSync(join(ROOT, 'workflows', 'work.js'), 'utf8')
const policies = readFileSync(join(ROOT, 'hooks', '_workflow_policies.ts'), 'utf8')

console.log('the adapter table covers every built-in workflow')
{
  // The six names come from `POLICIES` rather than a list retyped here: a seventh workflow added
  // there and forgotten here would otherwise throw at runtime, inside a dispatched episode, which
  // is the worst place to discover a missing table entry.
  const declared = [...policies.matchAll(/^ {2}"?([a-z-]+)"?: Object\.freeze\(\{ approvalMode:/gm)].map(m => m[1])
  ok('POLICIES still declares six workflows', declared.length === 6, JSON.stringify(declared))

  const table = source.slice(source.indexOf('const ADAPTERS = {'), source.indexOf('\n}\n', source.indexOf('const ADAPTERS = {')))
  for (const workflow of declared) {
    const key = new RegExp(`^ {2}'?${workflow}'?: \\{`, 'm')
    ok(`work.js has an adapter for ${workflow}`, key.test(table))
  }
  // Each adapter must actually supply the two things a domain differs in. An adapter with no review
  // lens would run the REVIEW phase over nothing and still compute a CLEAN gate.
  const blocks = table.split(/^ {2}'?[a-z-]+'?: \{$/m).slice(1)
  ok('every adapter declares verify lenses', blocks.every(b => /verifyLenses: \[[^\]]/.test(b)), `${blocks.length} adapters`)
  ok('every adapter declares at least one review lens', blocks.every(b => /reviewLenses: \[\s*\n\s*\{/.test(b)), `${blocks.length} adapters`)
  ok('every adapter names its deliverables', blocks.every(b => /deliverables: '/.test(b)))
}

console.log('an EXTERNAL plugin may bring its own adapter; a built-in may not be handed one')
{
  // MEASURED 2026-08-06, the first time this spine was pointed at another plugin. `~/projects/teaching`
  // publishes `.claude-plugin/workflow-policy.json` with `"workflow": "teaching"` — a schema-v2
  // external identity, which is a SUPPORTED public extension surface — and the membership test
  // refused it outright. External plugins cannot edit `work.js`, so "generic spine" meant "generic
  // across the six workflows that ship beside it", which is a closed set with a table.
  ok('an external identity is admitted', /const BUILT_IN = Object\.hasOwn\(ADAPTERS, WORKFLOW\)/.test(source))
  ok('the adapter is selected by that flag', /const ADAPTER = BUILT_IN \? ADAPTERS\[WORKFLOW\] : cfg\.adapter/.test(source))

  // THE ASYMMETRY IS THE SECURITY PROPERTY. If a caller could hand `dev` an adapter, it could hand
  // it a review table with no security lens and no test-coverage lens and still be reported CLEAN —
  // the caller would be choosing who audits it. The table is what forecloses that.
  ok('a caller-supplied adapter for a BUILT-IN is refused',
    /if \(BUILT_IN && cfg\.adapter !== undefined\)/.test(source) && /cannot choose who audits it/.test(source))

  // The one shape an external adapter must never have: a REVIEW phase with no lens runs over
  // nothing and still computes CLEAN, which looks reviewed and is not.
  ok('an empty reviewLenses is rejected, and the message says why',
    /reviewLenses must be a non-empty array — a REVIEW phase with no lens reviews nothing and still computes CLEAN/.test(source))
  ok('every review lens must carry both key and ask', /nonEmptyString\(l\.key\) \|\| !nonEmptyString\(l\.ask\)/.test(source))
  ok('deliverables, reviewSurfaces and verifyLenses are all required',
    /adapter\.deliverables must be a non-empty string/.test(source)
    && /adapter\.reviewSurfaces must be a non-empty string/.test(source)
    && /adapter\.verifyLenses must be a non-empty array/.test(source))
  // Empty is allowed HERE and nowhere else, and the message has to say which of the two it is.
  ok('an absent mechanicalChecks is distinguished from a declared-empty one',
    /empty is allowed — an empty list is a statement that the domain has no toolchain, an absent key is an omission/.test(source))

  // ALL PROBLEMS AT ONCE. An external adapter is authored once and debugged through this message
  // alone; throwing on the first missing field turns one fix into five round trips.
  ok('every shape problem is collected before throwing', /problems\.join\('; '\)/.test(source))
  ok('the throw distinguishes "supplied nothing" from "supplied something unusable"',
    /cfg\.adapter === undefined \? 'must supply args\.adapter' : 'supplied an args\.adapter this spine cannot use'/.test(source))

  // Schema v2 admits arbitrary strings, including `constructor`. Nothing indexes a table with the
  // value any more, but an identity that appears in task names and report headings must look like one.
  ok('an external identity must look like an identity', /\/\^\[a-z\]\[a-z0-9-\]\{0,63\}\$\/\.test\(WORKFLOW\)/.test(source))
}

console.log('the declared phases are the phases that run')
{
  const declared = [...source.matchAll(/\{ title: '([^']+)'/g)].map(m => m[1])
  const called = [...source.matchAll(/^phase\('([^']+)'\)/gm)].map(m => m[1])
  ok('meta.phases and phase() calls agree', JSON.stringify(declared) === JSON.stringify(called),
    `meta=${JSON.stringify(declared)} calls=${JSON.stringify(called)}`)
  // The ORDER is the enforcement. `episode-order-gate` existed because a model could dispatch an
  // implementation wave while a review was owed; here that is unreachable unless these move.
  ok('IMPLEMENT precedes VERIFY precedes REVIEW',
    called.indexOf('Implement') < called.indexOf('Verify') && called.indexOf('Verify') < called.indexOf('Review'),
    JSON.stringify(called))
  ok('the gate is last', called[called.length - 1] === 'Gate', JSON.stringify(called))
}

console.log('authority inputs fail closed')
{
  ok('an unknown workflow throws', /throw new Error\(`work requires args\.workflow to be one of/.test(source))
  ok('a missing planPath or non-hex planHash throws', /!PLAN_PATH \|\| !\/\^\[0-9a-f\]\{64\}\$\/\.test\(PLAN_HASH\)/.test(source))
  ok('the throw names review.json, so the caller knows where authority comes from',
    /never discovers planning authority/.test(source) && /review\.json/.test(source))
  ok('an empty task list throws', /work requires a non-empty args\.tasks/.test(source))
  // NO DISCOVERY FALLBACK. The failure this forecloses is a workflow that, handed nothing, goes
  // looking for "the most recent plan in .planning/" — which is exactly how a hand-written plan got
  // treated as approved in the first place.
  ok('the script never reads the filesystem for a plan', !/readdirSync|readFileSync|existsSync|globSync/.test(source))
}

console.log('a domain whose transform is a fan-out delegates to its own workflow')
{
  // The five domain scripts are not "one agent per task": `writing-draft` expands an authenticated
  // section index, `workshop-generate` renders a pinned Slide Spec. Re-expressing those as tasks
  // here would lose the structure or duplicate it, and duplication is how six routers came to
  // disagree in the first place. So the spine DELEGATES and stays domain-agnostic.
  ok('writing delegates to writing-draft', /implementWorkflow: 'writing-draft'/.test(source))
  ok('workshop delegates to workshop-generate', /implementWorkflow: 'workshop-generate'/.test(source))
  ok('the delegation goes through workflow(), the one-level-nesting primitive', /await workflow\(ADAPTER\.implementWorkflow/.test(source))
  // A domain workflow that cannot run must NOT quietly become the generic per-task path: that would
  // build a deck or a draft by a route nobody reviewed, under a gate claiming the domain ran.
  ok('a failed domain workflow throws rather than falling back', /throw new Error\(`work: the \$\{domainWorkflowLabel\(ADAPTER\.implementWorkflow\)\} workflow failed/.test(source))
  ok('domainArgs is forwarded unread', /passed through UNREAD/.test(source))
  // DECLARING A DOMAIN WORKFLOW MAKES `domainArgs` REQUIRED. Measured 2026-08-06: the delegation was
  // gated on `implementWorkflow && DOMAIN_ARGS`, so a caller omitting domainArgs — which is exactly
  // what skills/writing/SKILL.md instructs, its pre-step returning only the four authority fields —
  // skipped the domain workflow entirely, took the generic per-task path, and computed CLEAN. The
  // comment promising "reported, not silently replaced" guarded only failures INSIDE the call.
  ok('an absent domainArgs with a declared domain workflow throws', /if \(DECLARED_DOMAIN\.length && !DOMAIN_ARGS\)/.test(source))
  ok('the throw names both fields that can declare one',
    /\['implementWorkflow', ADAPTER\.implementWorkflow\]/.test(source) && /\['verifyWorkflow', ADAPTER\.verifyWorkflow\]/.test(source))
  ok('and it names the remedy rather than just refusing',
    /Supply domainArgs from the domain's authenticate pre-step, or remove the declaration from the adapter/.test(source))
  // And it must reach the gate. A delegated implement that no score row mentions is invisible.
  ok('the domain run appears in the score table', /domainRun \? \[\{ check: `\$\{domainWorkflowLabel\(ADAPTER\.implementWorkflow\)\} workflow`/.test(source))
  // AN EXTERNAL PLUGIN'S DOMAIN WORKFLOWS ARE NOT IN THE SAVED REGISTRY. `workflow()` resolves a
  // NAME from `<project>/.claude/workflows/`, and `teaching` keeps its six scripts in
  // `<plugin>/workflows/` — which no name resolves to. The `{scriptPath}` form already ran, because
  // nothing validates this field; what did not work was SAYING so, since `${ref}` renders an object
  // as `[object Object]` in the progress log and in the score-table row reporting whether it passed.
  ok('a {scriptPath} ref is labelled readably rather than [object Object]',
    /function domainWorkflowLabel\(ref\)/.test(source) && /ref\.scriptPath/.test(source))
  ok('the label falls back to the basename without its extension',
    /path\.split\('\/'\)\.pop\(\)\.replace\(\/\\\.js\$\/, ''\)/.test(source))
  ok('the domain run can fail the gate', /const domainPassed = \(domainRun \? domainRun\.overallPass !== false : true\)/.test(source))
  ok('the domain run is returned for the caller to render', /^  domainRun,$/m.test(source))
}

console.log('every phase carries domain specifics, not just a domain label')
{
  // WIRING THE ENTRY SKILLS WAS NOT ENOUGH. The first adapter table said WHO reviews and nothing
  // about WHAT to run: `verifyLenses: ['compiles']` tells a verifier what to care about and nothing
  // about how to establish it, so it invents a check it can pass. Each phase now carries the
  // domain's own machinery.
  const table = source.slice(source.indexOf('const ADAPTERS = {'), source.indexOf('\n}\n', source.indexOf('const ADAPTERS = {')))
  const blocks = table.split(/^ {2}'?[a-z-]+'?: \{$/m).slice(1)
  ok('every adapter declares its mechanical checks (possibly empty, but declared)',
    blocks.every(b => /mechanicalChecks: \[/.test(b)), `${blocks.length} adapters`)
  ok('every adapter names what the human reviews', blocks.every(b => /reviewSurfaces: '/.test(b)))
  // A check with a name and no command is the adjective problem again.
  const checks = [...table.matchAll(/\{ name: '[^']+', how: '[^']*' \}/g)]
  ok('every declared mechanical check names a command to run', checks.length >= 8, `${checks.length} checks`)
  ok('the verifier is required to paste their output', /paste each one's verbatim output/.test(source))
  ok('an unrunnable mechanical check is a failure, not a silent skip',
    /report that as a failure rather than skipping\nit quietly/.test(source))

  // The three domains that already HAVE a verify workflow must use it rather than a lens-label copy.
  for (const [domain, wf] of [['writing', 'writing-verify'], ['workshop', 'workshop-verify'], ['workflow-creator', 'workflow-creator-verify']]) {
    ok(`${domain} delegates VERIFY to ${wf}`, new RegExp(`verifyWorkflow: '${wf}'`).test(source))
  }
  ok('the domain verifier is awaited through workflow()', /await workflow\(ADAPTER\.verifyWorkflow/.test(source))
  ok('its gate can fail the whole gate', /domainVerify \? domainVerify\.overallPass !== false : true/.test(source))
  ok('and it is returned for the caller to render', /^  domainVerify,$/m.test(source))
}

console.log('the gate is computed, not asserted')
{
  ok('overallPass is arithmetic over counts',
    /const overallPass = domainPassed && notDone\.length === 0 && failedVerify\.length === 0 && criticals\.length === 0 && majors\.length === 0/.test(source))
  // A finding that no one tried to refute is a finding nobody checked. This is the difference
  // between a review that reports and a review that is trusted.
  ok('every finding is adversarially refuted before it counts', /Try to REFUTE this review finding/.test(source))
  ok('refuters default to refuted on ambiguity', /Default to refuted:true/.test(source))
  ok('a selective re-run says what it did NOT judge', /selective re-run: \$\{TASK_SUBSET\.length\} of \$\{TASKS\.length\}/.test(source))
}

console.log('the script cannot do the work itself — that is the delegation boundary')
{
  // `orchestrator-mutation-guard` denies main-chat Write/Edit because a model could do otherwise.
  // A workflow script has no Write tool at all, so this is structural rather than enforced — the
  // assertion here is that nobody has smuggled a shell back in through an agent-free path.
  ok('no shell or filesystem call in the script body', !/Bun\.spawn|child_process|execSync|writeFileSync/.test(source))
  ok('every unit of work is an agent() call', /await agent\(/.test(source))
  ok('implementers are dispatched sequentially, not raced',
    /for \(const task of TASK_SUBSET\)/.test(source) && /post-return manifest cannot authorize concurrency|apparently\n\/\/ disjoint/.test(source))
}

console.log(`\n${PASS} passed, ${FAIL} failed`)
if (FAIL) process.exit(1)
