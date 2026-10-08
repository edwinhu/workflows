export const meta = {
  name: 'work',
  description: 'work loop core: sequential plan-bound implementation, blind verification for tasks no command settles; work-checks.sh runs every command, then ONE review lens (a farm row) over the digest, JS-computed gate',
  whenToUse: 'Invoked by the work skill after plan approval; never discovers authority — requires planPath + specHash + tasks as args.',
  phases: [
    { title: 'Implement', detail: 'one agent per task, in dependsOn waves (shared working tree); not opened at all under readOnly' },
    { title: 'Verify', detail: 'blind verifiers only for tasks with no acceptanceCmd, never under readOnly; the ONE review lens runs after the checks as a farm row of kind review — diagnose-and-route on red, one open-ended pass on green' },
    { title: 'Mechanical', detail: 'commands run by work-checks.sh (red after, acceptanceCmd, mechanicalChecks, red-suite re-hash); the JS reads the exit codes' },
    { title: 'Gate', detail: 'JS arithmetic over raw counts; the task dimensions are n/a under readOnly' },
  ],
}

// `meta` MUST be the first statement in the file, and its value must be a PURE LITERAL — no
// variables, no conditionals, no shared sub-objects. The harness parses it without running the
// script, so a `phases` computed from `args` is rejected outright and NOTHING in this file loads,
// readOnly or not. An earlier version hoisted a `READ_ONLY` const and five phase arrays above this
// block to advertise a mode-specific phase list; it made work unloadable in every mode and was
// caught only when a run finally invoked the harness for real, because every test until then had
// stubbed the hooks. Hence: one static list whose details name what readOnly changes, rather than
// lists chosen at parse time. `Implement` is advertised and then never opened on a readOnly run — a
// cosmetic cost, and the only shape the contract permits.

