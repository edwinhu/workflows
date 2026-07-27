/* merge_panel.sas — CANONICAL. Merge meetings + inst_own + index_own, compute
 * pivotalness, join the N-PX cells.
 *
 * CONSOLIDATED FROM THREE DIVERGENT COPIES (2026-07-26). There were:
 *   mirror scripts/merge_panel.py   — R2 tso convention, ior_raw/ior_capped/
 *                                     ior_net/inst_pivotal_net, split_adjacent,
 *                                     si_missing, dbreadth
 *   mirror sas/merge_panel.sas      — R2 tso convention, no prerequisite gates
 *   skills/.../merge_panel.sas      — the gates, but NO R2 and none of the
 *                                     above columns  <- what the grid ran
 * and the two .sas files were not even the same file. This is the union: the
 * gates from the grid copy, the R2 convention and the CRSP/ISS diagnostic from
 * mirror, the derived columns from the .py.
 *
 * WHY IT MATTERS, and it is not cosmetic. The grid copy took `ior` straight from
 * leg 2, where it is denominated by CRSP `shrout * 1000` — per-permno, a SINGLE
 * SHARE CLASS. ISS `outstandingshare` is COMPANY-WIDE. For dual-class firms
 * (STZ, BRK.B, BF.B, MOG.A, RUSHA) that mismatch inflated implied share counts
 * 5-15x, and every pivotalness flag is derived from those pcts. The correct
 * denominator was already sitting in out.meetings as `tso` and simply went
 * unused, so the panel looked complete and plausible — the same shape as every
 * other defect in this pipeline.
 *
 * R2 (TSO denominator): ior, mf_pct, passive_pct and index_pct are ALL
 * recomputed here from raw totals over ISS tso. The CRSP-denominated values are
 * retained behind a `_crsp` suffix for diagnostics only. Do not reintroduce a
 * pct that divides by CRSP tso.
 *
 *
 * Prereqs: autoexec.sas loaded (provides libnames: out)
 *          out.meetings (from build_meetings.sas)
 *          out.inst_own (from build_inst_own.sas)
 *          out.mf_own_* (from tfn_holdings_parallel.sas, concatenated below)
 *          ~/sas/MERGE_ASOF.sas
 *
 *          out.npx_cells_YYYY (from build_npx.sas via run_npx_array.sh)
 *          out.npx_items      (from stage_npx_link.sas — the shared item frame)
 *
 * Output:  out.pass      grain = itemonagendaid  (item-level ownership panel)
 *          out.pass_npx  grain = (itemonagendaid, block)  <- ANALYSIS-READY
 *
 * out.pass_npx is the file the downstream analysis consumes: the ownership panel
 * with each item's per-block observed For/Against/Abstain split attached. It is
 * produced HERE, on the grid, rather than by joining two downloads locally —
 * shipping the joined result is the entire point of the exercise.
 */

%include "pipeline_config.sas";

/* ==========================================================================
 * PREREQUISITE GATE — runs before anything else touches the data.
 *
 * `qsub -hold_jid` releases a dependent job when its predecessor FINISHES,
 * regardless of exit status. So a leg that died still lets the merge start.
 * Nothing in bash can fix that; the check has to live here, where it can see
 * whether the datasets actually exist. Every invariant this pipeline depends on
 * is in SAS for exactly this reason — a plain `bash run_pipeline.sh` with no
 * harness anywhere must be just as safe as a supervised run.
 * ========================================================================== */
