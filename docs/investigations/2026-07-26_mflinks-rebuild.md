# Rebuilding MFLINKS: an SEC series-ID bridge from Thomson S12 to CRSP

**Date:** 2026-07-26
**Question:** Can SEC series/class IDs plus the S12 clean-names file produce a
higher-coverage, higher-precision bridge from `tfn.s12` `fundno` to CRSP fund
identifiers than MFLINKS + fuzzy name matching?
**Answer:** **Yes, partially — and the win is larger than expected in the
high-precision regime.** Routing the name match through the SEC's published
series universe instead of directly against `portnomap.fund_name` resolves
**4.5× more of the ambiguous set at equal precision**. It does *not* produce an
exact key: SEC series IDs cannot be attached to S12 funds by any deterministic
join, so the bridge remains fuzzy at its first hop. It is a materially better
fuzzy bridge, not a replacement for MFLINKS.

---

## 1. What was already established (re-verified, not re-derived)

The calibration universe is `tfn.s12type1` at `rdate = '2022-12-31'`,
deduplicated to one row per `fundno` (latest `fdate`). Reproduced exactly:

| Group | Funds | MFLINKS-bridged | Rate |
|---|---:|---:|---:|
| non-US (`country <> 'UNITED STATES'`) | 48,316 | 145 | **0.30%** |
| US | 11,820 | 7,180 | **60.7%** |
| **US unbridged = the ambiguous set** | **4,640** | — | — |

Total 60,136 funds; ambiguous mass **7.72%**. These match the prior
measurements in `skills/wrds/references/tfn-ownership.md` to within rounding
(that note reports 4,649 ambiguous; the 9-fund difference is a dedup tie-break).

Three roles, used throughout:

- **Positive set** — 7,180 US bridged funds. MFLINKS gives a known
  `crsp_portno` set per fund, so top-1 accuracy is directly measurable.
- **Negative control** — 48,171 non-US unbridged funds. They bridge at 0.3%, so
  essentially none has a true CRSP counterpart; any match above threshold is a
  false positive. This is what makes the precision estimate honest.
- **Target** — 4,640 ambiguous US funds.

---

## 2. Is an SEC series/class bridge feasible?

### 2.1 The CRSP side is solid

`crsp_q_mutualfunds.crsp_cik_map` covers 68,382 `crsp_fundno`, of which
**59,244 (86.6%) carry a `series_cik`** (`S000######`), spanning 23,649
distinct series. Of the 14,939 SEC series active in the 2022 series/class file,
**13,095 (87.7%) appear in `crsp_cik_map`**. The series → `crsp_fundno` →
`crsp_portno` hop is high-coverage and exact.

### 2.2 The SEC side is solid

SEC publishes *Investment Company Series and Class Information* as annual CSVs
(`https://www.sec.gov/files/investment/data/other/investment-company-series-and-class-information/...`).
The 2022 file has 41,721 class-level rows → **14,939 distinct series** with
`CIK Number, Entity Name, Series ID, Series Name, Class ID, Class Ticker`.
Fetched with the declaring User-Agent per the `sec-fetch` skill (a spoofed
browser UA 403s). Header layout drifts across vintages — the 2017 file has a
one-line banner above the header and snake_case column names; the 2010 file
uses the modern Title Case header with no banner. Any production loader must
sniff the header.

### 2.3 The S12 side is the binding constraint — there is no exact key

**Confirmed: Thomson S12 has no path to a series ID that is not a name match.**

- No CIK anywhere in `tr_mutualfunds` (re-verified; consistent with the prior
  finding).
- `s12type8.fticker` ends 2018-12-31 and is ~redundant with MFLINKS where it
  exists — already established, not revisited.
- SEC class tickers could join to `portnomap.ticker`, but that hop needs a
  ticker on the S12 side, which does not exist post-2018.

So the chain is necessarily **S12 name →(fuzzy)→ SEC series name →(exact)→
`series_cik` →(exact)→ `crsp_fundno` →(exact)→ `crsp_portno`**. The exact hops
add no precision *by themselves*; the gain, which is real, comes from **what
the name match is run against**.

---

## 3. Why matching against SEC series names beats matching against CRSP names

Three structural reasons, all confirmed in the data:

1. **Grain alignment.** An S12 `fundno` is a *portfolio*. An SEC series is a
   *portfolio*. A `portnomap` row is a *share class*. Matching portfolio→
   portfolio against 14,939 candidates is a cleaner discrimination problem than
   portfolio→share-class against 55,250 candidates, most of which are near-
   duplicate class variants of one another ("… Class A", "… Institutional").
2. **Candidate-set size.** 13,975 distinct normalized SEC series names vs
   24,858 distinct normalized `portnomap` names. Fewer near-collisions.