// ---------------------------------------------------------------- args (fail-closed)
// A large args object can reach the script JSON-encoded as a string; decode it or fail closed.
if (typeof args === 'string') {
  let decoded
  try { decoded = JSON.parse(args) } catch { decoded = undefined }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new Error(`work: args string did not parse to an object: ${args.slice(0, 120)}`)
  }
  args = decoded
}
if (!args || typeof args !== 'object') throw new Error('work: args object required')
const { projectDir, planPath, specHash, goal, tasks } = args
const attempts = Array.isArray(args.attempts) ? args.attempts : []
const attemptKeys = new Set()
for (const a of attempts) {
  if (!a.key || typeof a.key !== 'string') throw new Error('work: attempt missing key')
  if (attemptKeys.has(a.key)) throw new Error(`work: duplicate attempt key ${a.key}`)
  attemptKeys.add(a.key)
  if (!a.prompt || typeof a.prompt !== 'string' || !a.prompt.trim()) throw new Error(`work: attempt ${a.key} missing prompt`)
  if (!Array.isArray(a.refs)) throw new Error(`work: attempt ${a.key} refs must be an array`)
}
if (!projectDir) throw new Error('work: projectDir required')
if (!planPath) throw new Error('work: planPath required — the approved plan snapshot is the sole authority')
if (!/^[0-9a-f]{64}$/.test(specHash || '')) throw new Error('work: specHash must be the 64-hex sha256 of the plan\'s canonical work:dispatch spec')
if (!goal) throw new Error('work: goal required (one sentence + criteria from .work/<run>/goal.md)')
// readOnly (default false): audit an existing tree. No Implement phase, no per-task verifiers, and
// therefore no requirement that tasks[] be non-empty. When readOnly is false the tasks[] guard is
// exactly as it has always been.
// Read once, here, and referenced everywhere below — never re-derived from args a second time: two
// independent derivations of one fact drift the moment the mode grows a nuance, and nothing would
// catch the half-done change. (This is the sole derivation now; `meta` above cannot consult args.)
const readOnly = args.readOnly === true
// Where this skill is installed. Dispatch injects it (work-dispatch.sh knows $SKILL); the fallback
// is the stowed location, so a hand-built args object still names paths an agent can actually run.
// is `~/.claude/skills/workflows/skills/work` — tilde, not an absolute path, because the sandbox has no env access
// and a machine-specific literal would be wrong everywhere but one box. Both uses are prompt text a
// shell or an agent expands.
const skillRoot = args.skillRoot || '~/.claude/skills/workflows/skills/work'
if (!readOnly && (!Array.isArray(tasks) || tasks.length === 0)) throw new Error('work: tasks[] required')
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
// task.kind picks the implementer's entry in args.routing.kindModels; absent means judgement. Checked
// with or without a routing map, so a typo'd kind fails here rather than silently routing as judgement.
const TASK_KINDS = ['script', 'judgement', 'review', 'bulk']
for (const t of taskList) {
  if (!t.id || !t.name || !t.work || !t.acceptance) {
    throw new Error(`work: task missing id/name/work/acceptance: ${JSON.stringify(t)}`)
  }
  if (t.kind !== undefined && t.kind !== null && !TASK_KINDS.includes(t.kind)) {
    throw new Error(`work: task ${t.id}: kind must be one of ${TASK_KINDS.join('|')}: ${JSON.stringify(t.kind)}`)
  }
  if (t.redCommand !== undefined && t.redCommand !== null) {
    if (typeof t.redCommand !== 'string' || !t.redCommand.trim()) {
      throw new Error(`work: task ${t.id}: redCommand must be a non-empty string: ${JSON.stringify(t.redCommand)}`)
    }
    if (RED_COMMAND_OPERATORS.test(t.redCommand)) {
      throw new Error(
        `work: task ${t.id}: redCommand must be ONE INVOCATION — the shell operators ; & | \` $ > < ( ) { } and newlines are rejected: ${JSON.stringify(t.redCommand)}. ` +
        'Flags and quotes are fine (pytest tests/x.py -k "a or b"); a shell program is not. ' +
        'If the check genuinely needs several steps, put them in a script and name the script.'
      )
    }
  }
  // acceptanceCmd: the command whose exit code IS this task's acceptance. A task carrying one gets no
  // verifier agent — work-checks.sh runs it after the workflow returns and the gate reads the code.
  if (t.acceptanceCmd !== undefined && t.acceptanceCmd !== null) {
    if (typeof t.acceptanceCmd !== 'string' || !t.acceptanceCmd.trim()) {
      throw new Error(`work: task ${t.id}: acceptanceCmd must be a non-empty string: ${JSON.stringify(t.acceptanceCmd)}`)
    }
  }
  if (t.dependsOn !== undefined && t.dependsOn !== null) {
    if (!Array.isArray(t.dependsOn) || t.dependsOn.some(d => typeof d !== 'string' || !d.trim())) {
      throw new Error(`work: task ${t.id}: dependsOn must be an array of task id strings: ${JSON.stringify(t.dependsOn)}`)
    }
    if (t.dependsOn.includes(t.id)) throw new Error(`work: task ${t.id}: dependsOn cannot include itself`)
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
    if (!taskIds.has(d)) throw new Error(`work: task ${t.id}: dependsOn names unknown task id ${JSON.stringify(d)}`)
  }
}
// ── the carried finding set ──────────────────────────────────────────────────
// ONE pool, two doors. `carriedFindings` is what a previous round of THIS run left open and the
// redispatcher hands back; `priorFindings` is the same shape arriving from OUTSIDE the run (an agent
// team in main chat, a human's own read). They are merged here because the lens rules on them
// identically — open or closed, with evidence — and two pools would mean two code paths and two
// chances for one of them to stop gating.
//
// Nothing inside this file can discover them itself: the workflow dispatcher unions a fixed disallow
// list (["SendUserMessage", "Agent", "Workflow"]) into whatever agentType a leg names, so a workflow
// structurally lacks peer-to-peer discovery. They arrive as args or not at all.
//
// They are NOT trusted. The lens is shown each one and must rule it `closed` WITH EVIDENCE; silence
// leaves it OPEN, and a dead lens leaves every one of them open. That is the whole adjudication —
// there is no refuter leg any more, because the measured refuter corpus (2026-09-27/29) showed
// refutation changing 0 verdicts across the rounds it was run on.
const CARRIED_SEVERITIES = ['critical', 'major', 'minor']
// Validated at arg time, not mid-run: a malformed entry must fail before a single agent is dispatched.
const validateClaims = (list, argName) => {
  if (list !== undefined && !Array.isArray(list)) {
    throw new Error(`work: ${argName} must be an array of {title, severity, detail, file?, ownerTask?}: ${JSON.stringify(list)}`)
  }
  for (const f of Array.isArray(list) ? list : []) {
    if (!f || !f.title || !f.severity || !f.detail) {
      throw new Error(`work: ${argName} entry missing title/severity/detail: ${JSON.stringify(f)}`)
    }
    if (!CARRIED_SEVERITIES.includes(f.severity)) {
      throw new Error(`work: ${argName} entry severity must be one of ${CARRIED_SEVERITIES.join('|')}: ${JSON.stringify(f)}`)
    }
    if (f.id !== undefined && (typeof f.id !== 'string' || !f.id.trim())) {
      throw new Error(`work: ${argName} entry id must be a non-empty string when supplied: ${JSON.stringify(f)}`)
    }
  }
  return Array.isArray(list) ? list : []
}
const carriedIn = validateClaims(args.carriedFindings, 'carriedFindings')
const priorIn = validateClaims(args.priorFindings, 'priorFindings')
// An id is the handle the lens rules BY, so two findings sharing one would collapse into a single
// ruling — a closed verdict silently closing a finding nobody judged. Refused rather than renamed.
const explicitIds = [...carriedIn, ...priorIn].map(f => f.id).filter(Boolean)
for (const id of explicitIds) {
  if (explicitIds.filter(x => x === id).length > 1) {
    throw new Error(`work: carried finding id ${JSON.stringify(id)} appears more than once — an id is what the lens rules by, so duplicates collapse two findings into one ruling.`)
  }
}
const usedIds = new Set(explicitIds)
const mintId = stem => {
  let n = 0
  let id = `${stem}#${n}`
  while (usedIds.has(id)) id = `${stem}#${++n}`
  usedIds.add(id)
  return id
}
// Identity, provenance and ownership are settled HERE, once, so nothing downstream has to remember
// to default them. `source` records which door the claim came through; it is reported, never gated.
const carriedFindings = [
  ...carriedIn.map(f => ({ ...f, id: f.id || mintId('carried'), source: f.source || 'carried' })),
  ...priorIn.map(f => ({ ...f, id: f.id || mintId('prior'), source: f.source || 'prior' })),
]
// freezeFindingSet (default false): from round 2 on, the question is whether the CARRIED blocking
// set is closed, not whether this round's lens raised anything new. Fresh lens findings still run and
// are still reported — as `residue`, which gates nothing; only OPEN CARRIED findings gate. Without
// this the exit condition is a draw from a generator whose rate does not fall as fixes land.
// The one exception is the synthesized dead-lens critical: a review that did not happen is not a
// fresh finding to defer, it is the absence of the adjudication the freeze depends on (gate-laws L4).
const freezeFindingSet = args.freezeFindingSet === true
// Retired 2026-10-01: a lens on another provider gates, where the advisory runners only duplicated it.
// Refused on the KEY, not the value, so an empty list cannot carry a stale plan through.
for (const key of ['thirdParty', 'thirdPartyEffort']) {
  if (Object.prototype.hasOwnProperty.call(args, key)) {
    throw new Error(
      `work: ${key} is gone — the advisory third-party review runners were retired on 2026-10-01. ` +
      "Set lensProvider ('claude' | 'codex' | 'gemini') in the plan instead: the dispatcher resolves it " +
      "through route.ts to that provider's review candidate, so the cross-provider review runs as the lens and gates."
    )
  }
}
// ── the single review lens ───────────────────────────────────────────────────
// ONE lens, dispatched AFTER the per-task verifiers and the mechanical checks, over a digest of what
// they reported. Measured 2026-09-29/30: 4–10 parallel lenses plus one refuter per finding were 55%
// of the agents in a round and changed 0 verdicts, while a single Sonnet lens on one open-ended
// prompt re-found 7/7 reconstructed correctness defects.
const LENS_KEY = 'lens'
if (args.reviewLenses !== undefined) {
  throw new Error(
    'work: reviewLenses is gone. Pass a single `lens` object instead: ' +
    "{prompt, refs, agentType?, model? (default 'sonnet'), effort? (default 'high')}. " +
    'Merge the old lenses\' dimensions into that one prompt as a checklist — the lens runs after the ' +
    'tests and the mechanical checks, diagnoses every failure into routes[] on red, and makes one ' +
    'open-ended pass into findings[] on green. There are no refuters.'
  )
}
if (args.lens !== undefined && (!args.lens || typeof args.lens !== 'object' || Array.isArray(args.lens))) {
  throw new Error(`work: lens must be an object {prompt, refs, agentType?, model?, effort?}: ${JSON.stringify(args.lens)}`)
}
const DEFAULT_LENS_PROMPT = [
  'Judge the deliverable in the working tree against the APPROVED PLAN and the goal, along four dimensions:',
  '- CORRECTNESS: does what was built actually do what it claims, on the inputs it will see? Wrong results, unhandled cases, and logic that cannot hold are findings.',
  '- SPEC FIDELITY: does every task\'s acceptance criterion hold on the files themselves, and did the changes stay inside the plan\'s task table and writable paths? Out-of-scope edits, unrequested features and silently skipped plan items are findings.',
  '- TESTS: is each claim backed by a check that would FAIL if the claim were false? A test that passes against the defect it names, or an acceptance clause nothing exercises, is a finding.',
  '- METHODOLOGY: is the approach sound for what the plan set out to do, and does the evidence support the conclusion drawn from it?',
  'Severity: MAJOR at minimum for anything in those four; CRITICAL where the deliverable cannot stand without it.',
].join('\n')
const lensArg = args.lens || {}
const lens = {
  key: LENS_KEY,
  prompt: typeof lensArg.prompt === 'string' && lensArg.prompt.trim() ? lensArg.prompt : DEFAULT_LENS_PROMPT,
  refs: Array.isArray(lensArg.refs) ? lensArg.refs : [],
  agentType: lensArg.agentType || null,
  // Defaults, not inherits. The replay that justified one lens ran on sonnet at high effort, so those
  // are the settings the measurement covers; pass null to inherit the session's instead.
  model: lensArg.model === undefined ? 'sonnet' : (lensArg.model || null),
  effort: lensArg.effort === undefined ? 'high' : (lensArg.effort || null),
}
// Whole-deliverable mechanical checks: [{name, cmd}]. Optional; absent/empty skips the phase entirely.
const mechanicalChecks = Array.isArray(args.mechanicalChecks) ? args.mechanicalChecks : []
for (const c of mechanicalChecks) {
  if (!c || !c.name || !c.cmd) throw new Error(`work: mechanicalCheck missing name/cmd: ${JSON.stringify(c)}`)
}
// The shell side of the round. work-dispatch.sh runs every red-gated task's redCommand BEFORE launch
// (`redBefore`, by task id) and hashes the red suite (`redSuiteHashes`: every existing file a
// redCommand names — a directory only its test files — plus `redSuite`). work-checks.sh runs red-after, each acceptanceCmd, each
// mechanical cmd and the re-hash once the agents return, and hands the result back as `round`.
// No agent ever runs a command whose exit code decides the gate.
if (args.redSuite !== undefined && (!Array.isArray(args.redSuite) || args.redSuite.some(p => typeof p !== 'string' || !p.trim()))) {
  throw new Error(`work: redSuite must be an array of path strings: ${JSON.stringify(args.redSuite)}`)
}
const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v)
for (const key of ['redBefore', 'redSuiteHashes', 'round']) {
  if (args[key] !== undefined && args[key] !== null && !isPlainObject(args[key])) {
    throw new Error(`work: ${key} must be an object: ${JSON.stringify(args[key])}`)
  }
}
const redBefore = isPlainObject(args.redBefore) ? args.redBefore : {}
const round = isPlainObject(args.round) ? args.round : null
const ruleChecksArg = args.ruleChecks
let ruleChecks = null
if (ruleChecksArg !== undefined) {
  if (!ruleChecksArg || typeof ruleChecksArg !== 'object' || Array.isArray(ruleChecksArg)) {
    throw new Error(`work: ruleChecks must be an object {name, cmd, blockAt?}: ${JSON.stringify(ruleChecksArg)}`)
  }
  if (typeof ruleChecksArg.name !== 'string' || !ruleChecksArg.name.trim()) throw new Error('work: ruleChecks missing name')
  if (typeof ruleChecksArg.cmd !== 'string' || !ruleChecksArg.cmd.trim()) throw new Error('work: ruleChecks missing cmd')
  const b = ruleChecksArg.blockAt
  if (b !== undefined && (!Number.isFinite(b) || b <= 0 || b > 1)) throw new Error('work: ruleChecks blockAt must be a number in (0,1]')
  ruleChecks = {
    name: ruleChecksArg.name,
    cmd: ruleChecksArg.cmd,
    blockAt: b === undefined ? 0.85 : b
  }
}
// Optional scored checks: [{key, items, prompt, schema, components, refs?, agentType?}]. ADVISORY:
// nothing computed from them is read by overallPass, and there is deliberately no threshold — gating
// on a weighted composite chases minors rather than defects. The agent returns RAW COUNTS and the
// arithmetic below is work's, because an agent that reports its own score inflates it and one that
// never sees the formula cannot. Absent or [] means the leg dispatches nothing.
const scoredChecks = Array.isArray(args.scoredChecks) ? args.scoredChecks : []
const ITEMS_CHECKED = 'itemsChecked'
// A whitelisted count may not wear a score-shaped name, or the self-reported score walks back in
// under a count's cover.
const SCORE_NAME = /score|composite|rating|grade/i
const penaltyFields = s => new Set(s.components.flatMap(c => Object.keys(c.penalties)))
for (const s of scoredChecks) {
  if (!s || typeof s !== 'object' || !s.key || !s.prompt) {
    throw new Error(`work: scoredCheck missing key/prompt: ${JSON.stringify(s)}`)
  }
  const at = `scoredCheck ${JSON.stringify(s.key)}`
  if (!Array.isArray(s.items) || !s.items.length || s.items.some(i => typeof i !== 'string' || !i.trim())) {
    throw new Error(`work: ${at}: items must be a non-empty array of non-empty strings: ${JSON.stringify(s.items)}`)
  }
  if (!Array.isArray(s.components) || !s.components.length) {
    throw new Error(`work: ${at}: components must be a non-empty array of {name, weight, base, penalties}: ${JSON.stringify(s.components)}`)
  }
  for (const c of s.components) {
    if (!c || typeof c !== 'object' || !c.name) throw new Error(`work: ${at}: component missing name: ${JSON.stringify(c)}`)
    if (!Number.isFinite(c.weight) || !Number.isFinite(c.base)) {
      throw new Error(`work: ${at}: component ${c.name}: weight and base must be finite numbers: ${JSON.stringify(c)}`)
    }
    if (!c.penalties || typeof c.penalties !== 'object' || Array.isArray(c.penalties) || !Object.keys(c.penalties).length) {
      throw new Error(`work: ${at}: component ${c.name}: penalties must be a non-empty {countField: perUnit} object: ${JSON.stringify(c.penalties)}`)
    }
    for (const [k, per] of Object.entries(c.penalties)) {
      if (!Number.isFinite(per)) {
        throw new Error(`work: ${at}: component ${c.name}: penalty ${JSON.stringify(k)} must be a finite per-unit number: ${JSON.stringify(per)}`)
      }
    }
  }
  const props = s.schema && typeof s.schema === 'object' ? s.schema.properties : null
  if (!props || typeof props !== 'object' || Array.isArray(props)) {
    throw new Error(`work: ${at}: schema must be an object schema with a properties map: ${JSON.stringify(s.schema)}`)
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
    throw new Error(`work: ${at}: passthrough must be an array of schema field names: ${JSON.stringify(s.passthrough)}`)
  }
  for (const k of pass) {
    if (counts.has(k)) {
      throw new Error(`work: ${at}: ${JSON.stringify(k)} is declared both as a penalties key and as passthrough — a field either feeds a score or is evidence, never both.`)
    }
    if (!(k in props)) {
      throw new Error(`work: ${at}: passthrough names ${JSON.stringify(k)}, which the schema does not declare.`)
    }
  }
  for (const [k, def] of Object.entries(props)) {
    // A WHITELIST keyed on the NAME, refusing before it ever looks at the type. A blacklist keyed on
    // type:'number' plus a name pattern waves through {compositeScore: {type: 'integer'}}, and the
    // agent then reports the one number this parameter exists to compute in JS.
    if (k !== ITEMS_CHECKED && !counts.has(k) && !pass.has(k)) {
      throw new Error(
        `work: ${at}: schema field ${JSON.stringify(k)} is not "${ITEMS_CHECKED}", not a penalties key of any component (${[...counts].join(', ') || 'none declared'}), and not declared in passthrough. ` +
        'A scored agent returns RAW COUNTS ONLY and work computes every score; declare evidence fields in passthrough, and refuse anything else.'
      )
    }
    // Applied to passthrough too: the guarantee is that no agent supplies the number, and an evidence
    // field named `composite` would smuggle one straight past the count rules.
    if (SCORE_NAME.test(k)) {
      throw new Error(`work: ${at}: schema field ${JSON.stringify(k)} is score-shaped (/score|composite|rating|grade/i). Name the thing counted, not the number it feeds.`)
    }
    // Scored fields stay numeric with no nesting; passthrough may be any shape, since nothing computes on it.
    if (!pass.has(k) && (!def || typeof def !== 'object' || (def.type !== 'number' && def.type !== 'integer') || def.properties !== undefined)) {
      throw new Error(`work: ${at}: schema field ${JSON.stringify(k)} must be declared type number|integer with no nested properties: ${JSON.stringify(def)}`)
    }
  }
  if (!(ITEMS_CHECKED in props)) {
    throw new Error(`work: ${at}: schema must declare ${ITEMS_CHECKED} — it is what states how much was examined, and without it every item is unmeasured.`)
  }
  for (const k of counts) {
    // A penalty over a field the schema never declares contributes zero on every run, and a penalty
    // that never fires is indistinguishable from one that never applied.
    if (!(k in props)) {
      throw new Error(`work: ${at}: penalty ${JSON.stringify(k)} names a count field the schema does not declare (declared: ${Object.keys(props).join(', ')})`)
    }
  }
}
// One job per (check, item), in declaration order — scores are per item and never aggregated across
// items, so this list is also the order `scores[]` comes back in.
const scoredJobs = scoredChecks.flatMap(s => s.items.map(item => ({ check: s, item })))
// Optional: text appended to the AUTHORITY block every dispatched agent receives (implementers,
// verifiers, the lens, the probes). Absent => AUTHORITY is byte-identical to the four-line form.
const authorityExtra = typeof args.authorityExtra === 'string' && args.authorityExtra.trim() ? args.authorityExtra : null
// Optional agent-type overrides. Absent => no agentType key is passed to agent() at all, so the
// dispatcher's default applies exactly as before.
const implementerAgentType = args.implementerAgentType || null
const verifierAgentType = args.verifierAgentType || null
// Every call site spreads `...agentTypeOpt(X)`, which contributes no key at all when X is absent.
//
// Read-only agents by default. Under readOnly EVERY review leg — the lens row and the scored, attempt
// and rule probes — defaults to the Explore agent type, which structurally has no Edit
// and no Write tool. A prompt that says "modify nothing" is a request; an agent type is a boundary,
// and a readOnly run is exactly the case where the tree must not be touched. Precedence: an explicit
// lens agentType wins over this default.
// Outside readOnly the default does not apply at all — reviewAgentType(undefined) returns null,
// agentTypeOpt(null) contributes {}, and agent() receives NO agentType key whatsoever,
// byte-identical to before this change.
//
// Explore keeps Bash — a probe that cannot run its command is not a probe — while removing the tools
// an agent writes with by choice. RESIDUAL: `mechanicalChecks` cmds run VERBATIM in work-checks.sh,
// so a caller who passes a command that writes still writes; a readOnly charter must pass commands
// that only read.
const READ_ONLY_AGENT_TYPE = 'Explore'
const reviewAgentType = explicit => explicit || (readOnly ? READ_ONLY_AGENT_TYPE : null)
const agentTypeOpt = t => (t ? { agentType: t } : {})
// Optional refs: absolute paths the agent must Read in full. An absent or empty list contributes
// NOTHING to the prompt — not a blank line, not a heading.
const refLines = (refs, intro) =>
  Array.isArray(refs) && refs.length ? ['', intro, ...refs.map(p => `- ${p}`)] : []
