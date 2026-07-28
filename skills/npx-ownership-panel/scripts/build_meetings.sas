/* build_meetings.sas — ISS vote results with CRSP permno and CIK linkage
 *
 * Prereqs: autoexec.sas loaded (provides libnames: out, risk, crsp, wrdssec)
 *          /scratch/nyu/hue/SharkRepellent 5.21.24.xlsx
 *          ~/projects/pass/recs_2005_2024.csv
 *
 * Output:  out.meetings (item-level vote results with permno, cik, fight flag)
 *          grain = itemonagendaid (deduped nodupkey at the end)
 *
 * The date window and the item-universe filters come from pipeline_config.sas —
 * do NOT re-declare them here. The N-PX leg reads the same file, and
 * merge_panel.sas asserts the two legs agree about which items exist.
 */

%include "pipeline_config.sas";

/* This script previously read vavoteresults through a PostgreSQL pass-through,
 * on the rationale that "the SAS libname on WRDS can lag the live PG table by
 * months (NFS cache refresh cycle)". THAT IS OBSOLETE — verified 2026-07-25,
 * both copies are identical:
 *     SAS  max(meetingdate) 2025-12-31   n = 887,341
 *     PG   max(meetingdate) 2025-12-31   n = 887,341
 * The library has been refreshed. Reading natively also uses the SAS index
 * (vavoteresults.sas7bndx, 52 MB on 836 MB, indexed on MeetingDate) and removes
 * the last .pgpass dependency outside the S12 leg.
 *
 * Do not reinstate the pass-through without re-running that comparison.
 */

/* --- SharkRepellent campaign data (optional) --- */
/* The path is DECLARED in pipeline_config.sas (%let SHARK_FILE), next to
 * REQUIRE_OPTIONAL_INPUTS, because which workbook is staged changes the panel.
 * This only forwards it. pipeline_config.sas is %included at line 15 above,
 * unconditionally, so SHARK_FILE is always defined here — no %symexist guard,
 * because an open-code %if is the exact shape of the last two macro bugs in this
 * pipeline (#111 %local in open code, #112 bare semicolon in %put) and this file
 * has no other open-code %if to lean on. */
%let shark_file = &SHARK_FILE.;
/* have_shark means USABLE, not merely PRESENT — see the validation below. */
%global have_shark shark_pairs shark_max_yr has_def;
%let have_shark = 0;
%let shark_pairs = 0;
%let shark_max_yr = .;
/* has_def is GLOBAL, not %local to load_shark: the OPTIONAL NOTE that reports it
 * is emitted in open code further down, where a %local would resolve to nothing —
 * the same silent-empty-macro-var shape as #111/#112. Initialised so the NOTE is
 * well-defined even when no workbook is staged. */
%let has_def = 0;

