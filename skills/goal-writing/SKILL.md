---
name: goal-writing
description: "Use when a session's stopping condition is being written or repaired — \"set the goal\", \"write the /goal line\", \"what should the goal be\", \"give it a goal before I go to bed\", \"write the brief for the spawned agent\", \"it stopped overnight\", \"it idled while I was asleep\", \"it asked me a question instead of continuing\", \"why did it stop\", \"make it keep working\", \"run this unattended\", \"leave it running overnight\". Use proactively BEFORE handing work to any session that will outlive the user's attention — a spawned agent, a background job, a craft dispatch left running, or this session at night. NEGATIVE ROUTING: composing a craft run's own goal is craft-dispatch.sh, which calls compose-goal.sh and needs no help; spawning the session is agent-spawn; delegating a task to a subagent is farm-out. This skill owns the WORDING of the stopping condition and the standing authority that travels with it."
allowed-tools: [Bash, Read, Edit, Write, Grep, Glob]
---

# goal-writing — a stopping condition a session can reach by working

A goal is not a description of the task. It is the **only thing standing between an unattended
session and an idle terminal**. When it closes, the Stop hook releases and the session waits for a
human. So the whole craft is: make it close at the end of the work, not in the middle, and make
everything it does not cover pre-decided.

## The night this skill is made of

Three sessions, 2026-08-27 into 2026-08-28, all stopped between 01:21 and 02:42 local, all with
4–5½ hours of unattended capacity left, **all holding a next action they had already named
themselves**. Nothing was broken. Nobody was asked anything hard.

| session | stopped | resumed on | lost | what actually stopped it |
|---|---|---|---|---|
| `mail-bridge/ab48c3a7` | 01:21 | a human typing `status` | **5h26m** | Ended a turn on "Writing the plan now." Came back with two questions: push three green commits, and how far to take a fix it had *fully diagnosed*. It wrote that it "held off on a version bump since you were asleep." |
| `npx-reconcile/49cab015` | 02:42 | `read blockers` | **4h10m** | Goal was `craft has returned a verdict` — satisfied by a hard FAIL (0/5 tasks, 20 blocking findings). It then asked: "amend and re-dispatch, or read the 20 blocking findings first?" Both branches were its own work. |
| `npx-iss-reconcile/9c82497d` | 01:42 | `commit. then investigate...` | **5h07m** | Brief said "when done or blocked, notify". 5 of 15 rounds used. It had already scoped the next defect to the row — 288 filings, 57,967 rows, 80% of the remaining off-vocabulary total — and declined it because it could not cut a faithful 40-line fixture. |

**14 hours 43 minutes.** Not one of those was a decision the user had to make.

<EXTREMELY-IMPORTANT>
## IRON LAW: NO GOAL A FINISHED STEP CAN SATISFY

**A goal names the state the WORK reaches. Never the event on the way there.**

"craft has returned a verdict", "the recon report exists", "BRIEF.md has been carried out", "the
agent has reported back" — every one of those is true while the objective is still unmet. The
moment it closes, the session stops, and if it is 02:00 the work stops for the rest of the night.

Writing a milestone-shaped goal is not caution, it is the opposite of helpful: it converts hours of
paid, unattended capacity into an idle terminal and hands the user a question they would have
answered with one word. The session that stops at 01:21 does not save the user anything — it
spends their night and then asks them to spend their morning too.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## IRON LAW: NO UNATTENDED GOAL WITHOUT STANDING AUTHORITY

**Every decision the goal leaves open becomes a question asked into an empty room.**

If the session may commit, push, pick round-2 scope, choose between two branches it named itself,
or spend the rest of its round budget — the goal says so, in one sentence, up front. A session that
holds a green, tested commit because the human is asleep is not being careful; it is making the
human the bottleneck on work the human already authorized by starting it.
</EXTREMELY-IMPORTANT>

## The four parts

Every goal has all four. Missing any one produced a stall above.

```
   ┌──────────────────────────────────────────────────────────────────┐
   │ 1. END STATE     the objective in its own terms, with a number   │
   │                  someone could dispute                           │
   │ 2. CHECK         the backticked command whose exit code settles  │
   │                  it — so running it is evidence, not a claim     │
   │ 3. ESCAPES       a work counter AND a wall clock. Either closes  │
   │                  the goal; both are things the session can read  │
   │ 4. AUTHORITY     what it may decide alone, and the SHORT list of │
   │                  what genuinely stops it                         │
   └──────────────────────────────────────────────────────────────────┘
```

**1. End state.** Not "the parser has been fixed" — `parse_status=error` is under 1% of XML-era
filings, measured on the full 31,902-filing corpus. A number a referee could argue with is a state;
an adjective is a feeling.

**2. Check.** Backticked, so its output lands in the transcript. A goal whose truth is settled by
re-reading the conversation is re-adjudicated on every stop attempt and reasoned out of — measured
four consecutive times, `craft/references/goal-and-review-gate-defects.md` §1.

**3. Escapes.** Two, because they fail differently. A counter (`jq -r .rounds args.json` reads N or
more) stops a *losing* run; a wall clock stops a *stuck* one. Rounds alone put a guaranteed stop
twelve hours out on 2026-08-19 when rounds ran 3h+ each.

**4. Authority.** See the second Iron Law. Also enumerate what is genuinely terminal — a missing
credential, a dead network, an irreversible or outward-facing action. **Everything not on that list
is the next task**, including difficulty.

