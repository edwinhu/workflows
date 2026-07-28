/* pipeline_config.sas — THE universe. Both legs read this file and only this file.
 *
 * %include'd by build_meetings.sas (item-level leg), stage_npx_link.sas
 * (fund-level leg) and merge_panel.sas (the join).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The two legs used to carry their own date windows and filters:
 *     build_meetings.sas    2003-2024, voteresult in ('Pass','Fail'), 5 meetingtypes
 *     stage_npx_link.sas    2005-2025, no voteresult filter, no meetingtype filter
 * Nothing detected the disagreement. Widening the meeting-type filter — which
 * this project has already done once — changes the item universe, and under
 * split config the ownership leg and the N-PX leg would silently be built over
 * DIFFERENT sets of items. The only thing that would have caught it is a
 * row-count assertion in somebody else's downstream code.
 *
 * Change the window or the filters HERE. merge_panel.sas asserts at the end of
 * the run that the two legs actually agree; if you edit a filter in one script
 * instead of here, the pipeline fails rather than producing a quietly wrong panel.
 */

/* --- Date window ----------------------------------------------------------- */
%let year1 = 2005;
%let year2 = 2025;

/* --- Item universe filters -------------------------------------------------
 * MEETINGTYPES: gotcha #9 in references/iss-voting.md — always restrict to the
 * standard types unless you specifically need others. WIDENING THIS CHANGES THE
 * ITEM UNIVERSE for both legs; that is exactly why it lives here.
 *
 * VOTERESULTS: 'Pending' rows are the un-finalised half of the versioning pairs
 * that make vavoteresults non-unique on itemonagendaid (848,736 rows / 848,506
 * distinct over 2005-2025). Excluding them here is what keeps the item frame a
 * true key.
 */
%let MEETINGTYPES = 'Annual','Special','Annual/Special','Proxy Contest','Proxy Contest (M&A)';
%let VOTERESULTS  = 'Pass','Fail';

/* Reusable SQL predicate on an aliased vavoteresults. Pass the alias, e.g.
 *     where &year1. ... %vaFilter(v)
 * Kept as a macro so the two legs cannot drift even in punctuation. */
%macro vaFilter(a=);
        &a..meetingdate >= %str(%')&year1.-01-01%str(%')
    and &a..meetingdate <= %str(%')&year2.-12-31%str(%')
    and &a..voteresult in (&VOTERESULTS.)
    and &a..meetingtype in (&MEETINGTYPES.)
%mend;

/* SAS-libname form of the same predicate (date literals, not ISO strings). */
%macro vaFilterSAS;
        meetingdate between "01jan&year1."d and "31dec&year2."d
    and voteresult in (&VOTERESULTS.)
    and meetingtype in (&MEETINGTYPES.)
%mend;

/* --- S12 partition ranges --------------------------------------------------
 * Declared HERE because split_s12.sas (which writes the partitions) and
 * run_pipeline.sh (which submits one tfn_holdings job per partition) both need
 * them, and they were previously hardcoded SEPARATELY in each — the same
 * single-source-of-truth defect as the item universe, one edit away from
 * submitting jobs for partitions that were never written.
 *
 * Balanced by ROW COUNT, not year count: S12 went from ~4M rows/yr pre-2017 to
 * ~20-26M/yr after. See references/postgres-vs-sas.md.
 *
 * SPACE: the full set is ~40 GB on /scratch. WRDS scratch quotas are per-user
 * and can be far smaller (measured on one account: 22 GB, which cannot hold it).
 * Check `quota` before a full run; trim this list to fit and the pipeline still
 * completes end to end over the narrower holdings window.
 */
%let S12_RANGES = 2003-2010 2011-2016 2017-2018 2019-2019 2020-2020 2021-2021 2022-2022 2023-2023 2024-2024;