const IMPL_REFS_INTRO = 'Domain rules governing this task. Read each of these files IN FULL before doing any work:'
const JUDGE_REFS_INTRO = 'The rules this judgement is made against. Read each of these files IN FULL before judging:'
// Per-leg model, highest first: (1) an explicit model in args, a non-empty string; (2)
// args.routing.kindModels — the implementer takes its task's kind (default judgement), the verifier
// and every probe take script, the lens takes review; (3) the defaults below. null or a missing key
// falls through. The dispatcher resolves the map through routing.json, because this file has no fs
// and agent() takes only a model id. A flag-form routing ({source:'flag'}) carries no kindModels.
const isModel = v => typeof v === 'string' && v.length > 0
const routingArg = args.routing && typeof args.routing === 'object' ? args.routing : {}
const kindModels = routingArg.kindModels && typeof routingArg.kindModels === 'object' && !Array.isArray(routingArg.kindModels)
  ? routingArg.kindModels : {}
const routedModel = (explicit, kind, fallback) =>
  isModel(explicit) ? explicit : (isModel(kindModels[kind]) ? kindModels[kind] : fallback)
// Probe model. A scored/rules probe RUNS A COMMAND and reports {name,
// exitCode, output}; the JS reads the exit code and no probe asserts a pass. There is no judgement to
// downgrade, so the session's top tier is spent on process supervision — and probes outnumber
// every other non-refuter leg. Default sonnet; pass null to inherit the session model.
const probeModel = routedModel(args.probeModel, 'script', args.probeModel === undefined ? 'sonnet' : (args.probeModel || null))
// A verifier judges ONE task against ONE stated acceptance criterion, with the criterion and the
// evidence both handed to it — bounded, like refutation, and one per task. Default sonnet.
const verifierModel = routedModel(args.verifierModel, 'script', args.verifierModel === undefined ? 'sonnet' : (args.verifierModel || null))
// Implementers default to INHERIT: they write the artifact the whole gate then judges.
const implementerModelFor = t => routedModel(args.implementerModel, t.kind ?? 'judgement', args.implementerModel || null)
// lensModel is the fallback for a lens that names no model of its own. The lens's own `model` key
// wins, and its documented default ('sonnet') is what the one-lens replay was measured on, so with
// no review model routed this dial only bites when the lens object omits `model` explicitly as null.
// With one routed, the order is lens.model, lensModel, kindModels.review.
const lensModel = args.lensModel || null
const lensLegModel = isModel(lensArg.model) ? lensArg.model
  : isModel(kindModels.review) ? (isModel(lensModel) ? lensModel : kindModels.review)
  : (lens.model || lensModel)
// Per-leg reasoning effort: null omits the key and inherits the session default. Implementers write
// the artifact the whole gate then judges, and xhigh is the documented level for long-horizon
// agentic coding. Verifiers judge ONE task against ONE criterion with the evidence handed to them —
// bounded, so they sit lower. The scored leg reports COUNT FIELDS and the JS computes the composite,
// so it has no judgement to downgrade.
const implementerEffort = args.implementerEffort === undefined ? 'xhigh' : (args.implementerEffort || null)
const verifierEffort = args.verifierEffort === undefined ? 'medium' : (args.verifierEffort || null)
const scoredEffort = args.scoredEffort === undefined ? 'low' : (args.scoredEffort || null)
const optIf = (k, v) => (v ? { [k]: v } : {})

// Fail closed on a dead lens. A lens agent that returns null contributes zero findings and zero
// carried rulings, which is byte-identical to a lens that reviewed and found nothing — the gate would
// certify the one review dimension there is, having never run it. Every other leg in this file
// already fails closed (verifier synthesizes pass:false, mechanical probes synthesize exitCode:-1);
// the lens synthesizes a critical finding, which flows into survivingBlocking → lensesThatFlagged →
// overallPass by the ordinary arithmetic. `syntheticDeadLens` is what exempts it from the
// freezeFindingSet residue bucket: a review that did not happen is not a fresh finding to defer.
const DEAD_LENS_TITLE = 'the review lens died or was skipped — no review ran this round'
const deadLensFinding = how => ({
  title: DEAD_LENS_TITLE,
  severity: 'critical',
  detail: `The review lens was dispatched but ${how}. Nothing judged this deliverable and nothing ruled on the carried findings, so its silence is not evidence of a clean result. Re-run the lens.`,
  lens: LENS_KEY,
  syntheticDeadLens: true,
})

const deadAttemptFinding = key => ({
  title: `[Dead Attempt: ${key}]`,
  severity: 'critical',
  detail: `The attempt ${key} was dispatched but died, returned null, or returned an empty answer.`,
  lens: LENS_KEY,
  syntheticDeadAttempt: true,
})

// Three states, not two. Absent (no key) => every task is active, exactly as before. A non-empty
// array => that slice. An EMPTY array => a ZERO-IMPLEMENTER round: mechanical checks and the lens
// re-run over a tree no implementer touched, which is what M2 dispatches once the plan itself has
// been amended. `.length` alone could not express the third state — it read [] as "no key".
const onlyTasks = Array.isArray(args.onlyTasks) ? new Set(args.onlyTasks) : null
const prior = args.priorResults || {}
const priorImplemented = Array.isArray(prior.implemented) ? prior.implemented : []
const priorVerified = Array.isArray(prior.verified) ? prior.verified : []
// Red evidence belongs to the exact command, not just the task id. Drop stale records before probe
// selection AND carry-forward, so a plan amendment cannot certify a command never observed failing.
const priorRed = (Array.isArray(prior.red) ? prior.red : []).filter(r =>
  r && taskList.some(t => isRedGated(t) && t.id === r.id && t.redCommand === r.command)
)
// A PROVEN red adjudication carried forward is not re-probed. M1: on a FULL re-run at round >= 2 the
// implementer has already made the command pass, so a second `before` probe observes exit 0 and the
// verdict is `red-not-red` — the run dead-ends on a task that is, in fact, fixed. A proven pair is
// evidence that was observed once; re-observing it after the fix can only destroy it.
const provenRedById = new Map(
  priorRed.filter(r => r && r.id && r.verdict === 'red-green').map(r => [r.id, r])
)

const activeTasks = onlyTasks ? taskList.filter(t => onlyTasks.has(t.id)) : taskList
// Which red-gated tasks still need a probe pair this round. Separate from isRedGated so the fan-out
// count, the dispatch decision and the carry-forward all read one predicate.
const needsRedProbe = t => isRedGated(t) && !provenRedById.has(t.id)