%macro require_prereqs;
    %local missing;
    %let missing = ;

    /* EXISTENCE IS NOT CONTENT. This gate checked exist() alone, and an EMPTY
     * dataset exists. Observed 2026-07-27: leg 5 died on a SQL error, so leg 2's
     * own guard correctly refused to write its CSV, so import_inst_own created
     * out.inst_own with ZERO rows — and this gate passed it. merge_panel then
     * built a complete-looking 2,019,563 x 81 panel with NO institutional
     * ownership in it, and every gate line in the run reported clean:
     *
     *     PREREQ   mf_own_chunks=9 npx_cell_years=21/21 s12_partitions=9/9
     *     UNIVERSE meetings_items=624,162 npx_items=712,466 orphans=0
     *
     * That is precisely the failure this gate exists to prevent, one level down:
     * `hold_jid` releases on COMPLETION not success, so the gate has to check
     * what arrived — and "it is there" was never the question. Row counts are the
     * question. */
    %local n_meet_rows n_io_rows n_item_rows;
    %macro _rows(ds, into);
        %if %sysfunc(exist(&ds.)) %then %do;
            %local dsid;
            %let dsid = %sysfunc(open(&ds.));
            %let &into. = %sysfunc(attrn(&dsid., nlobs));
            %let dsid = %sysfunc(close(&dsid.));
        %end;
        %else %let &into. = -1;
    %mend;
    %_rows(out.meetings,  n_meet_rows)
    %_rows(out.inst_own,  n_io_rows)
    %_rows(out.npx_items, n_item_rows)

    %if &n_meet_rows. < 0 %then %let missing = &missing. out.meetings(absent);
    %else %if &n_meet_rows. = 0 %then %let missing = &missing. out.meetings(EMPTY);
    %if &n_io_rows. < 0 %then %let missing = &missing. out.inst_own(absent);
    %else %if &n_io_rows. = 0 %then %let missing = &missing. out.inst_own(EMPTY);
    %if &n_item_rows. < 0 %then %let missing = &missing. out.npx_items(absent);
    %else %if &n_item_rows. = 0 %then %let missing = &missing. out.npx_items(EMPTY);

    %put NOTE: PREREQ rows meetings=&n_meet_rows. inst_own=&n_io_rows. npx_items=&n_item_rows.;

    /* At least one mutual-fund ownership chunk from tfn_holdings_parallel. */
    %local n_mf;
    proc sql noprint;
        select count(*) into :n_mf trimmed from dictionary.tables
        where libname = 'OUT' and memname like 'MF_OWN%';
    quit;
    %if &n_mf. = 0 %then %let missing = &missing. out.mf_own_*;

    /* EVERY year of the N-PX array. A lost SGE task leaves a hole and the array
     * still reports clean — observed: 20 of 21 outputs, no error anywhere. A
     * silently short panel is the failure mode this whole design exists to
     * prevent, so a missing year is fatal, not a warning. */
    %local y n_cells missing_years;
    %let n_cells = 0;
    %let missing_years = ;
    %do y = &year1. %to &year2.;
        %if %sysfunc(exist(out.npx_cells_&y.)) %then %let n_cells = %eval(&n_cells. + 1);
        %else %let missing_years = &missing_years. &y.;
    %end;

    /* S12 partitions get their own check. A refused PG connection in the S12
     * array leaves a partition missing, which surfaces as an ownership-COLUMN
     * gap rather than a missing item — so the universe assertion below cannot
     * see it and neither can the mf_own count if tfn was allowed to full-scan. */
    %local i r n_s12 want_s12 missing_s12;
    %let i = 1; %let n_s12 = 0; %let want_s12 = 0; %let missing_s12 = ;
    %do %while (%scan(&S12_RANGES., &i., %str( )) ne );
        %let r = %scan(&S12_RANGES., &i., %str( ));
        %let want_s12 = %eval(&want_s12. + 1);
        %if %sysfunc(exist(out.s12_%scan(&r.,1,-)_%scan(&r.,2,-)))
            %then %let n_s12 = %eval(&n_s12. + 1);
            %else %let missing_s12 = &missing_s12. &r.;
        %let i = %eval(&i. + 1);
    %end;
    %if %length(&missing_s12.) > 0 %then %do;
        %put ERROR: S12 partition(s) missing:&missing_s12.;
        %put ERROR- Re-run those tasks: qsub -t <line> -tc 6 -o logs/ -j y run_s12_array.sh;
        %let missing = &missing. out.s12_[&missing_s12.];
    %end;

    /* The concat below names its partitions from S12_RANGES, so a stray MF_OWN%
     * dataset is inert. Say so anyway: an operator reading `mf_own_chunks=11`
     * against a 9-partition config should be told which two are being ignored,
     * not left to wonder whether they went into the panel. */
    %if &n_mf. ne &want_s12. %then %do;
        %put WARNING: &n_mf. MF_OWN%% datasets in the out library but &want_s12. partitions in S12_RANGES.;
        %put WARNING- The concat names its partitions explicitly, so the extras are IGNORED, not stacked.;
        %put WARNING- Clean them up if they are leftovers from an ad-hoc run.;
    %end;

    %put NOTE: PREREQ mf_own_chunks=&n_mf. npx_cell_years=&n_cells./%eval(&year2. - &year1. + 1) s12_partitions=&n_s12./&want_s12.;

    %if %length(&missing_years.) > 0 %then %do;
        %put ERROR: N-PX cell dataset(s) missing for year(s):&missing_years.;
        %put ERROR- Re-run just those years: qsub -t YYYY-YYYY -o logs/ -j y run_npx_array.sh;
        %let missing = &missing. out.npx_cells_[&missing_years.];
    %end;

    %if %length(&missing.) > 0 %then %do;
        %put ERROR: PREREQUISITES MISSING —&missing.;
        %put ERROR- A predecessor job finished without producing its output.;
        %put ERROR- hold_jid releases on COMPLETION, not success, so this gate is;
        %put ERROR- the only thing standing between a dead leg and a wrong panel.;
        data _null_; abort abend; run;
    %end;
    %put NOTE: PREREQ all inputs present;
