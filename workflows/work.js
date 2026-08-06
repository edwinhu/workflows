export const meta = {
  name: 'work',
  description: 'Run the shared IMPLEMENT → VERIFY → REVIEW beats as one orchestrated program, with a per-domain adapter supplying the specifics.',
  whenToUse: 'Called by a workflow entry skill after CLARIFY and after a receipt-authenticated plan exists. Requires projectDir, workflow, planPath, planHash and the approved task list; never discovers planning authority.',
  phases: [
    { title: 'Implement', detail: 'one agent per approved task, dispatched sequentially — the script never writes anything itself' },
    { title: 'Verify', detail: 'per-task read-only verification against the task\'s own acceptance criteria, in parallel' },
    { title: 'Review', detail: 'domain review lenses over the whole deliverable set, each finding then adversarially refuted' },
    { title: 'Gate', detail: 'pass/fail computed in JS from raw counts, never asserted by an agent' },
  ],
}

// =============================================================================================
// WHY THIS FILE EXISTS: THE BEATS WERE A PROGRAM WEARING A HOOK COSTUME.
//
// The beat spine — CLARIFY → PLAN → IMPLEMENT → VERIFY → REVIEW — was enforced by restraining a
// free agent: PreToolUse guards denying reconnaissance before an observed AskUserQuestion, a
// mutation guard denying main-chat writes, an order gate refusing an out-of-order dispatch, a Stop
// gate refusing a turn end while a review was owed, an episode record tracking which beat we were
// in, and a filesystem predicate looking for plans nobody bound. Every one of those exists because
// the orchestrator is a model that could do otherwise.
//
// A workflow script is not a model. It has NO filesystem access and NO shell: it cannot write a
// deliverable if it wants to. So for the three beats below:
//
//   ordering            was `episode-order-gate` + `episode.json.phases`  ->  is the order of these
//                                                                             statements
//   delegation          was `orchestrator-mutation-guard` denying Write   ->  is structural; the
//                                                                             script has no Write
//   "review is owed"    was a blocking Stop hook with a retry budget      ->  is a phase that runs
//   dispatch accounting was preflight expectation files + observation     ->  is the return value
//                       hooks bracketing every Agent call                    of `agent()`
//
// WHAT CANNOT MOVE HERE, AND WHY THE HOOKS DO NOT ALL RETIRE.
//   CLARIFY needs `AskUserQuestion` and PLAN approval needs `ExitPlanMode`. Both are conversations
//   with a HUMAN, and a workflow subagent cannot hold one. Those two beats stay in main chat, which
//   is exactly where a free agent still has to be restrained — so `clarify-before-recon-guard`,
//   `approved-artifact-persist` and the ambient mutation guard remain load-bearing for the part of
//   the episode this file does not own. This script REQUIRES their output: `planPath` + `planHash`
//   are the receipt's, and a caller that cannot supply them has not been through PLAN.
//
// THE ADAPTERS ARE DATA, NOT CODE, AND THAT IS FORCED. A workflow script cannot `import`, so a
// domain cannot ship its own module here. One table, six entries, every difference visible side by
// side — which is also the honest shape: the domains differ in WHO reviews and WHAT the deliverable
// is, and in nothing else. Six routers that each re-derived that were six chances to disagree.
// =============================================================================================

