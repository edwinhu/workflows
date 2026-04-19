/* build_meetings.sas — ISS vote results with CRSP permno and CIK linkage
 *
 * Prereqs: autoexec.sas loaded (provides libnames: out, risk, crsp, wrdssec)
 *          /scratch/nyu/hue/SharkRepellent 5.21.24.xlsx
 *          ~/projects/pass/recs_2005_2024.csv
 *
 * Output:  out.meetings (item-level vote results with permno, cik, fight flag)
 */

%let year1 = 2003;
%let year2 = 2024;

/* --- Read PostgreSQL credentials from .pgpass --- */
/* Why: risk.vavoteresults SAS libname on WRDS can lag the live PG table by months
 * (NFS cache refresh cycle). Pulling via PG pass-through guarantees current data
 * and filters server-side. */
filename pgf '~/.pgpass';
data _null_;
    infile pgf truncover;
    input line $200.;
    if index(line, 'wrds-pgdata') > 0 then do;
        call symputx('pgpw', scan(line, 5, ':'), 'G');
    end;
run;

%macro pg_connect;
    connect to postgres (server='wrds-pgdata-ident-w.wharton.private'
                         port=9737 user=eddyhu password="&pgpw."
                         database=wrds)
%mend;

/* --- SharkRepellent campaign data (optional) --- */
%let shark_file = /scratch/nyu/hue/SharkRepellent 5.21.24.xlsx;
%global have_shark;
%let have_shark = 0;

%macro load_shark;
    %if %sysfunc(fileexist("&shark_file.")) %then %do;
        %let have_shark = 1;
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

        data out.shark2;
            set out.shark;
            ticker=scan(scan(Company_Ticker,1,'-'),1,'.');
            meetingdate=input(Campaign_Meeting_Date,??anydtdte10.);
            format meetingdate yymmddn8.;
        run;
    %end;
    %else %do;
        %put WARNING: SharkRepellent file not found at &shark_file. — fight flag will be 0 for all obs;
    %end;
%mend;
%load_shark;

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

/* --- ISS vote results via PostgreSQL pass-through (bypasses stale SAS libname) --- */
proc sql;
    %pg_connect;
    create table turnout_raw as
        select * from connection to postgres (
            select cusip, companyid, issagendaitemid, itemonagendaid, meetingid,
                   meetingdate, meetingtype, recorddate, seqnumber, ticker, sponsor,
                   mgmtrec, voteresult, votedfor, votedagainst, votedabstain,
                   votedwithheld, brokernonvote, base, outstandingshare,
                   voterequirement
            from risk.vavoteresults
            where meetingdate >= %str(%')&year1.-01-01%str(%')
              and meetingdate <= %str(%')&year2.-12-31%str(%')
              and voteresult in ('Pass','Fail')
              and meetingtype in (
                'Annual','Special','Annual/Special',
                'Proxy Contest','Proxy Contest (M&A)')
        );
    disconnect from postgres;
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
            %end;
            %else %do;
            0 as fight,
            %end;
            year(a.meetingdate) as yyyy
        from turnout2 a
        %if &have_shark. %then %do;
        left join
            (select distinct ticker, meetingdate, 1 as fight from out.shark2
             where meetingdate is not null) b
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
/* msenames.nameendt at the data vintage is "still current" — extend those records
 * to an open interval so post-vintage meetings (e.g. current-year) match their
 * latest name record instead of being dropped. Vintage is read dynamically. */
proc sql noprint;
    select max(nameendt) format=date9. into :crsp_vintage trimmed
        from crsp.msenames;
quit;
%put NOTE: crsp.msenames vintage max nameendt = &crsp_vintage;

proc sql;
    create table meetings2 as
        select distinct b.permno, a.*
        from meetings1 a, crsp.msenames b
        where substr(a.cusip,1,6)=substr(b.ncusip,1,6)
        and a.meetingdate >= b.namedt
        and (a.meetingdate <= b.nameendt or b.nameendt >= "&crsp_vintage"d);
    create table meetings3 as
        select distinct b.permno, a.*
        from meetings1 a, crsp.msenames b
        where a.ticker = coalescec(b.ticker,b.tsymbol)
        and a.meetingdate >= b.namedt
        and (a.meetingdate <= b.nameendt or b.nameendt >= "&crsp_vintage"d)
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