// ---------------------------------------------------------------- fan-out cap (fail-closed)
// SKILL.md has always carried a "~50 agents" ceiling, and it has always been PROSE — advice to the
// same agent that decides whether to follow it. That is not a cap. Observed 2026-08-07: a run read
// the line, computed 61, wrote "over the guideline", and dispatched anyway; lens findings then took
// it to 80. Sizing is the user's call at plan-approval time, so exceeding it has to stop the run and
// go back to them, exactly like a bad specHash does.
//
// The whole fan-out is now knowable up front: one lens, and no refuters. The unbounded term this
// paragraph used to warn about — one refuter per lens finding — is gone with the refuter leg, so the
// floor below is the actual count rather than a floor under an open-ended tail.
const MAX_AGENTS_DEFAULT = 50
const maxAgents = Number.isFinite(args.maxAgents) ? args.maxAgents : MAX_AGENTS_DEFAULT
// Agents only. A red probe, an acceptanceCmd, a mechanical check and ruleChecks are commands, and the
// shell runs them (work-dispatch.sh before launch, work-checks.sh after): none of them costs an agent.
// A task carrying acceptanceCmd needs no verifier — the command's exit code is its acceptance.
const verifiedByAgent = t => !t.acceptanceCmd
const fanOut = {
  implementers: readOnly ? 0 : activeTasks.length,
  verifiers: readOnly ? 0 : activeTasks.filter(verifiedByAgent).length,
  // ONE lens, always dispatched — including on a zero-implementer round, where it is the only
  // judgement there is. It runs as one farm.sh row after the checks, not inside this workflow.
  lens: 1,
  // Key omitted entirely without scoredChecks, so an existing caller's sizing error is unchanged.
  // Advisory agents still cost the same budget as gating ones.
  ...(scoredJobs.length ? { scored: scoredJobs.length } : {}),
  ...(attempts.length ? { attempts: attempts.length } : {}),
}
const fanOutFloor = Object.values(fanOut).reduce((a, b) => a + b, 0)
if (fanOutFloor > maxAgents) {
  throw new Error(
    `work: fan-out ${fanOutFloor} exceeds maxAgents ${maxAgents} — ${JSON.stringify(fanOut)}. ` +
    'This is a sizing decision and it belongs to the user at plan-approval time, not to the dispatcher. ' +
    'Split into sequenced work runs, cut tasks or checks in the plan and re-hash, or pass an explicit maxAgents.'
  )
}
if (onlyTasks && activeTasks.length === 0) {
  if (args.onlyTasks.length) throw new Error('work: onlyTasks matched none of tasks[]')
  // A zero-implementer round is legal ONLY when priorResults already carries every task. Without
  // that, `onlyTasks: []` would judge nothing and the task dimensions would read as clean against an
  // empty set — the vacuous-pass defect (gate-laws L2a) wearing the costume of a targeted re-run.
  // Under readOnly the task dimensions are n/a anyway, so there is nothing to carry.
  const uncarried = readOnly ? [] : taskList
    .filter(t => !priorImplemented.some(r => r.id === t.id) || !priorVerified.some(r => r.id === t.id))
    .map(t => t.id)
  if (uncarried.length) {
    throw new Error(
      `work: onlyTasks: [] is a ZERO-IMPLEMENTER round (mechanical checks and the lens re-run over a tree no implementer touches), ` +
      `but priorResults carries no implemented+verified record for ${JSON.stringify(uncarried)}. ` +
      'Every task must be carried, or those dimensions would read as clean against an empty set.'
    )
  }
}

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
        `work: dependsOn contains a cycle among ${JSON.stringify([...pending.keys()])} — ` +
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
              `work: tasks ${wave[i].id} and ${wave[j].id} would implement CONCURRENTLY but both claim ${JSON.stringify(a === b ? a : [a, b])} — ` +
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
// M1's other half. A task NOT re-probed this round keeps its carried adjudication even on a FULL
// re-run, where `carried` is [] and the ordinary carryForward would drop it — and a dropped proven
// pair re-reads as `redMissing`, which flags the task and dead-ends the loop on work already done.
const notReprobed = new Set(taskList.filter(t => isRedGated(t) && !needsRedProbe(t)).map(t => t.id))
const carryRed = live => [
  ...priorRed.filter(r => carried.some(t => t.id === r.id) || notReprobed.has(r.id)),
  ...live,
]

// ── taskFixes (M3) ───────────────────────────────────────────────────────────
// {taskId: [finding|route|string]} — what last round's review said this task must fix, rendered into
// THAT task's implementer prompt. M3: before this, carried findings reached only the refuters, so the
// one agent that could act on them was the one agent never shown them, and a round could "re-run T2"
// while T2's implementer had no idea why.
// An unknown task id THROWS rather than being ignored: a typo'd key would silently drop the fixes and
// the round would look identical to one with none, which is the failure this parameter exists to fix.
if (args.taskFixes !== undefined && (!args.taskFixes || typeof args.taskFixes !== 'object' || Array.isArray(args.taskFixes))) {
  throw new Error(`work: taskFixes must be an object keyed by task id: ${JSON.stringify(args.taskFixes)}`)
}
const taskFixes = args.taskFixes || {}
for (const [id, items] of Object.entries(taskFixes)) {
  if (!taskIds.has(id)) {
    throw new Error(`work: taskFixes names unknown task id ${JSON.stringify(id)} (declared: ${[...taskIds].join(', ') || 'none'}) — a typo here silently drops the fixes it was written to deliver.`)
  }
  if (!Array.isArray(items)) throw new Error(`work: taskFixes[${JSON.stringify(id)}] must be an array: ${JSON.stringify(items)}`)
}
// A fix item may be a finding, a route, or a plain string — whichever the previous round produced.
// Rendered, never interpreted: the implementer reads prose, so the only job here is to not lose a field.
const renderFix = x => {
  if (typeof x === 'string') return x
  if (!x || typeof x !== 'object') return JSON.stringify(x)
  const head = x.title || x.failure || x.id || 'unlabelled item'
  const where = x.file ? ` [${x.file}${x.line ? `:${x.line}` : ''}]` : ''
  const sev = x.severity ? ` (${x.severity})` : ''
  const body = [x.detail, x.cause, x.fix].filter(Boolean).join(' — ')
  return `${head}${sev}${where}${body ? `: ${body}` : ''}`
}
const FIX_FIRST_HEADING = 'FIX FIRST (from last round\'s review):'
const fixLines = t => {
  const items = Array.isArray(taskFixes[t.id]) ? taskFixes[t.id] : []
  return items.length ? ['', FIX_FIRST_HEADING, ...items.map(x => `- ${renderFix(x)}`)] : []
}

