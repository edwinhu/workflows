/* build_inst_own.sas — 13-F institutional ownership from THOMSON S34 (FALLBACK).
 *
 * ============================ READ THIS FIRST ============================
 * THIS IS NOT THE CANONICAL BUILDER. `build_inst_own.py` (SEC EDGAR 13F) is.
 * This path exists for the pre-2013 window and for cross-checking; Thomson S34
 * decayed after 2013 and carries defects WRDS says have no clean fix (D1 split
 * mis-adjustment, D3 coverage collapse). Prefer EDGAR. Never blend the two.
 *
 * DO NOT "FIX" THE cfacshr JOIN TO rdate. Step 4 joins on `a.fdate = b.qdate`
 * and that is CORRECT HERE. Thomson pre-adjusts SHARES from rdate to fdate --
 * fdate is the vintage, and per the WRDS Overview it is "the date Thomson's
 * share adjustments are made to" (reference D2). Shares therefore arrive on the
 * fdate basis, so completing the conversion to a current-share basis requires
 * cfacshr AT fdate. Using rdate here would double-count the roll-forward.
 *
 * The opposite is true for EDGAR, which is AS-FILED and not pre-adjusted: there
 * the correct factor is cfacshr at rdate, because fdate can be far later than
 * the reporting period on a late filing or a carried-forward vintage, and a
 * split in between would apply a factor from a date the shares were not held.
 * build_inst_own.py does exactly that. The two are not inconsistent -- they
 * match their sources.
 * =========================================================================
 *
 * Prereqs: autoexec.sas loaded (provides libnames: out, tfn, crsp)
 *          /wrds/lib/sas/crspmerge.sas
 *
 * Output:  out.inst_own (permno-quarter panel with IOR, DBREADTH, IOC_HHI)
 *
 * Full logic from 1-make.sas lines 241-465:
 *   - crspmerge for CRSP monthly
 *   - cfacshr/cfacpr share adjustment
 *   - S34 first vintage extraction
 *   - First/Last report markers for DBREADTH
 *   - IO metrics: NumOwners, IO_TOTAL, IOC_HHI, DBREADTH
 *   - Final IOR with CRSP market data
 */

%let year1 = 2002;
%let year2 = 2024;
%let begdate = 01JAN&year1.;
%let enddate = 31DEC&year2.;

/* --- Step 1: CRSP monthly data --- */
%let sfilter = (shrcd in (10,11));
%let msfvars = prc ret shrout cfacpr cfacshr;
%let msevars = ncusip exchcd shrcd;
%include "/wrds/lib/sas/crspmerge.sas";
%crspmerge(s=m,start=&begdate,end=&enddate,sfvars=&msfvars,sevars=&msevars,filters=&sfilter);

data crsp_m; format QDATE date9.;
    set crsp_m;
    QDATE = INTNX('QTR',date,0,'E');
    DATE = INTNX("MONTH",date,0,"E");
    P=abs(prc);
    if cfacpr > 0 then P = P/cfacpr;
    TSO=shrout*1000;
    if cfacshr > 0 then TSO=TSO*cfacshr;
    if TSO<=0 then TSO=.;
    ME = P*TSO/1000000;
    label P = "Price at Period End, Adjusted";
    label TSO = "Total Shares Outstanding, Adjusted";
    label ME = "Market Capitalization, x$1m";
    drop prc cfacpr shrout exchcd shrcd ret;
    format ret percentn8.4 ME P dollar12.3 TSO comma12.;
run;

data crsp_m;
    set crsp_m;
    by permno qdate date;
    if last.qdate;
    drop date;
run;

/* --- Step 2: S34 first vintage --- */
proc sql;
    create table First_Vint as
        select distinct rdate, fdate, mgrno, mgrname
        from tfn.s34type1
        group by mgrno, rdate
        having fdate=min(fdate)
        order by mgrno, rdate;
quit;

data First_Vint;
    set First_Vint;
    by mgrno rdate;
    length First_Report 3;
    First_Report = (first.mgrno or intck("QTR",lag(rdate),rdate)>1);
run;

proc sort data=First_Vint nodupkey; by mgrno descending rdate; run;