const ADAPTERS = {
  work: {
    deliverables: 'whatever the approved plan declares',
    implementer: null,
    // No domain toolchain to run: `work` is the domain-agnostic middle category, so its only
    // mechanical check is whatever the plan's own criteria name. Leaving this empty is a statement,
    // not an omission — inventing a command here would apply one domain's toolchain to all of them.
    mechanicalChecks: [],
    verifyLenses: ['acceptance-criteria', 'evidence-actually-run'],
    reviewSurfaces: 'the artifacts the plan names, and the diff',
    reviewLenses: [
      { key: 'criteria', agentType: null, ask: 'Does the delivered work satisfy every success criterion in the plan, judged against the artifacts rather than the report?' },
      { key: 'scope', agentType: null, ask: 'Was anything delivered that the plan excluded, or omitted that it required?' },
    ],
  },
  dev: {
    deliverables: 'source, tests and config named in the plan',
    implementer: 'workflows:dev-implementer',
    mechanicalChecks: [
      { name: 'the project test suite', how: 'run the repository\'s own test command and paste the verbatim tail, including the failure count' },
      { name: 'typecheck/build', how: 'run the build or typecheck the repo defines, if it defines one' },
    ],
    verifyLenses: ['tests-actually-pass', 'requirement-satisfied', 'no-unrelated-change'],
    reviewSurfaces: 'the diff, the failing-then-passing test, and the build output',
    reviewLenses: [
      { key: 'correctness', agentType: 'workflows:code-reviewer', ask: 'Review the changed code for correctness and maintainability defects.' },
      { key: 'security', agentType: 'workflows:security-reviewer', ask: 'Review the changed code for security defects.' },
      { key: 'test-coverage', agentType: 'workflows:test-gap-auditor', ask: 'Identify behaviour the change introduces that no test covers. Report gaps; do not write tests.' },
    ],
  },
  ds: {
    deliverables: 'analysis code and outputs named in the plan',
    implementer: 'workflows:ds-analyst',
    mechanicalChecks: [
      { name: 'the DS check script', how: 'bash scripts/check-all-ds.sh (the one named read-only DS check this workflow permits)' },
      { name: 're-run determinism', how: 'run the analysis twice and diff the outputs; a differing result is a finding, not a retry' },
    ],
    verifyLenses: ['determinism', 'schema-validated', 'reproducible-from-raw'],
    reviewSurfaces: 'the notebook or script, its outputs, and the data-quality summary',
    reviewLenses: [
      { key: 'method', agentType: null, ask: 'Is the analysis method sound for the question the plan asks, and are its stated limits honest?' },
      { key: 'correctness', agentType: 'workflows:code-reviewer', ask: 'Review the analysis code for correctness defects.' },
    ],
  },
  writing: {
    deliverables: 'outlines/ and drafts/ named in the plan Section Outputs',
    implementer: null,
    // The domain transform is a WORKFLOW, not an agent: expanding section outlines is itself a
    // fan-out with its own gate. `workflow()` runs it inline as a sub-step, under this run's
    // concurrency cap and token budget, and its agents appear nested in the progress tree.
    implementWorkflow: 'writing-draft',
    // VERIFY IS A WORKFLOW HERE TOO. `writing-verify` runs per-section structure, prose, source
    // fidelity, quote verification and transitions with its own computed gate — re-expressing that
    // as three lens labels would be a strictly worse copy of something that already exists.
    verifyWorkflow: 'writing-verify',
    mechanicalChecks: [
      { name: 'the section index authenticator', how: 'python3 scripts/writing/writing_section_index.py --authenticate — the only canonical grammar parser; there is no LLM fallback' },
    ],
    verifyLenses: ['every-outline-point-expanded', 'only-planned-sources-cited'],
    reviewSurfaces: 'the rendered draft and the per-section review findings',
    reviewLenses: [
      { key: 'prose', agentType: 'workflows:writing-prose-reviewer', ask: 'Grade the prose against the domain style rules and AI anti-patterns.' },
      { key: 'source-fidelity', agentType: 'workflows:writing-source-fidelity-reviewer', ask: 'Verify every citation traces to the planned sources and matches the source entry.' },
    ],
  },
  workshop: {
    deliverables: 'slides and speaker notes named in the plan Slide Spec',
    implementer: null,
    implementWorkflow: 'workshop-generate',
    verifyWorkflow: 'workshop-verify',
    mechanicalChecks: [
      { name: 'typst compilation', how: 'compile both deliverables; a deck that does not compile is not a deck' },
      { name: 'constraint check + PDF widow/overflow', how: 'the global mechanical leg workshop-verify runs' },
    ],
    verifyLenses: ['compiles', 'every-slide-spec-row-rendered', 'notes-cover-every-slide'],
    reviewSurfaces: 'the rendered PDF deck and the speaker notes',
    reviewLenses: [
      { key: 'conventions', agentType: null, ask: 'Check slide conventions: overflow, widows, thin slides, heading shape.' },
      { key: 'source-fidelity', agentType: null, ask: 'Verify every slide claim traces to the source paper.' },
    ],
  },
  'workflow-creator': {
    deliverables: 'skills, hooks, scripts and tests named in the plan',
    implementer: null,
    verifyWorkflow: 'workflow-creator-verify',
    mechanicalChecks: [
      { name: 'registration parity', how: 'bun scripts/parity.ts --all — a hook wired nowhere passes every behaviour test it has' },
      { name: 'hook wiring', how: 'bash scripts/check-hooks.sh' },
    ],
    verifyLenses: ['registered-not-merely-written', 'mechanically-probed'],
    reviewSurfaces: 'the emitted skills and hooks, and the parity report',
    reviewLenses: [
      { key: 'architecture', agentType: 'workflows:workflow-auditor', ask: 'Audit the workflow architecture and its enforcement against the rubric.' },
      { key: 'registration', agentType: null, ask: 'For every hook and skill this change adds, prove it is REGISTERED and reachable — a hook wired nowhere passes every behaviour test it has.' },
    ],
  },
}

