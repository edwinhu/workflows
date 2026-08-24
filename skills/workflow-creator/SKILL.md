---
name: workflow-creator
description: 'Design, repair, or audit a multi-phase workflow. Use when the user says "create a workflow", "design a workflow", "scaffold a new workflow", "add a phase to this workflow", "improve/repair/redesign this workflow", "migrate this workflow", "audit this workflow", "why doesn''t my workflow''s gate work", "check this workflow''s gate", "the gate passes when it shouldn''t", or "/workflow-creator". Covers all three — fresh creation, corrective improvement, and read-only audit. Use proactively when a workflow''s gate looks vacuous or wc-probe reports CLEAN over nothing, even if the user never says "workflow". NEGATIVE ROUTING: a plain SKILL.md with no phases, no craft dispatch and no computed gate goes to skill-creator, not here — this skill owns the artifacts that pass parameters to craft''s workflow.js and are judged by wc-probe; plugin manifests, hooks wiring and multi-component scaffolding go to plugin-creator.'
argument-hint: 'the workflow to create, improve, or audit'
allowed-tools: [Bash, Read, Edit, Write, Grep, Glob, AskUserQuestion, EnterPlanMode, ExitPlanMode, Agent, Monitor]
hooks:
  PostToolUse:
    # Not widened to Bash — a Bash payload carries `command`, not the `file_path` this hook reads,
    # so the matcher alone would fire and validate nothing; the gate re-derives every check here.
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/skills/workflow-creator/scripts/validate-skill-write.ts"
---

# workflow-creator — a workflow is a set of parameters, not a program

This skill designs workflows. It does not carry its own lifecycle: the lifecycle is
[craft](${CLAUDE_PLUGIN_ROOT}/skills/craft/SKILL.md), and workflow-creator supplies the
domain — the CLARIFY axes, the lenses, the mechanical checks, the authority text.

Craft's mechanics live in craft and are stated **once**. Everything below is a **delta** against
them: where a phase has no domain variation, this file says so and adds nothing. Restating them
here is how they drift — this file has already shipped a stale copy of craft's Phase 3 once.

So craft is not something you are asked to go read. It is inlined here, in full, before you see
anything else:

---

!`cat ${CLAUDE_PLUGIN_ROOT}/skills/craft/SKILL.md`

---

**That was craft. Everything from here is the workflow-creator delta.**

**What a generated workflow is — read this before designing one.** A **skill that supplies
parameters to craft's `workflow.js`**. It does *not* ship a `workflow.js` of its own. The spine
already exists; a new workflow is a task table, a set of lenses, a set of mechanical checks, the
`refs` that carry its rules, and its `authorityExtra` — all passed to
`${CLAUDE_PLUGIN_ROOT}/skills/craft/workflow.js`. That is the whole deliverable, and this skill
is itself the worked example: it is a SKILL.md and nothing more.

Emitting a `.js` per workflow is how one shared spine quietly becomes N spines, one delegation at a
time. Delegation is already structural — a Workflow script has no Write tool and no shell — so a
generated workflow inherits that guarantee for free by *calling* craft rather than reimplementing
it, and needs almost no prose enforcement of its own.

**IRON LAW — wanting a `workflow.js` means craft is missing a parameter. Generalize craft first.**

The urge to write a domain `.js` is a signal, and it almost never points where it seems to. It says
the spine lacks a knob, not that this domain needs its own spine. So the first question is never
"how do I write this script?" — it is **"which craft parameter would make the script unnecessary?"**

This skill is the worked precedent. Porting it hit four moments that each felt like "I need a script
for this," and every one became a craft parameter instead:

| the urge | the parameter it became |
|---|---|
| "I need to run deterministic checks and gate on them" | `mechanicalChecks` — the agent runs the command, the JS reads the exit code |
| "my implementers need the domain's rules in front of them" | `tasks[].refs` / `reviewLenses[].refs` |
| "every agent needs to know one domain fact" | `authorityExtra` |
| "my reviewers must not be able to write" | `implementerAgentType` / `verifierAgentType` / per-lens `agentType` |

Four generalizations, zero new spines — and each one is now available to every other workflow,
which a private `.js` never would have been.

**Only after that question has a genuine answer of "none":** a domain `.js` is warranted when a
phase is a real fan-out with its own gate over its own index — expanding N outlines into prose,
rendering a spec into a deck — such that re-expressing it as task rows would *lose structure*.
Longer is not lost. Then the plan must record **which craft generalization was considered and why
it did not fit**, and the script is referenced as `{scriptPath: "<absolute path>"}`, never by bare
name. In that case
[`references/gate-laws.md`](${CLAUDE_PLUGIN_ROOT}/skills/workflow-creator/references/gate-laws.md)
governs the gate you are writing. Otherwise it still repays reading, because it describes the gate
you are *inheriting* — those laws are what craft's own gate is built to satisfy.

## Constraints, and the two ranks

A workflow is the **set of constraints** its output must satisfy, plus the machinery that decides
them. Constraints have two ranks, and **mechanical is first-best**: a command with an exit code —
deterministic, re-runnable, identical for every agent and every iteration. A **lens** is
second-best: a subagent's reading scored by craft's JS, the fallback for a constraint that is
genuinely judgement.

**The conversion duty.** Every lens stands under one question — *why is this not a command?* A lens
that flags the same shape twice is a lint rule nobody has written yet: write the rule, gate it
through the entry point, delete the lens. This skill's own `path-resolution` lens was exactly that,
and is now P1/P2/P4/P6.

**ONE mechanical entry point.** All of a workflow's mechanical checks are reachable from a single
command whose exit code is the whole mechanical verdict —
[`scripts/check.sh`](${CLAUDE_SKILL_DIR}/scripts/check.sh) here, one leg per check, none
short-circuiting. A list of N commands drops one silently and nothing reports a check it never knew
about; and craft re-runs a claimed mechanical pass in a shell (`craft-result.sh`), which is
affordable for one command and not for N. **P10** refuses a second `mechanicalChecks` entry; a
genuine exception is declared with `<!-- wc-probe: ignore-entry-point -->`.

**A generated workflow declares its own check entry point.** `check.sh` gates workflow *artifacts* —
probe, parity, node-check, probe suite — and is not a generated workflow's domain gate. A workflow
whose domain has a toolchain (build, test, lint, render) ships one entry point of its own, collects
those legs behind it, and names *that* in its `mechanicalChecks`. The law binds the workflow being
generated, not only its generator.

## Branch first

| The user wants | Branch | What runs |
|---|---|---|
| a workflow that does not exist yet | **new** | the full craft loop (Phases 1-5) |
| an existing workflow fixed, redesigned, migrated, or given feedback | **improve** | the full craft loop, seeded by a probe run as planning evidence |
| to know what is wrong with an existing workflow, changing nothing | **audit-only** | the same craft loop with `readOnly: true` and `tasks: []`, seeded by a charter plan |

**Audit-only is a `readOnly` craft run, not a second lifecycle.** Craft grew `readOnly` on
2026-08-07: under it no Implement phase is opened, no implementer and no per-task verifier is
dispatched, `tasks[]` may be empty, and **every dispatched leg defaults to `Explore`** — lenses,
refuters, the mechanical probes and the third-party runners alike. `Explore` has no Edit and no
Write, so no agent on a `readOnly` run can write *of its own volition*.

