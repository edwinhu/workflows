export const meta = {
  name: 'craft',
  description: 'Craft loop core: sequential plan-bound implementation, blind verification in parallel with advisory third-party review, JS-computed gate',
  whenToUse: 'Invoked by the craft skill after plan approval; never discovers authority — requires planPath + specHash + tasks as args.',
  phases: [
    { title: 'Implement', detail: 'one agent per task, sequential (shared working tree); not opened at all under readOnly' },
    { title: 'Verify', detail: 'review lenses + adversarial refute, plus per-task blind verifiers when not readOnly' },
    { title: 'Mechanical', detail: 'optional whole-deliverable commands; the agent runs them, the JS reads the exit codes' },
    { title: 'Third-party', detail: 'advisory codex/gemini review — never gates' },
    { title: 'Gate', detail: 'JS arithmetic over raw counts; the task dimensions are n/a under readOnly' },
  ],
}

// `meta` MUST be the first statement in the file, and its value must be a PURE LITERAL — no
// variables, no conditionals, no shared sub-objects. The harness parses it without running the
// script, so a `phases` computed from `args` is rejected outright and NOTHING in this file loads,
// readOnly or not. An earlier version hoisted a `READ_ONLY` const and five phase arrays above this
// block to advertise a mode-specific phase list; it made craft unloadable in every mode and was
// caught only when a run finally invoked the harness for real, because every test until then had
// stubbed the hooks. Hence: one static list whose details name what readOnly changes, rather than
// lists chosen at parse time. `Implement` is advertised and then never opened on a readOnly run — a
// cosmetic cost, and the only shape the contract permits.

// ---------------------------------------------------------------- args (fail-closed)
if (!args || typeof args !== 'object') throw new Error('craft: args object required')
const { projectDir, planPath, specHash, goal, tasks } = args
if (!projectDir) throw new Error('craft: projectDir required')
if (!planPath) throw new Error('craft: planPath required — the approved plan snapshot is the sole authority')
if (!/^[0-9a-f]{64}$/.test(specHash || '')) throw new Error('craft: specHash must be the 64-hex sha256 of the plan\'s canonical craft:dispatch spec')
if (!goal) throw new Error('craft: goal required (one sentence + criteria from .craft/<run>/goal.md)')
// readOnly (default false): audit an existing tree. No Implement phase, no per-task verifiers, and
// therefore no requirement that tasks[] be non-empty. When readOnly is false the tasks[] guard is
// exactly as it has always been.
// Read once, here, and referenced everywhere below — never re-derived from args a second time: two
// independent derivations of one fact drift the moment the mode grows a nuance, and nothing would
// catch the half-done change. (This is the sole derivation now; `meta` above cannot consult args.)
const readOnly = args.readOnly === true
// Where this skill is installed. Dispatch injects it (craft-dispatch.sh knows $SKILL); the fallback
// is the stowed location, so a hand-built args object still names paths an agent can actually run.
// is `~/.claude/skills/craft` — tilde, not an absolute path, because the sandbox has no env access
// and a machine-specific literal would be wrong everywhere but one box. Both uses are prompt text a
// shell or an agent expands.
const skillRoot = args.skillRoot || '~/.claude/skills/craft'
if (!readOnly && (!Array.isArray(tasks) || tasks.length === 0)) throw new Error('craft: tasks[] required')
// Every later reference goes through taskList. When tasks[] is present this IS tasks (same array),
// so nothing downstream changes; it is [] only on a readOnly run that supplied no tasks.
const taskList = Array.isArray(tasks) ? tasks : []
// Optional per-task test-first gate. `redCommand` is EXECUTED by a probe agent on both sides of the
// implementer, and the JS reads the two exit codes — it is never a self-reported "RED confirmed".
// The command must be ONE INVOCATION: the probe runs the string verbatim, so a shell operator turns
// it into arbitrary code with the probe's authority and can fabricate RED (marker file, counter,
// post-adjudication mutation). Newline is rejected for the same reason `;` is.
const RED_COMMAND_OPERATORS = /[;&|`$><(){}\n\r]/
const isRedGated = t => typeof t.redCommand === 'string'
for (const t of taskList) {
  if (!t.id || !t.name || !t.work || !t.acceptance) {
    throw new Error(`craft: task missing id/name/work/acceptance: ${JSON.stringify(t)}`)
  }
  if (t.redCommand !== undefined && t.redCommand !== null) {
    if (typeof t.redCommand !== 'string' || !t.redCommand.trim()) {
      throw new Error(`craft: task ${t.id}: redCommand must be a non-empty string: ${JSON.stringify(t.redCommand)}`)
    }
    if (RED_COMMAND_OPERATORS.test(t.redCommand)) {
      throw new Error(
        `craft: task ${t.id}: redCommand must be ONE INVOCATION — the shell operators ; & | \` $ > < ( ) { } and newlines are rejected: ${JSON.stringify(t.redCommand)}. ` +
        'Flags and quotes are fine (pytest tests/x.py -k "a or b"); a shell program is not. ' +
        'If the check genuinely needs several steps, put them in a script and name the script.'
      )
    }
  }
  if (t.dependsOn !== undefined && t.dependsOn !== null) {
    if (!Array.isArray(t.dependsOn) || t.dependsOn.some(d => typeof d !== 'string' || !d.trim())) {
      throw new Error(`craft: task ${t.id}: dependsOn must be an array of task id strings: ${JSON.stringify(t.dependsOn)}`)
    }
    if (t.dependsOn.includes(t.id)) throw new Error(`craft: task ${t.id}: dependsOn cannot include itself`)
  }
}

// A dependency edge is a READ ordering: task B declares dependsOn:['A'] when B's refs, tests or
// inputs are files A writes. Absent dependsOn everywhere, every task lands in one wave and IMPLEMENT
// runs exactly as it always did — sequential in array order — so existing callers are byte-identical.
const taskIds = new Set(taskList.map(t => t.id))
const depsOf = t => (Array.isArray(t.dependsOn) ? t.dependsOn : [])
const HAS_DEPS = taskList.some(t => depsOf(t).length > 0)
for (const t of taskList) {
  for (const d of depsOf(t)) {
    // Unknown ids are refused rather than ignored: a typo'd dependency would silently drop the
    // ordering it was written to enforce, and the implementer would read a file that is not there yet.
    if (!taskIds.has(d)) throw new Error(`craft: task ${t.id}: dependsOn names unknown task id ${JSON.stringify(d)}`)
  }
}
// Optional priorFindings: [{title, severity, detail, file?, lens?}] — discoveries made OUTSIDE this
// run (e.g. by an agent team in main chat). A team cannot run inside this file, and not merely
// because agent() takes no `name`: the workflow dispatcher unions a fixed disallow list
// (["SendUserMessage", "Agent", "Workflow"]) into whatever agentType a leg names, so `Agent` is
// stripped from EVERY workflow leg regardless of type — no custom agentType buys it back. What a
// workflow structurally lacks is therefore peer-to-peer messaging between concurrent legs
// (SendMessage survives, so a leg can message something that already exists, but nothing here can
// create a peer to talk to); fan-out and staged handoff are already covered by parallel() and
// pipeline(). They are NOT trusted: each one is put through the SAME adversarial refuter
// path a lens finding takes, and only survivors reach the gate. Refutation deliberately happens here,
// outside the discovering team — a refuter that shares the team's premise confirms wrong findings.
// A finding with no `lens` is attributed to this ONE reserved key so the selector always names
// something; an unattributed survivor would populate no selector and break the L3 invariant.
// Same key for every source — a priorFinding with no lens and a reviewLenses entry with no key are
// the same situation (nothing said where this came from), and two names for it only confuse.
// A caller who wants a more specific label sets `lens` explicitly.
const UNATTRIBUTED = 'unattributed'
const PRIOR_FINDING_SEVERITIES = ['critical', 'major', 'minor']
// Validated at arg time, not mid-run: a malformed entry must fail before a single agent is dispatched.
if (args.priorFindings !== undefined && !Array.isArray(args.priorFindings)) {
  throw new Error(`craft: priorFindings must be an array of {title, severity, detail, file?, lens?}: ${JSON.stringify(args.priorFindings)}`)
}
for (const f of Array.isArray(args.priorFindings) ? args.priorFindings : []) {
  if (!f || !f.title || !f.severity || !f.detail) {
    throw new Error(`craft: priorFinding missing title/severity/detail: ${JSON.stringify(f)}`)
  }
  if (!PRIOR_FINDING_SEVERITIES.includes(f.severity)) {
    throw new Error(`craft: priorFinding severity must be one of ${PRIOR_FINDING_SEVERITIES.join('|')}: ${JSON.stringify(f)}`)
  }
}
// Attribution is settled HERE, once, so nothing downstream has to remember to default it.
const priorFindings = (Array.isArray(args.priorFindings) ? args.priorFindings : [])
  .map(f => ({ ...f, lens: f.lens || UNATTRIBUTED }))
