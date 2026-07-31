export const meta = {
  name: 'beat-implement',
  description: 'Shared IMPLEMENT dispatch runner. Receives a complete ready wave from its caller; it does not read plans or verify work.',
  whenToUse: 'Called by an implementation orchestrator after it has selected a complete ready wave and before the orchestrator dispatches its independent verifier.',
  phases: [
    { title: 'Dispatch', detail: 'flat, direct implementation-agent dispatch for the caller-supplied ready wave' },
    { title: 'Return', detail: 'structured task records and reusable facts for caller-owned verification and memory curation' },
  ],
}

// args = {
//   projectDir: "/absolute/project/path",             // REQUIRED
//   workflow: string,                                 // REQUIRED built-in or opaque external identity
//   approvalPolicy?: { schemaVersion, workflow, planPath, metadataPath, verdictPath }, // REQUIRED only for external workflows
//   readyWave: [{ id, name, work, criteria, outputs, model, effort }], // REQUIRED; complete, caller-curated work list
//   planReset: { approvedBodyHash, session }, // REQUIRED hash/session cross-check against separate metadata
//   resume?: { attemptedTaskIds: ["task-id", ...] },   // optional: re-dispatch ONLY previously attempted work
// }
function requiredWorkflowIdentity(value) {
  return typeof value === 'string' && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value)
}
let cfg = args
if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch { cfg = {} } }
cfg = cfg || {}
const PROJECT = cfg.projectDir
if (!PROJECT) throw new Error('beat-implement requires args.projectDir')
const BUILT_IN_WORKFLOWS = ['ds', 'writing', 'workshop', 'workflow-creator']
if (!requiredWorkflowIdentity(cfg.workflow) || (!BUILT_IN_WORKFLOWS.includes(cfg.workflow) && cfg.approvalPolicy === undefined)) {
  throw new Error('beat-implement requires args.workflow as ds, writing, workshop, workflow-creator, or an external workflow with explicit approval policy')
}
if (!Array.isArray(cfg.readyWave)) throw new Error('beat-implement requires args.readyWave as a complete task-spec array')

// Shared libraries own approval identity and task-contract validation.
const { parseApprovalPolicyDescriptor, validateApprovedArtifact, validateBuiltInImplementationApproval, validateCapturedApprovalBundle } = await import(new URL('./lib/approved-artifact.ts', import.meta.url).href)
const { concretePaths, enforceTaskOutputs, fingerprint, pathsOverlap, requiredText, validateTask, writablePathsWithin } = await import(new URL('./lib/task-contract.ts', import.meta.url).href)
const { captureGitObservation, compareGitObservations } = await import(new URL('./lib/git-observation.ts', import.meta.url).href)
const { failClosedCandidateState, markCandidateMutation, validateCandidateMutationConfiguration } = await import(new URL('./lib/candidate-state.ts', import.meta.url).href)
const { createHash } = await import('node:crypto')

const reset = cfg.planReset || {}
if (!requiredText(reset.approvedBodyHash)) throw new Error('beat-implement requires nonempty immutable planReset.approvedBodyHash')
if (!requiredText(reset.session)) throw new Error('beat-implement requires nonempty immutable planReset.session')
if (Object.keys(reset).some(key => !['approvedBodyHash', 'session'].includes(key))) throw new Error('beat-implement planReset accepts only approvedBodyHash and session')
if (cfg.approvalPolicy !== undefined) {
  if (BUILT_IN_WORKFLOWS.includes(cfg.workflow)) throw new Error('beat-implement built-in workflows cannot override approval policy')
  const policy = parseApprovalPolicyDescriptor(cfg.approvalPolicy, cfg.workflow)
  if (policy.code) throw new Error(`beat-implement ${policy.message}`)
}
let artifact = null
if (cfg.capturedApprovalBundle === undefined) {
  artifact = validateApprovedArtifact(PROJECT, cfg.workflow, process.env.CLAUDE_SESSION_ID, cfg.approvalPolicy)
  if (artifact.code) throw new Error(`beat-implement ${artifact.message}`)
  if (reset.approvedBodyHash !== artifact.hash || reset.session !== artifact.metadata.approvedSession) {
    throw new Error('beat-implement rejects caller planReset that differs from durable approved-plan metadata')
  }
}

const ids = new Set()
for (const task of cfg.readyWave) {
  if (!validateTask(task)) throw new Error(`beat-implement task violates the shared task contract: ${JSON.stringify(task)}`)
  if (!writablePathsWithin(PROJECT, task.writablePaths)) throw new Error(`beat-implement task writablePaths must remain below the canonical project root without symlinks: ${JSON.stringify(task.writablePaths)}`)
  if (ids.has(task.id)) throw new Error(`beat-implement readyWave has duplicate task id: ${task.id}`)
  ids.add(task.id)
}

const taskFingerprint = fingerprint

