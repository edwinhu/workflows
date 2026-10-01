# The goal string and the review gate: three measured defects

Diagnosed 2026-08-13 from a live episode that could not close its own `/goal` after the work was
built, verified, reviewed and shipped. **All three are now fixed** — kept here because the failure
modes recur, and because each one is the same defect in a different costume: a signal *about* a
state standing in for the state itself.

## 1. `or stop after N turns` is prose, and nothing counts turns

`work-dispatch.sh` composes the goal as
`"... or stop after $turns turns"` from the plan's `goalTurns`. `/goal` installs a session-scoped
Stop hook whose condition is **judged by a model reading the transcript**. Searched the session
JSONL: no `num_turns`, no `turn_count`, no `stopHookActive`; the only `goalTurns` occurrences are the
values the plan itself declared. So the escape clause is a sentence re-adjudicated on every stop
attempt, not a counter.

Observed consequence: the judge found the clause satisfied on four consecutive evaluations and
reasoned its way out of each — first "the escape applies only in runaway context", finally that
stopping *deliberately* disqualifies it while losing control would qualify. A stop condition that
releases on runaway but not on a clean finish inverts the behaviour it exists to encourage.

A decidable fact (turns ≥ N) belongs to a counter, not a model judgement that reopens it on each
attempt. The one review lens runs after the checks: RED diagnoses failures and names an owner task
or `"plan"`, which the JS exposes as `planFindings`; GREEN reviews the deliverable. It never replaces
a command's exit code with a judgement about whether the command passed.

**FIXED** (`compose-goal.sh`, counter in `work-redispatch.sh`). Was: either drop the clause — an escape nothing enforces is not a limit — or make it countable:
have the dispatcher write a round counter into the run dir, increment it in `work-redispatch.sh`,
and phrase the goal against that file so the check is a `cat` whose output lands in the transcript
as evidence rather than a judgement about transcript length.

## 2. `workflow.js has returned PASS` is unsatisfiable after success

In the measured episode, `work` re-probed every task's `redCommand` at baseline. The implemented
work made those tests pass, so another round flagged them `red-not-red`; the episode ended at
`redNotRed: 5`. At the time `onlyTasks` could not be empty and there was no verify-only mode, leaving
no re-run that could satisfy a goal demanding another PASS.

The current spine carries proven `red-green` adjudications for the exact current `redCommand`
instead of re-probing them, including on FULL rounds. Changing the command drops that proof and
requires a new probe pair. It permits `onlyTasks: []` when every task has carried records. The
historical re-run dead end is repaired; the round's verdict still does not certify the whole plan's
goal. See the current skill's hold rules.

**FIXED** (`compose-goal.sh` names the review gate's verdict). Was: phrase the goal against an observable that survives success. Since `work-result.sh`'s exit
code is now the verdict (0 pass / 1 fail / 2 refused), `"work-result.sh exited 0 for <plan>"` is
both decidable and stable, where "workflow.js returned PASS" is neither.

## 3. The review gate accepts a rejection in words but not an approval in words

`human-review-gate.sh` recognises `\bREJECT\b` in a comment (`:82`) and returns `rejected`. There is
no `\bAPPROVE\b` counterpart. The verdict logic (`:100-102`) makes **any** comment `findings`, and
returns `approved` only for files marked reviewed with **zero** comments.

So a reviewer can reject with one word, but cannot approve with any number of them. In the episode
above the human wrote "looks good to me, ship" and then "all good"; both registered as outstanding
work, and the goal's approval clause could never close. The gate was measuring the interaction, not
the judgement.

**FIXED** (`review-verdict.py`, imported by the gate). Was: an `\bAPPROVE\b`/`\bLGTM\b` token symmetric to `REJECT`, taking precedence over the
comments-imply-findings rule. Guard it the way `REJECT` is guarded — anchored word boundary, human
authors only, comments created after launch — so a quoted "LGTM" in a code diff cannot approve a
review.

**Note for whoever fixes this:** if a blocked session is what surfaces the defect, that session has a
stake in the repair. Land it from a session with no goal riding on the outcome, or have the fix
reviewed by someone who has none.
