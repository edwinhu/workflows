---
name: ds-data-pull-profile
description: Before finalizing PLAN.md for any analysis that pulls a large external data source (≥50M rows OR ≥500 MB estimated ship OR flagged "large"/"bulk"/"TB"/"millions" in SPEC), ds-plan MUST run a read-only profiling pass that quantifies raw ship-size vs server-side aggregate size per source, writes `docs/investigations/YYYY-MM-DD_pull_profile.md`, and records a decision table in PLAN.md under "## Data Pull Profile" — so the pull-raw vs aggregate-at-source vs pipeline-on-server choice is data-driven, not guessed.
applies-to: [ds-plan, ds-fix]
---

## Rule

When ds-plan has drafted a candidate PLAN.md (or is about to finalize one) and **any** data source meets **at least one** of these triggers:

- Estimated raw row count ≥ **50M** (any external source: WRDS, LSEG, SEC EDGAR, TAQ, Compustat, API extracts, large CSV/parquet on shared storage, etc.)
- Estimated raw ship size ≥ **500 MB** (compressed parquet or equivalent)
- SPEC.md or draft PLAN.md uses large-source language: "large", "bulk", "TB", "terabyte", "millions of rows", "hundreds of millions", "full universe", "entire history"
- Agent said "unsure" about size (agents systematically underestimate; treat "unsure" as a trigger)

...then ds-plan MUST dispatch a **read-only profiling subagent** to quantify raw vs aggregate size for each triggered source **BEFORE** finalizing the Task Breakdown and writing PLAN.md.

The profiling subagent MUST:

