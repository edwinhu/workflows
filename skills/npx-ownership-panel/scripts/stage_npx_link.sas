/* stage_npx_link.sas — stage the two small hash inputs build_npx.sas needs
 *
 * Prereqs: autoexec.sas loaded (provides libnames: out, risk)
 *          &LINKCSV. present on /scratch (pushed up by run_npx.sh)
 *
 * Output:  out.npx_link   fundid -> block, tna_w      (~27K rows)
 *          out.npx_items  itemonagendaid              (~849K rows)
 *
 * This is the "push the small table up" step. The crosswalk is built LOCALLY —
 * it comes from fuzzy fund-name matching against CRSP MFDB, work that wants
 * pandas/polars and iteration, not the grid. It is 660 KB. Sending it UP is
 * free and is what lets the 329 GB table be reduced in place.
 *
 * Run ONCE before the array. Every array task opens these read-only.
 */

/* THE UNIVERSE COMES FROM pipeline_config.sas — the same file build_meetings.sas
 * reads. It is not a parameter of this script, and must not become one again:
 * a year range or meetingtype filter passed in here could disagree with the
 * ownership leg's, and nothing downstream would notice. merge_panel.sas asserts
 * the two legs agree. */
%include "pipeline_config.sas";

/* Only the crosswalk path is a per-run parameter. It arrives via -sysparm
 * (run_npx_stage.sh), NOT `qsub -v`: that sets shell environment variables,
 * which SAS macro code cannot see without %sysget. */
%global LINKCSV;
%let LINKCSV = %scan(&sysparm., 1, %str( ));

/* Defaulting lives inside a macro: open-code %IF/%THEN is a 9.4M5+ feature with
 * restrictions on what may follow %THEN, and fails here with
 * "ERROR: Expected %DO not found". Inside a macro definition it is plain.
 * Note `%let x = %sysfunc(coalescec(&x., d))` is NOT a defaulting idiom — when
 * x is undefined it is a recursive self-reference and errors. */
%macro _npx_defaults;
    %if %superq(LINKCSV) = %then %let LINKCSV = ./npx_link.csv;
%mend;
%_npx_defaults

%put NOTE: stage_npx_link &year1.-&year2. csv=&LINKCSV.;

/* --- 1. The pushed-up crosswalk -------------------------------------------
 * Explicit INPUT rather than PROC IMPORT: import guesses types from the first
 * 20 rows, and a block column whose first rows are all 'index' can be guessed
 * as a length-5 char, silently truncating 'asset_owner'.
 */
data npx_link_raw;
    length fundid 8 block $24 tna_w 8;
    infile "&LINKCSV." dsd truncover firstobs=2;
    input fundid block $ tna_w;
run;

/* A hash loaded from a dataset with duplicate keys keeps the first and drops
 * the rest silently. Dedup explicitly so the count is visible in the log. */
proc sort data=npx_link_raw out=out.npx_link nodupkey dupout=npx_link_dupes;
    by fundid;
run;

/* into: without a format keeps the raw integer. A comma format here looks nicer
 * in the log but makes the value unusable in %EVAL later — see ITEMSTAT below. */
proc sql noprint;
    select count(*)              into :nlink  trimmed from out.npx_link;
    select count(*)              into :ndupe  trimmed from npx_link_dupes;
    select count(distinct block) into :nblock trimmed from out.npx_link;
quit;
%put NOTE: LINKSTAT rows=&nlink. dropped_dupes=&ndupe. distinct_blocks=&nblock.;

proc freq data=out.npx_link;
    tables block / missing;
    title3 "Crosswalk composition (verify no truncated block labels)";
run;
title3;

/* --- 2. The item universe --------------------------------------------------
 * DISTINCT is load-bearing. vavoteresults is not unique on itemonagendaid
 * (848,736 rows / 848,506 distinct in 2005-2025 — 'Pending' + final versioning
 * pairs, references/iss-voting.md). Loading the raw table into a hash would be
 * fine (a hash holds one entry per key), but taking DISTINCT here makes the
 * fan-out visible in the log instead of invisible in the hash.
 */
proc sql;
    create table out.npx_items as
    select distinct itemonagendaid
    from risk.vavoteresults
    where %vaFilterSAS
      and itemonagendaid is not missing;
quit;

proc sql noprint;
    select count(*) into :nitem trimmed from out.npx_items;
    select count(*) into :nraw  trimmed from risk.vavoteresults
        where %vaFilterSAS;
quit;
/* fanout_rows is the count of duplicate itemonagendaid rows in vavoteresults —
 * the rows a PostgreSQL INNER JOIN would multiply the N-PX side by, and which
 * the item hash cannot. 230 over 2005-2025. */
%put NOTE: ITEMSTAT distinct_items=&nitem. raw_rows=&nraw. fanout_rows=%eval(&nraw. - &nitem.);

%put NOTE: stage_npx_link complete at %sysfunc(datetime(),datetime19.);