**The residual is `Bash`, which `Explore` keeps**, and the exceptions are an OPEN list, not a closed
one: a `mechanicalChecks` `cmd` runs verbatim; any reference craft tells a leg to follow can instruct
a write; `authorityExtra` and lens prompts are caller free text on every leg. The agent type pins
volition, never instruction — so everything a `readOnly` charter hands a leg must itself be
read-only.

Routing an audit through the spine keeps craft's adversarial refutation, its
JS-computed gate, its dead-lens synthesis and its score table, none of which a hand-dispatched
`Agent` obtains. Per craft's Phase 2 an audit still needs a plan, and that plan is a **charter**
rather than a work order: what is being audited, which lenses judge it, which mechanical checks run,
and the standing instruction that nothing may be written. That makes an audit a plan-mode round trip; pay it.

```js
const auditDir = /* absolute path of the workflow under audit */
const agentFile = /* absolute path of its agent .md, or null if it ships none — see Phase 4 */
const projectDir = /* the repo that contains auditDir — see Phase 4 */

// The args object. Written to the args file as plain JSON — no comments; the annotations are here.
const args = {
  projectDir, planPath: "<the charter's path>", planHash: "<64-hex>",
  goal: "<one sentence — phrase it as a verdict returned, never as PASS>",

  readOnly: true,
  tasks: [],        // a charter carries no work order, and readOnly dispatches no implementer

  // ONE entry: its exit code is the whole mechanical verdict. Same boundary as Phase 4 — the guard
  // agent lives outside auditDir, so without `--agent` the audit excludes the file whose hook rules
  // matter most.
  mechanicalChecks: [
    { name: "wc-check",
      cmd: `bash ${CLAUDE_PLUGIN_ROOT}/skills/workflow-creator/scripts/check.sh --target ${auditDir}${agentFile ? ` --agent ${agentFile}` : ''}` },
  ],

  // The Phase 4 lenses VERBATIM, minus scope-fidelity — see below. Spelled OUT, not elided: an
  // empty or absent array does not mean "no lenses", it means craft's OWN two defaults
  // (criteria-vs-artifacts, scope-fidelity) — the `reviewLenses` fallback literal in
  // `craft/workflow.js`, stated in craft's Phase 4 param table as "passing [] does not
  // disable review" (line anchors are deliberately absent: they go stale on every edit and
  // a wrong one is worse than none). A placeholder here would
  // therefore run zero domain lenses AND reinstate the one lens this branch deliberately drops.
  // Phase 4 is canonical: a prompt edited there must be edited here in the same change.
  reviewLenses: [
    { key: "gate-integrity",
      agentType: "Explore",
      refs: ["${CLAUDE_PLUGIN_ROOT}/skills/workflow-creator/references/gate-laws.md"],
      prompt: "Judge the generated artifact's relationship to the gate, and ONLY the judgement residue: refs presence (P7), path resolution (P1/P2/P4/P6), the single entry point and lens-set parity (P10/P11) are decided by wc-probe's exit code, and an acceptance clause naming no command is decided by craft's plan-lint — do not re-litigate any of them. FIRST: does it ship a .js of its own? The default deliverable is a SKILL that passes parameters to craft's workflow.js — a domain .js is justified ONLY by a genuine fan-out with its own gate over its own index, and the plan must say so in writing. An unjustified .js is a CRITICAL finding: it forks the shared spine. If there is no .js, judge MEANING, which no exit code reads: is any declared lens decorative — is its ask answerable at all, and could a lint rule decide it instead, in which case the lens should have BEEN that rule; and does the one mechanical entry point actually exit non-zero when what it names is wrong, rather than passing vacuously over a set it matched nothing in. If a .js IS justified, judge it against the JS-gate laws in the refs: documented returns{...} keys match actual return{...} keys and selector ids live in the namespace the script filters against; the selective re-run path does not vacuously pass an empty set, does not disable verification, and carries forward as a union; overallPass===false implies a non-empty selector for EVERY fail path including whole-artifact ones owning no item; every gated dimension fails closed on a null agent result and distinguishes crash-drop from intentional skip; no gate field is produced by the agent whose work it certifies." },

    { key: "spine-fidelity",
      agentType: "Explore",
      refs: ["${CLAUDE_PLUGIN_ROOT}/skills/craft/SKILL.md"],
      prompt: "Judge whether the generated skill supplies parameters to craft's spine rather than re-deriving one. Findings: a second lifecycle re-implemented inside the skill instead of parameterizing the spine in the refs; a domain .js that duplicates what craft's workflow.js already does; an orchestrator doing work a dispatched agent should do; a phase named in the plan that no task, lens or mechanical check actually covers; a phase that runs but whose result reaches no gate; any of craft's five phases silently dropped." },
  ],

  authorityExtra: "<the Phase 4 block, verbatim>",

  // Optional: discoveries made outside this run — a main-chat agent team (CLARIFY axis 7),
  // or a previous audit's surviving findings. Each is refuted like a lens finding.
  priorFindings: [ /* {title, severity, detail, file, lens} */ ],
}
```

Dispatch it the same way Phase 4 does; the built-in `Workflow` tool is denied by the guard at
`~/.claude/hooks/main-thread-guard.sh`:

```bash
# Dispatch EXACTLY as craft's Phase 4 states it — detached via `setsid nohup`, absolute
# --args/--out, then its wait loop, then craft-result.sh. Do not copy the command here:
# this file already carried a foreground, relative-path copy that craft's own rules
# contradict, and a generator's examples become everyone's dispatch.
```

**`scope-fidelity` is dropped on an audit, and that is a declared drop, not an oversight.** It judges
whether changes stayed inside the plan's task table and writable paths; a `readOnly` run makes no
changes and its charter has no task table, so the lens has nothing to judge against and would spend
an agent reporting nothing. It is the **only** lens difference between the two fences — the others
carry over unchanged — and it is declared in the grammar the probe parses, so P11 reads an intended
drop rather than a silent one. The declaration NAMES the keys allowed to differ; it is not an
exemption and has no whole-file off switch, so a `wc-probe: ignore-lens-set-parity` marker is a P9
finding rather than a suppression — P11 polices exactly one file per skill, and a marker that
silenced it there would silence it everywhere.

<!-- wc-probe: lens-set-differs scope-fidelity -->

**Both verdicts go to Phase 5** via craft's read-only findings-file path, because nothing was
written for `-w` to show. A FAIL is the audit's successful outcome, not a defect to fix. Do not fix.
If the user then wants the fixes, that is a new **improve** run with its own plan and its own gate.

**Improve** starts by running the probe against the existing workflow and reading the findings into
the plan, so the task table is grounded in what the probe actually reported rather than in a guess
about what is wrong.

## Phase 1 — CLARIFY

AskUserQuestion on these axes before any reconnaissance (skip what the request already answers,
batch up to 4 per call). Craft has **seven** axes; these eight specialize the ones that take a
domain form, and the rest follow the list unspecialized:

1. **Workflow outcome** — what does the generated workflow *produce*, and what does done look like
   for one run of it?