%mend;
%require_prereqs

/* --- Concatenate parallel MF ownership outputs -------------------------------
 * The partition list comes from S12_RANGES, the SAME list run_pipeline.sh uses to
 * submit the tfn jobs and the gate above uses to check them. It used to be
 * `set out.mf_own_:;` — a bare wildcard, which stacks in ANY dataset whose name
 * starts with MF_OWN. An analysis leaves `mf_own_2021_pre` and `mf_own_2021_a` in
 * the library and 2021 is silently counted three times; the gate reports
 * `mf_own_chunks=11` and nothing says that is wrong, because the gate COUNTS what
 * the wildcard does not CONSTRAIN.
 *
 * Observed: both of those datasets were sitting in the out library from an
 * afternoon's work when this was found. Naming the partitions makes a stray
 * dataset inert instead of load-bearing. */
%macro mf_own_list;
    %local i r;
    %let i = 1;
    %do %while (%scan(&S12_RANGES., &i., %str( )) ne );
        %let r = %scan(&S12_RANGES., &i., %str( ));
        out.mf_own_%scan(&r., 1, -)_%scan(&r., 2, -)
        %let i = %eval(&i. + 1);
    %end;
%mend;

data index_own;
    set %mf_own_list;
run;

proc sort data=index_own nodupkey; by qtr permno; run;

/* Rename to match original variable names, and segregate the CRSP-denominated
 * pcts behind a `_crsp` suffix — they are diagnostics now, not the answer.
 * See the R2 note in the header. */
data out.index_own;
    set index_own (rename=(mf_pct=mf_pct_crsp
                           passive_pct=passive_pct_crsp
                           index_pct=index_pct_crsp
                           tso=tso_crsp));
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

/* IOR/TSO here are CRSP-denominated; keep them as diagnostics under `_crsp`
 * and derive the canonical ior below from io_total / ISS tso. The >1.2 drop
 * stays on the CRSP ratio: it flags broken 13F coverage or CUSIP misalignment
 * at the permno level, which recomputing against ISS tso cannot recover. */
data _inst_own / view=_inst_own;
    set out.inst_own (rename=(IOR=ior_crsp TSO=tso_crsp_inst));
    recorddate = rdate;
    if ior_crsp > 1.2 then delete;
run;

data _index_own / view=_index_own;
    set out.index_own;
    recorddate = rqdate;
run;

/* --- As-of merges --- */
%INCLUDE "~/sas/MERGE_ASOF.sas";