/**
 * A DOMAIN WORKFLOW MAY BE A NAME OR A `{scriptPath}` REF, AND AN EXTERNAL PLUGIN NEEDS THE REF.
 *
 * `workflow()` takes either: a NAME resolves from the saved-workflow registry
 * (`<project>/.claude/workflows/`), a `{scriptPath}` runs a file directly. The built-in adapters use
 * names because their scripts are registered; an external plugin's are not — `teaching` keeps its
 * six domain workflows in `<plugin>/workflows/`, which no name resolves to.
 *
 * The ref already worked, by accident: nothing validates this field, so an object fell through to
 * `workflow()` and ran. What did NOT work is saying so — `${ref}` renders an object as
 * `[object Object]`, in the progress log AND in the score-table row that reports whether the domain
 * workflow passed. A gate row nobody can read is a gate row nobody checks.
 */
function domainWorkflowLabel(ref) {
  if (typeof ref === 'string') return ref
  const path = ref && typeof ref === 'object' ? ref.scriptPath : undefined
  return typeof path === 'string' && path ? path.split('/').pop().replace(/\.js$/, '') : 'domain workflow'
}

// ── Inputs ──────────────────────────────────────────────────────────────────────────────────
// args = {
//   projectDir: "/abs/project",          // REQUIRED
//   workflow:   "writing",               // REQUIRED — selects the adapter; a key of ADAPTERS, or
//                                        //   an external identity /^[a-z][a-z0-9-]{0,63}$/
//   adapter?:   { deliverables, reviewSurfaces, verifyLenses, mechanicalChecks, reviewLenses,
//                 implementer?, implementWorkflow?, verifyWorkflow? },
//                                        // REQUIRED for an EXTERNAL workflow, REFUSED for a
//                                        //   built-in one — see the asymmetry note below
//   planPath:   "/abs/.planning/<native-name>.md",  // REQUIRED — the receipt-selected plan
//   planHash:   "<64 hex>",              // REQUIRED — the receipt's plan_hash, unaltered
//   tasks: [{ id, name, work, writablePaths: [], acceptance }],  // REQUIRED — from the plan
//   onlyChecks?: ["t2"],                 // selective re-run: implement only these task ids
//   priorReviews?: [ ... ],              // carry forward results for the tasks not re-run
// }
let cfg = args
if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch { cfg = {} } }
cfg = cfg || {}