2. **Target repo** — where does the generated workflow live? A personal skill under
   `~/dotfiles/.claude/skills/`, a plugin repo, a project-local `.claude/`? This decides every
   path the artifact will contain.
3. **The generated workflow's phases** — expressed in craft's terms, since craft runs them: which
   task rows exist and in what order (the spine implements sequentially), which lenses judge the
   whole deliverable, and which deterministic commands become `mechanicalChecks`. If a phase does
   not map onto one of those three, that is the signal to test the fan-out exception — not to
   reach for a `.js` by reflex.
4. **Its gate** — enumerate the constraints the generated workflow's output must satisfy and
   **classify each one mechanical or lens**. Mechanical is first-best, so a lens rank needs its
   answer to *why is this not a command?* written into the plan beside it; every mechanical
   constraint is a **leg of the one entry point**, not a separate command. The arithmetic that
   turns those into PASS/FAIL is craft's, computed in JS from raw counts.
5. **Its re-run selector** — what the fix loop feeds back on FAIL, and what id-namespace those ids
   live in. Every path that can set `overallPass` false needs a selector channel; a whole-artifact
   failure that owns no item needs its own.
6. **Its human review surface** — working tree, commit range, PR, or none.
7. **Mutation owners** — which phase of the generated workflow is allowed to write which paths.
   Anything not named here is out of scope for it.
8. **Exclusions** — what must not change in the *target repo* during this run.

Plus craft's remaining axes, taken as craft states them:

- **Observable success criteria** (craft 4) — each becomes a `mechanicalChecks` entry.
- **Third-party review opt-in** (craft 6) — the only moment it can be opted into.
- **Agent team for discovery** (craft 7) — **read-only runs only, default yes.** This applies
  directly here, because audit-only *is* a `readOnly` craft run: ask the agent team axis on that
  branch and skip it on **new** and **improve**, where the run writes and craft's ban holds. A team
  of communicating auditors catches cross-file defects that isolated lenses structurally cannot see —
  a claim corrected in one file and left live in another is exactly the class this skill has shipped.
  Its findings come back correlated, so they enter as `priorFindings` and craft refutes them outside
  the team; each entry costs a refuter, so count them into the fan-out.
- **Constraints** (craft 3) — usually already answered by doctrine rather than asked: no emitted
  `workflow.js`, the `<generated-skill>/` layout below, and `references/gate-laws.md`. Ask it only
  when the target repo imposes something those do not cover.

Gate: you can write the task table without guessing. If the answer is "add one line to an existing
workflow," say the loop is overkill and just do it.

## Phase 2 — PLAN

Craft's Phase 2 — including how the plan path is resolved and hashed. Two domain additions:

- **The task table doubles as the generated workflow's output manifest.** Every file the run will
  emit appears as some task's writable path, so nothing is created that the user did not approve,
  and nothing approved is silently skipped.
- **A `refs` column, required and may be empty** — see *Rules and references*. Empty states that a
  task has no domain rules; absent is refused, because an omission cannot be told from a forgotten
  one.

| id | name | work | writable paths | refs | acceptance |
|---|---|---|---|---|---|

If the plan justifies a domain `.js` under the iron law above, it must also record which craft
parameter was considered instead and why it did not fit.

## Phase 3 — GOAL

Craft's Phase 3 unchanged — no domain variation. Follow it exactly.

## Phase 4 — the craft call

`genDir` below is the absolute path of the generated skill directory, decided at CLARIFY axis 2.
Everything else is craft's.

```js
const genDir = /* absolute path of the generated skill dir, from CLARIFY */

// The guard-bearing agent .md itself — under `.claude/agents` or `~/.claude/agents`, NOT a plugin
// root's `agents`. It is OUTSIDE genDir by construction (see the layout below), so the probe only
// judges it if you name it: `--target` is the probe's whole world, and `--agent` widens it by
// exactly one file WITHOUT dragging in the unrelated agents that share the discovery directory.
const agentFile = /* absolute path of the agent .md, or null if the workflow ships none */

// craft's `projectDir` is rendered into every dispatched agent's AUTHORITY block as
// "Work only there", so when CLARIFY axis 2 puts the generated skill in a DIFFERENT repo from the
// session, this is the tree that holds the artifact — not necessarily the session's cwd.
const projectDir = /* the repo that contains genDir */

// The args object. Written to the args file as plain JSON — no comments; the annotations are here.
const args = {
  projectDir, planPath: "<the path $PLAN resolved to in Phase 2>", planHash: "<64-hex>",
  goal: "<one sentence>",

  tasks: [ /* the plan's table verbatim: {id, name, work, writablePaths, acceptance, refs} */ ],

  // ONE entry, always: check.sh runs every leg (wc-probe, parity, node-check over genDir/*.js, and
  // genDir's OWN probe suite) and its exit code is the whole mechanical verdict. A new deterministic
  // check becomes a LEG of check.sh, never a second entry here — P10 refuses that.
  // `--agent` whenever the workflow ships a guard agent: the file sits outside genDir and the probe
  // walks genDir alone, so without it nothing scans the guard. Never a second `--target` at the
  // discovery dir — that reads the agent without its skill, so ${CLAUDE_SKILL_DIR} resolves to
  // nothing and the guard's path reports NOT CHECKED.
  mechanicalChecks: [
    { name: "wc-check",
      cmd: `bash ${CLAUDE_PLUGIN_ROOT}/skills/workflow-creator/scripts/check.sh --target ${genDir}${agentFile ? ` --agent ${agentFile}` : ''}` },
  ],

  // Judged BEFORE any implementer is dispatched; a surviving critical|major returns FAIL having
  // built nothing. This skill's own doctrine is that most defects are specification defects, so
  // paying a few read-only agents up front is the cheapest gate available. Applies to the
  // audit-only branch too — a charter is a plan and is judged the same way.
  reviewLenses: [
    { key: "gate-integrity",
      agentType: "Explore",
      refs: ["${CLAUDE_PLUGIN_ROOT}/skills/workflow-creator/references/gate-laws.md"],
      prompt: "Judge the generated artifact's relationship to the gate, and ONLY the judgement residue: refs presence (P7), path resolution (P1/P2/P4/P6), the single entry point and lens-set parity (P10/P11) are decided by wc-probe's exit code, and an acceptance clause naming no command is decided by craft's plan-lint — do not re-litigate any of them. FIRST: does it ship a .js of its own? The default deliverable is a SKILL that passes parameters to craft's workflow.js — a domain .js is justified ONLY by a genuine fan-out with its own gate over its own index, and the plan must say so in writing. An unjustified .js is a CRITICAL finding: it forks the shared spine. If there is no .js, judge MEANING, which no exit code reads: is any declared lens decorative — is its ask answerable at all, and could a lint rule decide it instead, in which case the lens should have BEEN that rule; and does the one mechanical entry point actually exit non-zero when what it names is wrong, rather than passing vacuously over a set it matched nothing in. If a .js IS justified, judge it against the JS-gate laws in the refs: documented returns{...} keys match actual return{...} keys and selector ids live in the namespace the script filters against; the selective re-run path does not vacuously pass an empty set, does not disable verification, and carries forward as a union; overallPass===false implies a non-empty selector for EVERY fail path including whole-artifact ones owning no item; every gated dimension fails closed on a null agent result and distinguishes crash-drop from intentional skip; no gate field is produced by the agent whose work it certifies." },

    { key: "spine-fidelity",
      agentType: "Explore",
      refs: ["${CLAUDE_PLUGIN_ROOT}/skills/craft/SKILL.md"],
      prompt: "Judge whether the generated skill supplies parameters to craft's spine rather than re-deriving one. Findings: a second lifecycle re-implemented inside the skill instead of parameterizing the spine in the refs; a domain .js that duplicates what craft's workflow.js already does; an orchestrator doing work a dispatched agent should do; a phase named in the plan that no task, lens or mechanical check actually covers; a phase that runs but whose result reaches no gate; any of craft's five phases silently dropped." },

    { key: "scope-fidelity",
      agentType: "Explore",
      refs: [],
      prompt: "Judge scope fidelity: did the changes stay inside the plan's task table and writable paths? Out-of-scope edits, unrequested features, and silently skipped plan items are findings." },
  ],

  authorityExtra: [
    "DOMAIN RULE — what you are building.",
    "A workflow is a SKILL that supplies parameters to craft's workflow.js at ${CLAUDE_PLUGIN_ROOT}/skills/craft/workflow.js. It does NOT ship a workflow.js of its own. The deliverable is a task table, lenses, mechanicalChecks, refs and authorityExtra — passed to the existing spine. The skill does not do the work and does not compute the verdict; craft does both.",
    "IRON LAW: if you find yourself wanting to write a workflow.js, craft is missing a PARAMETER. Ask which craft parameter would make the script unnecessary, and propose generalizing craft instead — that is how mechanicalChecks, refs, authorityExtra and the agentType overrides all came to exist. A parameter serves every future workflow; a private .js serves one and forks the spine. Only after that question genuinely answers 'none' — a true fan-out with its own gate over its own index — may a .js be written, and the plan must record which generalization was considered and why it did not fit.",
    "A domain workflow is referenced by {scriptPath: '<absolute path>'}, NEVER by bare name: a bare name resolves only through .claude/workflows/, so a script shipped alongside a skill is unreachable by its own meta.name.",
    "Enforcement in the generated artifact is structural where structure can carry it — a Workflow script has no Write tool — and a hook only where structure cannot.",
  ].join("\n"),

  verifierAgentType: "Explore",

  thirdParty: ["codex"],   // ONLY if the plan carries the opt-in line; else omit
}
```

