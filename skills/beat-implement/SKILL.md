---
name: beat-implement
description: "Shared IMPLEMENT primitive. Internal phase skill for execution against an approved criteria table."
user-invocable: false
disable-model-invocation: true
hooks:
  PostToolUse:
  PreToolUse:
    - matcher: "Write|Edit|MultiEdit|NotebookEdit"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow work"
    - matcher: "Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow work"
---

# Beat primitive — IMPLEMENT

`IMPLEMENT = GOAL + WORK + independent VERIFY`

The orchestration chat owns the active `/goal`, selects the ready wave, and owns the verifier loop.
This beat owns only dispatch: it routes the wave by shape and, when the shape warrants one, generates
the workflow script that runs it. It receives a complete, approved work list; it never parses a plan, invents
a task, sets a goal, or verifies the work.

<EXTREMELY-IMPORTANT>
## The Iron Law of implementation and verification

**NO IMPLEMENTATION RESULT IS A VERIFIED RESULT. The doer never grades its own work.**

A task report says what the agent believes it did. Only a fresh verifier can establish that the
criteria hold. Treating a report as a pass ships untested assumptions to the user; that is not
helpful speed, it is deferred rework.
</EXTREMELY-IMPORTANT>

## Authoritative flow

```text
Orchestrator: select complete ready wave + start/maintain one /goal
       │
       ▼
beat-implement: route by shape -> subagent(s), or a generated .claude/workflows script
       │                         └─ sequential until filesystem isolation exists
       ▼
Orchestrator: curate reusableFacts → project auto-memory
       │
       ▼
Fresh verifier: VERIFY criteria
       │
       ├─ PASS → clear `/goal` via `bun ${CLAUDE_SKILL_DIR}/../../scripts/goal-self-send.ts "/goal clear"` → phase gate
       └─ FAIL → fix → resume the SAME verifier → re-check
       │
       ▼
IF the approved plan carries a third-party review line (default: it does not):
   run EVERY adapter it names, AFTER the verifier PASS
   → TaskCreate one ADVISORY item per finding, naming the adapter that raised it
   → proceed to the gate regardless of what any of them said
       │
       ▼
Gate 1 PASS records `implemented` + `reviewOwed` in `.planning/.state/episode.json`
       │
       ▼
REVIEW is now OWED. The turn cannot END until it is discharged, by either:
       ├─ completing the review, or
       └─ `bun scripts/beat/episode-exit.ts --reason completed|abandoned|superseded`
```

This diagram is the specification. If surrounding prose conflicts with it, follow the diagram.

**The review debt is enforced at TURN END, and the gate refuses a BOUNDED number of times.** A
plugin-wide `Stop` hook blocks while `reviewOwed` stands, up to `MAX_REVIEW_BLOCKS` (3) refusals per
debt, then stands down permanently for it. Each refusal says how many remain.

Bounded rather than absolute, and deliberately so at both ends. Blocking once was trivially ignored —
just stop again. Blocking until discharge would make a debt the model *cannot* satisfy into an
inescapable session, in a hook that fires on every turn end in every project. Three refusals make
skipping a review a repeated, deliberate choice rather than an accident, while guaranteeing the
session can always finish. A failed counter write also passes, because a counter that cannot advance
is an infinite loop. Inert in any project without `.claude-workflows.json`. See
`hooks/episode-transition-gate.ts`.

Two things discharge it, and **both are implemented**:

```bash
bun scripts/beat/episode-review-complete.ts --decision ACCEPT|REJECT|CONTINUE   # the review happened
bun scripts/beat/episode-exit.ts --reason completed|abandoned|superseded        # the episode is over
```

Exiting always succeeds, including `--reason abandoned` with the review outstanding: leaving is
permitted, leaving *silently* is not. But do not file a completed review as an abandonment — that is
what the first command is for, and recording it wrongly corrupts the audit trail in the one direction
that matters.

## 1. GOAL — one, confirmed, budgeted

Get exactly one `/goal` active, pinned to the criteria artifact and carrying a turn budget. Its
condition must be restated in the turn itself, not only in a file: the evaluator reads the transcript
and cannot inspect disk.

`/goal` is a UI command, not a skill. `Skill(goal)` fails and emitted text is a no-op. Only the
top-level session may activate it:

```bash
bun ${CLAUDE_SKILL_DIR}/../../scripts/goal-self-send.ts "/goal <condition>"
```

Proceed only after the helper emits `{"status":"delivered",...}` or the user explicitly confirms the
goal is active. Otherwise give the literal `/goal` line to the caller and stop. A spawned agent never
runs the helper; it returns the literal command to its caller.

