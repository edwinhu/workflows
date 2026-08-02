# Changelog

All notable changes to this project are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/).

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
- `references/ds-engineering-constraints.md` (E1-E5): determinism, schema contracts, join audits, idempotency, error handling
- `references/ds-analysis-constraints.md` (A1-A7): statistical validity, p-hacking prevention, robustness checks, sample selection, SE specification, visualization integrity, analysis-specific deviation rules
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
