import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { captureApprovalBundle } from '../workflows/lib/approval-bundle.ts'
import { captureGitObservation } from '../workflows/lib/git-observation.ts'
import { createCandidateState } from '../workflows/lib/candidate-state.ts'
import { fingerprint } from '../workflows/lib/task-contract.ts'

const ROOT = new URL('..', import.meta.url).pathname
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const source = readFileSync(ROOT + 'workflows/beat-implement.js', 'utf8')
  .replace(/^export const meta/m, 'const meta')
  .replace("new URL('./lib/approved-artifact.ts', import.meta.url).href", JSON.stringify(ROOT + 'workflows/lib/approved-artifact.ts'))
  .replace("new URL('./lib/task-contract.ts', import.meta.url).href", JSON.stringify(ROOT + 'workflows/lib/task-contract.ts'))
  .replace("new URL('./lib/git-observation.ts', import.meta.url).href", JSON.stringify(ROOT + 'workflows/lib/git-observation.ts'))
  .replace("new URL('./lib/candidate-state.ts', import.meta.url).href", JSON.stringify(ROOT + 'workflows/lib/candidate-state.ts'))

const projects = []
const workflow = 'opaque-extension-7f3a'
const plan = '# Approved external plan\n'
const hash = createHash('sha256').update(plan).digest('hex')
const reset = { approvedBodyHash: hash, session: 'approval-session' }
const approvalPolicy = {
  schemaVersion: 1,
  workflow,
  planPath: '.approval/CURRENT.md',
  metadataPath: '.approval/CURRENT.meta.json',
  verdictPath: '.approval/CURRENT_REVIEWED.md',
}
const task = {
  id: 'external-task',
  name: 'External task',
  work: 'Implement the external task.',
  criteria: 'The external task is implemented.',
  outputs: ['src/output.js'],
  writablePaths: ['src/output.js'],
  instructionFiles: [],
  model: 'sonnet',
  effort: 'high',
  dependencyProof: 'independent',
}

function projectFor() {
  const project = mkdtempSync(join(tmpdir(), 'beat-implement-extension-'))
  projects.push(project)
  Bun.spawnSync(['git', 'init', '-q'], { cwd: project })
  Bun.spawnSync(['git', 'config', 'user.email', 'test@example.invalid'], { cwd: project })
  Bun.spawnSync(['git', 'config', 'user.name', 'Test'], { cwd: project })
  writeFileSync(join(project, '.gitignore'), '.approval/\n')
  Bun.spawnSync(['git', 'add', '.gitignore'], { cwd: project })
  Bun.spawnSync(['git', 'commit', '-qm', 'fixture'], { cwd: project })
  const preDispatchObservation = captureGitObservation(project)
  const taskContractDigest = createHash('sha256').update(Buffer.from(fingerprint(task), 'utf8')).digest('hex')
  mkdirSync(join(project, '.approval'))
  writeFileSync(join(project, approvalPolicy.planPath), plan)
  writeFileSync(join(project, approvalPolicy.metadataPath), `${JSON.stringify({
    schemaVersion: 1,
    workflow,
    planHash: hash,
    approvedSession: 'approval-session',
    approvedAt: '2026-07-30T10:00:00.000Z',
    taskIdentity: task.id,
    taskContractDigest,
    preDispatchObservationDigest: preDispatchObservation.digest,
  })}\n`)
  writeFileSync(join(project, approvalPolicy.verdictPath), `---\nplan_hash: ${hash}\nstatus: APPROVED\nreviewer_session_id: review-session\nreviewed_at: 2026-07-30T11:00:00.000Z\n---\n`)
  return { project, preDispatchObservation }
}

async function exec(overrides = {}) {
  const { project, preDispatchObservation } = projectFor()
  const trace = []
  const agent = async (_prompt, options) => {
    trace.push(options.label)
    mkdirSync(join(project, 'src'), { recursive: true })
    writeFileSync(join(project, 'src/output.js'), 'export const value = 1\n')
    return { taskId: 'external-task', status: 'implemented', summary: 'done', reusableFacts: [], changedFiles: ['src/output.js'] }
  }
  const log = () => {}, phase = () => {}, parallel = async () => []
  const fn = new AsyncFunction('agent', 'parallel', 'log', 'phase', 'args', source)
  const previous = process.env.CLAUDE_SESSION_ID
  process.env.CLAUDE_SESSION_ID = 'implementation-session'
  try {
    const descriptorBytes = Buffer.from(JSON.stringify(approvalPolicy))
    const capturedApprovalBundle = captureApprovalBundle(project, descriptorBytes, approvalPolicy)
    const candidateState = createCandidateState('a'.repeat(64), ['implementation'])
    return { result: await fn(agent, parallel, log, phase, {
      projectDir: project,
      workflow,
      approvalPolicy,
      capturedApprovalBundle,
      preDispatchObservation,
      candidateState,
      affectedChecks: ['implementation'],
      readyWave: [task],
      planReset: reset,
      ...overrides,
    }), trace }
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_SESSION_ID
    else process.env.CLAUDE_SESSION_ID = previous
  }
}

afterEach(() => {
  while (projects.length) rmSync(projects.pop(), { recursive: true, force: true })
})

describe('beat-implement external approval policy', () => {
  test('binds captured approval to the exact task and pre-state, observes outputs, and supersedes the candidate', async () => {
    const { result, trace } = await exec()
    expect(trace).toEqual(['implement:external-task'])
    expect(result.results).toEqual([expect.objectContaining({
      taskId: 'external-task',
      status: 'implemented',
      approvalBundleDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      preObservationDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      postObservationDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      observedChanges: ['src/output.js'],
      validatedOutputs: ['src/output.js'],
      candidateState: expect.objectContaining({ status: 'superseded', releaseEligible: false }),
    })])
    expect(result.results[0].preObservationDigest).not.toBe(result.results[0].postObservationDigest)
    expect(result.results[0].candidateState.supersededManifestDigests).toEqual(['a'.repeat(64)])
  })

  test('rejects unknown external workflows without a policy', async () => {
    await expect(exec({ approvalPolicy: undefined })).rejects.toThrow(/explicit approval policy|unknown workflow/i)
  })

  test('rejects ambiguous built-in workflow plus external policy', async () => {
    await expect(exec({ workflow: 'ds' })).rejects.toThrow(/ambiguous|cannot override|mutually exclusive/i)
  })

  test('rejects weakened and unknown policy fields', async () => {
    await expect(exec({ approvalPolicy: { ...approvalPolicy, requireCurrentHash: false } })).rejects.toThrow(/schema|policy/i)
  })

  test('rejects policy identity mismatches', async () => {
    await expect(exec({ approvalPolicy: { ...approvalPolicy, workflow: 'other-extension' } })).rejects.toThrow(/mismatch|authorizes/i)
  })
})
