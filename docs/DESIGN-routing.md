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
transport), capped at `jev.timeoutSeconds`. It asks a CORRECT/WRONG question per chain candidate,
`q_<id>`, about a row summary: kind, label, agent, whether it has an `expect`, and the prompt's
sha256 and length, never the text. In `shadow` mode the scores are recorded and never change the
pick. Any failure (dead, hung, unparsable) sets `shadow.unavailable` and the row runs anyway.

**Graduation.** Jev moves from shadow to decide when its holdout AUC is **>= 0.85 on
verdict-labelled rows**: the score it gave the candidate that ran, against that row's verdict. The
switch is a reviewed edit of `jev.mode` to `"decide"` in the committed table, never a runtime flag.
In decide mode the cheapest available chain candidate (by `price.prompt`, null last) scoring at least
`jev.threshold` wins (`source: jev`). If none does, the table pick stands.

**Rule checks for code.** Jev also scores rules, not routes. `dev` declares `ruleChecks` with
`--rules constraints/jev/dev`: five rules (MOCK, WEAK, NET, SHELL, LOOP), one extractor each over the
change's diff. Rules declare a `SUBJECT`, which `rule-check.ts` puts in its preamble; discovery
is non-recursive, so `ds` still finds only its own rules. A rule is wired only when it scores its
violating fixture >= 0.85 and its compliant fixture and real clean commits < 0.5. A rule that
misses keeps its file, marked `uncalibrated` in its header, and is not wired. Calibrated
2026-10-02: all five gave >= 0.92 on violating fixtures and <= 0.09 on compliant fixtures and on
real commits f2239344 and 41c871de. Patterns an exit code can decide are not rules.
Focused or skipped tests, TLS verification off, and committed keys are the `scan` leg of
`check.sh` (`diff-scan.py`).

**Calibrating Jev rules.** `bun skills/work/scripts/rule-calibrate.ts [--set ds|dev|writing|all]
[--rule ID] [--runs 2] [--json]` scores every rule, wired and `uncalibrated`, on the committed set
in `tests/fixtures/jev/calibration.json`. A rule passes when every violating case scores >= 0.85 and
every compliant or real accepted case < 0.5, on every run. Each violating case is also scored by
every other rule in its set; a score > 0.5 is a reported cross-rule hit, not a failure. Exit 1 if a
wired rule fails, 2 if Jev is unreachable or any score is missing (never a pass), else 0. A passing
uncalibrated rule is printed "ready to wire"; wiring stays a reviewed move of its file. Nothing is
written to the repo. Run it when a rule's extractor, question or cases change, and when `jev.model`
changes. To add a real case, copy a bounded, self-contained excerpt of an accepted deliverable into
`tests/fixtures/jev/real/<RULE>-<name>/` (`before/`, `after/` with `.fixture` suffixes for `dev`),
redact contacts and secrets (the repo is public), and list it under its rule with a `source` note
(repo, path, commit, lines). The note lives in the manifest because every file in a case dir
reaches the extractor.

## Refresh

`route.ts --refresh` is the only sanctioned writer of `available`, `price` and `asOf`. It fetches
the proxy catalog and the OpenRouter price list once each, never per row, and never touches `kinds`
or `jev`. It exits 1 naming any kind whose pick went unavailable, and exits 2 with the file
byte-identical when the proxy is down. An unreachable price list leaves prices unchanged. Run it
from a repo checkout, never the plugin cache, and review the diff before committing.

**Signals.** It also records `signals` `{usageRank, intelligenceIndex, asOf}` per candidate with an
`openrouter` slug: one request each to OpenRouter's rankings dataset and the Artificial Analysis
data API. No match is null; a failed or keyless source leaves its field unchanged, warns on stderr,
and never fails the refresh. Keys are read at runtime only (`OPENROUTER_API_KEY` /
`ARTIFICIAL_ANALYSIS_API_KEY`; then the agenix secret `$XDG_RUNTIME_DIR/agenix/openrouter-api-key` /
`$XDG_RUNTIME_DIR/agenix/artificial-analysis-api-key`; else `op read` from the `Shared with Agents` vault), never written
to `routing.json`, a log or stdout. **`--propose` is advisory**: it prints suggested `kinds` changes
with a reason each (`--json` too) and writes nothing; the user approves by editing `kinds`. It never
moves the Claude defaults (judgement → opus; script, review → sonnet); rule in the `route.ts` header.

**Rank order** (user decision 2026-10-02: the AA ranking comes before popularity). Every ordering
among eligible candidates, in the pick/fallback rule and in Discovery, is: (1) `intelligenceIndex`
descending, null last; (2) `usageRank` ascending (1 = most used), null last; (3) `price.prompt`
ascending, null last; (4) table order (Discovery: the model sharing the candidate's effort suffix,
then catalog order). Price is a filter, not only a tiebreak: a replacement pick or discovered model
must cost <= the current one, but among those that do, a more-used model beats a cheaper one on an
index tie.

**Discovery.** `--propose` also asks the proxy catalog, OpenRouter's model list and AA (one request
each) for a model the proxy serves that no candidate names, of a candidate's owner and family (name
minus version numbers and effort suffix), with a strictly higher AA index at <= its prompt price (several: rank order, `usageRank` from one
more request to the rankings dataset; that source alone failing leaves usage null and discovery
running), and prints `candidate C: model <old> -> <M> (...)`. Reordering alone could never notice gpt-6-luna beside a
pinned gpt-5.6-luna. A failed source skips discovery on stderr; rule in the `route.ts` header.

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
Step to kind: an implementer is `judgement` or its task's `kind`; the verifier (only for a task with
no `acceptanceCmd`) and the scored and rules legs are `script`; the lens is `review`. An explicit
model wins. Red probes, `acceptanceCmd`s and mechanical checks are not steps and have no kind: the
dispatcher runs red-before and hashes the red suite, and `work-round.sh` runs the rest through
`work-checks.sh` after `farm.sh --workflow` returns the agents stage. The lens is ONE
`farm.sh --tasks` row of kind review whose `provider` and `model` come from `args.routing` /
`args.lens.model` — `route.ts` is not re-asked — with `expect` on its JSON.

**`lensProvider`** (CLARIFY axis 6) adds `provider` to the review row; `route.ts` answers a
kind+provider row with no model by that provider's first available candidate in the kind's chain
(`source: table`, no Jev), refusing with exit 2 when none is available. A chain with no candidate of
that provider keeps today's passthrough, so those farm rows still run (the dispatchers refuse its
null model for the lens). Under `--provider` the review row is the only `route.ts` call and its
model goes into `args.lens.model`: a normalised lens's default `'sonnet'` would beat `lensModel`.
The third-party runners retired on 2026-10-01: a cross-family lens gates; they could only advise.

`skills/work/scripts/work-outcomes.ts <run-dir>` runs from `work-loop.sh` after each accepted round
(`work-result.sh` exit 0 or 1, never 2; its failure never changes the loop's exit). It appends to
the same outcomes file a `row` per task, rowId `work:<runId>:r<round>:<taskId>`, never twice, and,
where the verifier reached the task, an automatic `verdict` (`auto: true`): `correct` iff it passed
and the task has no `redCommand` or its red pair was `red-green`, else `wrong`. The label comes from
the run's own gates, never a labelling call; no task text is written. A carried task (one outside
`args.onlyTasks`) gets no lines: its judging round wrote them. Grind and farm-team are run 3.