// freezeFindingSet (default false): from round 2 on, the question is whether the CARRIED blocking
// set is closed, not whether this round's lenses raised anything. Lens findings still run and are
// still reported — as `residue`, which gates nothing; only surviving priorFindings gate. Without
// this the exit condition is a draw from a generator whose rate does not fall as fixes land.
const freezeFindingSet = args.freezeFindingSet === true
const thirdParty = Array.isArray(args.thirdParty) ? args.thirdParty.filter(m => ['codex', 'gemini'].includes(m)) : []
const reviewLenses = Array.isArray(args.reviewLenses) && args.reviewLenses.length
  ? args.reviewLenses
  : [
      { key: 'criteria-vs-artifacts', prompt: 'Judge the deliverable strictly against the success criteria in the plan and goal: for each criterion, is there an artifact in the working tree that satisfies it? Missing or partial satisfaction is a finding.' },
      { key: 'scope-fidelity', prompt: 'Judge scope fidelity: did the changes stay inside the plan\'s task table and writable paths? Out-of-scope edits, unrequested features, and silently skipped plan items are findings.' },
    ]
// Whole-deliverable mechanical checks: [{name, cmd}]. Optional; absent/empty skips the phase entirely.
const mechanicalChecks = Array.isArray(args.mechanicalChecks) ? args.mechanicalChecks : []
for (const c of mechanicalChecks) {
  if (!c || !c.name || !c.cmd) throw new Error(`craft: mechanicalCheck missing name/cmd: ${JSON.stringify(c)}`)
}
// Optional scored checks: [{key, items, prompt, schema, components, refs?, agentType?}]. ADVISORY:
// nothing computed from them is read by overallPass, and there is deliberately no threshold — gating
// on a weighted composite chases minors rather than defects. The agent returns RAW COUNTS and the
// arithmetic below is craft's, because an agent that reports its own score inflates it and one that
// never sees the formula cannot. Absent or [] means the leg dispatches nothing.
const scoredChecks = Array.isArray(args.scoredChecks) ? args.scoredChecks : []
const ITEMS_CHECKED = 'itemsChecked'
// A whitelisted count may not wear a score-shaped name, or the self-reported score walks back in
// under a count's cover.
const SCORE_NAME = /score|composite|rating|grade/i
const penaltyFields = s => new Set(s.components.flatMap(c => Object.keys(c.penalties)))
for (const s of scoredChecks) {
  if (!s || typeof s !== 'object' || !s.key || !s.prompt) {
    throw new Error(`craft: scoredCheck missing key/prompt: ${JSON.stringify(s)}`)
  }
  const at = `scoredCheck ${JSON.stringify(s.key)}`
  if (!Array.isArray(s.items) || !s.items.length || s.items.some(i => typeof i !== 'string' || !i.trim())) {
    throw new Error(`craft: ${at}: items must be a non-empty array of non-empty strings: ${JSON.stringify(s.items)}`)
  }
  if (!Array.isArray(s.components) || !s.components.length) {
    throw new Error(`craft: ${at}: components must be a non-empty array of {name, weight, base, penalties}: ${JSON.stringify(s.components)}`)
  }
  for (const c of s.components) {
    if (!c || typeof c !== 'object' || !c.name) throw new Error(`craft: ${at}: component missing name: ${JSON.stringify(c)}`)
    if (!Number.isFinite(c.weight) || !Number.isFinite(c.base)) {
      throw new Error(`craft: ${at}: component ${c.name}: weight and base must be finite numbers: ${JSON.stringify(c)}`)
    }
    if (!c.penalties || typeof c.penalties !== 'object' || Array.isArray(c.penalties) || !Object.keys(c.penalties).length) {
      throw new Error(`craft: ${at}: component ${c.name}: penalties must be a non-empty {countField: perUnit} object: ${JSON.stringify(c.penalties)}`)
    }
    for (const [k, per] of Object.entries(c.penalties)) {
      if (!Number.isFinite(per)) {
        throw new Error(`craft: ${at}: component ${c.name}: penalty ${JSON.stringify(k)} must be a finite per-unit number: ${JSON.stringify(per)}`)
      }
    }
  }
  const props = s.schema && typeof s.schema === 'object' ? s.schema.properties : null
  if (!props || typeof props !== 'object' || Array.isArray(props)) {
    throw new Error(`craft: ${at}: schema must be an object schema with a properties map: ${JSON.stringify(s.schema)}`)
  }
  const counts = penaltyFields(s)
  // `passthrough` is EVIDENCE, not input to any score: denominators a finding is stated against
  // (covered, totalDQ, spotChecks) and the item lists findings are built from (missingItems). Without
  // it the whitelist cannot express a real auditor — teaching's slide-auditor returns all three kinds
  // — and the port would have to run the auditor twice, once for counts and once for the evidence
  // those same counts describe. Declaring them keeps this a whitelist rather than loosening it to
  // "anything non-numeric", which would still refuse the numeric denominators.
  const pass = new Set(Array.isArray(s.passthrough) ? s.passthrough : [])
  if (s.passthrough !== undefined && !Array.isArray(s.passthrough)) {
    throw new Error(`craft: ${at}: passthrough must be an array of schema field names: ${JSON.stringify(s.passthrough)}`)
  }
  for (const k of pass) {
    if (counts.has(k)) {
      throw new Error(`craft: ${at}: ${JSON.stringify(k)} is declared both as a penalties key and as passthrough — a field either feeds a score or is evidence, never both.`)
    }
    if (!(k in props)) {
      throw new Error(`craft: ${at}: passthrough names ${JSON.stringify(k)}, which the schema does not declare.`)
    }
  }
  for (const [k, def] of Object.entries(props)) {
    // A WHITELIST keyed on the NAME, refusing before it ever looks at the type. A blacklist keyed on
    // type:'number' plus a name pattern waves through {compositeScore: {type: 'integer'}}, and the
    // agent then reports the one number this parameter exists to compute in JS.
    if (k !== ITEMS_CHECKED && !counts.has(k) && !pass.has(k)) {
      throw new Error(
        `craft: ${at}: schema field ${JSON.stringify(k)} is not "${ITEMS_CHECKED}", not a penalties key of any component (${[...counts].join(', ') || 'none declared'}), and not declared in passthrough. ` +
        'A scored agent returns RAW COUNTS ONLY and craft computes every score; declare evidence fields in passthrough, and refuse anything else.'
      )
    }
    // Applied to passthrough too: the guarantee is that no agent supplies the number, and an evidence
    // field named `composite` would smuggle one straight past the count rules.
    if (SCORE_NAME.test(k)) {
      throw new Error(`craft: ${at}: schema field ${JSON.stringify(k)} is score-shaped (/score|composite|rating|grade/i). Name the thing counted, not the number it feeds.`)
    }
    // Scored fields stay numeric with no nesting; passthrough may be any shape, since nothing computes on it.
    if (!pass.has(k) && (!def || typeof def !== 'object' || (def.type !== 'number' && def.type !== 'integer') || def.properties !== undefined)) {
      throw new Error(`craft: ${at}: schema field ${JSON.stringify(k)} must be declared type number|integer with no nested properties: ${JSON.stringify(def)}`)
    }
  }
  if (!(ITEMS_CHECKED in props)) {
    throw new Error(`craft: ${at}: schema must declare ${ITEMS_CHECKED} — it is what states how much was examined, and without it every item is unmeasured.`)
  }
  for (const k of counts) {
    // A penalty over a field the schema never declares contributes zero on every run, and a penalty
    // that never fires is indistinguishable from one that never applied.
    if (!(k in props)) {
      throw new Error(`craft: ${at}: penalty ${JSON.stringify(k)} names a count field the schema does not declare (declared: ${Object.keys(props).join(', ')})`)
    }
  }
}
// One job per (check, item), in declaration order — scores are per item and never aggregated across
// items, so this list is also the order `scores[]` comes back in.
const scoredJobs = scoredChecks.flatMap(s => s.items.map(item => ({ check: s, item })))
// Optional: text appended to the AUTHORITY block every dispatched agent receives (implementers,
// verifiers, lenses, refuters). Absent => AUTHORITY is byte-identical to the four-line form.
const authorityExtra = typeof args.authorityExtra === 'string' && args.authorityExtra.trim() ? args.authorityExtra : null
// Optional agent-type overrides. Absent => no agentType key is passed to agent() at all, so the
// dispatcher's default applies exactly as before.
const implementerAgentType = args.implementerAgentType || null
const verifierAgentType = args.verifierAgentType || null
// Every call site spreads `...agentTypeOpt(X)`, which contributes no key at all when X is absent.
//
// Read-only agents by default. Under readOnly EVERY dispatched leg — lenses, refuters (including
// the priorFindings ones), the mechanical probes and the third-party runners — defaults to the
// Explore agent type, which structurally has no Edit and no Write tool. A prompt that says "modify
// nothing" is a request; an agent type is a boundary, and a readOnly run is exactly the case where
// the tree must not be touched. Precedence: an explicit per-lens agentType wins over this default.
// Outside readOnly the default does not apply at all — reviewAgentType(undefined) returns null,
// agentTypeOpt(null) contributes {}, and agent() receives NO agentType key whatsoever,
// byte-identical to before this change.
//
// The mechanical and third-party legs were the gap: they carried no agentType at all, so on a
// readOnly run they inherited the dispatcher default and were the two legs that COULD write, while
// the skill built on top of this described readOnly as "nothing can write." Explore is the right
// type for both because it keeps Bash — a probe that cannot run its command is not a probe — while
// removing the tools an agent writes with by choice.
//
// RESIDUAL, stated because a boundary nobody can see the edge of is not a boundary: Explore keeps
// Bash, and a `mechanicalChecks` cmd runs VERBATIM. A caller who passes a command that writes still
// writes. What this pins is the agent's own volition, not the caller's command — so a readOnly
// charter must still pass commands that only read.
const READ_ONLY_AGENT_TYPE = 'Explore'
const reviewAgentType = explicit => explicit || (readOnly ? READ_ONLY_AGENT_TYPE : null)
const agentTypeOpt = t => (t ? { agentType: t } : {})
// Optional refs: absolute paths the agent must Read in full. An absent or empty list contributes
// NOTHING to the prompt — not a blank line, not a heading.
const refLines = (refs, intro) =>
  Array.isArray(refs) && refs.length ? ['', intro, ...refs.map(p => `- ${p}`)] : []