data First_Vint;
    set First_Vint;
    by mgrno descending rdate;
    length Last_Report 3;
    Last_Report = (first.mgrno or intck("QTR",rdate,lag(rdate))>1);
    if ("&begdate"d <= rdate <="&enddate"d);
run;

proc sql undo_policy=none;
    create table First_Vint as
        select distinct *, count(mgrno) as NumInst
        from First_Vint
        group by rdate
        order by fdate, mgrno;
quit;

/* --- Step 3: Holdings with share adjustment --- */
data Holdings_v1 / view=Holdings_v1;
    merge First_Vint(in=a drop=mgrname)
          tfn.s34type3(in=b drop=type sole shared no);
    by fdate mgrno;
    if a and b and shares>0;
run;

proc sql;
    create view Holdings_v2 as
        select distinct a.rdate, a.fdate, a.mgrno, a.NumInst,
            a.first_report, a.last_report, b.permno, a.shares
        from Holdings_v1 as a,
            (select distinct ncusip, permno from crsp.msenames
             where not missing(ncusip)) as b
        where a.cusip=b.ncusip;
quit;

/* --- Step 4: Adjust shares using CRSP cfacshr AT THE VINTAGE DATE (fdate) ---
 * Deliberate, and correct for Thomson only. See the header. Thomson has already
 * rolled shares forward from rdate to fdate; cfacshr(fdate) finishes the job.
 * EDGAR is as-filed and uses rdate instead -- see build_inst_own.py. */
proc sql;
    create table Holdings as
        select distinct a.rdate, a.mgrno, a.NumInst, a.first_report, a.last_report,
            a.permno, a.shares*b.cfacshr as shares_adj label = "Adjusted Shares Held",
            a.shares*b.cfacshr*abs(b.p) as AUM
        from Holdings_v2 as a, crsp_m as b
        where a.permno=b.permno and a.fdate = b.qdate;
quit;

proc sort data=Holdings nodupkey; by permno rdate mgrno; run;
proc sort data=crsp_m   nodupkey; by permno qdate;       run;

/* --- Step 5: IO metrics at security level --- */
proc means data=Holdings noprint;
    where shares_adj>0;
    by permno rdate;
    var shares_adj first_report;
    output out=IO_Metrics (drop=_freq_ _type_)
           n=NumOwners max(NumInst)=NumInst
           sum(first_report)=NewInst sum(last_report)=OldInst
           sum(shares_adj)=IO_TOTAL USS(shares_adj)=IO_SS;
run;

/* DBREADTH: Lehavy and Sloan (2008) */
data IO_Metrics;
    set IO_Metrics;
    by permno rdate;
    IOC_HHI = IO_SS/(IO_TOTAL**2);
    DBREADTH = ( (NumOwners - NewInst) - lag(NumOwners-OldInst) ) / lag(NumInst);
    if first.permno then DBREADTH=.;
    label NumOwners  = "Breadth - # of 13-F Institutional Owners";
    label IO_TOTAL = "Institutional Ownership, Total - Adjusted";
    label IOC_HHI   = "IO Concentration - Herfindahl- Hirschman Index";
    label DBREADTH = "Change in IO Breadth, Percent";
    drop NumInst IO_SS NewInst OldInst;
run;

/* --- Step 6: Join with CRSP market data --- */
data IO_TimeSeries;
    merge IO_Metrics(in=a) crsp_m (in=b rename=(qdate=rdate));
    by permno rdate;
    if b and TSO>0;
    IOR = IO_TOTAL/TSO;
    if missing(IOR) then IOR=0;
    IO_MISSING = (not a);
    IO_G1      = (IOR>1);
    label IOR = "Institutional Ownership Ratio";
    label IO_MISSING = "Missing (or NA) 13-F Data";
    label IO_G1 = "IOR % > 1";
    drop CFACSHR;
    format IO_TOTAL NumOwners comma16. IOR DBREADTH IOC_HHI percentn8.2;
    if a and b then output;
run;

/* --- Save --- */
proc sort data=IO_TimeSeries nodupkey; by rdate permno; run;

data out.inst_own;
    set IO_TimeSeries;
run;

/* --- Cleanup --- */
proc sql;
    drop table crsp_m, first_vint, holdings, IO_Metrics;
    drop view holdings_v1, holdings_v2;
quit;

%put NOTE: build_inst_own complete;