%MERGE_ASOF(a=_meetings, b=_inst_own,
    merged=pass1,
    idvar=permno,
    datevar=recorddate,
    num_vars=numowners io_total ioc_hhi dbreadth me ior_crsp tso_crsp_inst
             io_total_net si_missing split_adjacent cfacshr);

%MERGE_ASOF(a=pass1, b=_index_own,
    merged=pass2,
    idvar=permno,
    datevar=recorddate,
    num_vars=num_mf_owners mf_total passive_total pure_index_total
             mf_pct_crsp passive_pct_crsp index_pct_crsp tso_crsp);

/* --- Canonical pcts from raw totals and ISS tso (R2), then pivotalness ----- */
data out.pass;
    set pass2;

    /* R2. Every ownership pct uses ISS `outstandingshare` (carried into
     * out.meetings as `tso`) as the denominator. */
    if not missing(tso) and tso > 0 then do;
        mf_pct      = min(100, max(0, coalesce(mf_total,0)         / tso * 100));
        passive_pct = min(100, max(0, coalesce(passive_total,0)    / tso * 100));
        index_pct   = min(100, max(0, coalesce(pure_index_total,0) / tso * 100));
        ior         = min(100, max(0, coalesce(io_total,0)         / tso * 100));
        /* The cap above is load-bearing for pivotalness — a lent share carries
         * no vote, so votable ownership cannot exceed 100% — but on its own it
         * HIDES what it caps. Keep the uncapped ratio and a flag beside it, so
         * a parse artifact cannot masquerade as a clean 100.0. */
        ior_raw    = coalesce(io_total,0) / tso * 100;
        ior_capped = (ior_raw > 100);
    end;
    else do;
        mf_pct = .; passive_pct = .; index_pct = .; ior = .;
        ior_raw = .; ior_capped = 0;
    end;

    /* Institutional ownership with securities lending netted out — the measure
     * to use when ownership stands in for VOTING power, since the vote on a
     * lent share belongs to the borrower unless recalled before the record
     * date. Null where short interest did not match, NEVER silently equal to
     * ior. */
    if not missing(tso) and tso > 0 and si_missing = 0 then
        ior_net = min(100, max(0, io_total_net / tso * 100));
    else ior_net = .;

    /* Pivotalness: forpct and the pcts are both on [0,100].
     *
     * NULL WHERE THE OWNERSHIP IS UNKNOWN, NOT 0. These were
     * `<= coalesce(ior,0)`, which turns "we have no denominator for this firm"
     * into "this firm's owners hold nothing" at the moment the flag is set —
     * so a row with no measurable ownership was recorded as KNOWN NOT PIVOTAL,
     * indistinguishable from one measured at 0.4% and genuinely not pivotal.
     * The coalesce re-conflated downstream exactly what the null upstream
     * exists to protect: leg 2 stopped writing ior = 0.0 for an unknown
     * denominator, and this put the zero back.
     *
     * It is not rare. 42.85% of leg-2 rows have no CRSP denominator, and the
     * ISS-side `tso` used here has its own gaps, so a false 0 here is a false
     * "not pivotal" on a large minority of the panel.
     *
     * `inst_pivotal_net` immediately below already did this correctly, and its
     * comment says why in one line — "null where lending is unknown, so it
     * cannot quietly fall back to the gross measure". Same argument, four
     * columns earlier. */
    if not missing(ior)         then inst_pivotal    = abs(forpct-50) <= ior;
    else inst_pivotal = .;
    if not missing(mf_pct)      then mf_pivotal      = abs(forpct-50) <= mf_pct;
    else mf_pivotal = .;
    if not missing(passive_pct) then passive_pivotal = abs(forpct-50) <= passive_pct;
    else passive_pivotal = .;
    if not missing(index_pct)   then index_pivotal   = abs(forpct-50) <= index_pct;
    else index_pivotal = .;
    /* Reported ALONGSIDE inst_pivotal, not instead of it: null where lending
     * is unknown, so it cannot quietly fall back to the gross measure. */
    if not missing(ior_net) then inst_pivotal_net = abs(forpct-50) <= ior_net;
    else inst_pivotal_net = .;
run;

