# Skill-scoped deterministic checkers — design exploration

Status: **exploration, no code changed.** 2026-09-14, Claude Code `2.1.257`
(`~/.local/share/mise/installs/claude/2.1.257/claude`).

## The answer in four sentences

The harness supports frontmatter-declared hooks on **both** skills and subagents, natively, with no
dispatcher and no state file — so nothing here has to be emulated. But the two are not the same
mechanism: a **subagent's** hooks live and die with the subagent, while a **skill's** hooks latch on
at invoke and stay registered *for the rest of the session*. And the measurement this repo already
holds (`skills/workflow-creator/references/hook-reach.md`) says a skill's frontmatter hook fires on
the **main session's** writes only — it does **not** reach a dispatched agent's writes, which under
this plugin's delegation Iron Law is where nearly all the guarded writing actually happens.

So the idea as posed — "move the checkers into the skill that owns the rule" — would, for most of
the inventory, silently turn the checker off at the exact moment it matters. The version of the idea
that survives is **agent-scoped**, not skill-scoped, and this repo has already started doing it
(`user-agents/writing.md:19-25`). Skill-scoped is right for a narrow residue.

---

## 1. Inventory

### 1a. Plugin hooks — `hooks/hooks.json` (registered for every session that has the plugin enabled)

| Checker | Event · matcher (hooks.json:line of its `command`) | What it decides | Scoped today by | Rule's owning skill | Decidable? |
|---|---|---|---|---|---|
| `image-read-guard.ts` | PreToolUse · `Read` (L16, L20) | `Read` on an image → deny, redirect to look-at | file extension (`:46`); `LOOK_AT_NESTED` escape (`:40`) | `using-skills` Iron Law (session-wide) | yes — extension test |
| `suggest-compact.ts` | PreToolUse · `Edit\|Write` (L25, L29) | every Nth edit → suggest compaction | a counter in `gettempdir()` (`:27`), session id (`:47`) | none — session hygiene | yes — counter ≥ threshold |
| `find-slide-page-inject.ts` | PreToolUse · `Bash` (L34, L38) | `tinymist compile <x>.typ` → inject a slide→page map | regex on the command (`:33`), target must exist (`:139`), a sibling plugin's `scripts/` must be found (`:39-56`) | `workshop` and a sibling plugin's slide skill | yes — regex + file existence |
| `lint-check.ts` | PostToolUse · `Edit\|Write\|Bash` (L45, L49) | ruff / lintr / marimo lint on the written file | suffix→linter map (`:156`), non-Edit/Write exits (`:185`) | `dev`, `ds` | yes — linter exit + output |
| `atomic-constraint-guard.ts` | PostToolUse · same block (L53) | a `references/` `.md` named `*-constraints`/`*-conventions` with ≥3 `###` → warn "split it" | suffix `.md` (`:41`), path contains `references` (`:43`), h3 count (`:70`) | `skill-creator` / `plugin-creator` — and only inside **this** repo's layout | yes — heading count |
| `writing-prose-check.ts` | PostToolUse · same block (L57) | prose-quality scorers on `drafts/*.md` and non-deck `*.typ` | suffix + `drafts` parent (`:319`), `isTypDeck` (`:151`), a hard-coded suppression list of this repo's own doc paths (`:56-61`) | `writing` (+ `ai-anti-patterns`) | mostly — the scorer exit is decidable; several of its *findings* are prose judgements |
| `cite-fidelity-lint.ts` | PostToolUse · same block (L61) | cite-fidelity lint on a fresh `drafts/*.md` | suffix `.md` (`:77`), path contains `drafts` (`:78`) | `writing` / `cite-check` | yes — lint exit |
| `typst-convention-guard.ts` | PostToolUse · same block (L65) | Typst convention violations after editing a `.typ` | suffix `.typ` (`:182`); deck-only rules behind `isTypDeck` (`:101`) | `workshop`, a sibling plugin's skill, `typst` | yes — string/AST-ish tests on source |
| `validate-skill-paths.ts` | PostToolUse · `Edit\|Write` (L70, L74) | `${CLAUDE_SKILL_DIR}` / `${CLAUDE_PLUGIN_ROOT}` refs that resolve to nothing | suffix `.md` (`:329`), placeholder regex (`:238`) | `skill-creator`, `plugin-creator`, `workflow-creator` | yes — `existsSync` on the resolved path |
| `pr-url-logger.ts` | PostToolUse · `Bash`, async (L79, L83) | `gh pr create` output → append URL to `.claude/LEARNINGS.md` | command substring (`:70`) | none — a logger, not a checker | n/a (records, decides nothing) |
| `overflow-check.ts` | PostToolUse · `Bash` (L79, L88) | a compiled deck whose slides overflow | `typst\|tinymist compile` + `.typ` target (`:132`), `isOverflowTarget` = `isTypDeck` (`:93-94`) | `workshop` (and a sibling plugin's skill) | yes — `check-overflow.sh` exit |
| `session-end.ts` | Stop · `*`, async (L95, L99) | rewrites `$CWD/.claude/LEARNINGS.md` timestamp | none | none | n/a |
| `teammate-idle-report-check.sh` | TeammateIdle (L110) | an idle teammate that never reported → nudge | `[NO REPORT NEEDED]` in the dismissal | `agent-teams.md` rule (team-wide) | yes — literal-string test |
| `pattern-scan.ts` | SessionEnd · `clear\|logout\|…`, async (L117, L121) | scans the transcript, writes `pending-patterns.json` | none | `continuous-learning` | n/a (mines, decides nothing) |
| `session-start.ts` | SessionStart (L5, L9) | injects `using-skills` verbatim + env context | none | `using-skills` | n/a (injector) |
| `plugin-validate.ts` | **not registered** | `claude plugin validate` after manifest edits | — | `plugin-creator` | yes, but its only finding here is a constant symlink warning |

`plugin-validate.ts` is already deliberately unwired and documented as such
(`skills/plugin-creator/SKILL.md:10`, `skills/skill-creator/SKILL.md:10`). It is dead weight in the
tree, not a relocation candidate.

**Spawn count per tool call, read off `hooks/hooks.json`** (no measurement needed — it is arithmetic
over the matchers): a `Write` costs **6** plugin hook processes plus 2 user-level PreToolUse hooks;
a `Bash` costs **7** plugin hook processes plus 2 user-level ones. Every one of them is a `bun`
process start. I did **not** measure the wall-clock of a no-op run — `bun` is not on this thread's
Bash allowlist — so no timing claim is made here. See §6, experiment B.

### 1b. User hooks — `~/.claude/settings.json` + `settings.local.json`

| Checker | Event · matcher | What it decides | Scoped today by | Owning rule |
|---|---|---|---|---|
| `main-thread-guard.sh` | PreToolUse · `Agent\|Task\|Workflow\|Edit\|Write\|NotebookEdit\|Bash`; **and** Stop | three policies: delegation routes through farm-out; mail composition belongs to `email`; a `farmOutOnly` project and an armed-undispatched craft run take no main-thread writes | `FARM_OUT_CHILD` env escape (`:65`); an ancestor walk for `.claude/plans` and `.claude-workflows.json`, stopping at `$HOME` (`:76-87`); `work-pending.sh` exit code (`:96-107`) | `using-skills` Iron Law + `craft` Phase 3/4 — **session-wide invariant** |
| `bash-allowlist.py` | *not a hook* — a library called by the above (`main-thread-guard.sh:232`) | is this Bash command read-only enough for the main thread | allowlist | same |
| `outbound-send-guard.sh` | PreToolUse · `Bash` — **declared in agent frontmatter**, `~/.claude/agents/email.md:11-16` and `assistant.md:14` | an outbound send → `permissionDecision: ask` | **already agent-scoped** | `email` / `assistant` draft-by-default |
| `herdr-agent-state.sh` | SessionStart · `*` (twice — duplicated entry) | records session state for Herdr | none | infrastructure |
| `work-goal-resend.sh` | SessionStart · `*` | re-seeds a craft goal after a context clear | craft state | `craft` / `until` |
| `farm-monitor-arm.sh` | PreToolUse · `Bash` | arms the farm-out run monitor | command shape | `farm-out` |
| `assistant-projects-context.ts` | SessionStart | injects personal-productivity context | none | `assistant` |
| `vault-flush.sh` | PreCompact, SessionEnd (`settings.local.json`) | flushes the Obsidian vault | none | `obsidian` |

Two incidental findings worth fixing regardless of this design: `herdr-agent-state.sh session` is
registered **twice** on SessionStart (once via `$HOME`, once via the absolute path), and
`user-agents/` agents already carry `hooks:` while `agents/librarian.md` does not — the split is not
documented anywhere.

### 1c. Checkers that are already skill-scoped, by not being hooks at all

`skills/workflow-creator/scripts/wc-probe.ts` is the model the rest of the inventory should be
measured against. It is a deterministic gate (exit code settles it), it is owned by exactly one
skill, and it is *invoked by that skill* rather than registered against every session. It costs
nothing when workflow-creator is not running because nothing registers it. Same shape:
`skills/workflow-creator/scripts/validate-skill-write.ts`, which *is* a frontmatter hook — see next
section.

---

## 2. Can the harness do this? Yes — two different mechanisms, and the difference is the design

Everything in this section is read from the shipped bundle or the current docs, not from memory.

### 2.1 Skill frontmatter `hooks:` is a first-class, validated field

The skill frontmatter parser has a dedicated hooks branch. From the bundle, function `mVo`:

> `function mVo(e,n){if(lN(e,l1e))return t(\`Skill '${n}': PreToolUse/PermissionRequest is declared at the frontmatter top level, outside "hooks" — ${nh}\`,{level:"error"}),{hooks:void 0,unloadableGuard:!0}; … if(r.unloadableGuards.length>0)return t(\`Skill '${n}': ${r.unloadableGuards.join("; ")} — ${nh} (the skill loads with no hooks and no allowed-tools)\`,{level:"error"}) …`

Three facts fall straight out of that:

1. `hooks:` is parsed, zod-validated, and produces the `hooks` field on the loaded skill
   (`…disableModelInvocation:jXe(e["disable-model-invocation"]),userInvocable:y,hooks:B,executionContext:…`).
2. It **fails closed and loudly**: a malformed block makes the skill load *with no hooks and no
   `allowed-tools`*. A typo does not degrade to "hook missing", it degrades to "skill defanged".
3. Declaring `PreToolUse` at the frontmatter top level instead of under `hooks:` is caught as an
   explicit error, which tells you it is a mistake people make.

The permitted event set is the full hook event list (`Ch` in the bundle):
`PreToolUse, PostToolUse, PostToolUseFailure, PostToolBatch, Notification, UserPromptSubmit,
UserPromptExpansion, SessionStart, SessionEnd, Stop, StopFailure, SubagentStart, SubagentStop,
PreCompact, PostCompact, PreModelSwitch, PostModelSwitch, PermissionRequest, PermissionDenied,
Setup, TeammateIdle, TaskCreated, TaskCompleted, Elicitation, ElicitationResult, ConfigChange…` —
an unknown key is stripped with a warning (`hooks.<x>: unknown hook event; entry ignored`), *unless*
it looks like it holds PreToolUse/PermissionRequest hooks, in which case it is an unloadable guard.

### 2.2 Registration is per-hook, and there is a `once` flag

From the bundle, the registration loop:

> `function Ee(e,n,o,m,l){let p=0;for(let C of Ch){let I=o[C];if(!I)continue;for(let T of I)for(let v of T.hooks){let N=v.once?()=>{t(\`Removing one-shot hook for event ${C} in skill '${m}'\`),e.remove(n,C,v)}:void 0;e.add(n,C,T.matcher||"",v,{onHookSuccess:N,skillRoot:l}),p++}}if(p>0)t(\`Registered ${p} hooks from skill '${m}'\`)}`

`once: true` attaches an `onHookSuccess` that removes the hook after its first **successful** run.
Note "successful" — a hook that keeps failing keeps firing.

### 2.3 The lifetime difference is the whole story

`https://code.claude.com/docs/en/hooks.md`, section *Hooks in skills and agents*, verbatim:

> * **Subagent hooks**: Claude Code runs them only while that subagent is running and removes them
>   when it finishes. Claude Code converts a `Stop` hook here to `SubagentStop`, the event it fires
>   when a subagent completes.
> * **Skill hooks**: Claude Code registers them when you or Claude invoke the skill and keeps
>   running them for the rest of the session, on turns after the skill's own turn as well. To have
>   Claude Code remove a hook after its first successful run instead, set `once: true` on it.

And, on trust:

> Frontmatter hooks in a project skill follow the same workspace trust rule as hooks in settings
> files. Claude Code registers them when you or Claude invoke the skill, including in a `-p` run in
> a folder you haven't trusted.
>
> Frontmatter hooks in a project subagent run only after you accept the workspace trust dialog for
> the folder the agent file came from. A `-p` session doesn't count as accepting it. … Before
> v2.1.218, these hooks could run from folders you hadn't trusted.

So: **skill hooks are a latch, not a scope.** Invoking `/workshop` once arms the deck checkers for
the remaining eight hours of the session, including every turn about something else. That is still
strictly better than "armed in every session in every repo", but it is not what "active only during
the skill" means, and a design doc that says "scoped" here is lying to its next reader.

### 2.4 Token substitution inside a skill's `hooks:` — narrower than in the body

The bundle carries a specific warning string:

> `Hook command references ${…} but only ${CLAUDE_PLUGIN_ROOT} is available for skill hooks (${CLAUDE_PLUGIN_DATA} is plugin-only). Command: `

and the `${CLAUDE_SKILL_DIR}` replacement is applied to `allowed-tools` and to the skill **body**,
never to the parsed `hooks` object. This repo measured the same thing independently
(`skills/workflow-creator/SKILL.md:521-527`): `CLAUDE_SKILL_DIR` reached the hook process as an
empty argument; `CLAUDE_PLUGIN_ROOT` was set and its brace form did execute. The repo's standing
advice — *prefer an absolute path anyway* — holds.

For an **agent's** `hooks:`, `${CLAUDE_PLUGIN_ROOT}` is refused outright
(`skills/workflow-creator/SKILL.md:536-540`), and a **plugin-shipped** agent has its `hooks:` block
ignored entirely. That is why `user-agents/` exists and is symlinked into `~/.claude/agents/`
(`plugin.json` declares only `"skills"`), and it is why the agent-scoped path is available to this
repo at all.

### 2.5 The measurement that kills the naive migration

`skills/workflow-creator/references/hook-reach.md`, 2026-08-06, `2.1.224`, real dispatches with
logs — not reasoning:

- **Control**: a skill frontmatter `PostToolUse Write|Edit` hook *does* fire on the main session's
  own write. Log line quoted in full in that file.
- **Cell A**: with the skill active, a direct `Agent` subagent's Write produced **no log entry**.
  The subagent independently reported seeing no PostToolUse hook output.
- **Cell B**: same via `Workflow`-dispatched agent — same null.
- Separately measured (`SKILL.md:545-549`): **settings** hooks *do* fire inside subagents, and an
  **agent's own** frontmatter hook fires on that agent's write, with a blocking `exit 2` + stderr
  reaching the writing model verbatim.

Explicitly **not** measured, and therefore not claimed anywhere below: whether a **plugin**
`hooks/hooks.json` hook fires inside a subagent (only `settings.local.json` was tested); whether a
skill hook reaches a subagent that invokes the skill itself; and whether **advisory** output (a
`systemMessage`, or anything printed while exiting 0) reaches the model that performed the write.
Only the blocking form was shown to.

The consequence is blunt. Under this plugin's own Iron Law the drafting, the deck-building and the
data work all happen in **dispatched persona agents**. Moving `writing-prose-check`,
`typst-convention-guard` or `overflow-check` from `hooks/hooks.json` into
`skills/writing/SKILL.md` / `skills/workshop/SKILL.md` frontmatter would leave them firing on main-
thread edits — which the guard above mostly forbids anyway — and silent on the agent writes they
exist to catch. That is a regression dressed as tidiness.

### 2.6 Nothing has to be emulated

Since both mechanisms are native, the "one dispatcher hook that consults which skill is active"
design in the brief is unnecessary, and I'd argue against building it even if skill hooks did not
exist. It would need to answer "which skill is active" from somewhere, and there is no existing
state that records it — the harness holds the registry internally and exposes no field for it in the
hook payload (the payload shape is visible in the hook-reach control log above: `session_id`,
`transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `effort`, `hook_event_name`, `tool_name`,
`tool_input`, `tool_response`, `tool_use_id`, `duration_ms` — no skill field). Answering it would
therefore mean **recording** it, which is a new state file, which
`~/projects/workflows/.claude/CLAUDE.md` forbids without retiring one — and it would be a
self-certified one at that, the exact anti-pattern that section names (`<X>_CLARIFIED.json`, "the
proof that CLARIFY happened was the model asserting it happened"). Parsing the transcript for
`<command-name>` on every tool call would be the same fact re-derived at a per-tool-call cost, and
would still be wrong for a skill loaded by preload rather than invocation.

**Recommendation: no dispatcher, no active-skill state, ever.** Use the two native scopes.

---

## 3. Proposed mechanism — three tiers, chosen by *who writes the file*, not by who owns the rule

The sorting question is not "which skill's rule is this". It is "which process performs the write
this checker must see". That question is decidable from the delegation table in `using-skills`.

**Tier A — agent frontmatter (`user-agents/<agent>.md` → `~/.claude/agents/`).**
For every checker guarding work that a persona agent performs. True scoping: registered on
`SubagentStart`, removed when the agent finishes. Measured to fire on the dispatched agent's writes,
and measured to reach the writing model when it blocks. Constraints: absolute command paths
(`${CLAUDE_PLUGIN_ROOT}` is refused here), the agent file must live in a user agent directory (it
does), and the guard must be **blocking** (`exit 2` + stderr) or feed a `mechanicalCheck` — advisory
output is unmeasured and must not be relied on.

**Tier B — skill frontmatter `hooks:`.**
For checkers guarding *conversational-phase* work the main thread genuinely does, where the latch
semantics are harmless because the checker's own path predicate already makes it a no-op elsewhere.
`skills/workflow-creator/SKILL.md:6-13` is the working example in this repo today, and its comment
already records the right instinct — it deliberately did **not** widen the matcher to `Bash`,
because a Bash payload carries `command`, not the `file_path` the hook reads.

**Tier C — stay in `hooks/hooks.json` (or in settings).**
For session-wide invariants and for anything that must see *both* main-thread and subagent writes
until §2.5's unmeasured cell is closed.

The latch in Tier B is acceptable only under one condition, and it should be written down as a rule:
**a Tier B checker must be a no-op on every file the skill does not own, decided by a path or suffix
test, before it does any work.** Every candidate below already satisfies this. If a proposed checker
cannot, it does not go in Tier B, because a latched-on hook that fires broadly is worse than a global
one — it is a global hook whose activation nobody can predict.

### Multiple skills loaded, and none loaded

- **Several loaded**: additive, no conflict — each skill's hooks register independently into the same
  registry with its own matcher. There is no arbitration to design, and no ordering guarantee to
  rely on either.
- **None loaded**: Tier B checkers do not exist for that session. That *is* the saving, and it is
  also the risk: an edit to `drafts/memo.md` by a session that never invoked `/writing` gets no prose
  check. Whether that is a feature or a hole is the single judgement call in this design. My read:
  for `overflow-check` and `typst-convention-guard` it is a feature (nobody edits a deck by accident);
  for `writing-prose-check` it is a hole, because drafts get touched outside a `/writing` run all the
  time.

### Context cost

Tier A and Tier B both cost **frontmatter lines**, not body lines. Frontmatter is parsed, not
injected into the model's context as prose — so a `hooks:` block is not subject to the "every added
line is a recurring token cost" rule that governs SKILL.md bodies. What *would* violate that rule is
adding explanatory prose to a SKILL.md body about the hook it declares. **Do not.** The declaration
is self-documenting; the reasoning belongs in this file.

---

## 4. Migration sketch

Ordered by confidence, not by size. Nothing below is a recommendation to proceed — see §6 first.

**Step 0 — free wins, independent of the whole idea.**
Delete `hooks/plugin-validate.ts` and its golden test, or wire it; it is unregistered dead code with
two SKILL.md files apologising for it. De-duplicate the `herdr-agent-state.sh` SessionStart entry in
`~/.claude/settings.json`.

**Step 1 — Tier A, one checker, the clearest case.**
`typst-convention-guard.ts` → `user-agents/workshop.md` frontmatter, `PostToolUse` on `Edit|Write`,
absolute command path. The `workshop` agent is the process that writes `.typ` decks. Keep it in
`hooks/hooks.json` in parallel for one cycle so a null result is visible as *both* firing, not as
nothing firing.

**Step 2 — Tier A, the rest of the writing set.**
`writing-prose-check.ts` and `cite-fidelity-lint.ts` → `writing.md`, `writing-legal.md`,
`writing-econ.md`. All three already carry a `hooks:` block
(`user-agents/writing.md:19-25`), so this is extending an existing list, not introducing a mechanism.
Note the duplication cost: three agent files now each name the same two scripts. That is the price of
agent scoping and it is real.

**Step 3 — Tier B, the repo-local authoring checkers.**
`atomic-constraint-guard.ts` and `validate-skill-paths.ts` → `skills/skill-creator/SKILL.md` and
`skills/plugin-creator/SKILL.md` frontmatter. These two are the best Tier B candidates in the whole
inventory: their rules are about *this repo's* `constraints/` layout and `${CLAUDE_…}`
placeholders, they only fire on `.md` under specific paths, they guard main-thread authoring work,
and they are currently paid for by every session in every unrelated repo on the machine. Declaring
them twice (skill-creator and plugin-creator) is fine — the registry is additive.

**Step 4 — Tier A, the deck compile.**
`overflow-check.ts` and `find-slide-page-inject.ts` are `Bash` hooks, and the compile is run by the
`workshop` and the sibling plugin's agents. Same move as Step 1, same parallel-run discipline.

**Nothing merges into a new state file, and nothing records which skill is active**, at any step.

---

## 5. What I would NOT move, and why

| Stays | Why |
|---|---|
| `main-thread-guard.sh` | It is a **session-wide invariant**, not a skill rule: it enforces that the main thread delegates at all. Scoping it to a skill inverts it — the sessions that never invoke a skill are precisely the ones it must catch. Its own header already says it is the only mechanism that can read per-project `.claude-workflows.json` and per-run `writablePaths`, which no static rule can. It also self-exempts via `FARM_OUT_CHILD`, which is scoping done correctly at the process boundary. |
| `image-read-guard.ts` | Same class. The look-at Iron Law is stated in `using-skills`, which is injected into *every* session by `session-start.ts` — the guard must have the same reach as the rule. It is also the cheapest hook in the set: one extension test. |
| `suggest-compact.ts`, `session-start.ts`, `session-end.ts`, `pattern-scan.ts`, `pr-url-logger.ts` | Session lifecycle and logging. None of them is a checker; four of them decide nothing at all. They are not in scope for a design about deterministic checkers and should be struck from the framing rather than relocated. |
| `teammate-idle-report-check.sh` | Team-lifecycle invariant, event `TeammateIdle`, no skill owns it. Its rule lives in `~/dotfiles/.claude/rules/agent-teams.md`, which applies to every teammate regardless of skill. |
| `outbound-send-guard.sh` | **Already** correctly scoped, to the two agents that can send. It is the existing proof that Tier A works; do not touch it. |
| `lint-check.ts` | Arguable, and I would leave it. It fires on any `.py`/`.R`/`.ts` write, which happens in `dev`, `ds`, `craft` implementers, and plenty of inline work that belongs to no skill. Scoping it to `dev` and `ds` would leave the most common case — a quick fix in a repo with no workflow running — unlinted. |

**Delete rather than relocate:**

- `plugin-validate.ts` — unregistered, produces one constant warning, documented as such in two
  places. Its existence is a maintenance tax with no reader.
- The `atomic-constraint-guard` heuristic deserves a second look on its own terms: "≥3 `###`
  headings in a file whose stem ends `-constraints`" is decidable but it is a *proxy* for a design
  rule, and the rule it proxies ("one rule per file") could be a lint over the constraints directory
  run once by `skill-creator`, rather than a hook that fires on every `.md` write in every repo that
  happens to have a `references/` directory. That is the `wc-probe` shape, and it is better than
  either tier.

**Not a checker at all, and should stop being described as one:** anything whose output is prose a
model then argues with. `writing-prose-check` straddles this — its *exit code* is decidable, several
of its *findings* are not. If it moves anywhere, the decidable half moves and the advisory half stays
advisory and unrelied-upon, per §2.5.

---

## 6. The smallest experiment that proves or kills this

The idea lives or dies on one unmeasured cell: **does a hook declared in `hooks/hooks.json` fire on a
dispatched agent's write?** Everything in §4 assumes it does — that is why the migration is framed as
a *loss* of subagent reach. If it does **not**, then today's global hooks are already blind to agent
work, the whole inventory is only guarding main-thread edits that `main-thread-guard.sh` largely
forbids anyway, and the right move is not relocation but deletion of most of the set.

**Experiment A (the decisive one).** One cell, one command, ~5 minutes, no repo changes.

Extend the existing apparatus at `skills/workflow-creator/references/hook-reach.md` with a Cell E:
add a `PostToolUse` `Write|Edit` hook to a scratch **plugin's** `hooks/hooks.json` whose command
appends its stdin JSON to `plugin-hook.log`; install the plugin; from a fresh headless session
(`claude -p --permission-mode bypassPermissions --output-format json`) dispatch a general-purpose
subagent told to Write one file, having written a `##### CELL E start <ts>` marker into the log
first. Decidable on the exit condition: **the log contains a `PostToolUse` record for the agent's
`file_path`, or it does not.** No judgement, no prose review.

- **Fires** → the migration in §4 is a real trade-off; proceed with Step 0 + Step 3 only (Tier B,
  the two repo-local authoring checkers), because those are the ones whose subagent reach nobody
  needs. Leave Tiers A/C alone until someone wants the duplication.
- **Does not fire** → the premise collapses in the useful direction. Stop designing relocation and
  open a deletion review instead: a checker that never saw the writes it guards has been decorative
  for as long as it has been installed, and `git log` will say how long.

**Experiment B (cheap, run it alongside).** Time a no-op run of each of the seven PostToolUse hooks
against a synthetic Bash payload and multiply by the spawn counts in §1a. If the total is under ~50 ms
per tool call, the efficiency half of the motivation is dead and only the correctness half (a checker
firing where its rule does not apply) is left standing — which is a much narrower case, satisfied by
Step 3 alone. I could not run this from this thread (`bun` is not on the Bash allowlist here), which
is itself the one-line fix that unblocks it.

Do not run Experiment A and the migration in the same session. The measurement is the deliverable;
the migration is what the measurement decides.

---

## 7. Settled 2026-09-17 — the three frontmatter declarations, under `farmOutOnly`

Measured on `2.1.257`, not reasoned. Only **two** skills ever declared a frontmatter hook:
`skill-creator` declares none (its path check is the plugin-wide `hooks/validate-skill-paths.ts`,
Tier C, and `SKILL.md:16` already says so).

1. **Cell A reproduces.** A fresh headless session invoked a scratch skill carrying a `PostToolUse`
   `Write|Edit` hook, dispatched a general-purpose subagent to Write, then wrote itself. The log
   holds exactly one entry — the main session's own `file_path`. The subagent's write produced none.
2. **`farmOutOnly` denies everything but `*.md`.** `main-thread-guard.sh`'s `fo_exempt` was fed
   synthetic payloads against a clean farmOutOnly project: `SKILL.md` → allow; `.py`, `.json`,
   `.ts`, `hooks/hooks.json` → deny. So a skill hook whose target is markdown keeps its whole reach;
   one whose target is anything else in-project loses all of it.
3. **Dispositions.** `workflow-creator` stays skill-scoped — reason recorded in its own frontmatter.
   `pollev-poll-creator`'s `check_scenario_coverage.py` moved to `user-agents/{lecture-impl,teaching}.md`.
   It was also dead for a second, scope-independent reason: it read a `TOOL_INPUT` **environment
   variable**, a string that appears **0 times** in the 2.1.257 binary (`CLAUDE_PROJECT_DIR`: 27).
   Fed a real PostToolUse payload it printed nothing and exited 0. It now reads stdin, and a
   malformed event exits 1 with stderr instead of a silent 0 that reads like "checked, clean".