const AUTHORITY = [
  `AUTHORITY: The <!-- work:dispatch --> spec block inside ${planPath} is your ONLY authority; its specHash is ${specHash}.`,
  `Read the plan first and verify that hash (run: bash ${skillRoot}/scripts/work-dispatch.sh --spec-hash ${planPath}). If it differs, stop and report the mismatch as a failure — do not proceed.`,
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
// FOUR output channels, and the split is the point.
//   routes[]       — RED mode only: one entry per failure the checks already found, diagnosed and
//                    routed to the task that owns the fix (or to 'plan'). This is M1/M2: a failure
//                    attributable to no task forces a FULL re-run of everything.
//   findings[]     — GREEN mode: fresh defect claims from one open-ended pass.
//   carried[]      — BOTH modes: a ruling of open|closed, with evidence, on every carried finding.
//   dispositions[] — BOTH modes: "I checked X and it holds". Reported in full, never gated.
// Measured 2026-09-27 over 3,137 findings: 2.8% were lenses filing "satisfied / no violation found /
// no finding / recorded as a positive check" into `findings`, because `findings` was the only channel
// there was, and ~47 of those non-defects gated runs. The bug was never the judgement — it was that
// the schema had nowhere else to put a satisfied check. `dispositions` is that somewhere, and the
// text backstops below still route a misfiled one rather than gating on a true statement.
//
// The dispatched schema requires carried rulings and the active mode's channel; the other channel
// must be empty. An omitted review channel is not evidence of a clean review.
const OWNER_TASK_DESC = 'the id of the task that owns the fix, exactly as spelled in the plan\'s task table, or the literal string "plan" when NO task\'s writable paths can reach the fix (the plan itself must be amended). Never invent an id.'
const LENS_SCHEMA = {
  type: 'object',
  properties: {
    routes: {
      type: 'array',
      description: 'RED MODE ONLY. One entry per failure listed in the digest — every one of them, exactly once. This is a diagnosis, not a new review.',
      items: {
        type: 'object',
        required: ['failure', 'ownerTask', 'cause', 'fix'],
        properties: {
          failure: { type: 'string', description: 'the failure as the digest names it (task id, verifier failure, or mechanical check name) — quote it, do not paraphrase' },
          ownerTask: { type: 'string', description: OWNER_TASK_DESC },
          cause: { type: 'string', description: 'why it failed, from the evidence you read — not a guess' },
          fix: { type: 'string', description: 'what the owner must change' },
        },
      },
    },
    findings: {
      type: 'array',
      description: 'GREEN MODE. DEFECT CLAIMS ONLY. Every entry asserts something is wrong. A satisfied check belongs in dispositions.',
      items: {
        type: 'object',
        required: ['title', 'severity', 'file', 'detail', 'ownerTask'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          file: { type: 'string', description: 'repo-relative or absolute path, with NO :line suffix — the line goes in `line`' },
          line: { type: 'number' },
          detail: { type: 'string' },
          ownerTask: { type: 'string', description: OWNER_TASK_DESC },
          // The structural backstop. A lens that files a satisfied check here anyway can say so, and
          // the JS routes it to dispositions instead of gating the run on a true statement.
          defect: { type: 'boolean', description: 'false ONLY if this entry is not a defect claim — a satisfied check reported for completeness. Such an entry is moved to dispositions and never gates. Omit it (or set true) for a real defect.' },
        },
      },
    },
    carried: {
      type: 'array',
      description: 'A ruling on EVERY carried finding the digest lists, by its id. Both modes. A finding you do not rule on stays OPEN.',
      items: {
        type: 'object',
        required: ['id', 'status', 'evidence'],
        properties: {
          id: { type: 'string', description: 'the carried finding\'s id, verbatim from the digest' },
          status: { type: 'string', enum: ['open', 'closed'] },
          evidence: { type: 'string', description: 'what you read or ran that settles it. "closed" with no evidence is not a ruling.' },
        },
      },
    },
    dispositions: {
      type: 'array',
      description: 'Checks you performed that HOLD — "I looked at X and it is fine". No severity: a disposition is not a defect. These are reported to the user and never gated.',
      items: {
        type: 'object',
        required: ['title', 'detail'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          detail: { type: 'string', description: 'the evidence the check holds' },
        },
      },
    },
  },
}
// Backstop for a lens that used neither channel correctly: it filed a satisfied check as a finding
// and did not set defect:false. These ROUTE, they never delete — a matched entry lands in
// `dispositions`, which is reported in full, so a misrouted real defect is visible rather than gone.
//
// Deliberately narrow: both patterns require an EXPLICIT self-label ("— satisfied", "no violations
// found", "MODEL-EVALUATED (… not a defect)", "no finding", "recorded as a positive check"), not a
// cheerful-sounding title. Measured over all 3,137 findings in the 2026-09-27 corpus: 11 matches, all
// 11 genuine positive dispositions on manual read, 0 false matches, and all 5 of the study's
// hand-read direction-A examples caught. Widening these is a change that must be re-measured against
// that corpus, not an obvious improvement.
const DISPOSITION_TITLE_RE = new RegExp(
  // "no <up-to-3-words> violation/finding/drift/... found|detected|identified|observed"
  '(?:^|[\\s(\\[—:-])no\\s+(?:\\w+[\\s-]){0,3}(?:violation|finding|defect|issue|problem|drift|breach|regression|gap|discrepanc)\\w*\\b[^.]{0,60}?\\b(?:found|detected|identified|observed)\\b' +
  // a trailing "— satisfied" / ": no finding" / "— disposition supported" verdict clause
  '|(?:—|–|--|:)\\s*(?:satisfied|compliant|disposition\\s+supported|no\\s+finding|positive\\s+check|not\\s+a\\s+defect)\\s*$' +
  '|\\b(?:evidence-based|positive)\\s+disposition\\b',
  'i'
)
// A bare leading '^no finding|satisfied|compliant' alternative was tried and DROPPED: it matched the
// real defect title "No finding is recorded for D19, but the chain does not close" while adding no
// corpus hit. Removing it left the measurement unchanged at 11/3,137 with all five direction-A rows
// still caught — a self-label needs its verdict clause ("— satisfied", "found"), not just the word.
// Anchored to the OPENING of the detail (first ~200 chars), where a lens puts its self-label. Not
// anywhere in the body: a real defect's detail may well argue "this is not a defect in X, but in Y".
const DISPOSITION_DETAIL_HEAD_RE = new RegExp(
  '^[\\s\\S]{0,200}?(?:MODEL-EVALUATED\\s*\\([^)]{0,120}?\\bnot\\s+a\\s+(?:real\\s+)?defect\\b' +
  '|\\bno\\s+finding\\b|\\brecorded\\s+as\\s+a\\s+positive\\s+check\\b)',
  'i'
)
// Why this entry is not a defect claim, or null if it is one. The boolean the lens set wins over the
// text patterns: a structural signal beats a guess about wording.
const dispositionReason = f => {
  if (!f) return null
  if (f.defect === false) return 'the lens set defect:false on this entry — its own report says it is not a defect claim'
  if (DISPOSITION_TITLE_RE.test(f.title || '')) return 'the title self-labels a satisfied check rather than a defect (a gate cannot block on a true statement, so this would have failed the run for nothing)'
  if (DISPOSITION_DETAIL_HEAD_RE.test(f.detail || '')) return 'the detail opens by self-labelling this as not a defect (a gate cannot block on a true statement, so this would have failed the run for nothing)'
  return null
}
// A finding routed out of the gate, carried in `dispositions` with the severity it CLAIMED and the
// reason it was routed. Nothing is dropped and nothing is rewritten.
const routedDisposition = (f, why) => ({
  title: f.title,
  ...(f.file ? { file: f.file } : {}),
  detail: f.detail,
  lens: LENS_KEY,
  routedFromFinding: true,
  claimedSeverity: f.severity,
  routedBecause: why,
})
const ATTEMPT_SCHEMA = {
  type: 'object',
  required: ['key', 'answer'],
  properties: {
    key: { type: 'string' },
    answer: { type: 'string' },
  },
}
// ---------------------------------------------------------------- the lens leg (runs AFTER the checks)
// ONE lens, dispatched after the per-task verifiers and the mechanical checks have all reported,
// over a DIGEST of what they said. The order is the whole design: a reviewer that
// runs BESIDE the checks is guessing at what they will find, while one that runs after them can
// diagnose the failures they actually produced and say which task owns each.
//
// Two modes, decided by the JS from the digest and never by the lens:
//   RED   — a task flagged or a mechanical check failed. The lens diagnoses every failure into
//           `routes`, each carrying the ownerTask that must fix it. It does NOT hunt for new
//           defects: the run already has work to do, and a fresh finding on a red round is noise the
//           fix loop cannot act on until the red is cleared.
//   GREEN — everything passed. One open-ended pass into `findings`, each with an ownerTask.
// Both modes rule on every carried finding, by id, with evidence.
const MODE_RED = 'RED'
const MODE_GREEN = 'GREEN'
// Keep the last 60 lines end-to-end; a character cap in the probe would truncate evidence before
// the digest could apply its line limit.
const OUTPUT_TAIL_LINES = 60
const outputTail = s => {
  const lines = String(s == null ? '' : s).split('\n')
  return lines.length <= OUTPUT_TAIL_LINES ? lines.join('\n') : lines.slice(-OUTPUT_TAIL_LINES).join('\n')
}
const bullets = (heading, items) => (items.length ? ['', heading, ...items.map(s => `- ${s}`)] : [])
// The digest is the lens's whole input about the round, and it is assembled from the SAME arrays the
// gate reads — never from an agent's summary of them. A lens shown a paraphrase diagnoses the
// paraphrase.
const digestLines = d => [
  '',
  `MODE: ${d.mode}`,
  ...(d.mode === MODE_RED
    ? [
        'Something in this round FAILED. Your job is DIAGNOSIS AND ROUTING, not a fresh review.',
        '- Return one `routes` entry for EVERY failure listed below, exactly once. Read the evidence before you write the cause; a guess routed confidently costs a whole round.',
        '- `ownerTask` is the id of the task whose writable paths can reach the fix. Use the literal string "plan" ONLY when no task can — the plan must be amended to cover the path or reword the acceptance. A wrong id sends the fix to an agent that cannot make it; an unroutable failure re-runs every task in the plan.',
        '- Do NOT go looking for new defects this round. Leave `findings` empty.',
      ]
    : [
        'Every check in this round PASSED. Your job is ONE OPEN-ENDED PASS over the deliverable.',
        '- Judge what changed against the approved plan and report what you find in `findings`, each with an `ownerTask` (a task id, or "plan" when no task can reach the fix).',
        '- Leave `routes` empty: there is no failure to route.',
        '- An empty `findings` list is a valid and useful answer. Do not manufacture a finding to look thorough, and do not file a satisfied check as one.',
      ]),
  ...bullets('TASKS THIS ROUND FLAGGED (the gate already fails on these):', d.flaggedTasks),
  ...bullets('VERIFIER FAILURES (a blind verifier judged the acceptance criterion unmet):', d.verifierFailures),
  ...bullets('RED-GATE OUTCOMES (the test-first probe pair):', d.redOutcomes),
  ...(d.attempts && d.attempts.length
    ? [
        '',
        'BLIND ATTEMPTS:',
        'Grade each attempt against the key its own refs carry and file a failure as an ordinary finding or route with an ownerTask.',
        ...d.attempts.map(a => `[Attempt ${a.key}]\n${a.answer || '(no answer)'}`),
      ]
    : []),
  ...(d.mechanicalFailures.length
    ? ['', 'MECHANICAL CHECKS THAT FAILED — name, exit code, and the last '
        + `${OUTPUT_TAIL_LINES} lines of output:`,
       ...d.mechanicalFailures.flatMap(m => ['', `### ${m.name} — exitCode ${m.exitCode}`, outputTail(m.output)])]
    : []),
  ...bullets('RED-SUITE FILES CHANGED DURING THE ROUND (each is already a CRITICAL):', d.suiteChanges || []),
  ...bullets('RULE CHECKS THAT FAILED (p >= block-at, or the runner died):', d.rulesThatFailed),
  ...bullets('RULE CHECKLIST (advisory, ranked by p):', d.advisoryRules),
  ...(d.carried.length
    ? ['', 'CARRIED FINDINGS — rule on EVERY one of these in `carried`, by id:',
       ...d.carried.map(f =>
         `- id=${f.id} [${f.severity}]${f.ownerTask ? ` owner=${f.ownerTask}` : ''}${f.file ? ` (${f.file})` : ''} ${f.title}\n    ${f.detail}`),
       '',
       'A carried finding is CLOSED only when you can say what you read or ran that settles it. "closed" with no evidence is not a ruling, and a finding you do not rule on at all stays OPEN.']
    : []),
]

// The lens is NOT dispatched from this file: work-stage.mjs reads `lensSpec` from the digest stage
// and runs it as ONE farm.sh row of kind review, after work-checks.sh has run every command. The
// prompt and schema are built here so the digest the lens reads is the one the gate reads.
const lensSpec = digest => {
  const inactiveChannel = digest.mode === MODE_RED ? 'findings' : 'routes'
  const schema = {
    ...LENS_SCHEMA,
    required: ['carried', digest.mode === MODE_RED ? 'routes' : 'findings'],
    properties: {
      ...LENS_SCHEMA.properties,
      [inactiveChannel]: { ...LENS_SCHEMA.properties[inactiveChannel], maxItems: 0 },
    },
  }
  const prompt = [
    AUTHORITY,
    '',
    'You are the SINGLE READ-ONLY REVIEW LENS for this run. Nothing else reviews this deliverable, so a dimension you skip is a dimension nobody judged.',
    lens.prompt,
    ...refLines(lens.refs, JUDGE_REFS_INTRO),
    ...digestLines(digest),
    '',
    'Rules: modify nothing; cite files and lines; run read-only commands and quote their output as your evidence.',
    'Put a line number in the `line` field, NOT in `file`. A `file` of "src/a.go:135" matches no path in the plan\'s task table, so the fix loop cannot route it and re-runs everything.',
    'A FINDING IS A DEFECT CLAIM AND NOTHING ELSE. Every entry in `findings` must assert that something is WRONG. "I checked X and it holds", "constraint Y is satisfied", "no violation found", "recorded for completeness" — none of those are findings, and filing one as a finding fails the run on a true statement.',
    'Put every satisfied check in `dispositions` instead. It is REPORTED to the user in full, so the obligation to show what you examined is discharged there, not by inflating the findings list. If you must file a non-defect under `findings` anyway, set `defect: false` on it.',
  ].join('\n')
  return {
    label: LENS_KEY, kind: 'review', mode: digest.mode, prompt, schema,
    // Null means "inherit": the key is omitted, never passed as null to the farm row.
    ...(reviewAgentType(lens.agentType) ? { agentType: reviewAgentType(lens.agentType) } : {}),
    ...(lensLegModel ? { model: lensLegModel } : {}),
    ...(lens.effort ? { effort: lens.effort } : {}),
  }
}

// Returns {routes, findings, dispositions, carriedRulings, reported}. `reported: false` means the
// lens produced nothing — the caller synthesizes the critical, and every carried finding stays open.
const parseLens = review => {
  // A null (or non-object) result is a lens that never reported. An object with empty arrays is a
  // lens that ran and found nothing — only the first is `reported: false`.
  if (!review || typeof review !== 'object' || Array.isArray(review)) {
    return { routes: [], findings: [], dispositions: [], carriedRulings: [], reported: false }
  }

  // The two defect channels and the disposition channel, separated here. A lens's own `dispositions`
  // are taken as given; a satisfied check it filed under `findings` is ROUTED there instead of
  // gating. Nothing is deleted on either path — every entry is reported.
  const dispositions = []
  for (const d of review.dispositions || []) {
    if (d && d.title) dispositions.push({ title: d.title, ...(d.file ? { file: d.file } : {}), detail: d.detail, lens: LENS_KEY })
  }
  const findings = []
  for (const f of review.findings || []) {
    if (!f || !f.title) continue
    const why = dispositionReason(f)
    if (why) dispositions.push(routedDisposition(f, why))
    else findings.push({ ...f, lens: LENS_KEY })
  }
  const routes = (review.routes || []).filter(r => r && r.failure && r.ownerTask)
  const carriedRulings = (review.carried || []).filter(c => c && typeof c.id === 'string')
  return { routes, findings, dispositions, carriedRulings, reported: true }
}

// ---------------------------------------------------------------- red gate (executed, never self-reported)
// Both sides are run by a SCRIPT, not an agent: work-dispatch.sh runs `before` ahead of launch and
// work-checks.sh runs `after` once the implementers return. Neither is told which exit code is
// wanted, and no implementer reports its own RED (gate-laws L5).
const RED_VERDICT_OK = 'red-green'
// Fail closed on an absent probe: -1 on either side is `red-unproven`, never a pass (gate-laws L4).
// A missing side is unproven for the same reason — nothing observed the command there.
const redVerdict = (before, after) => {
  if (!before || !after || before.exitCode === -1 || after.exitCode === -1) return 'red-unproven'
  if (before.exitCode === 0) return 'red-not-red'
  if (after.exitCode !== 0) return 'green-not-green'
  return RED_VERDICT_OK
}

// What the shell runs this round. `round: {plan: true}` returns it before any agent is dispatched,
// so work-dispatch.sh probes red-before from this predicate rather than a copy of it in jq.
const checkPlan = {
  red: readOnly ? [] : activeTasks.filter(needsRedProbe).map(t => ({ id: t.id, command: t.redCommand })),
  acceptance: readOnly ? [] : activeTasks.filter(t => t.acceptanceCmd).map(t => ({ id: t.id, command: t.acceptanceCmd })),
  mechanical: mechanicalChecks.map(c => ({ name: c.name, cmd: c.cmd })),
  rules: ruleChecks ? [{ name: ruleChecks.name, cmd: ruleChecks.cmd }] : [],
}
if (round && round.plan === true) return { stage: 'plan', checkPlan, fanOut }

// ---------------------------------------------------------------- Implement (sequential: shared working tree)
// Skipped ENTIRELY under readOnly: the phase is not opened and no implementer agent is dispatched.
// A staged re-entry (`args.round`, see the barrier) replays the agents stage's records instead of
// dispatching anything: the digest and gate stages are pure arithmetic over what already came back.
const staged = round ? round.agents : null
if (round && (!isPlainObject(staged) || !Array.isArray(staged.implemented))) {
  throw new Error('work: args.round.agents must carry the agents stage\'s output (implemented, verified, …)')
}
const implemented = staged ? [...staged.implemented] : []
// Flat rather than a wrapping `if (!readOnly) { … }` whose body sat at the outer indent — the
// indentation then lied about the nesting. Same idiom the verify leg uses (`readOnly ? [] : …`):
// under readOnly the phase is never opened and the loop body never runs, so no agent is dispatched.
if (!readOnly && !staged) phase('Implement')
// One wave at a time; tasks WITHIN a wave concurrently. With no dependsOn there is exactly one wave
// and `parallel()` over it preserves array order in its results. The red bracket is no longer here:
// `before` ran in the dispatcher ahead of the whole round, `after` runs in work-checks.sh after it.
for (const wave of staged ? [] : IMPLEMENT_WAVES) {
  const outcomes = await parallel(wave.map(t => async () => {
  const r = await agent(
    [
      AUTHORITY,
      '',
      `You are the IMPLEMENTER for task ${t.id}: ${t.name}.`,
      `Work: ${t.work}`,
      `Writable paths (hard boundary — touch nothing outside them): ${(t.writablePaths || []).join(', ') || 'as specified in the plan for this task'}`,
      `Acceptance: ${t.acceptance}`,
      ...refLines(t.refs, IMPL_REFS_INTRO),
      // M3: what last round's review said this task must fix. Before this the carried findings
      // reached only the review legs, so the one agent that could act on them was the one agent never
      // shown them. Absent taskFixes contributes nothing — not a blank line, not a heading.
      ...fixLines(t),
      '',
      'Rules:',
      '- Leave changes in the working tree. Do NOT commit, push, or switch branches.',
      '- Prove acceptance: run the relevant command/check and paste its VERBATIM output as evidence.',
      ...(t.acceptanceCmd
        ? [`- After you return, a script runs \`${t.acceptanceCmd}\` from the project directory and its exit code alone decides acceptance — your report cannot substitute for it.`]
        : ['- A separate verifier will judge the files themselves without seeing this report — your report cannot substitute for the work.']),
      '- If blocked, set done=false and list blockers; do not loosen the acceptance to pass.',
    ].join('\n'),
    { label: `implement:${t.id}`, phase: 'Implement', schema: IMPL_SCHEMA, ...agentTypeOpt(implementerAgentType), ...optIf('model', implementerModelFor(t)), ...optIf('effort', implementerEffort) }
  )
  // The agent's own id is not evidence — this leg was dispatched for a known task, so stamp it.
  const record = r ? { ...r, id: t.id } : { id: t.id, done: false, changedFiles: [], evidence: '', blockers: ['agent died or was skipped'] }
  return { record }
  }))
  // parallel() resolves a throwing thunk to null; a null here would drop the task from `implemented`
  // and read downstream as "no such task" rather than "task failed" — fail closed on the task id.
  wave.forEach((t, i) => {
    const o = outcomes[i]
    implemented.push(o ? o.record : { id: t.id, done: false, changedFiles: [], evidence: '', blockers: ['implement leg threw or was dropped'] })
  })
}

// ------------------------------------------- Verify ∥ Scored ∥ Attempts (barrier, then the checks)
// Independent of each other, so one parallel group. The commands and the LENS come after: they read
// the tree these agents leave behind.
const verifyLeg = async () => {
  // Under readOnly the per-task verifier fan-out is skipped ENTIRELY — parallel() is not called and
  // no verifier agent is dispatched. `verified` is [] because nothing was judged, which is why the
  // gate marks the task dimensions n/a rather than reading [] as clean.
  const judged = readOnly ? [] : activeTasks.filter(verifiedByAgent)
  const perTask = readOnly ? [] : await parallel(judged.map(t => () =>
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
      { label: `verify:${t.id}`, phase: 'Verify', schema: VERIFY_SCHEMA, ...agentTypeOpt(verifierAgentType), ...optIf('model', verifierModel), ...optIf('effort', verifierEffort) }
    )
  ))
  // The agent's own id is not evidence — this leg was dispatched for a known task, so stamp it.
  const verified = perTask.map((v, i) => (v
    ? { ...v, id: judged[i].id }
    : { id: judged[i].id, pass: false, evidence: '', failures: ['verifier died or was skipped'] }))

  return verified
}