const PROJECT = typeof cfg.projectDir === 'string' ? cfg.projectDir : ''
const WORKFLOW = typeof cfg.workflow === 'string' ? cfg.workflow : ''
const PLAN_PATH = typeof cfg.planPath === 'string' ? cfg.planPath : ''
const PLAN_HASH = typeof cfg.planHash === 'string' ? cfg.planHash : ''
const TASKS = Array.isArray(cfg.tasks) ? cfg.tasks : []

// FAIL CLOSED ON AUTHORITY, AND SAY WHICH FIELD. The whole point of taking planPath+planHash as
// inputs is that this file never DISCOVERS planning authority — no directory scan, no "most recent
// plan", no LLM guess. A caller missing one of these has not been through an approved PLAN, and
// running anyway would launder an unapproved plan into a delegated implementation.
if (!PROJECT) throw new Error('work requires args.projectDir')
// THE TABLE IS CLOSED FOR THE SIX, AND OPEN FOR EVERYONE ELSE — AND THE ASYMMETRY IS THE SECURITY
// PROPERTY. Measured 2026-08-06, the first time this spine was pointed at another plugin: the
// `teaching` plugin publishes a schema-v2 `.claude-plugin/workflow-policy.json` with
// `"workflow": "teaching"`, which is a supported public extension surface, and yet the old
// membership test rejected it — so "generic spine" really meant "generic across the six workflows
// that happen to ship in this repo", since no external plugin can edit this file. Hence: an
// EXTERNAL workflow must supply its own adapter, and a BUILT-IN one may never be handed one. If a
// caller could pass `{workflow: 'dev', adapter: {...}}` it could hand `dev` a review table with no
// security lens and no test-coverage lens, and the run would still report CLEAN; the built-in
// table is precisely the thing that stops a caller choosing who audits it. An external workflow
// has no such table to subvert — it is bringing its own reviewers, not replacing ours.
const BUILT_IN = Object.hasOwn(ADAPTERS, WORKFLOW)
if (BUILT_IN && cfg.adapter !== undefined) {
  throw new Error(`work refuses args.adapter for the built-in workflow ${JSON.stringify(WORKFLOW)} — its review lenses are fixed by the ADAPTERS table so a caller cannot choose who audits it`)
}
if (!BUILT_IN) {
  // Schema v2 admits arbitrary strings for `workflow`, including `constructor` and `__proto__`.
  // Nothing here indexes a table with the value any more, so this is not a prototype-pollution
  // fix — it is the plainer requirement that an identity appearing in error text, task names and
  // report headings has to look like an identity.
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(WORKFLOW)) {
    throw new Error(`work requires args.workflow to be one of ${Object.keys(ADAPTERS).join('|')}, or an external workflow identity matching /^[a-z][a-z0-9-]{0,63}$/; got ${JSON.stringify(cfg.workflow)}`)
  }
  // COLLECT EVERY SHAPE PROBLEM, THEN THROW ONCE. An external adapter is authored once and then
  // debugged through this error message alone; throwing on the first missing field turns a
  // five-minute fix into five round trips through a workflow the author cannot step through.
  const a = cfg.adapter
  const problems = []
  const nonEmptyString = v => typeof v === 'string' && v.trim() !== ''
  if (!a || typeof a !== 'object' || Array.isArray(a)) {
    problems.push('args.adapter must be an object')
  } else {
    if (!nonEmptyString(a.deliverables)) problems.push('adapter.deliverables must be a non-empty string naming what the plan produces')
    if (!nonEmptyString(a.reviewSurfaces)) problems.push('adapter.reviewSurfaces must be a non-empty string naming what REVIEW reads')
    if (!Array.isArray(a.verifyLenses) || !a.verifyLenses.length) problems.push('adapter.verifyLenses must be a non-empty array')
    // Empty is allowed here and nowhere else: a domain with no toolchain (see the `work` entry)
    // saying so explicitly is a statement, whereas an absent key is an omission we cannot tell
    // apart from a forgotten one.
    if (!Array.isArray(a.mechanicalChecks)) problems.push('adapter.mechanicalChecks must be an array (empty is allowed — an empty list is a statement that the domain has no toolchain, an absent key is an omission)')
    if (!Array.isArray(a.reviewLenses) || !a.reviewLenses.length) {
      problems.push('adapter.reviewLenses must be a non-empty array — a REVIEW phase with no lens reviews nothing and still computes CLEAN, which looks reviewed and is not')
    } else {
      a.reviewLenses.forEach((l, i) => {
        if (!l || typeof l !== 'object' || !nonEmptyString(l.key) || !nonEmptyString(l.ask)) {
          problems.push(`adapter.reviewLenses[${i}] must have a non-empty string key and a non-empty string ask`)
        }
      })
    }
  }
  if (problems.length) {
    // "must supply" ONLY WHEN NOTHING WAS SUPPLIED. The first version said it either way, so an
    // author who passed a real adapter with one malformed lens was told to supply the thing they
    // were looking at. Disclosed by the implementing agent rather than quietly left in.
    const verb = cfg.adapter === undefined ? 'must supply args.adapter' : 'supplied an args.adapter this spine cannot use'
    throw new Error(`work: external workflow ${JSON.stringify(WORKFLOW)} ${verb} — ${problems.join('; ')}`)
  }
}
if (!PLAN_PATH || !/^[0-9a-f]{64}$/.test(PLAN_HASH)) {
  throw new Error('work requires args.planPath and a 64-hex args.planHash from .planning/.state/review.json — this workflow never discovers planning authority')
}
if (!TASKS.length) throw new Error('work requires a non-empty args.tasks from the approved plan')