const IMPL_REFS_INTRO = 'Domain rules governing this task. Read each of these files IN FULL before doing any work:'
const JUDGE_REFS_INTRO = 'The rules this judgement is made against. Read each of these files IN FULL before judging:'
// Refuters get the ref paths NAMED but not a read-in-full instruction. A lens is one agent doing
// open-ended reading; its refuters are one agent PER FINDING, and handing each of them the same
// full ref set multiplies the largest read in the run by the finding count — measured at 39
// refuters against 1,700 lines of refs, which is where a craft run's tokens actually go. The
// finding's own quoted evidence is what a refuter judges; the refs stay reachable for the case
// where that evidence genuinely is not enough, so nothing is structurally hidden from it.
const REFUTER_REFS_INTRO = 'Rules files, available if the finding\'s own quoted evidence is not enough to reach a verdict. Do NOT read these by default — the finding above should be self-contained, and opening one costs the run real tokens. If you do open one, say so in your reason.'
const refuterRefLines = refs =>
  Array.isArray(refs) && refs.length ? ['', REFUTER_REFS_INTRO, ...refs.map(p => `- ${p}`)] : []
// Refuter model/effort. Refutation is a bounded judgement against quoted evidence, not open-ended
// investigation, so it does not need the session's top tier — and there are more refuters than every
// other agent kind combined. Pass `refuterModel: null` / `refuterEffort: null` to omit the key
// entirely and inherit the session default, which is what a run wanting a maximally hard gate does.
const refuterModel = args.refuterModel === undefined ? 'sonnet' : (args.refuterModel || null)
const refuterEffort = args.refuterEffort === undefined ? 'medium' : (args.refuterEffort || null)
// Probe model. A mechanical/red/third-party probe RUNS A COMMAND and reports {name, exitCode,
// output}; the JS reads the exit code and no probe asserts a pass. There is no judgement to
// downgrade, so the session's top tier is spent on process supervision — and probes outnumber
// every other non-refuter leg. Default sonnet; pass null to inherit the session model.
const probeModel = args.probeModel === undefined ? 'sonnet' : (args.probeModel || null)
// A verifier judges ONE task against ONE stated acceptance criterion, with the criterion and the
// evidence both handed to it — bounded, like refutation, and one per task. Default sonnet.
const verifierModel = args.verifierModel === undefined ? 'sonnet' : (args.verifierModel || null)
// Implementers and lenses default to INHERIT. Lenses are where a downgrade costs the most: they are
// the open-ended readers that find defects nothing else does, so a cheaper lens is a weaker gate
// rather than a cheaper one. Implementers write the artifact the whole gate then judges.
const implementerModel = args.implementerModel || null
const lensModel = args.lensModel || null
const optIf = (k, v) => (v ? { [k]: v } : {})

// Fail closed on a dead lens. A lens agent that returns null contributes zero findings, which is
// byte-identical to a lens that reviewed and found nothing — the gate would certify a review
// dimension that never ran. Every other leg in this file already fails closed (verifier synthesizes
// pass:false, mechanical probes synthesize exitCode:-1, a dead refuter keeps its finding); the lens
// synthesizes a critical finding attributed to itself, so it flows into surviving →
// survivingBlocking → lensesThatFlagged → overallPass by the ordinary arithmetic.
const DEAD_LENS_TITLE = 'lens agent died or was skipped — this review dimension did not run'
const deadLensFinding = (key, how) => ({
  title: DEAD_LENS_TITLE,
  severity: 'critical',
  detail: `The "${key}" lens was dispatched but ${how}. Nothing judged this deliverable along that dimension, so its silence is not evidence of a clean result. Re-run this lens.`,
  lens: key,
  refuted: false,
  refuteReason: 'synthesized by the gate from a missing agent result — there is no finding to refute, only a review that did not happen',
  syntheticDeadLens: true,
})

const onlyTasks = Array.isArray(args.onlyTasks) && args.onlyTasks.length ? new Set(args.onlyTasks) : null
const prior = args.priorResults || {}
const priorImplemented = Array.isArray(prior.implemented) ? prior.implemented : []
const priorVerified = Array.isArray(prior.verified) ? prior.verified : []
// Carried red-gate adjudications, same union-with-carried shape as implemented/verified. [] for every
// caller that passes no redCommand.
const priorRed = Array.isArray(prior.red) ? prior.red : []

const activeTasks = onlyTasks ? taskList.filter(t => onlyTasks.has(t.id)) : taskList

// ---------------------------------------------------------------- fan-out cap (fail-closed)
// SKILL.md has always carried a "~50 agents" ceiling, and it has always been PROSE — advice to the
// same agent that decides whether to follow it. That is not a cap. Observed 2026-08-07: a run read
// the line, computed 61, wrote "over the guideline", and dispatched anyway; lens findings then took
// it to 80. Sizing is the user's call at plan-approval time, so exceeding it has to stop the run and
// go back to them, exactly like a bad specHash does.
//
// Only the floor is knowable here. Refuters for LENS findings are not — a lens returns as many
// findings as it finds — which is why they are separately bounded by REFUTERS_PER_LENS below.
const MAX_AGENTS_DEFAULT = 50
const maxAgents = Number.isFinite(args.maxAgents) ? args.maxAgents : MAX_AGENTS_DEFAULT
// Cap on refuters dispatched per lens. Findings beyond it are reported as submitted-but-not-refuted
// rather than dropped: silent truncation would read as "nothing more was found", which is the same
// class of lie as a dead lens reading as a clean one.
const REFUTERS_PER_LENS = Number.isFinite(args.refutersPerLens) ? args.refutersPerLens : 8
// Two probes per red-gated task (before + after the implementer). Under readOnly the Implement phase
// is never opened, so no probe is dispatched and the term is zero.
const redGatedActive = readOnly ? [] : activeTasks.filter(isRedGated)
const fanOut = {
  implementers: readOnly ? 0 : activeTasks.length,
  verifiers: readOnly ? 0 : activeTasks.length,
  lenses: reviewLenses.length,
  mechanical: mechanicalChecks.length,
  priorFindingRefuters: priorFindings.length,
  thirdParty: thirdParty.length,
  // Key omitted entirely when nothing is red-gated, so the sizing error a caller without redCommand
  // sees is byte-identical to before.
  ...(redGatedActive.length ? { redProbes: redGatedActive.length * 2 } : {}),
  // Key omitted entirely without scoredChecks, so an existing caller's sizing error is unchanged.
  // Advisory agents still cost the same budget as gating ones.
  ...(scoredJobs.length ? { scored: scoredJobs.length } : {}),
}
const fanOutFloor = Object.values(fanOut).reduce((a, b) => a + b, 0)
if (fanOutFloor > maxAgents) {
  throw new Error(
    `craft: fan-out floor ${fanOutFloor} exceeds maxAgents ${maxAgents} — ` +
    `${JSON.stringify(fanOut)} (lens-finding refuters are ON TOP of this, up to ${REFUTERS_PER_LENS} per lens). ` +
    'This is a sizing decision and it belongs to the user at plan-approval time, not to the dispatcher. ' +
    'Split into sequenced craft runs, cut priorFindings/lenses in the plan and re-hash, or pass an explicit maxAgents.'
  )
}
if (onlyTasks && activeTasks.length === 0) throw new Error('craft: onlyTasks matched none of tasks[]')

