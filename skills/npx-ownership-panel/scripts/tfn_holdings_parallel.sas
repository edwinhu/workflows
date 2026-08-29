/* ===================================================================== */
/* TFN Holdings Parallel Processing                                      */
/* Assumes mfl2, mfl3 already exist in libname out, autoexec loaded      */
/* Usage: sas -sysparm year_start-year_end tfn_holdings_parallel.sas     */
/*                                                                       */
/* Outputs: out.mf_own_YYYY_YYYY  (permno-quarter aggregated)            */
/*          out.tfn_holdings_YYYY_YYYY  (fund-level detail, optional)    */
/* ===================================================================== */

%let year_start=%scan(&sysparm.,1,'-');
%let year_end=%scan(&sysparm.,2,'-');

/* Open-code %IF/%THEN is a 9.4M5+ feature with restrictions on what may follow
 * %THEN, and on this WRDS SAS deployment it fails outright with
 *     ERROR: Expected %DO not found.
 * Both validations below therefore live inside a macro. As shipped this script
 * carried them in open code, which means it errored out before reading a single
 * row — the mf_own_* outputs were never produced and merge_panel's prerequisite
 * gate is what surfaced it. */
%macro _tfn_setup;
    %if %superq(year_start) =  or %superq(year_end) =  %then %do;
        %put ERROR: Must specify year_start-year_end in sysparm parameter;
        %put ERROR: Example: -sysparm 2003-2008;
        %abort cancel;
    %end;
%mend;
%_tfn_setup

%put NOTE: Processing TFN holdings for years &year_start to &year_end;
%put NOTE: Job started at %sysfunc(datetime(),datetime19.);

/* --- Step 1: Read pre-split S12 partition (from split_s12.sas) --- */
/* Falls back to full tfn.s12 scan if partition doesn't exist */
%let s12_part = s12_&year_start._&year_end.;
%let use_partition = 0;
%macro _tfn_probe;
    %if %sysfunc(exist(out.&s12_part.)) %then %let use_partition = 1;
%mend;
%_tfn_probe

%macro load_s12;
    %if &use_partition. %then %do;
        %put NOTE: Reading pre-split partition out.&s12_part.;
        data tfn_s12_subset;
            set out.&s12_part.;
            keep rdate fdate fundno cusip shares fundname;
        run;
    %end;
    %else %if not %sysfunc(putc(%superq(S12_ALLOW_FULLSCAN), $1.)) %then %do;
        /* A missing partition almost always means the S12 array lost a task to a
         * REFUSED POSTGRESQL CONNECTION (per-role cap is 7). Silently falling back
         * to a full tfn.s12 scan produces plausible output from a 47.4 GB scan and
         * hides the fact that a partition is gone — the ownership columns end up
         * built over a different universe than the one the array intended.
         * Fail instead. Set S12_ALLOW_FULLSCAN=1 to opt back in deliberately. */
        %put ERROR: Partition out.&s12_part. not found.;
        %put ERROR- The S12 array did not produce this range. Do NOT full-scan around it —;
        %put ERROR- re-run the task: qsub -t <line> -tc 6 -o logs/ -j y run_s12_array.sh;
        %put ERROR- To override deliberately: %nrstr(%let) S12_ALLOW_FULLSCAN=1;
        data _null_; abort abend; run;
    %end;
    %else %do;
        %put WARNING: Partition out.&s12_part. not found — S12_ALLOW_FULLSCAN set,;
        %put WARNING- falling back to a full tfn.s12 scan. This reads 47.4 GB.;
        proc sql;
            create table tfn_s12_subset as
                select a.rdate, a.fdate, a.fundno, a.cusip, a.shares, a.fundname
                from tfn.s12 a
                where year(a.rdate) ge &year_start.
                and year(a.rdate) le &year_end.
                and a.shares > 0;
        quit;
    %end;
%mend;
%load_s12;

proc sql;
    create index rdate_fundno on tfn_s12_subset(rdate, fundno);
quit;

/* --- wficn in this leg: S12-only, three jobs ---
 * wficn appears here solely because the holdings source is S12. It (a) bridges
 * S12 fundno to crsp_fundno so crsp.portnomap can supply index_fund_flag/et_flag,
 * (b) forms the (wficn, rqdate, cusip8) dedup key, (c) supplies
 * count(distinct wficn) as num_mf_owners. All three are available from
 * crsp_portno if the source were crsp.holdings: that moves coverage from 87.33%
 * to 93.54% of the 229,787,146 mutual-fund-universe N-PX vote rows and removes
 * the 2017Q4-2020Q2 MFLINKS soft spot. Gating that switch: crsp.holdings' start
 * date vs the 2003-07-01 panel start, plus a shares reconciliation between the
 * two sources.
 */