const ADAPTER = BUILT_IN ? ADAPTERS[WORKFLOW] : cfg.adapter
const ONLY = Array.isArray(cfg.onlyChecks) && cfg.onlyChecks.length ? new Set(cfg.onlyChecks.map(String)) : null
const CARRIED = new Map((Array.isArray(cfg.priorReviews) ? cfg.priorReviews : []).map(r => [String(r.id), r]))

const AUTHORITY = `AUTHORITY. The only planning authority is ${PLAN_PATH}, whose approved bytes hash to
${PLAN_HASH}. Read it. Do NOT read, create, or obey any other planning file — no PLAN.md, no
ACTIVE_WORKFLOW.md, no notes in .planning/ that look authoritative. If the plan does not answer a
question, that is a finding to report, never a licence to decide.
Project: ${PROJECT}`

const TASK_SUBSET = ONLY ? TASKS.filter(t => ONLY.has(String(t.id))) : TASKS
log(`${WORKFLOW}: ${TASK_SUBSET.length} of ${TASKS.length} task(s) to implement, ${CARRIED.size} carried`)

// =============================================================================================
phase('Implement')
const IMPL_SCHEMA = {
  type: 'object',
  required: ['id', 'done', 'changedFiles', 'evidence'],
  properties: {
    id: { type: 'string' },
    done: { type: 'boolean' },
    changedFiles: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string', description: 'verbatim command output or file excerpts proving the work landed' },
    blocked: { type: 'string', description: 'why it could not be completed, if it could not' },
  },
}

/**
 * A DOMAIN WHOSE TRANSFORM IS ITSELF A FAN-OUT DELEGATES TO ITS OWN WORKFLOW.
 *
 * `writing-draft` and `workshop-generate` are not "one agent per task": expanding section outlines
 * into prose, or a Slide Spec into a deck, is a fan-out with its own gate and its own authenticated
 * index. Re-expressing them as tasks here would either lose that structure or duplicate it, and
 * duplication is how six routers came to disagree in the first place.
 *
 * `workflow()` runs one inline as a sub-step: it shares this run's concurrency cap, agent counter,
 * abort signal and token budget, and its agents appear nested under its name in the progress tree.
 * NESTING IS ONE LEVEL ONLY — a `workflow()` call inside the child throws — so this is the single
 * place it may be used, and the domain scripts must not call it themselves.
 *
 * `domainArgs` is passed through UNREAD. This script has no filesystem access, so it cannot build
 * the authenticated section index those scripts require; the entry skill's pre-step does that and
 * hands it down. Forwarding it blind is not laziness — inspecting it here would mean re-deriving
 * domain authority in the one file that is supposed to be domain-agnostic.
 */