// ---------------------------------------------------------------- scored checks (counts in, scores computed HERE)
// One agent per item, one parallel group, fail closed per slot. What it does
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
        ...optIf('effort', scoredEffort), ...agentTypeOpt(reviewAgentType(check.agentType)) }
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

// ── the barrier ──────────────────────────────────────────────────────────────
// Five independent legs, one parallel group. The lens is NOT among them: it reads their results.
const attemptsLeg = async () => {
  if (attempts.length === 0) return []
  const results = await parallel(attempts.map(a => () =>
    agent(
      [
        AUTHORITY,
        '',
        a.prompt,
      ].join('\n'),
      {
        label: `attempt:${a.key}`,
        phase: 'Verify',
        schema: ATTEMPT_SCHEMA,
        refs: a.refs,
        ...optIf('model', a.model),
        ...optIf('effort', a.effort),
        ...agentTypeOpt(a.agentType || 'Explore'),
      }
    ).then(r => (!r || !r.answer ? { key: a.key, answer: null } : r))
  ))
  return results.map((r, i) => r || { key: attempts[i].key, answer: null })
}

const [verifyOut, scoredOut, attemptsOut] = staged
  ? [staged.verified, staged.scoredResult, staged.attempts]
  : await parallel([verifyLeg, scoredLeg, attemptsLeg])
const attemptsResult = attemptsOut || attempts.map(a => ({ key: a.key, answer: null }))
// Fail closed at the leg level: a dead verify leg means nothing judged the tasks, not that they passed.
const agentVerified = verifyOut || (readOnly
  ? []
  : activeTasks.filter(verifiedByAgent).map(t => ({ id: t.id, pass: false, evidence: '', failures: ['verify leg failed'] })))
// Fail closed on the scored leg too. It is NOT joined into `findings` and no conjunct below reads it:
// a scored value that reached the verdict would make an advisory channel a gate by the back door.
const scoredResult = scoredOut || deadScoredLeg()
const scores = scoredResult.scores

// ---------------------------------------------------------------- the round's stages (no shell in here)
// Every command a round runs — red after, acceptanceCmd, mechanicalChecks, ruleChecks, the red-suite re-hash — is
// run by work-checks.sh, because this sandbox has no shell and an agent wrapped around a command is a
// model asserting an exit code. So a round re-enters this file in three stages, keyed by args.round:
//   {plan: true}     -> PLAN:   no agent; checkPlan + fanOut for work-dispatch.sh's red-before
//   absent           -> AGENTS: implementers + verifiers dispatched; returns `checkPlan` for the script
//   {agents, checks} -> DIGEST: no agent; returns the digest and the ONE lens row's spec
//   {…, lens}        -> GATE:   no agent; the full result contract below
if (!round) {
  return {
    stage: 'agents',
    agents: { implemented, verified: agentVerified, scoredResult, attempts: attemptsResult },
    checkPlan,
    fanOut,
  }
}
const checks = isPlainObject(round.checks) ? round.checks : {}
const checkList = key => (Array.isArray(checks[key]) ? checks[key] : [])
// A command the script never reported is a command nobody ran: -1, never a pass (gate-laws L4).
const checkRecord = (key, match) => checkList(key).find(match) || null
const asExit = r => (r && Number.isInteger(r.exitCode) ? r.exitCode : -1)
// The {name, exitCode, stdout} record work-checks.sh wrote; missing or -1 fails closed below.
const ruleChecksOut = ruleChecks ? checkRecord('rules', r => r && r.name === ruleChecks.name) : null
const redResults = checkPlan.red.map(({ id, command }) => {
  const b = isPlainObject(redBefore[id]) ? redBefore[id] : null
  const a = checkRecord('red', r => r && r.id === id)
  const before = b ? { exitCode: asExit(b), output: String(b.output || '') } : null
  const after = a ? { exitCode: asExit(a), output: String(a.output || '') } : null
  return {
    id, command, verdict: redVerdict(before, after),
    beforeExit: before ? before.exitCode : -1, afterExit: after ? after.exitCode : -1,
    beforeOutput: before ? before.output : 'the dispatcher recorded no before-probe for this task',
    afterOutput: after ? after.output : 'work-checks.sh reported no after-probe for this task',
  }
})
const mechanical = mechanicalChecks.map(c => {
  const r = checkRecord('mechanical', x => x && x.name === c.name)
  return r ? { name: c.name, exitCode: asExit(r), output: String(r.output || '') }
    : { name: c.name, exitCode: -1, output: 'work-checks.sh reported no result for this check' }
})
// An acceptanceCmd task is judged by its exit code, recorded in the verifier's shape so every
// downstream reader (carry-forward, taskDims, the digest) is unchanged.
const commandVerified = checkPlan.acceptance.map(({ id, command }) => {
  const r = checkRecord('acceptance', x => x && x.id === id)
  const code = asExit(r)
  return code === 0
    ? { id, pass: true, evidence: `\`${command}\` exit 0`, failures: [], byCommand: true }
    : { id, pass: false, evidence: r ? outputTail(r.output) : '', failures: [r ? `\`${command}\` exit ${code}: ${outputTail(r.output).split('\n').slice(-5).join(' | ')}` : `\`${command}\` was never run (exit -1)`], byCommand: true }
})
const verified = [...agentVerified, ...commandVerified]
// The red suite is the tests a red gate trusts. An edited suite can turn any red green, so a hash
// change is a CRITICAL that no freeze defers, owned by the task whose writablePaths reach the file.
const suiteChanged = isPlainObject(checks.suite) && Array.isArray(checks.suite.changed) ? checks.suite.changed : []
const suiteFindings = suiteChanged.filter(c => c && c.path).map(c => ({
  title: `[Red suite modified] ${c.path}`,
  severity: 'critical',
  file: c.path,
  detail: `A file the red gate trusts changed during the round (sha256 ${c.before || 'absent'} -> ${c.after || 'absent'}). A red-green pair over an edited suite proves nothing.`,
  ownerTask: typeof c.owner === 'string' && c.owner ? c.owner : 'plan',
  lens: 'checks',
  syntheticSuiteChange: true,
}))