%macro load_shark;
    %if %sysfunc(fileexist("&shark_file.")) %then %do;
        PROC IMPORT DATAFILE="&shark_file."
            DBMS=xlsx REPLACE OUT=out.shark;
            sheet="Campaign Details";
        RUN;

        %macro removeMultipleUnderscores(dataset);
            %local rename_list;
            proc sql noprint;
                select catx("=", name, prxchange('s/_{2,}/_/o', -1, name))
                into :rename_list separated by " "
                from dictionary.columns
                where libname = upcase(scan("&dataset", 1, "."))
                  and memname = upcase(scan("&dataset", 2, "."))
                  and prxmatch('/_{2,}/', name);
            quit;
            %if &rename_list ne %then %do;
                proc datasets library=%scan("&dataset", 1, ".") nolist nowarn;
                    modify %scan("&dataset", 2, ".");
                    rename &rename_list;
                run; quit;
            %end;
        %mend;
        %removeMultipleUnderscores(out.shark);

        /* VALIDATE THE CONTENT, NOT THE FILENAME.
         *
         * `fileexist` is the wrong test and one of the two workbooks in the raw
         * directory proves it. `20240521 SharkRepellent.xlsx` (33.4 MB, and the
         * one whose NAME matches &shark_file — 20240521 IS 5.21.24) has no header
         * row on the Campaign Details sheet: SAS takes the first column name from
         * a banner cell (FactSet_Universal_Screening) and falls back to
         * spreadsheet letters B, C, D … for the rest. It carries neither
         * Company_Ticker nor Campaign_Meeting_Date. Imported: 16,658 rows,
         * 0 parsed dates, 0 tickers.
         *
         * Staged blind, that file is WORSE than no file. fileexist succeeds, the
         * import succeeds, ticker and meetingdate come out uninitialised, the
         * fight join matches nothing, and `fight` is 0 for every row — while the
         * run asserts the input is present. An undeclared zero becomes a falsely
         * declared one, which is the same defect wearing a better disguise.
         *
         * So a workbook that cannot answer the question is treated as ABSENT,
         * and REQUIRE_OPTIONAL_INPUTS then decides whether that is fatal. */
        %local has_tick has_date;   /* has_def is %global — declared above */
        proc sql noprint;
            select count(*) into :has_tick trimmed from dictionary.columns
              where libname = "OUT" and memname = "SHARK"
                and upcase(name) = "COMPANY_TICKER";
            select count(*) into :has_date trimmed from dictionary.columns
              where libname = "OUT" and memname = "SHARK"
                and upcase(name) = "CAMPAIGN_MEETING_DATE";
            /* Proxy_Fight_Definitive is a BONUS column, not a usability
             * requirement: a workbook without it still answers the `fight`
             * question. Probed separately so its absence degrades ONE column
             * instead of discarding the whole workbook. */
            select count(*) into :has_def trimmed from dictionary.columns
              where libname = "OUT" and memname = "SHARK"
                and upcase(name) = "PROXY_FIGHT_DEFINITIVE";
        quit;

        %if &has_tick. = 0 or &has_date. = 0 %then %do;
            %put WARNING: SharkRepellent workbook at &shark_file. is not usable.;
            %put WARNING- Company_Ticker present=&has_tick. Campaign_Meeting_Date present=&has_date.;
            %put WARNING- The Campaign Details sheet has no header row, so PROC IMPORT;
            %put WARNING- named the columns B, C, D ... Treating it as ABSENT rather than;
            %put WARNING- letting it assert presence while contributing nothing.;
        %end;
        %else %do;
            data out.shark2;
                set out.shark;
                length _exch $8;

                /* THE EXCHANGE SUFFIX IS LOAD-BEARING. FactSet writes tickers as
                 * `AHT-US`, `S-CA`, `AGL-AU`. Stripping at the first '-' without
                 * testing the suffix silently merges a foreign issuer into the US
                 * issuer that shares the base symbol.
                 *
                 * Measured on the 1995-2024 extract: 12,785 US campaigns, 3,984
                 * non-US, 700 with no suffix — and 279 distinct non-US base
                 * tickers COLLIDE with a US base ticker (AAL, AGN, AGO, AEE, ...).
                 * Each collision would attribute an Australian or Canadian proxy
                 * fight to an unrelated US company's meeting.
                 *
                 * ISS `ticker` in turnout2 is US-listed, so a non-US row can only
                 * ever produce a false positive. Blank the KEY rather than
                 * subsetting, so the row still counts toward the coverage
                 * diagnostics below and only the join is suppressed. */
                _exch = upcase(scan(Company_Ticker, -1, '-'));
                if _exch = 'US'
                    then ticker = scan(scan(Company_Ticker,1,'-'),1,'.');
                    else ticker = '';

                meetingdate=input(Campaign_Meeting_Date,??anydtdte10.);
                format meetingdate yymmddn8.;

                %if &has_def. %then %do;
                fight_definitive_src = (Proxy_Fight_Definitive = 1);
                %end;
                %else %do;
                /* Column absent in this extract — the flag stays 0 and the
                 * OPTIONAL NOTE reports shark_def=0, rather than the run failing
                 * over a bonus column. */
                fight_definitive_src = 0;
                %end;
                drop _exch;
            run;

            /* Rows that actually reach the join. Campaign_Meeting_Date is '@NA'
             * — FactSet's not-available sentinel — for campaigns with no meeting,
             * so a large unparsed count is expected and is NOT a parse failure:
             * 9,629 of 17,469 in the 1995-2024 extract. What matters is how many
             * usable (ticker, meetingdate) pairs survive, and how far they run. */
            proc sql noprint;
                select count(*), max(year(meetingdate))
                  into :shark_pairs trimmed, :shark_max_yr trimmed
                  from (select distinct ticker, meetingdate from out.shark2
                        where not missing(meetingdate) and ticker ne "");
                create table shark_yr as
                    select year(meetingdate) as yr, count(*) as n
                    from (select distinct ticker, meetingdate from out.shark2
                          where not missing(meetingdate) and ticker ne "")
                    group by calculated yr;
            quit;

            %if &shark_pairs. = 0 %then %do;
                %put WARNING: SharkRepellent workbook parsed 0 usable (ticker, meetingdate) pairs.;
                %put WARNING- Treating it as ABSENT — it cannot set `fight` for any row.;
            %end;
            %else %let have_shark = 1;
        %end;
    %end;
    %else %do;
        %put WARNING: SharkRepellent file not found at &shark_file. — fight flag will be 0 for all obs;
    %end;