1. **COUNT with filter.** Run `SELECT COUNT(*) FROM <source> WHERE <planned_filter>` (or equivalent API `head()`/metadata call). No full table pull.
2. **Calibrate bytes/row.** Fetch a representative sample (~100K rows, stratified if possible) and write to a temp parquet file using the project's codec (zstd/snappy). Measure bytes-per-row from file size. Delete the sample after measurement.
3. **Aggregate candidates.** For each aggregation level the draft PLAN proposes (e.g., per-ticker, per-meeting, per-firm-year), run `SELECT ..., COUNT(*), SUM(<metric>) FROM <source> WHERE <filter> GROUP BY <agg_keys>` to get aggregate row count.
4. **Compute ratio.** Ship-size ratio = raw_rows / aggregate_rows. Flag any aggregation level that drops columns needed by downstream Task N (e.g., fundid/wficn for block classification) — a high ratio is NOT a win if the aggregate destroys information the pipeline needs.
5. **Write the profile.** Save to `docs/investigations/YYYY-MM-DD_pull_profile.md` with:
   - Machine-readable decision table (see schema below)
   - Bytes/row calibration notes (codec, sample size, stratification)
   - Per-aggregation information-preservation notes (what columns survive, what's lost)
   - Final recommendation per source: `pull-raw` / `SQL GROUP BY` / `server-side pipeline` (SAS-on-WRDS, BigQuery, etc.) / `hybrid` (e.g., aggregate historical years, pull raw for recent)
6. **Use only read tools.** The profiling subagent is read-only: `Read`, `Grep`, `Glob`, `Bash` (for SQL/metadata queries and parquet sizing). No `Write` to the pipeline itself; only to `docs/investigations/` and `scratch/`.

**Decision table schema** (must appear in both the investigation file and PLAN.md):

| Source | Raw rows | Raw MB | Aggregate level | Aggregate rows | Aggregate MB | Ratio | Recommendation |
|--------|---------:|-------:|-----------------|---------------:|-------------:|------:|----------------|

**Ratio rule of thumb** (from the feedback memory that motivated this constraint):

- Ratio < 10× → pull-raw is usually fine
- Ratio 10-100× → server-side aggregation wins on transfer time alone; prefer SQL GROUP BY
- Ratio > 100× → pull-raw is malpractice UNLESS downstream genuinely needs raw rows (documented per task)

**When pull-raw IS correct despite high ratio:** aggregate destroys columns downstream needs; downstream does multiple aggregation passes with different keys; the aggregation is too complex for SQL/server and Python+pandas is materially better. In all three cases, **justify per task in PLAN.md's Data Pull Profile section**.

**PLAN.md requirement:** if any source triggered the gate, PLAN.md MUST contain a `## Data Pull Profile` section with the decision table AND one-sentence per-source justification for the chosen strategy. The check script `ds-data-pull-profile.py` enforces this.

**NO PLAN.md FINALIZATION WITHOUT DATA PULL PROFILING WHEN TRIGGERED. This is not negotiable.**

## Rationale

**Mirror-voting v12 session, 2026-04-18.** Draft PLAN.md proposed pulling `risk.voteanalysis_npx` as ~150M rows of local parquet. User asked "NPX is large — consider server-side aggregation." A read-only profiling subagent found:

- NPX raw = 144M rows, ~650-750 MB parquet (with `sharesvoted`)
- Aggregate candidate (meetingid, itemonagendaid, fundvote) = 1.62M rows, ~40-60 MB
- Ratio = **89×**

At first glance, SQL GROUP BY looked obvious. But profiling also surfaced that the aggregate drops `fundid`/`wficn` — which Task 5 (CF pipeline block classification) requires. The correct answer was **pull-raw** after all — but only because profiling exposed the information-loss trade-off.

Meanwhile S12 (245M rows) and S34 (94M rows) had already been correctly routed to SAS-on-WRDS by prior planning. Row estimates in PLAN.md were off: s12 +18%, s34 -78% vs planning estimates. Profiling caught this.

**Why it exists:** agents systematically underestimate data size and overlook aggregate vs raw trade-offs. The dev's intuition ("NPX is big, push to server") was right; the agent's intuition (embedded in draft PLAN) was wrong. Only **profiling** catches it reliably.

Corresponds to user feedback memory `feedback_aggregate_server_side.md` (2026-04-18): "If ship-size / aggregate-size > 10×, server-side aggregation wins on transfer time alone. If > 100×, it's malpractice not to."

**Generalization:** not WRDS-specific. Any external source where raw rows might dwarf downstream needs — SEC EDGAR filings, TAQ microstructure, Compustat segments, LSEG tick history, large CSV on NFS, API extracts. The trigger is size, not vendor.

## Examples

### Correct — NPX trigger fires, profiling dispatched

```
1. SPEC.md: "quarterly institutional voting panel, 2005-2025"
2. Draft PLAN.md Task 1: "Pull risk.voteanalysis_npx to parquet"
3. Estimated row count: "approximately 150M rows"  ← TRIGGER (≥50M)
4. ds-plan Step 5c: dispatch profiling subagent
5. Subagent runs COUNT(*), samples 100K rows, runs GROUP BY candidates,
   writes docs/investigations/2026-04-18_pull_profile.md
6. Decision: pull-raw (high ratio but aggregate drops fundid — required by Task 5)
7. PLAN.md ## Data Pull Profile section records the decision table and
   justification per source.
```

### Incorrect — same task

```
1. SPEC.md: "quarterly institutional voting panel, 2005-2025"
2. Draft PLAN.md Task 1: "Pull risk.voteanalysis_npx to parquet (~150M rows)"
3. ds-plan proceeds to Step 6 Task Breakdown without profiling.
4. PLAN.md has no Data Pull Profile section.
5. User catches it in review: "NPX is huge — why aren't we aggregating?"
6. ds-plan re-planned from scratch. Days of downstream work invalidated.
```

### Correct — TAQ trigger

```
1. SPEC.md: "intraday liquidity measures for SP500, 2015-2024"
2. Draft PLAN.md: "Pull TAQ microstructure — approximately 2B trades"  ← TRIGGER (TB-scale keyword + ≥50M)
3. Profiling subagent: raw = 2.1B rows / ~800 GB; daily aggregate per ticker = 3M rows / 120 MB; ratio ~17,000×
4. Recommendation: server-side pipeline (push to SAS/BigQuery, ship daily aggregate)
5. PLAN.md Data Pull Profile records decision; Task 1 rewritten to dispatch server-side job.
```

### Correct — no trigger, no profiling required

```
1. SPEC.md: "Compustat fundamentals for 500 firms, 2020-2024"
2. Draft PLAN.md Task 1: "Pull Compustat Annual, ~10K rows"
3. No source ≥50M rows, no size keywords.
4. Step 5c no-op. Proceed to Task Breakdown.
5. PLAN.md does not need a Data Pull Profile section.
```

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "The row estimate is approximate — profiling just confirms what I already know" | Agents underestimate by 20-80% routinely. v12 s12 was +18%, s34 was -78% vs planning. The profile changes the plan, not just confirms it. | Run the profile. The 10-minute cost prevents days of rework. |
| "Server-side aggregation is obviously better for a 100× ratio" | Ratio alone doesn't decide. If the aggregate drops fundid/permno/any column Task N needs, pull-raw wins despite the ratio. NPX had a 89× ratio and pull-raw was correct. | Profile BOTH the ratio AND what columns survive aggregation. The information-preservation check is as important as the size check. |
| "I'll profile during ds-implement, not planning" | Implementers follow the plan. If the plan says pull-raw, they pull raw — even when profiling would have said aggregate. | Profile at planning time. The plan encodes the decision; fixing it later requires re-planning. |
| "The trigger is close but not quite 50M rows" | 50M is a floor, not a threshold. Agents underestimate. Round up: if the estimate is "30-50M rows" or "tens of millions," treat it as triggered. | Fire liberally. A 3-minute profile on a source that turned out to be 40M costs nothing; a missed profile on a source that turned out to be 150M costs days. |
| "I can do the COUNT(*) and GROUP BY myself in main chat without dispatching a subagent" | Main chat doing data work is the exact antipattern ds-plan's post-subagent-boundary hook prevents. Profile = real data access = subagent. | Dispatch a read-only profiling subagent. Main chat reads the investigation file afterward. |
| "Writing a docs/investigations/ file is overhead — the decision table is enough" | The investigation file documents the WHY (bytes/row calibration, information-loss notes, the specific counts queried). Without it, next session's agent can't tell why the decision was made and will re-litigate. | Write the investigation file. PLAN.md's decision table references it. Both are required. |

## Red Flags — STOP If You Catch Yourself

- About to finalize PLAN.md with a source ≥50M rows and no Data Pull Profile section → **STOP**. You're shipping a plan with a ungated pull-raw decision.
- Rationalizing that "the source is large but Task N really does need raw rows" without having actually profiled the aggregate and checked what columns are preserved → **STOP**. You're speculating. Run the profile.
- Writing SQL COUNT/GROUP BY queries in main chat instead of dispatching a subagent → **STOP**. Use a read-only profiling subagent. Main chat reads the result file.
- Treating "large" / "bulk" / "TB" keywords in SPEC as prose rather than a trigger → **STOP**. Those keywords are triggers. Fire the gate.
- Seeing a ratio > 100× and assuming aggregate-at-source is obviously correct without checking information preservation → **STOP**. Check what columns survive. NPX had 89× ratio and pull-raw was correct because of fundid.
- Skipping the profile because "the user didn't ask for it" → **STOP**. The user's review is the last line of defense. If the user has to catch this, the workflow failed.

## Cross-references

- **ds-external-skill-discovery** — Step 5b (external skill glob/examples/refs) runs BEFORE Step 5c (data pull profile). External skill examples may already contain profiling or server-side pipeline recipes. If `skills/wrds/examples/*/` has an SGE pipeline for the triggered source, the profile may recommend ADOPT that pipeline rather than pulling raw.
- **ds-common-constraints C5** — row count estimates feed requirement traceability. Profiling refines SPEC-era estimates.
- **skills/wrds/references/postgres-vs-sas.md** — when the profile recommends server-side aggregation, this reference picks between PostgreSQL GROUP BY and SAS-on-WRDS.