// ---------------------------------------------------------------- what the checks said (the lens's input)
// Computed BEFORE the lens, because the mode and the digest are derived from it. The gate below reads
// these same arrays — the lens never gets a paraphrase of a result the gate reads differently.
const allImplemented = carryForward(priorImplemented, implemented)
const allVerified = carryForward(priorVerified, verified)
const allRed = carryRed(redResults)

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
// The task selector IS the task conjunct — derived, not computed a second time. Previously
// taskDimsClean (a conjunction) and tasksThatFlagged (a union) were two hand-maintained expressions
// over identical inputs; a guard added to one and not the other would let a run fail with an empty
// selector. Union-empty and every-dimension-empty are the same statement, so saying it once makes L3
// true by construction for this channel. Under readOnly taskDims is null => [] => the conjunct is
// satisfied and contributes nothing.
const taskDimsFlagged = taskDims ? [...new Set(Object.values(taskDims).flat())] : []
// The JS reads the exit code; no agent asserts a mechanical pass. -1 (dead/skipped probe) fails here.
const mechanicalThatFailed = mechanical.filter(r => r.exitCode !== 0)

const rulesThatFailed = []
const ruleVerdicts = []
// A failed rule's candidate spans in the digest: enough to route and start a repair, not the whole list.
const RULE_SPANS_SHOWN = 12
if (ruleChecks) {
  let parsed = null
  let parseFailed = false
  if (!ruleChecksOut || asExit(ruleChecksOut) === -1) {
    parseFailed = true
  } else {
    try {
      parsed = JSON.parse(ruleChecksOut.stdout)
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.verdicts) || !Array.isArray(parsed.unavailable)) {
        parseFailed = true
      } else if (parsed.unavailable.length > 0) {
        parseFailed = true
      } else {
        for (const v of parsed.verdicts) {
          if (!v || typeof v.rule !== 'string' || !Number.isFinite(v.p) || typeof v.verdict !== 'string') {
            parseFailed = true
            break
          }
        }
      }
    } catch (e) {
      parseFailed = true
    }
  }

  if (parseFailed) {
    rulesThatFailed.push(`ruleChecks:${ruleChecks.name}`)
  } else {
    for (const v of parsed.verdicts) {
      const spans = Array.isArray(v.spans) ? v.spans.filter(x => typeof x === 'string') : []
      ruleVerdicts.push(spans.length ? { rule: v.rule, p: v.p, verdict: v.verdict, spans } : { rule: v.rule, p: v.p, verdict: v.verdict })
      if (v.p >= ruleChecks.blockAt) {
        rulesThatFailed.push(v.rule)
      }
    }
  }
}

// ---------------------------------------------------------------- the lens (one agent, after the checks)
// The mode is decided HERE, from the same arrays the gate reads — never by the lens, which would then
// be choosing how hard to be judged.
const lensMode = (taskDimsFlagged.length || mechanicalThatFailed.length || rulesThatFailed.length || suiteFindings.length) ? MODE_RED : MODE_GREEN
const dimReason = {
  notDone: 'the implementer reported done=false or never reported',
  missingImpl: 'no implementer record exists for it this round or in priorResults',
  failedVerify: 'its blind verifier judged the acceptance criterion unmet',
  missingVerify: 'no verifier record exists for it this round or in priorResults',
  redGateFailed: 'its test-first red gate did not return the red-then-green pair',
  redMissing: 'it declares a redCommand but carries no adjudication',
}
const digest = {
  mode: lensMode,
  flaggedTasks: taskDims
    ? Object.entries(taskDims).flatMap(([dim, ids]) => ids.map(id => `${id}: ${dimReason[dim] || dim} (${dim})`))
    : [],
  verifierFailures: allVerified
    .filter(v => !v.pass)
    .map(v => `${v.id}: ${(Array.isArray(v.failures) ? v.failures : []).join('; ') || 'no reason reported'}`),
  redOutcomes: allRed.map(r =>
    `${r.id}: ${r.verdict} (before exit ${r.beforeExit}, after exit ${r.afterExit}) — ${r.command || 'command not recorded'}`),
  mechanicalFailures: mechanicalThatFailed,
  suiteChanges: suiteFindings.map(f => `${f.file} (owner ${f.ownerTask}): ${f.detail}`),
  rulesThatFailed: rulesThatFailed.map(id => {
    if (id.startsWith('ruleChecks:')) return `${id} (check died, unparseable, or unavailable is non-empty)`
    const v = ruleVerdicts.find(x => x.rule === id)
    const at = v.spans ? ` at ${v.spans.slice(0, RULE_SPANS_SHOWN).join(', ')}${v.spans.length > RULE_SPANS_SHOWN ? ` (+${v.spans.length - RULE_SPANS_SHOWN} more)` : ''}` : ''
    return `${v.rule}: p=${v.p} — ${v.verdict}${at}`
  }),
  advisoryRules: ruleVerdicts.filter(v => v.p < (ruleChecks ? ruleChecks.blockAt : 1)).sort((a, b) => b.p - a.p).map(v => `${v.rule}: p=${v.p} — ${v.verdict}`),
  carried: carriedFindings,
  attempts: attemptsResult,
}
if (!('lens' in round)) return { stage: 'digest', mode: lensMode, digest, lens: lensSpec(digest) }
// null (missing or unparsable lens.json) is a lens that never reported — the dead-lens critical.
const lensLeg = parseLens(round.lens)
const lensResult = lensLeg && lensLeg.reported ? lensLeg : {
  routes: [],
  findings: [deadLensFinding('it produced no parseable result')],
  dispositions: [],
  carriedRulings: [],
  reported: false,
}
const lensReported = lensResult.reported
const lensFindings = [
  ...lensResult.findings,
  ...attemptsResult.filter(a => !a.answer).map(a => deadAttemptFinding(a.key)),
  ...suiteFindings,
]
const routes = lensResult.routes
// Satisfied checks the lens reported, plus any it filed as a finding and the backstop routed out.
// Deliberately absent from `findings` and from every conjunct in overallPass: a disposition asserts
// nothing is wrong, so a gate must not block on it.
const dispositionPool = lensResult.dispositions

// ---------------------------------------------------------------- Gate (JS arithmetic — no agent asserts the verdict)
phase('Gate')
// Carried rulings, applied fail-closed. FIRST ruling per id wins, so a lens that rules twice cannot
// close a finding by repeating itself. Three ways a carried finding stays OPEN: the lens never ruled
// on it, the lens ruled it closed with no evidence, and the lens never reported at all.
const rulingById = new Map()
for (const c of lensResult.carriedRulings) if (!rulingById.has(c.id)) rulingById.set(c.id, c)
const carriedRuled = carriedFindings.map(f => {
  const r = rulingById.get(f.id)
  if (!r) {
    return { ...f, status: 'open', evidence: lensReported
      ? 'the lens returned no ruling for this id — an unruled carried finding stays open'
      : 'the review lens never reported, so nothing ruled on this finding' }
  }
  const evidence = typeof r.evidence === 'string' ? r.evidence : ''
  if (r.status === 'closed' && !evidence.trim()) {
    return { ...f, status: 'open', evidence: 'the lens ruled this closed and supplied no evidence — a closed verdict with nothing behind it is not a ruling' }
  }
  return { ...f, status: r.status === 'closed' ? 'closed' : 'open', evidence }
})
const carriedOpen = carriedRuled.filter(f => f.status === 'open')

const isBlocking = f => f.severity === 'critical' || f.severity === 'major'
// The synthesized dead-lens critical is NOT a fresh finding: it is the absence of the adjudication
// the freeze depends on, so it gates in both modes (gate-laws L4). Separating it here is what keeps
// `freezeFindingSet` from deferring a review that never happened into residue.
// A red-suite change is the same kind of fact — observed by a script, not judged by the lens — so the
// freeze cannot defer it either; unlike the dead lens it names a file and an owner, so it routes.
const isSynthetic = f => f.syntheticDeadLens || f.syntheticDeadAttempt || f.syntheticSuiteChange
const deadLensBlocking = lensFindings.filter(isSynthetic)
const freshBlocking = lensFindings.filter(f => !isSynthetic(f) && isBlocking(f))
// Under freezeFindingSet the blocking channel is the CARRIED set only: a fresh blocking lens finding
// is residue — reported, never gating. `residue` is [] (and both keys absent from the return) without
// the flag.
const residue = freezeFindingSet ? freshBlocking : []
const survivingBlocking = [
  ...deadLensBlocking,
  ...carriedOpen.filter(isBlocking),
  ...(freezeFindingSet ? [] : freshBlocking),
]
// Everything that STANDS after this round: the lens's fresh findings (blocking or minor, residue
// included — frozen means "does not gate", not "not looked for") plus the carried findings still open.
// A closed carried finding is reported under `carried`, not here.
const findings = [...lensFindings, ...carriedOpen]

// ── routing (M1/M2: a failure attributable to nothing re-runs everything) ────
// A route names a failure the checks already found; a blocking finding names a defect that stands.
// Both carry an ownerTask, and that is what narrows the next round. An owner that is a real task id
// joins tasksThatFlagged; the literal "plan" goes to planFindings, which the redispatcher refuses to
// act on until the plan itself is amended and re-hashed.
const PLAN_OWNER = 'plan'
const ownerOf = x => (x && typeof x.ownerTask === 'string' ? x.ownerTask.trim() : '')
const routable = [
  ...routes.map(r => ({ kind: 'route', item: r })),
  // The dead-lens critical is excluded: it owns no task and names no defect in the deliverable — it
  // reports that the review did not run, which is fixed by re-running the lens, not by a task.
  ...survivingBlocking.filter(f => !(f.syntheticDeadLens || f.syntheticDeadAttempt)).map(f => ({ kind: 'finding', item: f })),
]
const routedTaskOwners = [...new Set(routable.map(x => ownerOf(x.item)).filter(o => taskIds.has(o)))]
const planFindings = routable.filter(x => ownerOf(x.item) === PLAN_OWNER).map(x => x.item)
// Named, not swallowed: an owner that is neither a task id nor "plan" narrows nothing, so the next
// round re-runs everything. The run still FAILS (the failure it describes is in another selector), but
// a reader has to be able to see why the re-run was not narrowed.
const unroutable = routable.filter(x => {
  const o = ownerOf(x.item)
  return o !== PLAN_OWNER && !taskIds.has(o)
})