%mend;
%load_shark;

/* COVERAGE, not just presence. A workbook that stops before the end of the
 * window sets `fight` = 0 for every meeting after it — not because there were no
 * campaigns, but because the extract does not reach them. Undeclared, that is the
 * same defect one level down. Measured on the 1995-2024 extract: 755 campaigns
 * with a 2024 meeting date, 99 with a 2025 one. */
%macro shark_coverage_check;
    %if not &have_shark. %then %return;

    /* Reaching year2 is NOT the same as covering it. The 1995-2024 extract has a
     * 2025-12-03 meeting date in it, so any max-year test passes — while 2025
     * holds 99 campaigns against 755 in 2024. A stop-short test would have
     * reported this file as complete. So test the TAIL VOLUME too, against the
     * three preceding years. */
    %local n_last n_prior;
    proc sql noprint;
        select sum(case when yr = &year2. then n else 0 end),
               mean(case when yr between %eval(&year2. - 3) and %eval(&year2. - 1)
                         then n else . end)
          into :n_last trimmed, :n_prior trimmed
        from shark_yr;
    quit;

    %if %eval(&shark_max_yr.) < &year2. %then %do;
        %put WARNING: SharkRepellent coverage ends &shark_max_yr. but the window runs to &year2.;
        %put WARNING- `fight` will be 0 for every meeting in %eval(&shark_max_yr. + 1)-&year2.;
        %put WARNING- because this extract does not reach them, not because no campaigns occurred.;
        %put WARNING- Stage an extract covering &year2., or narrow year2 in pipeline_config.sas.;
    %end;
    %else %if %sysevalf(&n_prior. > 0) and %sysevalf(&n_last. < 0.5 * &n_prior.) %then %do;
        %put WARNING: SharkRepellent reaches &year2. but thinly — &n_last. campaign-meetings;
        %put WARNING- against a %eval(&year2. - 3)-%eval(&year2. - 1) average of %sysfunc(round(&n_prior.)).;
        %put WARNING- The extract stops partway through &year2., so `fight` is understated;
        %put WARNING- there. Reaching a year is not the same as covering it.;
    %end;
%mend;
%shark_coverage_check

/* --- ISS proxy advisor recommendations (optional) --- */
%let recs_file = ~/projects/pass/recs_2005_2024.csv;
%global have_recs;
%let have_recs = 0;

%macro load_recs;
    %if %sysfunc(fileexist("&recs_file.")) %then %do;
        %let have_recs = 1;
        PROC IMPORT DATAFILE="&recs_file."
            OUT=recs_2005_2024 DBMS=csv REPLACE;
            GETNAMES=YES;
        RUN;
    %end;
    %else %do;
        %put WARNING: Recs file not found at &recs_file. — ISS/GL recommendations will be missing;
    %end;
%mend;
%load_recs;

/* --- OPTIONAL-INPUT GATE ---------------------------------------------------
 * Both loads above degrade silently: absent file -> WARNING -> `fight` is 0 for
 * every row / recommendation columns null -> run succeeds -> panel is different
 * and nothing says so. A /scratch purge removed the SharkRepellent workbook and
 * four frozen digests were taken afterwards, every one of them carrying an
 * all-zero `fight` column that nobody had chosen.
 *
 * The NOTE prints unconditionally and in the same shape as the PREREQ/UNIVERSE
 * gates, so `grep -E 'PREREQ|UNIVERSE|OPTIONAL|ERROR'` says which panel this is.
 * Whether absence is fatal is REQUIRE_OPTIONAL_INPUTS in pipeline_config.sas. */
