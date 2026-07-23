# TAQ (Trades and Quotes) Reference

Patterns from the `close`, `bank_pin`, and `pin-code` projects on WRDS.

---

## Quick Reference: TAQ Libraries

| Library | SAS Libname | Contents | Granularity |
|---------|-------------|----------|-------------|
| Legacy TAQ master | `taq.mast_YYYY` | Symbol directory | Yearly |
| Legacy TAQ IID | `taq.wrds_iid_YYYY` | WRDS Intraday Indicators | Daily aggregates |
| Millisecond master | `taqmsec.mastm_YYYY` or `taqmsec.mastm_YYYYMMDD` | Symbol directory | Yearly or daily |
| Millisecond IID | `taqmsec.wrds_iid_YYYY` | WRDS Intraday Indicators | Daily aggregates |
| Consolidated trades | `taqmsec.ctm_YYYYMM` or `taqmsec.ctm_YYYYMMDD` | Raw tick trades | Millisecond |
| WRDS cleaned trades | `taqmsec.wct_YYYYMMDD` | Cleaned tick trades (carry matched `nbb`/`nbo`) | Millisecond |
| Consolidated quotes | `taqmsec.cqm_YYYYMMDD` | Raw per-venue quotes, all sizes (incl odd-lot) | Millisecond |
| Raw NBBO (**incomplete**) | `taqmsec.nbbom_YYYYMMDD` | NBBO file — structurally incomplete; **don't use alone** | Millisecond |
| **Complete NBBO** ✅ | `taqmsec.complete_nbbo_YYYYMMDD` | WRDS-derived Official Complete NBBO — **use this** | Millisecond |

**NBBO files are NOT in the default taqmsec libname.** You must add them explicitly:

```sas
libname taqmsec (taqmsec '/wrds/nyse/sasdata/wrds_taqms_nbbo') inencoding=asciiany;
```

### PostgreSQL Schema Mapping

| SAS Libname | PostgreSQL Schema | Notes |
|-------------|------------------|-------|
| `taq` | `taqmsec` | Legacy second-level data |
| `taqmsec` | `taqmsec` | Millisecond data |

### Data Era Transition

| Period | Source | Merge Key | Symbol Field |
|--------|--------|-----------|-------------|
| 1993–2006 | `taq.*` | `date, symbol` | `SYMBOL` (single field) |
| 2007+ | `taqmsec.*` | `date, sym_root, sym_suffix` | `SYMBOL_15` → split into root + suffix |

The NMS (Reg NMS) transition in Feb 2007 is the dividing line. Code must handle both eras with separate macros.

---

## Datasets Explained — trades, quotes, and NBBO

Millisecond TAQ (`taqmsec`) has three families: trades, quotes, and NBBO. Know which is which.

| Dataset | What it is |
|---------|-----------|
| `mastm_YYYYMMDD` (or `_YYYY`) | **Master / symbol directory.** One row per stock-day: `round_lot`, `UOT` (units-of-trade), `sec_type`, `shares_outstanding`, `listed_exchange`, `tape`, `test_symbol_flag`. Parse `sym_root`/`sym_suffix` from `SYMBOL_15`. |
| `ctm_YYYYMMDD` | **Consolidated trades (raw).** Every reported trade with `price`, `size`, `tr_scond` (sale condition), `ex`. Includes odd-lot & ISO trades. Filter by sale condition yourself. |
| `wct_YYYYMMDD` | **WRDS cleaned trades.** `ctm` after WRDS cleaning, and each trade carries the **matched prevailing NBBO** (`nbb`/`nbo`, `nbbqty`/`nboqty`) — no as-of merge needed. May drop trade types; use `ctm` if you need full control (e.g. to keep all odd-lot trades). |
| `cqm_YYYYMMDD` | **Consolidated quotes (raw).** One row per exchange quote: `ex`, `bid`, `bidsiz`, `ask`, `asksiz`, all in **units-of-trade (UOT)**, all sizes including odd-lot. This is the source the NBBO is built from. |
| `nbbom_YYYYMMDD` | **DailyNBBO file — STRUCTURALLY INCOMPLETE.** It omits the states where a *single* exchange holds *both* the best bid and best offer (those live only in `cqm`). Do **not** use it as the NBBO. |
| `complete_nbbo_YYYYMMDD` | **WRDS-derived Official Complete NBBO — USE THIS.** `best_bid`/`best_ask` + `Best_BidSizeShares`/`Best_AskSizeShares` (in **shares**), one row per NBBO change. |
| `wrds_iid_YYYY` | **Intraday Indicators.** Pre-computed daily aggregates per stock-day: `vw_price_m` (VWAP), `total_vol_m`, `oddlot_vol`, `BuyNumTrades_LR`/`SellNumTrades_LR`, etc. Cheap for filters/controls. |

### ⚠ Which NBBO to use: `complete_nbbo`, never `nbbom` alone

Per Holden & Jacobsen (2014) and Holden's WRDS instructions: the **DailyNBBO (`nbbom`) file does NOT contain the complete NBBO** — when one exchange has both the best bid and best offer, that state is recorded only in the quote (`cqm`) file. The **Official Complete NBBO = `nbbom` combined with `cqm`**.

**WRDS ships this pre-built as `taqmsec.complete_nbbo_YYYYMMDD`.** Use it directly — you do not need to run the Holden-Jacobsen build yourself. `nbbom` diverges from `complete_nbbo` exactly on thin names where one exchange is frequently best on both sides (can be the majority of updates for very-high-priced stocks — this is the documented incompleteness, not noise).

```
cqm (raw per-venue quotes)  +  nbbom (incomplete NBBO)  ──►  complete_nbbo  (Official Complete NBBO)
```

- Refs: Holden & Jacobsen (2014), *J. Finance*; instructions at `host.kelley.iu.edu/cholden`. Eddy's Netezza port: `edwinhu/nz_taq`.