/* --- Step 2: MFLINK portno mapping for this year range --- */
proc sql;
    create table mflink_portno as
        select distinct
        b.wficn, b.crsp_fundno,
        c.crsp_portno,
        min(a.rdate) as linkb format yymmddn8.,
        max(a.rdate) as linke format yymmddn8.,
        c.index_fund_flag,
        c.et_flag
        from tfn_s12_subset a
        inner join out.mfl3 b
        on a.fundno=b.fundno
        and a.rdate=b.rdate
        inner join crsp.portnomap c
        on b.crsp_fundno=c.crsp_fundno
        and a.rdate ge c.begdt
        and a.rdate le c.enddt
        where b.wficn is not null
        and c.crsp_fundno is not null
        group by b.wficn, b.crsp_fundno, c.crsp_portno;
quit;

/* --- Step 3: Main holdings join --- */
proc sql;
    create table tfn_holdings as
        select distinct
        intnx('quarter',b.rdate,0,'E') as rqdate format yymmddn8.,
        c.wficn,
        a.cusip as cusip8 length=8,
        a.shares,
        /* rdate/fdate are carried ONLY to order the dedup below. Without them
         * `select distinct` collapses agreeing vintages and leaves the
         * disagreeing ones with no basis for choosing between them. */
        a.rdate,
        a.fdate,
        (c.index_fund_flag^='' or
        (prxmatch('/Index|Idx|Indx|Ind |Russell|S \& P|S and P|S\&P|SP|Dow|DJ|MSCI|Bloomberg|KBW|Nasdaq|NYSE|STOXX|FTSE|Wilshire|Morningstar|[14569]00|(10|15|20|50)00/i',
        a.fundname)>0)) as passive,
        c.index_fund_flag='D' as pure_index
        from tfn_s12_subset a
        inner join out.mfl2 b
        on a.fundno=b.fundno
        and a.rdate=b.rdate
        inner join mflink_portno c
        on b.wficn=c.wficn
        and a.rdate ge c.linkb
        and a.rdate le c.linke
        where b.wficn is not null;
quit;

proc sql; drop table tfn_s12_subset; quit;

/* --- Step 3b: DETERMINISTIC dedup — keep the vintage closest to the report date
 *
 * One Rdate can carry several Fdates (delayed or carried-forward filing); WRDS
 * Research, "Note on Splits in TR Mutual Funds and 13F: S12 and S34", case 1b.
 * Where those rows AGREE on shares, `select distinct` above already collapsed
 * them and nothing here matters. Where they DISAGREE, the difference is
 * typically Thomson's split re-adjustment applied to a carried-forward row —
 * measured on the 2021 partition, 36,966 of 20,358,667 (rdate, fundno, cusip)
 * triples disagree, and the hi/lo ratios land on split factors: 5,264 at ~2x,
 * 3,337 at ~3x, 70 at ~7x and 22 at ~49x — that last being exactly the 7x7
 * double adjustment the note documents for Apple.
 *
 * This used to be `by wficn rqdate cusip8` with `shares` NOT in the sort key, so
 * which of a correct and a mis-adjusted value survived was decided by whatever
 * order the join happened to emit. Same shape as the (permno, rdate, cik)
 * coin-flip in leg 2, at 1/100th the scale.
 *
 * Ordering by fgap keeps the LEAST carried-forward vintage: the row whose fdate
 * is closest to its rdate is the one least exposed to the note's re-adjustment
 * errors, which accumulate with each carry-forward. fdate and shares complete
 * the key so the order is total and the result cannot move between runs. */
data tfn_holdings;
    set tfn_holdings;
    fgap = fdate - rdate;
    label fgap = "days from report date to filing vintage";
run;

proc sql noprint;
    select count(*), sum(n_sh > 1)
      into :n_grp trimmed, :n_amb trimmed
      from (select wficn, rqdate, cusip8, count(distinct shares) as n_sh
              from tfn_holdings group by wficn, rqdate, cusip8);
quit;
%put NOTE: S12DEDUP groups=&n_grp. ambiguous_shares=&n_amb.;

proc sort data=tfn_holdings;
    by wficn rqdate cusip8 fgap fdate shares;
run;
/* NOT `proc sort nodupkey by wficn rqdate cusip8` — that RE-SORTS on the short
 * key and would throw away the fgap ordering unless SAS's sort happened to be
 * stable, which is exactly the kind of assumption this fix exists to remove.
 * Taking the first row of each group off the fully-ordered dataset does not
 * depend on sort stability. */
data tfn_holdings;
    set tfn_holdings;
    by wficn rqdate cusip8;
    if first.cusip8;
run;

/* Save fund-level detail */
data out.tfn_holdings_&year_start._&year_end.;
    set tfn_holdings;
run;

%put NOTE: Fund-level holdings saved. Starting aggregation...;

