# Beat transitions: governance entry and phase enforcement

Decision record for tasks #14–#20. Settled 2026-08-03.

## What happened, measured

A session planned in native Plan mode, approved the plan, and implemented it directly from main
chat. Every plugin-wide gate was inert for the whole episode. Nothing malfunctioned; each component
behaved exactly as designed.

```
classifyPlanningLifecycle(cwd) -> {"kind":"blocked","reason":"conversion-required","governed":false}
```

`hooks/implementer-identity-gate.ts:233` is `if (!governed) allow()`. That is the correct rule — the
hook runs on every `Edit`/`Write`/`Bash` in every project of every user, so an ungoverned project
must be untouched. The episode simply never became governed.

It never became governed because `governed = hasReceiptSurface('.planning/.state')`
(`workflows/lib/approved-artifact.ts:461,511`), and that directory is created by
`approved-artifact-persist.ts`, which is registered in *skill frontmatter* (`skills/dev/SKILL.md:20`,
`skills/ds/SKILL.md:19`) rather than in `hooks/hooks.json`. Approve a plan outside a workflow skill
and no receipt is written, so the project stays ungoverned, so every gate allows everything.

**The evidence was on disk the entire time.** `.claude/settings.json` sets
`plansDirectory: ./.planning`, so native Plan mode had already written the episode's plan to
`.planning/rosy-pondering-lightning.md`. Governance had something to key on and did not use it.

### The transitions themselves have no mechanism at all

Separately from entry: `clarify -> implement -> review` is prose in three `SKILL.md` files. Nothing
records which beat an episode completed. What exists is a chain of skill-scoped hooks, each
registered by the skill that owns the *source* of the edge it defends:

| edge | mechanism | registered by |
|---|---|---|
| entry → recon | `clarify-before-recon-guard` + `.planning/<X>_CLARIFIED.json` | `dev`, `ds` |
| plan → approval | `approved-artifact-persist` on `ExitPlanMode` | `dev`, `ds` |
| approval → implement | `approved-artifact-gate` | `dev-implement`, `dev-accept`, `dev-verify` |
| any → main-chat mutation | `orchestrator-mutation-guard` | ~10 skills |
| **implement → review** | **nothing** | — |

Because each guard ships in the frontmatter of the skill preceding its edge, the chain enforces
*having entered, you may not skip ahead*. It has nothing to say about entering, and
`hooks/phase-gate-guard.ts` is not in `hooks/hooks.json` — it is wired by three skills only.
`implementer-identity-gate` is the only plugin-wide `PreToolUse` mutation hook, so the entire beat
machinery has exactly one enforcement anchor and it is off by default.

`implement -> review` is unguarded in **every** workflow, not just the beats. `dev-verify` registers
`approved-artifact-gate`, but that guards `dev-verify`'s own dispatches once you are already inside
it. `skills/beat-review` registers no hooks at all.

## The reframe: one bit is doing two jobs

`governed` answers both *is this project subject to the rules* and *does an approved plan exist to
compare identities against*. The identity gate genuinely needs the second — with no receipt there is
no approver, so there is nothing to separate and nothing for that gate to say. The transition gate
needs only the first.

Conflating them is why fixing entry appears to require breaking CLARIFY, and it is why the obvious
repairs are already rejected in the source with reasons. From `approved-artifact.ts:412-413,427-428`:
treating an empty `.planning/.state/` or a clarify sentinel as governed "would restrict every CLARIFY
and PLAN conversation." That is not theoretical — a `~/.planning` dotfiles symlink once classified
`governed: true` and cost every session at `$HOME` its Bash.

So the fix adds a **second, weaker predicate** for the transition machinery and leaves `governed`
alone.

## Options considered

| | what makes it live | catches the measured case | blast radius |
|---|---|---|---|
| A. Episode-in-flight predicate | generated plan in `plansDirectory` + phase-state record | yes | medium — every native-plan user has plan files |
| **B. Committed repo opt-in marker** | a marker file, committed and diffable | yes | **zero** |
| C. Plugin-wide `ExitPlanMode` persist | any plan approval writes the receipt | yes, decisively | highest — switches the full identity gate on in every project of every user |
| D. Accept voluntary entry | nothing | no | zero |

## Decision: B as the switch, A as the evidence

A committed marker decides **whether** the transition machinery is live in a project. The plan file
plus phase state decide **where in the episode you are**. Both must hold for a transition gate to
act.

