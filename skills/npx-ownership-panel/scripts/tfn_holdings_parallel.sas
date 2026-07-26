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

proc sort data=tfn_holdings nodupkey;
    by wficn rqdate cusip8;
run;

/* Save fund-level detail */
data out.tfn_holdings_&year_start._&year_end.;
    set tfn_holdings;
run;

%put NOTE: Fund-level holdings saved. Starting aggregation...;

/* --- Step 4: CUSIP -> PERMNO mapping --- */
proc sql;
    create table cusip_permno as
        select distinct substr(ncusip,1,6) as cusip6 length=6, permno
        from crsp.msenames
        where ncusip is not null;
quit;

/* --- Step 5: Map holdings to PERMNO --- */
data holdings_permno;
    if _n_ = 1 then do;
        declare hash hc(dataset: "cusip_permno");
        hc.defineKey("cusip6");
        hc.defineData("permno");
        hc.defineDone();
        call missing(permno);
    end;
    set tfn_holdings;
    cusip6 = substr(cusip8, 1, 6);
    if hc.find() = 0;
    passive_shares = shares * passive;
    index_shares = shares * pure_index;
run;

/* --- Step 6: Get shares outstanding from CRSP MSF --- */
proc sql;
    create table msf_qtr as
        select permno,
               intnx('quarter', date, 0, 'E') as qtr format yymmddn8.,
               shrout * 1000 as tso
        from crsp.msf
        where date between "01jan&year_start."d and "31dec&year_end."d
        and shrout > 0
        group by permno, calculated qtr
        having date = max(date);
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