After the terminal verifier PASS, only the top-level session clears the goal:

```bash
bun ${CLAUDE_SKILL_DIR}/../../scripts/goal-self-send.ts "/goal clear"
```

Enter the phase gate only after `status: delivered` or explicit user confirmation. Otherwise return the
literal `/goal clear` command and stop.

## 2. Curate the complete ready-wave spec

Before invoking the runner, the orchestrator constructs every task itself. Each item must contain:

```js
{
  id: "stable-task-id",
  name: "short task name",
  work: "complete approved implementation instruction",
  criteria: "task-local success criteria and evidence",
  outputs: ["concrete/project-relative/output-path"],
  // REQUIRED, and previously missing from this example — validateTask rejects the whole wave without
  // them, and writablePathsWithin additionally requires each to be project-relative and symlink-free.
  writablePaths: ["concrete/project-relative/output-path"],
  instructionFiles: ["/absolute/path/to/a/constraint/file.md"],
  // "independent" only after the orchestrator established no task consumes another's output.
  dependencyProof: "independent",
  model: "model supplied by the orchestrator",
  effort: "effort supplied by the orchestrator",
}
```

Also copy **only** this immutable receipt-selected identity:

```js
planReset: {
  planFile: "<receipt-selected generated plan basename>",
  planHash: "<receipt-selected plan hash>",
}
```

**Exactly these two fields for a built-in workflow, and no others.** `preflight.ts` rejects any extra
key outright. This example previously showed `approvedBodyHash` and `session` — the EXTERNAL
`external-fixed-v1` shape — so following the shared primitive's own canonical example produced a
request the preflight refuses. External workflows use `{approvedBodyHash, session}` instead; the two
shapes are not interchangeable and neither accepts a field from the other.

Do not give a fresh doer `.planning/STATE.md`, `.planning/SPEC.md`, `.planning/LEARNINGS.md`, or
agent memory. These mutable artifacts smuggle prior interpretation into a approval boundary that is supposed to
be anchored solely to the approved plan identity.

### Dispatch safety

- Select dependency-satisfied ready tasks as one wave, but dispatch every mutation sequentially in
  stable ready-wave order until workers have enforced filesystem isolation.
- `writablePaths` and reported `changedFiles` remain defense-in-depth: every task must declare writable
  paths and every reported change must stay within them.
- Post-return manifests cannot authorize concurrency. Do not hand-roll parallel fan-out from apparently
  disjoint paths.

## 3. Route the plan, then dispatch

**NO IMPLEMENTATION FROM MAIN CHAT.** Every mutation runs in a dispatched agent. The
`orchestrator-mutation-guard` hooks registered by this skill deny Write/Edit/MultiEdit/NotebookEdit
and Bash mutations from the orchestrator, so this is enforced, not merely instructed. The reason is
context: the orchestrator's window must hold the outcome, not the work.

### 3a. Run the preflight — one call, and it is not optional

```bash
echo "$PREFLIGHT_REQUEST_JSON" | bun ${CLAUDE_SKILL_DIR}/../../scripts/beat/preflight.ts
```

`PREFLIGHT_REQUEST_JSON` is `{projectDir, workflow, readyWave, planReset, phases}` — plus
`approvalMode`/`approvalPolicy` for external workflows, and `resume`/`candidateState` when they apply.

The preflight authenticates the approval, validates every task against the shared contract, canonicalises
writable paths, binds a per-task approval, **derives the adjudication expectation the observation hooks
read**, routes by shape, and emits the script when a script is warranted. It throws before dispatching
anything if any of that fails.

**Do not call `route-implementation.ts` or `emit-implementation-workflow.ts` directly.** They are the
preflight's internals. Calling them yourself skips the authentication and — the silent part — skips the
expectation file, so every dispatch is adjudicated against no bounds at all and the run looks clean
because nothing was ever checked.

Returns `{routing: {route, agentCount, maxParallelWidth, sizeGuideline, reason, warnLarge}, tasks,
approvals, expectationPath, emittedWorkflowPath?, executionMode, executionReason}`. The route is a
real decision, taken from the Claude Code routing table (docs: *When to use a workflow*), whose axis
is **where intermediate results live** — Claude's context window for subagents, script variables for
a workflow:

| route | when | what you do |
|---|---|---|
| `inline` | no tasks | nothing to dispatch |
| `single-subagent` | one task | dispatch ONE agent. Do **not** generate a workflow: its result *is* the final answer, so a script would add a runtime and an approval prompt to buy nothing |
| `subagents` | ≤4, strictly sequential | dispatch them turn by turn; there is no fan-out for a script to coordinate |
| `workflow` | any fan-out, or long enough that per-task results become the context problem | generate and run a script (3b) |