/* shark_pairs counts US-listed pairs only — non-US tickers are blanked in the
 * shark2 step, so this is smaller than it was before that fix and is the count
 * that can actually join. shark_def=0 alongside shark=1 means the extract lacks
 * Proxy_Fight_Definitive, so fight_definitive is 0 everywhere by absence. */
%put NOTE: OPTIONAL shark=&have_shark. shark_pairs=&shark_pairs. shark_through=&shark_max_yr. shark_def=&has_def. recs=&have_recs.;

%macro require_optional_inputs;
    %if &REQUIRE_OPTIONAL_INPUTS. = 1 %then %do;
        %local missing_opt;
        %let missing_opt = ;
        %if not &have_shark. %then %let missing_opt = &missing_opt. SharkRepellent(&shark_file.);
        %if not &have_recs.  %then %let missing_opt = &missing_opt. recs(&recs_file.);
        %if %length(&missing_opt.) > 0 %then %do;
            %put ERROR: OPTIONAL INPUT(S) MISSING —&missing_opt.;
            %put ERROR- These are not decorative: without SharkRepellent every `fight`;
            %put ERROR- is 0, and without recs the recommendation columns are null. The;
            %put ERROR- run would SUCCEED and produce a different panel with no marker;
            %put ERROR- on it, which is how four digests were frozen on an all-zero;
            %put ERROR- `fight` column without anyone choosing that.;
            %put ERROR- Either stage the file(s), or set REQUIRE_OPTIONAL_INPUTS = 0 in;
            %put ERROR- pipeline_config.sas to say you meant the degraded panel.;
            data _null_; abort abend; run;
        %end;
    %end;
%mend;
%require_optional_inputs

/* --- ISS vote results, native indexed read --- */
/* %vaFilterSAS is the SAS-literal form of the same predicate stage_npx_link.sas
 * uses, from pipeline_config.sas — one universe, both legs. The date range is a
 * BETWEEN on literals so it stays index-friendly. */
proc sql;
    create table turnout_raw as
        select cusip, companyid, issagendaitemid, itemonagendaid, meetingid,
               meetingdate, meetingtype, recorddate, seqnumber, ticker, sponsor,
               mgmtrec, voteresult, votedfor, votedagainst, votedabstain,
               votedwithheld, brokernonvote, base, outstandingshare,
               voterequirement
        from risk.vavoteresults
        where %vaFilterSAS;
quit;

proc sql noprint;
    select count(*) format=comma14. into :cnt from turnout_raw;
quit;
%put NOTE: turnout_raw rows from PG: &cnt;

data turnout;
    set turnout_raw;
    keep cusip companyid issagendaitemid mgmtrec mgmt_for meetingdate meetingid meetingtype
        recorddate seqnumber votedwithheld base brokernonvote itemonagendaid
        sponsor ticker voterequirement voteresult votedabstain votedagainst votedfor
        denom turnout forpct yyyy tso;
    tso = outstandingshare;
    drop outstandingshare;

    denom=.;
    if base in ('F+A+AB','F A AB','F+A+B') then denom = sum(votedfor,+votedagainst,votedabstain);
    if base in ('F+A','F A') then denom = sum(votedfor,votedagainst);
    if base='Votes Represent' then denom=sum(votedabstain, votedagainst, votedfor, brokernonvote, votedwithheld);
    if base in ('Capital Represe','Outstanding') then denom=tso;
    if base in ('NA','NULL') then delete;

    if tso > 0 then
        turnout=100*sum(votedabstain, votedagainst, votedfor, brokernonvote, votedwithheld)/tso;
    forpct=.;
    if denom > 0 then forpct=(votedfor/denom)*100;
    forpct = min(max(forpct, 0), 100);
    if turnout > 120 then delete;
    turnout = min(max(turnout, 0), 100);
    if votedFor le 0 and voteresult = 'Pass' then delete;
    YYYY=year(meetingdate);
    mgmt_for = (mgmtrec = 'For');
run;