/* --- Diagnostic: how far apart are the CRSP and ISS denominators, AND WHICH WAY
 *
 * THE ABS() WAS THE PROBLEM. This counted |tso_crsp - tso|/tso > 10% — symmetric,
 * so it could not distinguish the two failure modes, which are not equally
 * visible:
 *
 *   ISS tso TOO SMALL -> ior too big  -> trips detect_impossible_ratio (>100%)
 *   ISS tso TOO LARGE -> ior too small -> trips NOTHING, ever
 *
 * Every ratio check in the suite is one-sided in exactly this way: a denominator
 * that is too large just biases ownership downward, silently, and no threshold
 * anywhere fires on it. This is the ONLY place both denominators exist on the
 * same row, so it is the only place the invisible direction can be counted at all.
 *
 * Emitted as a gate line so the same grep picks it up as PREREQ / UNIVERSE /
 * OPTIONAL / DQ / TURNOUT. A number that only reaches the .lst is a number
 * nobody reads. */
/* NOT %local: this is OPEN CODE, and `%LOCAL` is only valid inside a macro.
 * Written as %local it raised "The %LOCAL statement is not valid in open
 * code", the five macro variables were never created, every %put below
 * printed &n_dboth. literally, and the cascade took out the UNIVERSE gate and
 * out.pass_npx with it — a 32-minute run that produced no panel.
 *
 * Exactly the defect #100 fixed in import_inst_own.sas (`%abort cancel` in
 * open code), reintroduced by me three PRs later. The tell is the same: SAS
 * reports it as an ERROR and keeps going, so the log names the construct and
 * the run continues into wreckage.
 *
 * I tested the SQL standalone and it passed. The SQL was never the risk. */
proc sql noprint;
    select count(*),
           sum(case when tso > tso_crsp_inst * 1.10 then 1 else 0 end),
           sum(case when tso > tso_crsp_inst * 3.00 then 1 else 0 end),
           sum(case when tso_crsp_inst > tso * 1.10 then 1 else 0 end),
           sum(case when tso_crsp_inst > tso * 3.00 then 1 else 0 end)
      into :n_dboth trimmed, :n_iss_hi trimmed, :n_iss_hi3 trimmed,
           :n_crsp_hi trimmed, :n_crsp_hi3 trimmed
    from out.pass
    where tso > 0 and tso_crsp_inst > 0;
quit;
%put NOTE: DENOM rows_with_both=&n_dboth. iss_gt_crsp_10pct=&n_iss_hi. iss_gt_crsp_3x=&n_iss_hi3. crsp_gt_iss_10pct=&n_crsp_hi. crsp_gt_iss_3x=&n_crsp_hi3.;
%put NOTE- DENOM iss_gt_crsp means ior is UNDERSTATED and NO ratio check can see it;
%put NOTE- DENOM crsp_gt_iss means ior is OVERSTATED and detect_impossible_ratio catches it;
%put NOTE- DENOM the >100%% rate is therefore only HALF a denominator test, by construction;

proc contents data=out.pass order=varnum; run;

proc sql;
    select count(*) as nobs format comma12.,
           count(distinct permno) as n_permnos format comma12.
    from out.pass;
quit;

%put NOTE: merge_panel complete;


/* ==========================================================================
 * N-PX leg: assert one universe, then join the cells onto the panel
 * ========================================================================== */

/* --- Stack the per-year cell datasets --------------------------------------
 * Tasks partition on npx.meetingdate and a handful of itemonagendaids carry
 * rows in more than one meeting year (restated filings), so their cells arrive
 * split across two task outputs. SUM them; a plain concat would leave duplicate
 * keys in a dataset whose stated grain is unique. */
data npx_cells_raw;
    set out.npx_cells_:;
run;

proc summary data=npx_cells_raw nway missing;
    class itemonagendaid block;
    var n_rows n_for n_against n_abstain n_other
        sv_for sv_against sv_abstain n_no_sv
        tna_for tna_against tna_abstain n_no_tna;
    output out=out.npx_cells(drop=_type_ _freq_) sum=;