C was rejected despite being the most complete: it converts an opt-in plugin into one that governs
every project where somebody approves a plan, switching on the full identity gate — including the
no-Bash restricted-actor regime — where nobody asked for it. D was rejected because it leaves the
measured hole open.

### What this explicitly does not change

The regression floor, and the thing to check first in any review of this work:

- `governed` keeps its current definition. `hasReceiptSurface` is untouched.
- `implementer-identity-gate` behaves identically in every project, marked or unmarked.
- A project **without** the marker behaves exactly as it does today, byte for byte. No new denials,
  no new files, no new hook output.
- CLARIFY and PLAN conversations stay unrestricted. The marker does not make a project `governed`.

### Enforcement is by negation

A hook cannot invoke a skill. It can deny a tool call or inject text, and nothing else. So
"clarify finishes, therefore go to implement" is built as *refuse every move except the legal next
one, and name that move*. Two levers, both plugin-wide:

1. `PreToolUse` deny for out-of-order work, with `additionalContext` naming the legal next skill.
2. A `Stop` hook returning `{"decision":"block","reason":...}` so a turn cannot end with a
   transition owed. Without this, everything else is advisory.

**Corrected twice, and the second correction is the shipped behaviour.**

The first build passed unconditionally on `stop_hook_active`, so the gate blocked once and a caller
could simply stop again. The codex third-party adapter caught both the weakness and the fact that
this document described a hard gate. Codex's own proposed fix — block until the debt is discharged —
was rejected: a debt the model *cannot* satisfy becomes an inescapable session, in a hook firing on
every turn end in every project.

What ships is the middle: a `reviewBlocks` counter in `episode.json` bounds refusals at
`MAX_REVIEW_BLOCKS` (3) per debt, after which the gate stands down permanently for it. Enforcement
has teeth — skipping a review is now a repeated, deliberate choice — and the session can always
finish. Three supporting rules make the escape unconditional: the counter resets when a debt is
*created* (a fresh IMPLEMENT gets a fresh budget, rather than inheriting a spent one); a failed
counter write passes rather than blocking, since a counter that cannot advance is the infinite loop
the bound exists to prevent; and `stop_hook_active` is no longer consulted at all, because reading it
too would spend the whole budget on one turn's re-entries.

The `Stop` hook is the highest-risk component in this design. It fires on every turn end in every
project of every user, and `hooks/session-end.ts` is emphatic that it "never blocks: stdout is
always empty, exit is always 0." This would be the repo's first blocking `Stop`. Build and test the
unmarked-project no-op before the block path is ever armed.

### The phase state is written by a hook, not by the conversation

A hook is not a tool call, so it writes `.planning/.state/` directly while the conversation cannot —
that path is already excluded from every conversation-level write surface
(`implementer-identity-gate.ts:322-345`). The state is therefore unforgeable by the actor it
governs, which is the property we want, and it comes free.

### The successor map is data

`hooks/_workflow_policies.ts:11-16` already keys by workflow and carries `clarifySentinel` and
`reviewerVerdict`; it has no phase order. Adding the chain there gives `dev-clarify -> dev-implement`
and `ds-clarify -> ds-implement` from one table. A new workflow becomes a row, not a hook.

### Exit is required, not optional

Once transitions block, an abandoned episode is a wedge: stale phase state the `Stop` hook keeps
enforcing, with no way to clear it. A universal workflow-exit skill is the discharge condition, and
it is also the chain's missing terminal — "review owed" has no other way to be satisfied.

It must be **always reachable** (if `Stop` is blocking and `PreToolUse` is denying, the exit must not
need a denied tool — note that a restricted actor has no Bash at all), and it must **record why**
rather than refuse: `completed | abandoned | superseded`. The enforcement is the audit trail, not the
denial. An exit that can be refused wedges people; a silent one defeats the gates. Same philosophy as
the quarantine list in `scripts/check-tests.sh` — you may skip, but the skip is itemized and named.

## Artifact budget

The first draft of this design proposed two new files. It is one, and that one is an instance of an
existing pattern rather than a new category.

**Phase state reuses an existing shelf.** `.planning/.state/` was described above as holding the
receipt; it does not. `.planning/.state/writing.json` is already per-episode workflow state bound to
its plan's SHA-256 (`hooks/lib/writing-plan-context.ts:54`, `hooks/writing-suggest-verify.ts:6`).
Phase state goes beside it under the same convention.

**The marker is a key in a file that already exists**, not a new file — see sub-decision 1.