### Round-lot (protected) vs odd-lot-inclusive NBBO

> **⚠ REWRITTEN 2026-07-16 — the previous text was wrong on both counts. Verified empirically
> against `taqmsec` (20251020–20251215); see the evidence inline.**
> It claimed `complete_nbbo` is odd-lot-inclusive, told you to recompute the protected quote from
> `cqm` at "size ≥ round lot", and to multiply by `mastm.UOT` for shares. All three are wrong.

### ⚠ Quote-size UNITS CHANGE ON 2025-11-03

```
shares = bidsiz × 100     for dates <= 2025-10-31    (bidsiz is in ROUND LOTS)
shares = bidsiz           for dates >= 2025-11-03    (bidsiz is in SHARES)
```

**×100 — NOT `× ROUND_LOT`, NOT `× UOT`.** Pre-Nov, even the handful of names already carrying
`ROUND_LOT` 10 or 1 (NVR, BRK.A) were quoted in **100-share units**.

**It is an ENCODING change, not a round-lot change** — AAPL's `ROUND_LOT` is 100 throughout:

| date | AAPL modal `bidsiz` | |
|---|---|---|
| 20251020 / 29 / 30 / 31 | **1**, 2, 3 | round lots |
| 20251103 / 04 / 05 / 10 / 1201 / 1215 | **100**, 200, 300 | **shares** |

**Cause:** NYSE Daily TAQ Client Spec **v4.1b (2025-08-07)** — *"Field #5 Bid Size and #7 Ask Size —
removed 'in round lots'"*. Live in the data from **2025-11-03**.
**`cqm` itself is correct** — it tracks NYSE faithfully. The WRDS column label ("Bid size in units
of trade") is **stale**, as is WRDS's own doc site (newest Daily TAQ manual there is v4.0/2022;
NYSE is on v4.3).

**⚠ If your sample straddles 2025-11-03, convert before comparing any size.** An unconverted
pre/post comparison shows a spurious **100×** jump in every name.

### ⚠ WRDS BUG: `complete_nbbo` size fields are 100× inflated from 2025-11-03

`complete_nbbo` is **WRDS-created** (`nbbom ∪ cqm`), and its `Best_BidSizeShares` /
`Best_AskSizeShares` = `cqm.bidsiz × 100` **always**. Paired row-level test (same event, same NBB
price), ratio exactly 100 with no exceptions: AAPL 646,637/646,637 (Oct 31), 650,140/650,140
(Dec 15), AZO 13,250/13,250, BKNG 10,002/10,002.

| | reported | truth | |
|---|---|---|---|
| AAPL 20251031 | 100, 200, 300 | 100, 200, 300 | ✅ |
| AAPL 20251215 | **10000, 20000, 30000** | 100, 200, 300 | ❌ 100× |
| AZO 20251215 | **1000, 2000, 3000** | 10, 20, 30 | ❌ 100× |

Corroborated by `ctm.size` (always true shares): AAPL trades 1/100/10/20/2; AZO 1/10/2/5/3. A
1,000-share AZO quote ≈ **$3.5M**; a 10,000-share AAPL NBB ≈ **$2.7M**. Both absurd.

**Do not use `complete_nbbo` size fields for dates ≥ 2025-11-03.** Derive size from `cqm`.
**Prices are unaffected** — reported to WRDS support 2026-07-16.

### `mastm.UOT` is NOT the round lot

`UOT` = *"Minimum size that a trade is executed"* = **1** for every security, pre and post
(verified 20251031 & 20251215). **Never use `UOT` as a size multiplier.** WRDS's TAQ overview page
calls it "the unit of trade in Round-Lot value" — a **stale 2010 example** (Dell, when `UOT` was
100). The round lot is **`mastm.ROUND_LOT`**.

### Round-lot (protected) vs odd-lot — `cqm` has NO odd lots

NYSE Daily TAQ ships these as **separate files** (spec v4.3): **§4 Round Lot Quotes** (= WRDS
`cqm`), **§5 Odd Lot Quotes**, **§6 NBBO**, **§7 BOLO (Best Odd Lot Bid/Offer)**. WRDS's `cqm` is
the *Round Lot Quotes* file, so it carries **no odd lots** in either period, and
**`complete_nbbo` IS the round-lot protected NBBO** (the Rule 611 quote). Claims that "cqm has
odd-lot quotes down to 1 share" misread pre-Nov `bidsiz=1` (= 100 shares) as one share.
Odd-lot data requires the §5/§7 files (an NYSE product — not necessarily an IEX-only route).

**⚠ Never write `bidsiz >= 100` for a pre-Nov date** — that demands *100 round lots* = **10,000
shares**. (This bug is live in `rule611/scripts/wrds/rbbo_single.sas`.)

### MDI round-lot tiers (verified 2026-07-16, `mastm.ROUND_LOT`)

Price-tiered since **2025-11-03** (semiannual reset, one-month lag: Nov ← Sept average):

| ROUND_LOT | avg-price tier | observed 20251215 (nsym, median px) |
|---|---|---|
| 100 | ≤ $250 | 9,989 · $26.16 (max $335.89) |
| 40 | $250.01–1,000 | 231 · $351.32 |
| 10 | $1,000.01–10,000 | 13 · $1,973.85 (NVR $7,600, BKNG $5,476) |
| 1 | > $10,000 | 1 (BRK.A) |

Boundaries look fuzzy at the edges because tiers use the **lagged Evaluation Period average**, not
the current price (e.g. NFLX sits in the 10-tier at $93.89 post-split — its tier reflects its
~$1,200 pre-split average).

---

## ⏱️ Exchange-to-SIP Latency: matching trades to quotes correctly