const attempted = cfg.resume?.attemptedTaskIds
const attemptRecords = cfg.resume?.attemptRecords
if (attempted !== undefined && !Array.isArray(attempted)) throw new Error('beat-implement resume.attemptedTaskIds must be an array')
if (attempted && !Array.isArray(attemptRecords)) throw new Error('beat-implement retry requires resume.attemptRecords from the preceding runner result')
function isPriorResult(record) {
  return record && typeof record === 'object'
    && requiredText(record.taskId)
    && requiredText(record.taskFingerprint)
    && record.approvedBodyHash === reset.approvedBodyHash
    && record.session === reset.session
    && ['implemented', 'blocked', 'failed'].includes(record.status)
    && typeof record.summary === 'string'
    && Array.isArray(record.reusableFacts)
    && record.reusableFacts.every(fact => typeof fact === 'string')
    && Array.isArray(record.changedFiles)
    && record.changedFiles.every(path => typeof path === 'string')
}
if (attemptRecords && !attemptRecords.every(isPriorResult)) throw new Error('beat-implement resume.attemptRecords must be complete records for this approved plan identity')
const priorAttempts = new Map((attemptRecords || []).map(record => [record.taskId, record]))
const attemptedIds = attempted ? new Set(attempted) : null
if (attemptedIds) {
  for (const id of attemptedIds) {
    if (!ids.has(id)) throw new Error(`beat-implement resume names task not in readyWave: ${id}`)
    const record = priorAttempts.get(id)
    if (!record || record.taskFingerprint !== taskFingerprint(cfg.readyWave.find(task => task.id === id))) {
      throw new Error(`beat-implement refuses retry without a matching prior record for task: ${id}`)
    }
  }
}
const tasks = attemptedIds ? cfg.readyWave.filter(task => attemptedIds.has(task.id)) : cfg.readyWave

function selectMode(tasks) {
  const hasOverlappingDeclarations = tasks.some((task, index) => tasks.slice(index + 1).some(other =>
    [...concretePaths(task.writablePaths)].some(left => [...concretePaths(other.writablePaths)].some(right => pathsOverlap(left, right)))))
  return {
    mode: 'sequential',
    reason: hasOverlappingDeclarations
      ? 'implementation dispatch is sequential because declared writable paths overlap'
      : 'implementation dispatch is sequential until workers have enforced filesystem isolation; post-return manifests cannot authorize concurrency',
  }
}

const RESULT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['taskId', 'status', 'summary', 'reusableFacts', 'changedFiles'],
  properties: {
    taskId: { type: 'string', description: 'Echo the assigned task id exactly.' },
    status: { type: 'string', enum: ['implemented', 'blocked', 'failed'] },
    summary: { type: 'string', description: 'Concise account of work completed or blocker encountered.' },
    reusableFacts: { type: 'array', items: { type: 'string' }, description: 'Durable, project-reusable facts only; caller curates these into auto-memory.' },
    changedFiles: { type: 'array', items: { type: 'string' }, description: 'Every project-relative file changed by this task.' },
  },
}

function promptFor(task) {
  // This approval identity is copied from separate PLAN.meta.json metadata by the caller. Mutable
  // planning state is deliberately excluded: no STATE, SPEC, LEARNINGS, or previous agent memory enters a new doer.
  return `You are the direct implementation agent for one already-approved task. Work only in ${PROJECT}.

TASK ${task.id}: ${task.name}
WORK:
${task.work}

SUCCESS CRITERIA:
${task.criteria}

DECLARED OUTPUTS:
${(task.outputs || []).map(output => `- ${output}`).join('\n') || '- None declared'}

EXCLUSIVE WRITABLE PATHS (your only authority to modify; include every changed file in changedFiles):
${(task.writablePaths || []).map(path => `- ${path}`).join('\n')}

REQUIRED INSTRUCTIONS — read every file before work; they are part of this task's contract:
${(task.instructionFiles || []).map(path => `- ${path}`).join('\n') || '- None supplied'}

IMMUTABLE APPROVAL IDENTITY (copied from PLAN.meta.json; do not infer or load mutable planning context):
- approved_body_hash: ${reset.approvedBodyHash}
- session: ${reset.session}

Read every REQUIRED INSTRUCTIONS file first, then implement the task and run the task-local evidence needed to support the criteria. You may modify only EXCLUSIVE WRITABLE PATHS. Do not parse or reinterpret PLAN.md; the caller already supplied this complete ready-wave spec. Do not perform final verification or grade the result; an independent verifier runs outside this workflow. Do not delegate. If you encounter a blocker requiring a decision, return status="blocked". If execution cannot complete, return status="failed". Return every modified project-relative path in changedFiles and only RESULT_SCHEMA.`
}

function contractDigest(task) {
  return createHash('sha256').update(Buffer.from(taskFingerprint(task), 'utf8')).digest('hex')
}

