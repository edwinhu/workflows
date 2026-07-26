/* build_npx.sas — fund-level N-PX votes -> (itemonagendaid x block) cells, one year per SGE task
 *
 * Prereqs: autoexec.sas loaded (provides libnames: out, risk)
 *          out.npx_link   (from stage_npx_link.sas — the pushed-up crosswalk)
 *          out.npx_items  (from stage_npx_link.sas — the item universe)
 *
 * Output:  out.npx_cells_&year.   grain = (itemonagendaid, block)
 *
 * CREDIT: the year-parallel-array + hash-merge design here is NOT new. It is
 * adapted from npx_agreement.sas / npx_agreement.sh (the "robo" project), which
 * already ran `#$ -t 2003-2020` over risk.voteanalysis_npx with an ISS-rec hash
 * keyed on itemOnAgendaID. Two things change:
 *   (a) the hash payload  — scratch.iss_recs  ->  out.npx_link (fundid -> block)
 *   (b) the accumulator   — (fundid, year)    ->  (itemonagendaid, block)
 * Everything else, including the index-friendly WHERE and the item hash doing
 * double duty as a filter, is the original's.
 *
 * WHY THIS EXISTS
 * ---------------
 * risk.voteanalysis_npx is 238,445,215 rows / 329 GB. The fund-level leg of a
 * voting panel does NOT need those rows locally: what it needs is each item's
 * per-block For/Against/Abstain split, which is ~2.2M rows. Aggregating here and
 * shipping the cells is a ~64x reduction over downloading the fund-item rows.
 * The mirror project shipped 144,376,253 joined rows to a local machine (~35 min
 * sequential) for want of this leg.
 *
 * WHY THE where= LOOKS LIKE THAT
 * ------------------------------
 * `meetingdate between "01jan&year."d and "31dec&year."d` is an INDEX-FRIENDLY
 * range and uses voteanalysis_npx.sas7bndx (15 GB). Writing `year(meetingdate)
 * = &year.` instead applies a function to the indexed column, which defeats the
 * index and makes every task full-scan all 329 GB. Someone already hit this on
 * the original; do not regress it.
 *
 * WHY THERE IS AN ITEM HASH AS WELL
 * ---------------------------------
 * The date range alone is NOT the analysis universe. Measured 2026-07-25:
 *   n.meetingdate in 2005-2025 ......... 237,057,808 rows
 *   items present in vavoteresults ..... 144,375,860 rows
 * The 92.7M-row difference is N-PX rows whose item has no US vote-results
 * record (non-US meetings, items ISS never scored). Partitioning on the date
 * alone silently inflates every block's denominator by ~64%.
 *
 * out.npx_items is the 848,506-key item universe. `item.find()` restores the
 * intended universe in the same pass, exactly as the original's `iss.find()`
 * did — the ISS-rec hash there was a lookup AND a semi-join filter.
 *
 * This also AVOIDS a defect the PostgreSQL INNER JOIN has. vavoteresults is not
 * unique on itemonagendaid (848,736 rows / 848,506 distinct in-window —
 * 'Pending' + final versioning pairs, references/iss-voting.md), so the INNER
 * JOIN fans out: 144,376,253 rows against the semi-join's 144,375,860. A hash
 * keyed on itemonagendaid holds one entry per key and cannot fan out.
 *
 * MEMORY
 * ------
 * The accumulator holds one entry per (item, block) present in the year —
 * ~100K entries, a few MB. The 329 GB source streams through the PDV and is
 * never held. 4 GB per task is ample (the original used 4G).
 */

%let year = &sysparm.;
%put NOTE: build_npx year=&year. started at %sysfunc(datetime(),datetime19.);

/* --- Direction mapping ------------------------------------------------------
 * Withhold folds into Against: on director elections (ISS codes M02xx) Withhold
 * IS the against-equivalent, and treating it as a fourth category silently
 * empties the against column for the most common item type on the ballot.
 * Everything not named here (frequency votes 'One Year'/'Two Years'/'Three
 * Years', proxy-contest card labels 'Do Not Vote'/'None') lands in n_other —
 * counted, never dropped. A vote row that vanishes is an unfindable bug.
 */
%let DIR_FOR     = 'For';
%let DIR_AGAINST = 'Against', 'Withhold';
%let DIR_ABSTAIN = 'Abstain';

/* Optional extra filter on the source. Empty by default so n_rows reconciles
 * exactly against a PostgreSQL COUNT(*) over the same date window. The original
 * filtered fundvote inline, which is faster; add it here once reconciled:
 *   %let VOTE_WHERE = and fundvote in (&DIR_FOR., &DIR_AGAINST., &DIR_ABSTAIN.);
 */
%let VOTE_WHERE = ;

%let UNLINKED = __unlinked__;