const DOMAIN_ARGS = cfg.domainArgs && typeof cfg.domainArgs === 'object' ? cfg.domainArgs : null
let domainRun = null
if (ADAPTER.implementWorkflow && DOMAIN_ARGS) {
  log(`delegating IMPLEMENT to the ${domainWorkflowLabel(ADAPTER.implementWorkflow)} workflow`)
  try {
    domainRun = await workflow(ADAPTER.implementWorkflow, { ...DOMAIN_ARGS, planPath: PLAN_PATH, planHash: PLAN_HASH, projectDir: PROJECT })
  } catch (error) {
    // A DOMAIN WORKFLOW THAT CANNOT RUN IS REPORTED, NOT SILENTLY REPLACED BY THE GENERIC PATH.
    // Falling back to per-task agents would produce a deck or a draft built by a route nobody
    // reviewed, under a gate that says the domain workflow passed.
    throw new Error(`work: the ${domainWorkflowLabel(ADAPTER.implementWorkflow)} workflow failed for ${WORKFLOW}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// SEQUENTIAL, AND NOT BECAUSE PARALLEL IS HARD. Two implementers writing the same tree race, and
// this repo's own rule is that a post-return manifest cannot authorize concurrency: apparently
// disjoint `writablePaths` are a claim, not isolation. `isolation: 'worktree'` would buy real
// parallelism and is the right upgrade when a domain's tasks are genuinely independent — it is not
// the default because it costs a worktree per task and most plans here are one dependency chain.
const implemented = []
for (const task of TASK_SUBSET) {
  const paths = Array.isArray(task.writablePaths) && task.writablePaths.length
    ? task.writablePaths.join(', ')
    : ADAPTER.deliverables
  const result = await agent(`TASK ${task.id}: ${task.name}

${AUTHORITY}

WORK: ${task.work || '(see the plan section for this task)'}
WRITABLE: ${paths}. Write nothing outside it. If the task cannot be done without touching something
else, stop and report that as blocked — widening your own scope is the failure this boundary exists
to prevent.
ACCEPTANCE: ${task.acceptance || '(see the plan)'}

Do the work, then prove it: report the files you changed and paste the verbatim output of whatever
you ran to check them. A separate verifier re-checks this against the acceptance criteria without
seeing your report, so a claim you cannot evidence is worse than an honest "blocked".`,
    { schema: IMPL_SCHEMA, label: `implement:${task.id}`, phase: 'Implement', agentType: ADAPTER.implementer || undefined })
  implemented.push(result || { id: String(task.id), done: false, changedFiles: [], evidence: '', blocked: 'implementer agent returned nothing' })
  log(`  ${task.id}: ${implemented[implemented.length - 1].done ? 'done' : 'NOT done'}`)
}

// =============================================================================================
phase('Verify')
const VERIFY_SCHEMA = {
  type: 'object',
  required: ['id', 'pass', 'evidence'],
  properties: {
    id: { type: 'string' },
    pass: { type: 'boolean' },
    evidence: { type: 'string' },
    failures: { type: 'array', items: { type: 'string' } },
  },
}

/**
 * THE DOMAIN'S OWN VERIFIER RUNS FIRST, WHERE ONE EXISTS.
 *
 * `writing-verify`, `workshop-verify` and `workflow-creator-verify` already exist and already
 * compute their own gates over things only that domain knows — per-section prose and source
 * fidelity, PDF widow and overflow, registration parity. Re-expressing those as three lens labels
 * here would be a strictly worse copy of something that works, and the copy would drift.
 *
 * Nesting is ONE level from this script, so an implement workflow and a verify workflow are both
 * reachable; neither may call `workflow()` itself.
 */
let domainVerify = null
if (ADAPTER.verifyWorkflow && DOMAIN_ARGS) {
  log(`delegating VERIFY to the ${domainWorkflowLabel(ADAPTER.verifyWorkflow)} workflow`)
  try {
    domainVerify = await workflow(ADAPTER.verifyWorkflow, { ...DOMAIN_ARGS, planPath: PLAN_PATH, planHash: PLAN_HASH, projectDir: PROJECT })
  } catch (error) {
    throw new Error(`work: the ${domainWorkflowLabel(ADAPTER.verifyWorkflow)} workflow failed for ${WORKFLOW}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// THE MECHANICAL CHECKS ARE COMMANDS, NOT ADJECTIVES. A lens label like `compiles` tells a verifier
// what to care about and nothing about how to establish it, so it invents a check it can pass. Each
// domain names the actual thing to run, and the verifier is required to paste the output.
const MECHANICAL = (ADAPTER.mechanicalChecks || []).length
  ? `\n\nRUN THESE, and paste each one's verbatim output — they are this domain's deterministic checks, not suggestions:\n${ADAPTER.mechanicalChecks.map(check => `  - ${check.name}: ${check.how}`).join('\n')}`
  : '\n\nThis domain declares no toolchain check; the plan\'s own criteria are the whole of it.'

// GOAL-BACKWARD AND BLIND. The verifier is told the acceptance criteria and the paths, never the
// implementer's account of itself — self-report is what this whole architecture refuses to trust.
const verified = (await parallel(TASK_SUBSET.map(task => () => agent(
  `Verify TASK ${task.id}: ${task.name}

${AUTHORITY}

ACCEPTANCE: ${task.acceptance || '(read the plan section for this task)'}
Judgement lenses for this domain: ${ADAPTER.verifyLenses.join(', ')}.${MECHANICAL}

You are READ-ONLY. Do not fix anything. Start from the acceptance criteria and work backwards to the
artifacts on disk. You have NOT been shown what the implementer claims — judge the files, not a
narrative. If a criterion cannot be checked as written, say so rather than substituting one you can
check, and if a mechanical check above cannot be run, report that as a failure rather than skipping
it quietly.`,
  { schema: VERIFY_SCHEMA, label: `verify:${task.id}`, phase: 'Verify' })))).filter(Boolean)

// =============================================================================================
phase('Review')
const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['lens', 'findings'],
  properties: {
    lens: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['summary', 'severity', 'where'],
        properties: {
          summary: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          where: { type: 'string' },
          why: { type: 'string' },
        },
      },
    },
  },
}
const REFUTE_SCHEMA = {
  type: 'object',
  required: ['refuted', 'reason'],
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
}

