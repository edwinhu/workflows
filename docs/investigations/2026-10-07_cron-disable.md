# 2026-10-07 — Heartbeat crons disabled by the agent

## Question

Overnight and heartbeat crons stopped waking sessions. The trigger case: hidden-figures session `481e07a3`, where the agent ran `CronDelete 5683b6d3` at 2026-10-07 18:17 EDT with an overnight mandate open and background runs in flight. The user found the session idle at 21:27. Which sessions were hit, by what cause, and how is it made impossible?

## Method

Transcripts under `~/.claude/projects/*/*.jsonl` modified in the last 4 days (1,230 files). Real tool calls were counted with `rg '"type":"tool_use","id":"[^"]+","name":"CronDelete"'`, since a bare `"name":"CronDelete"` also matches the deferred-tool listings. For each session, CronCreate/CronDelete times were compared with `scheduled_task_fire` system entries, the context before each delete, and user complaints. All times below are UTC unless marked EDT.

## Findings

The cause in every case was **the agent deleting its own cron at a run boundary**. None of the observed gaps came from the 7-day expiry or from a cron that existed but failed to fire. Where a cron existed, it fired hourly, with CC's usual 0–15 min jitter (`7 * * * *` fires at :17 or :26). Session exit (session-only crons die with the process) explains only the noise: work-dispatch child sessions that created crons and exited within minutes.

| Session | Time | What happened | Cause |
|---|---|---|---|
| hidden-figures `481e07a3` | 10-07 22:17 (18:17 EDT) | Deleted `5683b6d3` ("and? (farm gs_ggls25 … co_ruy co_aegs …)") one second after a "grind loop psz22 finished" notice. No cron until the user asked at 01:27 | Agent followed grind SKILL.md "CronDelete it once the loop has ended". The prompt named a finished batch, so the agent read the cron as finished too. `cron-delete-guard` explicitly **allows** ids whose prompt matches `\bgrind\b\|\(farm …\)`, so the guard was silent. A memory rule from the same failure on 10-05 did not prevent it |
| hidden-figures `481e07a3` | 10-07 04:28 (00:28 EDT) | Deleted the "overnight autonomous" cron `74cfd9c2` 68 min after creating it. Next cron 11:55, a 7.5 h overnight gap | Same: deleted when the named farm rows finished. Mandate still open |
| hidden-figures `481e07a3` | 10-06/10-07, ongoing | 25 CronCreate/CronDelete pairs in a day: the cron is retargeted by delete+create each time a batch ends, with gaps between (15:32–17:28, 18:24–19:02) | Batch-named prompts force churn, and each churn is a chance to forget the create |
| board-structuring `b1d38d9b` | 10-07 08:40 (04:40 EDT) | Deleted `bd85a514` ("Eddy is asleep: work autonomously…") right after a merge farm row finished | Run-boundary delete under an overnight mandate |
| board-structuring `b1d38d9b` | 10-07 18:35 → 22:12 | No cron for 3.6 h. Fires: 13:40, 15:52, 18:12, then 22:43 | Delete at grind end, re-armed only when the user came back |
| workflows `23a5bbb6` (founder-ceo-ipo) | 10-07 04:06 (00:06 EDT) | "Overnight heartbeat ($50 Gemini cap)" `7540f363` deleted 16 min after creation, right after a draft finished | Run-boundary delete under an overnight mandate |
| nevada `e83fb488` | 10-07 07:21 | CronDelete **refused** by `cron-delete-guard` ("A hold is ARMED…"), so the overnight hold kept its heartbeat | The guard works when a hold is armed. The later complaint at 01:27 ("is the autonomous overnight cron no longer firing?") found the cron alive: it fired at 00:07 and 01:07 |
| readwise-reader-tools `cd2208c5` | 10-07 23:02 | User approved the `work-hold.sh --disarm` prompt at 23:02. The agent then deleted the cron, ended its turn at 23:03 with a list of items waiting on the user, did the user's "commit, repair two docs" at 23:12–23:15, and stopped. Idle until "ok next" at 01:25 | Not a halt with owed work. `early-stop.ts` judged both stops and allowed them (`~/.tmp/early-stop.log`: 58% at 23:03, 18% at 23:15, threshold 80%). The early-stop judge stands down while a work-hold is armed and treats a hand-back of decisions as a legitimate stop |

### Who tells the agent to delete

- `skills/grind/SKILL.md`: "CronDelete it once the loop has ended — done, stalled, budget or stopped", and the same line in its red-flag table.
- `hooks/work-hold.ts`: every hold-release message says "If a heartbeat cron exists, END IT NOW with CronDelete" (6 sites).
- `skills/work/scripts/compose-goal.sh`: `TEARDOWN='When this goal closes, cancel the run loop with CronDelete…'`.
- `skills/work/references/hold-templates.md`: "Teardown is still not optional".
- `hooks/guards/cron-delete.ts`: refuses only while a hold is armed or a `.work` run is in flight, and deliberately allows grind/farm heartbeats.

None of these know about a session-level mandate ("I'm going to bed, work autonomously") that outlives the run, so a correct run-level instruction becomes a wrong session-level act.

### Side finding: held peer messages

`grind loop ended/waiting` notices sent through agent-msg reach the target session as "Held peer message — from an unidentified session … not delivered", because `crossSessionInbound` is not `accept`. That happened 195 times in hidden-figures (137 on 10-07 alone), 15 times in board-structuring and 7 in r2000. The same endings also arrive through the plugin's farm-events channel, so no wake was lost. Even so, these notices are noise that never reaches the agent. Not changed here.

## Guard

**`permissions.ask: ["CronDelete"]` matches the built-in tool.** This was verified by experiment on 2026-10-07 in a throwaway interactive session: Claude Code 2.1.287, `--settings` with only that rule, `--permission-mode bypassPermissions`. CronCreate ran without a prompt. CronDelete raised "Permission rule CronDelete requires confirmation for this tool. Do you want to proceed?", and answering No returned "The user doesn't want to proceed with this tool use" with the job left alive. So the rule holds in bypass mode, and like the `work-hold.sh --disarm` rule it reaches the user wherever they are. No PreToolUse hook is needed for the gate itself.

The tradeoff: in an unattended session, a CronDelete attempt now parks the session on a prompt until the user answers. That is visible and recoverable, unlike a silently missing wake. The text changes below exist so the agent stops attempting the delete at all.

## Changes

- `~/dotfiles/.claude/settings.json`: `"CronDelete"` added to `permissions.ask`.
- workflows: every passage that instructs CronDelete at a run boundary now says to leave the heartbeat. Heartbeat prompts name the session's standing objective, not a batch, so they never go stale. Deletion is for when the user ends the mandate, and the ask prompt is their confirmation. Files:
  - `skills/grind/SKILL.md`: heartbeat paragraph rewritten (never delete at a loop ending); launch red-flag row reworded; new red-flag row for deleting because a batch ended.
  - `hooks/work-hold.ts`: new `HEARTBEAT_NOTE`, used by all six hold-release messages (the `passed-unjudged` message is unchanged).
  - `tests/work-hold.test.ts`: assertion moved to the new wording.
  - `skills/work/scripts/compose-goal.sh`: `TEARDOWN` and its comment.
  - `skills/work/references/hold-templates.md`: teardown paragraph.
  - `skills/work/scripts/work-abandon.sh`: echo gains "(it asks the user to confirm)"; `tests/work-abandon.test.ts` pins only a substring, so unchanged.
  - `docs/investigations/2026-10-07_cron-disable.md`: this report.