data _null_;
    length fundid 8 block $24 tna_w 8;
    length k_item 8 k_block $24;
    length n_rows 8 n_for 8 n_against 8 n_abstain 8 n_other 8
           sv_for 8 sv_against 8 sv_abstain 8 n_no_sv 8
           tna_for 8 tna_against 8 tna_abstain 8 n_no_tna 8;

    if _n_ = 1 then do;
        /* Item universe: itemonagendaid -> (nothing). Key-only hash, 848,506
         * entries, ~20 MB. Doing double duty as the semi-join filter — see
         * header. Built once for the WHOLE window, not per year, so a task
         * never depends on npx.meetingdate agreeing with vavoteresults. */
        declare hash item(dataset: 'out.npx_items');
        item.defineKey('itemonagendaid');
        item.defineDone();

        /* Crosswalk: fundid -> block. O(1) lookup, no sort of either side.
         * This is the "push the small table up" step — 26,686 rows built
         * locally (fuzzy fund-name matching against CRSP MFDB, which does not
         * belong on the grid) and staged by stage_npx_link.sas. */
        declare hash link(dataset: 'out.npx_link');
        link.defineKey('fundid');
        link.defineData('block', 'tna_w');
        link.defineDone();

        /* Accumulator, keyed on the OUTPUT grain. ordered:'y' means .output()
         * emits sorted by (itemonagendaid, block) with no PROC SORT. */
        declare hash cell(ordered: 'y');
        cell.defineKey('k_item', 'k_block');
        cell.defineData('k_item', 'k_block',
                        'n_rows', 'n_for', 'n_against', 'n_abstain', 'n_other',
                        'sv_for', 'sv_against', 'sv_abstain', 'n_no_sv',
                        'tna_for', 'tna_against', 'tna_abstain', 'n_no_tna');
        cell.defineDone();

        _rows = 0; _kept = 0; _unlinked = 0;
    end;

    /* Index-friendly date range instead of year(meetingdate) — see header. */
    set risk.voteanalysis_npx(
        keep=fundid itemonagendaid fundvote sharesvoted meetingdate
        where=(meetingdate between "01jan&year."d and "31dec&year."d
               and itemonagendaid is not missing
               &VOTE_WHERE.)
    ) end=eof;

    _rows + 1;

    /* Semi-join filter. `goto done` (the original's idiom) skips accumulation
     * but still reaches the eof block, so the counters stay correct. */
    if item.check() ne 0 then goto done;
    _kept + 1;

    /* Hash data variables RETAIN their previous value when find() misses, so
     * the miss branch must reset them explicitly. Forgetting this is the
     * classic hash bug: every unlinked fund inherits the previous fund's block. */
    if link.find() ne 0 then do;
        block = "&UNLINKED.";
        tna_w = .;
        _unlinked + 1;
    end;

    _sv  = sum(sharesvoted, 0);
    _tna = sum(tna_w, 0);

    k_item  = itemonagendaid;
    k_block = block;

    /* Plain assignment, NOT the sum statement (`n_for + 1`). The sum statement
     * retains across the whole step, independent of which hash entry we are on,
     * and would smear one cell's counts into the next. */
    rc = cell.find();
    if rc ne 0 then do;
        n_rows = 0; n_for = 0; n_against = 0; n_abstain = 0; n_other = 0;
        sv_for = 0; sv_against = 0; sv_abstain = 0; n_no_sv = 0;
        tna_for = 0; tna_against = 0; tna_abstain = 0; n_no_tna = 0;
    end;

    n_rows = n_rows + 1;

    select;
        when (fundvote in (&DIR_FOR.)) do;
            n_for      = n_for + 1;
            sv_for     = sv_for + _sv;
            tna_for    = tna_for + _tna;
        end;
        when (fundvote in (&DIR_AGAINST.)) do;
            n_against  = n_against + 1;
            sv_against = sv_against + _sv;
            tna_against = tna_against + _tna;
        end;
        when (fundvote in (&DIR_ABSTAIN.)) do;
            n_abstain  = n_abstain + 1;
            sv_abstain = sv_abstain + _sv;
            tna_abstain = tna_abstain + _tna;
        end;
        otherwise n_other = n_other + 1;
    end;

    /* Size of the residual each weighting scheme silently excludes.
     * sharesvoted is 0% populated pre-2023, 15% in 2023, 96% in 2024+
     * (references/iss-voting.md gotcha #10) — without n_no_sv a share-weighted
     * split for 2019 looks precise and is computed from nothing. */
    if _sv  <= 0 then n_no_sv  = n_no_sv + 1;
    if _tna <= 0 then n_no_tna = n_no_tna + 1;

    if rc ne 0 then cell.add(); else cell.replace();

    done:
    if eof then do;
        _nc = cell.num_items;
        /* One fact per line: autoexec sets linesize=100 and a single wide PUT
         * is silently truncated mid-number, which is how `unlinked` — the
         * crosswalk coverage metric — disappears from the log exactly when you
         * need it. */
        put "NOTE: NPXSTAT year=&year. scanned=" _rows comma15.;
        put "NOTE: NPXSTAT year=&year. kept="    _kept comma15.;
        put "NOTE: NPXSTAT year=&year. cells="   _nc comma15.;
        put "NOTE: NPXSTAT year=&year. unlinked=" _unlinked comma15.;
        cell.output(dataset: "out.npx_cells_&year.");
    end;
run;

/* Rename the hash key columns to their real names and stamp the year. */
data out.npx_cells_&year.;
    length itemonagendaid 8 block $24 part_year 8;
    set out.npx_cells_&year.(rename=(k_item=itemonagendaid k_block=block));
    part_year = &year.;
run;

proc sql noprint;
    select count(*) format=comma14. into :ncells from out.npx_cells_&year.;
    select sum(n_rows) format=comma18. into :nrows  from out.npx_cells_&year.;
quit;

%put NOTE: NPXDONE year=&year. cells=&ncells. rows=&nrows.;
%put NOTE: build_npx year=&year. complete at %sysfunc(datetime(),datetime19.);