const changed = implemented.flatMap(r => r.changedFiles || [])

// EACH LENS FINDS, THEN EACH FINDING IS ATTACKED — pipelined, so a slow lens never holds up the
// refutation of a fast one. The refuters are told to default to REFUTED on doubt: a review that
// reports plausible-but-wrong findings costs more trust than one that misses a minor.
const reviewed = await pipeline(
  ADAPTER.reviewLenses,
  lens => agent(`${lens.ask}

${AUTHORITY}

Files this episode changed: ${changed.length ? changed.join(', ') : '(none reported — inspect the deliverables named in the plan)'}
Deliverables for this domain: ${ADAPTER.deliverables}\nWhat the human will review: ${ADAPTER.reviewSurfaces}

You are READ-ONLY. Report defects with a severity and an exact location. Do not report style
preferences as defects, and do not report a finding you cannot point at.`,
    { schema: FINDINGS_SCHEMA, label: `review:${lens.key}`, phase: 'Review', agentType: lens.agentType || undefined }),
  (result, lens) => {
    if (!result || !Array.isArray(result.findings) || !result.findings.length) return { lens: lens.key, findings: [] }
    return parallel(result.findings.map(finding => () => agent(
      `Try to REFUTE this review finding. You are not its author and owe it nothing.

${AUTHORITY}

FINDING (${finding.severity}) at ${finding.where}: ${finding.summary}
${finding.why || ''}

Go to the artifact and check whether the finding is actually true as stated. Default to refuted:true
when the evidence is ambiguous — a finding that survives should survive on evidence, not on nobody
having looked.`,
      { schema: REFUTE_SCHEMA, label: `refute:${lens.key}`, phase: 'Review' })
    )).then(votes => ({
      lens: lens.key,
      findings: result.findings.map((finding, index) => ({
        ...finding,
        lens: lens.key,
        refuted: votes[index] ? votes[index].refuted === true : false,
        refutation: votes[index] ? votes[index].reason : 'refuter returned nothing; finding kept',
      })),
    }))
  },
)