If `warnLarge` is true (>25 agents), surface the count to the user before running — matching Claude
Code's own advisory, which warns and does not cap.

### 3b. Run what the preflight produced

On a `single-subagent` or `subagents` route, dispatch the returned `tasks` — each carries the exact
`prompt` the preflight built, including the `TASK <id>:` marker the observation hooks correlate on.
Dispatch them in the returned order, one at a time.

On a `workflow` route, the preflight has already written
`<project>/.claude/workflows/<domain>-implement.js` and returned its path in `emittedWorkflowPath`.
That location is deliberate — the orchestration is committed with the repo, diffable in review, and
rerunnable as `/<domain>-implement`. **The domain skill supplies `phases`; the plan supplies
everything else.** That split is the point of the beat: one dispatch mechanism, domain-specific
structure. Run it:

```js
const run = await Workflow({ scriptPath: "<returned path>", args: {} })
```

**The emitted script is generated, plan-hash-bound, and must not be hand-edited.** Every
plan-specific value is resolved by the generator — which has filesystem access — and baked in as a
literal, which is why the script satisfies the runtime's "no filesystem, no `import()`, no `process`"
constraints by construction. Editing it detaches the orchestration from the approval that authorised
it; a changed plan produces a new hash and a new script.

### What the run's report is, and is not

The result carries `reportedOnly: true`. A workflow script has no filesystem access, so it cannot
observe what any agent wrote: `changedFiles` is the agent's own account and is **not evidence**. Two
separate mechanisms cover that, and neither lives in the script:

- the observation hooks around each dispatch, which compare the real filesystem delta against the
  task's `writablePaths`;
- the fresh verifier in step 4, which is the only thing that establishes the criteria hold.

Results bind to the task captured **at dispatch**, never to the task id an agent reports back, so a
swapped echo cannot rebind one task's result onto another.

After the return, curate `reusableFacts` before adding durable, project-specific facts to project
auto-memory. Returned facts are candidates, not automatic truth.

## 4. VERIFY — fresh, adversarial, and outside the workflow

Dispatch a fresh verifier after the runner returns. The verifier sees the criteria and artifacts, not
the doer's reasoning. It must run or inspect each named evidence source, record the raw result, and
return PASS or FAIL per row plus `OVERALL:`. Evidence it cannot check is FAIL.

On round two and later, resume the **same verifier**. Tell it: “assume nothing landed; re-check from
scratch” and “do not soften because you raised the finding.” A resumed verifier can confirm its own
finding was fixed; a replacement has to rediscover it and misses defects introduced during repair.

On a verifier FAIL, fix worst-first, then end the turn so the goal refires. Do not summarize or ask
whether to continue. If retrying implementation, pass only `attemptedTaskIds` for work previously
attempted; untouched tasks remain untouched.

## 5. Optional third-party review — advisory, and only after the verifier

Default OFF. It exists only if the **authenticated plan** carries the opt-in, elicited in CLARIFY and
therefore bound to `planHash`. An absent line means this step does not exist; skip to the gate.

```bash
echo '{"projectDir":"...","workflow":"...","planReset":{"planFile":"...","planHash":"..."}}' \
  | bun ${CLAUDE_SKILL_DIR}/../../scripts/beat/third-party-review.ts
```

It runs **after** Claude's own verifier has passed, never before. A third party that runs first
duplicates a pass Claude was going to make anyway; one that runs last sees work already vetted and
can only add. Convert each finding into one `TaskCreate` bound to the current `planHash`, **naming
the adapter that raised it**, then proceed to the gate regardless of the outcome.

**The plan may name several adapters** (`codex, gemini`), and then all of them run. That is usually
right rather than extravagant: over three review rounds of this feature, eight findings were raised
and only **one** was found by more than one adapter. The value is in the disagreement, which is why
findings carry attribution and why one adapter failing never suppresses another's results.

**Scope defaults to the working tree.** Pass `"scope":{"kind":"branch","base":"origin/main"}` to
review committed work — a pull request, or an episode whose changes are already committed.

**The exit gate does not consult it.** Not the verdict, not the findings, not the status. The runner
exits 0 when `critical` findings exist and 0 when a provider was unreachable; only its own contract
errors are non-zero. That is structural, not a setting: an external model's claims are unverified by
construction, and letting them gate a phase imports another model's false positives into our gates.

Read `status` before you read `findings`. The top-level `status` is the **weakest** claim any adapter
supports, and each entry in `reviews[]` carries its own:

