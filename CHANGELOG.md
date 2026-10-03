# Changelog

## [6.37.7] - 2026-10-03

### Changed

- **work-hold releases a read-only run that PASSED** (`loop.exit 0`) as `verdict-reached` instead of sending its goal to the judge, which had scored a met read-only audit at 31%; a writing run's PASS is still judged. (f46d1cdb)

## [6.37.6] - 2026-10-03

### Changed

- **plan-lint R19 exempts an acceptance that is the task's own redCommand,** so a chain's terminal task can spell out its gate command lint-clean instead of the anaphor "that same command exits 0". (7f55a303)
- **work-hold writes nothing in the project tree by default** (the `autoCompactWindow` cap is now opt-in via `WORK_HOLD_COMPACT_WINDOW`), **and drops a held run that died without a verdict**, judged from its farm-events pids; `--brief` marks it `DIED`. (c9c4e479)

## [6.37.5] - 2026-10-03

### Added

- **Canary release gate.** `scripts/canary.sh --run` drives a real read-only diagnose and a real dev round end to end and fails on any tool error line, a vacuous leg, W=0 tokens on a row with tool calls, or a run with no START/DONE in the watcher stream; a failing canary blocks the tag. (404450be)

### Changed

- **`farm.sh` prompts go on stdin and the watchdog counts tokens,** so a long brief no longer dies with E2BIG and a row with tool calls no longer records W=0; the red suite skips untested dirs and secrets. (11a086ac)
- **A readOnly work run stops at its verdict (exit 8) and the hold releases;** `farm.sh --workflow` rounds run with `--no-cron` (one run, one backstop); plan-lint lints a plan `.md` through its `work:dispatch` block. (cdbe8524, 7470da76, 124ea8f8)
- **Every check command is told the run mode** (`WORK_READ_ONLY`). (37e898fb)
- **Rule verdicts name their lines.** A VIOLATED verdict carries its rule's file:line spans, every wired workflows rule declares SPANS, and work-loop prints verdicts by rule, p and verdict instead of `(unnamed)`. (b331c733, da5351d3, e694784f)
- **The prose hook attributes a Bash result to the file it names,** reports each finding once and skips course material; the typst-convention guard judges an Edit on the lines it changed, once per session. (1319854d, 4b1b6a6a)
- **work: approval-gated pending, run dirs found anywhere, one hold per run,** and the review gate never hangs silently. (57689d3a)
- **work-redispatch runs a task-routed fix beside plan-routed items;** plan-lint refuses acceptance clauses that name a lens or rule verdict. (08c2a2d9)
- **work-hold judges a run's goal on its `result.json` facts,** counts dispatched rounds, and gives no redispatch advice into a Tier 1 refusal. (4acfc0b8)
- **The watcher writes a liveness beacon,** so a session with no mods loaded is no longer trusted to wake; session-start says loudly when plugin mods did not load (remedy: `/reload-plugins`). (e686a3f1, 43587025)
- **Work run state lives under `~/.local/state/work`;** a test fails any new reference to the retired craft run root. (7a19732d)

## [6.37.4] - 2026-10-02

### Changed

- **Every round gets an honest outcome label.** `work-outcomes.ts` writes a verdict for every task of every accepted round: wrong when the round's checks failed for the task (verifier or acceptance, missing verifier, red pair, unfinished implementer, a `digest.json` failure or lens route it owns) or a critical/major lens finding it owns stands. The verdict carries kind, model, checks and finding ids. (ac1701a6)
- **`farm.sh` records wrong verdicts for missing-artifact and GONE rows, and keeps the child's exit code.** A row whose expect artifact is missing, or whose child ends with no result event, now appends an automatic wrong verdict; `wait || true` had made every recorded exit 0. (ac1701a6)
- **Jev routing shadow scores retired.** `route.ts` drops the shadow (no content in its state, flat 0.19-0.39 scores) and refuses a table carrying `jev`; new `route.ts --outcomes` reports rows, wrong rate and top failing checks per kind x model. Reason in `docs/DESIGN-routing.md`. (ac1701a6)
- **The suite is green.** parse_def14a_own's python suites are gated in `tests/pytest-extra.txt`; agent-contract and the unlinked-agents check accept a `~/.claude/agents` link into the main checkout of the same repo (`hooks/lib/main-checkout.ts`), so they run in a worktree. (e9a37e94)
- **workshop-reviewer reads its real corpus and defers to wired checks,** with a corpus-glob guard test. (47f6fac3)
- **`CLAUDE_CODE_EXECPATH` reader guard.** `tests/execpath-readers.test.ts` fails any new code line reading the variable outside `runningClaudeExe`; session-start and early-stop were the only readers. (eb8a014c)
- **Jev parked and retired rules.** `T-ECHO` retired (the script owns its lexical cases, `T-ECHO-PARA` its paraphrase cases); `T-ECHO-PARA` parked at twin 0.91-0.96, real decks <= 0.23, but legacy-base bad cases 0.85-0.90 and a paraphrase 0.70-0.75; `T-TAKEAWAY-WH` stays parked at vio 0.85-0.88 against the 0.90 margin. (aec73430, 0a3d3a89)
- **elide-case `retrieve` stays serial** (one shared Westlaw browser, delivery queue and Downloads directory), with a P17 `ignore-serial-loop` exemption; two retired script paths in the implementation notes are marked so wc-probe P2 passes. (8345a80f)

## [6.37.3] - 2026-10-02

### Changed

- **early-stop and session-start read the running Claude version from the hook's parent process,** not an inherited `CLAUDE_CODE_EXECPATH`. A session resumed from an uninstalled binary carried a stale value, so `watcherActive()` was false and the Stop hook blocked with owned farm runs live; the binary that spawned the hook (directly or through `sh -c`) is used, with `CLAUDE_CODE_EXECPATH` as the fallback. (0c324db3)
- **Jev typst rules wired.** `T-TAKEAWAY` is wired, with embedded-question subtitles split to the parked `T-TAKEAWAY-WH` and a gerund flag that firms the margin; `T-TRANSITION` is wired on the first and last sentence across the break. (f6e04ac2, b9fcb186, bda98698)
- **`T-NARRATE` became a script.** It was decidable, so the screen-phrase lexicon runs as the computed NAR row of the workshop checks (`workshop-deck.py`) instead of a Jev rule. (c662d5ec)
- **Parked rules.** `T-ECHO` stays parked, now with the SB 21 legacy real pair; `T-TRANSITION` was parked with measured numbers before it was wired. (2a0aa2f8, 5cea6d2c, 72028d48)
- **`EX-SENTINEL` retired (doc residue)** and `EX-ORPHAN` wired, with a workflow-creator fact row; the `jev-rules` skill references (triage, diagnosis, calibration) are updated to match. (27584191, fe5f99b8)

## [6.37.2] - 2026-10-02

### Added