// =============================================================================================
phase('Gate')
// COMPUTED IN JS FROM RAW COUNTS. An agent asked "did this pass?" is being asked to grade its own
// team; every gate in this repo is arithmetic over things that were counted, for that reason.
const findings = reviewed.filter(Boolean).flatMap(r => r.findings || [])
const surviving = findings.filter(f => !f.refuted)
const criticals = surviving.filter(f => f.severity === 'critical')
const majors = surviving.filter(f => f.severity === 'major')
const notDone = implemented.filter(r => !r.done)
const failedVerify = verified.filter(v => !v.pass)

const domainPassed = (domainRun ? domainRun.overallPass !== false : true)
  && (domainVerify ? domainVerify.overallPass !== false : true)
const overallPass = domainPassed && notDone.length === 0 && failedVerify.length === 0 && criticals.length === 0 && majors.length === 0
const verdict = overallPass ? 'CLEAN' : 'ISSUES'
const tasksThatFlagged = [...new Set([...notDone.map(r => r.id), ...failedVerify.map(v => v.id)])]

const scoreTable = [
  ...(domainRun ? [{ check: `${domainWorkflowLabel(ADAPTER.implementWorkflow)} workflow`, value: domainRun.overallPass === false ? 'ISSUES' : 'ran', pass: domainRun.overallPass !== false }] : []),
  ...(domainVerify ? [{ check: `${domainWorkflowLabel(ADAPTER.verifyWorkflow)} workflow`, value: domainVerify.overallPass === false ? 'ISSUES' : 'ran', pass: domainVerify.overallPass !== false }] : []),
  { check: 'tasks implemented', value: `${implemented.length - notDone.length}/${implemented.length}`, pass: notDone.length === 0 },
  { check: 'tasks verified', value: `${verified.length - failedVerify.length}/${verified.length}`, pass: failedVerify.length === 0 },
  { check: 'critical findings (post-refutation)', value: String(criticals.length), pass: criticals.length === 0 },
  { check: 'major findings (post-refutation)', value: String(majors.length), pass: majors.length === 0 },
]

// NO SILENT CAPS. A selective re-run judges a SUBSET, and a reader who is not told that will read
// this gate as covering the whole plan.
if (ONLY) log(`selective re-run: ${TASK_SUBSET.length} of ${TASKS.length} tasks judged; ${CARRIED.size} carried forward unjudged`)
log(`${verdict}: ${scoreTable.map(row => `${row.check} ${row.value}`).join(' | ')}`)

return {
  workflow: WORKFLOW,
  planPath: PLAN_PATH,
  planHash: PLAN_HASH,
  overallPass,
  verdict,
  scoreTable,
  implemented,
  verified,
  findings: surviving,
  refutedFindings: findings.filter(f => f.refuted),
  reviews: reviewed.filter(Boolean),
  tasksThatFlagged,
  carriedForward: [...CARRIED.keys()],
  domainRun,
  domainVerify,
}