**Dispatch through farm-out, never the built-in `Workflow` tool** — the guard at
`~/.claude/hooks/main-thread-guard.sh` denies `Workflow` unconditionally, so an in-session call
is dead on arrival. `farm.sh` sets `FARM_OUT_CHILD=1`, which is what lets its child make the call:

```bash
# Dispatch EXACTLY as craft's Phase 4 states it — detached via `setsid nohup`, absolute
# --args/--out, then its wait loop, then craft-result.sh. Do not copy the command here:
# a foreground or relative-path copy contradicts craft's own rules and dies mid-run.
```

`farm.sh` exits 2 on a malformed call and non-zero when `--out` came back missing or not a JSON
object; `craft-result.sh` then refuses (exit 2) unless that object carries craft's **seven** required
return keys — all three selectors included — at the right types, **and** re-runs every
mechanical check the result claims, refusing when the shell's exit code disagrees with the claimed
one. It adjudicates rather than validating shape: **its exit code is the verdict** — 0 pass, 1 fail,
2 refused — and `overallPass` is never read directly. Adjudication reaches the mechanical claims
only; a model still transcribes the rest, so reconcile `scoreTable` against the plan's Run sizing
before believing a PASS.

`verifierAgentType` and the per-lens `agentType` pin `Explore` because it has no Edit and no Write:
a judge that structurally cannot modify the tree beats a prompt that asks it not to.

**`implementerAgentType` is deliberately unset for this workflow's own run**, which is not a
contradiction of the guidance above that a generated workflow should usually set one. The output
here is workflow definitions — SKILL.md dispatch blocks, hooks, scripts — so the implementer is
writing software, and Claude Code's software-engineering system prompt is the correct framing rather
than the defect it is where the output is prose. A custom agent is justified only by a custom
prompt, hooks or preloaded skills; none of the three applies, so creating one would be an agent
justified by nothing.

On the result, follow craft's Phase 4 handling — and remember the re-run selector is **all three** of
`tasksThatFlagged`, `mechanicalThatFailed` and `lensesThatFlagged`. Plan defects do not arrive
through the gate at all: they are caught before dispatch by `plan-lint.ts` and `plan-preflight.ts`,
and the remedy is to amend the plan, re-hash and re-dispatch. A `wc-probe` failure owns no
task; you fix what the probe reported and re-invoke with the same `mechanicalChecks`, which always
re-run. A surviving lens finding owns no task either — it is a judgement about the whole deliverable,
so it **re-runs the LENS**: fix what `findings[]` reported and re-invoke with that lens still in
`reviewLenses`, which needs no extra selector arg because a lens re-runs on every invocation. With
three lenses declared above against the single mechanical entry point, `lensesThatFlagged` is the
channel most likely to be the only non-empty one on a FAIL here — and `mechanicalThatFailed` names
`wc-check`, whose own leg lines say which leg failed.
`scoreTable.mechanicalRun: 0` means the phase was skipped, not that mechanics are clean.

## Phase 5 — HUMAN REVIEW

Craft's Phase 5 applies, including the verdict handling and the two-rejection cap. It is no longer a
single path: craft grew a read-only branch, so there is one domain note per branch.

- **new / improve** — the review surface is the generated skill directory, so the human is reading
  the workflow that was built, not output it produced. Nobody has run it yet.
- **audit-only** — craft's read-only path governs. `-w` over a tree nothing wrote to opens an empty
  diff and returns `unreviewed`, which craft calls *not approval*, so the orchestrator first writes
  `.craft/<run-id>/findings.md` from the object `workflow.js` returned and reviews **that** file with
  `--file`. Transcribe, do not grade: counts from `scoreTable`, findings from `findings[]`, verdict
  from `verdict` — the agent that ran the audit must not also summarise it in its own voice. The
  domain note is that the review surface is a diagnosis of a workflow nobody changed, so `findings`
  from the human are input to a later **improve** run, not edits to make now. `.craft/` is
  gitignored, so an audit worth keeping has to be moved somewhere tracked — say so to the user.

## Rules and references

Four audiences need a generated workflow's domain rules, and each has its own delivery point:

| audience | delivery |
|---|---|
| the orchestrator (the generated skill) | inject at load, or Read at the phase that needs it |
| implementer agents | `tasks[].refs` |
| judging agents — lenses and their refuters | `reviewLenses[].refs` |
| everyone, for a short rule | `authorityExtra` |

**Convention:** a generated workflow's rules live at `<generated-skill>/references/*.md`. Rules are
files, and `refs` is how a file reaches the agent that needs it instead of stopping at the
orchestrator or being paraphrased into a prompt.

**Required declaration:** every task row and every lens in a plan this skill approves declares
`refs`. An **empty list is allowed** — it states the task has no domain rules. An **absent key is
refused**, because an omission is indistinguishable from a forgotten one. `wc-probe.ts` P7 refuses a
task row or lens with no `refs` key and checks that every declared ref resolves on disk, so a rule
reference is checkable rather than hoped-for.