/* --- Step 4: CUSIP -> PERMNO mapping ---------------------------------------
 * crsp.stksecurityinfohist, not crsp.msenames: the legacy SIZ tables are frozen
 * at 2024-12-31 and will never advance, so every year on them widens the gap
 * against the CIZ tables the rest of the pipeline reads.
 *
 * DELIBERATELY UNFILTERED. Narrowing this to NS/EQTY/COM/Y would drop holdings
 * rather than classify them — the universe filter belongs on the CRSP monthly
 * join, not here.
 *
 * CUSIP8, NOT CUSIP6. cusip6 is ISSUER-level: it maps preferreds and other share
 * classes onto the common permno, which is D9 cause 2 and the reason leg 2
 * disables its own cusip6 fallback. This leg used it anyway, so the three legs
 * did not agree about what a security is.
 *
 * Measured before changing it:
 *   1,047 of 41,348 cusip6 values (2.53%) map to MORE THAN ONE permno
 *   538,703 of 9,170,717 S12 holdings rows in 2020 (5.87%) sit on one
 *   tightening to cusip8 costs 155,259 of those rows — 1.69pp of matched rows
 *
 * So 1.7 points of coverage buys the removal of fan-out risk on 5.9%. It also
 * removes an UNDEFINED CHOICE that was invisible: the hash below takes one
 * permno per key, so every one of those 1,047 collisions was resolved by
 * whichever row the hash happened to load first from an unordered SELECT
 * DISTINCT. Not a tie-break — a coin flip, silently, on 5.87% of holdings.
 *
 * THE MAP IS UNDATED, WHICH AT THIS KEY TURNS OUT NOT TO MATTER. An undated
 * cusip->permno map is what manufactured the duplicates leg 2 had to fix with a
 * dated join, so the same worry applies here — except it is empirically empty:
 * ZERO of 55,046 cusip8 values in crsp.stksecurityinfohist map to more than one
 * permno. A cusip8 identifies a security, and CRSP does not reuse one across
 * permnos. At cusip6 the same count was 1,047. So narrowing the key does not
 * merely shrink the ambiguity, it removes it, and dating this join would buy
 * nothing. Measured rather than assumed, in both directions. */
proc sql;
    create table cusip_permno as
        select distinct substr(cusip,1,8) as cusip8 length=8, permno
        from crsp.stksecurityinfohist
        where cusip is not null;
quit;

/* --- Step 5: Map holdings to PERMNO --- */
data holdings_permno;
    if _n_ = 1 then do;
        declare hash hc(dataset: "cusip_permno");
        hc.defineKey("cusip8");
        hc.defineData("permno");
        hc.defineDone();
        call missing(permno);
    end;
    set tfn_holdings;
    if hc.find() = 0;
    passive_shares = shares * passive;
    index_shares = shares * pure_index;
run;

/* --- Step 6: Shares outstanding from CRSP monthly (CIZ) ---------------------
 * crsp.msf_v2, not crsp.msf: the legacy monthly file is frozen at 2024-12-31, so
 * on it every quarter after that silently produced NO tso row and the mutual-fund
 * ownership percentages for those quarters came out null — the same failure leg 2
 * hit, in the leg next door.
 *
 * `having date = max(date)` takes the LAST month in the quarter, which is the
 * end-of-quarter snapshot this join wants. It is a correlated HAVING over the
 * group, so it states the rule rather than relying on arrival order. */
proc sql;
    create table msf_qtr as
        select permno,
               intnx('quarter', mthcaldt, 0, 'E') as qtr format yymmddn8.,
               shrout * 1000 as tso
        from crsp.msf_v2
        where mthcaldt between "01jan&year_start."d and "31dec&year_end."d
        and shrout > 0
        and sharetype = 'NS' and securitytype = 'EQTY'
        and securitysubtype = 'COM' and usincflg = 'Y'
        group by permno, calculated qtr
        having mthcaldt = max(mthcaldt);
quit;

/* --- Step 7: Aggregate to permno-quarter --- */
proc sql;
    create table mf_own as
        select a.rqdate as qtr format yymmddn8.,
               a.permno,
               count(distinct a.wficn) as num_mf_owners,
               sum(a.shares) as mf_total,
               sum(a.passive_shares) as passive_total,
               sum(a.index_shares) as pure_index_total,
               b.tso,
               min(1, max(0, sum(a.shares) / b.tso)) * 100 as mf_pct,
               min(1, max(0, sum(a.passive_shares) / b.tso)) * 100 as passive_pct,
               min(1, max(0, sum(a.index_shares) / b.tso)) * 100 as index_pct
        from holdings_permno a
        inner join msf_qtr b
        on a.permno = b.permno
        and a.rqdate = b.qtr
        group by a.rqdate, a.permno, b.tso;
quit;

/* --- Save aggregated output --- */
data out.mf_own_&year_start._&year_end.;
    set mf_own;
run;

proc sql;
    select
        "&year_start.-&year_end." as year_range,
        count(*) format comma12. as holdings_obs
    from out.tfn_holdings_&year_start._&year_end.;
    select
        "&year_start.-&year_end." as year_range,
        count(*) format comma12. as mf_own_obs
    from out.mf_own_&year_start._&year_end.;
quit;

/* Clean up WORK */
proc datasets lib=work nolist kill; quit;

%put NOTE: Job completed at %sysfunc(datetime(),datetime19.);
%put NOTE: mf_own_&year_start._&year_end. processing complete;
