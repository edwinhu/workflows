# Proxy Advisor Customers

Identifies which mutual fund families contracted with the three major U.S.
proxy advisors — Institutional Shareholder Services (ISS), Glass Lewis (GL),
and Egan-Jones (EJ) — by full-text-searching their 485BPOS / 485APOS
prospectus filings on SEC EDGAR. Port of
[chongshu/proxy-advisor-customers](https://github.com/chongshu/proxy-advisor-customers)
(JFE paper, 2007–2021 coverage) to our `scan_covers` Go framework with
SGE sharding, extended to 2022–present.

## Contents

- [Pipeline](#pipeline)
- [Grain & Keys (verified 2026-06-09)](#grain--keys-verified-2026-06-09)
- [Upstream sources](#upstream-sources)
- [Name variants](#name-variants)
- [Sample frame (N-PX, sample-only)](#sample-frame-n-px-sample-only)
- [Validation methodology](#validation-methodology)
- [Anti-patterns](#anti-patterns)

## Grain & Keys (verified 2026-06-09)

This is a **derived pipeline**, not a WRDS table — the grain is its own output, not a vendor key.

- **Output PK:** `(mgmt_cd, year, advisor)` — one row per fund family × year × proxy advisor (ISS / GL / EJ), each carrying a 0/1 contracted flag. The CIK-level intermediate is `(cik, year, advisor)`; aggregation to `mgmt_cd` is via CRSP MFDB (`crsp.fund_hdr`, CIK → `mgmt_cd`). Verify uniqueness on your own output after the aggregate stage; there is no upstream constraint to lean on.
- **Index-stage key (`wrdssec_all.forms`, 485BPOS/485APOS filter):** `fname` — VERIFIED: 0 dupes (SAMPLED 2020 485 slice; `fname` = `edgar/data/<cik>/<accession>.txt` is the per-filing unique id). `(cik, accession)` is NOT directly available — `accession` is not a column here; derive it from `fname` if needed. Note: `wrdssec_all.forms` has no `dcn`/`accession`/`seqnum` columns (unlike `wrdssec_all.wrds_forms`) — its columns are `gvkey, cik, fdate, findexdate, lindexdate, form, coname, fname, iname, source`.
- **Sample-frame key (`risk.voteanalysis_npx`, sample-definition only):** see [iss-voting.md](iss-voting.md) — used to define the CIK × year frame, never as an output grain.
- **Linking identifiers:** `cik` (filer), `mgmt_cd` (CRSP management company), `year`. To merge to fund characteristics, go `cik → crsp.fund_hdr.mgmt_cd → crsp.fund_summary`.

## Pipeline

| Stage | Where | What |
|-------|-------|------|
| Index | WRDS PostgreSQL | `wrdssec_all.forms` filtered to `form IN ('485BPOS','485APOS')` |
| Scan | WRDS SGE | `scan_covers -profile proxy_advisors` (FullBody mode) |
| Aggregate | Local | CIK × year → mgmt_cd × year via CRSP MFDB |
| Validate | Local | Per-advisor agreement vs chongshu CSV |

- Profile: `scripts/scan_covers/profiles_proxy_advisors.go`
- Extractors: `scripts/scan_covers/extractors_proxy_advisors.go`
- SGE driver: `scripts/scan_covers/sge/stage_proxy_advisors.py`
- Pipeline + validation: `examples/proxy_advisors_pipeline/`

## Upstream sources

| Source | Table / Path | Use |
|--------|--------------|-----|
| EDGAR 485 filings | `/wrds/sec/wrds_clean_filings/<cik6>/<cik>/<accession>.txt` | Body-text search for advisor name variants |
| EDGAR filings index | `wrdssec_all.forms` | Enumerate 485BPOS/485APOS by year |
| ISS Voting Analytics N-PX | `risk.voteanalysis_npx` | Sample-definition frame (CIK × year) — see `iss-voting.md` |
| CRSP Mutual Fund DB | `crsp.fund_hdr` | CIK → mgmt_cd join for fund-family aggregation |

`wrdssec_all.forms.fname` is shaped `edgar/data/<cik>/<accession>.txt`; map to
the clean-filings layout via `<source>/<cik6>/<cik>/<accession>.txt` using the
same helper as other pipelines — see `edgar.md`.

## Name variants

Ported from `chongshu/.../main.py:_parse_prospectus_file` (lowercased substring
matches). Case-insensitive matching via Go RE2 `(?i)`:

| Advisor | Patterns |
|---------|----------|
| ISS | `institutional shareholder service`, `\biss\b` |
| Glass Lewis | `glass lewis`, `glass, lewis`, `glass-lewis` |
| Egan-Jones | `egan jones`, `egan-jones` |

### Why `\biss\b` instead of literal ` iss `

The Python original uses ` iss ` with literal spaces. That fails on the
common HTML wrappings (`>ISS<`, `&nbsp;ISS&nbsp;`) and line-wrap breaks that
appear in EDGAR HTML-format 485 filings (especially 2015+). Word boundaries
catch the same plain-text positions the Python pattern catches and the
HTML/wrap positions it misses. If `validate.py` shows false positives above
threshold, the next step is to add a stricter "ISS appears within 100 bytes
of `proxy` or `advisor`" co-occurrence guard (see `extractors_proxy_advisors.go`).

## Why FullBody (not a HeadBytes cap)

Advisor mentions live in the Statement of Additional Information (SAI),
which sits at the **end** of the multi-document 485 wrapper. Measured
on 100 random 2020 hits:

| Percentile | First-hit byte offset | First-hit % of file |
|------------|----------------------:|--------------------:|
| p25 | 351 KB | 44% |
| p50 | 515 KB | **63%** |
| p75 | 1.04 MB | 83% |
| p90 | 1.45 MB | 89% |
| p99 | 4.57 MB | 94% |

A 256 KB head cap would miss ~75% of hits; the default 32 KB head would
miss essentially all of them. FullBody is mandatory. The cost (~70 ms
per file at concurrency 16, 2 SGE slots) is dominated by NFS read
bandwidth, and matches the timing of other scan_covers profiles.

### Negative result: back-first I/O optimization (2026-05-26)

We tried a two-stage strategy ("read back ~60% first, fall back to
front if no hits") in profile `proxy_advisors_fast`. On 2020 (7,756
filings, 1 SGE slot):

| | proxy_advisors | proxy_advisors_fast |
|---|---|---|
| Wall time | 9m3s | 12m1s (+33% slower) |
| Disagreements | — | 27 (0.35%), all FN |

NFS read-ahead is defeated by the seek pattern; no-hit files (majority
of the corpus) pay the seek cost without any bandwidth saving. And
~0.35% of filings disclose the advisor only in the prospectus body,
not the SAI. The `proxy_advisors_fast` profile is kept in-tree as
documentation of this negative result. Use `proxy_advisors`.

## Sample frame (N-PX, sample-only)

The paper does not parse N-PX bodies. ISS Voting Analytics N-PX is used
purely as a sample-definition frame: only CIK × year pairs that filed an N-PX
in that year are kept. This restricts the universe to funds large enough to
have actual proxy-voting activity.

Implementation: pulled from `risk.voteanalysis_npx` (see `iss-voting.md`),
inner-joined to the (cik, year) panel before the CRSP mgmt_cd lift.

**Do not** extend this pipeline to parse N-PX bodies. That is a separate
concern (vote-level data) belonging in its own profile, not here.

## Validation methodology

Target: ≥98% (mgmt_cd, year, advisor) exact match vs chongshu's published
`link_fundmgmt_proxyadvisor.csv` for **2007–2021** (paper coverage window).

### Measured parity (first run, 2026-05-26)

Without N-PX sample filter (see note below), 3,344 overlapping
(mgmt_cd, year) tuples agree at:

| Advisor | Agreement | FP (we say 1, they say 0) | FN (we say 0, they say 1) |
|---------|-----------|---------------------------|---------------------------|
| ISS | 91% | 288 | **16** |
| GL  | 93% | 215 | **19** |
| EJ  | 96% | 126 | **5** |

Recall (1 − FN/(FN+TP)) is 99%+ for all three advisors — we are not
missing hits the paper found. The 91-96% gap is FP-driven: we over-flag
relative to the paper.

The two known sources of the FP gap, in priority order:

1. **`\biss\b` vs ` iss `** — our word-boundary pattern catches HTML-wrapped
   and punctuation-adjacent ISS mentions (`>ISS<`, `(ISS)`, `, ISS,`) that
   the paper's literal-space pattern misses. Many of these are legitimate
   mentions; some are false positives in tickers and abbreviations.
2. **CRSP `mgmt_cd` snapshot drift** — our CRSP snapshot (2026) differs
   from the paper's (2022). 615 mgmt_cds appear only in their output;
   34,555 mgmt_cds appear only in ours. Snapshot-aligned validation
   requires their `cik`-level intermediate file, which is not in the repo.

### N-PX sample frame is currently unavailable

The chongshu pipeline filters CIK × year by an `all_npx.csv` file (the
ISS Voting Analytics N-PX filing index) that is referenced by `main.py`
but is **not committed** to their repo. The current WRDS
`risk.voteanalysis_npx` table only covers 2023–present; `iss_va_mf_old`
is permission-restricted. Until the historical NPX index is recovered,
omit `--apply-npx-frame`. Our CRSP-coverage frame is a reasonable
substitute (~99% recall on the overlapping rows).

Run `examples/proxy_advisors_pipeline/validate.py` after aggregation. It
prints per-advisor agreement, FP/FN, confusion matrix, and per-year
breakdown. Below 98% → investigate before claiming completion:

1. **Pattern divergence** — diff disagreements, check whether the
   `\biss\b` extension over ` iss ` is introducing false positives in
   contexts like "issuer", "issue" (the `\b` should block these, but
   verify on actual filings).
2. **HTML-tag interference** — chongshu's Python reads raw .txt; we do too.
   If the disagreements cluster in 2018+ filings (HTML-heavy era), the
   answer may be HTML stripping or tag-aware matching.
3. **CRSP snapshot drift** — `mgmt_cd` mappings rotate over time. Our
   `crsp.fund_hdr` snapshot may differ from the snapshot used by the paper
   in 2022. Per-year breakdown will reveal cluster patterns.

Once 2007–2021 parity is established, extend coverage forward (the published
data stops at 2021). Spot-check 20 random 2022+ mgmt_cd × year hits manually
against EDGAR before publishing.

## Anti-patterns

- **Never run the parser on the WRDS login node.** Always `qsub`. See the
  iron law in `SKILL.md`. `stage_proxy_advisors.py` does this correctly.
- **Never build a standalone Go binary.** The `proxy_advisors` profile is
  ~60 lines; a parallel binary would duplicate 500+ lines of SGE plumbing.
  See the `scan_covers` iron law.
- **Never parse N-PX bodies in this pipeline.** N-PX is sample-frame only.
  Vote-level extraction is a separate concern.
- **Never claim completion without running `validate.py`** against the
  published CSV. The 98% gate exists because subtle pattern differences
  produce visible-but-acceptable noise — confirm yours is in that band.