// Three conjuncts, and every one of them has a selector below:
//   taskDims + routed owners -> tasksThatFlagged   (re-run the TASK)
//   mechanicalThatFailed     -> itself             (re-run the CHECK)
//   survivingBlocking        -> lensesThatFlagged  (re-run the LENS) + planFindings when owned by the plan
// Under readOnly the task channel is [] BY DESIGN, so the other two must cover every readOnly failure
// path — and they do, since those are the only conjuncts a readOnly run can fail on. L3 holds.
const tasksThatFlagged = [...new Set([...taskDimsFlagged, ...routedTaskOwners])]
const overallPass =
  tasksThatFlagged.length === 0 &&
  survivingBlocking.length === 0 &&
  mechanicalThatFailed.length === 0 &&
  rulesThatFailed.length === 0

// ONE lens, so this selector is a boolean wearing an array's clothes — kept as an array key because
// every consumer of a work result reads it as one, and because it is the channel that makes L3 true
// for a blocking finding no task owns. Blocking-only: a minor finding does not fail the gate, so it
// needs no re-run target.
const lensesThatFlagged = survivingBlocking.length ? [LENS_KEY] : []
const judged = readOnly
  ? 'read-only run: no tasks implemented or verified — the task dimensions are n/a, not clean'
  : onlyTasks ? `${activeTasks.length} of ${taskList.length} tasks re-judged this run; ${carried.length} carried from priorResults` : `all ${taskList.length} tasks judged this run`
const mechNote = mechanical.length ? `; mechanical ${mechanical.length - mechanicalThatFailed.length}/${mechanical.length} passed` : ''
// Silent when nothing is red-gated, so an existing caller's log line is unchanged.
const redFailed = allRed.filter(r => r.verdict !== RED_VERDICT_OK)
const redCarried = allRed.filter(r => notReprobed.has(r.id)).length
const redNote = !redGatedAll.length
  ? ''
  // Under readOnly nothing was probed, so "0/N proven" beside a PASS would read as N failures.
  : readOnly
    ? `; red gate n/a (readOnly — no probe dispatched for ${redGatedAll.length} red-gated task(s))`
    : `; red gate ${allRed.length - redFailed.length}/${redGatedAll.length} proven${redCarried ? ` (${redCarried} carried, not re-probed)` : ''}${redFailed.length ? ` (${redFailed.map(r => `${r.id}:${r.verdict}`).join(', ')})` : ''}`
// The lens leg, in one clause: which mode it ran in, and whether it reported at all.
const lensNote = lensReported
  ? `; lens ${lensMode}${routes.length ? `, ${routes.length} route(s)` : ''}${lensFindings.length ? `, ${lensFindings.length} finding(s)` : ''}`
  : '; the lens did NOT report (counted as a critical, not as clean)'
const planNote = planFindings.length ? `; ${planFindings.length} item(s) routed to the PLAN — amend it and re-hash, no task can fix them` : ''
const unroutableNote = unroutable.length
  ? `; ${unroutable.length} item(s) name no valid ownerTask (${[...new Set(unroutable.map(x => JSON.stringify(ownerOf(x.item))))].join(', ')}) — the next round cannot be narrowed`
  : ''
// Silent without the freeze, so an existing caller's log line is unchanged.
const freezeNote = freezeFindingSet
  ? `; finding set FROZEN — ${carriedOpen.length} of ${carriedFindings.length} carried finding(s) still open, ${residue.length} fresh blocking finding(s) held as residue`
  : carriedFindings.length ? `; ${carriedOpen.length} of ${carriedFindings.length} carried finding(s) still open` : ''
// Silent when the lens reported no satisfied check. When it did, the routed count is named: a
// non-zero routed count is a lens whose prompt is not landing, and it would otherwise be invisible
// behind a PASS.
const routedCount = dispositionPool.filter(d => d.routedFromFinding).length
const dispNote = dispositionPool.length
  ? `; ${dispositionPool.length} positive disposition(s) reported, not gated${routedCount ? ` (${routedCount} routed out of findings — the lens filed a satisfied check as a defect)` : ''}`
  : ''
log(`gate: ${overallPass ? 'PASS' : 'FAIL'} — ${judged}${redNote}${mechNote}${lensNote}${planNote}${unroutableNote}${dispNote}${freezeNote}`)

// RETURN CONTRACT (gate-laws L1 — this list, work/SKILL.md's param table, and the keys below must
// agree; work-result.sh's CONTRACT pins the required subset):
//   overallPass, verdict, scoreTable, judged, implemented, verified, red?, findings, carried,
//   routes, dispositions, residue?, mechanical, scores, attempts,
//   tasksThatFlagged, mechanicalThatFailed, lensesThatFlagged, planFindings, rulesThatFailed, ruleVerdicts
return {
  overallPass,
  verdict: overallPass ? 'PASS' : 'FAIL',
  scoreTable: {
    tasksTotal: taskList.length,
    attempts: attemptsResult.map(a => ({ key: a.key, reported: !!a.answer })),
    ...(ruleChecks ? { rulesThatFailed: rulesThatFailed.length, ruleVerdicts: ruleVerdicts.length } : {}),
    // n/a (null), NOT 0. Under readOnly nothing was implemented or verified because nothing was
    // dispatched; rendering 0/0 next to real counts would read as "checked and clean".
    tasksJudgedThisRun: readOnly ? null : activeTasks.length,
    implementedDone: readOnly ? null : allImplemented.filter(r => r.done).length,
    verifyPassed: readOnly ? null : allVerified.filter(r => r.pass).length,
    // ONE lens. `lensesRun` is always 1 and `lensesReported` is 1 or 0 — kept as the same two keys
    // rather than a boolean because every existing consumer reads the pair, and 1/0 says exactly what
    // n-of-m said: the review that was dispatched did not come back.
    lensesRun: 1,
    lensesReported: lensReported ? 1 : 0,
    lensMode,
    // null on every run without scoredChecks, so an unscored run never reads as scored-and-clean —
    // never 0, which reads as "scored and clean". Neither appears in overallPass.
    scoresRun: scoredResult.scoresRun,
    scoresReported: scoredResult.scoresReported,
    // Everything that stands: the lens's fresh findings plus the carried findings still open. The name
    // predates the one-lens change and is kept for the consumers that read it (converge-check.ts).
    lensFindings: findings.length,
    routes: routes.length,
    survivingBlocking: survivingBlocking.length,
    // Counted from the severity, not as "everything left over": under freezeFindingSet the residue
    // is blocking-severity and out of survivingBlocking, and a subtraction would file it as minor.
    survivingMinor: findings.filter(f => !isBlocking(f)).length,
    // The carried set's arithmetic, in the two numbers that say whether the loop is converging:
    // how many were handed to the lens, and how many it could not close. 0/0 when none were supplied.
    carriedSubmitted: carriedFindings.length,
    carriedOpen: carriedOpen.length,
    planFindings: planFindings.length,
    // Satisfied checks — the lens's other channel. NOT part of any conjunct above: a disposition is
    // the absence of a defect, so gating on one would gate on a true statement, which is the leak this
    // channel exists to close. `dispositionsRoutedFromFindings` is how many arrived as findings and
    // were routed out; a non-zero value means the lens prompt is not landing.
    dispositions: dispositionPool.length,
    dispositionsRoutedFromFindings: routedCount,
    // Absent entirely without the flag, so the table is unchanged for every existing caller.
    ...(freezeFindingSet ? { residue: residue.length } : {}),
    // Absent entirely when no task declares redCommand, so the table is unchanged for every existing
    // caller. redProven counts only the observed non-zero-then-zero pair; the three failure verdicts
    // are broken out because they mean different things to the fix loop.
    // Under readOnly no probe is dispatched and the verdict does not consult these, so they render
    // n/a like every other task dimension — a printed "redUnproven: N" beside "gate: PASS" is a
    // status derived from data the gate never blocked on.
    ...(redGatedAll.length
      ? readOnly
        ? { redGated: null, redProven: null, redUnproven: null, redNotRed: null, greenNotGreen: null, redCarried: null }
        : {
            redGated: redGatedAll.length,
            redProven: allRed.filter(r => r.verdict === RED_VERDICT_OK).length,
            redUnproven: allRed.filter(r => r.verdict === 'red-unproven').length
              + redGatedAll.filter(t => !allRed.some(r => r.id === t.id)).length,
            redNotRed: allRed.filter(r => r.verdict === 'red-not-red').length,
            greenNotGreen: allRed.filter(r => r.verdict === 'green-not-green').length,
            // Proven adjudications carried rather than re-observed (M1). Distinguishable from
            // redProven-this-round, because "we re-proved it" and "we trusted last round" differ.
            redCarried,
          }
      : {}),
    // 0/0 when mechanicalChecks is absent — the phase was skipped, nothing was checked and nothing passed.
    mechanicalRun: mechanical.length,
    mechanicalPassed: mechanical.filter(r => r.exitCode === 0).length,
  },
  judged,
  implemented: allImplemented,
  verified: allVerified,
  // Absent entirely when no task declares redCommand, so the return shape is unchanged for every
  // existing caller. When present it is fed back as priorResults.red so a carried task keeps its
  // adjudication instead of re-reading as unproven — and a PROVEN entry also tells the next round not
  // to re-probe that task at all (M1).
  ...(redGatedAll.length ? { red: allRed } : {}),
  findings,
  // EVERY carried finding with its ruling — closed ones included, which is what makes the next round's
  // carry a decision rather than a guess. Each entry keeps its id, severity and provenance and gains
  // {status, evidence}. [] when none were supplied.
  carried: carriedRuled,
  // RED-mode diagnoses: one per failure the checks found, each routed to the task that owns the fix.
  // [] on a GREEN round. This is the channel that narrows the next round instead of re-running it all.
  routes,
  // Blocking items whose owner is the PLAN, not a task: no task's writable paths can reach the fix, so
  // the plan must be amended and re-hashed. A selector channel of its own, because no task owns it.
  planFindings,
  // The lens's other channel, REPORTED IN FULL and never gated. One routed out of `findings` also
  // carries routedFromFinding/claimedSeverity/routedBecause, so a misrouted real defect is visible to
  // the human reviewer rather than deleted. [] when the lens reported no satisfied check.
  dispositions: dispositionPool,
  // Absent entirely without freezeFindingSet. Blocking-severity lens findings raised THIS round that
  // the freeze excluded from the verdict: real, reported, and the input to a follow-up run's
  // carriedFindings — never silently dropped.
  ...(freezeFindingSet ? { residue } : {}),
  // [] when mechanicalChecks is absent: the phase was skipped, so there is nothing to re-run.
  mechanical,
  // ADVISORY: one entry per (key, item) in dispatch order, each carrying the
  // JS-computed component scores and composite, or nulls with a reason. `work` emits no cross-item
  // mean or rank — combining items is the caller's business, and an average over a null item is the
  // vacuous number the null exists to prevent. [] when scoredChecks is absent. NOT a selector: these
  // cannot fail the run, so they add nothing to the channels below.
  scores,
  attempts: attemptsResult.map(a => ({ key: a.key, reported: !!a.answer })),
  // The re-run selectors. With no tasks flagged, no mechanicalChecks and no blocking finding standing,
  // all of them are [].
  tasksThatFlagged,
  mechanicalThatFailed, // a failed check re-runs the CHECK, not a task
  lensesThatFlagged, // ['lens'] iff a blocking lens finding stands
  rulesThatFailed,
  ruleVerdicts,
}