3. **Closed universe with a negative signal.** An S12 fund that matches an SEC
   series *whose series ID has no `crsp_cik_map` entry* is positive evidence
   the fund is **not** in CRSP — information the direct-to-CRSP match cannot
   produce at all. (Small in practice; see §5.)

### Name inputs

Both S12 name sources are used, as **aliases** (max score over aliases, 4.1
aliases per fund):

- `S12_Names_20250630.xlsx` (`Export Worksheet`, 238,526 rows), date-filtered
  to the quarter. Covers **95.1%** of the ambiguous funds — exactly as
  previously measured.
- `mfl.mflink2.fundname_full` (present even where `wficn` is NULL).
- `s12type1.fundname` (24-char truncated, but *current*).

> **Date-parsing trap.** `END_DATE = '01-JAN-30'` is a 2030 "still active"
> sentinel on 165,425 rows and `START_DATE = '01-JAN-70'` is 1970. Python's
> `%y` pivot (00–68 → 2000s, 69–99 → 1900s) handles both correctly. "Correcting"
> future-looking dates by subtracting a century silently drops ~99.9% of the
> file — that mistake was made and caught here.

> **The two name sources are complementary, not redundant.** The xlsx name is
> long but often *stale* (`POWERSHARES S&P SMALLCAP MATERIALS` for what S12
> currently calls `INVESCO SP SMALLCAP MATE`; `SPDR BARCLAYS CAPITAL ISSUER
> SCORED CORPORATE BOND ETF` for `SPDR PORTFOLIO CORPORATE`). Taking the latest
> `START_DATE` record does not fix this — the xlsx is a name *history* whose
> most recent entry can predate a rebrand. Use both as aliases.

### Normalization

Uppercase → strip punctuation → expand ~25 Thomson abbreviations
(`INTL→INTERNATIONAL`, `GOVT→GOVERNMENT`, `EQ→EQUITY`, …) → **pop trailing
share-class tokens** (`CLASS`, `INSTITUTIONAL`, `R6`, `ADMIRAL`, bare letters)
→ drop legal-form stopwords (`FUND`, `TRUST`, `INC`, `THE`, …). `INC` is
expanded to `INCOME` only when not the final token, so `Appreciation Fund,
Inc.` does not become `APPRECIATION INCOME`. Matching is char_wb 2–4-gram
TF-IDF cosine, top-1, via `sparse_dot_topn`.

---

## 4. Results — measured against the negative control

`FPR` = share of the 48,171 non-US unbridged funds matched above threshold
(false positives by construction). `pos_acc` = top-1 accuracy on the 7,180
bridged US funds against MFLINKS ground truth. `implied_prec = 1 − FPR /
amb_rate` (the convention used in the prior calibration). `combined_prec =
pos_acc × implied_prec` — a stricter estimate that charges the rule both for
matching things that have no counterpart *and* for picking the wrong
counterpart when one exists.

### 2022-12-31

| Rule | FPR | pos_acc | amb resolved | amb rate | implied prec | **combined prec** | residual amb mass |
|---|---:|---:|---:|---:|---:|---:|---:|
| A: → `portnomap.fund_name` thr=0.90 | 0.72% | 0.889 | 731 | 15.8% | 0.954 | 0.848 | 6.50% |
| A: → `portnomap.fund_name` thr=0.95 | 0.13% | 0.931 | 275 | 5.9% | 0.978 | 0.910 | 7.26% |
| **B: → SEC series thr=0.85** | 2.19% | 0.889 | 1,866 | 40.2% | 0.945 | 0.840 | 4.61% |
| **B: → SEC series thr=0.90** | 1.22% | 0.923 | 1,509 | 32.5% | 0.962 | 0.889 | 5.21% |
| **B: → SEC series thr=0.95** | **0.63%** | **0.969** | **1,228** | **26.5%** | **0.976** | **0.946** | **5.70%** |
| B≥.95 ∪ (B≥.70 ∧ holdings agree) | 1.28% | 0.965 | 1,503 | 32.4% | 0.960 | 0.927 | 5.22% |
| B≥.95 ∪ A≥.95 ∪ (B≥.70 ∧ holdings agree) | 1.35% | 0.965 | 1,606 | 34.6% | 0.961 | 0.928 | 5.05% |

**Read the table at matched precision, not matched threshold.** At
`combined_prec ≈ 0.91–0.95`:

- Route A (direct to CRSP) resolves **5.9%** of the ambiguous set.
- Route B (via SEC series) resolves **26.5%**.

**4.5× the coverage at equal or better precision.** At matched *implied*
precision (~0.976), the same comparison is 5.9% vs 26.5%.