let candidateState = cfg.candidateState
const affectedChecks = cfg.affectedChecks
if (candidateState !== undefined) validateCandidateMutationConfiguration(candidateState, affectedChecks)
else if (affectedChecks !== undefined) throw new Error('beat-implement affectedChecks require candidateState')
let nextPreObservation = cfg.preDispatchObservation
async function run(task) {
  let pre
  let post
  let delta
  let approval = null
  let raw = null
  let dispatchError = null
  try {
    pre = captureGitObservation(PROJECT)
    if (nextPreObservation !== undefined && nextPreObservation.digest !== pre.digest) {
      throw new Error('pre-dispatch Git observation differs from the captured approved pre-state')
    }
    const approvalBinding = {
      taskIdentity: task.id,
      taskContractDigest: contractDigest(task),
      preDispatchObservationDigest: pre.digest,
      implementationSession: process.env.CLAUDE_SESSION_ID,
    }
    approval = cfg.capturedApprovalBundle !== undefined
      ? validateCapturedApprovalBundle(cfg.capturedApprovalBundle, cfg.workflow, approvalBinding)
      : validateBuiltInImplementationApproval(artifact, cfg.workflow, approvalBinding)
    if (approval.code) throw new Error(approval.message)
    if (approval.planDigest !== reset.approvedBodyHash || approval.approvalSession !== reset.session) {
      throw new Error('captured approval differs from immutable planReset identity')
    }
    try {
      raw = await agent(promptFor(task), {
        label: `implement:${task.id}`,
        phase: 'Implement',
        schema: RESULT_SCHEMA,
        model: task.model,
        effort: task.effort,
      })
    } catch (error) {
      dispatchError = error
    }
    try {
      post = captureGitObservation(PROJECT)
      delta = compareGitObservations(pre, post)
      nextPreObservation = post
    } catch (error) {
      if (candidateState) candidateState = failClosedCandidateState(candidateState, affectedChecks)
      throw new Error(`post-dispatch observation failed; candidate is release-ineligible: ${error instanceof Error ? error.message : String(error)}`)
    }
    const reportedChanges = Array.isArray(raw?.changedFiles) ? raw.changedFiles : []
    if (candidateState && (delta.changedPaths.length || reportedChanges.length)) {
      const declaredTargets = [...new Set(reportedChanges.filter(change => typeof change === 'string' && change.trim()))]
      candidateState = markCandidateMutation(candidateState, {
        declaredTargets,
        observedTargets: delta.changedPaths,
        affectedChecks,
      })
    }
    if (dispatchError) throw dispatchError
    const validatedOutputs = raw.status === 'implemented'
      ? enforceTaskOutputs(task, delta.changedPaths, reportedChanges)
      : (delta.changedPaths.length || reportedChanges.length ? enforceTaskOutputs(task, delta.changedPaths, reportedChanges) : [])
    const status = ['implemented', 'blocked', 'failed'].includes(raw.status) ? raw.status : 'failed'
    return {
      taskId: task.id,
      taskFingerprint: taskFingerprint(task),
      approvedBodyHash: reset.approvedBodyHash,
      session: reset.session,
      status,
      summary: String(raw.summary || ''),
      reusableFacts: Array.isArray(raw.reusableFacts) ? raw.reusableFacts.filter(fact => typeof fact === 'string' && fact.trim()) : [],
      changedFiles: [...delta.changedPaths],
      approvalBundleDigest: approval?.approvalBundleDigest,
      preObservationDigest: delta.preDigest,
      postObservationDigest: delta.postDigest,
      observedChanges: [...delta.changedPaths],
      validatedOutputs,
      candidateState,
    }
  } catch (error) {
    return {
      taskId: task.id,
      taskFingerprint: taskFingerprint(task),
      approvedBodyHash: reset.approvedBodyHash,
      session: reset.session,
      status: 'failed',
      summary: `Agent dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
      reusableFacts: [],
      changedFiles: delta ? [...delta.changedPaths] : [],
      approvalBundleDigest: approval?.approvalBundleDigest,
      preObservationDigest: delta?.preDigest || pre?.digest,
      postObservationDigest: delta?.postDigest,
      observedChanges: delta ? [...delta.changedPaths] : [],
      validatedOutputs: [],
      candidateState,
    }
  }
}

phase('Dispatch')
const selected = selectMode(tasks)
log(`beat-implement: ${tasks.length} task(s), ${selected.mode}: ${selected.reason}`)
const results = []
for (const task of tasks) results.push(await run(task))

const reusableFacts = results.flatMap(result => result.reusableFacts.map(fact => ({ taskId: result.taskId, fact })))
const counts = Object.fromEntries(['implemented', 'blocked', 'failed'].map(status => [status, results.filter(result => result.status === status).length]))

return {
  executionMode: selected.mode,
  executionReason: selected.reason,
  resumedAttemptedWorkOnly: !!attemptedIds,
  results,
  reusableFacts,
  counts,
}