**Inside `.planning/` the count is zero**, because consolidating goes further than adding: the new
`.planning/.state/episode.json` carries phase state *and* absorbs the writing edit counters, retiring
`writing.json`. One consumer moves (`hooks/writing-suggest-verify.ts:59`, via the single
`writingStatePath` helper at `hooks/lib/writing-plan-context.ts:53`).

### What `.state/` is, and why it is a directory

`.planning/` is the gitignored per-episode area: `*.md` are the visible generated plans that native
Plan mode writes, and `.state/` is the plugin's non-visible authoritative state beside them.

**Its directory-ness is load-bearing and must not be flattened into a `.state.json`.**
`hasReceiptSurface` (`approved-artifact.ts:461`) `lstat`s `.planning/.state` and treats "a symlink or
a regular file where the receipt DIRECTORY belongs" as receipt-shaped, scoring `governed: true`
unconditionally. A regular file at that path is *currently the anomaly signal*. Flattening the
directory would collide head-on with the check that decides governance.

### Why `review.json` does not merge with the rest

- **Opposite lifecycle.** Immutable approval identity written twice per episode, versus mutable
  per-turn state.
- **Different write surface.** `implementer-identity-gate.ts:419-456` permits exactly one
  conversation-level Write to `review.json` — the dispatched reviewer's finalization — behind nine
  conditions requiring every approval-owned field reproduced unchanged. Sharing a file would force
  that Write to preserve mutable state too, and let a reviewer clobber phase.
- **Separate failure domains.** `parseReviewState` is strict; a malformed receipt means `blocked`,
  which costs the user Bash, and the source documents that as reachable by *ordinary use* (editing a
  plan file). A phase-state bug must not be able to reach it.

### The floor is three files, and the sentinels come with it

Audited after the first three drafts of this section each reported "+1 file" against an unchecked
baseline. The real inventory was **8 files across 3 classes**, because the `<X>_CLARIFIED.json`
sentinel family — six filenames encoding one bit — was never counted.

The sentinels ARE phase state: `{"status":"clarified","sessionId":…}` is the first phase transition
under another name. They are also **self-certified** — `skills/ds/SKILL.md:67` has the model `printf`
its own `clarified` status, and `clarify-before-recon-guard.ts:44` permits exactly that Bash write —
so the proof that CLARIFY happened is the model asserting it. A `PostToolUse` on `AskUserQuestion`
(hooked nowhere today) is direct evidence that the user was asked, and needs no file.

Consolidated: `review.json` + `episode.json` + the committed root marker. **8 → 3.**

Outside the project, `OBSERVATION_DIR` (`gettempdir()`) keeps one file per dispatch record. That
split is a concurrency design, not sprawl: the pre/post hooks bracket every dispatch, and a single
shared JSON would mean read-modify-write races in the one place that must not lose data.

**Invariant: `review.json.status` is the sole authority for approval status, and `episode.json` never
restates it.** `episode.json` records only what the receipt cannot know — clarified, implemented,
review owed or discharged, exited. Two files disagreeing about whether a plan is approved is a bug
generator, and the rule that resolves the disagreement is itself the bug.

This inventory and its rules are pinned in `.claude/CLAUDE.md` under "State Files".

### Why the marker cannot live anywhere the plugin already writes

`.planning/` is gitignored (`.gitignore:40`), and the sanctioned
`.claude/plugin-name.local.md` plugin-settings pattern is explicitly "not in git, should be in
`.gitignore`" (`plugin-dev/skills/plugin-settings/SKILL.md:18`). A gitignored governance marker
cannot be the committed, reviewable opt-in this decision rests on. The marker is therefore a
committed repo-root file — forced, not chosen.

## Open sub-decisions for implementation