**A fence is code because of what it holds, not how it is labelled.** The deliverable is a SKILL.md,
so the craft args object, its task rows and its lenses live inside a fenced block. P6/P7 read the
interior of any fence labelled `js`/`ts` **or containing a `Workflow(` call** — whatever its info
string. The rule used to be "label it `js`, or the gate cannot see it", enforced by a `P8 fence
labelling`; that rule was authored against a corpus that does not follow it. Of the real `Workflow(`
call sites in the spine skills, most sit in a **bare** fence and several in a ```` ```text ```` one,
so a label rule left the gate reading a small minority of the call sites it exists to judge and
flagged the majority as defective for rendering the way everything else does. **P8 is gone**; label
the fence however you like — but an args object dispatched through `farm.sh` carries no `Workflow(`
call to be recognised by content, so label **that** fence `js` or P7 never checks its `refs`.

This strictness is workflow-creator's, not craft's: craft treats `refs` as optional so its existing
callers keep working. workflow-creator is strict about what it *emits*.

## Emitted hooks — where a write-time guard must attach to fire

Structure covers implementation-time enforcement (no Write tool in a Workflow script). Two gaps
remain: a **write-time domain constraint** inside a dispatched implementer, which `mechanicalChecks`
would only catch after the fact at gate time; and the **conversational phases** (CLARIFY, PLAN),
where the orchestrator is a free agent in main chat.

Where such a hook must live was measured, not reasoned. The experiment, its apparatus, and the
verbatim hook payloads are in
[`references/hook-reach.md`](${CLAUDE_SKILL_DIR}/references/hook-reach.md).
Observed (Claude Code 2.1.224, Linux, `PostToolUse` on `Write|Edit`, fresh headless sessions):

| hook declared in | write performed by | log entry? |
|---|---|---|
| skill frontmatter | the main session itself (control) | **yes** |
| skill frontmatter | a direct `Agent` subagent | **none** |
| skill frontmatter | a `Workflow`-dispatched agent | **none** |
| agent frontmatter | a direct `Agent` subagent | **yes** |
| agent frontmatter | a `Workflow`-dispatched agent | **yes** |

The control matters: it shows the skill hook was registered and firing, so the two "none" rows are
a reach limit, not a broken apparatus.

**This skill's own validate-on-write hook was then confirmed the same way.** With
`~/.claude/skills/workflows/skills/workflow-creator` symlinked into place and this skill invoked in a fresh session,
a real `Write` of a scratch `SKILL.md` carrying a deliberately broken skill-dir reference produced,
from that session's transcript (`attachment.type: "hook_success"`,
`hookName: "PostToolUse:Write"`, `exitCode: 0`):

```
workflow-creator validate-on-write: 1 finding(s) in /tmp/wc-hook-probe/SKILL.md
  [critical] P2 path-resolution (line 9): "${SKILL_DIR_TOKEN}/references/definitely-not-here.md" resolves to /tmp/wc-hook-probe/references/definitely-not-here.md, which does not exist
    remedy: fix the path or create the file — a reference that does not resolve fails only at the moment it is needed
  (advisory — the write was not blocked)
```

(One edit to that transcript excerpt: the literal skill-dir placeholder token is shown here as
`${SKILL_DIR_TOKEN}`. Spelled out with its real name, this very file would trip its own P2 check.
Nothing else in the excerpt is altered.)

**Provenance of that excerpt, exactly.** It was read out of the *driver session's own transcript*,
from the `hook_success` attachment the harness records there. That is the orchestrator-side record.
It establishes that the hook fired and what the hook process printed — and nothing more. It is not
a record of what the writing model received, because the transcript attachment is written whether or
not anything reached the model. No cell of the experiment captured the writing agent's side; a later
run did, for the blocking form only (below).

**Unmeasured, and therefore treated as unreliable: whether an ADVISORY `systemMessage` reaches the
writing model.** No cell in `references/hook-reach.md` records what the writing agent received from a
hook that fired and exited 0. (Cell A's note that the subagent saw no `PostToolUse` output is about a
skill hook that never fired at all, so it says nothing about delivery from a hook that did.) Design
as if an advisory `systemMessage` will not change an agent's behavior: put anything that must change
it in a `mechanicalCheck` (`wc-probe.ts`, whose exit code gates the run) or in a blocking
`PreToolUse` guard — the blocking path is measured to arrive verbatim, the advisory one is not.

**Ask for a `tools:` allowlist FIRST; a hook only when the restriction cannot be expressed as one.**
An allowlist prevents the write; a hook reacts to one, and only its **blocking** form is known to
reach the writing model (below). A hook earns its place only for restrictions an allowlist cannot state
— "may write, but only under these paths", "must run the formatter after".

When it IS a hook, the guard rides on the **agent**, in that agent's own frontmatter, threaded into
the workflow via `implementerAgentType` — that is a large part of why the override earns its place. That agent file must sit in an agent-discovery
location that also DELIVERS hooks (`.claude/agents/` or `~/.claude/agents/`), **not** under the
generated skill's own directory, where nothing registers it. Two separate things are measured here:
the hook **fires** on a dispatched agent's write (cells C and D), and a **blocking** guard —
`exit 2` with the reason on stderr — reaches the implementer verbatim (2026-08-08). What is still
unmeasured is ADVISORY output: anything the hook prints while exiting 0. So make the guard's effect
structural — a blocking decision, or a finding a `mechanicalCheck` re-derives at gate time — rather
than assuming the implementer reads what a non-blocking hook prints. By contrast, a guard declared in the generated SKILL.md's frontmatter was observed firing
only on the main session's own writes, so scope it to the conversational phases and do not expect it
to see a dispatched agent's writes.

**Token substitution in `hooks:` frontmatter, also observed.** `CLAUDE_SKILL_DIR` does **not**
substitute there: it reached the hook process as an empty argument and was unset in the hook's
environment, so a command written against it ran with a broken path and silently found no script.
The absolute command path executed on every write that reached the hook at all.
`CLAUDE_PLUGIN_ROOT` **was** set in the hook environment **of a SKILL's hook** — for a personal skill
it pointed at the installed `~/.claude/skills/<name>` directory — and a command written against its
brace form did execute. **Prefer an absolute path anyway.**

**In a BODY the token substitutes only when the file is plugin-shipped.** Read out of 2.1.226: the
plugin skill/command loader pushes the body through the same `CLAUDE_PLUGIN_ROOT` replacement it
applies to `allowed-tools`, and the plugin agent loader does it to the agent body — while the
non-plugin loader replaces `CLAUDE_SKILL_DIR`/`CLAUDE_PROJECT_DIR`/`CLAUDE_SESSION_ID` and never
this one. So **P4 is a non-plugin rule**; firing it on a plugin-shipped body is a finding against
correct code.

**In an AGENT's `hooks:` the token is refused (P1).** The docs define it as the plugin installation
directory, so an agent outside a plugin has none — and a plugin-shipped agent has its `hooks:` block
ignored entirely. Nothing the harness supplies can make it resolve there. Resolving it anyway is
what let one unchanged agent read CLEAN under one probe target and CRITICAL under another.

**Measured 2026-08-08 on 2.1.226** (`references/hook-reach.md`): `PreToolUse` and `PostToolUse` both
fire under `claude -p`, from `settings.local.json` and from a `~/.claude/agents/` agent's own
`hooks:`, for `Bash` as well as `Write`; settings hooks fire inside subagents; and a **blocking**
guard (`exit 2` + stderr) stops the write and reaches the writing model verbatim. An earlier claim
here that headless suppressed these was a bad matcher, not a harness behaviour.

**Not measured, so do not claim it:** whether a skill hook reaches a subagent that invokes the skill
itself; long-lived interactive sessions (every cell ran in a fresh headless session); and whether
**advisory** output — a `systemMessage`, or anything printed while exiting 0 — reaches the model
that performed the write. Only the blocking form was shown to.

The layout that follows from the observations:

```
<generated-skill>/
├── SKILL.md            the whole workflow: craft's phases + the params it passes.
│                       Sets implementerAgentType: 'x-impl'. hooks: here only for
│                       the conversational phases — they do NOT reach dispatched agents
├── references/*.md     the rules, delivered to agents by refs
└── scripts/*.ts        the guard body and any probes

.claude/agents/x-impl.md    NOT under the skill directory. name: x-impl, and
                            hooks: PostToolUse Write|Edit -> the write-time domain guard
```

**The agent file does not live inside the skill.** Agent discovery has four roots. Three are
documented as scanned RECURSIVELY — a definition in a subfolder registers, so for those depth is
never the test; being under a root is. Line cites below are into the `.md` view of
`code.claude.com/docs/en/sub-agents`.

- `.claude/agents/` (project, `:163`). Discovery walks UP from the cwd, so EVERY `.claude/agents/`
  between cwd and the repository root is scanned, and on a duplicate `name` the definition closest
  to the cwd wins (`:169`). A `.claude/agents/` inside an `--add-dir` directory loads alongside
  these (`:171`).
- `~/.claude/agents/` (personal, `:164`).
- A plugin's own `agents/` (`:165`) — not just its top level. Here, and only here, a subfolder
  becomes part of the scoped identifier: `<plugin>/agents/review/security.md` in plugin
  `my-plugin` registers as `my-plugin:review:security` (`:179`). In the project and personal roots
  the subfolder path does not affect identity, which comes only from `name` (`:175`).
- `.claude/agents/` inside the managed-settings directory; a managed definition takes precedence
  over a project or personal one of the same name (`:223`). The cited line does NOT say this root is
  scanned recursively — the three above are, this one is unstated. Do not assume a subfolder
  registers here.

A file at `<skill>/agents/x-impl.md` registers no agent, because a skill directory is none of those
roots — not even inside a plugin, where the root is `<plugin>/agents/`. The shipped
`skills/skill-creator/agents/*.md` files in the plugin cache also carry no `name:` frontmatter and
are prose the skill reads, not agents the harness loads. Put the guard-bearing agent under a
discovery root, give it a `name:` matching the `implementerAgentType` string, and confirm it
resolves before relying on it — an `implementerAgentType` naming an unregistered agent means the
guard was never installed.

**Registration and hook DELIVERY are different questions.** `hooks:`, `mcpServers:` and
`permissionMode:` are IGNORED for a **plugin-shipped** agent — it registers and dispatches normally,
so nothing looks broken, but the guard never fires. Use `.claude/agents/` or `~/.claude/agents/` for
a guard; inside a plugin, put it in that plugin's `hooks/hooks.json`. `wc-probe --agent` enforces
this.

**Moving it out of the skill moves it out of the gate, so name it with `--agent`.** wc-probe walks
`--target` and nothing else, and the coverage line cannot reveal the gap — it prints a full `N of N`
over a tree that never held the file. `--agent` judges the guard against the skill it guards and
widens the scan by exactly that file, so unrelated agents in `.claude/agents/` stay out of the gate.
A second `--target` at the discovery directory does not substitute: with no skill in scope
`${CLAUDE_SKILL_DIR}` resolves to nothing and the guard's path reports NOT CHECKED.

No `workflow.js` — the spine is craft's, called by `scriptPath`. Add one only under the fan-out
exception, with the justification written into the plan.

**A script that gates a run needs its own suite, and that suite is a leg of the entry point.** A probe
under `scripts/` decides PASS/FAIL for every future run of the workflow, so its own correctness is
load-bearing in a way no lens covers: a predicate that silently matches nothing reports CLEAN, which
is the vacuous-pass class `references/gate-laws.md` L2(a) forbids. Ship `scripts/<probe>.test.ts`
beside it; `check.sh`'s `probe-tests` leg is target-relative, so it runs THAT skill's suite. This
skill's own is
[`scripts/wc-probe.test.ts`](${CLAUDE_SKILL_DIR}/scripts/wc-probe.test.ts):

```sh
bun test ${CLAUDE_PLUGIN_ROOT}/skills/workflow-creator/scripts/wc-probe.test.ts
```

The path is spelled out because `~/dotfiles` carries no `package.json` or `bunfig.toml`, so a bare
`bun test` from the repo root matches nothing and exits non-zero.

**Run every new test against the OLD probe first; it must FAIL.** A test written beside its fix
passes either because the fix works or because it never exercised the defect, and the green looks
identical. The failing run is the only thing that distinguishes them.

```sh
cd <repo>/.claude/skills/workflow-creator/scripts
cp wc-probe.ts /tmp/fixed.ts && git show HEAD:.claude/skills/workflow-creator/scripts/wc-probe.ts > wc-probe.ts
bun test ./wc-probe.test.ts -t '<new test name>'   # READ THE COUNTS, not the exit code
cp /tmp/fixed.ts wc-probe.ts
```

**Read `N fail`, never the exit status.** `bun test -t` exits **1 when the filter matches nothing**,
which is byte-identical to the failure this step is looking for — so a typo'd name, or a title
`-t` cannot match, reads as proof the test discriminates. Measured: a real all-passing block exits
0, an unmatched filter exits 1. Titles are regexes, so a name containing `${…}` matches nothing (`$`
then an invalid quantifier) and a run filtered on it is a vacuous pass. Confirm the reported fail
count is the number of tests you added.

And the deeper limit, paid for twice: **a failing run proves the test DISCRIMINATES, not that it
discriminates toward the correct answer.** One test here was proved to fail against the old code
while pinning a hole the official documentation contradicted. Where a test encodes a claim about the
harness, check the claim against the docs or the binary — the delta cannot tell you that.

Two corollaries: **run any `mechanicalCheck` you write by hand before committing it** — a `cmd`
inside a SKILL.md is a literal the probe never executes; and **point the probe at a real shipped
skill, not only a `mktemp` fixture** — fixtures contain only what you already thought of.

### The coverage floor

A run that selected no source files is a **critical finding**, not CLEAN. `0 of 0 eligible source
files scanned` used to exit 0 — every rule passing by vacuous truth, in the one layer that decides
whether anything ran at all. A target with source but no `SKILL.md` is also reported, because **P3**
keys off it and its silence otherwise means nothing. P4 does **not** — the shared `classifySkillFile`
dispatches it for a skill *or* an agent file — so on an agents-only target the floor says so instead
of claiming a rule was un-run in the same report that prints its findings.

**Symlinks are followed.** A skill is *delivered* by symlink on this machine (`~/.claude/skills/<name>`
→ the repo), and `Dirent.isFile()` is false for a link, so the walk selected nothing and the probe
printed CLEAN over a skill it had never opened. Links are resolved and a **dangling** link is a
critical finding — lost coverage, named as such. Three limits keep that from becoming its own hole:

- **The walk cannot climb.** A link resolving to the target or *above* it (`sub/up -> ../..`, or a
  link to `$HOME` or `/`) is refused and reported, not followed. Otherwise the walk re-enters the
  tree from outside and enumerates everything beside it, and findings name paths the target does not
  own. A link pointing *sideways* out of the tree is still followed — that is the delivery case — and
  every file it reaches is declared in `crossFileTargets`.
- **`SKIP_DIRS` decides on what an entry resolves to**, not what it is called: `vendor -> node_modules`
  is skipped, and `dist -> real-content` is walked rather than dropped in silence. A dangling link
  *named* for a skipped directory is skipped too, not reported as lost coverage the walk never wanted.
- **The cycle guard is an ancestor chain, not a visited set.** A visited set also suppressed a sibling
  *alias* of a directory already walked, and since rule dispatch keys on the path a file is reported
  under, `agents -> shared` silently decided whether the agent rules ran, on unsorted readdir order.
  Findings are deduplicated by real path, so one file reachable under two names is still one finding.

`wc-probe.ts` P1 is **registration-driven**: it reads the `hooks:` blocks of skill and agent
frontmatter plus any `hooks.json` / `settings*.json`, and refuses a registered hook command whose
body does not resolve on disk — a hook that never fires is indistinguishable from a passing one. It
does *not* flag a script that registers nothing, because `scripts/` also holds probes. **Nothing
detects an orphaned guard body** — a script whose registration was deleted stays on disk unflagged,
and no rule looks for it. That is a deliberate gap, not a check happening elsewhere. A command naming a
variable the probe cannot substitute (`$HOME`, `$CLAUDE_PROJECT_DIR`) is **not checked and says so**
— it is an unknown path, not a broken one, and resolving it literally made every such registration a
false CRITICAL.

### P5 follows the reference across files

A SKILL.md documents what its workflow returns; the `return` that implements it lives in the script
the file's `Workflow({scriptPath})` names. They are **different files**, and no same-file rule could
ever compare them — in the spine corpus, 10 of 12 documented shapes describe a script the skill does
not own. So on Markdown, P5 binds each documented shape to the nearest preceding `scriptPath`, reads
that script's **contract return** — the `return {` at indentation zero, not a helper's early return
— and checks both directions:

| direction | fires when | gated on |
|---|---|---|
| documented, not implemented | a documented key is absent from the contract | nothing |
| implemented, not documented | a contract key is absent from the docs | the target resolved, exactly **one** top-level return, no top-level spread, and the documented shape **exhaustive** (every comma element parsed, no `...`/`etc`) |

Direction B is gated because each of those conditions is what makes "missing" *knowable* rather than
merely unproven. When one fails, the check is **skipped and reported**, never silently passed.

**One hop, no inference.** P5 follows `scriptPath` and stops; it does not read what that script
itself calls. A bare `Workflow({name: "..."})` is deliberately **not** resolved — inferring a path
the document never wrote produces confident findings about a script nobody named.

On `.ts`/`.js` the rule stays same-file, and it now recognises the three ways a file actually returns
an object: a literal `return {…}`, an arrow's implicit `=> ({…})`, and a `const r = {…}; return r`
binding written exactly once. ES6 **shorthand** keys count in all three. Each of those was a
false-positive source, because a key the parser could not see reads exactly like a key nobody
implemented. Returns are split by **paren depth**: one at depth 0 is the enclosing function's
contract, one inside a call argument belongs to that callback and is reported as such rather than
counted or ignored.

**An annotation lives in a comment.** In code, P5 accepts a documented shape only from a *comment* —
not from a string or template literal. A `return {` inside a template is code a generator **emits**,
and the shape belongs to the emitted script, not to the emitter.

**What P5 cannot decide for you.** A file whose job is to *specify* code someone else writes — a
template stating the contract for an optional hook, a design doc for an artifact the build produces —
documents a shape it never implements, and no rule can tell that apart from a contract that rotted.
Declare it: `<!-- wc-probe: ignore-returns -->`, file- or region-scoped, which is printed on every
run. Inferring it instead would mean guessing, and a wrong guess **fails silent** — the vacuous pass
`references/gate-laws.md` L2(a) forbids.

### P12 dispatch routing — how a skill that emits a craft-args fence hands it to craft

P10 and P11 judge what a craft-args fence *declares*; P12 judges how the file **dispatches** it. Two
clauses, over any file emitting at least one fence:

- **(a) CRITICAL** — the file names some *other* runner script and never names `craft-dispatch.sh`.
  That script is craft's entry point and owns the gates that run *before* the workflow does — TIER 1
  `plan-lint`, the TIER 2 `redCommand` probe, TIER 2b `plan-preflight`. A hand-rolled runner line
  skips all three, and the skip leaves no trace afterwards: the run simply proceeds ungated. Keyed
  on the **shape** of a runner reference (any `<name>.sh|.ts|.mjs|.js` on a line claiming the
  dispatch), never on one runner's filename — a name-keyed rule retires itself silently the day the
  runner is renamed.
- **(b) MAJOR** — a fence whose `projectDir` literal lies outside the repository containing the file,
  with no `--run-dir` anywhere in it. Craft then writes `args`, `result` and `log` into a `.craft/`
  inside a tree the run was only meant to read.

A file naming **neither** entry point is not judged: delegating without naming one is
indistinguishable from documenting nothing, and inferring a script nobody wrote produces confident
findings about it. Marker: `dispatch`.

### P13 task-row coverage — every instance the gate judges has a task row that builds it

A fan-out workflow names its instances three times over: as `--lecture NN:` specs inside the one
`mechanicalChecks` command, as `scoredChecks[].items` lines, and as the numeric suffix of a
per-instance `reviewLenses[].key`. **MAJOR** for each id a fence enumerates in any of the three that
no `tasks[].id` covers — the gate then reports on an artifact no implementer was dispatched to
produce. A task id covers an instance when it carries that id as a whole run of digits, so
`content-18` and `r18-align` cover `18` while `deck-190` does not cover `19`.

The id-space is digits only: a non-numeric lens suffix (`scope-fidelity`) is a lens NAME, and
reading it as an instance manufactures a missing task row for every lens a workflow declares.

A fence whose `tasks[]` is empty or absent is skipped entirely — that is what a `readOnly` charter
declares, and flagging it would fire on every audit block. Marker: `task-coverage`.

### Declared exemptions

A check may be suppressed only by a marker that is the **whole trimmed line**, optionally behind a
`//`, `#` or `*` comment lead-in:

| marker | effect |
|---|---|
| `<!-- wc-probe: ignore-<rule> -->` | whole file |
| `<!-- wc-probe: ignore-<rule>:start -->` … `:end` | that region (unclosed runs to EOF) |

`<rule>` is one of **`all`, `hooks`, `paths`, `returns`, `workflow-refs`, `refs`, `entry-point`,
`dispatch`, `task-coverage`** — the rules that are actually honoured.
Any other name is a `P9 exemption vocabulary` finding rather than a silent
no-op: a marker that reads as a suppression and is not one hides a failing check twice over.
Markers are parsed **once, from the raw file**, and threaded into every predicate, so what suppresses
and what gets reported cannot disagree. A marker inside a fence — or indented four spaces — is an
example, not a declaration.

**P11 is deliberately outside this grammar.** It polices the one file per skill that emits two
craft-args fences, so a whole-file `ignore-` marker would disable it exactly where it is the only
rule. Its intended differences are named instead:
`<!-- wc-probe: lens-set-differs <key> [<key>...] -->`, listing the keys allowed to differ. Any
difference it does not name is still a finding, and the declaration prints like an exemption without
being one.

Every exemption applied, every unresolvable reference skipped, and every file read outside `--target`
is printed in **both** output modes. The unit is the **exemption ENTRY** — `notesFor()` emits one
`SUPPRESSED` line per entry, whole-file or region-scoped alike, so two region markers for one rule
in one file would print twice. This skill declares **five entries across four files** — one of them
region-scoped, so entries are the count that must match, not rule×file pairs. All five print on every
run, alongside `SKILL.md`'s `lens-set-differs scope-fidelity` declaration, which is not one of them:

| file | rules | entries | why |
|---|---|---|---|
| `references/hook-reach.md` | `paths` | 1 | the evidence IS an unsubstituted placeholder; resolving it destroys the finding |
| `scripts/wc-probe.test.ts` | `paths`, `returns` | 2 | its fixtures are deliberately broken paths and fake return shapes |
| `scripts/parity-check.sh` | `paths` | 1 | its fixture writes a deliberately broken plugin-root reference for both surfaces to disagree about |
| `scripts/check.test.ts` | `paths` (region) | 1 | two fixture constants are deliberately broken references the wc-probe leg must fire on |

## Red flags

| Situation | Wrong move | Right move |
|---|---|---|
| User asks what is wrong with a workflow | hand-dispatch lenses as bare `Agent` calls to skip the plan-mode ceremony | audit-only is the craft loop with `readOnly: true` and `tasks: []` — same spine, same refutation, same computed gate. A charter plan is the price, and craft says pay it |
| Audit turned up fixes | fix them inside the audit | that is an **improve** run with its own plan and its own gate |
| A lens keeps flagging the same shape, or its clauses are each decidable | tune the prompt and keep the lens | that shape is a lint rule nobody has written yet — write the rule, make it a leg of the entry point, delete the lens. `path-resolution` was deleted this way; it is P1/P2/P4/P6. A lens is what is left when no exit code can decide it |
| Another deterministic check is needed | add a second `mechanicalChecks` entry beside the first | add a **leg to `check.sh`** — the entry point's exit code is the whole mechanical verdict, a check declared beside it is one nothing reports when it is dropped, and P10 refuses the second entry unless `<!-- wc-probe: ignore-entry-point -->` says why |
| Generated workflow needs a lifecycle | write a second spine inside the skill | supply parameters to an existing spine; a skill that re-derives a lifecycle is the finding `spine-fidelity` looks for |
| Referencing a domain workflow | by its `meta.name` | `{scriptPath: "<absolute path>"}` — a bare name resolves only through `.claude/workflows/` |
| Dispatching craft (or any workflow script) | the built-in `Workflow` tool | the guard at `~/.claude/hooks/main-thread-guard.sh` denies `Workflow` unconditionally, so the call never runs — go through `farm.sh --workflow … --args … --out …` and validate the result file with `craft-result.sh`. Same guard denies `Agent` for non-allowlisted subagent types; `Explore` and `Plan` stay allowlisted |
| Write-time guard needed on an implementer | reach for a `hooks:` guard before asking whether a `tools:` allowlist states the same restriction; or declare it in the generated SKILL.md frontmatter, in an agent file under `<skill>/agents/`, or in a PLUGIN-shipped agent's frontmatter | the SKILL.md hook was observed not to reach dispatched agents; `<skill>/agents/` is not a discovery location so nothing registers there; and `hooks:` is IGNORED for plugin-shipped agents, which registers an agent whose guard never fires — put it in an agent's frontmatter under `.claude/agents/` or `~/.claude/agents/` and thread it via `implementerAgentType`, or, inside a plugin, in that plugin's `hooks/hooks.json`. An allowlist PREVENTS the write and a hook only reacts to it, so a restriction expressible as `tools:` should never be a hook — a hook needs reach to work, an allowlist needs none |
| Guard is in the agent's frontmatter, so the implementer will read what it prints | assume it prints and is read | a **blocking** guard (`exit 2` + stderr) is measured to reach the implementer verbatim; advisory output while exiting 0 is not — make the guard block, or have a `mechanicalCheck` re-derive the finding at gate time |
| Hook command needs the skill directory | `CLAUDE_SKILL_DIR` in `hooks:` | it does not substitute there — absolute path. **P1 now refuses it**, because the hook silently never fires |
| Probe run came back CLEAN | trust it | check the coverage line — `0 of 0` is now a critical, but so is a subtree behind a dangling symlink |
| Task or lens has no domain rules | omit `refs` | `refs: []` — absent is refused, empty is a statement |
| A documented return shape drifts from the script | assume P5 caught it because the suite is green | P5 compares a SKILL.md's shape against the **script its `scriptPath` names** — check the `crossFileTargets` note to see which file the verdict was actually about |
| A check needs suppressing | invent a rule name for the marker | only `all`/`hooks`/`paths`/`returns`/`workflow-refs`/`refs`/`entry-point`/`dispatch`/`task-coverage` are honoured; anything else is a `P9` finding, not a suppression. P11 has no `ignore-` form at all — declare the intended difference with `lens-set-differs <key>` |
| A skill dispatches craft with its own hand-rolled runner line | copy the invocation into the SKILL.md | that skips the gates `craft-dispatch.sh` owns on the way in, and P12 refuses it |
| Gate says PASS and the probe was skipped | read `mechanicalRun: 0` as clean | nothing was checked; re-run with the checks present |
| FAIL with an empty `tasksThatFlagged` | conclude there is nothing to fix | read `mechanicalThatFailed` **and** `lensesThatFlagged` too — the selector has three channels and only one of them owns tasks. A surviving lens finding re-runs the LENS, not a task. Only when all three are empty does an empty selector on a failing run mean re-run everything |
| A generated gate field is filled in by the agent that did the work | ship it | pair it with a deterministic JS check or a separate low-effort probe — self-report is not a gate |
| The workflow needs something craft doesn't obviously do | write a `workflow.js` for it | **ask which craft parameter is missing and generalize craft.** That urge produced `mechanicalChecks`, `refs`, `authorityExtra` and the `agentType` overrides — each now available to every workflow. A `.js` only after that answers "none", justified in the plan |
| A domain `.js` **was** justified, and `node --check` passes on it | call it tested | it is a syntax check; smoke it with bogus args and confirm it reaches its **own** arg-validation error |
| Whole-artifact failure in the generated gate | let it flip `overallPass` with no selector | give it its own selector channel and make the fix loop consume **every** channel the gate returns — craft's own returns four, so a generated gate that adds one has five |
