# Farm-out provider routing

Design record. Settled 2026-10-01 (run 1: `route.ts`, `routing.json`, `farm.sh`; run 2: per-step
routing in `work`). Deferred to run 3: the grind runner choice, farm-team's duplicate map.

## The problem

The provider for delegated work was chosen from session memory, and it drifted: the skill said
`claude`, a memory note said gemini for bulk, and a gemini run silently resolved 11 def14a
conflicts to one side. An unpinned `--provider claude` row ran on `gpt-6.1-sol`, the wrapper's OPUS
slot. Routing is now code that every `farm.sh --tasks` row goes through.

## The pieces

- **`scripts/lib/routing.json`** is the one committed table. `kinds` maps each kind (`script`,
  `judgement`, `review`, `bulk`) to a `pick` and ordered `fallbacks`; `candidates` pin a provider
  and a full model id; `jev` holds the scorer's mode, model, threshold and timeout.
- **`scripts/lib/route.ts --row`** turns one row into one decision. A row naming `provider`/`model`
  passes through (`source: explicit`). Otherwise its kind's pick, or the first available fallback
  (`source: table`). No kind and no provider/model, an unknown kind, or no available candidate is a
  refusal, exit 2: never a silent default.
- **`farm.sh`** routes every row before running any, so one refusal stops the whole run before a
  wrapper starts. `--provider` is the legacy whole-run override (`source: flag`).

## Jev in shadow

Each table-routed row makes ONE Decisions call (`decisionsCall` from `hooks/work-hold.ts`, the one
transport), capped at `jev.timeoutSeconds`. It asks a CORRECT/WRONG question per candidate,
`q_<id>`, about a row summary: kind, label, agent, whether it has an `expect`, and the prompt's
sha256 and length, never the text. In `shadow` mode the scores are recorded and never change the
pick. Any failure (dead, hung, unparsable) sets `shadow.unavailable` and the row runs anyway.

**Graduation.** Jev moves from shadow to decide when its holdout AUC is **>= 0.85 on
verdict-labelled rows**: the score it gave the candidate that ran, against that row's verdict. The
switch is a reviewed edit of `jev.mode` to `"decide"` in the committed table, never a runtime flag.
In decide mode the cheapest available candidate (by `price.prompt`, null last) scoring at least
`jev.threshold` wins (`source: jev`). If none does, the table pick stands.

## Refresh

`route.ts --refresh` is the only sanctioned writer of `available`, `price` and `asOf`. It fetches
the proxy catalog and the OpenRouter price list once each, never per row, and never touches `kinds`
or `jev`. It exits 1 naming any kind whose pick went unavailable, and exits 2 with the file
byte-identical when the proxy is down. An unreachable price list leaves prices unchanged. Run it
from a repo checkout, never the plugin cache, and review the diff before committing.

## The outcomes file is a new state file

`~/.local/state/workflows/farm-outcomes.jsonl` (`FARM_OUTCOMES` overrides) gets one `row` line per
finished row (`rowId`, route, shadow scores, prompt sha256 and length, exit, ok, missing, toolCalls)
and one `verdict` line per `farm.sh --verdict <rowId> correct|wrong "<why>"`. Appends are single
writes, and no line holds prompt text. The boundary is load-bearing:

- **It is the labelled dataset**: the holdout that decides graduation is built from these lines.
- **It spans projects and sessions**, so it cannot live in any one project's `episode.json`, and it
  lives outside every repo, never in `.planning/`.
- **It outlives the farm-events files**, which are evicted once 60 minutes old with their pid gone.
- **Nothing existing holds per-row outcomes**: in `--tasks` mode they reached stdout only.

## Work runs

A `work` run is one host session executing `workflow.js`, which has no fs or process access, and
its `agent()` takes only a model id; the proxy routes full ids across families. So the dispatcher
routes: before `args.json` is written, `work-dispatch.sh` (and `work-redispatch.sh`, every round)
calls `route.ts --row` once per kind, labelled `work:<runId>:<kind>` (judgement, script, review,
plus bulk when a task declares it: at most four calls, never per task or step), and injects
`args.routing` `{kindModels, source: table|jev, decisions}`. The claude wrapper hosts the run and
each step names its kind's full id. A refusal for any kind blocks the round before anything runs.
`--provider` stays the whole-run override: `{source: flag, provider}`, `route.ts` not consulted.
Step to kind: an implementer is `judgement` or its task's `kind`; the verifier and every probe (red,
mechanical, third-party, scored, rules) are `script`; the lens is `review`. An explicit model wins.

`skills/work/scripts/work-outcomes.ts <run-dir>` runs from `work-loop.sh` after each accepted round
(`work-result.sh` exit 0 or 1, never 2; its failure never changes the loop's exit). It appends to
the same outcomes file a `row` per task, rowId `work:<runId>:r<round>:<taskId>`, never twice, and,
where the verifier reached the task, an automatic `verdict` (`auto: true`): `correct` iff it passed
and the task has no `redCommand` or its red pair was `red-green`, else `wrong`. The label comes from
the run's own gates, never a labelling call; no task text is written. A carried task (one outside
`args.onlyTasks`) gets no lines: its judging round wrote them. Grind and farm-team are run 3.