1. ~~**Marker name and content.**~~ SETTLED: `.claude-workflows.json` at repo root, containing
   `{"schemaVersion":1,"governed":true}`, strict-parsed like every other state file here. A boolean
   rather than bare presence, so that turning enforcement OFF is a visible one-line diff instead of a
   deletion that reads as though the file never existed. JSON rather than an empty marker so the
   schema can grow (per-workflow enforcement, stricter modes) without a rename.

   ### Why not a key in `.claude/settings.json`

   This was proposed twice and rejected twice; the second reason is the real one and the first is
   recorded only because it is weaker than it first appeared.

   The weak objection: schemastore sets `additionalProperties: true`, so an unknown key passes
   validation today, but that schema is downstream of the CLI and there is no documented plugin
   namespace, so a future release could tighten and take the whole file — including
   `plansDirectory: "./.planning"` — with it. That is speculative, and the docs say such a rejection
   is "reported", so it would not be silent. Not sufficient on its own.

   **The decisive objection is the precedence model.** Settings resolve Managed > CLI args > Local >
   Project > User, and most settings OVERRIDE rather than merge — the highest-precedence scope wins
   entirely. So a `governed` key would not be a property of the repository:

   - `~/.claude/settings.json` (user) could switch governance on for every project on the machine,
     invisible from any of them.
   - `.claude/settings.local.json` outranks project settings and could set `governed: false`,
     disabling enforcement — and Claude Code *automatically adds that path to the global git excludes
     file* when it writes there. The override channel is one the tool actively keeps out of git.
   - Managed/MDM settings cannot be overridden at all.

   "Is this repo governed?" would stop being answerable from the repo. An opt-in whose entire
   justification is that it is committed, diffable and reviewable cannot live in a file whose
   effective value depends on a gitignored sibling that outranks it. A repo-root file has exactly one
   layer: present in `git ls-files` means governed, and nothing outranks it.

   Deriving governance from the existing `plansDirectory` value was rejected separately: free and
   already contract-tested, but it makes a blocking `Stop` hook a side effect of a setting that only
   says where plans are written.

   Note no option resists an actor with a shell — `rm -rf .planning` is already a documented total
   permit. The goal is deliberateness and reviewability, not attack resistance.
2. **`writing.json` migration.** Whether the fold-in reads an existing `writing.json` once and
   forgets it, or migrates its counters into `episode.json`. Only one consumer moves, so either is
   cheap; the choice is about what an in-flight writing episode sees across the upgrade.
3. **Whether exit writes the phase state directly** or signals via an observable event a hook
   converts, the way the CLARIFY sentinel flip already works.

## Note on how this record was produced

Written from main chat in an ungoverned worktree, which is the very condition it describes. That is
the bootstrap: the machinery cannot be used to build itself, and this document is the artifact that
makes the gap reviewable rather than merely fixed.

## Postscript: what the third-party review caught, and what is still open

The T8 live runs (`docs/t8-live-runs/`) reviewed this very change with both adapters. Both returned
`needs-attention`, and **all three findings were real**. Recorded here because the episode is the
best evidence the feature works.

- **codex** — the two documented discharge paths were one. `beat-implement` and `beat-review` both
  said "complete the review, or record an exit", but nothing wrote `phases.reviewed` or cleared
  `reviewOwed`; only `episode-exit.ts` did. A genuinely reviewed episode had to be filed as
  `abandoned`. Fixed: `scripts/beat/episode-review-complete.ts`.
- **codex** — `stop_hook_active` made enforcement one blocking prompt per turn, not a wall, while the
  prose (including this document) described a hard gate. Both fixed: the docs now say what it does,
  and a bounded `reviewBlocks` counter replaced the unconditional re-entry pass. Codex's own proposed
  fix (block until discharged) was rejected as an inescapable session.
- **gemini** — `writing-suggest-verify.ts` overwrote a malformed `episode.json`, destroying recorded
  phases and silently discharging a review debt, while its own docstring promised the opposite. The
  identical guard had been written correctly in two sibling files the same evening. Fixed.

**codex reviewed the same diff and missed the gemini finding; gemini missed both codex findings.**
That is the neutrality argument observed rather than asserted, and the clearest evidence in this
episode that two adapters are worth more than one.

Still open, and deliberately not closed overnight:

1. ~~The PreToolUse half of the transition gate~~ — **BUILT** (`hooks/episode-order-gate.ts`). Closed
   twice as impossible because every trigger looked like command-text matching. That was true of
   SHELL COMMANDS and wrong here: `preflight.ts` opens every implementation prompt with
   `TASK <id>: <name>` and `work-implement-observation.ts` already correlates on it, so recognising a
   marker this repo EMITS is a lookup rather than a guess. A new wave is now refused while a review is
   owed; the reviewer itself never carries that marker and is never blocked.
2. ~~The sentinel family cannot be retired~~ — **DONE in v5.110.0**, by registering the recorder
   skill-scoped so the scopes match. The built-in compatibility read was dropped one release later.
   `external-fixed-v1` keeps its sentinel because `clarifySentinel` is a required field of the
   published schemaVersion-1 descriptor; schemaVersion 2 already drops it and is the migration path,
   so no major version is needed.
3. ~~Bounded retry for the Stop hook~~ — BUILT. `MAX_REVIEW_BLOCKS = 3`, counter in `episode.json`.

Nothing on this list is open. The transition machinery is enforced at the moment of the action and
again at turn end, and both have a guaranteed escape.