**`time_m` (SIP time) and `part_time` (Participant/Exchange time) differ by the message's travel to
the SIP — 12µs to 540µs depending on venue, ~10ms for a distant one.** Matching a trade to the
prevailing NBBO on SIP time is therefore **wrong**, and wrong in a *systematic* direction: it
manufactures locked/crossed quotes that never existed. Holden-Pierson-Wu (2023) quantify it, and the
fix is two lines.

### The two-liner (HPW 2023, Appendix C.4) — VERBATIM

Inserted into **Holden & Jacobsen's own SAS code (v2018-03-16), STEP 6**:

```sas
/* STEP 6: CLEAN DAILY TRADES DATA - DELETE ABNORMAL TRADES */
data trade2;
set DailyTrade;
where Tr_Corr eq '00' and price gt 0;     /* <- HJ's ACTUAL trade screen. That is all. */
LATEN=TIME_M - PART_TIME;                 /* line 1: the trade's own latency */
TIME_M=PART_TIME - LATEN;                 /* line 2: replace SIP time  => 2*part_time - time_m */
run;
```

Then match to the prevailing NBBO **exactly as before**. No latency table is needed — **each trade
carries its own latency proxy**. (HPW fn 20 states the assumption: the NBBO message's
exchange→SIP travel ≈ the trade message's.)

⚠️ **HJ's published SAS code filters ONLY on `Tr_Corr='00' and price>0`** — no sale-condition
screen. The elaborate position-based `substr(sale_condition,...)` filter lives in `edwinhu/nz_taq`
(a Netezza port), **not** in HJ's SAS code. HPW's fn 25 ("no more data constraints… all symbols and
all trades") means *beyond HJ STEP 6* — so **ISOs are included**. Different papers make different
choices here; **state which filter you used.**

### ✅ Replicated on WRDS (2026-07-16) — 1.67 BILLION trades

50 monthly days, 2015-08…2019-09, all symbols, `taqmsec.complete_nbbo` + `ctm`
(`rule611/scripts/wrds/hpw_replicate.sas`, `hpw_pool.sas`):

| | HPW Table IV | **our replication** | error |
|---|---|---|---|
| SIP locked | 5.608% | **5.670%** | +0.06pp |
| **ADJ locked** | **1.424%** | **1.433%** | **+0.009pp** |
| SIP crossed | 0.097% | 0.109% | +0.01pp |
| ADJ crossed | 0.045% | 0.052% | +0.01pp |
| SIP outside | 2.606% | 2.688% | +0.08pp |
| ADJ outside | 3.890% | 3.956% | +0.07pp |
| **locked drop [ADJ−SIP]** | **−4.184pp** | **−4.236pp** | **0.05pp** |

**Latency adjustment removes ~75% of trades matched to locked quotes.** Note the sign flip on
*outside-NBBO*: it **increases** (2.606% → 3.890%). Correcting latency does not uniformly "clean"
the data — it moves trades between abnormal categories.

### The RBBO method (HPW §3.2.3) — and what it costs you

Their second, "first-best" method rebuilds each **data-center city's** book as that city would see it:

```
local city quotes : obst = part_time                    ("Quote@City Time")
away  city quotes : obst = part_time + RAW city ref     ("Quote@City Latency-adjusted Time")
trades            : matched at part_time to their OWN city's RBBO, then consolidated
```
The **six references** (fn 21) are `median(SIP time − part_time)` per **origin city × SIP network**
— RAW, i.e. **including each SIP's gateway+processing**. Measured 20190603:

| | →Mahwah (CTA) | →Carteret (UTP) |
|---|---|---|
| from Mahwah | **104.9** (local) | 372.0 |
| from Carteret | 537.2 | **17.1** (local) |
| from Secaucus | 403.5 | 197.2 |

⚠️ **The same Mahwah↔Carteret fiber reads 537.2µs (CTA) vs 372.0µs (UTP)** — a 165µs spread on
identical physics, because each ref embeds its own SIP's overhead (104.9 vs 17.1). HPW keep the
networks separate for exactly this reason (fn 21) rather than reconciling them. Also: away quotes
get `+raw_ref` while **local quotes get +0**, so the away-vs-local gap is overstated by the local
SIP's overhead. Normalizing (`− med(local→same SIP)`) is *our* correction, **not theirs** — keep it
as a robustness check, not a silent substitution.

⚠️ **The RBBO cannot classify OFF-EXCHANGE trades.** It covers only the 12 co-located exchanges, so
FINRA ADF/TRF (`D`), IEX (`V`, Weehawken) and CHX (`M`) drop out — **11.5M of 47.3M trades on
20190603 (~24%)**, and TRF alone is ~40% of share volume. A TRF print has no data center, so there
is no book to reconstruct for it. Table IV's "all trades" sample is therefore **NOT** comparable to
an RBBO number.

⚠️ **No SIP in Secaucus** ⇒ `travel(→Secaucus)` is unidentifiable; HPW fill it by symmetry. Any
Secaucus-observer result rests on that. (And symmetry is era-dependent — see below.)

### ✅ Validated against the order book (the only external check that exists)

Score Lee-Ready against the **ARCA Integrated Feed** (WRDS trial days 20211004/05, App C.5):
join x103 (Order Executed) → x100 (Add Order) by `OrderID` to get the resting order's **`Side`**;
the initiator is the **opposite** side. 99.9% of executions match a TAQ trade.

| method | ours (20211004) | HPW | |
|---|---|---|---|
| SIP | 87.75% | 86.75% | ✅ |
| **ADJ** (C.4 two-liner) | **92.30%** | **92.05%** | ✅ **0.25pp** |
| RBBO, **city** book (HPW §3.2.3) | **85.92%** | 92.63% | ❌ **below the raw tape** |
| RBBO, **per-exchange** book | **91.73%** | 92.63% | ✅ within 0.9pp |

**⚠️ The city book silently drops venues.** It carries only the 12 co-located exchanges, so
**IEX (`V`), NYSE Texas (`M`), ADF (`D`)** are missing while `complete_nbbo` includes them.
Lee-Ready is pure midpoint arithmetic ⇒ a book missing real quotes scores **worse than doing
nothing**. Give every venue its **own measured travel** instead: **+5.8pp**.
Normalizing the refs (stripping the SIP's ~30µs overhead) does **NOT** help — it scores *worse*
(85.59%). Don't argue latency choices from the text; **score them against the order book**.

⚠️ HPW report RBBO **beating** ADJ (+58bp); post-Pillar (2021) we find it **trailing** (−57bp).
CTA Mahwah latency fell **104.9µs (2019) → 30.7µs (2021)** — less latency to correct, less room for
the RBBO to win. Plausible, unestablished (only 2 trial days exist).

### SIP vs ADJ vs RBBO on an IDENTICAL sample (ours, 20190603, 35.8M trades)

HPW publish **no lock rate for the RBBO** (Table IV is SIP vs ADJ only; Table V reports RBBO
*classification accuracy*). Running their method ourselves:

| method | locked | crossed | outside | abnormal |
|---|---|---|---|---|
| SIP (NBBO) | **6.720%** | 0.085% | 1.531% | 7.934% |
| ADJ (two-liner) | **1.582%** (−76.5%) | 0.042% | 3.456% | 4.819% |
| RBBO | **2.671%** (−60.3%) | 0.052% | 1.845% | **4.319%** |

**The RBBO cuts locks LESS than the two-liner (60% vs 76%) but has the lowest TOTAL abnormal rate**,
because its outside-NBBO is far lower. The methods trade off *across* abnormal categories — no
single method dominates. Also note restricting to on-exchange raises the SIP lock rate
(5.406% → 6.720%): off-exchange trades are matched to locked quotes much less often.

### Estimating per-exchange latency yourself

`median(time_m − part_time)` per `(ex, qu_source)` reproduces **HPW's Table I** (`qu_source`:
`C`=CTA SIP in Mahwah, `N`=UTP SIP in Carteret). Validated on their day (20190603):

| ex | HPW | ours | | ex | HPW | ours |
|---|---|---|---|---|---|---|
| C (NYSE National) | 102.3 | **102.9** | | Z (Cboe BZX) | 403.0 | **400.1** |
| N (NYSE) | 105.1 | **105.2** | | B (Nasdaq BX, CTA) | 536.8 | **535.2** |
| Y (Cboe BYX) | 401.2 | **401.7** | | B (Nasdaq BX, UTP) | 16.7 | **16.6** |
| **M (CHX, 2019)** | **10254.1** | **10259.8** | | Q (Nasdaq, UTP) | 17.0 | **17.0** |

**Watch out:**
- **Corrupt timestamps exist** — `part_time` after `time_m` by ~35,000s. Use the **median** and
  screen (e.g. `0 ≤ lat ≤ 10ms`).
- **Latency is NOT symmetric across networks.** 2019: `CAR→MAH` (CTA, fiber) = 432µs vs `MAH→CAR`
  (UTP, millimeter wave) = 353µs — different physical networks. They had converged by 2025
  (325.9 vs 324.5). Don't assume symmetry; measure it.
- **Venue identity changes.** `M` was CHX (10ms, Secaucus/Chicago) in 2019 and is **NYSE Texas**
  (Mahwah-fast, 20.8µs) in 2025. `G`=24X, `U`=MEMX, `L`=LTSE, `H`=MIAX Pearl post-date HPW.
  **`V` (IEX) is in Weehawken**, not Secaucus. Get codes from TAQ spec v4.3 Appendix F.
- **Gateway latency ≠ geography.** MIAX (`H`) sits in Equinix NY4 Secaucus — same town as Cboe
  (NY5) — yet is **+102µs**. That is MIAX's own egress, not distance. Per-exchange estimation
  captures it; a venue→city lookup does not.
- **Clock sync bounds the exercise.** Reg SCI requires venue clocks within **100µs** of NIST, while
  modelled travel is 164–540µs. Drift is a material fraction of the effect.

### The three cities (and the one that isn't identified)

Mahwah (CTA SIP + NYSE group), Carteret (UTP SIP + Nasdaq group), Secaucus (Cboe group) —
**96% of lit volume** (HPW). Distances: MAH–CAR 35mi, MAH–SEC 21mi, CAR–SEC 17mi.
Our measured travel: 9.3 / 9.7 / 9.6 µs-per-mile — one constant across three pairs, ~18% above
fiber's speed of light (8.05 µs/mi). Good sanity check on any latency matrix.

**There is no SIP in Secaucus**, so `travel(→Secaucus)` is **not identifiable** from TAQ; HPW hit
this too and fill it by symmetry. Any Secaucus-observer result rests on that assumption.

**Refs:** Holden & Jacobsen (2014, *JF*); Holden-Pierson-Wu (2023), *"In the blink of an eye"*
(SSRN 4441422) — pinned with the paper text at `rule611/docs/reference/`.

---

## Master File Loading

**Iron rule: Load ±1 year of master files for symbol continuity.** Symbols list/delist near year boundaries — without this, you lose matches on Dec 31 and Jan 1.

### Legacy TAQ (pre-2007)

```sas
data work.mastm_&yyyy.;
    set %if &yyyy > 1993 %then %do;
            taq.mast_%SYSEVALF(&yyyy.-1):
        %end;
        taq.mast_&yyyy.:
        taq.mast_%SYSEVALF(&yyyy.+1):;
    SYM_ROOT = scan(SYMBOL, 1, ' ');
    SYM_SUFFIX = scan(SYMBOL, 2, ' ');
    DATE = coalesce(FDATE, DATEF);
    format date yymmdd10.;
run;
proc sort data=work.mastm_&yyyy. NODUPKEY;
    by SYMBOL DATE;
run;
```

### Millisecond TAQ (2007+)

Millisecond master files changed column names over time — use COALESCEC for compatibility:

```sas
%let sysyear = %sysfunc(year("&sysdate"d));

/* Millisecond master */
data work.mast1_&yyyy.;
    length date 8 sym_root $6 sym_suffix $10 symbol_15 $15;
    set taqmsec.mastm_%SYSEVALF(&yyyy.-1):
        taqmsec.mastm_&yyyy.:
        %if %SYSEVALF(&yyyy.+1) <= &sysyear. %then %do;
        taqmsec.mastm_%SYSEVALF(&yyyy.+1):
        %end;;
    SYM_ROOT = scan(SYMBOL_15, 1, ' ');
    SYM_SUFFIX = scan(SYMBOL_15, 2, ' ');
    keep date cusip sym_root sym_suffix symbol_15;
run;

/* Legacy master (for cross-reference) */
data work.mast2_&yyyy.;
    length date 8 sym_root $6 sym_suffix $10 symbol_15 $15;
    set taq.mast_%SYSEVALF(&yyyy.-1):
        taq.mast_&yyyy.:
        %if %SYSEVALF(&yyyy.+1) <= &sysyear. %then %do;
        taq.mast_%SYSEVALF(&yyyy.+1):
        %end;;
    SYM_ROOT = scan(SYMBOL, 1, ' ');
    SYM_SUFFIX = scan(SYMBOL, 2, ' ');
    DATE = coalesce(DATE, FDATE, DATEF);
    SYMBOL_15 = coalescec(SYMBOL_15, SYMBOL);
    keep date cusip sym_root sym_suffix symbol_15;
run;

/* Combine both sources */
data work.mastm_&yyyy.;
    length date 8 cusip $12 sym_root $6 sym_suffix $10 symbol_15 $15;
    set work.mast1_&yyyy. work.mast2_&yyyy.;
run;
proc sort data=work.mastm_&yyyy. NODUPKEY;
    by SYM_ROOT SYM_SUFFIX DATE;
run;
```

### Master File Column Changes

The `mastm_` daily files changed field names:

| Period | Symbol Root | Symbol Suffix |
|--------|------------|---------------|
| Pre-Oct 2016 | `SYMBOL_ROOT` | `SYMBOL_SUFFIX` |
| Oct 2016–2017 | `SYM_ROOT` | `SYM_SUFFIX` |
| 2018+ | Neither — only `SYMBOL_15` | Parse with `scan()` |

Handle all three with:

```sas
_SYM_ROOT = COALESCEC(SYMBOL_ROOT, SYM_ROOT, scan(SYMBOL_15, 1, ' '), '');
_SYM_SUFFIX = COALESCEC(SYMBOL_SUFFIX, SYM_SUFFIX, scan(SYMBOL_15, 2, ' '), '');
```

---

## CRSP–TAQ Merge

Link TAQ symbols to CRSP permnos via CUSIP matching through the master files:

```sas
proc sql;
    create table work.mastm_crsp_&yyyy. as
        select a.date, sym_root, sym_suffix, symbol_15,
            substr(coalesce(b.ncusip, b.cusip), 1, 8) as cusip8,
            a.permno, a.permco, shrcd, exchcd,
            a.prc, a.ret, a.retx, a.shrout, a.vol,
            c.divamt, c.distcd,
            coalesce(e.SP500, 0) as SP500
        from crsp.dsf a
        left join crsp.dsenames b
            on a.permno = b.permno
            and a.date between b.namedt and coalesce(b.nameendt, today())
        left join crsp.dsedist c
            on a.permno = c.permno and a.date = c.paydt
        left join
            (select distinct cusip, sym_root, sym_suffix, symbol_15,
                min(date) as mindt, max(date) as maxdt
            from work.mastm_&yyyy.
            group by cusip, sym_root, sym_suffix, symbol_15) d
            on substr(d.cusip, 1, 8) = substr(coalesce(b.ncusip, b.cusip), 1, 8)
            and a.date ge d.mindt
            and a.date le coalesce(d.maxdt, today())
        left join
            (select *, 1 as SP500 from crsp.dsp500list) e
            on a.permno = e.permno
            and a.date between e.start and e.ending
        where year(a.date) = &yyyy.
            and symbol_15 is not null
        order by a.date, sym_root, sym_suffix;
quit;
```

**Common stock filter** (apply after merge):

```sas
where permno > .Z
    and shrcd in (10, 11)
    and exchcd in (1, 2, 3, 4);  /* NYSE, AMEX, NASDAQ, ARCA */
```

---

## WRDS Intraday Indicators (IID)

WRDS IID provides pre-computed daily aggregates — no tick-level processing needed for most research.

### Key Variables

| Legacy (`taq.wrds_iid_YYYY`) | Millisecond (`taqmsec.wrds_iid_YYYY`) | Description |
|-------------------------------|----------------------------------------|-------------|
| `buynumtrades_lri` | `buynumtrades_lr` | Buy trade count (Lee-Ready) |
| `sellnumtrades_lri` | `sellnumtrades_lr` | Sell trade count (Lee-Ready) |
| `FPrice`, `OPrice` | `oprc`, `cprc` | Opening/closing price |
| `CPrc`, `CPrc2` | `cprc` | Closing price |
| `ret_mkt_t` | `ret_mkt_m` | Market return |
| `vwap_m` | `vw_price_m` | Volume-weighted average price |
| `SumVolume_m` | `total_vol_m` | Total volume |
| `SumVolume_b` | `total_vol_b` | Buy volume |
| `SumVolume_a` | `total_vol_a` | Sell volume |

### Merge IID with CRSP–Master

```sas
/* Legacy: merge by date, symbol */
data work.taqdf_&yyyy.;
    merge work.wrds_iid_&yyyy.(keep=date symbol
            buynumtrades_lri sellnumtrades_lri
            FPrice OPrice CPrc: ret_mkt_t vwap_m
            SumVolume_m SumVolume_b SumVolume_a)
        work.mastm_crsp_&yyyy.;
    by date symbol;
    CCPrc = abs(coalesce(prc, cprc, cprc2));
    mid_after_open = (oprice + fprice) / 2;
    y_e = divide(buynumtrades_lri - sellnumtrades_lri,
                 buynumtrades_lri + sellnumtrades_lri);
    rename buynumtrades_lri = n_buys
           sellnumtrades_lri = n_sells
           vwap_m = vw_price_m
           ret_mkt_t = ret_mkt_m
           SumVolume_m = total_vol_m
           SumVolume_b = total_vol_b
           SumVolume_a = total_vol_a;
run;

/* Millisecond: merge by date, sym_root, sym_suffix */
data work.taqdf_&yyyy.;
    merge work.wrds_iid_&yyyy.(keep=date sym_root sym_suffix
            buynumtrades_lr sellnumtrades_lr oprc cprc ret_mkt_m
            vw_price_m mid_after_open
            total_vol_m total_vol_b total_vol_a)
        work.mastm_crsp_&yyyy.;
    by date sym_root sym_suffix;
    CCPrc = abs(coalesce(prc, cprc));
    y_e = divide(buynumtrades_lr - sellnumtrades_lr,
                 buynumtrades_lr + sellnumtrades_lr);
    rename buynumtrades_lr = n_buys
           sellnumtrades_lr = n_sells;
run;
```

### Era-Switching Macro

Use a runner macro to auto-select the right processing path:

```sas
%MACRO RUNNER;
%if &year_param. <= 2009 %then %do;
    %TAQ_OWR_GPIN();
%end;
%else %do;
    %TAQM_OWR_GPIN();
%end;
%mend;
%RUNNER;
```

The cutoff between legacy and millisecond varies by subscription. 2007 is the NMS transition, but WRDS IID access for millisecond data may start at 2010 depending on subscription level.

---

## Raw Tick Processing

For research requiring sub-daily granularity (closing auctions, VWAP, intraday patterns), process raw tick data directly.

### Closing Trade Identification

Match the closing trade sequence number from IID to the raw consolidated trades:

```sas
/* Extract closing trade metadata from IID */
data _i_&yyyy.&mm.;
    set taqmsec.wrds_iid_&yyyy.;
    where sym_suffix = '' and month(date) = &mm.;
    keep date sym_root sym_suffix
        TR_SEQNUM_close C_official CTime CEX CPrc Csize;
run;

/* Load raw trades for the month */
data _t_&yyyy.&mm. / view=_t_&yyyy.&mm.;
    set taqmsec.ctm_&yyyy.&mm.:;
run;

/* Join on sequence number to get the exact closing trade */
proc sql;
    create table out.ctrade_&yyyy.&mm. as
        select a.date, time_m, a.sym_root, a.sym_suffix,
            c_official, cex, cprc, csize, tr_seqnum, tr_scond, tr_source
        from _i_&yyyy.&mm. a
        inner join _t_&yyyy.&mm. b
            on a.date = b.date
            and a.sym_root = b.sym_root
            and a.tr_seqnum_close = b.tr_seqnum
        order by date, sym_root;
quit;
```

### NBBO Midpoint at Intervals

Compute midpoint snapshots at fixed intervals (e.g., every 15 minutes) using hash objects for deduplication:

```sas
libname taqmsec (taqmsec '/wrds/nyse/sasdata/wrds_taqms_nbbo') inencoding=asciiany;

%MACRO MID(yyyy=, m=, symfilter=sym_suffix='',
    start_time='09:00:00't, end_time='16:00:00't, int=15);
  %let mm = %sysfunc(putn(&m., z2.));
  %do d = 1 %to 31;
    %let dd = %sysfunc(putn(&d., z2.));
    %if %sysfunc(exist(taqmsec.complete_nbbo_&yyyy.&mm.&dd.)) %then %do;
      /* Compute interval-level midpoint */
      data _m_&yyyy.&mm.&dd. / view=_m_&yyyy.&mm.&dd.;
          set taqmsec.complete_nbbo_&yyyy.&mm.&dd.;
          TIME_&int. = floor(int(TIME_M) - mod(int(TIME_M), &int.*60)) + &int.*60;
          MID = (BEST_BID + BEST_ASK) / 2;
          format time_&int. time5.;
          where &symfilter. and sym_root
              and time_m ge &start_time. - &int.*60
              and time_m le &end_time. + &int.*60;
      run;

      /* Hash: keep last observation per symbol × interval */
      data _null_;
          declare hash h(dataset:"_m_&yyyy.&mm.&dd.",
              ordered:'Y', duplicate:'r');
          h.definekey('SYM_ROOT', "TIME_&int.");
          h.definedata('DATE', 'SYM_ROOT', "TIME_&int", 'TIME_M', 'MID');
          h.definedone();
          h.output(dataset: "_mid_&yyyy.&mm.&dd.");
          stop;
          if 0 then do; set &syslast.; output; end;
      run;

      /* Transpose: one row per symbol-day, columns per interval */
      proc transpose data=_mid_&yyyy.&mm.&dd.
          out=mid_&yyyy.&mm.&dd. prefix=MID_;
          by date sym_root;
          id time_&int.;
          var mid;
      run;
    %end;
  %end;
  data out.mid_&yyyy.&mm.;
      set mid_&yyyy.&mm.:;
  run;
%MEND;
```

### VWAP at Intervals

Compute volume-weighted average price in time bins using hash accumulators:

```sas
%MACRO VWAP(yyyy=, m=, symfilter=sym_suffix='',
    timefilter=('09:00't<=time_m<='10:30't or '15:00't<=time_m<='16:30't));
  %let mm = %sysfunc(putn(&m., z2.));
  %do d = 1 %to 31;
    %let dd = %sysfunc(putn(&d., z2.));
    %if %sysfunc(exist(taqmsec.wct_&yyyy.&mm.&dd.)) %then %do;
      data _null_;
          length SYM_ROOT $6. TIME_15 8. DATE 8.;
          if _N_ = 1 then do;
              declare hash h(ordered:'Y');
              h.definekey('SYM_ROOT', 'TIME_15');
              h.definedata('DATE', 'SYM_ROOT', 'TIME_15', 'DVOL', 'VOL', 'VWAP');
              h.definedone();
              call missing(DATE, SYM_ROOT, TIME_15, DVOL, VOL, VWAP);
          end;
          do until (end);
              set taqmsec.wct_&yyyy.&mm.&dd. end=end;
              where &symfilter. and &timefilter.;
              TIME_15 = floor(int(TIME_M) - mod(int(TIME_M), '00:15't));
              format time_15 time5.;
              if h.find() ne 0 then do;
                  call missing(DVOL, VOL, VWAP);
                  h.add();
              end;
              else do;
                  DVOL + (PRICE * SIZE);
                  VOL + (SIZE);
                  if VOL > 0 then VWAP = DVOL / VOL;
                  h.replace();
              end;
          end;
          h.output(dataset: "_vwap_&yyyy.&mm.&dd.");
      run;

      /* Shift interval label to end-of-interval */
      data _vwap2_&yyyy.&mm.&dd. / view=_vwap2_&yyyy.&mm.&dd.;
          set _vwap_&yyyy.&mm.&dd.;
          TIME_15 = TIME_15 + '00:15't;
      run;

      proc transpose data=_vwap2_&yyyy.&mm.&dd.
          out=vwap_&yyyy.&mm.&dd.(drop=_:) prefix=VWAP_;
          by date sym_root;
          id time_15;
          var VWAP;
      run;
    %end;
  %end;
  data out.vwap_&yyyy.&mm.;
      set vwap_&yyyy.&mm.:;
  run;
%MEND;
```

### Closing/Opening Auction Trades

Identify auction trades using trade condition codes and tape-exchange routing:

```sas
%macro auction_month(yyyy=, m=);
  %let mm = %sysfunc(putn(&m., z2.));
  %do d = 1 %to 31;
    %let dd = %sysfunc(putn(&d., z2.));
    %if %sysfunc(exist(taqmsec.ctm_&yyyy.&mm.&dd.))
    and %sysfunc(exist(taqmsec.mastm_&yyyy.&mm.&dd.)) %then %do;

      /* Load master with column-name compatibility */
      data _m_&yyyy.&mm.&dd.;
          LENGTH _SYM_ROOT SYMBOL_ROOT SYM_ROOT $6.
                 _SYM_SUFFIX SYM_SUFFIX SYMBOL_SUFFIX $10.;
          set taqmsec.mastm_&yyyy.&mm.&dd.;
          _SYM_ROOT = COALESCEC(SYMBOL_ROOT, SYM_ROOT,
                                scan(SYMBOL_15, 1, ' '), '');
          _SYM_SUFFIX = COALESCEC(SYMBOL_SUFFIX, SYM_SUFFIX,
                                  scan(SYMBOL_15, 2, ' '), '');
          rename _SYM_ROOT = SYM_ROOT _SYM_SUFFIX = SYM_SUFFIX;
          drop sym_:;
      run;
      proc sort data=_m_&yyyy.&mm.&dd. nodupkey;
          by sym_root sym_suffix;
      run;

      /* Merge master (for tape) with trades filtered to auction conditions */
      data auction_&yyyy.&mm.&dd.;
          retain _TAPE '';
          length _TAPE $1.;
          set _m_&yyyy.&mm.&dd.(in=a keep=sym_root sym_suffix cusip tape date)
              taqmsec.ctm_&yyyy.&mm.&dd.(in=b
                  where=(prxmatch('/[6OMQ]/', tr_scond)
                         and EX in ('T', 'N', 'Q')));
          by sym_root sym_suffix;
          if first.sym_root then _TAPE = tape;
          if missing(tape) then tape = _tape;
          drop _tape;
          if b then do;
              /* Tape A (NYSE-listed): CTA or NYSE source */
              if tape = 'A' then do;
                  if TR_SOURCE = 'C' and EX = 'N' then output;
                  if TR_SOURCE = 'N' and EX = 'T' then output;
              end;
              /* Tape B (NYSE ARCA/regional): ARCA */
              if tape = 'B' then do;
                  if EX = 'T' then output;
              end;
              /* Tape C (NASDAQ-listed): NASDAQ */
              if tape = 'C' then do;
                  if EX = 'Q' then output;
              end;
          end;
      run;
    %end;
  %end;
  data out.auction_&yyyy.&mm.;
      set auction_&yyyy.&mm.:;
  run;
%mend;
```

**Trade condition codes for auctions:**
- `6` — Opening/closing trade
- `O` — Opening trade
- `M` — Market Center Official Close
- `Q` — Market Center Official Open

**Tape–Exchange routing** ensures auction trades come from the listing exchange:

| Tape | Listed Exchange | Valid Sources |
|------|----------------|---------------|
| A | NYSE | `TR_SOURCE='C', EX='N'` or `TR_SOURCE='N', EX='T'` |
| B | NYSE ARCA | `EX='T'` |
| C | NASDAQ | `EX='Q'` |

---

## SGE Job Patterns for TAQ

TAQ processing is inherently year-month parallel. Two patterns:

### Array Jobs (IID — year-level)

```bash
#!/bin/bash
#$ -N bank_pin_taq
#$ -cwd
#$ -j y
#$ -t 2003-2024

mkdir -p logs
year=$SGE_TASK_ID
sas -nodms -rsasuser -noovp -nosyntaxcheck -nonews \
    -sysparm $year data.sas \
    -log logs/data-$year.log -print logs/data-$year.lst
```

### Manual Submission Loop (raw ticks — year-month)

```bash
#!/bin/bash
# Submit one job per year-month
for y in $(seq 2012 2020); do
    for m in $(seq 1 12); do
        qsub -N close_${y}_${m} mid.sh $y $m
    done
done
```

**Shell wrapper pattern** (year-month sysparm):

```bash
#!/bin/bash
#$ -cwd
#$ -j y
sas -sysparm $1-$2 mid.sas -log logs/mid-$1-$2.log -print logs/mid-$1-$2.lst
```

The SAS script parses the sysparm:

```sas
%let yyyy = %scan(&sysparm., 1, '-');
%let m = %scan(&sysparm., 2, '-');
```

### Day-Level Existence Checks

Raw tick files are daily (`ctm_YYYYMMDD`, `complete_nbbo_YYYYMMDD`). Loop over days 1–31 and check existence:

```sas
%do d = 1 %to 31;
    %let dd = %sysfunc(putn(&d., z2.));
    %if %sysfunc(exist(taqmsec.ctm_&yyyy.&mm.&dd.)) %then %do;
        /* process this day */
    %end;
%end;
```

This handles months with fewer than 31 days and missing trading days (weekends, holidays).

---

## Common Derived Variables

| Variable | Formula | Description |
|----------|---------|-------------|
| `y_e` (OIB) | `divide(n_buys - n_sells, n_buys + n_sells)` | Order imbalance ratio |
| `CCPrc` | `abs(coalesce(prc, cprc, cprc2))` | Closing price (CRSP fallback to TAQ) |
| `mid_after_open` | `(oprice + fprice) / 2` | Midpoint after market open |
| `r_d` | `(vw_price_m - mid_after_open + divamt) / mid_after_open` | Intraday return |
| `r_o` | `(next_open_mid - vw_price_m) / mid_after_open` | Overnight return |
| `VWAP` | `sum(price × size) / sum(size)` | Volume-weighted average price |
| `MID` | `(best_bid + best_ask) / 2` | NBBO midpoint |
| `turn` | `n_buys + n_sells` | Daily turnover (trade count) |

---

## Data Volume Notes

| Data Type | Approximate Size |
|-----------|-----------------|
| Single year IID (daily aggregates) | ~100K–500K rows |
| Single month raw trades (`ctm_YYYYMM`) | ~500M–2B rows |
| Single day NBBO (`complete_nbbo_YYYYMMDD`) | ~50M–200M rows |
| Full IID panel (1993–2024, merged with CRSP) | ~50M rows |

Raw tick processing is I/O-bound. Use hash objects (not PROC SQL joins) for tick-level aggregation — they stream through data in a single pass.

### Processing benchmarks (one day, single SGE task)

Measured on WRDS `all.q` (SAS 9.4 M8), interleaving `cqm` (quotes) + `ctm` (trades) in one
`by sym_root sym_suffix time_m` pass with an exchange-keyed hash for the cross-venue best,
Holden-Jacobsen quote cleaning, and a per-trade protected-NBBO trade-through calc (rule611
`scale_B_full.sas` / `scale_B2.sas`):

| Scope (one trading day) | Wall time | Peak vmem (`maxvmem`) | Notes |
|-------------------------|-----------|-----------------------|-------|
| **Full universe** (all non-test common NMS symbols) | **~17 min** (~1030 s) | **~3.7 GB** | Full `cqm` scan (**~2.33B** quote rows/day) + `ctm` (**~127M** trade rows/day); ~40M per-trade output rows spill to WORK |
| **Symbol-filtered subset** (~450 symbols, `sym_root in (…)`) | **~105 s** | **~1.0 GB** | ~85M `cqm` + ~5M `ctm` rows read after the symbol + 09:30–16:00 filter |

*(Reference row counts, one Dec-2025 trading day: `cqm` ≈ 2.33B, `ctm` ≈ 127M — quotes outnumber trades ~18:1, so the `cqm` scan dominates wall time.)*

Takeaways for sizing SGE jobs:
- **RAM is modest** — the hashes are tiny (≤15-venue quote hash + a symbol→stratum hash);
  the footprint is dominated by SAS WORK buffers and the per-trade intermediate, **not**
  in-memory state. **`m_mem_free=4G` is ample for a full-universe day; 2G risks OOM only
  because of the ~40M-row WORK set.** Switch to an accumulator hash (aggregate in the data
  step, output a tiny daily summary — no big WORK set) to run a full day in **<1 GB**.
- **Time scales with the `cqm` row count scanned**, so a `sym_root in (&list)` WHERE or a
  master-file pre-filter (drop test symbols, restrict to the day's universe) is the biggest
  lever — a ~450-symbol subset is ~10× faster than the full universe.
- **A full Q4 (64 trading days) as an SGE array** (`-t 1-92`, non-trading days self-skip via
  `%sysfunc(exist(...))`) drains in ~2–4 h wall-clock at the ~6–16-slot cap; per-day summaries
  then combine in seconds.

---

## Key Gotchas

| Issue | Solution |
|-------|----------|
| NBBO files not in default taqmsec libname | Add `/wrds/nyse/sasdata/wrds_taqms_nbbo` to libname |
| Master file column names changed over time | Use `COALESCEC(SYMBOL_ROOT, SYM_ROOT, scan(SYMBOL_15, 1, ' '))` |
| Missing matches at year boundaries | Load ±1 year of master files |
| WRDS IID access denied for certain years | Check subscription; 2009 often restricted |
| Monthly vs daily file naming | IID: yearly. Raw trades: monthly or daily. NBBO: daily. |
| Legacy vs millisecond variable names differ | Rename in merge step to consistent names (`n_buys`, `n_sells`, etc.) |
| SAS `divide()` vs `/` for OIB | `divide()` returns missing for 0/0 instead of ERROR |
| `inencoding=asciiany` required | TAQ files may contain non-UTF8 characters |