run;

/* --- ASSERT ONE UNIVERSE ---------------------------------------------------
 * out.meetings is built by the ownership leg; out.npx_items by the N-PX leg.
 * Both derive from pipeline_config.sas, so every meetings item MUST exist in
 * the item frame. If one does not, the two legs were built over different
 * windows or filters and the panel is silently wrong — FAIL, do not warn.
 *
 * The reverse is expected and fine: build_meetings additionally drops records
 * with an unusable `base`, turnout > 120, and votedFor <= 0 with 'Pass', so
 * npx_items is a superset. That difference is reported, not asserted.
 */
proc sql noprint;
    create table _orphan_items as
        select a.itemonagendaid
        from out.meetings a
        left join out.npx_items b on a.itemonagendaid = b.itemonagendaid
        where b.itemonagendaid is null;
    select count(*) into :n_orphan trimmed from _orphan_items;
    select count(distinct itemonagendaid) into :n_meet  trimmed from out.meetings;
    select count(*)                       into :n_items trimmed from out.npx_items;
quit;

%put NOTE: UNIVERSE meetings_items=&n_meet. npx_items=&n_items. orphans=&n_orphan.;

data _null_;
    if &n_orphan. > 0 then do;
        put "ERROR: UNIVERSE MISMATCH — &n_orphan. item(s) in out.meetings are absent";
        put "ERROR- from out.npx_items. The two legs were built over different";
        put "ERROR- universes. Both must read pipeline_config.sas; check that no";
        put "ERROR- script re-declares year1/year2/MEETINGTYPES/VOTERESULTS.";
        abort abend;
    end;
run;

/* --- The join --------------------------------------------------------------
 * LEFT join from the panel: every panel item is kept, whether or not any fund
 * disclosed a vote on it. Items with no N-PX coverage get a single row with a
 * null block, so their absence is visible rather than silently dropped. */
proc sql;
    create table out.pass_npx as
        select a.*,
               b.block,
               b.n_rows, b.n_for, b.n_against, b.n_abstain, b.n_other,
               b.sv_for, b.sv_against, b.sv_abstain, b.n_no_sv,
               b.tna_for, b.tna_against, b.tna_abstain, b.n_no_tna
        from out.pass a
        left join out.npx_cells b
          on a.itemonagendaid = b.itemonagendaid
        order by a.itemonagendaid, b.block;
quit;

/* Directional shares. Denominator is For+Against+Abstain — `n_other` (frequency
 * votes, proxy-contest card labels) is deliberately EXCLUDED from the share but
 * retained as a column, so a ballot that is mostly 'Other' is visible as a low
 * usable count rather than as a confident-looking split. */
data out.pass_npx;
    set out.pass_npx;
    n_usable = sum(n_for, n_against, n_abstain);
    if n_usable > 0 then do;
        for_frac     = n_for     / n_usable;
        against_frac = n_against / n_usable;
        abstain_frac = n_abstain / n_usable;
    end;
    /* Weighted shares are only meaningful where the weight exists at all:
     * sharesvoted is ~0% populated before 2023, and tna only covers funds the
     * crosswalk linked. n_no_sv / n_no_tna carry the size of each residual. */
    sv_total  = sum(sv_for, sv_against, sv_abstain);
    tna_total = sum(tna_for, tna_against, tna_abstain);
    if sv_total  > 0 then sv_for_frac  = sv_for  / sv_total;
    if tna_total > 0 then tna_for_frac = tna_for / tna_total;
run;

proc sql;
    select count(*)                        as n_rows        format=comma14.,
           count(distinct itemonagendaid)  as n_items       format=comma14.,
           sum(block is null)              as items_no_npx  format=comma14.,
           sum(n_rows)                     as vote_rows     format=comma18.
    from out.pass_npx;

    select block,
           count(*)    as cells     format=comma12.,
           sum(n_rows) as vote_rows format=comma18.
    from out.pass_npx where block is not null
    group by block order by vote_rows desc;
quit;

%put NOTE: merge_panel complete — out.pass (item grain), out.pass_npx (item x block);