/* TURNOUT IS THE ONLY INDEPENDENT AUDIT OF ISS `tso`, AND THE STEP ABOVE
 * DESTROYS IT. turnout = votes cast / tso is computed from ISS votes over ISS
 * shares outstanding — no 13F, no CRSP — so it is the one number here that can
 * say whether the ISS denominator is right. But rows above 120 are DELETED and
 * the rest CLIPPED to 100, so by the time anyone looks turnout reads a clean
 * max of 100.0% with 0.00% above, on a panel whose denominators are
 * demonstrably broken on 6.8% of rows.
 *
 * The delete and the clip both stay — a 300% turnout is not usable as a turnout
 * and downstream expects [0,100]. What changes is that the EVIDENCE SURVIVES.
 * Measured on turnout_raw, before either, and printed as a gate line. A clipped
 * value with no record of what was clipped is indistinguishable from one that
 * never needed clipping.
 *
 * Deliberately NOT a new column: out.meetings feeds digests A and B, and a
 * diagnostic is not worth moving a frozen schema for. */
proc sql noprint;
    select sum(case when outstandingshare > 0 and 100*sum(votedabstain,votedagainst,votedfor,
                                             brokernonvote,votedwithheld)/outstandingshare > 100
                    then 1 else 0 end),
           sum(case when outstandingshare > 0 and 100*sum(votedabstain,votedagainst,votedfor,
                                             brokernonvote,votedwithheld)/outstandingshare > 120
                    then 1 else 0 end),
           count(*),
           max(case when outstandingshare > 0 then 100*sum(votedabstain,votedagainst,votedfor,
                                              brokernonvote,votedwithheld)/outstandingshare end)
      into :n_to100 trimmed, :n_to120 trimmed, :n_torows trimmed, :max_to trimmed
      from turnout_raw;
quit;
%put NOTE: TURNOUT rows=&n_torows. over100=&n_to100. over120=&n_to120. max_raw=&max_to.;
%put NOTE- TURNOUT over120 are DELETED and 100-120 are CLIPPED, so the panel max reads 100.0;
%put NOTE- TURNOUT this is the only ISS-only check on ISS tso — a rising over100 count;
%put NOTE- TURNOUT means the ISS denominator is drifting, and nothing else here can see it.;

/* --- Join ISS/GL recommendations (if available) --- */
%macro build_turnout;
    %if &have_recs. %then %do;
        /* LEFT JOIN — if recs file doesn't cover the full year range, preserve
         * meetings without recs (rec_iss/rec_gl will be null). An inner join
         * would silently drop every meeting past the recs file's coverage. */
        proc sql;
            create table turnout1 as
                select a.*, b.rec_iss, b.rec_gl, b.prob_iss_1, b.prob_gl_1
                from turnout a
                left join recs_2005_2024 b
                  on a.itemonagendaid = b.itemonagendaid;
        quit;
    %end;
    %else %do;
        data turnout1;
            set turnout;
        run;
    %end;
%mend;
%build_turnout;

/* --- Item-level data with meeting-level average turnout --- */
proc sql;
    create table turnout2 as
        select distinct
        issagendaitemid, itemonagendaid, companyid, meetingid,
        cusip, meetingdate, recorddate, ticker,
        forpct,
        %if &have_recs. %then %do;
        rec_iss, rec_gl,
        %end;
        base, mgmtrec, mgmt_for,
        denom, tso, votedfor, votedagainst, votedabstain,
        brokernonvote, votedwithheld, sponsor, voteresult,
        mean(turnout) as turnout
        from turnout1
        group by companyid, meetingid, cusip, meetingdate, recorddate, ticker;
quit;

proc sort data=turnout2 nodupkey;
    by itemonagendaid;
run;