// ── IMPLEMENT waves ──────────────────────────────────────────────────────────
// Tasks within a wave run CONCURRENTLY; waves run in order. An edge to a task outside `activeTasks`
// is treated as ALREADY SATISFIED: under onlyTasks that dependency was implemented by an earlier run
// and its output is on disk, so refusing it would make every scoped re-run unschedulable.
const activeIds = new Set(activeTasks.map(t => t.id))
function implementWaves(list) {
  if (!HAS_DEPS) return [list]           // no declared order => today's single sequential pass
  const pending = new Map(list.map(t => [t.id, depsOf(t).filter(d => activeIds.has(d))]))
  const waves = []
  const done = new Set()
  while (pending.size) {
    const ready = [...pending].filter(([, ds]) => ds.every(d => done.has(d))).map(([id]) => id)
    if (!ready.length) {
      // Kahn leftover: the remaining ids are exactly the cycle. Naming them beats "invalid graph".
      throw new Error(
        `craft: dependsOn contains a cycle among ${JSON.stringify([...pending.keys()])} — ` +
        'IMPLEMENT cannot be ordered. A dependency is a read ordering, so a cycle means two tasks each need the other\'s output.'
      )
    }
    // Wave order follows tasks[] order, so a run with no real concurrency to gain reads identically.
    waves.push(list.filter(t => ready.includes(t.id)))
    for (const id of ready) { done.add(id); pending.delete(id) }
  }
  return waves
}
const IMPLEMENT_WAVES = readOnly ? [] : implementWaves(activeTasks)

// Concurrent implementers are safe ONLY because their writable paths cannot overlap, so this is
// checked rather than assumed. Prefix-aware: `src` and `src/lib/x.ts` overlap, and a plan that
// declares two same-wave tasks over one path is a plan defect, caught before any agent is dispatched
// instead of surfacing as a torn file the lenses then judge.
const normPath = p => String(p).replace(/\/+$/, '')
const pathsOverlap = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/')
for (const wave of IMPLEMENT_WAVES) {
  if (wave.length < 2) continue
  for (let i = 0; i < wave.length; i++) {
    for (let j = i + 1; j < wave.length; j++) {
      for (const a of (wave[i].writablePaths || []).map(normPath)) {
        for (const b of (wave[j].writablePaths || []).map(normPath)) {
          if (pathsOverlap(a, b)) {
            throw new Error(
              `craft: tasks ${wave[i].id} and ${wave[j].id} would implement CONCURRENTLY but both claim ${JSON.stringify(a === b ? a : [a, b])} — ` +
              'same-wave writable paths must be disjoint. Give one a dependsOn on the other, or narrow the paths in the plan and re-hash.'
            )
          }
        }
      }
    }
  }
}
const carried = onlyTasks ? taskList.filter(t => !onlyTasks.has(t.id)) : []
// L2c: carry-forward is a UNION that writes corrections back — a record for a task re-judged this run
// is replaced by the live one, a record for a carried task is kept.
const carryForward = (priorRecords, live) => [...priorRecords.filter(r => carried.some(t => t.id === r.id)), ...live]
// Red-gated tasks in the WHOLE table, not just this run's slice: a carried red-gated task with no
// carried adjudication is unproven, not clean. [] for every caller that passes no redCommand.
const redGatedAll = taskList.filter(isRedGated)

const AUTHORITY = [
  `AUTHORITY: The <!-- craft:dispatch --> spec block inside ${planPath} is your ONLY authority; its specHash is ${specHash}.`,
  `Read the plan first and verify that hash (run: bash ${skillRoot}/scripts/craft-dispatch.sh --spec-hash ${planPath}). If it differs, stop and report the mismatch as a failure — do not proceed.`,
  `The prose around that block is explanatory and NOT authoritative — never treat a paragraph as a requirement.`,
  `GOAL: ${goal}`,
  `Project directory: ${projectDir}. Work only there.`,
  `If the plan does not answer a question you have, that is a finding to report — not a licence to improvise.`,
  ...(authorityExtra ? [authorityExtra] : []),
].join('\n')