## Run the lint before you set it

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/goal-lint.ts "<the goal text>" --unattended
bun ${CLAUDE_SKILL_DIR}/scripts/goal-lint.ts --file BRIEF.md --unattended
```

Exit 0 clean, 1 findings, 2 usage. Twelve rules, all decidable from the string: milestone verbs,
human-only clauses, turn counting, missing check, missing ceiling, missing counter, adjectives
where a number belongs, question marks, `done or blocked`, and — under `--unattended` — missing
standing authority and missing continuation.

It is a lint, not a review: it settles what an exit code can settle and renders no opinion on
whether the goal is *right*. Fix every critical and major before setting the goal. Run it on the
real `BRIEF.md` above and it returns 5 findings, three of which are exactly why that session slept.

**You do not have to remember to run it.** `craft/scripts/goal-self-send.sh` — the single chokepoint
every `/goal` passes through — runs it before it sends. A **critical** finding refuses the send with
exit 8, touches no transport, and names this file. Majors and minors warn and go through. What
`compose-goal.sh` emits passes silently, so craft dispatches are untouched, and `--no-lint`
overrides when you have a reason.

## The continuation rule

**When a sub-run returns and the goal is still open, take the next action. Do not propose it.**

Every stall above happened at a moment of *legitimate completion* — a verdict landed, a brief
finished, a recon report arrived. That moment is where a session naturally turns to the human. Under
an open goal it is instead the moment with the most information it will ever have, and the next
action is the one it just finished naming.

If two branches are genuinely open, pick one, state the pick and the reason in one line, and do it.
A menu offered at 02:00 is a five-hour pause with extra steps.

## Facts

- Three stalls in one night cost **14h43m**, and the *longest* — 5h26m — followed the sentence
  "Writing the plan now." The session had the plan's content in hand. Ending a turn on a stated
  intention is not a handoff; it is a five-hour gap between the intention and the work.
- `craft has returned a verdict` closed on `overallPass=false` with **0 of 5 tasks implemented and
  20 surviving blocking findings**. `craft-result.sh` exits 1 on FAIL, so a clause reading "a
  verdict" or "exits 0 or 1" is satisfied by losing. Craft's own loop is FAIL → fix → re-run;
  a goal that calls FAIL "done" stops the loop that was going to fix it.
- The 9c82497d session declined its own next task because it could not cut a *faithful* fixture
  from a 40-line excerpt. Refusing to ship a test that does not reproduce the defect was correct.
  Treating that as terminal was not: a fixture that is hard to cut is the task, and it had 10 of 15
  rounds and 5 hours left to cut it.
- `stop after N turns` counts nothing. There is no `num_turns`, no `turn_count`, no `stopHookActive`
  in the session JSONL — the clause is prose a model re-adjudicates, and it held four times that
  stopping *deliberately* disqualifies the escape while losing control would qualify. An escape that
  releases on runaway but not on a clean finish inverts what it exists to encourage.
- A human clause inside a goal made a tested, reversible bugfix wait **~18 hours** on 2026-08-22
  while the outage it repaired stayed live. Review is real and still happens — it belongs *after*
  the goal clears, as a step the session performs, not a condition it waits on.
- A wall-clock ceiling must outlast `maxRounds x a round`, not a human's attention span. A
  10-minute default against a 54-minute round printed `CEILING REACHED` with zero rounds on disk.
  Craft's defaults are **6 rounds and 720 minutes** (raised from 3 and 480 on 2026-08-28, after
  this night); rounds have measured 30–60 min here and 3h+ in mail-bridge on 2026-08-19, so six
  rounds under the old 8h made the wall clock bind before the round cap in the ordinary case.
  Borrow both unless you have measured otherwise.
- `compose-goal.sh` already emits a conforming goal for craft runs and passes this lint clean. For
  a craft dispatch, do not hand-write one — `craft-dispatch.sh` composes it.

## Red flags — STOP

| About to | Why wrong | Do instead |
|---|---|---|
| Write "has returned a verdict" / "has been carried out" / "the report exists" | Milestone: true while the objective is unmet | Name PASS, or the number the work has to reach |
| End a turn with a question mark under an open goal | At 02:00 that is a 5-hour pause | Answer it, state the answer in one line, act on it |
| Offer the user a menu — "A, or B first?" | Both branches are usually your own work | Pick, say why in one clause, do it |
| Write "when done or blocked, notify and stop" | Every difficulty becomes terminal | Enumerate the terminal blockers; everything else is the next task |
| Hold a green commit "because the user is asleep" | The goal should have pre-authorized it; if it did not, the commit is still reversible and the silence is not | Commit, and say so plainly in the report |
| Put "and the user has approved" in a goal | A session cannot close it by working — measured 18h | Move review after the goal, as a step the session performs |
| Write "or stop after N turns" | Nothing counts turns | A counter file it can `cat`, and a wall clock |
| Set a goal with no minutes in it | A stalled run has no way out | Add the ceiling and the script that prints it |
| Set an unattended goal without saying what it may decide alone | Every open decision becomes a 5-hour question | One sentence of standing authority |
| Report "N of M rounds used" and stop at N | The budget was the authorization, not the ceiling on ambition | Spend it, or say why the remainder is genuinely unusable |
| Hand-write a goal for a craft run | `compose-goal.sh` already emits a conforming one | `craft-dispatch.sh` |

## References

- `references/templates.md` — the goal template, the unattended-brief template, and the three real
  goals rewritten side by side with what each rewrite would have bought.
- `${CLAUDE_SKILL_DIR}/../craft/references/goal-and-review-gate-defects.md` — the three older,
  now-fixed defects: turn counting, PASS-unsatisfiable-after-success, and a review gate that
  accepted a rejection in words but not an approval.
- `${CLAUDE_SKILL_DIR}/../craft/scripts/compose-goal.sh` — the reference implementation. Its header
  comment is the measured history of every clause in it.