/* OPTIONAL INPUTS: present or absent CHANGES THE PANEL, so say which you meant.
 *
 * build_meetings.sas reads two files behind `fileexist` guards — SharkRepellent
 * (the `fight` flag) and the ISS/GL recommendations. If either is missing it
 * emits a WARNING and carries on: `fight` becomes 0 for every observation and
 * the recommendation columns go null. The run succeeds, the panel is different,
 * and nothing downstream can tell which panel it is holding.
 *
 * That happened here. A /scratch purge removed the SharkRepellent workbook and
 * four separate frozen digests were taken afterwards, all silently carrying
 * `fight = 0` everywhere. Nobody noticed, because a WARNING in a 90,000-line SAS
 * log is not a signal.
 *
 * So the absence has to be DECLARED rather than discovered:
 *   1  missing optional input is FATAL — matches how this pipeline treats every
 *      other missing input (a lost N-PX year aborts the merge)
 *   0  (default) absence is accepted; you are saying you want the degraded panel
 *
 * WHY 0 IS THE DEFAULT, given the argument above is for stopping loudly.
 * The NOTE and the WARNINGs below print at BOTH settings. Declaration is what
 * fixes the defect — a panel whose `fight` column is all zero because nobody
 * chose that is the bug, not a panel whose `fight` column is all zero because
 * someone did. This flag only decides whether the declaration is also a HARD
 * STOP, and stopping the whole pipeline over an input that legitimately may not
 * exist punishes the ordinary case to catch the careless one. Set it to 1 for
 * anything whose digest you intend to freeze, where an unnoticed degraded panel
 * is expensive; leave it at 0 for exploratory runs.
 *
 * The current deployment runs at 0 deliberately: the SharkRepellent workbook that
 * matches the expected filename is unreadable (no header row), the other stops
 * partway through 2025, and `fight` is not on the critical path for the present
 * work. Digests A-C were all frozen with `fight` = 0, and that is now a stated
 * property of them rather than an accident.
 *
 * `shark` here means USABLE, not merely present. One of the two workbooks in the
 * raw directory imports cleanly and contributes nothing — no header row, so no
 * Company_Ticker and no Campaign_Meeting_Date — and it is the one whose FILENAME
 * matches. A file-exists test would pass it and report a present input while
 * every `fight` stayed 0, so build_meetings validates the columns and the parsed
 * pair count and treats an unusable workbook as absent.
 *
 * Either way build_meetings prints
 *   NOTE: OPTIONAL shark=<0|1> shark_pairs=<n> shark_through=<year> recs=<0|1>
 * next to the PREREQ and UNIVERSE gate lines, so the same grep that checks the
 * others reports which panel this is — and `shark_through` short of year2 raises
 * a WARNING naming the years that will be silently unflagged.
 */
%let REQUIRE_OPTIONAL_INPUTS = 0;

/* WHICH SharkRepellent workbook. Declared here, with the other optional inputs,
 * rather than buried at line 31 of build_meetings.sas — the choice changes the
 * panel, so it belongs where the panel-changing choices are stated.
 *
 * Two extracts exist and NEITHER is clean. Measured, not assumed:
 *
 *   A  `20240521 SharkRepellent.xlsx` (33.4 MB) — the one whose filename matched
 *      the historical default (20240521 IS 5.21.24). Campaign Details has NO
 *      header row: PROC IMPORT takes column 1's name from a banner cell and falls
 *      back to B, C, D... for the rest. No Company_Ticker, no
 *      Campaign_Meeting_Date. 16,658 rows, 0 parsed dates, 0 tickers. Useless,
 *      and worse than absent because fileexist succeeds on it.
 *
 *   B  `SharkRepellent 1995-2024.xlsx` (64.9 MB) — parses. 12,785 US campaigns,
 *      3,984 non-US, 700 with no exchange suffix. Campaign_Meeting_Date is '@NA'
 *      for campaigns with no meeting (9,629 of 17,469), which is expected. Its
 *      defect is the TAIL: 755 campaign-meetings in 2024 against 99 in 2025, so
 *      it reaches year2=2025 while barely covering it — which is exactly what the
 *      tail-volume check in build_meetings fires on.
 *
 * DEFAULT IS EMPTY — no workbook staged. That is deliberate, and it is what makes
 * `fight = 0` a stated property of digests A-C rather than an accident. The
 * previous default named a path that does not exist on the grid, which reached
 * the same all-zero panel by accident while looking like a choice.
 *
 * Point this at B to populate `fight` / `fight_definitive`, expect the 2025
 * coverage WARNING, and re-freeze afterwards — the digests change.
 *
 * Staged on the grid for comparison:
 *   A  /scratch/nyu/hue/shark_eval/A_20240521.xlsx
 *   B  /scratch/nyu/hue/shark_eval/B_1995_2024.xlsx
 */
%let SHARK_FILE = ;

/* MEASURED EFFECT of these two filters on the item frame, 2005-2025 (2026-07-25):
 *
 *   filters            distinct items   raw rows   fanout
 *   none                    848,506      848,736      230
 *   as declared above       712,466      712,477       11
 *
 * Two things to note before reconciling anything:
 *   - The item frame shrinks by 136,040 items. Any N-PX vote-row total quoted
 *     against the UNFILTERED universe (144,375,860 for 2005-2025) will NOT match
 *     a run made with these filters. Reconcile against a count taken under the
 *     same config, or set MEETINGTYPES/VOTERESULTS to admit everything.
 *   - fanout drops 230 -> 11 because excluding 'Pending' removes most of the
 *     versioning pairs that make vavoteresults non-unique on itemonagendaid.
 */
%put NOTE: PIPELINE UNIVERSE &year1.-&year2. meetingtypes=&MEETINGTYPES. voteresults=&VOTERESULTS.;