/* --- Link to CRSP permno + CIK + fight flag --- */
proc sql;
    create table meetings1 as
        select distinct a.*,
            c.cik,
            %if &have_shark. %then %do;
            coalesce(b.fight,0) as fight,
            coalesce(b.fight_definitive,0) as fight_definitive,
            %end;
            %else %do;
            0 as fight,
            0 as fight_definitive,
            %end;
            year(a.meetingdate) as yyyy
        from turnout2 a
        %if &have_shark. %then %do;
        /* TWO FLAGS, NOT ONE REDEFINED.
         *
         *   fight             any campaign whose Campaign_Meeting_Date equals
         *                     this meeting date. The original definition.
         *   fight_definitive  that campaign went to a definitive vote
         *                     (Proxy_Fight_Definitive = 1). Strictly narrower.
         *
         * `fight` is NOT redefined in place because it is a named column in four
         * frozen digests where "fight is 0 everywhere" is a DECLARED property
         * (pipeline_config.sas). Changing what a name means, under a name that
         * something else asserts a property about, is the exact failure that
         * declaration block exists to prevent. A narrower definition is a NEW
         * column; consumers opt in.
         *
         * Both use the same exact-meetingdate join. mirror's build_fight_flags.py
         * instead matches announce-year +/-1 at meeting grain and propagates to
         * every agenda item — a LOOSER match that would raise the hit rate. Not
         * adopted here without a measurement of its false-positive cost. */
        left join
            (select ticker, meetingdate,
                    1 as fight,
                    max(fight_definitive_src) as fight_definitive
             from out.shark2
             where meetingdate is not null and ticker ne ''
             group by ticker, meetingdate) b
            on a.ticker=b.ticker and a.meetingdate=b.meetingdate
        %end;
        left join
            wrdssec.wciklink_ticker c
            on a.ticker=c.ticker
            and a.meetingdate between c.ftdate and min(c.ltdate,today())
        where year(a.meetingdate) ge &year1.
        and year(a.meetingdate) le &year2.;
quit;

proc sort data=meetings1 nodupkey;
    by itemonagendaid;
run;

/* --- CRSP permno: CUSIP match then ticker fallback --- */
/* crsp.stksecurityinfohist, not crsp.msenames: legacy SIZ froze at 2024-12-31
 * and will never advance, so every additional year on it widens the gap against
 * the CIZ tables the ownership legs read. A meetings leg on the legacy universe
 * joined to an ownership leg on the CIZ universe is a 3-5% disagreement INSIDE
 * one panel, which is worse than either universe on its own.
 *
 * The open-interval trick is UNCHANGED and still load-bearing. CIZ closes every
 * interval at its data vintage exactly as SIZ did — crsp.stksecurityinfohist has
 * 191,048 rows and ZERO null secinfoenddt — so a record ending at the vintage
 * means "still current", not "expired". Without this, post-vintage meetings
 * match nothing and drop silently. Vintage is read dynamically so it follows the
 * data instead of a constant someone has to remember to bump. */
proc sql noprint;
    select max(secinfoenddt) format=date9. into :crsp_vintage trimmed
        from crsp.stksecurityinfohist;
quit;
%put NOTE: crsp.stksecurityinfohist vintage max secinfoenddt = &crsp_vintage;

proc sql;
    create table meetings2 as
        select distinct b.permno, a.*
        from meetings1 a, crsp.stksecurityinfohist b
        /* CUSIP8, NOT CUSIP6. cusip6 is issuer-level and maps preferreds and
         * other share classes onto the common permno — D9 cause 2, which leg 2
         * disables in its own fallback. ISS `cusip` is uniformly 9 characters
         * (886,995 of 886,995), so substr(,1,8) is a real cusip8 and not a
         * truncation artefact. Measured cost of tightening across the S12 leg:
         * 1.69pp of matched rows, against fan-out risk on 5.87%. The ticker
         * fallback in meetings3 below still catches items this drops. */
        where substr(a.cusip,1,8)=substr(b.cusip,1,8)
        and a.meetingdate >= b.secinfostartdt
        and (a.meetingdate <= b.secinfoenddt or b.secinfoenddt >= "&crsp_vintage"d);
    create table meetings3 as
        select distinct b.permno, a.*
        from meetings1 a, crsp.stksecurityinfohist b
        where a.ticker = coalescec(b.ticker,b.tradingsymbol)
        and a.meetingdate >= b.secinfostartdt
        and (a.meetingdate <= b.secinfoenddt or b.secinfoenddt >= "&crsp_vintage"d)
        and a.meetingid not in (select distinct meetingid from meetings2);
quit;

data out.meetings;
    set meetings2 meetings3;
run;

proc sort data=out.meetings nodupkey;
    by itemonagendaid;
run;

proc sql;
    select count(distinct meetingid) as num_meetings format=comma12. from out.meetings;
quit;

%put NOTE: build_meetings complete;
