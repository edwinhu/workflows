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

`complete_nbbo` (and `nbbom`, `wct.nbb/nbo`) are **odd-lot-inclusive** — the best price across all displayed quotes regardless of size. **None of the WRDS NBBO files is the round-lot *protected* NBBO** (the Reg NMS Rule 611 quote). If you need the round-lot protected quote, **compute it from `cqm`** restricted to displayed size ≥ round lot (best across venues), via an exchange-keyed hash. Sizes in `cqm`/`nbbom` are UOT — multiply by `mastm.UOT` for shares.

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
