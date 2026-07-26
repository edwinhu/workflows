# Linking ISS N-PX Funds to CRSP (and SEC Series IDs)

How to get from `risk.voteanalysis_npx.fundid` to a CRSP fund, and from there to
a fund-type classification (index / passive / active / asset owner).

This is the hard half of any fund-level voting project. The
[year-parallel SGE array](../examples/voting_ownership_pipeline/build_npx.sas)
that reduces the 238M-row N-PX table to `(itemonagendaid, block)` cells is
mechanical once you have this crosswalk; **the crosswalk is the work**.

## Contents

- [Why This Is Not a Join](#why-this-is-not-a-join)
- [The Ladder](#the-ladder)
- [Measured Coverage](#measured-coverage)
- [The Matcher](#the-matcher)
- [Precision Rules That Each Fixed a Real Failure](#precision-rules-that-each-fixed-a-real-failure)
- [Determinism: the join-order → corpus-order trap](#determinism-the-join-order--corpus-order-trap)
- [Aggregation Traps](#aggregation-traps)
- [Identity Resolution Belongs at Fund Grain](#identity-resolution-belongs-at-fund-grain)
- [Code](#code)

---

## Why This Is Not a Join

There is no ISS→CRSP key in WRDS. MFLINKS bridges CRSP↔Thomson, not ISS. So the
link has to be constructed, and the only exact identifier both sides can reach is
the **SEC series ID** (`S000...`), which:

- is **mandatory since 2006-02-06** for N-1A / N-3 / N-4 / N-6 registrants — i.e.
  for the whole open-end and variable-annuity N-PX voting universe;
- appears in ISS N-PX as `seriesid`, **but only from 2023 onward**;
- appears on the CRSP side through the SEC series↔CIK mapping.

So the architecture is forced: resolve `fundid → seriesId` where the ID exists
(2023+), **carry it back over the stable `fundid`** to that fund's pre-2023
votes, and use fuzzy name matching only for the residue.

## The Ladder

```
L1  SEC series/class annual masters ──────────► sec_series_master.parquet
    (S000…/C000… ids, names, tickers,           82,699 class rows
     one point-in-time snapshot per year)

L2  ISS fundid ──► SEC seriesId ──────────────► fundid_seriesid.parquet
    exact (2023+ seriesid) → propagated         26,686 rows (one per fundid)
    → cik-scoped fuzzy → inst-scoped fuzzy
    → global fuzzy (adjudicated)

L3  seriesId ──► CRSP MFDB ───────────────────► npx_crsp_link.parquet
    via_seriesid → via_ticker → via_l2_crsp     26,686 fundids × 17 cols
    → crsp_name_scoped → crsp_name_global       carries: crsp_fundno, wficn,
                                                index_fund_flag, tna_latest,
                                                block, match_tier

    ↓ npx_link_to_csv.py  (fundid, block, tna_w)

    stage_npx_link.sas ──► out.npx_link on /scratch ──► hash in build_npx.sas
```

**Identity resolution happens at L2/L3, on 26,686 rows — never on the 143.8M-row
vote panel.** That is the single most important structural rule here. A fundid
that resolves to two seriesIds is a 16-row problem at fund grain and an
unauditable mess at vote grain.

## Measured Coverage

Two ladders are documented here: the **portable** one shipped in
`examples/voting_ownership_pipeline/npx_linking/`, which runs from WRDS
credentials alone, and the **hand-adjudicated** one it is derived from.

### Portable ladder — measured 2026-07-25, 2005–2025

| Tier | Kind | fundids | vote rows | % |
|---|---|---:|---:|---:|
| `propagated` | exact | 5,957 | 84,831,520 | 58.76 |
| `sec_name` | fuzzy→ID | 8,033 | 26,637,210 | 18.45 |
| `crsp_name_scoped` | fuzzy | 763 | 1,953,098 | 1.35 |
| `iss_seriesid` | exact | 1,814 | 1,771,876 | 1.23 |
| `crsp_name_global` | fuzzy | 452 | 1,000,385 | 0.69 |
| `via_sec_ticker` | exact | 228 | 499,672 | 0.35 |
| `unlinked` | — | 9,682 | 27,682,099 | 19.17 |

**80.8% of vote rows linked** (82.4% of linkable rows — 1,038 ISS
non-registrants have no SEC seriesId by construction). Blocks: `active` 21,627 ·
`index` 3,704 · `passive` 560 · `asset_owner` 1,038. TNA at fundid grain after
the many-to-one split: **$32.96T**.

Note `sec_name` — matching the ISS name against SEC SERIES names to recover an
*identifier*, which then resolves exactly through `crsp_cik_map`. It is worth
18.45 points on its own, because ISS only reports `seriesid` from 2023 and most
of the panel by fundid count stopped voting before then. **A name match used to
obtain an ID is far safer than a name match used to obtain a link.**

### Hand-adjudicated ladder — the 90.5% version

`via_seriesid` alone supplies 19,327 of 21,191 links —
**the exact-ID tiers are the strategy; the fuzzy tiers are the tail.**

| L3 tier | fundids | Kind |
|---|---:|---|
| `via_seriesid` | 19,327 | exact |
| `unlinked` | 5,495 | — |
| `crsp_name_scoped` | 681 | fuzzy |
| `via_ticker` | 327 | exact |
| `feeder_master_name` | 275 | fuzzy |
| `via_l2_crsp_name` | 210 | fuzzy |
| `crsp_name_global` | 193 | fuzzy (adjudicated) |
| `via_sec_ticker` | 172 | exact |
| `digit_split_name` | 6 | fuzzy |

| Block | fundids |
|---|---:|
| `active` | 21,145 |
| `index` | 3,892 |
| `asset_owner` | 1,035 |
| `passive` | 614 |

**~90.5% of vote rows are linked.** The 9.7-point gap to the portable ladder is
`feeder_master_name` (275), `via_l2_crsp_name` (210), `digit_split_name` (6) and
a curated family table — tiers that are *adjudication decisions*, not algorithms,
plus the fact that the SEC masters begin in 2010 and cannot reach funds that died
before then (2,847 unlinked fundids last voted 2005–2009). Note the asymmetry: 5,495 of 26,686 fundids
(20.6%) are unlinked but only ~9.5% of vote *rows*, because unlinked funds are
disproportionately small and short-lived.

> `unlinked` here means "no `crsp_fundno`", not "no `block`". Unlinked funds
> still receive a block from the name-regex / name-default fallback, so the
> crosswalk covers every fundid. Measured against the real panel, only **598 of
> 144,375,860 vote rows (0.00%)** hit an absent fundid. What unlinked funds lack
> is `tna_latest`, i.e. a weight — which is why `build_npx.sas` emits
> `n_no_tna` per cell.

## The Matcher

Char n-gram TF-IDF cosine, the "ING" recipe: `analyzer="char_wb"`,
`ngram_range=(2,4)`, top-100 candidates, floor 0.30, via
`sparse_dot_topn.sp_matmul_topn`.

Candidate generation is deliberately **wide** — one global top-k matmul feeds
every fuzzy tier, and each tier filters by its own scope and threshold.
**Precision is bought in the accept rules, not in the candidate generator.**

| Regime | Threshold | Why |
|---|---:|---|
| CIK-scoped (L2) | 0.90 | CIK is an exact ISS-reported identifier — strictest |
| Institution-scoped (L2) | 0.80 | scoped like-to-like, few dozen candidates |
| CRSP-scoped (L3) | **0.90** | not 0.80 — see trust-prefix dominance below |
| Unscoped global | 0.85 + 2nd signal + 0.02 margin | never accepts on score alone |
| Identity claim | 0.97 | the 0.90–0.97 band is almost entirely sibling confusion |

## Precision Rules That Each Fixed a Real Failure

**Do not rediscover these.** Each was a measured error.

### 1. The digit-token guard

Char n-grams are nearly blind to digits: they carry most of a fund name's
discriminating information and almost none of its *character mass*.
`"Russell 2000"` scores **~0.97** against `"Russell 1000"`. Index funds differ
**only** by the number.

The guard requires the **multiset** of digit-bearing tokens to be identical, and
any trailing `SERIES <X>` designator to agree. It drops ~12% of candidate pairs.

**The guard is positional.** Evaluate it against the query *form* that produced
the candidate, not the raw ISS name. A match won through a leading-code strip
(`"6721 500 Index B"` → `"500 Index B"`) has already lost the code and must not
be asked to reproduce it — otherwise the guard blocks every insurance
sub-account.

### 2. Trust-prefix dominance

CRSP `fund_name` is `"<Trust>: <Fund>; <Class> Shares"`. Within-family
char-n-gram similarity is therefore dominated by the shared trust prefix, and
**family agreement is not an independent signal in the 0.80–0.85 band** — the
top-1 is systematically the *wrong sibling*. A family-scoped match at 0.85
resolved `"Oppenheimer Portfolio Series: Active Allocation"` to
`"...Fixed Income Active Allocation"`. Hence the CRSP scoped bar is 0.90.

### 3. Never strip the sponsor token from the query

Stripping the sponsor prefix was tried and let a **BlackRock master match an
Allspring fund**. Strip it as an **additional query form**, never as a
replacement, and score on `max(bare, institution-appended)`.

Appending the institution shifts scores *down* ~0.05–0.10 at every quantile
(cosine is length-weighted, so the appended segment adds proportional noise) —
but it rescues master–feeder cases where only the CRSP side names the family.
The two forms are complementary, not substitutes.

### 4. The cross-family veto, with an ID-attested exception

A master portfolio's feeder is in the same family *by construction*, so a
cross-family match is structurally impossible — argue for a hard veto. But a
name-only veto deletes the genuine **corporate successions**, where ISS records
the family as it was at vote time and CRSP records the acquirer today:

> Boston Management & Research → Eaton Vance · Reich & Tang → Shelton ·
> Gartmore → Nationwide · Wells Fargo → Allspring · GE RSP → State Street

~15% of the master–feeder tier's accepts are of that kind, and no name-based
rule can tell them from an error.

So: **hard veto, ID-based exception.** A family-disagreeing pair survives only on
an exact *bare-name* identity (never the institution-appended string, which
contains the disagreeing institution) **and** `scope_support ≥ 0.20` — the share
of this ISS institution's exact-tier siblings that CRSP files under the target's
management company. That evidence comes from SEC series IDs, which a name
matcher cannot manufacture.

The measured separation is clean: genuine successions **0.28–1.00**, known-wrong
**0.05–0.11**, and the band **0.111–0.275 is empty**. BlackRock → Allspring, the
case that prompted the rule, scores **0.0036**.

**Apply the veto to candidates, before the top-1 is chosen** — not to winners. A
cross-family candidate must not crowd out a correct in-family one.

### 5. Family tokens: word-boundary, both sources, no strategy words

- A **strategy word always agrees** — `FOCUS` bridged BlackRock to DWS at 1.00.
  Strategy words must never count as family evidence, and no stoplist can be
  trusted to be complete. A token counts only if some *firm* on one side is
  actually called that.
- The stoplist must apply to **both** token sources: `"Strategic Partners Mutual
  Funds"` otherwise emits `STRATEGIC`.
- Containment tests must be **word-boundary anchored, never substring**:
  `MUTUAL` is a substring of `MASSMUTUAL`.
- `family_token()` (first token only) is brittle both ways — `"John Hancock
  Funds, LLC"` → `JOHN`, `"RS Investment Management"` → `RS`. Use
  `family_tokens()` (all distinctive tokens), which recovers HANCOCK,
  DIMENSIONAL, BLACKROCK, TRANSAMERICA, NORTHWESTERN.

### 6. Normalisation details

- **`SandP` → `S&P`.** ISS spells the ampersand out inside a token; every other
  source writes `S&P`. Fold **before** tokenising, or the digit guard sees
  different token sets for the same fund.
- **`U.S.` → `US` before the punctuation strip.** ISS writes the dots, CRSP does
  not; stripping first leaves a two-token `U S` against CRSP's one-token `US`.
- **Share-class labels are not fund names.** `"Class A"`, `"Institutional
  Shares"` match indiscriminately; admit a class name to the corpus only if it
  looks like a full fund name (≥15 chars, ≥3 tokens, not a generic class prefix).
- **Fund names are not identifying.** 124 CRSP funds are named `"...S&P 500
  Index..."` across 48 management companies. The institution is the
  disambiguator.

### 7. Lifespan plausibility

A CRSP fund whose last summary predates the ISS fund's first vote cannot be the
same fund. This is a second signal independent of the name score, and it bites
exactly where the name tiers do their work (dead early-panel funds). One year of
slack absorbs the `caldt`-vs-`meetingdate` offset.

## Determinism: the join-order → corpus-order trap

**This ladder was not reproducible, and the cause is not where anyone looks
first.** Two cold runs of identical code on identical inputs produced different
crosswalks:

```
crsp_fundno.nulls   9,542 vs 9,563     ← 21 funds linked in one run, not the other
match_tier          93 rows differ
crsp_fundno        172 · tna_latest 260 · block 1
```

`block` differing on even one fundid moves the downstream panel. And it is the
worst class of failure: it passes on whichever run you check.

> **This is a latent bug in any ladder built this way, not just this copy.**
> If your linking code derives a matcher index from a joined frame, assume it is
> affected until you have hashed two cold runs.

### The mechanism

The obvious suspects are tie-breaks — two candidates score identically, which
wins? Fixing those did **not** fix it, because the divergence was upstream:

```
build_fund_units()          joins rep ⋈ agg
        │                   polars does NOT guarantee join output row order
        ▼
tgt = units.filter(...)     inherits that order
        │
        ▼
tgt.with_row_index("col")   ← THE LEAK: `col` is positional
        │
        ▼
tfidf_candidates(q, tgt["tgt_norm"].to_list())
                            corpus order changes ⇒ different rows tie at the
                            top_n / threshold boundary ⇒ a DIFFERENT SET of
                            candidates survives, not merely a different winner
```

So a nondeterministic *join* became a nondeterministic *match set*. Twenty-one
funds linked in one run and not the other — no tie-break could have fixed that,
because the losing candidates were never generated.

### The rule

**Any frame whose row order becomes data must be explicitly sorted.** Row order
becomes data at three points, all of them easy to miss:

| Construct | Why order leaks in |
|---|---|
| `.with_row_index()` | the index *is* position |
| `.unique(subset=…, keep="first")` | "first" is whichever row arrived first |
| `.group_by(...).agg(pl.col(x).first())` | same, per group, and hash-map order is not stable |

And two that look safe but are not: `rank("ordinal")` assigns tied values in
frame order, and `group_by` without `maintain_order=True` emits groups in
hash-map order.

Applied here — every one of these was a real leak:

```python
# corpus order → candidate set
return rep.join(agg, on="fund_unit", how="left").sort("fund_unit")
tgt = tgt.filter(...).sort(["tgt_norm", "fund_unit"])      # before with_row_index
q   = q.filter(...).sort("fundid")                          # before with_row_index

# "first" must name a defined row
.sort(["tgt_norm", "series_id", "entity_name"]).unique(subset=[...], keep="first")
.sort(["fundid", "fund_unit", "col"]).group_by([...], maintain_order=True)

# total tie-break instead of rank("ordinal")
cand.sort(["fundid", "score", "fund_unit"], descending=[False, True, False])
    .with_columns(pl.int_range(pl.len()).over("fundid").alias("rk"))
```

The tie-break sorts end on `fund_unit`, which is unique — that is what makes the
ordering *total*. A sort that can still tie has not fixed anything.

### Prove it, do not assume it

Determinism is not reviewable by reading. Run the ladder twice from cold and
hash both:

```bash
for r in A B; do ./build_npx_crsp_link.py … --out det_$r.parquet; done
python canonical_hash.py det_A.parquet det_B.parquet --keys fundid
```

Verified 2026-07-25 — two cold runs, identical:
`72af0b880b915960ac7e5141195310ed5d20d544b1ceb00c7cf8be4dc0c7074d`

### Blast radius: the bug was real, the published numbers were not wrong

Measured on the mirror ladder after applying the same fix. Exactly **one fundid**
(5040841) changed tier — `unlinked` → `feeder_master_name` — and its block stayed
`active`. That is **40 of 144,320,732 vote rows: 0.0000%**. It does not touch the
index block, so index cells and downstream flip counts are unaffected.

Both halves of that matter. The defect was real and had to be fixed, because an
irreproducible crosswalk cannot be identity-tested at all and the *next* run
might have moved something that counts. But no published figure was wrong, and
saying so plainly is more useful than implying a correction that did not happen.

Full-ladder hash after the fix: `8c0ddbfe`, superseding `426dc778`.

**Pin the library versions too.** Float behaviour in sparse matmul can shift
between releases, so a crosswalk can change under an upgrade for a reason nobody
thinks to look for. Verified against: polars 1.41, scikit-learn (TF-IDF
`char_wb` (2,4)), `sparse_dot_topn.sp_matmul_topn`.

## Aggregation Traps

### The uint32 trap

`n_vote_rows` is `uint32`. A naive sum **silently overflows**: block shares summed
to 40.5% and the index block read **6.3% when the truth was 36.1%**.

> **Cast every numeric column to float64 before any aggregation, and assert that
> every share reconciles to its column total.** This is not defensive
> programming; it is the difference between a right and a wrong headline number.

### TNA double-counting

`fundid → crsp_fundno` is **many-to-one**. Summing `tna_latest` at fundid grain
without splitting it across the ISS fundids that share a `crsp_fundno` gives
**$64.43T against a true $32.38T** — exactly 2×, and entirely plausible-looking.

Split the TNA across the sharing fundids, or aggregate at `crsp_fundno` grain.

### Weight coverage must be reported

`sharesvoted` is 0% populated before 2023, ~15% in 2023, 96% in 2024+. `tna_latest`
covers only linked funds. **Any weighted statistic must be published alongside
the share of vote rows that carry no weight** — otherwise a share-weighted 2019
split looks precise and is computed from nothing. `build_npx.sas` emits
`n_no_sv` and `n_no_tna` per cell for this reason.

## Identity Resolution Belongs at Fund Grain

**16 fundids carry more than one seriesId.** Resolved at fundid grain:

- 13 are clean **fund reorganisations** (the fund genuinely became a different
  series);
- 2 are **single-year blips**;
- 1 — JHVIT `6008319` — is a genuine **ISS conflation** of two permanently
  distinct series.

All 16 are `block == 'active'`, so none can move an index-block statistic. But
that is a fact you can only establish by looking at 16 rows. At vote grain the
same problem is 16 fundids × millions of rows and is not auditable.

## Code

`examples/voting_ownership_pipeline/npx_linking/`

| File | Role |
|---|---|
| `linking_config.py` | every threshold, regex and stoplist, with its rationale |
| `matching.py` | the reusable engine: normalisers, digit guard, TF-IDF candidates, cross-family verdict |
| `download_sec_series_class.py` | fetch the SEC annual masters (URLs are scraped — they are inconsistent across vintages, and the 2016 file carries no year in its name) |
| `build_sec_series_master.py` | L1 — consolidate them |
| `pull_npx_funds.py` | L0 — ISS fund dimension, aggregated server-side |
| `pull_crsp_funds.py` | L0 — CRSP dimension (`fund_hdr` + `fund_summary2` + `crsp_cik_map`) |
| `build_npx_crsp_link.py` | the ladder + first-class coverage report |
| `smoke_test.sh` | one year, 8 assertions — run before the full ladder |

**The ladder runs from a fresh checkout with WRDS credentials.** The only
project-specific input is `--family-overlay`, a hand-curated institution →
family-token CSV, and it is **optional**: absent, the ladder completes at
slightly lower coverage and the report says so.

`crsp.crsp_cik_map` is what makes this portable — it carries `series_cik` in
`S000…` form for 59,244 of 68,382 fundnos, so the majority tier needs nothing
project-specific.

## Candidate: WRDS S12 fund-name history (NOT evaluated)

A second, independent name vocabulary that may reach the unlinked tail. Recorded
so it is not lost; **not measured, not implemented.**

`S12_Names_20250630.xlsx` (WRDS, document 1970) — 238,526 rows of
`(FUNDNO, START_DATE, END_DATE, FUNDNAME)`: 198,967 distinct FUNDNO, 230,652
distinct name strings, and **28,509 (14.3%) with more than one name spell**.

That long, vintaged shape is exactly what the L2 SEC-series-name tier already
exploits, and that tier is worth 18.45 points — so the shape is proven here. The
target is the 5,495 fundids (19.17% of vote rows) still `unlinked`, whose
failures are concentrated in the name tiers. A fund renamed in 2008 becomes
matchable from its 2008 name.

**Why it is a candidate and not a drop-in.** `FUNDNO` is the *Thomson* s12 fund
number, not `crsp_fundno`. The ladder links ISS → CRSP directly; this would add
a hop:

```
ISS name → S12 name → thomson fundno → MFLINKS → wficn → crsp_fundno
```

The bridge exists (`build_mflinks.sas` already runs for the holdings leg), but
every hop can introduce a wrong link — and **a wrong link is worse than a miss**,
because it silently reassigns a fund to the wrong block, where the coverage
report cannot see it.

If evaluated, the conditions are not negotiable:

1. **A new tier BELOW the existing ones**, never replacing them. `via_seriesid`
   is 19,327 of 21,191 links and must not be perturbed.
2. **Measure only on the currently-unlinked 5,495.** If it does not move that
   number materially, the extra hop is not worth it.
3. **Same guards, and they matter more here.** Digit-token agreement, designator
   agreement, cross-family veto — a bigger corpus is more near-miss surface.
4. **Match era-appropriately** using `START_DATE`/`END_DATE`, or you will link a
   fund to a name it only held *after* the vote being classified.
5. **Sort the new corpus before it becomes a TF-IDF index** — see
   [the determinism trap](#determinism-the-join-order--corpus-order-trap). A new
   corpus is a new place for join order to leak into the match set.

## See Also

- `examples/voting_ownership_pipeline/` — the SGE array that consumes the crosswalk
- `iss-voting.md` — the N-PX and vote-results tables themselves
- `tfn-ownership.md` — MFLINKS, for the holdings-side bridge
- `proxy-advisors.md` — CIK × year → `crsp.fund_hdr.mgmt_cd`
