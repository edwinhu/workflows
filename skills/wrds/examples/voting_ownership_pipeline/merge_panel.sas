/* merge_panel.sas — Merge meetings + inst_own + index_own, compute pivotalness
 *
 * Prereqs: autoexec.sas loaded (provides libnames: out)
 *          out.meetings (from build_meetings.sas)
 *          out.inst_own (from build_inst_own.sas)
 *          out.mf_own_* (from tfn_holdings_parallel.sas, concatenated below)
 *          ~/sas/MERGE_ASOF.sas
 *
 * Output:  out.pass (merged panel with pivotalness indicators)
 */

/* --- Concatenate parallel MF ownership outputs --- */
data index_own;
    set out.mf_own_:;
run;

proc sort data=index_own nodupkey; by qtr permno; run;

/* Rename to match original variable names */
data out.index_own;
    set index_own;
    rqdate = qtr;
    format rqdate yymmddn8.;
    drop qtr;
run;

proc sort data=out.index_own nodupkey; by rqdate permno; run;

/* --- Sort inputs for MERGE_ASOF --- */
proc sort data=out.inst_own;  by permno rdate;                     run;
proc sort data=out.index_own; by permno rqdate;                    run;
proc sort data=out.meetings;  by permno recorddate meetingdate;    run;

/* --- Create merge views with transformations --- */
data _meetings / view=_meetings;
    set out.meetings;
run;

data _inst_own / view=_inst_own;
    set out.inst_own;
    recorddate = rdate;
    if IOR > 1.2 then delete;
    IOR = min(max(IOR,0.0),1.0)*100;
run;

data _index_own / view=_index_own;
    set out.index_own;
    recorddate = rqdate;
    MF_PCT = 100 * MF_PCT;
    PASSIVE_PCT = 100 * PASSIVE_PCT;
    INDEX_PCT = 100 * INDEX_PCT;
run;

/* --- As-of merges --- */
%INCLUDE "~/sas/MERGE_ASOF.sas";

%MERGE_ASOF(a=_meetings, b=_inst_own,
    merged=pass1,
    idvar=permno,
    datevar=recorddate,
    num_vars=numowners io_total ioc_hhi me ior);

%MERGE_ASOF(a=pass1, b=_index_own,
    merged=pass2,
    idvar=permno,
    datevar=recorddate,
    num_vars=num_mf_owners mf_total passive_total pure_index_total mf_pct passive_pct index_pct);

/* --- Pivotalness indicators --- */
data out.pass;
    set pass2;
    inst_pivotal = abs(forpct-50) <= ior;
    mf_pivotal = abs(forpct-50) <= mf_pct;
    passive_pivotal = abs(forpct-50) <= passive_pct;
    index_pivotal = abs(forpct-50) <= index_pct;
run;

proc contents data=out.pass order=varnum; run;

proc sql;
    select count(*) as nobs format comma12.,
           count(distinct permno) as n_permnos format comma12.
    from out.pass;
quit;

%put NOTE: merge_panel complete;