- **The `jev-rules` skill: turn a written rule into a calibrated Jev rule check.** Triage (script before Jev), the extractor contract, the one-proposition form, twins and real accepted cases (legacy-base pairs), the wiring criterion, and a failure-diagnosis table built from the 2026-10-02 rule sets. `skills/jev-rules/scripts/new-rule.ts <set> <ID>` scaffolds the module in `uncalibrated/`, placeholder twins, the calibration-manifest entry (written in the manifest's existing shape) and a stub test, refusing to overwrite. `--wire` moves the module only after two passing `rule-calibrate --rule` invocations, a third when a score sits within 0.03 of a bar, and refuses on a TODO, a placeholder twin or a cross-rule hit. `rule-calibrate.ts` exports `caseInput` for the stub tests.

### Changed

- **A guard denies a multi-file `bun test` without `--parallel`** (`bun-parallel-guard`, in the guards mod). (aa570cfe)
- **wc-probe P14-P18 and P15 gating.** Probe rules R1-R5 and the 2026-10-02 fact rows land in workflow-creator; P15 duplicate grading leaves ADVISORY_RULES (baseline zero after the ds and teaching notes changes) and now gates, with D38 and two new cases. cite-check tests use per-test temp dirs (P18). (45c63e3d, 96b10c80, b778fcb7)
- **workflow-creator links the `jev-rules` skill.** (bc52d937)
- **Jev typst rules judge only the added span; `T-STORY` has a firm margin.** (2242d11d, b3db6917)
- **ds lens defers to Jev rule verdicts.** M1, UNI, DEN, R1, DQ4 and DQ6 are no longer re-graded by the model lens; DEL stays model-evaluated, and the two broader judgements are stated as such. (34f6e336)
- **early-stop allows the stop while owned farm runs are live,** when the watcher mod is running here (CLI entrypoint, Claude Code >= 2.1.287); otherwise unchanged. (d3027a48)
- **Python suites run under pytest-xdist** (`-n auto`). (9c69cfad)
- **No test writes into the repo tree; `scripts/test.sh` guards it.** agent-contract, read-guard, mod-guards-parity and local_runner_test fixtures moved to temp dirs; check.test.ts's wc-probe leg and route-refresh's timezone case fixed; the suite sets PYTHONDONTWRITEBYTECODE and fails on any path the run creates, changes or deletes in `git status`. (77ec49d7)

## [6.37.1] - 2026-10-02

### Changed

- **A guard denies a multi-file `bun test` without `--parallel`.** `hooks/guards/bun-test.ts`, run in the guards mod on Bash (`bun-parallel-guard`): `bun test` over several paths, a directory or name filter, a glob or the whole repo, with no `--parallel`, is denied with the remedy (`bun test --parallel ...` or `scripts/test.sh`, TMPDIR outside `~/.tmp`). A single file, `--help`, `--parallel`, `scripts/test.sh` and harnesses that run bun internally pass, and a target the text cannot settle (a variable, a substitution, a quoted glob, `xargs`) is allowed. bun 1.4.0 has no bunfig or environment default for `--parallel` (`[test] parallel = true` is silently ignored), so the flag is the only switch. A serial run took 661-881 s from `~/.tmp` vs 63 s parallel.
- **Jev `A-PAD` exempts fact rows and is wired.** A line, list item or table row carrying a number, threshold, measurement, date or named incident that backs a rule the file states is a fact row, never padding; narrated history with no number or incident, and restated rationale, still are. The extractor reads list items one at a time and reports `fact_row` and `backs_rule` per passage. Moved out of `constraints/jev/authoring/uncalibrated/` after two consecutive `rule-calibrate --set authoring --runs 2` passes (the accepted State Files doctrine now 0.21-0.31, the violating twin 0.98).
- **Jev `L-SUPRA` is wired and follows Bluebook rule 4.2.** Moved out of `constraints/jev/legal/uncalibrated/`. An unenacted bill and a statute cited through an institutional author may not take supra. A Federal Register final or proposed rule is a regulation (rule 14.2(a)), so it takes no supra either: its short form is the rule 14.6(c) form (`Title, 60 Fed. Reg. at 50381`) when the rule was cited in the same footnote or one of the five before it, and the full cite otherwise. A release outside the Federal Register (no-action letter, litigation release) may still take supra. Kind hints gain `release` and `Fed. Reg.`, split hearings from bills, read `General Corporation Law Section N` as a statute and no longer read `U.S. 426` as the bill `S. 426`. New real cases: the Mirror intro (fn 6, `119th Congress, supra note 3`) and the OPV article (fn 20, `2020 SEC Regulation, supra note 4`) are violating, each with a compliant twin that changes only that span. `rule-calibrate --set legal --runs 2` passed both times.
- **Jev `T-CALLOUT` and `T-STORY` gate changed lines and are wired** into workshop's `ruleChecks`. The typst extractors already listed only spans on the round's changed lines; the calibration now matches: accepted decks and notes that break a written rule are legacy bases, each with a new violating and a new compliant span. Two consecutive `rule-calibrate --set typst --runs 2` passes. `T-TAKEAWAY`, `T-NARRATE` and `T-TRANSITION` stay parked with the measured numbers in their docstrings.

## [6.37.0] - 2026-10-02

### Mods

- **A watcher mod replaces the `farm-runs` plugin monitor.** `hooks/watch/watcher.ts` (registered from `hooks/register.ts`, now the plugin's one hooks module, which composes it with bulk-guard: `modules` takes a single path per plugin) reads this session's `$TMPDIR/farm-events/<session>/` on a 15 s timer that restarts with every session start and reload, which the monitor never did: a finished run once woke nobody for hours. It keeps one status line while farm runs, work rounds or grind loops run (`farm: 2 running (ds-rules 43m, …) · work <run> round 2/3 2/5 checks 6m`), wakes the session ONCE per run on `DONE` or `GONE` through `$.prompt.submit` (remembered in `$.store`, so a reload never re-wakes), and adds `/farm`, an immediate table of label, state, elapsed, artifact and report. Headless sessions and farm children (`FARM_OUT_CHILD=1`) register nothing. Kit tests: `scripts/mod-test.sh`.
- **The plugin's tool-call guards run in-process as a mod.** `image-read-guard`, `read-guard`, `suggest-compact`, `pgrep-self-match`, `cron-delete-guard` (both halves), `atomic-constraint-guard`, `typst-convention-guard` and `validate-skill-paths` now run on `tool.call` in `hooks/guards/mod.ts` instead of spawning `bun` per call from `hooks.json`: about 300 ms of process spawns per tool call become about 1 ms. Each guard's logic moved once into a node-free module under `hooks/guards/`, which both the mod and the settings-hook scripts import. A guard can only deny or add context, never approve (no `tool.check`); a crashed pre-call gate denies, as `denyOnCrash` did. `tests/mod-guards-parity.test.ts` replays every input the existing suites feed these scripts into the script, the mod handler and the pre-port script, and requires the same deny, context and files. `find-slide-page-inject`, `lint-check`, `writing-prose-check`, `cite-fidelity-lint`, `overflow-check` and `pr-url-logger` stay settings hooks: they spawn external tools or are async side effects.
- **The plugin requires Claude Code >= 2.1.287.** Eight guards and bulk-guard now run only as a mod. `plugin.json` has no minimum-version field (`claude plugin validate` reports `engines`, `minClaudeCodeVersion`, `claudeCodeVersion` and `minVersion` as unknown fields Claude Code ignores), so `hooks/session-start.ts` reads the running binary's version from `$CLAUDE_CODE_EXECPATH --version` and, below 2.1.287, leads the context with a GUARDS INACTIVE section and sends the user a `systemMessage`.
- **An advisory per-edit Jev mod: `hooks/jev/`.** After an Edit, Write or MultiEdit lands, the file is scored against its rule set's wired Jev rules (prose `.md`/`.typ`/`.tex` → `constraints/jev/writing`; test files and shell scripts → `constraints/jev/dev`; any other `.py` under a `.planning/ACTIVE_WORKFLOW.md` saying `workflow: ds` → `constraints/jev`) and each rule at p(VIOLATED) ≥ 0.85 adds one line to the tool result: `Jev <ID>: <file>:<lines> — <statement> (p=…)`. Scoring is one `rule-check.ts --batch` run per edit: the set's evidence.py with the edit's changed lines on stdin, then ONE Decisions call for all its rules through `decisionsCall` (new `scoreRulesBatch`; the per-rule path is unchanged). At most one evaluation per file per 10 s; edits inside the window are deferred to its end and their lines ride the next tool result. Never a deny or an approval; any failure adds nothing and logs to debug. On in interactive sessions; headless only with `JEV_EDIT_MOD=1`, which `work-round.sh` sets for the AGENTS stage; `JEV_EDIT_MOD=0` turns it off.
- **The farm-events stream carries a start time and the work loop.** `START` lines from `farm.sh` and `work-round.sh` end in `t=<epoch seconds>`; `work-loop.sh` files `START work-loop out=<run>/loop.exit` and a `DONE work-loop rc=<exit>` from its EXIT trap, so a killed detached loop reads as `GONE`.
- **Removed: `monitors/monitors.json` and `skills/farm-out/scripts/farm-monitor.sh`.** The mod covers `DONE` and `GONE` for farm, work and grind runs.

### Jev rule sets

- **Jev register rules for law review and finance prose: `constraints/jev/legal`, `constraints/jev/econ`.** Scored on top of `constraints/jev/writing` when a writing plan's `Domain:` is `legal` or `econ` (`rule-check.ts --rules` now repeats), and by the per-edit Jev mod for prose under an `ACTIVE_WORKFLOW.md` carrying `style: legal|econ`. Wired after two consecutive live calibrations: `L-ID`, `L-FNARG`, `L-DIGEST`; `E-WEFIND`, `E-CITEFORM`, `E-CAUSAL`, `E-MAGNITUDE`. `L-SUPRA` stays uncalibrated. The extractors read Markdown, Typst and LaTeX footnotes and score only changed lines when there is a diff. `writing_style_check.py --style legal` adds `INLINE-CITE` (a full citation in body text) and flags `This paper`.
- **Authoring rules for skill, plugin and workflow edits: `constraints/jev/authoring`.** Five calibrated rules over the changed lines of SKILL.md, agent/command `.md`, CLAUDE.md, manifests and `.planning/`: `A-DESC` (process summary in a description), `A-FLAG` (intention-targeted red flag), `A-SOFT` (softened Iron Law), `A-GATE` (judgement gate or loop exit), `A-STATE` (new state file or `.planning` noun with nothing retired). `A-PAD` stays uncalibrated. Wired as workflow-creator's `ruleChecks`, a run step in skill-creator and plugin-creator, and the per-edit mod; the string-decidable residue is `authoring-lint.ts`, a seventh `check.sh` leg.
- **Typst deck and talk-notes rules: `constraints/jev/typst`.** `T-HOLLOW` (a notes bullet announcing content the notes never write out) is wired for workshop `ruleChecks` and the per-edit mod; six more sit in `typst/uncalibrated/` with the measured reason in each docstring. `workshop-deck.py` adds a computed `VSL` check and `NOTE` now fails a notes section with no spoken line.
- **Casebook-excerpt rules for elide-case: `constraints/jev/elide`.** `EL-HOLDING`, `EL-GAP`, `EL-VOICE`, `EL-EMPH`, `EL-NOTE`, each passing rule-calibrate twice; the decidable residue is a `check-marks.py` leg (one bracketed-ellipsis spelling per addendum, footnotes renumbered and paired).
- **The per-edit mod scores teaching files against the teaching plugin's sets.** Lecture notes and decks map to `constraints/jev/notes` and `constraints/jev/slides`, exam question files to `constraints/jev/exams` (`$TEACHING_PLUGIN_ROOT`, else `~/.claude/skills/teaching`); an absent set falls back to writing. `rule-calibrate` resolves a manifest's paths against its `root`, so a plugin keeps its calibration set in its own tree.
- **ds: DQ4/DQ6 gate only changed lines, and A1 is recalibrated.** `rule-check` passes `git diff -U0 HEAD` ranges to `evidence.py`; `rule-calibrate` gains a per-case `base`. A1's extractor inventories code only (comments and docstrings out), with new vio2/sat2 fixtures and a real accepted case.

### Work

- **work-stage digest rows are exempt from P7 refs**, so the unperturbed work skill passes its own wc-probe leg.

### Tests

- **The suite runs in parallel: `scripts/test.sh`.** `bun test --parallel` with a per-run TMPDIR under `/tmp` and a wall-clock cap: ~112 files in ~67 s against 661-881 s serial.
- **A leak guard.** Fixtures go through `tests/helpers/tmp.ts`; `scripts/test.sh` fails the run when anything but `farm-outcomes.jsonl` and uv's locks is left in its TMPDIR.
- **Every sync spawn under `tests/` and `skills/work` carries a timeout**, held by `tests/sync-spawn-timeout.test.ts`. gate-vacuity gates the tree under test rather than the main checkout and runs in half the time.
- **Tests no longer write the real `farm-outcomes.jsonl` or the caller's event stream.** `hermeticEnv` and the farm-events tests pin `FARM_OUTCOMES` to their sandbox; `farm-runner.test.ts` pins `TMPDIR` and the session id.
- **suite-lint cites findings by file and test name, not line.**
- **The plugin-validate golden is re-recorded** for the guards' move into the mod and the Jev mod's `cursorAt`.

## [6.36.0] - 2026-10-02

Shipped without a changelog entry; recorded here.

### Added

- **Jev rule checks run in the shell.** `work-checks.sh` scores a plan's `ruleChecks` in the round's mechanical stage instead of `workflow.js`.
- **`rule-calibrate` and a committed calibration set.** `tests/fixtures/jev/calibration.json` lists every rule's cases; `skills/work/scripts/rule-calibrate.ts` exits 1 when a wired rule misses violating >= 0.85 and compliant/real accepted < 0.5 on every run, 2 when Jev is unreachable.
- **Jev rules for code (`constraints/jev/dev`: MOCK, WEAK, NET, SHELL, LOOP) and prose (`constraints/jev/writing`)**, plus a `diff-scan.py` leg in dev's `check.sh` and `writing_style_check.py` for writing.
- **The bulk-guard mod enforces the gemini-batch rule at the tool call**: per-document reading at scale, template farm-outs, per-item agent-CLI loops and model-API loops are denied with a pointer to one gemini-batch job; oversized results are trimmed with the full output saved.

### Changed

- **ds Jev rules recalibrated.** A4, DEN, DQ4, DQ6, E7, M1, R1 and UNI re-wired after two live runs; DQ1 stays uncalibrated. Shared extraction moves to `constraints/jev/_ds.py`.

## [6.35.2] - 2026-10-02

### Changed

- **`route.ts --propose` ranks by Artificial Analysis index, then usage, then price.** Every ordering among eligible candidates, in the pick/fallback rule and in discovery, is `intelligenceIndex` descending, then `usageRank` ascending, then `price.prompt` ascending (null last at each step), then table order. Price stays a filter: a replacement pick must cost no more than the current one. Rule recorded in `docs/DESIGN-routing.md`.

- **`routing.json`: `luna` moves from `gpt-5.6-luna` to `gpt-6-luna`** (index 37.3 → 38.1, prompt price 2e-7 → 1e-7, completion 1.2e-6 → 5e-7).

### Added

- **`route.ts --propose` discovers newer same-family models the proxy serves.** It asks the proxy catalog, OpenRouter's model list and Artificial Analysis for a model that no candidate names, of a candidate's owner and family, with a strictly higher AA index at no more than its prompt price, and prints `candidate C: model <old> -> <new>`; it still writes nothing. A failed source skips discovery with a note on stderr, and a failing rankings request alone leaves usage null. `tests/route-discover.test.ts` covers it; the OpenRouter and Artificial Analysis keys keep falling back to their agenix secrets.

## [6.35.0] - 2026-10-02

### Changed

- **A plan's `lensProvider` (`claude` | `codex` | `gemini`) replaces the third-party runners.** The review lens row goes to `route.ts` constrained to that provider, so the lens runs the provider's pinned review candidate (codex `gpt-6.1-sol`, gemini `gemini-3.8-flash-high`); under `--provider` the decision lands in `args.lens.model`. `workflow.js` refuses `thirdParty` and `thirdPartyEffort`, and the advisory runners, their return key, their score field and `skills/work/references/third-party.md` are gone.

- **`work`'s checks run in the shell, not as agents: a 4-task round drops from 16 agents to 5.** Red probes, acceptance commands, mechanical checks and a red-suite hash check run in `work-dispatch.sh` before the round and `work-checks.sh` after it; `work-stage.mjs` builds a digest the single lens reads as one routed review row. `workflow.js` runs the implementers, plus a verifier only for non-command acceptance. `work-result.sh` keeps its gate semantics.

### Added

- **`route.ts` records usage and quality signals, proposes `kinds` changes, and Jev scores only the chain.** `--refresh` writes `signals` `{usageRank, intelligenceIndex, asOf}` per candidate from OpenRouter's rankings dataset and the Artificial Analysis data API; keys are read at runtime only (env, then for OpenRouter the agenix secret `$XDG_RUNTIME_DIR/agenix/openrouter-api-key`, then `op read`) and never written. `--propose` (`--json` too) prints advisory `kinds` changes and never writes the table; the Claude defaults (judgement → opus; script, review → sonnet) are never proposed away. Jev now scores only the kind's pick and fallbacks.

## [6.30.0] - 2026-09-29

### Changed

- **`work`'s heartbeat cron is ON BY DEFAULT, hourly (`7 * * * *`); `--no-cron` opts out.** A cron survives `--resume`/`--continue` and a watcher that died or was never armed; the `farm-runs` monitor and background tasks do not. The tick is a few-word nudge and a tick mid-round is allowed through uncounted by the hold, so hourly is cheap. `--cron` is still accepted as a no-op alias, and `WORK_LOOP_INTERVAL_MINUTES` still sets the period (`120` → `7 */2 * * *`). With `--no-cron`, the printed wake line says the monitor is the only wake.

- **`craft` is gone as a name; everything it spelled is now `work` — read both spellings, write only the new one.** Renamed across 74 files: the plan arming marker `<!-- craft:dispatch -->` → `<!-- work:dispatch -->`; the run directory `$PWD/.craft/` → `$PWD/.work/`; every `CRAFT_*` environment variable → `WORK_*` (`WORK_FARM`, `WORK_DISPATCH_DRYRUN`, `WORK_GOAL_PRINT`, `WORK_NO_SCOPE`, `WORK_SYSTEMD_RUN`, `WORK_LOOP_POLL`, `WORK_LOOP_SETTLE`, `WORK_LOOP_INTERVAL_MINUTES`, `WORK_GOAL_MAX_HOURS`, `WORK_GOAL_MAX_MINUTES`, `WORK_PLAN_LINT`, `WORK_RED_PROBE_TIMEOUT`, `WORK_MECH_PROBE_TIMEOUT`, `WORK_SUITE_LINT_BUN`, `WORK_SUITE_LINT_TIMEOUT`, `WORK_SUITE_LINT_BUDGET_MS`, `WORK_REDISPATCH_DRYRUN`, `WORK_ALLOW_CRON_DELETE`); the documented scratch root `~/.local/state/craft` → `~/.local/state/work`; and the prose, comments, skill descriptions and marketplace copy. The `"craft this"` and `"/craft"` triggers are removed from `skills/work`'s description.

  **The transition is asymmetric by design: every reader accepts BOTH spellings, every writer emits only `work`.** The legacy reads, each commented `legacy:` at its site —
  - **marker**: `work-dispatch.sh` (4 parse sites), `work-redispatch.sh`, `work-pending.sh` (regex + `grep -E`), `work-amend.sh`, `plan-lint.ts`, `hooks/lib/writing-plan-context.ts` all match `(?:work|craft):dispatch`.
  - **run directory**: `hooks/cron-delete-guard.ts` and `hooks/session-start.ts` scan a shared `RUN_ROOTS = [".work", ".craft"]` and carry which root each run came from into their messages; `work-pending.sh` reads `abandoned` and `*/args.json` under both; `hold-lint.ts`'s round-verdict rule matches `.(work|craft)/`. A run already living under `.craft/` therefore keeps working end to end — `work-redispatch.sh` rotates it in place, because it is handed the run directory. **New runs are only ever created under `.work/`.**
  - **env vars**: one shim, `skills/work/scripts/legacy-env.sh`, sourced by the six shell entry points. It promotes each still-set `CRAFT_*` name onto its `WORK_*` successor; the new name always wins when both are set. The two TypeScript readers fall back inline. `skills/work/scripts/compose-goal.test.ts` proves the fallback for `CRAFT_GOAL_MAX_MINUTES` and `CRAFT_GOAL_MAX_HOURS`, and proves `WORK_` precedence.
  - **capability**: `craft-spine-runner` was renamed to `work-spine-runner`, and the old id is **retained as a declared deprecated alias** in `.claude-plugin/capabilities.json` resolving to the same `skills/work/workflow.js`. Schema 1 has no deprecation field, so the alias is a second capability entry; it is documented as such in `docs/extension-contracts.md` and asserted by `tests/public-extension-contract.test.ts`. **Not a breaking change** — a consumer pinned to the old name still resolves.

  **When the legacy reads come out.** All of them go in one later change, gated on two conditions together: `scripts/migrate-craft-to-work.sh <roots>` reports zero remaining `craft:dispatch` plans across `~/projects` and `~/areas`, **and** no `.craft/` run directory holds an `args.json` without a `result.json` beside it. The capability alias is separate and outlives them — it comes out at the next major version. Not yet migrated at the time of this entry, measured 2026-09-28 over `~/projects` and `~/areas`: **163 `.md` files** carry the legacy marker, and **20 `.craft/` run roots** hold **129 runs, 7 of them still in flight** (no `result.json`) — including one dispatched the same day. Those seven are exactly why the run-directory read is two-rooted rather than a rename.

- **`scripts/migrate-craft-to-work.sh`** rewrites `craft:dispatch` → `work:dispatch` in `*.md` plan files under the roots given to it. **Dry run by default** (prints `file:line`); `--apply` writes. It refuses with no root argument rather than defaulting to `$PWD`, and skips `.craft/` run directories (their `args.json` is hashed, so a run in flight must not be touched) and anything under `.git/`. It rewrites only that one token — run directories, env vars and prose are left alone, because every reader still accepts them.

- **`~/dotfiles`, outside this repo, still needs two follow-ups.** Its `.gitignore` should add `.work/` alongside `.craft/`. And `~/dotfiles/.claude/hooks/work-goal-resend.sh` — a SessionStart reporter that this repo tests but does not ship — still reads only `$PROJECT_DIR/.craft` and `CRAFT_SKILL_DIR`; `skills/work/scripts/work-goal-resend.test.ts` is deliberately left on the legacy spelling so it keeps exercising the hook as it actually is.

### Removed

- **The `hound` skill, and the name with it.** The mechanism it owned is unchanged and is now `work`'s: `hooks/hound.ts` → `hooks/work-hold.ts` (both `hooks.json` entries follow), `skills/hound/scripts/hound-arm.sh` → `skills/work/scripts/work-hold.sh` with `--status/--disarm/--run/--goal/--rounds/--minutes` semantics untouched, `skills/hound/scripts/hold-lint.ts` → `skills/work/scripts/hold-lint.ts` (now a sibling of `plan-lint.ts`, which shells out to it), and `skills/hound/references/templates.md` → `skills/work/references/hold-templates.md`. The per-session state and ledger in `TMPDIR` are `work-hold-<session>.json` / `.releases.log`; the env vars are `WORK_HOLD_*` (`WORK_HOLD_COMPACT_WINDOW`, `WORK_HOLD_DECISIONS_MODEL`, `WORK_HOLD_DECISIONS_THRESHOLD`, `WORK_HOLD_AGENT_MSG`, and the rest); every log and block message is prefixed `hold:` where it read `hound:` or `until:`. **No shims and no old-path stubs** — nothing depended on the old names, so keeping them would have been two spellings for one file. `skills/hound/SKILL.md` is deleted and what was still load-bearing in it — the check-command rules, the hand-arm for a session that is not dispatching, the three release layers, the `passed-goal-met` / `passed-unjudged` distinction, the continuation rule, and nine red-flag rows — is in `skills/work/SKILL.md`'s Phase 3 (832 → 899 lines). `tests/hound.test.ts` and `tests/hound-compact-cap.test.ts` are `tests/work-hold*.test.ts`. **Callers updated, not aliased**: `work-dispatch.sh`, `work-abandon.sh`, `plan-lint.ts`, `cron-delete-guard.ts`, `jev-rank.ts` (which imports `decisionsCall` from the hook), `grind`, `visual-verify`, `using-skills`' routing table and `docs/skill-scoped-hooks.md`. **After this lands, the `permissions.ask` rules in `~/.claude/settings.json` still name the old spellings** — `*hound-*.json*`, `*hound-*.releases.log*` and `*hound-arm.sh*` — and must be rewritten to `work-hold-`/`work-hold.sh` or the third layer of the release guard matches nothing.

- **The `/goal` self-send transport, which queued a line into this session's own pane and missed roughly a quarter of the time.** `skills/work/scripts/goal-self-send.sh` wrote the command to a queue file and detached `goal-send-drain.sh`, which typed it only once the pane went IDLE — and a session that has just dispatched a run is mid-turn and then works back-to-back, so the window often never opened. Its own measured record: `/goal` landed 127 times and missed 36, `/loop` landed 52 and missed 29. It failed live on 2026-09-17, the `/loop` send exiting 0 while `goal-verify.sh` warned it never confirmed and `CronList` showed no job. Deleted with it: `goal-send-drain.sh` (no caller but the sender), `goal-verify.sh` (it answered "did the send land?", a question that no longer exists — it read the drainer's `.unconfirmed` record and the transcript for `Goal set:` receipts, and its only other consumers were this transport's own docs), and the four suites that existed to exercise the transport — `tests/self-send-loop.test.ts`, `tests/self-send-transport.test.ts`, `tests/goal-self-send-lint-gate.test.ts`, `tests/goal-verify.test.ts` — plus `tests/goal-send-drain.test.ts`. Neither replacement needs a transport: `skills/until/scripts/until-arm.sh` writes a state file `hooks/until.ts` reads on every Stop, and `CronCreate` is a model tool; both land inside the turn that raises them. `skills/until/scripts/cron-prompt-lint.ts` was KEPT — `skills/until/SKILL.md` documents it as the tool for reviewing a heartbeat's text, `tests/cron-prompt-lint.test.ts` exercises it directly, and `work-dispatch.sh` now runs it on the tick text it prints, so it has a gate position rather than none.


- **Four checkers nothing ran, and one of them passed vacuously.** `scripts/checks/check-claim-id-traceability.py`, `scripts/checks/check-progressive-expansion.py`, `scripts/check-npx-linking.sh` and `scripts/check-tests.sh` had no caller in any of the four plugin repos — verified by an invocation-shaped `rg` over `~/projects/{workflows,typst,teaching,plugin-utils}`, which returned only docstring and CHANGELOG mentions. Run bare, claim-id-traceability printed `PASS: … no PRECIS.md found (no active writing workflow)` and exited 0: the writing workflow produces no `PRECIS.md` or `VALIDATION.md` anywhere (the only mention left in `skills/writing/` is the constraint `.md` itself), so that PASS was permanent and unconditional. The question it asked is computed by a gated checker instead — `writing_gate_probe.py` traces CLAIM-NN against the authenticated receipt-selected plan (`claim-id-trace-vs-PLAN`, `implementsMismatch`, `claimsNotInPlan`), and `writing_section_index.py` enforces the outline-before-draft hierarchy progressive-expansion guessed at by case-insensitive filename matching. `check-npx-linking.sh` ran the five `tests/npx_linking_*_test.py` suites that plugin-audit's pytest leg already collects with the deps `tests/pytest-deps.txt` declares: 40 passed either way. `check-tests.sh` duplicated plugin-audit's four test legs, and its quarantine machinery had been dead since the list emptied.

- **`tests/workflow_return_shape_test.py`, a return-shape lint that scanned an empty set and was run by nothing.** It globbed `ROOT/"workflows"/*.js`, a directory deleted when that script became `skills/work/workflow.js`; with no match it warned and returned 0, so its one real assertion (`checked_any` — that at least one documented shape was cross-referenced) was never reached. It was also never declared in `tests/script-suites.txt` (`git log -p --all -- tests/script-suites.txt` never shows the name) and had no other caller — `rg -n 'workflow_return_shape'` matched only its own docstring — so it ran only under pytest collection, where it registers zero test functions. The convention it lints is very much alive and is enforced properly elsewhere: `checkReturnShapeDrift` in `skills/workflow-creator/scripts/wc-probe.ts` decides the same L1 rule from `references/gate-laws.md`, follows a SKILL.md's `Workflow({scriptPath})` to the script that actually implements the shape (the cross-file case the python lint's 40-line window could only approximate), is exemption-aware, ships ~30 cases in `wc-probe.test.ts`, is gated by `skills/workflow-creator/scripts/check.sh`, and states in its own comment that it has "deliberately no empty-set escape" — the exact defect the python file embodied. Deleting a superseded prototype, not retiring a convention.

### Added

- **`tests/standalone-suite-exit-codes.test.ts`** keeps the one thing `check-tests.sh` did that no gated runner does. A suite that asserts at top level registers zero tests under `bun test`, so its verdict never reaches the `N pass / N fail` line every gate parses — four of them live in `tests/` (`agent-contract`, `overflow-check`, `typst-convention-guard`, `writing-prose-check`). This file runs each with `bun <file>` and checks the exit code, re-asserts the no-top-level-`process.exit(0)` preflight, and fails when discovery finds nothing.
- **`tests/test_no_pause_between_phases.py`** is `scripts/checks/check-no-pause-between-phases.py` wired into plugin-audit's python leg. Same patterns and same allowed contexts; what changed is that scanning nothing is no longer a pass — the CLI exits **2** naming the missing path (`COULD NOT RUN: … nothing to scan: <dir>`), the pytest form fails, and the count of files scanned is printed. 4 writing `SKILL.md` scanned, 0 violations.

- **A Stop hook refuses an EARLY stop in the main chat: `hooks/early-stop.ts`**, registered under `Stop` after `work-hold.ts` with a 20 s timeout. It judges the message that ends the turn against the four endings the user's rule names — a summary that announces the next step instead of taking it; an offer to carry on unless the user would prefer otherwise; a list of decisions none of which blocks the rest; stopping because a milestone felt like a good place to report — and blocks with that rule plus what to do instead: take the next step now, and if nothing can move without the user, say what blocks and use AskUserQuestion. The judge is the one `work-hold.ts` already uses — Jev, through that file's exported `decisionsCall`/`parseNoul`: one `noul` question over the latest genuine user request (≤ 2,000 chars) and the final message (≤ 4,000), bar at `EARLY_STOP_THRESHOLD`, default `0.8`. There is still exactly one Decisions transport in this plugin.

  **It never fires for an unattended child.** `FARM_OUT_CHILD=1` and a set `GRIND_ITERATION` allow before the hook payload is even parsed, so no parse failure can route a session nobody is watching into a judge call; `EARLY_STOP_HOOK=0` opts a session out. It also stands down while a `work-hold` is armed — the state file, or a ledger whose last word is `armed` — because the hold is already holding that session on an objective, and two blockers on one stop is a session nobody can close.

  **Bounded, and fail-open on every path.** At most **2** blocks per USER turn, counted in `$TMPDIR/early-stop-<session>.json` and keyed by the last genuine user message's uuid. The cap is a counter rather than `stop_hook_active` because it is strictly stronger: it caps every stop in the turn, not only the ones that directly follow a block. The key cannot be rotated by the hook's own feedback, which the harness records as a `type:"user"` entry with `isMeta:true` — the turn-boundary scan (the rule `teammate-idle-report-check.sh` documents) skips it. The counter is written BEFORE the block, so an unwritable counter allows the stop rather than blocking uncapped, which is the loop `teammate-idle-report-check.sh` paid for. No key, no network, an unparsable answer, an unreadable transcript, no session id to key the counter on, an unexpected throw: each one allows. Every decision, allow or block, appends one line to `$TMPDIR/early-stop.log`.

  **Gated hermetically, and once for real.** `tests/early-stop.test.ts` is 20 cases against a stub Decisions server on loopback: the bar either side of the threshold, every fail-open (a judge that answers 500, an unreachable one, no key at all, an unparsable answer, a counter that cannot be parsed, read or written, a `TMPDIR` that does not exist), each child guard, the armed-hold stand-down, the cap and its reset on a new user turn, the audit line, and the `hooks.json` registration itself. Only an ENOENT counter blocks, which one case pins directly. Nothing in it reaches the network. `tests/live/early-stop-live.sh` then runs one real `claude -p` session on a prompt built to end early, inside a single `mktemp -d` scratch holding both `CLAUDE_CONFIG_DIR` and `TMPDIR` — so no installed plugin, user settings or CLAUDE.md is loaded, the hook under test is the session's only Stop hook, and the model is not pre-warned by the user's own rule. It reads the hook command out of `hooks/hooks.json` rather than retyping it (a broken registration fails the test instead of hiding behind a duplicate), unsets `FARM_OUT_CHILD` and `GRIND_ITERATION` explicitly rather than assuming them absent — it is routinely run from inside a farm-out child, where inheriting either would make it prove nothing — and passes only if the audit log carries a `block` line for that session AND the transcript has assistant entries timestamped after it.

- **farm-out, farm-team and grind children carry a standing instruction instead of that hook.** A child ends its turn into nothing — no user answers an offer to continue, so the session simply exits with the deliverable unwritten and the caller sees a run that "succeeded" and produced no artifact. `NOBODY IS WATCHING THIS RUN…` now reaches all three child prompts: `farm.sh` as `CHILD_STANDING`, a sibling of `ANTI_SIM` concatenated at the `-p` line; the prompt file `farm-team.sh` builds; and the `GRIND_PROTOCOL` heredoc in `grind.sh`. The three copies are pinned **byte-identical** by `tests/child-standing-instruction.test.ts`, which exercises the prompt-building code paths rather than grepping the scripts. The text carries no apostrophe, `$` or backtick: it has to survive a single-quoted shell assignment, a quoted heredoc and grind's UNQUOTED one without changing.

### Fixed

- **cite-check verified citations against the previous version of a source and reported clean.** `computeSourceHash` built the File Search store's invalidation key from `${bibkey}:${filePath}` alone — file CONTENT was never hashed, nor mtime, nor size — so replacing a PDF at the same path under the same bibkey left the hash unchanged, `createOrReuseStore` reused the stale upload, and every cite for that source was checked against the old document with no signal in the report. Measured 2026-09-10: `Chinco2024-bt.pdf` was swapped from a 63-page accepted manuscript to the 22-page published JFE article and `SchwartzZiv2025-bd.pdf` from a 76-page SSRN draft to the 36-page Management Science version, same keys, same paths; run 2 was trustworthy only because someone deleted the store state file by hand. The hash now includes a SHA-256 of each cited source's bytes. Content, not mtime or size: mtime false-positives on a fresh copy or checkout, and a same-size replacement slips a size check. A missing or unreadable file hashes to a `<missing>` sentinel instead of throwing — a source can legitimately be absent, and the audit reports coverage separately. Invalidation was whole-store at the time of this fix; the per-file granularity it left on the table is the entry below.

### Changed

- **`work-dispatch.sh` arms the hold itself and PRINTS the `CronCreate` call for the heartbeat.** The structural catch is that `CronCreate` is a model tool — there is no cron CLI and a session-scoped cron lives in memory rather than in `.claude/scheduled_tasks.json` — which is exactly why the script used to self-send a `/loop`. It cannot arm that half, so it does the half it can and instructs unmissably on the other: the hold is armed with `until-arm.sh` on a check derived from `work-result.sh` (normalised to 0/1, because an absent `result.json` makes `work-result.sh` exit 2 and `until-arm.sh` correctly refuses an exit above 1 as could-not-run; a `readOnly` run accepts either verdict, a writing run accepts PASS alone), with `--rounds` from the plan's `maxRounds` and `--minutes` from the new `compose-goal.sh --minutes`, so the armed ceiling and the ceiling the objective states cannot drift apart. The `CronCreate` block is printed LAST on both dispatching exits — the printed-wait path and the `--loops N` detached hand-off — with the cron expression (off the `:00`/`:30` marks the whole fleet lands on) and the exact prompt text, which is the composed objective verbatim so the tick re-enters with the standing authority, the continuation rule and the `CronDelete` teardown already in it. `tests/dispatch-hold-and-heartbeat.test.ts` dispatches for real against a private `TMPDIR` and asserts both halves. A dispatch that ends with a hold and no heartbeat is the unattended idle the mechanism exists to prevent, so `skills/work/SKILL.md` carries the `CronCreate` call as a required step of Phase 3, not a footnote.

- **cite-check store invalidation went from whole-store to per-file.** The content-hash fix above made invalidation correct but left it at the wrong granularity: the hash was a single scalar over all cited sources, so one swapped PDF among ~46 deleted the store and re-uploaded every one of them. That is precisely backwards for the workflow it serves, where sources change one at a time across a cite-check cycle — 2026-09-10 saw two preprints swapped for published versions, one key renamed and four rendered PDFs added, and each of those four edits cost a full rebuild. `.cite-check-store.json` now also records a **per-bibkey** hash (same strings the whole-store hash is computed over, so the two cannot disagree), and `syncStore` diffs it into unchanged / changed / added / removed. Changed and removed keys have their document deleted; changed and added keys are imported; unchanged keys are not touched. Delete precedes import per key, so a delete that succeeds before a failing import leaves that bibkey absent from `importedBibkeys` and it surfaces as NOT_IN_STORE — stale-but-verified is the one outcome worth ruling out. Documents are located by paginating `documents.list` and matching `customMetadata.bibkey`: `displayName` is replaced with a store-assigned random id on import and cannot be matched on, and the SDK Pager's async iterator stops after page one, so `hasNextPage()`/`nextPage()` does the walking. Anything that leaves the store's contents unknowable — no prior state, state predating the per-key map (a one-time migration rebuild), a `documents.list` failure, an expected bibkey no document carries, a failed delete — falls back to deleting the store and rebuilding wholesale, and prints `[store] FULL REBUILD: <reason>`. Every run logs which of the three paths it took; a silent partial update would leave the store missing a source, which reads as NOT_IN_STORE and is therefore safe, but safe-and-invisible is how the previous bug survived a whole cycle.
- **Human review left the goal spine.** `compose-goal.sh` put the review gate in clause one of EVERY goal, so a Stop hook only a human verdict, a round counter or the clock could clear existed the moment any run was dispatched — before anyone had seen the diff. A goal states what a session can close BY WORKING, and a human verdict is not that: it makes the run stoppable only by a person, who may have walked away. Measured 2026-08-22: a ~94-line provider bugfix, fully tested and reversible by one nix generation rollback, sat behind that clause for ~18 hours while the mail outage it repaired stayed live. A writing goal now closes on craft's own verdict — `craft-result.sh` exiting 0 or 1, never 2, so a gate that could not be adjudicated does not close it either — and a `readOnly` goal on `workflow.js`'s. Both machine escapes are unchanged.
- **Review moved to the skill's Phase 5, after the goal clears**, with the two rules the episode actually taught: deliver first, because a PASS means the suite is green and not that the real claim holds; and never block delivery on the TUI. Work that cannot be undone — a one-way migration, a deletion — is still worth reviewing before shipping, but that is now a judgement the orchestrator makes out loud with the user, not a gate imposed on every run.
- **The goal's wall-clock ceiling is denominated in minutes, default 10** (`CRAFT_GOAL_MAX_MINUTES`; `CRAFT_GOAL_MAX_HOURS` still honoured and converted). It bounds how long a session may WAIT, not how long it may work — the Stop hook gates stopping, never working — and an hours-scale default bought nothing but hours spent sitting on an absent human.

## [6.29.0] - 2026-09-28

farm-out's watching model, settled the way the user asked for on 2026-09-28: **one farm monitor per SESSION, not one per task, plus an hourly cron backstop for long runs.**

### Changed

- **`farm-out` no longer tells you to arm a `Monitor` per dispatch.** That rule predated the `farm-runs` plugin monitor (`monitors/monitors.json`, `when: always` → `skills/farm-out/scripts/farm-monitor.sh`), which watches every farm run *and* every grind loop the session launches — both write the same `$TMPDIR/farm-events/<session>/<pid>.ndjson` protocol — and wakes the session on `DONE` and on a run whose pid is gone with no verdict (`GONE`). Since v6.27.3 it exits with its session, which is what made per-row arming redundant rather than merely duplicative. The 2026-09-10 incident that motivated the old rule (nine backgrounded dispatches, four unmonitored, all four surfaced only because the user asked) is kept as one clause, because it is the case the session monitor now covers. `/reload-plugins` restarts a monitor that was stopped. **The residual case is narrower and named**: arm a task-specific wait only when a run's FINISH must trigger a follow-up action — a wake is not your next step — and background that step (`until test -s <expect>; do sleep 20; done; <next step>`), never with an unbracketed `pgrep -f`, which the v6.26.3 guard denies for matching its own checker.

- **`farm.sh --workflow` prints the hourly `CronCreate` heartbeat instruction, the same one `work-dispatch.sh` prints.** Same block, same minute-7 offset (a fleet-wide "hourly" otherwise lands on one instant), same interval→expression logic, and the same env var — `WORK_LOOP_INTERVAL_MINUTES` (`30` → `7-59/30 * * * *`, `240` → `7 */4 * * *`, junk or `0` → hourly) rather than a second `FARM_*` knob, because it is one heartbeat period and two variables that can disagree about one fact is a bug generator. `--no-cron` opts out and prints the monitor-is-the-only-wake line instead; `--cron` is an accepted no-op alias. The nudge is `and? (farm <label>)`, where the label is the `--out` file's own directory — for a `work` dispatch that is the run id — falling back to the workflow script's basename.

  **It is printed BEFORE the run, not after.** `--workflow` has no foreground phase: `run_one` blocks for the whole 20-60 minutes, so an instruction printed afterwards arrives when the thing it backstops is already over. A caller that DETACHES the run (`setsid nohup … > log`, which is how `work-dispatch.sh` and `work-redispatch.sh` invoke it) sees it on neither side — the printout lands in the log — so `skills/farm-out/SKILL.md` puts the duty on that caller: create the cron yourself at launch. **`--tasks` prints nothing**: a row is a STEP the session monitor already reports, an hourly clock per row is a wake for nothing, and that mode's stdout is parsed as the fan-out JSON.

### Fixed

- **`hooks/cron-delete-guard.ts` no longer refuses to delete a farm heartbeat.** Exactly the misfire fixed for `grind` in v6.26.0, reappearing through the new backstop: the farm nudge names a farm run directory, so no `.work` run claims the cron id, and the fallback rule ("nobody claims this id and something is in flight → deny") then holds the heartbeat open for as long as the project has any live dispatch. `--record` (PostToolUse on `CronCreate`) now marks the farm shape into `$TMPDIR/work-cron-nonrun-<session>.txt` alongside grind's, so no new state file is added. The **parenthesised nudge** is matched, not the bare word — `\(farm [^)\n]+\)` — so "farm out the review" is prose about delegating and stays refused; a nudge naming a real in-flight `.work` run still falls through to that run's deny, and the ARMED-hold deny is untouched.

## [6.28.1] - 2026-09-28

### Fixed

- **The public privacy scanner no longer fails on an UNTRACKED binary.** The candidate capture deliberately includes untracked files (`git ls-files --others --exclude-standard`) so that a private string in a file someone is about to `git add` is caught before it lands — that stays, and untracked TEXT is still scanned. But an untracked *binary* has no index representation at all, so it fell into `classifyBinary`'s "no reviewed index counterpart" branch and was reported as `unreviewed-binary`. Nothing untracked can reach a `git push`, so there is nothing to guard: it is now skipped, logged as `public privacy scan skipped <path> (worktree): untracked binary — not publishable until staged`. `git add` gives it an index entry and the `unreviewed-binary` finding appears there, unchanged. Observed on the v6.28.0 release run, where a local Go build under `skills/wrds/scripts/parse_def14a_own/` — another session's live working tree — turned the whole suite red.

## [6.28.0] - 2026-09-28

Five fixes from a bug report filed by the `secreg` session after a `lecture-repeat-detection` run — a
work loop that armed a hold nothing evaluated, refused its own correct verdict, and could not
redispatch the round that would have fixed it. Every defect below was observed on that run, not
reasoned about.

### Fixed

- **A hold that nothing evaluates is now visible instead of silent.** A hold is armed by a script and enforced by a hook, registered independently — so a session that started before v6.25 kept its Stop registration on a hook file that release deleted while running the CURRENT `work-dispatch.sh`. It armed a hold that no Stop ever processed: `rounds` stuck at 0 forever, no release after a PASS, and `hooks/cron-delete-guard.ts` — whose own path never changed — went on refusing every `CronDelete` of the heartbeats. Total deadlock, and nothing in the state told it apart from a first round still running. `hooks/work-hold.ts` now stamps `lastEvaluatedAt` into the existing state object before any branch, so the in-flight allow (which previously wrote nothing at all), the block, every release and the restore-from-ledger all carry the hook's own liveness proof. Its absence on a hold older than 10 minutes is the diagnosis: `work-hold.sh --status` prints `never evaluated since arm Nm ago — this session's Stop hook is not running work-hold.ts; run /reload-plugins`, and the `cron-delete-guard.ts` armed-hold deny prepends the same line. **The guard still DENIES** — weakening it would hand the session an argument for stranding a live run's loop — it just stops being silent about why the hold cannot move. No new state file: one field in `episode`-style state that already existed.

- **`work-result.sh` accepts the Workflow tool's envelope instead of refusing a correct verdict.** `farm.sh --workflow` puts a model in the return path: the child calls the Workflow tool and copies "the returned object" to `--out`. The TOOL result is an envelope — `{summary, agentCount, logs, totalTokens, result, …}` — whose `result` is the workflow script's own return, so a child that takes the tool result literally writes the envelope. Observed in `secreg/.work/0928-already-answered/result.json`: a complete, correct FAIL verdict sat under `.result` and `work-result.sh` refused it as `missing required key: overallPass` — a real verdict reported as **could-not-run**, the one exit code a caller cannot act on. Fixed at both ends. `farm.sh`'s prompt now names the envelope explicitly and says to write the object under `result`, unwrapped, adding nothing. `work-result.sh` unwraps when the top level has **no** gate keys and an object `result` that has them, announcing it on stderr with the envelope's own keys; the mechanical adjudication then runs on the unwrapped object exactly as before, so a fabricated pass inside an envelope is still refused. A gate return carrying its own `result` field is left alone, and an envelope whose `result` is not a gate return is still refused, naming the real keys.

- **`WORK_REDISPATCH_DRYRUN=1` writes nothing.** The flag someone reaches for to see what a round WOULD do committed everything and skipped only the farm-out: the staged args landed over `args.json` with `rounds` advanced, `result.json` was rotated to `result-round<n>.json`, the plan was archived — and then it printed "nothing dispatched". Looking spent the round and destroyed the verdict the next round scopes from, so a second look ran against state the first look had already moved. It now returns before the args commit, the archive and the rotation, printing each as `WOULD advance: rounds -> N` / `WOULD archive` / `WOULD rotate`, and removes the staged file rather than leaving a half-committed round. Every gate above it still runs — that is the point of the flag — so a `plan-lint` refusal still exits 3 under it. The suite used this flag as its harness for observing the commit path, which is why the bug survived: those 25 tests now perform a **real** dispatch with `WORK_FARM` pointed at a no-op stub.

- **A lens-only FAIL is narrowed by the files its findings name, instead of refusing to dispatch.** When a FAIL is carried entirely by review lenses, `tasksThatFlagged` is `[]` — no implementer, verifier or red gate failed — so selection fell back to FULL. FULL re-probes every `redCommand`, including the ones the previous round FIXED, which now exit 0 and are refused as `red-not-red`: **the round could not be dispatched at all**, on a verdict whose findings were confined to two files. Each surviving blocking finding is now mapped to the task(s) whose `writablePaths` contain its `file` — via `plan-lint.ts`'s own exported `coveredBy`, so the boundary is the one the plan is actually linted against — and those tasks re-run, closed under transitive dependents like any flagged task. Absolute paths in findings resolve against `projectDir`. **One** finding that maps to no task falls back to FULL and names it (scoping to the rest would carry a task that finding may be about, on a `verified` earned before the fix), as does a finding with no `file` at all. A **failed mechanical check forbids the narrowing outright**: it is attributable to no task's files, and mechanical checks re-run under any scope, so its fix must not be scoped out.

- **`priorFindings` is carried across every round, not frozen at round 2.** It was set ONCE, on the advance to round 2, and never touched again — so a finding the round-3 refuters killed was still carried into round 4 as an open gate, and a blocking finding a later round raised was never carried at all. The set was frozen against the generator and also against the evidence. It is now re-derived on every redispatch from the previous verdict's **survivors**: its blocking `findings`, which `workflow.js` has already filtered to the unrefuted, merged with still-open carried entries and deduped by `lens`+`title`+`file`. A refuted finding drops out and the count is printed (`N refuted last round and dropped`); one the verdict never mentions stays **open**, because silence from a dead refute leg is not a refutation. Refutation, not the round number, is what shrinks the set; `maxRounds` is still the hard stop.

### Changed

- **`work-hold.sh --disarm` releases without a terminal, confirmed by the permission prompt.** The tty read reaches only a terminal someone is sitting at, so a user on Remote Control or a phone who had already decided a hold was finished could not release it — the remaining exits were to wait out the ceiling or abandon the run, and the refusal lectured them about a hold not being theirs to release. Without a tty it now proceeds and records the new ledger verb `released by user (permission prompt)`; the confirmation is the user's own `permissions.ask` rule `Bash(*work-hold.sh --disarm*)`, which prompts on whatever device they are on and cannot be answered by this process. With a tty the interactive confirm is unchanged, decline included. The hook's restore-on-delete test is `verb.startsWith('armed')`, so the new verb lands on the released side by construction — asserted now, along with the safe direction for an unrecognised verb (read as released, never as armed; the opposite would trap a session on a ledger line nobody anticipated). `skills/work/SKILL.md`'s three release layers become a table naming each layer's **residual hole**: the ask rule matches the command text as written, so a variable-indirected call slips past it. It is a tripwire, not a lock.

## [6.27.3] - 2026-09-28

### Fixed

- **`farm-monitor.sh` exits when the session that started it is gone.** `monitors/monitors.json` has declared it `when: "always"` since v6.26.0, so every session that ends abnormally leaks one: found 2026-09-28, a monitor had been running **11 days** reparented to init, polling a dead session's `farm-events` directory every 20 s with nobody left to read a line of it. At startup it now walks the ancestor chain to the nearest process whose **executable** basename is `claude` — the harness runs monitors under a bash wrapper whose args carry `.claude/shell-snapshots`, so matching a substring of the command line finds the wrapper instead of the session, and `readlink /proc/<pid>/exe` is what distinguishes them. With no `claude` in the chain (a hand-run monitor, a test harness) it falls back to the direct parent. Each poll iteration exits 0 silently if that pid is gone, or if its own live ppid is 1 — reparenting means the harness went away even where the owner lookup fell back. Nothing else changed: the farm and grind event rendering and the GONE detection are byte-identical, and no state file was added. The poll interval is overridable via `FARM_MONITOR_POLL_SECONDS` for tests only; the shipped default is still 20 s, which `tests/farm-monitor-session-lifetime.test.ts` asserts alongside the three exit paths (owner dead with the parent still alive, orphaned with the owner still alive, and silence on exit).

## [6.27.2] - 2026-09-28

### Fixed

- **`suite-lint-report.test.ts` audits only the files THIS repository tracks, so submodule checkout state cannot move the counts.** The suite recomputed its measurement with `lintCorpus`, a filesystem walk, so its corpus silently grew by whatever happened to be on disk. `skills/bmll` and `external/anthropic-skills` are submodules: in a fresh clone or worktree that has not run `git submodule update --init` the walk reports **210** findings, and in one that has, **213** to **342** depending on what those submodules hold. Three tests failed in the uninitialized case — the audited-corpus recomputation, the cited-findings check and the per-rule citation check — because the report cited `skills/bmll/scripts/test_bmll_impact.py:54`, a finding that does not exist unless the submodule is checked out. Same class as the gitignored-`scratch/` citation fixed in v6.26.2, and fixed the same way.

  Every recomputation is now scoped to `git ls-files` **without** `--recurse-submodules`, which excludes both classes by one mechanism: a submodule is a single mode-160000 gitlink entry, so nothing under it is tracked here, and a gitignored path is not tracked either. The tracked count is **210 in all three checkout states**, with identical per-rule counts. There is no filesystem fallback if `git` is unavailable — a silent one would restore exactly the checkout-dependence this removes.

  **The filter is in the test, not in `lintCorpus`, because the other two callers want the opposite.** `work-dispatch.sh`'s TIER 3 must lint the test an implementer just wrote and has not committed, and `suite-lint-corpus.test.ts` lints mktemp trees that are not git repositories at all. The walker still lints `scratch/` and an initialized submodule when present; only what the report *recomputes* is scoped.

  The committed report was corrected against a live run over the new universe: the `skills/bmll` citation is withdrawn — no tracked file was found carrying the same shape, and the `suite-lint.test.ts:462` reading already establishes the point — the audited corpus is **23 files** rather than 24, and `single-distinct-literal`'s audited count is **43** rather than 45, the difference being the two findings in that submodule file. Every other rule's count is unchanged, and each rule that still fires keeps at least two verified citations.

## [6.27.1] - 2026-09-28

### Fixed

- **`work-pending.sh` reads `.craft/` again, as permanent dispatch HISTORY — v6.27.0 made every plan dispatched before the rename look armed and undispatched.** The removal narrowed both the `*/args.json` spec-hash lookup and the `abandoned` lookup to `.work/` alone. But a run's dispatch record is written once and never moved: every plan dispatched before the rename has its `args.json` only under `.craft/`, and those same plans were migrated to the `work:dispatch` marker the same day — so each one re-armed. `hooks/main-thread-guard.sh` calls this script, so the consequence was a blocked `Stop` ("A craft run is armed and undispatched: …") and denied `Edit`/`Write` in every affected project. Measured 2026-09-28 across `~/projects` and `~/areas`: **8 projects** — `board-structuring`, `crumb`, `mail-bridge`, `morgen-cli`, `npx-reconcile`, `opv`, `pollev-cli` and this repo. All 8 now exit 1 (not owed), and the fixed script reproduces the v6.26.3 verdict on all ten roots checked, including the two (`~/areas/colloquium`, `~/projects/teaching`) that were owed *before* the regression and remain owed for reasons of their own.

  **History, not a transition shim.** The two roots are read at both lookup sites — the local root and a foreign `projectDir` — and `.craft/` is read *only* to answer "was this spec ever dispatched or abandoned?". Nothing is ever written there, and a `.craft/` run is never treated as in flight.

  **The liveness readers deliberately stay `.work/`-only**: `RUN_ROOTS` in `hooks/cron-delete-guard.ts` and `hooks/session-start.ts`, and the `~/dotfiles` `work-goal-resend.sh` SessionStart reporter. (`farm-alive.sh` is unaffected — it keys on `$TMPDIR/farm-events/` and names no run root at all.) Those ask "is a run in flight *now*", and no `.craft/` run is — all 131 were retired with a `result.json` before the v6.27.0 removal. Reviving one there would report a run nobody is running. `work-goal-resend.test.ts` now pins that asymmetry with a `.craft/` run in the in-flight shape (`args.json`, no `result.json`) that must stay invisible.

## [6.27.0] - 2026-09-28

### Removed

- **The `craft` → `work` transition code. Every reader now accepts only the `work` spelling.** Both conditions the v6.25.0 entry set for this removal were re-verified on 2026-09-28 before anything was deleted: `scripts/migrate-craft-to-work.sh ~/projects ~/areas` reported **0 files to rewrite** (30 skipped — 25 worktree, 1 changelog, 1 docs, 3 skills), and every one of the **131** `.craft/<run>/args.json` under those roots had a non-empty `result.json` beside it, the last seven having been retired with `work-abandon.sh`. What came out:
  - **marker**: the `(?:work|craft):dispatch` alternations in `work-dispatch.sh` (4 parse sites), `work-redispatch.sh`, `work-pending.sh` (regex + `grep -E`), `work-amend.sh`, `plan-lint.ts` and `hooks/lib/writing-plan-context.ts` are now `work:dispatch` only. A plan still carrying `<!-- craft:dispatch -->` no longer dispatches at all.
  - **run directory**: `RUN_ROOTS` is `[".work"]` in both `hooks/cron-delete-guard.ts` and `hooks/session-start.ts`; `work-pending.sh` reads `abandoned` and `*/args.json` under `.work/` alone, for the local root and for a `projectDir` elsewhere. `hold-lint.ts`'s round-verdict rule **still refuses `.craft/`** — a check reading a retired run directory is still a round verdict, and the reason it cannot release is the reason the rule exists.
  - **env vars**: `skills/work/scripts/legacy-env.sh` is deleted along with the six `source` lines that pulled it in (`work-dispatch.sh`, `work-redispatch.sh`, `work-loop.sh`, `work-elapsed.sh`, `work-amend.sh`, `compose-goal.sh`), and the two inline TypeScript fallbacks go with it — `WORK_ALLOW_CRON_DELETE` and `WORK_SUITE_LINT_BUDGET_MS` no longer read their `CRAFT_*` predecessors. A caller still setting a `CRAFT_*` name now gets the default, silently; `compose-goal.test.ts` asserts that inertness rather than the old promotion.
  - **plan-lint**: the advisory `legacy-dispatch-marker` rule is gone. It pointed at a migration that no longer has a script to run.
  - **migration script**: `scripts/migrate-craft-to-work.sh` and `tests/migrate-craft-to-work.test.ts` are deleted — their job is done. **To recover either if a straggler plan ever turns up**, `git show 46772c4d:scripts/migrate-craft-to-work.sh` (and `:tests/migrate-craft-to-work.test.ts`) prints the last shipped version; a one-off `perl -0pi -e 's/\bcraft:dispatch\b/work:dispatch/g'` over the file is the whole of what it did.
  - **KEPT**: `.gitignore`'s `.craft/` entry, because old run directories are still on disk in users' projects and must stay untracked; and the `craft-spine-runner` capability alias in `.claude-plugin/capabilities.json`, documented in `docs/extension-contracts.md` and asserted by `tests/public-extension-contract.test.ts`, which comes out at the next major version and not before.
  - **Still outside this repo**: `~/dotfiles/.claude/hooks/work-goal-resend.sh` reads both run roots and both `*_SKILL_DIR` spellings. Not touched here. `skills/work/scripts/work-goal-resend.test.ts` now exercises it through the `work` spelling, which that hook accepts.

## [6.26.3] - 2026-09-28

### Changed

- **`work`'s refuter ordering defaults to `'severity'`; `'jev'` is now an opt-in.** The Jev ranking leg was measured against the thing it is supposed to buy — refuter-upheld findings kept inside the `refutersPerLens` cap — and it buys nothing. Measured 2026-09-28 over 894 findings in 65 batches: batching does **not** degrade the ranker (batched AUC 0.637 vs 0.619 single-call, Spearman 0.79 between them), which was the question asked; but on the **18 real overflowing lens batches** batched Jev moved **−0.001** upheld findings into the top 8 against a random within-severity draw, 95% CI [−0.064, +0.060], and no arm's lift over random clears zero at 95% anywhere in the study. The ceiling is arithmetic rather than model quality: a real overflowing lens carries 9.8 findings for 8 slots, so the cap drops 1.8 findings of which ~0.6 are upheld in expectation — a perfect ranker could rescue ~0.6 per overflow and an AUC-0.63 one rescued +0.06. The price for that is a full command-runner agent leg per overflowing lens, with four documented fallback paths, not the $0.00003 Decisions call. `'jev'`, `scripts/jev-rank.ts` and every fallback stay in place and tested — the code costs nothing while unselected, and 18 real batches is enough to justify "off by default" but not "deleted".

### Fixed

- **`scripts/migrate-craft-to-work.sh` rewrote every `*.md` that carried the marker, not the plans it was written for.** The only filters were `.git/` and `.craft/`, so `--apply` over `~/projects ~/areas` touched **120 files** on 2026-09-28, among them: this repo's own `CHANGELOG.md` — including the dated transition entry that quotes the old marker and the sentence naming the token the migration retires, which the rewrite turned into `work:dispatch` → `work:dispatch`; **ten tracked files in the `npx-iss-reconcile` worktree**, whose branch predates the rename and whose `skills/craft/scripts/craft-dispatch.sh` parses ONLY `craft:dispatch`, while an npx session had runs in flight against it; three `SKILL.md` files in the separate `~/projects/teaching` plugin repo; and a dated investigation note in `~/projects/ptct`. The repair was manual: `git checkout --` where the marker was the file's only uncommitted change, a `work:dispatch` → `craft:dispatch` rewrite of the marker lines alone where it was not (safe there because every one of those checkouts has zero `work:dispatch` at `HEAD`), and the same rewrite over the worktree's 15 untracked `.planning/` and `.claude/plans/` files. The script now requires a `.claude/plans/` or `.planning/` path component and skips, counting each reason in the dry-run summary: `.claude/worktrees/` (another branch may run pre-rename code), any checkout containing `skills/craft/scripts/craft-dispatch.sh` (same reason, memoised per repo root), `CHANGELOG*`, `README*`, `PHILOSOPHY*`, `docs/`, `skills/`, and anything that is not a plan path. `tests/migrate-craft-to-work.test.ts` covers one file per skip rule plus the two plan shapes that are still rewritten.

- **`rg`/`rga` with no path argument hung the Bash tool until something killed it, and now the `pgrep-self-match` gate denies it.** ripgrep searches STDIN when given no path and stdin is not a terminal, and under the Bash tool stdin is never a terminal — so a path-less `rg` reads a pipe nobody closes. A farmed agent ran ``rg -n -i craft --hidden -g '!.git' -g '!CHANGELOG.md' -c | sort`` and hung for **34 minutes**; note the pipe is on the wrong side, piping OUT to `sort` while nothing pipes IN, which is why it did not save the command. Verified 2026-09-28 on ripgrep 15.2.0 against a fifo held open by a sleeping writer: `rg foo`, `rg -e foo` and `rg -f patterns` all block until killed (exit 124), while `rg foo .`, `rg -e foo .`, `rg --files` and `rg --type-list` return immediately and a bare `rg` is a usage error that never reaches stdin. The hard part is flag parsing — in `-g '!.git' foo` the only positional is the *pattern* — so the value-taking short and long flags are enumerated from `rg -h` rather than guessed, and `-e`/`-f`/`--regexp`/`--file` are tracked separately because they supply the pattern, which makes the first positional already a path. A segment fed by a pipe or by any input redirect is left alone; that is ripgrep's documented streaming mode with a finite source. `tests/pgrep-self-match.test.ts` covers each row of the table above plus the redirect and pipe exemptions. The hook keeps its name: the self-match rule is the one with the incident history, and the path is wired in `hooks.json`.

## [6.6.1] - 2026-08-20

### Changed

- **The adjudicator's refusal now names which direction the disagreement went.** `craft-result.sh` re-runs every declared mechanical check and refuses (exit 2) when the observed exit code differs from the claim — but the two directions mean opposite things. A claimed **FAILURE** that passes on re-run is a probe-side flake: load-sensitive checks (a default test timeout, a wall-clock budget) fail that way while craft runs agents concurrently, and the right response is to re-run the gate, not re-plan or spend another round. A claimed **PASS** that fails on re-run is the case the adjudicator exists for. Measured 2026-08-20 (mail-bridge): a probe reported the aggregate gate exiting 1 after three tests blew Bun's 5s default budget under concurrent load; the re-run exited 0, and the identical refusal message made a flake read as an untrustworthy gate and blocked human review. Both directions still exit 2 — passing a non-reproducing failure would wave a genuinely flaky gate straight through.

## [6.6.0] - 2026-08-20

Both entries are one incident, diagnosed from a 20h transcript: a mail-bridge session ran 9h21m unattended — 1,055 turns, 11 auto-compactions, **zero commits** — while converging perfectly well on the work (surviving blocking findings 19 → 2, suite at 610 pass / 2 fail). It could not stop and it could not pass, for two independent mechanical reasons.

### Fixed

- **A mechanical check killed by a timeout was scored as a failing gate.** 124/137/143 mean the command was still running when something stopped it, not that the code under it failed. One "production aggregate gate" returned 143 in two consecutive ~3h rounds — both killed at 10m0s inside a 50k scale phase — so `overallPass` could never be true and each round re-derived the same non-answer. `craft-result.sh` now refuses a kill code (exit 2) rather than adjudicating it. The constraint behind it is now stated in SKILL.md: a check's `cmd` is run **twice** by two callers that both cap at ~10 minutes — the probe agent's Bash tool (600s, not tunable) and `craft-result.sh`'s own re-run for adjudication — so anything genuinely long belongs *behind* the gate, running detached and writing an artifact the check reads fast.
- **The goal's machine escape was denominated in rounds, and a round has no time bound.** `compose-goal.sh` was already careful — it refused undecidable clauses and paired the human review event with "or the rounds field reads N or more". But rounds took 3h+ against `maxRounds` 4, so the guaranteed stop sat twelve hours out, and the only reachable exit before then was a human who was asleep. The goal now carries a third clause: a wall-clock ceiling (default 8h, `CRAFT_GOAL_MAX_HOURS`), settled by the new `craft-elapsed.sh`, which prints elapsed time, completed rounds on disk, and `CEILING REACHED` or not — so the Stop judge reads a verdict instead of subtracting timestamps. Elapsed comes from the run **directory**, not `args.json`, which a re-dispatch rewrites.

## [6.5.0] - 2026-08-19

### Fixed

- **The red probe accepted an import error as a genuine RED.** Measured: a test importing a nonexistent module exits pytest 2 and prints `1 error in 0.04s`, which `red_probe_gate`'s EVIDENCE regex matches — so a run whose surface did not exist yet dispatched on a red that proved nothing about behaviour. dev CLARIFY axis 5 already refused that shape in prose, and nothing executed the prose. The classifier now returns `could-not-run` for a collection error, an `ImportError while importing test module`, or node's `Cannot find module` / `ERR_MODULE_NOT_FOUND`. The existing `NOMODULE` rule never covered this: it fires only when the missing module is named in the command, which catches a missing *runner*, not the module under construction.
- **dev's RED rule and craft's write guard were jointly unsatisfiable for greenfield work.** Axis 5 forbids an import-error red, so a new surface needs a stub that exists and raises; a stub is the implementer's output, so it sits in some task's `writablePaths`; and the guard denies exactly those while a run is armed. Every exit was sealed, and `--abandon` was the only one left — which releases the guard for the whole rest of the session and switches off the Stop-hook nudge with it, since that nudge fires only when a dispatch is still pending. A plan defect therefore became a disarmed run that implemented in chat and never reached farm-out.

### Added

- **`scaffoldPaths`** — the plan declares what it authors *before* the dispatch, and `craft-dispatch.sh --scaffold PLAN PATH` (0 declared, 1 not, 2 undecidable) answers for `main-thread-guard.sh`. Kept separate from `--covers` deliberately: a stub is both the implementer's output and a precondition of its own red gate, so one predicate can never answer both. An absent list returns a decidable 1, not 2, so the ordinary plan does not fail the guard closed on every write. Nothing about how implementers run changes.
- **`scaffold-swallows-task` (plan-lint, major)** — a scaffold covering a task's entire writable surface is the write guard turned off with extra steps. Uses directional containment rather than craft's symmetric `pathOverlap`, which flagged the legitimate narrow case on the first attempt (`src/stub.py` under a `src/` task) and is now a test.

### Changed

- **dev CLARIFY gains axis 8: the language, and its project-scoped LSP, installed before reconnaissance.** Three separable steps, only one of which is the plugin. The binary must be **global** — Claude Code resolves an LSP `command` from PATH alone, never the plugin root, `${CLAUDE_PROJECT_DIR}`, a project venv or `node_modules/.bin` — so a project-local server is unreachable by construction; project fidelity comes from config (`pyrightconfig.json`, or the project's own tsserver) instead. Registration is separate again: a mid-session install is inert until `/reload-plugins`. Found by running it — `pyright-lsp` was enabled with no `pyright-langserver` on PATH, so every LSP call had been failing `ENOENT`. Hence the red flag: prove it with one `LSP` call, never the install's exit code.
- **`main-thread-guard.sh` explains its denial** (in `~/dotfiles`, committed separately). It offered only "dispatch, or `--abandon`" and never mentioned that an uncovered path is already writable — which is why `--abandon` got used for a case the guard was designed to permit. It now names the wall it hit and points at `scaffoldPaths`.

## [6.4.0] - 2026-08-18

### Changed

- **`look-at` routes to four subscription CLIs instead of a metered API.** Backends are now `claude` (`claude-code -p` — the CLIProxyAPI wrapper over the pooled OAuth accounts, *not* plain `claude`, which bills the calling session's own account), `agy` (`agy -p`), `codex` (`codex exec`) and `copilot`. `--consensus` takes a comma-separated list instead of a hardcoded pair and defaults to all four, so a diagram can get four independent looks concurrently — wall-clock is the slowest backend, not the sum. The `api` backend survives for agentic mode and native PDF ingestion but is opt-in only and excluded from consensus.
- **The `gemini` backend is removed.** It was the documented default and the SKILL.md table advertised it as "Bundled quota, no API key needed" — false: `resolve_gemini_key()` falls back to `GOOGLE_API_KEY` and the backend hard-fails without a key, so the free-looking default billed exactly like `api`. The consumer `gemini` binary was also sunset 2026-06-18 and no longer runs here at all ("Please set an Auth method…").

### Fixed

- **`image-read-guard.ts` sent every blocked Read to the metered path.** The hook exists to save context and money, and its deny message handed back `uv run --script … look_at.py` — the `google-genai` backend — bypassing `look_at.sh`'s routing entirely. It now points at `look_at.sh`. Same rewrite applied to the ~74 documented call sites that named `look_at.py` directly: `references/use-cases.md` (50), `skills/using-skills/SKILL.md` (6, and that file is auto-loaded every session), `README.md`, and the three `examples/*.sh`.
- **The `claude` backend would have recursed without bound.** Its child `claude-code -p` loads this same plugin, so `image-read-guard` denied the child's Read of the image and pointed it back at `look_at.sh`, which spawns another child. `look_at.sh` now sets `LOOK_AT_NESTED=1` and the guard stands down when it sees it. Covered by a new golden case, because the failure mode is a fork bomb rather than a wrong answer.
- **`codex exec` needs `--` before the prompt.** `-i/--image` is variadic, so a bare trailing prompt is swallowed as another image path and codex then blocks reading stdin (`No prompt provided via stdin`). Also `-p` in Codex is `--profile`, not print mode. Both recorded as comments where the invocation is built.
- **`examples/*.sh` hardcoded `SCRIPT_DIR="../scripts"`**, so they only ran from one directory. Now self-locating via `BASH_SOURCE`.
- **The stale `public-extension-contract` test title.** It still said 6.0.1 against a 6.3.1 manifest — the one version site of six that nothing enforces, so it rots silently. `scripts/bump-version.sh` rewrote it as designed; the suite is green again.

## [6.3.1] - 2026-08-18

### Documentation

- **How to install `marimo-pair`, in both places a reader would look.** The `marimo` skill routes live-kernel work to `Skill(skill="marimo-pair:marimo-pair")`, which ships as a separate upstream plugin — so the skill and the README now each carry the two commands that install it. It is deliberately NOT a `dependencies` entry: an uninstalled hard dependency stops the entire plugin from loading, and one skill of sixty-one should not be able to take the rest with it. Notebook authoring works without it; only the live-session section needs it.

## [6.3.0] - 2026-08-18

### Removed

- **The vendored `marimo-pair` submodule.** `skills/marimo/marimo-pair` pinned upstream at an April 2026 commit; upstream has since reached v0.0.18, restructured itself into a plugin, rewritten its discovery and execution scripts (WSL fix), and added a `retro-marimo-pair` skill. It is now consumed as the installed `marimo-pair` plugin rather than vendored, so it updates on its own.

### Changed

- **`skills/marimo` stops restating marimo-pair's CLI.** Its live-session section inlined `execute-code.sh` invocations that v0.0.18 rejects outright — `--url` is now required and stdin needs an explicit `-`, so every example here would have exited on a usage error. The mechanics now route to `Skill(skill="marimo-pair:marimo-pair")`, which documents its own current surface; duplicating it is what let this go stale. What upstream does not carry is kept: the pixi/uv/uvx start commands and the `--watch` rule, background-task-not-`--headless`, tailnet binding instead of SSH forwarding, the re-run-**every**-cell doctrine for data-only changes, and the `ctx.screenshot()` coroutine caveat.

## [6.2.1] - 2026-08-18

### Changed

- **`agents/librarian.md` picks up the copy that had drifted ahead in dotfiles.** The two had diverged in one substantive way: this copy declared `mcp__consensus__search` in its `tools`, which the `consensus` skill explicitly forbids — "NEVER use `mcp__consensus__search`. ALWAYS use the CLI binary", because the MCP is rate-limited to 3 results. The agent could reach a tool its own skill bans. That tool is dropped, the plugin-namespaced `Skill(skill="workflows:…")` calls are kept, and two relative paths (`../skills/google-scholar/…`, `cd skills/deep-research`) become `${CLAUDE_PLUGIN_ROOT}`-anchored so they resolve from any cwd.
- `consensus`, `deep-research`, `google-scholar`, `nlm` and `readwise-chat` are now published here only. Identical copies had been loading from a personal skills directory as well, so each was paid for twice in always-on budget and the two sets could drift independently.

## [6.2.0] - 2026-08-18

### Added

- **`tuicr` ships here now**, as one tracked copy. It had been symlinked into `skills/tuicr` as an absolute path into the author's dotfiles checkout — meaningless to anyone else, and which git records as a mode-120000 link rather than the skill's files. The 6 real files are committed and the dotfiles original is deleted, so the skill has a single home like the rest of the spine.

All notable changes to this project are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [6.1.0] - 2026-08-17

### Changed

- **The spine runs from one copy, as `workflows@skills-dir`.** This repo is symlinked to `~/.claude/skills/workflows`, where `.claude-plugin/plugin.json` auto-loads it — no marketplace install, no cache copy. The seven skills that were duplicated into `~/dotfiles/.claude/skills` (`craft`, `dev`, `ds`, `writing`, `workshop`, `workflow-creator`, `farm-out`) are deleted there; this is now the only copy. Note that an *installed* plugin takes name precedence over a skills-dir one **even when disabled**, so `workflows@edwinhu-plugins` had to be uninstalled for this copy to load; the marketplace itself stays registered.
- **The repo's own `~/.claude/skills/<skill>` self-references are repointed** to `~/.claude/skills/workflows/skills/<skill>`, including craft's `skillRoot` fallback in `workflow.js`. Those paths all dangled the moment the per-skill symlinks were removed.

### Changed — progressive disclosure

- **`docx-typst` and `docx-repair` no longer pay their whole body on every invocation.** Both shipped nearly all their procedure in `SKILL.md` (579 and 524 lines, zero and one reference file). The procedural detail moves verbatim into `references/`, leaving a routing index: **on-invoke drops ~13.2k → ~3.0k and ~14.5k → ~2.8k**, a combined ~21.9k saved per invocation. Every code block from the originals is present in the new set, and `docx-repair/footnotes-reference.md` moves under `references/` with its referrers updated.
- **Ten over-long descriptions lose their prose, not their triggers.** `docx-typst`, `law-econ-docx`, `law-review-docx`, `look-at`, `paperpile`, `bright-data`, `lseg-data`, `farm-out` shed redundant framing and disambiguation asides. All 158 quoted trigger phrases are preserved — the description *is* the triggering surface, so a cut trigger is a silent regression no test catches. Always-on falls ~9,612 → ~9,430; the lever is nearly exhausted, since always-on is just the sum of the 62 descriptions and the long ones are long *because* they are triggers.

## [6.0.1] - 2026-08-17

### Changed

- **The three published descriptions now describe craft.** `plugin.json`, `marketplace.json`'s metadata, and its `workflows` entry all still read "Generic structured work, development, data science, writing, and workshop presentation workflows … with TDD enforcement and session handoff" — a listing written for the beat spine, naming a session-handoff surface that 6.0.0 removed. They now lead with the loop and what gates it: an approved plan as the run's only authority, delegated implementation, independent verification against **computed** gates, human review. Documentation only; nothing an installed plugin executes changed.

## [6.0.0] - 2026-08-17

### Changed — BREAKING: the beat spine is replaced by craft

- **One loop replaces 63 skills.** `work` plus `beat-{clarify,plan,implement,verify,review,third-party}`, expanded into `dev-*` (21), `ds-*` (11), `writing-*` (17), `workshop-*` and `workflow-creator-*`, are gone. `craft` is the spine: clarify with the user, an approved plan whose `<!-- craft:dispatch -->` block is the sole authority, a self-set goal, `skills/craft/workflow.js` to implement and independently verify, then human review in tuicr. Rejection routes back to CLARIFY.
  - **The phases are beats in a program, not skills.** A phase expressed as a skill is a phase that can be invoked out of order, skipped, or drift from its four siblings — which is what happened: five domains each accumulated their own clarify, plan-reviewer, implement gate and verifier, and the same fix had to be applied five times and diverged between applications. `workflow.js` schedules the task graph, dispatches one fresh agent per beat, and computes the gate in JS from raw counts.
  - **The identity is the spec hash, not a receipt.** `specHash` is the sha256 of the canonical (sorted-key, whitespace-free) JSON of the parsed `craft:dispatch` block. Reordering the block or fixing a typo in the surrounding prose moves nothing; changing any executed value moves it. Every dispatched agent re-derives it before acting. The `.planning/.state/review.json` receipt, the reviewer-identity gates, and the approver/reviewer separation machinery are retired with the spine that needed them.
  - **Plan review is computed and happens before dispatch.** `plan-lint.ts` (21 rules — dependency cycles, unmapped criteria, uncommanded acceptance clauses, red-command disagreement, writable-path overlap, self-gating tasks) scores the built args, and `plan-preflight.ts` executes every `redCommand` and `mechanicalCheck` at baseline, both enforced by `craft-dispatch.sh` while the run is still armed. No agent reads plan markdown looking for defects. This is the `CLAUDE.md` #9 rule applied to our own machinery: an open-ended critique of a document does not terminate, because the fix for round *n* adds text that round *n+1* finds real new defects in.

- **Six skills came from the author's dotfiles tree:** `craft`, `dev`, `ds`, `writing`, `workshop`, `workflow-creator` — plus `farm-out`, the dispatcher craft runs its agents through, so the plugin dispatches without an outside install. Paths are `${CLAUDE_PLUGIN_ROOT}`-relative or self-locating (`BASH_SOURCE` in shell, `import.meta.dir` in tests), and `craft-dispatch.sh` injects `skillRoot` into the workflow args so the prompts `workflow.js` builds name paths that resolve on the installing machine.

### Removed

- `scripts/beat/`, `scripts/wc/`, `scripts/dev/`, `scripts/workshop/`, `scripts/writing/`, and the per-domain runners `workflows/{work,writing-draft,writing-verify,workshop-generate,workshop-verify,workflow-creator-verify}.js`.
- 28 hooks: the `episode-*`, `approved-artifact-*`, `implementer-identity-gate`, `orchestrator-mutation-guard`, `reviewer-verdict-guard`, `phase-gate-guard`, `mechanical-floor-gate`, `work-implement-observation`, `ds-*-subagent-*`, `workshop-*-guard` and `writing-*-guard` families, plus `pre-compact.ts` and `subagent-start.ts`, whose entire function was classifying `.planning` lifecycle state.
- The compiled-runner cluster — `workflows/templates/`, `scripts/lib/{compile_core,plan_table_core,artifact_snapshot}.py` — which nothing outside itself referenced once the domains stopped compiling `run.js`.
- 20 role agents (`dev-implementer`, `ds-analyst`, `writing-drafter`, `plan-checker`, …). craft dispatches implementers, verifiers and reviewers with the prompt the run needs; they are not named subagent types. `librarian` and `writing-prose-reviewer` remain, because surviving skills name them.
- `references/plan-review/` (32 files of judged plan-review criteria) and 51 orphaned constraints. Where a criterion mattered it became a `plan-lint.ts` rule; the rest described machinery that no longer exists.
- The plans-directory restart gate (`scripts/ensure-plans-directory.ts`, `hooks/plans-directory-restart-gate.ts`, `hooks/lib/plans-restart-marker.ts`). It wrote `plansDirectory: "./.planning"`, which is wrong for craft, and no craft skill invoked its preamble. **This is a capability reduction:** craft's `SKILL.md` now instructs the user to set `plansDirectory` and warns about the restart, where a hook used to enforce it.
- ~70 test files whose subject no longer exists, and 12 golden fixtures for deleted hooks.

Every deletion followed one rule — an empty referrer set once the skills were gone — re-derived after each wave rather than taken from the first pass.

### Changed — machinery that was reworked rather than dropped

- **`hooks/lib/writing-plan-context.ts`** resolved an APPROVED receipt-selected plan under `.planning/.state/`. It now walks up to the nearest `.claude/plans/*.md` carrying a `craft:dispatch` block and a `## Writing Intent` heading. The plan grammar it parses is unchanged, which is why `writing-prose-check.ts`, `cite-fidelity-lint.ts` and `set-output-style.ts` still pick the right register.
- **The three domain style guides moved into one skill.** `strunk-elements-of-style.py`, `mccloskey-economical-writing.py` and `volokh-distilled.py` were carried by `writing-general`/`writing-econ`/`writing-legal`; they now live in `skills/writing/references/`, and `prose-audit.py` and `prose-lint.py` follow them. Domain gating could no longer key on the skill *directory*, so `check-all.py` gained `DOMAIN_FILE_MAP` and gates by filename. The regression this prevents was observed during the migration: with the directory filter inert, a general-register draft got Volokh findings stacked on top of the wikipedia-promotional finding for the same span.
- **Five writing authoring-lints moved with them** and are still auto-discovered, because `check-all.py` already globbed `skills/*/references/*.py`. A sixth, `writing-stop-triggers.py`, was deleted rather than moved: it asserted that a constraint's `applies-to` frontmatter named a skill calling `load-constraints.ts`, and craft's skills do not call the loader.
- **The law-review and law-econ docx templates moved to `references/templates/`.** They lived in `skills/writing-legal/templates/` but four surviving skills — `law-review-docx`, `law-econ-docx`, `docx-typst`, `docx-repair` — depend on them, so the spine deletion would have taken assets that were never the spine's.
- **`scan-public-privacy.ts` grew a code-owned `PRESERVED_BINARIES` list**, each entry pinned to its reviewed sha256. The scanner previously accepted no tracked binary at all, which the workshop skill's fixture PDFs tripped. A preserved binary is never text-scanned, so the digest is the only control standing between a payload and publication: `captureCandidate` now treats a disposition for a path the candidate does not carry as inert, but still refuses a digest that does not bind.
- **`capabilities.json` publishes `craft-spine-runner`** (`skills/craft/workflow.js`, contract 1) in place of `phase-gate-evaluator`, `approved-artifact-policy`, `workflow-policy-loader`, `beat-implement-runner`, `beat-spine-runner`, `beat-spine-args`, `plan-review-composer` and `tasklist-reconciler`. There is no shim — a consumer resolving a retired name gets the documented absent-capability rejection, which is the honest answer.

### Documentation

- `README.md`, `PHILOSOPHY.md` and `skills/using-skills/SKILL.md` rewritten around the craft loop. `PHILOSOPHY.md` keeps its doctrine and marks what the migration falsified: the compile-don't-interpret section records that the compiler is gone and the same idea moved one level up, and the shared-constraints section records that sharing was the mitigation and removing the second copy was the fix.
- `docs/DESIGN-third-party-review.md` retargeted to craft's runner; the retired `briefSources`/`briefsDelivered` receipt is recorded as retired along with the principle it encoded. `docs/DESIGN-prose-constraint-architecture.md` keeps its investigation as written and gains a §7 recording where the wiring moved. `docs/extension-contracts.md` documents the new capability and names every retired one so a broken consumer learns why.
- Deleted as superseded: `docs/{DESIGN-beat-transitions,beat-adoption-migration,workflow-lifecycle-architecture,compiled-runner-architecture,common-infra-candidates,ds-generalization-assessment,ds-plan-canonical-table,wc-creator-assessment,wc-creator-followup-survey,model-profiles,extension-mechanism-map}.md`, the four `DESIGN-*-spec-plan-compile.md` records, `docs/t8-live-runs/`, and `references/codex-availability.md`.

### Testing

- `bun test tests/` reports 0 failures; the pre-migration baseline had 1.
- `scripts/check-tests.sh` reports 24 passed, 1 failed — `ds_dq_runner_test.py`, which needs `polars` the runner does not inject and fails identically at the baseline commit.
- `scan-public-privacy.ts` reports 0 findings across the seven added skills. `plugin-validate` passes. All six version sites agree at 6.0.0.
- In their new home, craft's own suite passes 388 tests and workflow-creator's 403. The workshop suite's 19 failures out of 108 were verified to match the untouched dotfiles copy exactly, so they are pre-existing rather than migration damage.
- No `/home/eh` paths remain in any moved skill.

## [5.137.0] - 2026-08-05

### Added
- **The writing workflow now offers to set the project's `outputStyle` to the register its plan declares.** Output styles are user-selected and nothing loads them for you, so the three registers shipped in v5.136.0 reached the main conversation only if someone remembered to pick one in `/config`. `writing-setup` step 7 asks once per project, after the receipt reads `APPROVED`, and runs `scripts/set-output-style.ts`.
  - **It derives the register; it does not take one.** `set-output-style.ts` accepts a project root and reads the Domain through the same `authenticatedWritingPlan()` that `hooks/writing-prose-check.ts` uses to pick `--style`. A style argument would create a second source for "what register is this," and a CLARIFY answer the user revised during planning would silently outrank the plan while every gate enforced the other one. No APPROVED receipt means no write — not a default, not a guess.
  - **It merges exactly one key, atomically.** `.claude/settings.local.json` carries `permissions`, outranks project settings, and is git-excluded by Claude Code when it writes there, so a clobber is both damaging and invisible to `git status`. Unparseable JSON is a REFUSAL: a settings file that failed to parse is far more likely mid-edit than garbage.
  - **It takes effect next session, and says so.** The output style is part of the system prompt, read once at session start. Step 8 already requires a fresh session before implementation, so the boundary the setting needs is one the workflow was taking anyway. Unlike `plansDirectory` — where a mid-session write left the episode unauthenticated and an advisory line measurably lost to the task in progress, forcing `plans-directory-restart-gate.ts` — this is prose voice, not authentication, and the subagents get the same register through the preloaded skill either way. A notice is proportionate; a gate would not be.
  - `emit-registers.py` also emits `references/registers/output-style-map.json` (`legal` -> `Law review`, …) from each source's `style:` and `name:`. Hand-writing that mapping anywhere else is a fourth copy that goes stale on the first rename and fails silently — an unresolvable name just leaves the user on the default with nothing reported.

### Testing
- Third-party review over the diff found four findings; three were real and are fixed, one was rejected.
  - **The `PENDING` fixture proved the wrong thing.** It populated the reviewer fields, which `approved-artifact.ts:246` rejects as a *schema* error — so the test showed a malformed receipt being refused, not an unreviewed plan. Well-formed `PENDING` and `ISSUES_FOUND` cases now both assert the refusal.
  - `styleMap()` did no type validation, so a truthy non-string map value would sail past `if (!name)` and be written as `outputStyle` — a value no style can match.
  - The settings write was not atomic; it now writes a sibling and renames.
  - **Rejected:** "an empty settings file is clobbered." An empty file has nothing to clobber, and if an editor truncates before writing, the loser of that race is this script's write, not the user's content. The empty-file case is tested as the intended behaviour.

## [5.136.0] - 2026-08-05

### Added
- **Register and voice guidance now reaches the drafting and reviewing subagents, from one source per domain.** Three style guides ship in this plugin — Strunk (`writing-general`), Volokh (`writing-legal`), McCloskey (`writing-econ`) — each ~588 lines of prose guidance plus a regex table. `prose-audit.py` loaded the *regex tables* and gated them by `--style`; **the prose guidance reached no agent at all.** Output styles are main-conversation only (a subagent runs its own system prompt), and the drafting agent had no file to attach anything to: `workflows/writing-draft.js` dispatched the *default* workflow subagent for Transform.
  - New `references/registers/{general,legal,econ}.md` are the SOURCE OF TRUTH. `scripts/emit-registers.py` generates `output-styles/{law-review,econ-journal,general-prose}.md` and `skills/writing-register/SKILL.md` from them; `--check` exits 1 on drift, the same shape as `bump-version.sh --check`. Three hand-maintained copies of one register table drift, and the drift is silent because nothing reads all three at once.
  - New `agents/writing-drafter.md` preloads `writing-register` + `ai-anti-patterns` via `skills:`, and `writing-draft.js` routes **Transform only** to it. Verify stays on the default agent: verification primed with the same guidance the drafter used is not independent verification.
  - `agents/writing-prose-reviewer.md` preloads the same pair. Its `tools` are `Read, Grep, Glob` — no `Skill` tool — so preloading is its ONLY possible channel, and the register prose it used to restate inline is deleted so there is one copy.
  - The preloaded artifact is ONE combined file, not three. The register facts are contrastive by construction (`we`: 0.87% of law sentences vs 7.75% of finance), and `skills:` frontmatter is static — it cannot vary by the plan's `style` at dispatch time.
- **`writing-general` becomes a third register, not just a base layer.** `general-prose` covers SEC comment letters, memos and briefs — prose that is neither a law review nor a journal article, and had no register at all before.

### Changed
- **The guide rules are corpus-filtered into ship / advisory / dropped, with the measured rate beside each.** Running the three guides' own prescriptions through the two control corpora (5,560,816 law-review sentences; 8,733,332 finance/accounting) splits them three ways. *Ship*: `at this point in time` 1.8/M, `skyrocket` 2.9/M, `time frame` 37/M — cost-free. *Advisory*: sentence-initial `However,` 6,666/M, `the X process` 4,482/M, `very <adj>` 3,277/M, `in order to` 2,472/M, `the fact that` 2,176/M — a hard rule here fires on ~1 sentence in 15, so it is noise. *Dropped*: McCloskey's `agents`→`people` (1,728/M in finance) and `hypothesize`→`suppose` (683/M), Volokh's `pursuant to` (837/M in law, 26× finance) — those are terms of art and the legal register itself, and enforcing them damages the draft.
  - `writing-prose-reviewer`'s three-row Volokh/S&W/McCloskey summary is gone. It predated the corpus check and told the reviewer to cut hedges from law review prose (`may`/`might`: 3.56% of law sentences, register-appropriate) and to prefer active voice on principle (passive: 7.91% law vs 8.55% finance — not a register marker at all).

### Fixed
- **Three agents carried a `hooks:` frontmatter block that had never done anything.** `hooks`, `mcpServers` and `permissionMode` are ignored for plugin-shipped agents; the linting `dev-implementer`, `ds-analyst` and `ds-engineer` appeared to configure came from `hooks/hooks.json` all along. This mattered beyond tidiness: the plan for this feature was written around that block as the proven pattern for closing an audit loop inside the drafting agent. Removed, with a note in each body pointing at the real registration, and `tests/writing-register-contract.test.mjs` now fails if any agent reintroduces one.

### Testing
- New `tests/writing-register-contract.test.mjs` (128 assertions). The load-bearing one: **every `skills:` entry in every `agents/*.md` must resolve to a real skill that does NOT set `disable-model-invocation: true`.** All three existing style skills set it, and a preloaded skill that does is skipped with a warning to the debug log only — the agent launches, the guidance never arrives, and the review reads as if it did. That assertion would have caught the blocker before implementation.
- Third-party review over the diff (Codex + Gemini) found six real defects, every one a **vacuous pass** — a check that could not fail:
  - The test's frontmatter reader understood block lists but not inline `skills: ["a", "b"]`, so an inline preload list put every per-skill assertion — including the one above — into an empty loop.
  - `!== 'true'` let `disable-model-invocation: true  # why` through: valid YAML, boolean true, not the string `'true'`.
  - `tools` read from `scalars` only, so a block-list `tools` made the "reviewer has no Skill tool" claim pass against an empty string.
  - `emit-registers.py --check` validated only the expected paths, so an orphaned `output-styles/*.md` left after a source rename kept shipping (the directory is auto-discovered) while `--check` reported OK.
  - `cut_block` matched its markers as substrings anywhere, so a source that merely *discussed* `SHARED-BASE:START` could relocate the cut; and it took only the first pair, so a second block survived into the output carrying stray markers.

## [5.133.0] - 2026-08-05

### Added
- **The third-party farm-out is a beat primitive, and each domain supplies only its own rules.** It was already provider-neutral by construction, but the DOMAIN KNOWLEDGE was welded into one adapter: `adapters/prose.ts` inlined ~15 lines of writing-specific corpus rules, so the only way to give a reviewer another domain's rules was to edit that adapter — which is why `ds` and `dev` could not use this path at all. Rules now arrive as a caller-supplied `skills` key in the runner's stdin JSON, at the same authority level `scope` already sits at. The OPT-IN stays plan-carried and `planHash`-bound; only *which rules* is caller-side.
  - New `scripts/beat/skill-brief.ts` resolves a bundle to bytes. A bare name takes the skill's `references/third-party-brief.md`, else its `SKILL.md`; a skill-relative path takes that file. A named-but-missing bundle **throws** rather than yielding zero rules — a typo silently supplying nothing is the same silent zero the `status` field exists to prevent, one layer up, with the reviewer judging against nothing and reporting cleanly. Over the 60 KB cap throws too, rather than truncating a rule set mid-sentence.
  - `AdapterResult.briefSources` carries skill, path, bytes and sha256 of every brief handed over, on **every** return path including the failures, for the same reason `raw` is. This is the invariant the inlining was protecting: the version before it merely *instructed* the reviewer to load two skills, nothing checked whether it had, and after the rule611 review the question was unanswerable rather than unanswered. The delivery mechanism can now change; the receipt cannot.
  - New internal `skills/beat-third-party/SKILL.md` owns the reading rules once — read `status` before `findings`, an `unparseable` adapter has not necessarily said nothing, advisory-only, and the measured $5–15 per adapter pair. They had been written out three times (`beat-implement`, `writing-review`, and inline in `workflows/writing-review.js`); two of those copies were free to go stale and the writing one already had, still quoting the $0.12 input-token floor the v5.132.0 entry above corrected.
  - `ds` and `dev` get documentation and a working `skills` value, **not** a new automatic paid step. Default OFF stays the absence of the plan line.
  - `deliverBriefs()` is a marked seam for `herdr --skill` (0.8.0), deliberately unwired: 0.7.5 is installed and the flag's signature has not been read.

### Fixed
- **`third-party-review.ts` had no CLI entrypoint, so every documented invocation produced nothing.** `beat-implement`, `ds-review` and `workflows/writing-review.js` all instruct an agent to run `echo '{...}' | bun scripts/beat/third-party-review.ts`, and that piped JSON into a module that defined exports, wrote nothing and exited 0. A caller reading the empty stdout had no `status` to branch on — the one failure this file is built to prevent, reachable from its own shipped instructions.
- **The writing bundle delivered none of the rules it claimed** (caught by an adversarial review of the commit above, before release). `["ai-anti-patterns", "de-ai-revise"]` resolved by the bare-name rule, and neither skill had a `references/third-party-brief.md` — so the reviewer received two harness-facing `SKILL.md` files (scripts to run, hooks, phase gates) while the em-dash-splits-by-model and register-decides rules deleted from `prose.ts` reached nobody. The bundle resolved, hashed and delivered cleanly throughout, and every hash-level assertion passed. Both briefs now exist, and the suite asserts the PROMPT CONTENTS rather than the receipt — which is what the old inlined-rules assertion guaranteed and what a hash cannot.
- **The receipt claimed delivery on paths that never reached a provider.** Carrying `briefSources` on the failure paths — the point of the field — silently merged two claims: what the adapter was *handed*, and what a reviewer *saw*. A scope refusal, an unreadable document, or a wrapper that could not be spawned each reported a populated list with nobody having seen a byte. A receipt for something that did not happen reads as evidence, which is the same defect as a truncation that destroys the evidence for the failure it reports. New `briefsDelivered` is true only when a non-empty bundle rode a provider call that returned; `briefSources` keeps its every-path guarantee.

## [5.132.0] - 2026-08-04

### Fixed
- **`prose-codex` reported ZERO findings while having produced seven.** Measured on the rule611 comment letter at v5.131.0: the adapter returned `unparseable` — "codex-code output carried no JSON findings block" — against a complete, well-formed reply carrying seven findings, one anchored to span S009 and one naming a truncated sentence in the letter that no internal gate had caught. All seven were discarded at the parse step, not by the reviewer. Its `spanIds` was `[]` for the same reason: replaying the fixed selector recovers **all 38** considered span ids, so codex had engaged with the injected audit exactly as gemini did.
  - Cause, confirmed by replaying the shipped function over the reviewer's own transcript: `parseReply` took the FIRST fenced block in the concatenated reply and committed to it. The reply contained eight fences; the first held an arithmetic aside (`49,135,555 − 19,751 − 9,150 = 49,106,654`), which is not JSON, so `JSON.parse` threw and the answer three fences later was never reached. `prose-gemini` survived the same release only because its reply happened to contain exactly one fence — position was doing a contract's job.
  - Selection is now BY CONTRACT: every candidate (each fenced block, an unterminated trailing fence, the bare text, the widest brace slice) is tried in order and the first that parses AND carries a `findings` array wins. This is correct under every candidate explanation for the stray fences — including the one that could not be tested, since WHERE those six earlier fences entered the stream remains unidentified. The reviewer's own turns hold only the final answer, twice, both parseable; subagent text was measured NOT to reach stdout as assistant text. Note that "take the LAST fence" would not be correct: an earlier valid-JSON decoy still beats it, and a test covers that.
- **The failure path truncated away the evidence for the failure it was reporting.** `raw` was `tailRaw(text)` — the last 4000 characters — so the v5.131.0 report displayed a valid JSON object next to a message saying no JSON object was found, and diagnosing it required the provider's session transcript from disk, evidence that happened to exist and for a run inside a plan would not. New `headTailRaw` keeps both ends with the elision explicitly marked, and is used on both failure paths. `tailRaw` remains correct on the success path, where the answer parsed and the accounting is at the end.
- **Auditability existed exactly where it was least needed.** On `unparseable`, `raw` is the extracted assistant TEXT, so it can never contain a `tool_use` block — a reader counting tool use in it concludes the reviewer never opened a file, when the field was incapable of showing one. A new `transcript` field carries the stdout separately on failure paths. "Did the reviewer open any files?" was previously answerable only when the run SUCCEEDED.
- **One reason string covered two different failures.** *No JSON object* means the reviewer answered in prose and the prompt needs work; *a JSON object with no `findings` array* means it answered in the wrong shape and the schema does. The reasons are now distinct, and the second names the keys it did receive.
- **A circular import made the adapter modules order-dependent.** `prose -> third-party-review -> registry -> prose` threw `ReferenceError: Cannot access 'proseCodexAdapter' before initialization` at `registry.ts:19` whenever an adapter was imported before the runner. The shipped entrypoint happens to import the runner first, which is what made this a latent packaging hazard rather than a visible bug. The contract (types, `DEFAULT_SCOPE`, `SEVERITIES`) moved to a new leaf module `scripts/beat/contract.ts` that depends on nothing; `third-party-review.ts` re-exports every name, so the public surface is unchanged.

### Changed
- **The cost comment has now been wrong twice, each time low, and is re-baselined with its own history.** v5.127 documented "$0.12 per adapter" (the input-token floor mistaken for the bill); v5.131 documented "$1.18 for the pair" (measured, but on 1-3 turn runs). Measured on the same ~40k letter after the reviewers were asked to open sources: **$10.35 for the pair** — prose-codex $4.198 (520s, 9 turns), prose-gemini $6.152 (144s, 18 turns). Cost here is dominated by TURNS, not by the draft, so the comment now documents a $5-15 range and points at `usage.totalCostUsd` rather than offering one reassuring figure.
- **The harness wrapper is off probation.** v5.131 kept `codex-code`/`gemini-code` on the bet that a tool loop with repo access would be used once the prompt gave a reason. It is: prose-gemini ran 18 turns with 8 `tool_use` blocks and independently verified eight SEC release line-cites against the source; prose-codex ran 9 turns over 520s and spawned three subagents. The contemplated fallback to a plain provider CLI is now the wrong move — it would delete the capability that produced the only externally-verified claim either reviewer made. The 9x bill above is the price of that capability; both facts came from the same run.
- **`writing-review` guidance no longer treats `unparseable` as silence.** The skill and the workflow prompt both now say to quote the `reason` and read `raw` and `transcript` before concluding a failed adapter said nothing.

### Testing
- 14 new assertions reproducing the real multi-fence reply shape, the valid-JSON decoy, an unterminated fence, bare unfenced JSON, both distinct parse-failure reasons, head-and-tail retention with its elision marker, and the transcript/raw split. Suite 73 -> 109.

## [5.131.0] - 2026-08-04

### Fixed
- **Typst markup was being reported as an AI provenance leak, at HARD severity.** `#emph[First],` in a real regulatory comment letter matched `wikipedia-template-artifacts`' `[Name]`-style placeholder rule — and the reviewer prompt tells every reviewer a hard span "is a provenance leak … almost never defensible". Ordinary emphasis in a Typst filing was therefore injected into three reviewers as high-confidence evidence of AI authorship. `prose-audit.py` now neutralises Typst (`#emph[…]`, `#strong[…]`, any `#name(…)[…]`) and LaTeX (`\emph{…}`, `\cite[…]{…}`, `\begin{…}`) markup before matching, blanking the DELIMITERS and keeping the prose between them at the same offsets.
  - It also recovers prose that was being dropped silently: `prose_extract` skips a Typst line that STARTS with `#`, so a paragraph opening `#emph[First],` never reached any scorer at all. On the letter that is 3 more paragraphs scored and 2 fewer false hard spans — from 2 hard to 0.
  - `#let` / `#set` / `#show` / `#import` stay code and stay skipped: the neutraliser fires only on `#name` immediately followed by `[`.
  - Footnote masking runs BEFORE neutralisation. The other order strips the `#footnote[` wrapper and leaves the citation text looking like body prose.
- **The cluster-diction tier used a paragraph offset as a column.** Every match past a paragraph's first line landed at a column beyond the end of its own line, mislocating the span and silently defeating overlap collapse against every other system's real columns. Found independently by both third-party reviewers.
- **`prose.ts` kept the wrong end of the transcript.** `raw` was the FIRST 4000 bytes, which on a real review is SessionStart hook chatter — measured, `"total_cost_usd" in raw` was false for both adapters even after v5.129.0 started returning `raw` on the success path. It now keeps the TAIL, cut on a line boundary, and `extractUsage` lifts `total_cost_usd` / `duration_ms` / `num_turns` out of the terminal `result` event into typed fields on every `AdapterReview`.
- **The cost comment was ~10x low.** Measured on one real review of a ~40k comment letter: prose-codex $0.669 (139s, 3 turns), prose-gemini $0.508 (31s, 1 turn) — $1.18 for the pair, against a documented "$0.12 floor per adapter".
- **`workshop-verify.js` resolved plugin fallback paths with `ls | tail -1`.** Plain `ls` sorts lexically, so a cache holding 5.99.1 and 5.130.0 hands `tail -1` the **5.99.1** tree — measured on a real cache, 31 minor versions stale, and silently, because the path it names exists and runs. Both fallbacks now use `sort -V`, which the tinymist fallback three lines down already did.

### Changed
- **The prose reviewers are now asked to check the draft against the repository.** The harness wrappers (`codex-code` / `gemini-code`) are shelled instead of the raw provider CLIs to buy a tool loop with repo access, and on the first fully-measured run NEITHER adapter emitted a single `tool_use` block — but the prompt had never given a reason to open a file, so that measured the prompt, not the capability. `buildPrompt` now asks the reviewer to verify numbers, citations and source claims against the repo and to report what it found either way. If `numTurns` stays at 1 across the next few real reviews, the honest move is a plain provider CLI, and `usage` is now recorded per review so that is decided by evidence.

## [5.130.0] - 2026-08-04

### Added
- **docx OOXML tooling, promoted out of the opv paper repo.** Four project-local scripts turned out to be general OOXML work with no knowledge of the manuscript they were written for, and three of them had independently rediscovered the same fact — that a hyperlink in OOXML is TWO facts in two parts, the run text a reader sees and the relationship Target the click follows, with nothing keeping them in sync.
  - `skills/docx-repair/scripts/docx_links.py` — consolidates clean-links, normalize-SSRN and strip-footnote-links into one tool with three passes, each of which now rewrites both halves of a hyperlink instead of one.
  - `skills/docx-repair/scripts/docx_spacers.py` and `skills/docx-typst/scripts/make_redline.py`.
  - `skills/law-review-docx/references/title-page-spacing.md`.
  - Landed via the `docx-promotion` branch, whose own `chore: release v5.126.0` was superseded by this release; the version sites were resolved forward to main rather than walked back.

## [5.129.0] - 2026-08-04

### Changed
- **One deterministic prose audit, injected as evidence instead of asked for as an instruction.** Five pattern systems (238 entries) were loaded by four different loaders with no single answer to "what did this draft score?". `scripts/prose-audit.py` is now the only entry point: scored AI-tics, the six `wikipedia-*` tables, the domain style guides, tiered diction, stylometrics, US-register spelling and em-dash density, over `.md`, `.typ` and `.docx`, with footnotes masked in all three and stable `S###` span ids. Full investigation and the shipped-vs-proposed diff: `docs/DESIGN-prose-constraint-architecture.md`.
  - **The double-report bug dissolved rather than being patched.** `writing-prose-check.ts` ran prose-lint AND check-all in one invocation, and its `PROSE_LINT_SUPERSEDES` set named three constraints — none of them the `wikipedia-*` tables, which were in both engines. Every AI-tell inside an edited range was reported to the model twice. Overlapping hits on the same column range now collapse into ONE span carrying every contributing label at the highest contributing severity; `rich tapestry`, which matches a sev4 scored tic, `wikipedia-promotional` and diction `always_flag`, is one finding.
  - **The reviewers get the span list, not a suggestion to go and compute one.** `workflows/writing-review.js` runs the audit before the L1 fan-out and injects the spans into the prose reviewer's prompt; `agents/writing-prose-reviewer.md` no longer prints a Bash line and hopes. `scripts/beat/adapters/prose.ts` does the same for `prose-codex` and `prose-gemini`, replacing "load these skills first" with the spans plus the reference-12 decay findings inlined verbatim.
  - **Ignoring the evidence is checkable.** The prose finding schema requires `spanIds`. A reviewer that returns none while hard spans exist for its section is marked `unreliable` and its findings discarded — the same treatment a reviewer with fabricated quotes already got.
  - **`de_ai_audit.py` is a thin wrapper** over `--profile de-ai`. Its public JSON is unchanged and `tests/test_de_ai_audit.py` + `tests/test_de_ai_footnote_masking.py` pass unmodified.

### Fixed
- **`de_ai_audit.py` was blind to the entire provenance-leak class, and it was the one scorer the prose reviewer was pointed at.** On a tic-laden fixture it returned 9 spans and missed every hard artifact: `As an AI language model`, `I hope this helps`, `citeturn0search0`, `oaicite`, `stands as a testament`, `plays a vital role`, `Despite these challenges`. All seven are now reported, four of them `hard`.
- **`check-all.py` threw away the `SEVERITY` its own constraint modules declare**, so `mechanical-floor-gate.ts` and `writing-mechanical-gate.ts` blocked on every failure equally: advisory puffery stopped a phase exactly as hard as a provenance leak. Severity now rides per `failed[]` entry and both gates deny only on `hard`, reporting soft failures in the allow payload as context.
- **`hooks/lib/writing-plan-context.ts` never parsed the plan's Domain.** `planSection`'s `(?=^##\s|$)` uses `$` under the `/m` flag, which matches at the first line break, so every section came back empty — meaning `style` was ALWAYS `""` and the Volokh / McCloskey guides never loaded for any draft the prose hook linted. Measured on a real approved plan, not inferred.
- **`prose.ts` discarded the success-path transcript.** `unavailable` and `unparseable` carried `raw`; `reviewed` did not, so the one case where the provider actually worked was the one that left no `total_cost_usd` and no tool-use record. That is why nobody could answer, after the rule611 comment-letter review, whether either external reviewer had applied the rules its prompt named. `raw` is now returned (truncated) on the success path too.

### Removed
- `references/constraints/writing-ai-smell-{puffery,structure,artifacts,em-dash}` (four `.md`/`.py` pairs) — the same system as the `wikipedia-*` tables, built twice. Their unique patterns were merged in and marked `[ex-ai-smell]`; the superlative self-attribution heuristic (a 60-char window to a self-contribution noun) survived as the better implementation and is now a table entry every loader can see. Em-dash density, which is paragraph- and section-level logic rather than a line regex, moved into `prose-audit.py` with its thresholds unchanged.
- `skills/ai-anti-patterns/scripts/screen.py` — a third loader of tables two other loaders already ran, called by nothing but one test.
- `PROSE_LINT_SUPERSEDES` — replaced by a directory prefix rule that cannot go stale as tables are added.

## [5.106.5] - 2026-08-02

### Fixed
- **The compliance probe reported "0 findings" on a repo it had not examined.** Pointed at `teaching` — 19 skills, 6 hooks — it discovered ZERO workflows and returned clean, because discovery keyed on this plugin's own gate names (`orchestrator-mutation-guard`, `approved-artifact-gate`) and teaching uses `native-workflow.ts gate`. Ignorance rendered as reassurance, in the tool written one release earlier to catch exactly that class. Discovering nothing is now a `probe-blind` finding that short-circuits every other check, on the same principle as the implement gate treating a missing record as a refusal.
- **Beat adoption is no longer asserted against consumer plugins.** "Loads `<beat>/SKILL.md`" only means something where those files exist locally. Applied to teaching it produced 21 findings, each amounting to "no skill loads a file that is not here and could not be loaded if it were": `beat-clarify` and `beat-review` are `user-invocable: false` and are **not published as capabilities**, so no consumer has a sanctioned way to reach them. A consumer reaching the beats through the capability manifest is now reported as one finding pointing at the real defect — a publishing gap in THIS plugin — rather than 21 blaming the consumer.

## [5.106.4] - 2026-08-02

### Fixed
- **`hooks/typst-convention-guard.ts` was registered nowhere and had never run.** Found by `scripts/wc/compliance-probe.ts` — the checker built one release earlier in response to the identical defect in `work-implement-observation.ts`. Third instance of the same shape, first one caught by a tool instead of an audit. Registered in `hooks/hooks.json` on `PostToolUse` `matcher: "Edit|Write"`, which is where it belongs: the `.typ` writes it guards happen inside `workshop-generate`'s dispatched subagents, and skill frontmatter does not reach those.
  - **Its 17-case golden passed throughout and could not have caught this.** `tests/golden/` is a PARITY harness pinning stdout hashes for the Python-to-TypeScript port, and every one of those cases asserts SILENCE — not one exercises a violation, so deleting every check in the guard would have left it green. Parity proves the port is faithful; it says nothing about whether the ported thing is worth running.
  - `tests/typst-convention-guard.test.mjs` (new) holds what the golden cannot: on a real violation the guard emits a real finding, and on clean input it stays quiet. Both halves, because a guard that reports everything is as useless as one that reports nothing.
  - `KNOWN_FINDINGS` in `tests/compliance-probe.test.mjs` is now empty. It went red on the fix and named the entry to delete, which is the whole reason it is asserted rather than merely listed.

## [5.106.3] - 2026-08-02

### Fixed
- **The v5.106.1 registration was inert, measured by execution.** That release registered the observation hook only in skill frontmatter. Skill-frontmatter hooks fire only while the skill is ACTIVE, and every caller of `beat-implement` READS its `SKILL.md` rather than invoking it — it is `user-invocable: false, disable-model-invocation: true`, so it cannot be invoked at all.
  - The probe, with 5.106.2 installed: a fresh session read `skills/beat-implement/SKILL.md` and dispatched a subagent whose prompt began `TASK probe-alpha:`. The subagent ran and replied. **No record was written anywhere on the filesystem** — not in `/tmp`, not in `$TMPDIR`, not in any `work-implement-observations` directory, and not even the `no-expectation` record the hook writes on every path including its own failure.
  - So v5.106.1 was v5.106.0 with a passing test in front of it, and the test was the problem: it read YAML and asserted strings were present, which cannot distinguish a matcher Claude Code honours from one it ignores. Same reference-versus-mechanism error, fourth iteration, this time inside the fix for the third.
  - `docs/extension-mechanism-map.md:58` had already recorded the uncertainty — *"Not confirmed live … Settle by execution, not reading."* It was not consulted before shipping.
  - Registered in `hooks/hooks.json` on `matcher: "Agent"`, both phases. That path is confirmed live, always on whenever the plugin is enabled, and has subagent reach. `tests/observation-hook-registration.test.py` now REQUIRES it and treats the skill frontmatter entries as defence in depth. Non-implement dispatches remain free: `taskIdFrom` returns undefined without a `TASK` marker, so the hook exits immediately and writes nothing.

## [5.106.2] - 2026-08-02

### Added
- **`scripts/wc/compliance-probe.ts` — deterministic compliance checks that audit the plugin hosting them.** `workflow-creator` is a meta workflow, so it must be able to audit the workflows plugin itself; an auditor that only inspects generated workflows catches the next workflow's version of a defect and never its own host's, and every defect this week was in the host. Three checks — beat adoption, hook registration, and fail-open-without-a-gate — plugged into `wc-audit`'s existing `mechanicalProbes` seam rather than added as a reviewer dimension, because a probe's exit status is evidence and a reviewer's score is an opinion. `wc-audit`'s reviewers are LLM agents, and the characteristic way to get a configuration property wrong is to measure the reference instead of the mechanism: an agent asked "does this workflow use the beats" greps for the name and finds it.
  - Workflow discovery is DERIVED, not hardcoded. `tests/beat-adoption.test.py` pins six names, so a seventh entry point is not failing but invisible.
  - Writing it reproduced the exact error it exists to catch, twice, and both are pinned as regression cases. The first discovery cut ("user-invocable and dispatches agents") produced 29 findings, eleven false — utilities with no approval regime, and family members mistaken for workflows. The fail-open check matched PROSE, flagging two hooks that call `denyOnCrash`; two false positives out of three findings.
  - Against this repo: one finding. `hooks/typst-convention-guard.ts` is wired to no event and named by no skill, so it never runs — while its golden test passes, which is the point. Recorded in an asserted `KNOWN_FINDINGS` registry.

### Fixed
- **The observation hook resolved task ids by a blind parse, so an id containing a colon matched no bounds.** The marker is `TASK <id>: <name>` and both halves are free text, so `TASK Part I: Foundations` is ambiguous on its face; `/writing` keys tasks by section name and a colon in an academic title is ordinary. It parsed to `Part I` and the task went unadjudicated. Ids are now resolved against the expectation's own list, longest match first, so a prefix id cannot steal another's dispatch. This is a distinct defect from the payload-shape bug fixed in 5.106.1.

## [5.106.1] - 2026-08-02

### Fixed
- **`hooks/work-implement-observation.ts` was registered in NOTHING, so v5.106.0's IMPLEMENT enforcement never ran.** No `hooks.json` entry, no skill frontmatter, no `matcher: "Agent"` anywhere pointing at it. `scripts/beat/preflight.ts` wrote an expectation file that nothing ever read, and the between-dispatch adjudication — the half that catches an agent writing outside its authority or misreporting what it wrote — did not fire for `/ds`, `/dev`, `/work`, `/writing`, `/workshop` or `/workflow-creator`. Found by two independent audits, not by any test.
  - The hook had 35 passing behaviour tests. Every one proved it does the right thing WHEN INVOKED, and nothing asked whether it ever was. `tests/mutation-guard-registration.test.py` exists for exactly this class and was not extended to the new hook; `skills/ds-delegate/SKILL.md` already registered an analogous hook on `matcher: "Agent"`, so the pattern existed and was not followed.
  - Registered in all eight dispatching skills, both phases. Both are required: with only `post` there is no baseline and every task is unattributable; with only `pre` nothing is adjudicated. A half-registration is not a weaker guarantee, it is none, and it looks fine in a diff.
  - `tests/observation-hook-registration.test.py` (new) holds registration as a CONFIGURATION assertion, since no behaviour test can. Mutation-probed against both failure shapes, including the subtle one: registered, but on a matcher that never fires on a dispatch.

- **The absence-is-failure gate did not exist**, which is why the above went unnoticed. `scripts/beat/implement-gate.ts` (new) refuses a wave unless every dispatched task was observed and adjudicated clean, and reports the causes distinctly — `no-expectation`, `missing-pre`/`missing-post`, `observation-failed`, `not-adjudicable`, `violated` — because their remedies differ and only one of them is the agent. This is what makes the hook's fail-open design safe; without it the records are decoration. `tests/implement-gate.test.mjs` (new, 18) asserts every shape where a naive gate would pass a run that observed nothing.

- **The observation hook exited 1 on `null`, `[]` and `"str"` payloads — a non-zero PreToolUse exit is a silent allow.** It borrowed `parsePayload`, whose `requireObject` calls `process.exit(1)` by design because it is built for gates that deny. Caught by `tests/pretooluse-crash-closure.test.mjs`, which RUNS each wired hook against hostile input — stronger than the hook's own suite, which had only tried unparseable bytes and never valid-JSON-of-the-wrong-type. Now parses locally; hostile-payload coverage widened in both suites.

- **`tests/pretooluse-crash-closure.test.mjs` gains its first exemption, and it is asserted rather than asserted-by-comment.** The rule is that a throw must not become a SILENT allow — silence is the defect, not the allow. An observer is not a gate: denying an authorised dispatch because our own git capture threw is the wrong response, and its silence is caught one step later by the absence gate. The exemption therefore verifies that the gate exists, references the hook, and refuses on missing records, and it collapses if any of that stops being true. It would have been unsafe before this release.

### Changed
- Public capability `beat-implement-runner` stays at contract 3; no consumer-visible API change in this release.

## [5.106.0] - 2026-08-02

### Changed
- **`workflows/beat-implement.js` is retired.** It could never execute — the Workflow runtime is pure control flow (no `import()`, no `import.meta`, no `process`, no `Buffer`) — so every workflow's IMPLEMENT step had been dead for months. It outlived its last caller because four suites pinned ~105 assertions of dispatch policy against it, and deleting the file would have deleted that coverage. Retirement was therefore a migration, along the one line that actually divides those assertions: what can be decided BEFORE any agent runs versus what can only be decided BETWEEN dispatches.
  - `scripts/beat/preflight.ts` (new) owns approval authentication, task-contract validation, writable-path canonicalisation, resume proof, candidate configuration, routing, prompt construction, and derivation of the adjudication expectation. Asserted by `tests/beat-implement-preflight.test.mjs` (101).
  - `hooks/work-implement-observation.ts` owns the git delta and the output contract, which no pre-step or post-step can supply. It had **no test at all** before this; asserted by `tests/work-implement-observation.test.mjs` (35).
  - Found while wiring the two halves together: the preflight wrote its expectation under the raw session id while the hook reads it under `sessionFlagKey`'s hashed derivative. Silent on both sides — the hook would have found nothing, recorded every dispatch as `no-expectation`, and adjudicated against no bounds at all. Both now call the same function. Mutation-probed: reintroducing the mismatch drops the hook suite to 14/35.
  - Also found: a literal NUL byte in the wave-fingerprint separator made `preflight.ts` classify as binary and fail the public privacy scanner.
  - `KNOWN_NONCOMPLIANT` in `tests/workflow-runtime-purity.test.mjs` is now empty and asserted empty.

- **Public capability `beat-implement-runner` moves to contract 3.** Inputs are unchanged; execution evidence now comes from hook records rather than runner results. Consumers reading per-task result records must read hook records instead.

### Added
- **Every workflow now reaches every beat — 18/18, up from 12/18.** `KNOWN_GAPS` in `tests/beat-adoption.test.py` is empty. Adoption is a safety property, not tidiness: `writing` and `workshop` had drifted off `beat-implement` entirely, hand-rolling write-capable dispatch, which is why neither had writable-path bounds on any task and no test failed.
  - `dispatchOwnership: "caller"` on the preflight is what made this possible. `writing` and `workshop` each run a workflow with its own Gate, assembly and verify phases, so routing them or emitting a script would be wrong — but that was the only thing blocking adoption. The tail differs; authentication, validation, canonicalisation and expectation derivation are identical, asserted directly against a beat-owned run of the same wave.
  - `^TASK (\S+):` could not match a task id containing a space, and `/writing` keys its tasks by section name (`Part I`). Not a mis-parse — no match at all, so the hook classified those dispatches as non-implement and left them entirely unadjudicated. Widened, with a regression case.
  - `workshop`'s assembler runs `tinymist compile`, which writes a PDF beside each `.typ`. An undeclared compile output adjudicates as a violation by an agent that did exactly what it was told, so the skill now says to declare what a step writes rather than what you think of as its deliverable.
- **`skills/writing-accept`** — `writing` was the only workflow with no `beat-review` path, ending in a hand-rolled terminal surface. An adapter in the shape of `ds-review`/`dev-verify`, deliberately NOT named `writing-review`, which is independent machine review and must not be mistaken for human acceptance.
- **`/dev` runs `beat-clarify` before reconnaissance.** The last gap was a decision, not work: the beat's Iron Law is *ask before you look* while `dev-clarify` runs after recon by design, so an adapter would have loaded the beat and violated its central constraint in the same step. Resolved as a sequence. `/dev` already had a pre-recon clarification — enforced by `clarify-before-recon-guard`, hand-rolled as prose, with no beat behind it. The guard enforced that it happened while nothing defined what it was. `beat-clarify`'s description already listed `dev-clarify` among its callers; that claim is now true.

## [5.105.2] - 2026-08-02

### Fixed
- **A symlinked `.planning` cost every session at `$HOME` its Bash.** `hasReceiptSurface` scored ANY non-directory `.planning` as `governed`, without looking behind it. `~/.planning -> dotfiles/.planning` is an ordinary committed dotfiles alias whose target held one inert `STATE.md` — no `.state`, no receipt, nothing ever approved — and it classified `{blocked, conversion-required, governed: true}`, so `implementer-identity-gate` took its blocked branch and denied Bash outright, including `git status` and test runs, in a directory that is not a planning project at all. Measured: `/home/eh` scored `governed: true` while `/home/eh/dotfiles` — THE SAME BYTES, reached without the link — scored `governed: false`. The alias was the only difference, and `fd -t d` does not match symlinks-to-directories, which is why the state looked absent rather than aliased while diagnosing it.
  - The question asked of a `.planning`-level alias is now "is approval evidence REACHABLE THROUGH it", not "is it a symlink". The decoy's defining property is that it presents approval evidence — that is what made round 12/13's decoy dangerous, not the `ln -s` — so an alias over a receipt surface or a `*_CLARIFIED.json` sentinel still scores `governed: true` and still blocks.
  - **The `.state` level is not relaxed.** Nothing legitimate aliases `.planning/.state`; that path exists only to hold the receipt, so a symlink or a regular file there is still evidence on its own, unconditionally, and is now checked first. A `.planning` that dangles or resolves to a non-directory likewise stays `governed: true` — that is round 12's measured all-16-cells-ALLOW shape.
  - The cost, disclosed rather than hidden: `.planning` aliased to a directory presenting neither a receipt surface nor a sentinel is now ungoverned. That is the same disposition the identical unaliased directory already got, and it buys nothing that `mv .planning aside && mkdir .planning` did not already buy at the same price.
  - Regression coverage added in `tests/approved-artifact-contract.test.ts` pins both halves — the permissive alias row and the three that guard the narrowing — because the obvious repair for either failure breaks the other. Verified to fail against the pre-fix library and pass after.

## [5.87.4] - 2026-07-27

### Fixed
- **Every documented `look-at` invocation in the repo was unrunnable — 82 call sites across 10 files.** v5.87.2 repaired both vision backends but left the callers on `uv run python3 look_at.py`, the exact form that release's own commit message identifies as broken: passing `python3` as the command makes uv provision the ambient environment, so the script's inline PEP 723 metadata is never read and `google-genai` is never installed. Every one of them died with `google-genai package not installed` — a message that reads like an unauthenticated backend and is actually the wrong launcher. All corrected to `uv run --script`, which is what `scripts/look_at.sh` already used, with a comment explaining why.
  - **Two of the ten are not documentation.** `hooks/image-read-guard.py` denies every `Read` of an image and hands the agent a replacement command to run; `workflows/workshop-verify.js` tells its visual-verify agents how to inspect diagrams. Both emitted a command that could not succeed, so the guard sent agents into a dead end and workshop-verify's visual leg had no working path — which is the likely origin of its `look_at.py not resolved → visual-verify skipped` degradation.
  - Remaining eight are docs and examples: `skills/look-at/references/use-cases.md` (50), `skills/using-skills/SKILL.md` (6), `skills/look-at/README.md` (5), the three `skills/look-at/examples/*.sh` (4 each), `skills/look-at/scripts/look_at.py`'s own docstring and error text (4), `skills/workshop/SKILL.md` (3).
  - **`uv run python3 X.py` and `uv run --script X.py` are not interchangeable**, and the failure is silent until the import. Only `--script` honours PEP 723. Verified after the change: the corrected form and `look_at.sh --backend api` both return correct output from a 46-page PDF; all four edited code files pass `ast.parse` / `node --check` / `bash -n`.

## [5.105.0] - 2026-08-01

### Fixed
- **`ds` orchestration banned every pipe and redirection while `dev` and `work` allowed them.** Measured, that denied `pixi run pytest 2>&1 | tail -20`, `rg foo | wc -l`, `git log --oneline | head -5` and `ls -la | head` under `ds` — in the workflow that most wants a paged test run. Nobody argued for the difference; it was the pre-existing shape, and the rounds that touched the file were closing holes rather than opening them. `ds` now takes the same `classifyBashMutation` path, which splits a command line and judges each simple command, so `x && cp a b` and `x | tee f` are still caught. Mutation is unchanged: `cp`, `rm -rf`, `> file`, `| tee`, `git checkout/restore/apply` and `$(...)` all still deny. Allow-side coverage moves 23 → 26, which is `dev`'s number. The one rule that is genuinely `ds`-specific — no inline analysis code in main chat — is untouched.
- **`npx-ownership-panel`'s preflight guarded a script the DAG never runs and missed the two it does.** It checked `split_s12.sas`, retired from the DAG in #83, while `run_s12_array.sh` and `split_s12_one.sas` — the array path that replaced it — went unchecked. A guard that exists to fail in seconds instead of 40 minutes of grid time was watching the wrong file. Two further prereqs that fail late were also never checked: `~/sas/MERGE_ASOF.sas`, which `merge_panel.sas` `%INCLUDE`s as the last node in the DAG, and `../src/wrds_pull.py`, which both Python legs import at module load and a `scp scripts/*` leaves behind.
- **`chmod +x` covered four wrappers of seven**, the same consolidation oversight. Not a break — `qsub` does not require the exec bit — but a half-covered list reads as a decision when it is an omission.

### Changed
- `references/pipeline.md` rewritten against the tree. It documented a retired architecture — a `workflows/npx-ownership-pipeline.js` orchestrator, a second entry point in `run_npx_pipeline.sh`, and a "Python alternatives" table offering runnable commands for four scripts deleted in #83/#85 — so it told a reader to run seven scripts that are not there. Also corrected: the legs table (four legs, wrong leg 2), a design-decision claim that "all data building is SAS" when legs 2 and 5 are Python, and a customization section pointing at the per-script `%let` values that `pipeline_config.sas` exists to centralize.

## [5.105.1] - 2026-08-02

### Fixed
- **`writing-review` could not run.** `hooks/writing-mechanical-gate.ts` gates it on `check-all.py` and denies the tool call on any hard-severity failure. Two constraints were failing, so the gate denied for every user of the plugin — and it stayed invisible because running `check-all.py .` from the repo root reports `0 failed`: the domain filter skips 63 constraints without an `ACTIVE_WORKFLOW.md`. It only fails when scoped to a writing project, which is exactly when the gate fires.
  - **`flowchart-authority` retired.** It required one of `this IS the spec`, `flowchart.*spec`, `authoritative.*flowchart`, or an ASCII box-drawing block in six writing phase skills. Added 2026-03-20 when `writing-setup` genuinely had `## Setup Flowchart (This IS the Spec)`; the v5.98.0 migration replaced flowchart-as-spec repo-wide with the native-Plan + Iron-Laws + JS-engine model, and `grep -rl "This IS the Spec" skills/` now returns nothing anywhere. The pattern matched no code left in the repo. Two divergent forks existed — `references/constraints/` in constraint-protocol form, `scripts/checks/` in the older standalone form — which is why `scripts/check-all.sh` was independently red from the repo root, with no domain filter involved. Both deleted, along with the index row and the doc that described them.
  - **`constraint-loading-protocol` repaired, not retired.** Its intent is live: prose skills must load the domain skill and `ai-anti-patterns`. Only its matcher was stale, demanding a literal `writing-legal/SKILL.md` path when the skills now select the domain dynamically from the plan's `style`. The matcher now requires a load verb bound to a domain or style referent *within the same clause*, so co-occurring words cannot satisfy it and the legacy hardcoded path still passes. Verified by deleting the loading line from each of the four skills in turn and confirming each fails.

  No skill file was edited. `writing-validate` was initially suspected of a genuine gap and is not: it carries the same instruction in a fourth spelling at line 24, and its step 4 assesses domain and AI-pattern compliance, so the constraint applies and the skill satisfies it.

## [Unreleased]

## [5.104.0] - 2026-08-01

### Fixed
- **The reviewer never delivered a verdict, because the gate was comparing against an identity that is never set.** `process.env.CLAUDE_SESSION_ID` is not populated by Claude Code in a hook process, so every actor comparison read `undefined` and the reviewer's finalization could not be attributed. Identity now derives from the PreToolUse payload (`session_id` plus `agent_id` for a dispatched subagent), which is the only place the harness actually supplies it.
- **Blocking gates dispatched asynchronously and returned before the verdict existed.** Dispatch on those paths is now synchronous, so the gate observes the result it is gating on rather than an empty one.
- **`.planning/.state/` is no longer part of a conversation-level actor's write surface at any lifecycle status.** It holds the receipt every other gate reads its authority from; granting `.planning` wholesale let an actor restricted BY the receipt rewrite the identities that restrict it. Scoping is computed from where the bytes land, so a `..` spelling cannot walk around it. Cost, deliberately taken: a malformed receipt is no longer repairable from the conversation that hit the denial and needs a dispatched agent; a stale one stays self-repairable, since its fault is in the plan file.
- **A restricted actor gets no Bash** under an APPROVED receipt and in the blocked-but-governed branch — not an allowlist with a gap: read-only commands, `git status`, and test runs are refused too. Command-text scoping was measured and does not hold; `bun .claude/probe.ts` contains no telltale substring.
- **`denyOnCrash` now covers every PreToolUse gate**, so a hook that throws fails closed instead of exiting 0.

### Known residues, stated rather than papered over
- The whole PENDING window is open to a conversation-level approver: `if (receipt.status !== "APPROVED") allow()` sits above every actor comparison, so plain project writes and Bash are permitted before review completes. The only closure found is a blanket Bash denial across planning, which is not imposed.
- Under a tampered or unreadable receipt, a dispatched subagent the surviving bytes do not name remains unrestricted — including on the receipt itself in the blocked branch. Denying every subagent would make "delegate it" unfollowable in the state that most needs it, and the same subagent's `rm -rf .planning` already classifies `none`, a total permit at one command.

## [5.103.1] - 2026-07-31

### Added
- Added the `workflows-capability-root` PATH broker so dependent plugins resolve the exact enabled workflows installation without cache scanning, latest-version selection, source-checkout fallbacks, or reconstructed install paths.

### Changed
- Documented strict broker discovery and fail-closed handling for missing, ambiguous, failing, or malformed dependency-root brokers.

## [5.103.0] - 2026-07-31

### Added
- Published schema-2 external native workflow policies, composable whole-plan review, and canonical TaskList reconciliation so dependent plugins can reuse the generated-plan receipt lifecycle without becoming built-ins.
- Added external generated-plan support to approval persistence, reviewer/gate hooks, lifecycle resume, and the shared implementation runner while retaining fixed external schema-1 compatibility.

### Changed
- Renamed the teaching reverse-integration cache identity from `course-materials/teaching` to `teaching/teaching`.
- Hardened descriptor parsing and review finalization against duplicate keys, stale bytes, symlink substitution, and directory races.

## [5.99.0] - 2026-07-30

### Added
- Added the corrective `/workflow-creator-improve` entry, independent workflow-creator plan reviewer, deterministic TypeScript approved-plan compiler, and structurally read-only pre-approval audit agent.

### Changed
- Migrated workflow-creator from bespoke Create/Audit/Improve numeric state to fresh and corrective shared-v1 entries, shared `beat-implement` execution, evidence-gated independent verification, semantic resume, and terminal human review.
- Retired `wc-generate`, the Python file-set enumerator, numeric workflow-creator step hooks, and automatic legacy `.planning/wc` resume behavior.

## [5.98.0] - 2026-07-30

### Added
- Migrated writing and workshop onto the shared clarify → native plan approval → independent plan review → domain execution/verification → human review lifecycle. Writing retains `/writing-revise`; workshop retains `/workshop-revise`; their review engines are internal verifiers.
- Added writing and workshop plan-review constraint domains, exact approved-plan provenance, phase-aware resume behavior, `.planning/HUMAN_REVIEW.md`, and artifact-aware human review routing (Typora, LibreOffice, Neovim plus rendered preview).
- Consolidated workshop Slide Spec parsing into the canonical TypeScript parser and CLI, removing the Python duplicate.

### Changed
- Writing automated findings now use `.planning/AUTOMATED_REVIEW.md`, separating machine diagnosis from human acceptance.

> Version `5.97.0` is reserved for the `/work` migration and the plan-checker changes below. All three
> plugin and marketplace version fields are kept aligned.

### Added
- **`workflows:work` — the canonical lightweight generic workflow.** Bounded cross-domain tasks now have a shared-beat adapter for clarify → native plan approval → budgeted `/goal` + work → independent verification → human review. It uses `.planning/WORK.md`, defaults to inline execution, escalates mechanically by task shape, resumes the same verifier after failures, and sends `REJECT:` back to clarification with a two-rejection cap.
- Added contract and routing tests for `/work`, including negative coverage that keeps trivial tasks direct, specialized task shapes in their domain workflows, and the DS approved-plan runner/hooks DS-only.

### Changed
- Updated `using-skills` routing and `beat-clarify` to make `/work` the bounded generic entry point and remove the external standalone-mini terminology. Legacy `.planning/MINI.md` artifacts are offered an explicit, provenance-preserving conversion; there is no `/mini` alias.
- Replaced the dev-specific plan-checker with `workflows:plan-checker`. Dev and DS adapters now dispatch the same domain-parameterized reviewer, which deterministically loads atomic common and domain review constraints before writing the existing guarded verdict.
- **13F EDGAR scrape (`skills/wrds/scripts/parse_13f/`) — 3.32× faster, output byte-identical.** Full 38-quarter run (248,500 filings, 45.31 GB, 86,444,026 holdings rows) measured end to end on the WRDS grid: **8m 23s → 2m 32s**.
  - **The wall-clock claim it replaces was wrong by 6×.** `npx-ownership-panel` reported this leg at **1m 23s**, extrapolated by dividing a 13.9 min serial estimate by "10 concurrent, the observed slot count". The per-slot measurement underneath was sound and reproduces here (284 filings/s at 4 slots → 273–291 measured), but the divisor conflates *ten slots* with *ten tasks*: `qconf -srqs` caps each user at **10 slots** in `all.q`, so 4-slot tasks run **two** at a time, not ten. A full run of the unmodified code took **8m 23s**. Two further limits found by submission: `-pe onenode` rejects `N > 8`, and `ssdwork.q` is JSV-blocked despite having 300 free slots.
  - **Parser: a hand-rolled information-table scanner** (`xml_fast.go`), after `runtime/pprof` attributed **63.4%** of CPU to `encoding/xml.(*Decoder).Token`. It reproduces the exact token sequence `encoding/xml` emits and **refuses** anything it cannot mirror — CDATA, DOCTYPE, multi-colon names, unknown entities, mismatched end tags, non-UTF-8 declarations — falling back to `encoding/xml` for those, so correctness never depends on the scanner being complete. Measured fallback rate 2.6–4.8%. Plus `gzip.BestSpeed`, which halves the only serial stage (`compress/flate` was 9.2% of CPU, exactly the Amdahl serial fraction) for +14.0% bytes on disk. Stdlib only; no new dependencies.
  - **Array: shard on bytes, one slot per task.** Per-slot throughput is *highest at one slot* (89.3 filings/s) and decays to 57.8 by eight, so under a fixed slot cap many small tasks beat few big ones. Equal-*count* shards were 2× imbalanced because archive path order is CIK order and CIK correlates with filer size; packing on measured file size cuts imbalance to 10.4%. `m_mem_free` 4G → 2G against a measured 454 MB peak RSS.
  - **Byte-identity proven, not asserted.** Canonical dump (`sort | sha256`) plus row counts, per-column sums and mode/status histograms, over **all 38 quarters**: identical digests, `671ef9d2…`. Independently confirmed by the shared `canonical_hash.py` via parquet, and by a `-verify-fast-xml` harness that parses every filing both ways and compares row structs field by field (12,622 filings, 0 mismatches). Baseline was frozen before any code was written.
  - `scan_quarter.sh` / `submit_array.sh` are replaced by `scan_shard.sh` / `submit_shards.sh` (plus `make_filelists.sas`, `scan_sizes.py`, `build_shards.py`). The old pair also defaulted to `/scratch/nyu/eddyhu`, which has a 22 GB cap.

### Fixed
- **13F filings declared `windows-1252` parsed to ZERO holdings rows — 7,023 filings and 2,628,463 rows recovered.** `encoding/xml` refuses a non-UTF-8 declaration when `CharsetReader` is nil; `parseInfoTable` swallowed the error and returned no rows while the filing still recorded `parse_status=ok`, `parse_mode=xml`, `n_rows=0`. This is the failure mode nothing downstream can see: a filing that parses to zero rows looks exactly like an institution that did not file.
  - **Blast radius, measured** by re-parsing the exact 7,678 filings that produced zero rows under the shipped parser: **7,023 recovered** (2.83% of the corpus), **+2,628,463 holdings rows** (+3.04% on 86,444,026), **768 distinct institutions**, all 38 quarters. The remaining 655 are genuinely empty tables; no filing hit a charset we cannot decode. Reported in filings and rows because the `value` column is not unit-consistent across the panel — see below.
  - **Whether it reaches a given panel is conditional on two things**, and the conditions must both point at you: (a) an **institutional-aggregate denominator** means the drop removes non-index holdings from the denominator and *inflates* index/passive shares, whereas a **shares-outstanding denominator** (`x / tso`) leaves the denominator untouched — it *understates* `ior` and leaves S12-derived `mf_pct`/`passive_pct`/`index_pct` unaffected; (b) institutional holdings sourced from **this EDGAR parse** are affected, holdings sourced from **Thomson `s34`** are **not affected at all**.
  - **The bias is time-varying**, which is the finding worth propagating. Dropped rows go from **1.60%** of holdings (2016Q4–2023Q2) to **5.54%** (2023Q3–2026Q1), a **3.47× step up**; distinct affected filers 157 → 519. The break is a filing-agent effect (agents `0001140361`, `0000905148`, `0000945621` show `pre=0, post=N`), not a filer one. For an institutional-denominator pipeline that manufactures a **rise in passive share from 2023Q3** — a trend in the outcome variable created by a parser bug.
  - **Index exposure, precisely.** None of the nine largest index managers (BlackRock, Vanguard, State Street, Geode, Northern Trust, Fidelity, Dimensional, Invesco, Schwab) was ever affected, but smaller index/ETF sponsors were (Global X Japan, Mirae Asset Global ETFs, Pacer Advisors, Tortoise Index Solutions, DoubleLine ETF Adviser). Several large **active** managers are missing in 36–38 of 38 quarters (Barrow Hanley, Fiduciary Management, Gardner Russo & Quinn, Congress Asset Management, Cooke & Bieler); others are intermittent (RBC 11 quarters, CalPERS 8, Two Sigma 5), which is worse for change-based measures because the institution appears to exit and re-enter.
  - `charset.go` transcodes windows-1252/ISO-8859-1 to UTF-8 (single-byte tables, no dependency) for both the information table and `primary_doc.xml` — the latter matters because a rejected primary doc silently loses `isAmendment`/`amendmentType`/`reportType`. An undecodable charset now returns `parse_status=error` instead of an empty table, so the silent case cannot recur. `-decode-charset=false` reproduces the old output, which is how the delta was measured.
  - **Baseline re-frozen after the fix**, as it must be: `671ef9d2…` (86,444,026 rows) → `d5cfd2ad…` (89,072,489 rows), manifest rows unchanged at 248,500.

### Documented, not fixed
- **The `value` column changes units at 2023Q1.** Mean value per holding goes 152,644 (2022Q4) → 12,794,119 (2023Q1) and stays there; median 442×, p90 494×. Consistent with Form 13F moving from thousands of dollars to whole dollars. **Not a clean 1000×** — p10 moves only 38×, so the post-2023 population is mixed and no single scale factor repairs it. Any sum or average of `value` spanning 2023Q1 is meaningless. This is a property of the source, not the parser, so it is documented rather than "corrected". It is also why the recovery above is quoted in filings and rows: an earlier draft quoted "+3.84% of reported value", which summed this column across the break over a recovered set concentrated after it, and has been **withdrawn** rather than patched.

### Method note
- **A canonical-hash identity test proves a refactor was faithful, not that the behaviour was right.** The optimisation above passed identity on all 38 quarters while both parsers were silently dropping 3% of holdings — the hashes matched *because* both were wrong in the same way. Recorded in `references/13f-scrape-performance.md` and the parse_13f README, because the same trap applies to every leg being converted.

## [5.78.0] - 2026-07-24

### Added
- **`bmll` skill — BMLL Data Lab** (`bmll2` / `bmll` Python APIs over BMLL's Level 3 market data), as a **private submodule** at `skills/bmll` pointing at [`edwinhu/bmll-skill`](https://github.com/edwinhu/bmll-skill). Covers Trades Plus, reference data, whole-market and per-listing access, order-book rebuilding, event-time market impact, retail flow, Data Feed analytics, compute/storage, per-venue datasets and the schema layer — 14 reference files, tested helper scripts, and a worked execution-quality example.
  - **Private deliberately.** The reference material is derived from BMLL's login-gated documentation — schema field descriptions, enum and MMT value tables, the classified-trade taxonomy, per-venue detail — and the submodule vendors the 23 tutorial notebooks and 445 extracted doc pages as the provenance record, since the source cannot be re-fetched without an authenticated session. That content is licensed to the account holder and is not ours to republish from a public marketplace. Field names, types, MIC codes and enum *values* are facts; the prose and notebook code are BMLL's expression.
  - **Consequence, intended:** installing this plugin without access to `edwinhu/bmll-skill` yields an empty `skills/bmll` and no `bmll` skill. The plugin installer does recurse submodules (verified against the existing `skills/marimo/marimo-pair` and `external/anthropic-skills`, both fully populated in the plugin cache), so it resolves normally for those with access.
  - `ds-tools` registers `/bmll` in the data-access table with the access requirement noted.
  - The two helper scripts exist because the logic is deterministic and fails silently when hand-rolled: markout sign normalisation (buy- and sell-initiated impact cancel to ~0 without it) and event-time impact. Both are covered by tests against synthetic frames built to the documented schema — **the live BMLL API is not exercised**, so API behaviour and entitlement handling remain unverified against reality.

## [5.77.1] - 2026-07-23

### Fixed
- **Eleven false or imprecise claims in the 5.73-5.76 prose**, caught by two rounds of independent adversarial review and re-verified here by running the libraries rather than re-reading the docs. Nearly all of them sat in "Facts" and index descriptions — the sections written to be trusted without checking, which is exactly what makes a wrong one expensive.
  - `ds-tables`: "setting `signif_code` alone renders no stars, silently" was **backwards**. Bare `pf.etable([fit])` prints `1.873***` on pyfixest 0.60.0; the real trap is narrower and more surprising — passing your own `coef_fmt` without a `*` token silently *removes* the stars the default gave you. The Fact, the Red Flag, and `pyfixest-tables.md`'s "Default: `b \n (se)`" (the signature default is `None`) are corrected. Also: singleton-FE dropping changes the **observation** count, not the coefficient count.
  - `fuzzy-name-matching`: "`top_n=1` returns an arbitrary hit unless you pass `sort=True`" is **false**. The docstring says `sort` only orders hits within a row, and top-k selection always keeps the largest values — 60/60 rows matched a dense argmax with `sort=False` on 1.2.0. Corrected in both the Fact and gotcha 5; the sample code keeps `sort=True`, which remains harmless.
  - The `sparse_dot_topn` packaging note said "not on conda-forge". conda-forge **does** carry it, up to 0.3.1 — which predates the v1 `sp_matmul_topn` API, so `pixi add` silently installs a build without the function. The note now says that, which is both true and a better warning than the original.
  - The global-pass Red Flag cited a 0.85 floor while the threshold guide it points at (and the skill's own pipeline diagram) set ≥0.90 for unscoped matches.
  - `file-search.md` was described as covering "chunking config" and `structured-output.md` as covering "propertyOrdering". Neither word appears in either file; replaced with what they actually document (metadata filtering, enums).
  - `lpc_dealscan_eda` covers 1990-**2020** — every query is capped at 2020-12-31 — not 1990-2025. `gsd-learnings.md` is 11 patterns plus a §12 assessment, not 12 patterns.
  - Duplicate right-side names were said to make `top_n=1` "return whichever COO entry landed first". There is no such rule — and `sort` does not break an exact tie. Testing on 1.2.0 kept the *last* duplicate in every layout under both `sort` settings; the text now says the choice is undefined and records that observation as an observation. The operative advice (dedupe the right side) is unchanged.

## [5.76.0] - 2026-07-22

### Changed
- **Skill asset indexes completed.** Twelve files under `skills/*/{references,examples,scripts}` existed but were named nowhere — reachable only by listing the directory, which nothing instructs an agent to do. Progressive disclosure fails silently here: the SKILL.md index *is* the discovery mechanism.
  - **`wrds`** was the worst case: 7 references (`linkage`, `blockholders`, `execucomp`, `iss-directors`, `iss-voting`, `tfn-ownership`, `lpc-dealscan`, plus `muni-bonds` and `wrds-forms-tables`), **3 entire pipeline directories** (`blockholders_pipeline`, `form4_pipeline`, `proxy_advisors_pipeline`), 4 example notebooks/scripts, and the `scan_covers` / `parse_13f` / `scan_headers` / `sec_index_rga` tooling were all missing from the index — including `blockholders_pipeline/redo_bridge.py`, which another skill cites as its reference implementation. `voting_ownership_eda.py` is listed with an honest note that `voting_ownership_pipeline/` supersedes it for production work.
  - **`hpc`** gained an Additional Resources section: `sge-to-slurm.md` (the skill advertises "convert SGE to Slurm" in its own description) and both `array_job_*.sh` templates, framed as copy-these-first since they already use `--partition=standard`.
  - **`readwise`**: `reader-api.md`, plus `readwise_prune.py` marked as the direct-API implementation behind the sanctioned `readwise-custom prune` CLI.
  - **`law-review-docx`**: a Typographic Widows section documenting `check_widows.py` / `fix_widows.py`. `build_docx.py`'s `widowControl` only prevents page-level widows; a last line holding two stray words needs these. Notes that `fix_widows.py` edits source markdown, so `--dry-run` first.
  - **`docx-render`**: the one-time macOS `setup_garamond_render_override.py` step, without which x2t crams every upright Garamond run (the italic face poisons the metrics). Points at the investigation that measured it.

### Removed
- `skills/writing-legal/templates/law_review_template.docx.bak` — an 80KB snapshot of the template taken before an edit in 29e8d78. Git already holds every prior version of `law_review_template.docx`; recover with `git show 29e8d78:skills/writing-legal/templates/law_review_template.docx.bak` if ever needed.

## [5.75.0] - 2026-07-22

### Fixed
- **`load-constraints.py` matched skill names by bare substring**, so a constraint could load into a skill whose name merely *contained* it. `"ds"` is a substring of `"wrds"`: every `/ds` run silently loaded `wrds-sge-enforcement` (WRDS grid-submission rules, meaningless on a generic DS project) while `/wrds` — the intended audience — loaded nothing, because the wrds skill never calls the loader. Nothing errored; the wrong prose just arrived in the wrong prompt.
  - `skill_matches()` is now name-boundary aware and mirrors `check-all.py`'s `_applies`: `"all"`, exact match, or `entry.startswith(skill + "-")` so a workflow entry point still collects its phase constraints.
  - Measured before/after across all 21 loader-calling skills: **20 unchanged**, and `/ds` drops from 30 to 29 — the one spurious injection. Exact-match-only was rejected because it would have stripped 18 legitimate `ds-*` constraints from `/ds`.
  - `tests/load_constraints_applies_to_test.py` (14 assertions) covers exact/prefix/`all` matching, the `ds`↔`wrds` regression, and a sweep asserting no shipped constraint is unreachable. Verified failing (3/14) against the old matcher.

### Removed
- `references/constraints/wrds-sge-enforcement.md` and `references/constraints/hpc-slurm-enforcement.md` — both subsumed. Each duplicated, in weaker form, the Iron Law already inline in its skill (`wrds` SKILL.md login-node/qsub section; `hpc` SKILL.md "Login Node Enforcement" plus a fuller partition table). Neither could ever load: `applies-to: [wrds]` / `[hpc]`, and neither skill calls the loader. `wrds-sge`'s "existing examples" also pointed at out-of-repo `mirror/scripts/` paths. The one hard-won fact worth keeping — the `wrds_clean_filings` path convention — is already in `skills/wrds/SKILL.md` and `references/edgar.md`.

## [5.74.0] - 2026-07-22

### Added
- **`ds-tables` skill**: `pyfixest.etable()` regression tables + `great_tables` formatting, promoted from two orphaned root references. IRON LAW is render-before-claiming; the facts cover the etable trap that costs the most time (stars need `*` inside `coef_fmt` — `signif_code` alone renders none, silently) and the regex semantics of `keep`/`drop`.

### Changed
- **Orphaned root references, wired or retired.** Seven files under `references/` had zero inbound references repo-wide (and none from `~/projects` outside it) — nothing loaded them, so they never surfaced. Each was moved to where it can actually be found:
  - `gemini/{files-api,file-search,structured-output}.md` → `skills/gemini-batch/references/` and listed in its SKILL.md. The three only cross-referenced *each other*, so the whole cluster was unreachable. `cite-check`'s Passage Grounding section now points at `file-search.md` — its `grounding.ts` parses exactly that API's `groundingMetadata`.
  - `great-tables.md`, `pyfixest-tables.md` → `skills/ds-tables/references/` (see above). No DS skill mentioned `etable`, `great_tables`, or `gt` anywhere, so burying them in a phase skill would have kept them dark.
  - `ds-packages.md` → `skills/ds-plan/references/`, pointed to from the PLAN.md "Package versions" template line that it answers.
  - `skill-description-patterns.md` → stays at the plugin root (same convention as `enforcement-checklist.md` / `creator-anti-patterns.md`) and is now listed in `skill-creator`'s References section.
  - `gsd-learnings.md` → `docs/`, linked from PHILOSOPHY.md's enforcement-gradient section, which is where its patterns ended up.
  - `model-profiles.md` → `docs/`, with a **Status: design note, not implemented** banner. Nothing reads `model_profile` or `model_overrides`, and no `.planning/config.json` resolution step exists; agents pin models directly in frontmatter (13 × `inherit`, 7 × `sonnet`). Wiring it into a skill would have advertised a mechanism that doesn't exist.

## [5.73.0] - 2026-07-22

### Added
- **`fuzzy-name-matching` skill**: promotes the ING-banks entity-resolution recipe (char n-gram TF-IDF + `sparse_dot_topn` top-k cosine) out of the repo-root `references/` into a real skill. The two files had **no callers anywhere** — `rg -l 'fuzzy-name-matching|fuzzy_name_match_sample'` hit only themselves — so no skill loaded them and a session needing the recipe rebuilt it from memory. Packaging fix, not a content change.
  - `skills/fuzzy-name-matching/references/fuzzy-name-matching.md` — moved via `git mv` from `references/`; recipe preserved verbatim (threshold guide, normalize-first rule, scoped + global two-pass, gotchas, alternatives). Only edit: the worked-example pointer now resolves in-repo (`skills/wrds/examples/blockholders_pipeline/redo_bridge.py`) instead of the dangling `mirror/scripts/redo_bridge.py`.
  - `skills/fuzzy-name-matching/examples/fuzzy_name_match_sample.py` — moved via `git mv`; runnable template (`normalize`, `fuzzy_match`, `fuzzy_match_scoped` + toy demo).
  - `SKILL.md` — trigger-heavy description (entity resolution, record linkage, fuzzy match, TF-IDF, `sparse_dot_topn`, CIK/permno/gvkey/wficn/EIN bridging, deduping names). **IRON LAW: no fuzzy match without normalization first** — exact scoped join and its measured hit rate come before TF-IDF; fuzzy runs on the residual only. Facts + Red Flags cover the two failure modes that actually bite: fitting the vectorizer inside the per-key loop (IDF becomes corpus-dependent — the same pair scores 0.69 in a toy fit and 0.84 in a 600K-row fit) and reporting a hit rate without inspecting pairs at the threshold.

### Changed
- `skills/wrds/references/linkage.md`: the "identifiers that DON'T cross vendors" section now routes to `fuzzy-name-matching` — that paragraph is exactly where a WRDS linkage bottoms out in a name match.
- `skills/ds-tools/SKILL.md`, `README.md`: list the new skill so it's discoverable without already knowing it exists.


## [5.72.1] - 2026-07-21

### Changed
- **`paperpile`**: corrected the wedged-tab explanation in `scripts/refresh-auth-from-dia.sh`. The prior comment blamed the CDP hang on "a playing YouTube tab", which was an over-specific inference from one observation. Re-probing three hours later, the YouTube tab answered in milliseconds and an unrelated tab hung instead — it tracks renderer busyness, not the site. No code change; the browser-target fix was already right, and this makes it more clearly right (if the culprit were a known site you could special-case it; since any tab can wedge and the identity drifts, avoiding page targets entirely is the only sound answer).

## [5.72.0] - 2026-07-21

### Added
- **`law-econ-docx` skill**: builds a submission-ready Word manuscript for the Chicago-style law-and-economics journals (JLE, JLS, JLEO, ALER) and econ-flavored job market papers. These journals publish **no** official Word template; every one circulating online is third-party and inconsistent.
  - `skills/writing-legal/templates/law_econ_template.docx` — Latin Modern typography, double spaced throughout, JLE subhead ladder (`1.` bold / `1.1.` italic / `1.1.1.` roman) via Word list numbering, hanging-indent reference list, `Latin Modern Math` for OMML.
  - `scripts/make_le_template.py` — the template is **generated, not hand-edited**: starts from `pandoc --print-default-data-file reference.docx`, transplants the WordTeX typography, applies the JLE overrides, self-verifies. Every choice is auditable in one file.
  - `scripts/build_le_docx.py` — sibling of `law-review-docx`'s `build_docx.py` that **imports** its machinery (includes, widow control, booktabs tables, PDF render, acknowledgment injector) rather than duplicating it. Wires `--citeproc` + a vendored CMOS 18e author-date CSL, guarantees the reference list, retags back-matter headings so they escape section numbering, warns on citation-only footnotes and 150+-word abstracts.
  - `references/jle-house-style.md` — the editorial spec, compiled from the JLE author instructions and the Chicago EMS guide (both 403 automated fetches; read via web.archive.org).
  - `examples/sample/` — round-trip sample exercising headings, a table with a note, a figure, math, footnotes, and author-date cites.
  - `tests/test_law_econ_docx.py` — 27 tests incl. a regeneration check that fails if the committed .docx diverges from its generator.

### Changed
- `build_docx.style_tables()` takes an additive `width_factor` (default `1.0`, law-review behavior unchanged). Latin Modern Roman sets ~15% wider than the Times metrics the width model assumes; without the correction Word broke table header words mid-token.

## [4.81.0] - 2026-04-10

### Added
- **WRDS ISS Voting reference** (`skills/wrds/references/iss-voting.md`): vavoteresults and voteanalysis_npx tables, base-conditional turnout/forpct logic, CRSP CUSIP+ticker linking, director election agenda codes
- **WRDS TFN Ownership reference** (`skills/wrds/references/tfn-ownership.md`): 13-F S34 institutional ownership pipeline, S12 mutual fund holdings via MFLINKS, passive/index classification, as-of merge pattern
- **Voting + Ownership EDA notebook** (`skills/wrds/examples/voting_ownership_eda.py`): full Python/PostgreSQL translation of the SAS `1-make.sas` pipeline — ISS votes, CRSP linking, 13-F IO, S12 MF holdings, merge_asof, summary stats and plots

## [4.80.0] - 2026-04-10

### Added
- **WRDS ISS Directors reference** (`skills/wrds/references/iss-directors.md`): two-table schema (risk.directors + risk.rmdirectors), type harmonization, 1996 gender backfill, S&P 1500 filter
- **WRDS ExecuComp reference** (`skills/wrds/references/execucomp.md`): CEO anncomp, legacy codirfin vs current directorcomp, firm-year aggregation, combining both tables
- **WRDS Compustat additions**: business segments (compseg.seg_annfund), derived variables (tobins_q, roa, leverage, cusip6), SIC fallback, winsorization, 5 new gotchas
- **WRDS CRSP additions**: market index tables (msi/dsi), annual stock performance, 60-month rolling volatility, year-end market cap, 6 new gotchas
- **Marimo `--watch` flag**: added to all `marimo edit` commands in SKILL.md and marimo-pair finding-marimo.md

### Fixed
- New reference files consolidated in `skills/wrds/references/` instead of duplicating in top-level `references/`

## [4.48.0] - 2026-03-18

### Added
- **Two-track DS delegation**: ds-delegate routes tasks by type (`engineering` vs `analysis`)
  - `ds-engineer` agent: pipeline/ETL tasks with determinism, schema validation, join audits, idempotency enforcement
  - `ds-analyst` agent: analysis tasks with statistical validity, p-hacking prevention, robustness, SE specification
  - Keyword-based type detection heuristic when PLAN.md tasks lack explicit `type` field
- `constraints/ds-engineering-constraints.md` (E1-E5): determinism, schema contracts, join audits, idempotency, error handling
- `constraints/ds-analysis-constraints.md` (A1-A7): statistical validity, p-hacking prevention, robustness checks, sample selection, SE specification, visualization integrity, analysis-specific deviation rules
- Type-aware methodology reviewer in ds-delegate: engineering checklist (schema, determinism) vs analysis checklist (stats, specification)

## [4.47.0] - 2026-03-18

### Added
- **DS workflow audit fixes** (6.5 → 9.4 composite):
  - Requirement IDs (`CAT-NN` format) in SPEC.md template with scope classification (v1/v2/out-of-scope)
  - Checkpoint type annotations on all 11 DS phase gates (human-verify/decision)
  - `allowed-tools` restrictions on all reviewer/verifier agents (ds-spec-reviewer, ds-plan-reviewer, ds-review parallel reviewers, ds-verify, ds-delegate methodology reviewer)
  - Context monitoring in ds-implement and ds-fix (Warning ≤35%, Critical ≤25%, auto-handoff)
  - Structured task summaries with YAML frontmatter in ds-implement LEARNINGS.md
  - Smart-discuss batching in ds brainstorm (batch 3+ independent questions)
  - Requirement tracing in ds-review issue output and ds-verify success criteria
- Wired `test-gap-auditor` agent in dev-test-gaps (was using `general-purpose`)

## [4.46.0] - 2026-03-18

### Added
- **GSD patterns in workflow-creator**: checkpoint types (human-verify/decision/human-action), context monitoring (35%/25% thresholds), summary frontmatter (implements/requires/provides/affects), READ-ONLY verifier enforcement (allowed-tools), requirement traceability (CATEGORY-NN IDs), autonomous phase chaining (smart-discuss, blocker handling)
- **Dev workflow audit fixes** (8.1 → 9.5 composite):
  - Requirement IDs (`CAT-NN` format) in SPEC.md, PLAN.md `implements` column, VALIDATION.md mapping, review issue output, verification traceability
  - `allowed-tools` restrictions on all reviewer/verifier agents (dev-spec-reviewer, dev-plan-reviewer, dev-review parallel reviewers, dev-verify, dev-delegate spec/quality reviewers)
  - Checkpoint type annotations on all 8 phase gates + handoff
  - Context monitoring in dev-implement and dev-debug (Warning at ≤35%, Critical at ≤25%, auto-handoff)
  - Structured task summaries with YAML frontmatter in dev-implement LEARNINGS.md
  - Smart-discuss batching in dev-clarify (batch 3+ independent questions)
  - Test-gap auditor tool restrictions (write tests only, never implementation)
- **Fenced bang-backtick detection** in validate-skill-paths.py hook — catches `!`cat`` inside markdown fences (Claude Code parser ignores fences and executes them)
- Fixed fenced bang-backtick examples in skill-creator and workflow-creator

### Changed
- workflow-creator Mode 2 audit now scores 15 principles (was 9) — added checkpoint types, context monitoring, summary frontmatter, agent tool restrictions, requirement traceability, autonomous phase chaining
- workflow-creator Mode 3 fix patterns expanded with 7 new gap fixes
- workflow-creator Iron Laws: added NO VERIFIER WITH WRITE ACCESS, NO LONG WORKFLOW WITHOUT CONTEXT MONITORING

## [4.45.0] - 2026-03-18

### Added
- Plugin validation hook (`plugin-validate.py`): runs `claude plugin validate` after Write/Edit of plugin files (plugin.json, marketplace.json, SKILL.md, agent/command .md, hooks.json)
- Scoped PostToolUse hooks in `skill-creator` and `workflow-creator` frontmatter — validation runs automatically during plugin development skills only

## [4.44.0] - 2026-03-18

### Added
- Writing workflow: full GSD adoption — deviation rules (R1 factual, R2 evidence, R3 structural, R4 argument restructuring STOP), `.planning/` state folder, `writing-validate` phase (claim coverage), `writing-handoff` skill
- `writing-validate` skill: maps PRECIS claims to draft sections, 4-level validation (exists, substantive, supported, addresses claim), produces VALIDATION.md
- `writing-handoff` skill: structured session handoff with writing-specific frontmatter (section_in_progress, total_sections)
- Deviation rules constraint in `writing-common-constraints.md`
- Handoff detection in `/writing`, `/writing-review`, and `/writing-revise` entry points

### Changed
- All writing state files migrated from `.claude/` to `.planning/` (PRECIS.md, OUTLINE.md, REVIEW.md, REVIEW_STATE.md, ACTIVE_WORKFLOW.md, completed-workflows/)
- `writing-draft` now chains to `writing-validate` (not `/writing-review` directly)

## [4.43.0] - 2026-03-18

### Added
- DS workflow: full GSD adoption — deviation rules (R1-R3 auto, R4a data assumptions, R4b methodology STOP), `.planning/` state folder, `ds-validate` phase (DQ checks as test suite), `ds-handoff` skill for session pause/resume
- `ds-validate` skill: maps SPEC.md requirements to output artifacts, runs DQ1-DQ5 + M1 checks, produces VALIDATION.md
- `ds-handoff` skill: structured session handoff with YAML frontmatter and mandatory sections
- C8 (Deviation Rules) constraint in `ds-common-constraints.md`
- Handoff detection in both `/ds` and `/ds-fix` entry points

### Changed
- All DS state files migrated from `.claude/` to `.planning/` (SPEC.md, PLAN.md, LEARNINGS.md, REVIEW_STATE.md)
- `ds-implement` now chains to `ds-validate` (not `ds-review` directly)
- `ds-checks.md` check matrix updated with `ds-validate` column

## [4.42.0] - 2026-03-18

### Fixed
- `dev-common-constraints.md`: replaced relative `Read("real-test-enforcement.md")` with cache discovery pattern for path portability
- `dev-clarify`, `dev-design`, `dev-review`: removed process hints from skill descriptions (trigger-only per enforcement pattern #10)

## [4.41.0] - 2026-03-18

### Added
- `workflow-creator`: GSD deviation rules, state folder convention, and session handoff patterns

## [4.40.0] - 2026-03-18

### Added
- Dev workflow: GSD patterns — deviation rules (4-rule system), `.planning/` state folder, test gap validation phase, session handoff (`dev-handoff` skill), goal-backward verification (`dev-verifier` agent)
- `dev-test-gaps` skill and `test-gap-auditor` agent for requirement-to-test coverage mapping
- `dev-handoff` skill for structured session pause/resume

## [4.39.0] - 2026-03-17

### Added
- `companion` skill: launch and correctly frame companion (host Claude Code) sessions — pre-flight checklist, path mapping, prompt templates, rationalization prevention

## [4.3.0] - 2026-03-05

### Added
- `assistant` agent for personal productivity (email, calendar, tasks, notes, Google Workspace)
  - Wraps superhuman, morgen, obsidian CLI, and gws
  - Delegates to `nlm` skill for deep research via Skill tool

### Changed
- `librarian` agent: replaced inline NLM command table with `Skill(skill="workflows:nlm")` invocation
- `nlm` skill: extracted workflow recipes to `references/workflows.md`, added Readwise→NLM import docs

## [4.2.2] - 2026-02-15

### Added
- Generic ETL strategy assessment in ds-plan phase
- SAS ETL performance enforcement in WRDS skill and ds workflow

## [4.2.1] - 2026-02-13

### Added
- Google Scholar: BibTeX export, cite command, download command
- Anti-hallucination enforcement for Google Scholar results

## [4.2.0] - 2026-02-13

### Added
- Bluebook-audit workflow skill for law review footnote auditing (7 phases)
- PATH-based CLI names with dependency checks

## [4.1.0] - 2026-02-13

### Added
- Google Scholar skill integrated with librarian agent
- README documentation overhaul

## [4.0.0] - 2026-02-11

### Changed (BREAKING)
- Moved all entry skills from `skills/` to discoverable `skills/` root
- Renamed midpoint skills for consistency (e.g., `dev-edit` -> `dev-debug`)

## [3.0.1] - 2026-02-11

### Removed
- Redundant `/checkpoint` and `/verify` skills

## [3.0.0] - 2026-02-11

### Changed (BREAKING)
- Replaced slash commands with discoverable skills
- Removed `commands/` directory entirely
- Skills are now auto-discovered from `skills/` directory

## [2.46.1] - 2026-02-11

### Fixed
- session-start: substitute CLAUDE_PLUGIN_ROOT in using-skills content

## [2.46.0] - 2026-02-11

### Added
- Promoted visual-verify from internal to discoverable skill

## [2.45.1] - 2026-02-11

### Added
- `/visual-verify` command for standalone render-vision-fix loops

## [2.45.0] - 2026-02-10

### Changed
- Extracted tinymist plugin to standalone repo

## [2.44.1] - 2026-02-10

### Fixed
- session-start: load using-skills from correct lib/skills path

## [2.44.0] - 2026-02-10

### Changed
- Readwise: replaced opencode delegation with readwise-cli

## [2.43.0] - 2026-02-09

### Added
- Agent team parallelization across all workflows (dev, ds, writing)

## [2.42.1] - 2026-02-08

### Fixed
- continuous-learning: save skills as `name/SKILL.md` directories

## [2.42.0] - 2026-02-07

### Changed
- Writing-legal: overhauled law review template formatting
- Extracted formatting reference for legal writing

## [2.41.0] - 2026-02-06

### Added
- Writing-review: paragraph-level gates, quote verification, section mapping

## [2.40.0] - 2026-02-06

### Changed
- Updated plugin description

## [2.39.0] - 2026-02-06

### Added
- Writing-review skill for hierarchical document diagnosis
- Agent team parallel implementation in dev workflow

## [2.38.0] - 2026-02-06

### Changed
- All writing source searches routed through librarian agent
- DS workflow: audit and harden, add linted subagents (ds-analyst)

## [2.37.0] - 2026-02-06

### Added
- visual-verify skill for render-vision-fix loops (agentic mode)

## [2.36.1] - 2026-02-06

### Added
- PHILOSOPHY.md: midpoint constraint loading pattern
- Writing-edit: load full domain skill before edit checks

## [2.36.0] - 2026-02-06

### Added
- Two-entry-point architecture for all workflows (start fresh + midpoint re-entry)

## [2.35.x] - 2026-02-01 to 2026-02-06

### Added
- Readwise skill with server-side tag filtering
- Readwise CLI integration (replacing opencode delegation)
- look-at: agentic vision mode with code execution
- data-context skill for dataset knowledge extraction
- workflow-creator skill for designing LLM workflows
- nlm: research command, generation and content transformation commands
- Librarian: skill-based orchestrator with NLM-first hierarchy
- Writing-legal: user-facing skill with Volokh enforcement
- PreToolUse hook to block direct Readwise MCP calls in main chat

### Removed
- gog skill (superseded by superhuman-cli)

### Changed
- Writing workflow decomposed with writing-setup, writing-outline, writing-draft phases
- Librarian simplified to skill-based orchestrator

## Pre-2.35

Highlights from earlier development:
- **v2.34**: Streamlined writing workflow with `/writing` entry point
- **v2.33--2.30**: LSEG Data Library references, WRDS documentation
- **v1.x--v2.29**: Consolidated to single workflows plugin, delegation patterns, DS workflow hardening
- **v0.5.0**: Major skill audit with TOCs and progressive disclosure
- **v0.3.0**: Initial commit with dev and ds plugins
