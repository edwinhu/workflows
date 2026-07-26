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