Against the prior baseline of **32.5% resolved at ~96% implied precision**:
B at thr=0.90 lands on exactly that point (32.5% at 96.2% implied) but with
higher measured top-1 accuracy (0.923 vs the baseline's unmeasured accuracy),
and B at thr=0.95 trades 6pp of coverage for a materially safer 97.6% implied /
94.6% combined. **The SEC route matches the baseline at the baseline's
operating point and strictly dominates it everywhere tighter.**

### Replication at other dates

| Date | non-US / US-bridged / ambiguous | A thr=0.95 | B thr=0.95 |
|---|---|---|---|
| 2022-12-31 | 48,316 / 7,180 / 4,640 | 5.9% @ 0.910 | **26.5% @ 0.946** |
| 2017-12-31 | 26,787 / 7,124 / 3,371 | 6.3% @ 0.893 | **25.7% @ 0.920** |
| 2010-12-31 | 3,403 / 3,510 / 581 | 3.1% @ 0.624 | 9.6% @ 0.604 |

(coverage of the ambiguous set @ combined precision)

The 2022 and 2017 results are the same story with the same magnitudes — this is
not a 2022 artifact. **2010 is a different regime and the method adds little
there:** the ambiguous set is only 581 funds, the negative control is only 3,403
funds (so FPR is noisy), and MFLINKS was still working. The value of any rebuild
scales with the size of the MFLINKS gap, which is a post-2013 phenomenon.

---

## 5. Two things the SEC route unlocks that the direct route cannot

### 5.1 Positive CRSP-absence evidence

Classifying the 4,640 ambiguous funds by the thr=0.95 SEC rule:

| Class | n | % |
|---|---:|---:|
| resolved to a `crsp_portno` | 1,148 | 24.7% |
| matched an SEC series **absent from `crsp_cik_map`** → confirmed additive | 62 | 1.3% |
| matched an SEC series in `crsp_cik_map` but with no portno active at the date | 18 | 0.4% |
| unresolved | 3,412 | 73.5% |

The 62 "confirmed additive" funds (e.g. `FIDELITY DISRUPTORS FUND` →
`S000067936`, `JPMORGAN ACCESS GROWTH FUND` → `S000026373`) move out of
`s12_ambiguous` into `s12_additive` on *positive* evidence rather than by
default. Real, but small — 1.3%. Do not oversell this lever.

Net effect on the union's error term: ambiguous mass **7.72% → 5.70%** of all
S12 funds at thr=0.95 (3,430 funds still unresolved — the 3,412 unmatched plus
the 18 whose series has no portno active at the date), or **→ 5.05%** with the
union rule at combined precision 0.928.

### 5.2 It quantifies the double-count exposure MFLINKS was hiding

Of the 1,148 ambiguous funds resolved by B@0.95, **314 (27.4%) resolve to a
`crsp_portno` that is already claimed by a *different*, MFLINKS-bridged S12
`fundno`.** Those were live double-count risks in any naive S12 ∪ `crsp.holdings`
union: the same CRSP portfolio would have been counted once from CRSP and again
from an S12 fund that MFLINKS failed to link. This is direct evidence that
MFLINKS' degradation is not benign — it silently converts duplicates into
apparent additive coverage.

---

## 6. A negative result: holdings-content matching does not work as a primary bridge

An obvious alternative to names: match on *what the fund holds*. `crsp.holdings`
at `report_dt = '2022-12-31'` has 3.26M rows over 10,484 `crsp_portno`;
`tfn.s12` at the same `rdate` has 6.51M rows over 59,450 `fundno`. Both were
pulled, reduced to CUSIP-8 sets, IDF-weighted, L2-normalized, and matched by
top-1 cosine.

| Metric | thr | FPR | pos coverage | pos_acc | amb resolved |
|---|---:|---:|---:|---:|---:|
| cosine | 0.70 | 5.45% | 89.3% | **0.785** | 38.2% |
| cosine | 0.90 | 2.96% | 83.3% | **0.795** | 28.5% |
| containment | 0.90 | 6.84% | 93.2% | 0.767 | 50.4% |
| Jaccard | 0.80 | 3.63% | 86.6% | 0.794 | 32.3% |

**Portfolio content is not a unique fingerprint.** Coverage is excellent (93% of
bridged funds find *some* high-similarity CRSP portfolio) but top-1 accuracy
plateaus at ~79% and will not go higher at any threshold — index funds, feeder
funds, and same-manager clones hold near-identical portfolios, and the negative
control's 3–7% FPR confirms the signal is not discriminating. **Holdings
similarity cannot stand alone.**

It is, however, a useful **confirmer**. Requiring the SEC-series pick and the
holdings pick to agree raises measured top-1 accuracy to **0.985** — the highest
of any rule tested — but only resolves 10.5% of the ambiguous set, and its
*combined* precision (0.954 implied × 0.985) is not better than B@0.95 alone
because the agreement requirement suppresses recall faster than it suppresses
false positives. Use it as a tie-breaker in a middle band (see §7), not as a
gate.

---

## 7. What a production bridge looks like

**Do not replace MFLINKS. Layer on top of it.** MFLINKS remains the highest-
precision link where it exists; this is a fallback for the 4,640 funds where it
does not.

```
for each quarter Q:
  1. MFLINKS chain (mflink2 → mflink1 → portnomap)          → bucket `crsp`
  2. positive CRSP-exclusion (non-US country, closed-end,
     VA separate account, UCITS)                            → bucket `s12_additive`
  3. SEC-series bridge on the remainder:
       aliases  = xlsx FUNDNAME (date-filtered)
                ∪ mflink2.fundname_full
                ∪ s12type1.fundname
       normalize (abbrev expansion + class-tail strip + stopwords)
       char_wb 2-4gram TF-IDF cosine vs SEC series names for year(Q)
       cos ≥ 0.95                    → accept
       0.70 ≤ cos < 0.95 AND holdings-cosine top-1 agrees on the portno
                                     → accept
       matched series ∉ crsp_cik_map → bucket `s12_additive` (confirmed absent)
       else                          → bucket `s12_ambiguous`
  4. series_cik → crsp_cik_map → crsp_fundno → portnomap → crsp_portno
  5. dedup at the crsp_portno grain, never at fundno
```

Operating point: **cos ≥ 0.95** for the primary accept. It is the only rule
tested whose combined precision (0.946) is comparable to what MFLINKS itself
implies, and precision is the thing that matters here — a false accept
*deletes* a genuinely additive fund from the union, which is the failure mode
the whole exercise exists to avoid.

Engineering notes for whoever builds it:

- **Cache the SEC CSVs by year**; sniff the header (banner row / snake_case
  drift). One file per calendar year, joined to the quarter's calendar year.
- **`crsp_cik_map` has no date bounds.** Restrict the `crsp_fundno` →
  `crsp_portno` hop with `portnomap.begdt/enddt` at the quarter, as done here.
- **Never match against `s12type1.fundname` alone** (24-char truncation), and
  never against the xlsx alone (stale names). Aliases, max score.
- Runtime is trivial: the whole 2022 calibration (108,604 aliases × 13,975
  candidates plus the 59,450 × 10,484 holdings match) runs in well under a
  minute on a laptop. Nothing here needs the WRDS grid.
- **Recalibrate the negative control every time the rule changes.** The FPR is
  the only honest precision signal available, and it moved by a factor of three
  across the normalization variants tried here.

### Residual, and what would move it further

At the recommended operating point the ambiguous mass falls from **7.72% to
5.70%** of S12 funds (3,430 of 60,136 funds still unresolved). That is below
the 5% failure threshold of `detect_unresolved_overlap` only under the union
rule (5.05%), and not by much. **`detect_unresolved_overlap` should stay, and
its threshold should not be relaxed on the strength of this work.**

The remaining 3,430 are the genuinely hard cases and no name-based method will
clear them — many are almost certainly not in CRSP at all, which is why they do
not match. The only lever with real headroom is a **content-based match against
N-PORT filings** (registrant CIK + series ID are in the filing header, so a
successful holdings match yields the series ID *directly* rather than through a
name). That is a substantially larger build, and §6 is a warning about its
likely ceiling: portfolio content alone tops out around 79% top-1. It would need
the series-name signal as a confirmer, i.e. the same two signals, combined in
the other order. **Not obviously worth it. Measure the marginal 3,412 funds'
asset weight before committing to it** — if they are small funds, the union's
error term is already smaller than the fund count suggests.

---

## 8. Reproduction

Prototype: `skills/wrds/scripts/mflinks_sec_bridge.py` (self-contained;
`--date`, `--sec-csv`, `--xlsx`). Inputs: WRDS PostgreSQL (`~/.pgpass`), the SEC
annual series/class CSV, and `S12_Names_20250630.xlsx`.

All figures in this report were measured on 2026-07-26 against WRDS
`wrds-pgdata.wharton.upenn.edu:9737`, the SEC 2010/2017/2022 series/class files,
and the 2025-06-30 vintage of the S12 names export.

**Related:** `skills/wrds/references/tfn-ownership.md` §"Coalescing S12 into
`crsp.holdings` at the holding level"; detectors `detect_unresolved_overlap`
and `detect_bridge_rate_regression` in `skills/wrds/scripts/ownership_dq.py`.