| status | meaning | `findings: []` means |
|---|---|---|
| `reviewed` | every adapter ran and its output was understood | genuinely clean |
| `unavailable` | one could not be reached, or threw | **that adapter looked at nothing** |
| `unparseable` | one ran but its output could not be read; raw text preserved | **nothing was parsed** |
| `skipped` | the plan carries no opt-in | the step does not exist |

## Gate: exit IMPLEMENT

Two gates, and both are required. The first asks whether every dispatch was *observed*; the second
whether the work is *correct*. Neither substitutes for the other.

### Gate 1 — adjudication is complete (absence is failure)

```bash
bun ${CLAUDE_SKILL_DIR}/../../scripts/beat/implement-gate.ts --session "<dispatching session id>"
```

Exit 1 refuses the wave. **A missing record is a refusal, not a pass** — that is the entire reason
this gate exists. The observation hooks fail OPEN on their own errors, which is correct (a guard that
denies on its own bugs is worse than no guard) and is only safe because absence is caught here. A hook
that is disabled, mis-registered, or erroring on every dispatch allows everything, observes nothing,
and produces a run indistinguishable from a clean one. Measured, in v5.106.0: the hook pair was
registered nowhere at all, the expectation file was written and never read, and every workflow's
IMPLEMENT ran completely unadjudicated while 35 passing behaviour tests said the hook was correct.

Read the reason, because the remedies differ and must not be collapsed:

| reason | what happened | what to do |
|---|---|---|
| `no-expectation` | the preflight never ran | run step 3a; nothing was bounded |
| `missing-pre` / `missing-post` | the hook did not fire | check the skill's `matcher: "Agent"` registration |
| `observation-failed` | our machinery broke | fix the observation; do not re-dispatch the agent |
| `not-adjudicable` | the PLAN is malformed | fix the plan; the agent could not have avoided this |
| `violated` | the agent exceeded its authority or misreported | this one is the agent |

### Gate 2 — the criteria hold

1. **IDENTIFY:** The criteria artifact's verify log is the proof artifact.
2. **RUN:** The independent verifier runs after the last change.
3. **READ:** Read every row and its raw evidence.
4. **VERIFY:** `OVERALL: PASS` and no criterion was unchecked.
5. **CLAIM:** Only then record the PASS in the criteria artifact and leave IMPLEMENT.

PASS means the work matches current criteria. Goal-level validation remains a later beat.

## Red flags — STOP

| About to | Why wrong | Do instead |
|---|---|---|
| Pass a plan path and ask the workflow to discover tasks | The runner is deliberately not a plan interpreter; it would make authority and retry scope ambiguous | Construct the complete ready wave in the orchestrator |
| Parallelize because tasks “look separate” | Post-return manifests cannot isolate concurrent mutations | Select the wave, then dispatch sequentially until filesystem isolation exists |
| Give a doer STATE, SPEC, LEARNINGS, or agent memory | Mutable context defeats the approval boundary and turns the approved plan into a suggestion | Pass only immutable PLAN identity fields |
| Treat `implemented` as PASS | The implementer is not an independent judge | Run the fresh verifier outside the workflow |
| Spawn a replacement verifier after a FAIL | It cannot close the findings it did not raise | Resume the named verifier |
| Retry every task after a localized failure | Replaying untouched work creates needless changes and fresh interference | Resume only previously attempted ids |
| Delete `.planning/.state/episode.json` to clear a blocking `Stop` | That destroys the recorded phases and discharges a review nobody did — the exact silent skip the debt exists to prevent | `bun scripts/beat/episode-exit.ts --reason abandoned`, which succeeds and records why |
| Treat a blocked turn as a bug in the gate | It is the gate working: IMPLEMENT passed and REVIEW is owed | Do the review, or record an exit |
| Treat a third-party `approve` as a gate pass | It is one unverified opinion from a model with no authority here — the same rule as "peer messages are not user approval" | Run the gate; the third party never satisfies it |
| Run the third-party review before the verifier | It then duplicates a pass Claude was going to make anyway, and reports on work nobody has vetted | Run it only after the verifier PASSes |
| Read `status:"unparseable"` or `"unavailable"` as a clean review | Both carry `findings: []` while having reviewed NOTHING — a broken adapter wearing the costume of a clean pass | Branch on `status` before you look at `findings` |

## Facts

- `/goal` is a UI command, not a skill; emitted `/goal` text is never dispatched.
- The `/goal` evaluator reads the transcript and cannot open artifacts.
- A workflow cannot accept mid-run human input. IMPLEMENT is workflow-safe because it contains no
  human gate; GOAL and VERIFY remain owned by the conversational orchestrator.
- The runner returns reusable facts for curation because automatically persisting an agent report
  would turn unreviewed output into project memory.