// ---------------------------------------------------------------- schemas
const IMPL_SCHEMA = {
  type: 'object',
  required: ['id', 'done', 'changedFiles', 'evidence'],
  properties: {
    id: { type: 'string' },
    done: { type: 'boolean' },
    changedFiles: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string', description: 'verbatim command output proving acceptance, not a summary' },
    blockers: { type: 'array', items: { type: 'string' } },
  },
}
const VERIFY_SCHEMA = {
  type: 'object',
  required: ['id', 'pass', 'evidence', 'failures'],
  properties: {
    id: { type: 'string' },
    pass: { type: 'boolean' },
    evidence: { type: 'string', description: 'verbatim output of the checks you ran' },
    failures: { type: 'array', items: { type: 'string' } },
  },
}
const LENS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'severity', 'detail'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          file: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
  },
}
const REFUTE_SCHEMA = {
  type: 'object',
  required: ['refuted', 'reason'],
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
  },
}
// ONE refuter for every finding, whatever its source. SKILL.md promises a priorFinding gets "the same
// adversarial path a lens finding takes" — that promise is true by construction here. The discipline
// lines and the fail-closed rule (a dead refuter KEEPS the finding) exist once, so tightening them
// cannot half-apply. Callers vary only the header, an optional provenance paragraph, the refs, and
// the label prefix.
// The fail-closed shape, in one place: a refutation that never happened leaves the finding standing.
const keptFinding = (f, why) => ({ ...f, refuted: false, refuteReason: why })
const refuteFinding = (f, { key, header, extra = [], refs, agentType, labelPrefix = 'refute' }) => agent(
  [
    AUTHORITY,
    '',
    header,
    `  ${f.title}${f.file ? ` [${f.file}]` : ''}`,
    `  ${f.detail}`,
    ...refuterRefLines(refs),
    '',
    ...extra,
    'Try hard to show the finding is wrong, already handled, or out of the plan\'s scope. Modify nothing.',
    'Default: if the evidence is ambiguous either way, refuted=true (the finding does not survive).',
  ].join('\n'),
  {
    label: `${labelPrefix}:${key}`, phase: 'Verify', schema: REFUTE_SCHEMA,
    ...agentTypeOpt(reviewAgentType(agentType)),
    ...optIf('model', refuterModel),
    ...optIf('effort', refuterEffort),
  }
).then(v => ({
  ...f,
  lens: key,
  refuted: v ? v.refuted : false,
  refuteReason: v ? v.reason : 'refuter died — finding kept',
}))
const MECHANICAL_SCHEMA = {
  type: 'object',
  required: ['name', 'exitCode', 'output'],
  properties: {
    name: { type: 'string', description: 'the check name exactly as given to you' },
    exitCode: { type: 'number', description: 'the integer exit status of the command as run, verbatim — never your judgement of whether it passed' },
    output: { type: 'string', description: 'the last ~2000 characters of combined stdout+stderr' },
  },
}
const THIRD_PARTY_SCHEMA = {
  type: 'object',
  required: ['model', 'status', 'findings'],
  properties: {
    model: { type: 'string', enum: ['codex', 'gemini'] },
    status: { type: 'string', enum: ['reviewed', 'unavailable', 'unparseable'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'detail'],
        properties: {
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          file: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
    raw: { type: 'string', description: 'truncated raw CLI output when status is unparseable' },
  },
}

// ---------------------------------------------------------------- lens leg
// Dispatch the lens array, adversarially refute what each lens returns, fail closed on a lens that
// never reported.
// Returns {findings, lensesRun, lensesReported} — findings are the refuted-or-kept pool, already
// carrying `lens`, with a synthesized critical appended for every lens that did not report.
const DEAD_LENS_HOW = 'its review leg produced no result'
const runLensLeg = async lenses => {
  // deadLenses records every dispatched lens whose agent returned nothing, so a crash-drop is
  // distinguishable from a lens that ran and reported an empty findings list.
  // Every lens gets an identity whether or not it declared a key, so a dead one can always be named
  // in the selector and in the findings file. An unnamed dimension cannot be re-run.
  const lensLabel = (lens, i) => ({
    key: (lens && lens.key) || `${UNATTRIBUTED}#${i}`,
    how: DEAD_LENS_HOW,
  })
  const deadLenses = new Map()
  const lensResults = await pipeline(
    lenses,
    (lens, _orig, lensIndex) => agent(
      [
        AUTHORITY,
        '',
        `You are a READ-ONLY REVIEWER applying one lens: ${lens.key}.`,
        lens.prompt,
        ...refLines(lens.refs, JUDGE_REFS_INTRO),
        '',
        'Rules: modify nothing; cite files/lines; report findings only for this lens; an empty findings list is a valid answer.',
      ].join('\n'),
      { label: `lens:${lens.key}`, phase: 'Verify', schema: LENS_SCHEMA, ...agentTypeOpt(reviewAgentType(lens.agentType)), ...optIf("model", lensModel) }
    ).then(review => {
      // A null result is an agent that never reported. An object with findings: [] is a lens that
      // ran and found nothing — only the first is recorded as dead.
      // The pipeline's own index. `lenses.indexOf(lens)` is an identity lookup returning the
      // FIRST matching slot, so two slots holding the same object reference collapsed into one Map
      // entry — the very collapse this was changed to eliminate, moved from key to object identity.
      if (!review) deadLenses.set(lensIndex, lensLabel(lens, lensIndex))
      return review
    }),
    (review, lens) => {
      // Refuters per lens are the one UNBOUNDED term in the fan-out: the arg-validation cap can
      // count everything else up front, but not how many findings a lens will return. Bound it here,
      // severity-first so the cap can never spend its budget on minors and drop a critical.
      const RANK = { critical: 0, major: 1, minor: 2 }
      const ordered = [...(review?.findings || [])].sort(
        (a, b) => (RANK[a.severity] ?? 3) - (RANK[b.severity] ?? 3)
      )
      const judged = ordered.slice(0, REFUTERS_PER_LENS)
      const overflow = ordered.slice(REFUTERS_PER_LENS)
      // `.then(r => r || keptFinding(...))` per slot: `parallel()` converts a REJECTED thunk — and a
      // budget drop — to null, and the `.filter(Boolean)` below erases exactly those. A refuter that
      // threw therefore deleted the finding it was meant to test, and the score table was
      // byte-identical to a lens that reviewed and found nothing. Every sibling leg (implement,
      // verify, mechanical, third-party) already carries this guard; this one did not, so a dead
      // refuter kept its finding only when agent() resolved null, never when the slot died.
      return parallel(judged.map(f => () =>
        refuteFinding(f, {
          key: lens.key,
          header: `Adversarially REFUTE this ${f.severity} review finding (lens ${lens.key}):`,
          refs: lens.refs,
          agentType: lens.agentType,
        })
      )).then(rs => [
        // Guarded AFTER parallel, like every sibling leg: a thunk that THROWS never reaches a
        // `.then` on itself — `parallel()` converts the rejection to null — and the `.filter(Boolean)`
        // downstream then erased the slot, deleting the finding the refuter was meant to test. The
        // score table was byte-identical to a lens that reviewed and found nothing.
        ...rs.map((r, i) => r || ({
          ...keptFinding(judged[i], 'its refuter leg died, so this finding was never adversarially tested; it stands by the fail-closed rule'),
          lens: lens.key,
        })),
        // Reported, never dropped. An untested finding STANDS (refuted: false) — the same
        // fail-closed rule a dead refuter gets, because in both cases no refutation happened.
        // Truncating silently would read as "the lens found nothing more", which is a lie the
        // gate would then certify.
        ...overflow.map(f => ({
          ...keptFinding(f, `NOT REFUTED — lens "${lens.key}" returned ${ordered.length} findings, over the ${REFUTERS_PER_LENS}-per-lens refuter cap. This finding was never adversarially tested; it stands by the fail-closed rule, not by surviving refutation.`),
          lens: lens.key,
        })),
      ])
    }
  )
  // A null pipeline slot means the whole leg for that lens produced nothing — the lens agent may
  // have reported and the refute stage then died. Either way that dimension has no usable result.
  // Keyed on INDEX, and with no `key &&` guard. Keyed on `lens.key` two lenses sharing a key — or
  // two that both omit one, which the param docs call normal — collapsed into one entry, so
  // lensesReported over-counted and only one synthesized critical was emitted. The `key &&` guard
  // meant an unkeyed lens could never be recorded dead at all: it counted as reported and the gate
  // certified a dimension that never ran.
  lensResults.forEach((slot, i) => {
    if (slot == null && !deadLenses.has(i)) deadLenses.set(i, lensLabel(lenses[i], i))
  })
  const reported = lensResults.filter(Boolean).flat().filter(Boolean)
  // Synthesized last so real findings keep their existing order. With every lens returning normally
  // deadLenses is empty, this is a concat of [], and `findings` is byte-identical to before.
  const findings = [...reported, ...[...deadLenses].map(([, label]) => deadLensFinding(label.key, label.how))]
  return { findings, lensesRun: lenses.length, lensesReported: lenses.length - deadLenses.size }
}
// The whole-leg-died fallback, from the SAME helper so the dead wording cannot drift from the
// in-leg synthesis: every lens is dead rather than clean, named by the same identity rule.
const deadLensLeg = (lenses, how) => ({
  findings: lenses.map((l, i) => deadLensFinding((l && l.key) || `${UNATTRIBUTED}#${i}`, how)),
  lensesRun: lenses.length,
  lensesReported: 0,
})

// ---------------------------------------------------------------- red gate (executed, never self-reported)
// The probe is a separate agent from the implementer and is told nothing about which exit code is
// wanted — an implementer that reports its own RED certifies its own work (gate-laws L5). Explore
// unconditionally: a probe that can Edit can make its own command pass.
const RED_VERDICT_OK = 'red-green'
const redProbe = (t, when) => agent(
  [
    AUTHORITY,
    '',
    `You are a RED PROBE for task ${t.id}. You are not a reviewer, not an implementer, and you fix nothing.`,
    'Run this command VERBATIM via Bash, from the project directory:',
    '',
    t.redCommand,
    '',
    'Rules:',
    '- Run it EXACTLY as written. Do not substitute a different command, do not add or drop flags, do not re-run a "corrected" version.',
    '- Change nothing. Do not create, edit or delete any file, do not install anything, do not fix whatever the command complains about.',
    '- Either exit code is a valid and useful answer. Report what happened; do not try to make the command succeed or fail.',
    `- Report name="${t.id}", exitCode = the command's actual integer exit status (capture it, e.g. append "; echo EXIT=$?"), and output = the last ~2000 characters of combined stdout+stderr.`,
    '- Never report an exit code you did not observe. The gate reads your exitCode as fact.',
  ].join('\n'),
  { label: `red:${when}:${t.id}`, phase: 'Implement', effort: 'low', schema: MECHANICAL_SCHEMA, ...optIf('model', probeModel),
    ...agentTypeOpt(READ_ONLY_AGENT_TYPE) }
).then(r => (r && Number.isFinite(r.exitCode)
  ? r
  : { name: t.id, exitCode: -1, output: r ? 'probe reported no integer exitCode' : 'probe agent died or was skipped' }))

// Fail closed on an absent probe: -1 on either side is `red-unproven`, never a pass (gate-laws L4).
// A missing side is unproven for the same reason — nothing observed the command there.
const redVerdict = (before, after) => {
  if (!before || !after || before.exitCode === -1 || after.exitCode === -1) return 'red-unproven'
  if (before.exitCode === 0) return 'red-not-red'
  if (after.exitCode !== 0) return 'green-not-green'
  return RED_VERDICT_OK
}

// ---------------------------------------------------------------- prior findings
// Prior findings are refuted by the SAME adversarial path as a lens finding: same REFUTE_SCHEMA, the
// same "default to refuted when ambiguous" instruction, and the same fail-closed rule that a dead
// refuter KEEPS the finding. The judged results then flow into surviving -> survivingBlocking ->
// lensesThatFlagged -> overallPass by the ordinary arithmetic below, with no special casing.
// Empty when priorFindings is absent: no agent is dispatched and the leg contributes [].
const priorFindingsLeg = async () => {
  if (priorFindings.length === 0) return []
  const results = await parallel(priorFindings.map(f => () => refuteFinding(f, {
    key: f.lens,
    header: `Adversarially REFUTE this ${f.severity} finding, reported by a PRIOR review pass (attributed to: ${f.lens}):`,
    extra: ['This finding was NOT produced by this run. It came from a separate discovery pass whose premises you did not share and must not assume are correct.'],
    // A prior finding attributed to a real lens is judged against that lens's rules; otherwise none.
    refs: (reviewLenses.find(l => l.key === f.lens) || {}).refs,
    agentType: f.agentType,
    labelPrefix: 'refute:prior',
  })))
  // Fail closed: a null slot is a refutation that never happened, so the finding stands.
  return results.map((r, i) => r || keptFinding(priorFindings[i], 'refuter died — finding kept'))
}
// Fail closed on the whole leg: if it died, nothing was refuted, so every prior finding stands.
const priorFallback =() => priorFindings.map(f => keptFinding(f, 'the prior-findings refute leg failed — finding kept'))

// ---------------------------------------------------------------- Implement (sequential: shared working tree)
// Skipped ENTIRELY under readOnly: the phase is not opened and no implementer agent is dispatched.
const implemented = []
// One entry per red-gated task dispatched this run. [] when no task declares redCommand.
const redResults = []
// Flat rather than a wrapping `if (!readOnly) { … }` whose body sat at the outer indent — the
// indentation then lied about the nesting. Same idiom the verify leg uses (`readOnly ? [] : …`):
// under readOnly the phase is never opened and the loop body never runs, so no agent is dispatched.
if (!readOnly) phase('Implement')
// One wave at a time; tasks WITHIN a wave concurrently. Each task keeps its own
// red-probe → implementer → red-probe chain, so a `redCommand` still brackets its own implementer
// and never observes a sibling's. With no dependsOn there is exactly one wave and `parallel()` over
// it preserves array order in its results, so a caller that declared no order sees no change beyond
// concurrency it did not forbid.
for (const wave of IMPLEMENT_WAVES) {
  const outcomes = await parallel(wave.map(t => async () => {
  // Absent redCommand => no probe agent is dispatched and nothing below this line differs.
  const redBefore = isRedGated(t) ? await redProbe(t, 'before') : null
  const r = await agent(
    [
      AUTHORITY,
      '',
      `You are the IMPLEMENTER for task ${t.id}: ${t.name}.`,
      `Work: ${t.work}`,
      `Writable paths (hard boundary — touch nothing outside them): ${(t.writablePaths || []).join(', ') || 'as specified in the plan for this task'}`,
      `Acceptance: ${t.acceptance}`,
      ...refLines(t.refs, IMPL_REFS_INTRO),
      '',
      'Rules:',
      '- Leave changes in the working tree. Do NOT commit, push, or switch branches.',
      '- Prove acceptance: run the relevant command/check and paste its VERBATIM output as evidence.',
      '- A separate verifier will judge the files themselves without seeing this report — your report cannot substitute for the work.',
      '- If blocked, set done=false and list blockers; do not loosen the acceptance to pass.',
    ].join('\n'),
    { label: `implement:${t.id}`, phase: 'Implement', schema: IMPL_SCHEMA, ...agentTypeOpt(implementerAgentType), ...optIf('model', implementerModel) }
  )
  const record = r || { id: t.id, done: false, changedFiles: [], evidence: '', blockers: ['agent died or was skipped'] }
  let red = null
  if (isRedGated(t)) {
    // Adjudicated AFTER dispatch, like the contract it ports: a failed verdict fails the task rather
    // than skipping the implementer, so the second probe always observes the post-implementation tree.
    const redAfter = await redProbe(t, 'after')
    red = {
      id: t.id,
      command: t.redCommand,
      verdict: redVerdict(redBefore, redAfter),
      beforeExit: redBefore ? redBefore.exitCode : -1,
      afterExit: redAfter ? redAfter.exitCode : -1,
      beforeOutput: redBefore ? redBefore.output : 'probe agent died or was skipped',
      afterOutput: redAfter ? redAfter.output : 'probe agent died or was skipped',
    }
  }
  return { record, red }
  }))
  // parallel() resolves a throwing thunk to null; a null here would drop the task from `implemented`
  // and read downstream as "no such task" rather than "task failed" — fail closed on the task id.
  wave.forEach((t, i) => {
    const o = outcomes[i]
    implemented.push(o ? o.record : { id: t.id, done: false, changedFiles: [], evidence: '', blockers: ['implement leg threw or was dropped'] })
    if (o && o.red) redResults.push(o.red)
    else if (!o && isRedGated(t)) {
      redResults.push({
        id: t.id, command: t.redCommand, verdict: 'red-unproven',
        beforeExit: -1, afterExit: -1,
        beforeOutput: 'implement leg threw or was dropped', afterOutput: 'implement leg threw or was dropped',
      })
    }
  })
}

// ---------------------------------------------------------------- Verify ∥ Third-party (barrier: the gate needs both)
const verifyLeg = async () => {
  // Under readOnly the per-task verifier fan-out is skipped ENTIRELY — parallel() is not called and
  // no verifier agent is dispatched. `verified` is [] because nothing was judged, which is why the
  // gate marks the task dimensions n/a rather than reading [] as clean.
  const perTask = readOnly ? [] : await parallel(activeTasks.map(t => () =>
    agent(
      [
        AUTHORITY,
        '',
        `You are a READ-ONLY VERIFIER for task ${t.id}: ${t.name}.`,
        `Acceptance: ${t.acceptance}`,
        '',
        'Rules:',
        '- Judge the working tree goal-backward from the acceptance criterion. You have NOT been shown the implementer\'s report — judge only the files and what commands prove.',
        '- Modify nothing. Run read-only checks/commands and paste their VERBATIM output as evidence.',
        '- pass=true only if the acceptance is demonstrably met. Ambiguity fails.',
      ].join('\n'),
      { label: `verify:${t.id}`, phase: 'Verify', schema: VERIFY_SCHEMA, ...agentTypeOpt(verifierAgentType), ...optIf('model', verifierModel) }
    )
  ))
  const verified = perTask.map((v, i) => v || { id: activeTasks[i].id, pass: false, evidence: '', failures: ['verifier died or was skipped'] })

  // whole-deliverable lenses, each finding adversarially refuted as soon as its lens completes.
  return { verified, ...(await runLensLeg(reviewLenses)) }
}

// Mechanical checks are whole-deliverable: they ALWAYS run, including under onlyTasks, and are never
// carried forward from priorResults — an empty-set carry-forward would be a vacuous pass.
const mechanicalLeg = async () => {
  if (mechanicalChecks.length === 0) return []
  const results = await parallel(mechanicalChecks.map(c => () =>
    agent(
      [
        AUTHORITY,
        '',
        `You are a MECHANICAL PROBE for check "${c.name}". You are not a reviewer and you fix nothing.`,
        'Run this command VERBATIM via Bash, from the project directory:',
        '',
        c.cmd,
        '',
        'Rules:',
        '- Run it EXACTLY as written. Do not substitute a different command, do not add or drop flags, do not re-run a "corrected" version.',
        '- Change nothing. Do not fix anything the command complains about, do not create missing files, do not install anything.',
        '- If the command fails, that is the answer. Report it. A non-zero exit code is a valid and useful result.',
        `- Report name="${c.name}", exitCode = the command's actual integer exit status (capture it, e.g. append "; echo EXIT=$?"), and output = the last ~2000 characters of combined stdout+stderr.`,
        '- Never report an exit code you did not observe. The gate reads your exitCode as fact.',
      ].join('\n'),
      { label: `mechanical:${c.name}`, phase: 'Mechanical', effort: 'low', schema: MECHANICAL_SCHEMA, ...optIf('model', probeModel),
        ...agentTypeOpt(reviewAgentType()) }
    ).then(r => r || { name: c.name, exitCode: -1, output: 'probe agent died or was skipped' })
  ))
  // Fail closed: parallel() may itself yield null slots; those become exitCode -1 → FAILED.
  return results.map((r, i) => r || { name: mechanicalChecks[i].name, exitCode: -1, output: 'probe agent died or was skipped' })
}

// ---------------------------------------------------------------- scored checks (counts in, scores computed HERE)
// Mirrors mechanicalLeg: one agent per item, one parallel group, fail closed per slot. What it does
// not mirror is the gate — no value produced below this line is read by overallPass, on any path.
const NO_SCORES = { scores: [], scoresRun: null, scoresReported: null }
// An unmeasured item is null WITH A REASON: never the base (a check that subtracted no penalties
// because it examined nothing would score a perfect base — the vacuous pass), never 0 (which reads
// as measured-and-terrible).
// Declared `passthrough` fields the agent actually reported, under one `evidence` key — the
// denominators a finding is stated against and the item lists it is built from. Nested rather than
// spread, so an evidence field can never collide with `key`, `item`, `composite` or a component
// name. NO key at all when the check declared no passthrough or the agent reported none of it, so a
// caller without passthrough sees a byte-identical entry. Nothing here is read by any arithmetic:
// validating these fields in and then dropping them made the parameter unusable for what it was
// added for, since the evidence never reached the run's own report.
const evidenceOf = (check, r) => {
  const declared = Array.isArray(check.passthrough) ? check.passthrough : []
  if (!declared.length || !r) return null
  const out = {}
  for (const k of declared) if (r[k] !== undefined) out[k] = r[k]
  return Object.keys(out).length ? out : null
}
const withEvidence = (entry, evidence) => (evidence ? { ...entry, evidence } : entry)
const nullScores = (check, item, reason, r) => withEvidence({
  key: check.key,
  item,
  components: Object.fromEntries(check.components.map(c => [c.name, null])),
  composite: null,
  reason,
}, evidenceOf(check, r))
const scoreItem = (check, item, r) => {
  if (!r) return nullScores(check, item, 'agent died or was skipped', r)
  const n = r[ITEMS_CHECKED]
  if (!Number.isFinite(n) || n <= 0) {
    // Evidence survives an unscorable item: what the agent looked at is exactly what a reader needs
    // in order to tell "examined nothing" from "examined plenty and mis-reported one count".
    return nullScores(check, item, `${ITEMS_CHECKED} was ${n === undefined ? 'not reported' : JSON.stringify(n)} — nothing was measured, so no score is computable`, r)
  }
  for (const k of penaltyFields(check)) {
    // Number.isFinite rejects undefined, null, strings and NaN without coercing, so nothing below
    // can produce NaN: Math.max(0, NaN) is NaN and would print as a score, and a clamp spelled
    // `x < 0 ? 0 : x` would print 0, which is the measured-and-terrible reading.
    if (!Number.isFinite(r[k]) || r[k] < 0) return nullScores(check, item, `count field ${k} was not reported`, r)
  }
  const components = {}
  let composite = 0
  for (const c of check.components) {
    const score = Math.max(0, c.base - Object.entries(c.penalties).reduce((sum, [k, per]) => sum + per * r[k], 0))
    components[c.name] = score
    composite += c.weight * score
  }
  return withEvidence({ key: check.key, item, components, composite, itemsChecked: n }, evidenceOf(check, r))
}
const scoredLeg = async () => {
  if (!scoredJobs.length) return NO_SCORES
  const results = await parallel(scoredJobs.map(({ check, item }) => () =>
    agent(
      [
        AUTHORITY,
        '',
        `You are a COUNTING PROBE for scored check "${check.key}", item: ${item}. You are not a reviewer and you fix nothing.`,
        check.prompt,
        ...refLines(check.refs, JUDGE_REFS_INTRO),
        '',
        'Rules:',
        '- Report RAW COUNTS ONLY. You are not scoring anything and you have not been shown the weights, the base or the arithmetic — those live in the gate. A number you estimate rather than count is not a measurement.',
        `- ${ITEMS_CHECKED} is how many units you actually examined for THIS item. If you examined none, report 0; never report a count you did not obtain by looking.`,
        '- Every other field is a count of occurrences you observed: a non-negative integer, and 0 when you looked and found none.',
        '- Change nothing.',
      ].join('\n'),
      { label: `scored:${check.key}:${item}`, phase: 'Mechanical', schema: check.schema, ...optIf('model', probeModel),
        ...agentTypeOpt(reviewAgentType(check.agentType)) }
    )
  ))
  return {
    scores: scoredJobs.map(({ check, item }, i) => scoreItem(check, item, results[i])),
    scoresRun: scoredJobs.length,
    // What came back, not what was dispatched. scoresReported < scoresRun is how silence stays
    // legible without being fatal — those are separable, and this channel never gates.
    scoresReported: results.filter(Boolean).length,
  }
}
// Fail closed on the whole leg: every item is unreported rather than clean, and still not a gate.
const deadScoredLeg = () => (scoredJobs.length
  ? {
      scores: scoredJobs.map(({ check, item }) => nullScores(check, item, 'the scored leg failed, so it never reported')),
      scoresRun: scoredJobs.length,
      scoresReported: 0,
    }
  : NO_SCORES)

const thirdPartyLeg = async () => {
  if (thirdParty.length === 0) return []
  const results = await parallel(thirdParty.map(model => () =>
    agent(
      [
        AUTHORITY,
        '',
        `You are the ${model.toUpperCase()} REVIEW RUNNER. Your job is to run an external CLI reviewer over the working-tree changes and parse its result — you do not review the code yourself.`,
        `Read ${skillRoot}/references/third-party.md and follow the "${model}" section exactly: invocation, diff scoping, timeout, and parse rules.`,
        '',
        'Rules:',
        '- Run the CLI via Bash from the project directory. Modify no files.',
        '- STATUS BEFORE FINDINGS: if the CLI is missing, unauthenticated, or errors, return status=unavailable with empty findings. If it runs but you cannot extract discrete findings, return status=unparseable with the raw tail in raw. Only a successful, parsed run is status=reviewed.',
        '- Never invent findings the CLI did not produce. An empty findings list from a clean reviewed run is a valid answer.',
      ].join('\n'),
      { label: `third-party:${model}`, phase: 'Third-party', schema: THIRD_PARTY_SCHEMA, ...optIf('model', probeModel),
        ...agentTypeOpt(reviewAgentType()) }
    ).then(r => r || { model, status: 'unavailable', findings: [], raw: 'runner agent died or was skipped' })
  ))
  return results.filter(Boolean)
}

const [verifyOut, mechanicalOut, thirdPartyOut, priorFindingsOut, scoredOut] = await parallel([verifyLeg, mechanicalLeg, thirdPartyLeg, priorFindingsLeg, scoredLeg])
// Fail closed at the leg level too: if the whole verify leg died, no lens reported, so every lens
// is dead rather than clean.
const { verified, findings: lensFindings, lensesRun, lensesReported } = verifyOut || {
  // readOnly dispatched no verifiers, so there is nothing to fail closed on for tasks; the lens
  // dimension still fails closed below.
  verified: readOnly ? [] : activeTasks.map(t => ({ id: t.id, pass: false, evidence: '', failures: ['verify leg failed'] })),
  // Same identity synthesis as the in-leg site. Using the raw `l.key` here named an unkeyed lens
  // "undefined" and collapsed two of them into one selector entry, on the one path where EVERY lens
  // is dead — so the run that most needs its dimensions named was the one that could not name them.
  ...deadLensLeg(reviewLenses, 'the whole verify leg failed, so it never reported'),
}
// Fail closed once more: if the whole leg died, every declared check is a failure, not a pass.
const mechanical = mechanicalOut || mechanicalChecks.map(c => ({ name: c.name, exitCode: -1, output: 'mechanical leg failed' }))
const thirdPartyResults = thirdPartyOut || []
// Fail closed on the whole prior-findings leg too: if it died, nothing was refuted, so every prior
// finding stands. Empty when priorFindings is absent.
const priorJudged = priorFindingsOut || priorFallback()
// Fail closed on the scored leg too. It is NOT joined into `findings` and no conjunct below reads it:
// a scored value that reached the verdict would make an advisory channel a gate by the back door.
const scoredResult = scoredOut || deadScoredLeg()
const scores = scoredResult.scores
// One undifferentiated pool from here down: a surviving prior finding is gated EXACTLY like a
// surviving lens finding. With priorFindings absent this is a concat of [] and `findings` is
// byte-identical to the lens list.
const findings = [...lensFindings, ...priorJudged]

// ---------------------------------------------------------------- Gate (JS arithmetic — no agent asserts the verdict)
phase('Gate')
const allImplemented = carryForward(priorImplemented, implemented)
const allVerified = carryForward(priorVerified, verified)
const allRed = carryForward(priorRed, redResults)

// The task dimensions have THREE states, not two. Outside readOnly they are computed and are
// either clean or failing. Under readOnly no implementer and no verifier was dispatched, so they are
// NOT APPLICABLE — represented as null, never as an empty array. An empty array here would be
// indistinguishable from "computed and clean", which is the vacuous-pass defect (gate-laws L2a).
// ONE nullable fact, not one per dimension. null means "does not apply" (readOnly dispatched no
// implementers and no verifiers); an object means the dimensions were computed, and its arrays say
// what failed. A future mode adds a case here, not another ternary scattered down the file.
const taskDims = readOnly ? null : {
  notDone: allImplemented.filter(r => !r.done).map(r => r.id),
  missingImpl: taskList.filter(t => !allImplemented.some(r => r.id === t.id)).map(t => t.id),
  failedVerify: allVerified.filter(r => !r.pass).map(r => r.id),
  missingVerify: taskList.filter(t => !allVerified.some(r => r.id === t.id)).map(t => t.id),
  // The red gate owns a TASK, so it needs no selector channel of its own — these ids flow into
  // tasksThatFlagged and overallPass by the existing arithmetic. Both arrays are [] when no task
  // declares redCommand, so the union and the verdict are unchanged for every existing caller.
  redGateFailed: allRed.filter(r => r.verdict !== RED_VERDICT_OK).map(r => r.id),
  redMissing: redGatedAll.filter(t => !allRed.some(r => r.id === t.id)).map(t => t.id),
}
const surviving = findings.filter(f => !f.refuted)
const isBlocking = f => f.severity === 'critical' || f.severity === 'major'
// Under freezeFindingSet the blocking channel is the CARRIED set only: a surviving lens finding is
// residue — reported, never gating. `residue` is [] (and both keys absent from the return) without
// the flag, so survivingBlocking is byte-identical for every existing caller.
const residue = freezeFindingSet ? lensFindings.filter(f => !f.refuted && isBlocking(f)) : []
const survivingBlocking = (freezeFindingSet ? priorJudged.filter(f => !f.refuted) : surviving).filter(isBlocking)
// The JS reads the exit code; no agent asserts a mechanical pass. -1 (dead/skipped probe) fails here.
const mechanicalThatFailed = mechanical.filter(r => r.exitCode !== 0)

// Third-party results are deliberately absent from this arithmetic: advisory only.
// With mechanicalChecks absent, mechanicalThatFailed is [] and this reduces to exactly the five
// pre-existing conditions.
// The task conjunct is every taskDims dimension when they apply. Under readOnly they do not apply
// and contribute NOTHING to the verdict — they are not counted as satisfied conditions, they are
// removed from the arithmetic, and the score table reports them as n/a so no reader mistakes an
// undispatched dimension for a clean one.
// The task selector IS the task conjunct — derived, not computed a second time. Previously
// taskDimsClean (a conjunction) and tasksThatFlagged (a union) were two hand-maintained
// expressions over identical inputs; a guard added to one and not the other would let a run fail
// with an empty selector. Union-empty and every-dimension-empty are the same statement, so saying it
// once makes L3 true by construction for this channel rather than by the argument below — and a new
// dimension (redGateFailed/redMissing) joins both the verdict and the selector by adding one key.
// Under readOnly taskDims is null => [] => the conjunct is satisfied and contributes nothing.
const tasksThatFlagged = taskDims ? [...new Set(Object.values(taskDims).flat())] : []
const overallPass =
  tasksThatFlagged.length === 0 &&
  survivingBlocking.length === 0 &&
  mechanicalThatFailed.length === 0

// Three re-run selectors, one per dimension the gate can fail on. Every condition in overallPass
// above must land in at least one of them, or overallPass === false with an empty selector means
// "re-run everything" instead of "here is what to fix".
//   notDone / missingImpl / failedVerify / missingVerify -> tasksThatFlagged (re-run the TASK)
//   mechanicalThatFailed                                 -> re-run the CHECK, not a task
//   survivingBlocking                                    -> lensesThatFlagged (re-run the LENS)
// missingImpl/missingVerify are included here because a task whose implementer or verifier never
// reported is exactly a task that must be re-run; omitting them let a fail escape with an empty
// selector.
// Under readOnly the task channel is [] BY DESIGN, which is why the two remaining channels must
// cover every readOnly failure path. They do: the task conjunct is satisfied by an empty selector,
// so the only conjuncts that can make overallPass false are survivingBlocking (=> lensesThatFlagged,
// non-empty by the fallback below) and mechanicalThatFailed (=> itself, non-empty). L3 holds.
// Distinct lens keys of findings that survived refutation. A surviving finding has no owning task —
// it is fixed and then re-judged by re-running THAT LENS, not by re-implementing a task.
// survivingBlocking is a subset of surviving, so any gate failure from a blocking finding is covered.
// A surviving finding with no lens key is bucketed to UNATTRIBUTED in BOTH modes. It used to drop
// out of the selector outside readOnly, which made an unkeyed lens's finding produce FAIL with all
// three selectors empty — the state L3 says cannot occur and the docs told readers was impossible.
const lensesThatFlagged = [...new Set(surviving.map(f => f.lens || UNATTRIBUTED).filter(Boolean))]
const judged = readOnly
  ? 'read-only run: no tasks implemented or verified — the task dimensions are n/a, not clean'
  : onlyTasks ? `${activeTasks.length} of ${taskList.length} tasks re-judged this run; ${carried.length} carried from priorResults` : `all ${taskList.length} tasks judged this run`
const mechNote = mechanical.length ? `; mechanical ${mechanical.length - mechanicalThatFailed.length}/${mechanical.length} passed` : ''
// Silent when nothing is red-gated, so an existing caller's log line is unchanged.
const redFailed = allRed.filter(r => r.verdict !== RED_VERDICT_OK)
const redNote = !redGatedAll.length
  ? ''
  // Under readOnly nothing was probed, so "0/N proven" beside a PASS would read as N failures.
  : readOnly
    ? `; red gate n/a (readOnly — no probe dispatched for ${redGatedAll.length} red-gated task(s))`
    : `; red gate ${allRed.length - redFailed.length}/${redGatedAll.length} proven${redFailed.length ? ` (${redFailed.map(r => `${r.id}:${r.verdict}`).join(', ')})` : ''}`
// Silent when every lens reported, so a clean run's log is unchanged.
const lensNote = lensesReported < lensesRun ? `; ${lensesRun - lensesReported} of ${lensesRun} lenses did NOT report (counted as critical, not clean)` : ''
// Silent without the freeze, so an existing caller's log line is unchanged.
const freezeNote = freezeFindingSet
  ? `; finding set FROZEN — ${survivingBlocking.length} carried finding(s) still stand, ${residue.length} fresh blocking finding(s) held as residue`
  : ''
log(`gate: ${overallPass ? 'PASS' : 'FAIL'} — ${judged}${redNote}${mechNote}${lensNote}${freezeNote}`)

return {
  overallPass,
  verdict: overallPass ? 'PASS' : 'FAIL',
  scoreTable: {
    tasksTotal: taskList.length,
    // n/a (null), NOT 0. Under readOnly nothing was implemented or verified because nothing was
    // dispatched; rendering 0/0 next to real counts would read as "checked and clean".
    // Same three keys in BOTH modes, so a reader distinguishes exactly two states — null means the
    // dimension does not apply, a number means it was computed. (An earlier shape emitted four extra
    // null keys plus an explanatory string under readOnly only, which forced a consumer to tell null
    // from undefined from 0 across two different key sets. `judged` below carries the prose.)
    tasksJudgedThisRun: readOnly ? null : activeTasks.length,
    implementedDone: readOnly ? null : allImplemented.filter(r => r.done).length,
    verifyPassed: readOnly ? null : allVerified.filter(r => r.pass).length,
    // lensesRun is what was dispatched; lensesReported is what actually came back. When they differ,
    // the missing lenses did NOT review cleanly — each contributed a synthesized critical finding.
    lensesRun,
    lensesReported,
    // null on every run without scoredChecks, so an unscored run never reads as scored-and-clean —
    // never 0, which reads as "scored and clean". Neither appears in overallPass.
    scoresRun: scoredResult.scoresRun,
    scoresReported: scoredResult.scoresReported,
    // Counts the merged judged pool — lens findings PLUS any priorFindings. The name predates the
    // priorFindings channel and is kept for compatibility with existing consumers of scoreTable;
    // priorFindingsSubmitted/Surviving below break out the second source. Equal to the lens count
    // whenever priorFindings is absent, which is every pre-existing caller.
    lensFindings: findings.length,
    refuted: findings.length - surviving.length,
    survivingBlocking: survivingBlocking.length,
    // Counted from the severity, not as "everything left over": under freezeFindingSet the residue
    // is blocking-severity and out of survivingBlocking, and a subtraction would file it as minor.
    survivingMinor: surviving.filter(f => !isBlocking(f)).length,
    // Absent entirely without the flag, so the table is unchanged for every existing caller.
    ...(freezeFindingSet ? { residue: residue.length } : {}),
    // Absent entirely when no priorFindings were supplied, so the table is unchanged for every
    // existing caller. When they were, submitted-vs-surviving makes the refutation kill rate visible.
    ...(priorFindings.length
      ? {
          priorFindingsSubmitted: priorFindings.length,
          priorFindingsSurviving: priorJudged.filter(f => !f.refuted).length,
        }
      : {}),
    // Absent entirely when no task declares redCommand, so the table is unchanged for every existing
    // caller. redProven counts only the observed non-zero-then-zero pair; the three failure verdicts
    // are broken out because they mean different things to the fix loop.
    // Under readOnly no probe is dispatched and the verdict does not consult these, so they render
    // n/a like every other task dimension — a printed "redUnproven: N" beside "gate: PASS" is a
    // status derived from data the gate never blocked on.
    ...(redGatedAll.length
      ? readOnly
        ? { redGated: null, redProven: null, redUnproven: null, redNotRed: null, greenNotGreen: null }
        : {
            redGated: redGatedAll.length,
            redProven: allRed.filter(r => r.verdict === RED_VERDICT_OK).length,
            redUnproven: allRed.filter(r => r.verdict === 'red-unproven').length
              + redGatedAll.filter(t => !allRed.some(r => r.id === t.id)).length,
            redNotRed: allRed.filter(r => r.verdict === 'red-not-red').length,
            greenNotGreen: allRed.filter(r => r.verdict === 'green-not-green').length,
          }
      : {}),
    // 0/0 when mechanicalChecks is absent — the phase was skipped, nothing was checked and nothing passed.
    mechanicalRun: mechanical.length,
    mechanicalPassed: mechanical.filter(r => r.exitCode === 0).length,
    thirdPartyAdvisoryFindings: thirdPartyResults.reduce((n, r) => n + (r.findings ? r.findings.length : 0), 0),
  },
  judged,
  implemented: allImplemented,
  verified: allVerified,
  // Absent entirely when no task declares redCommand, so the return shape is unchanged for every
  // existing caller — same conditional idiom as the scoreTable red block. When present it is fed back
  // as priorResults.red so a carried task keeps its adjudication instead of re-reading as unproven.
  ...(redGatedAll.length ? { red: allRed } : {}),
  findings: surviving,
  // Absent entirely without freezeFindingSet. Blocking-severity lens findings raised THIS round that
  // the freeze excluded from the verdict: real, reported, and the input to a follow-up run's
  // priorFindings — never silently dropped.
  ...(freezeFindingSet ? { residue } : {}),
  refuted: findings.filter(f => f.refuted),
  thirdParty: thirdPartyResults, // ADVISORY — file as tasks with model attribution, never in the gate
  // [] when mechanicalChecks is absent: the phase was skipped, so there is nothing to re-run.
  mechanical,
  // ADVISORY, like thirdParty: one entry per (key, item) in dispatch order, each carrying the
  // JS-computed component scores and composite, or nulls with a reason. Craft emits no cross-item
  // mean or rank — combining items is the caller's business, and an average over a null item is the
  // vacuous number the null exists to prevent. [] when scoredChecks is absent. NOT a selector: these
  // cannot fail the run, so they add nothing to the three channels below.
  scores,
  // Three re-run selectors. With no tasks flagged, no mechanicalChecks and no surviving findings all
  // three are [].
  tasksThatFlagged,
  mechanicalThatFailed, // a failed check re-runs the CHECK, not a task
  lensesThatFlagged, // a surviving finding re-runs the LENS, not a task
}
