/* split_s12.sas — Read S12 via PostgreSQL (no NFS contention), partition by year range
 *
 * Prereqs: autoexec.sas loaded (provides libnames: out)
 *          ~/.pgpass has WRDS PostgreSQL credentials
 *
 * Output:  out.s12_YYYY_YYYY for each year range (on /scratch)
 *
 * Why: tfn.s12 is 44GB / ~250M rows on NFS. Multiple parallel SAS jobs reading it
 *      causes severe I/O contention (~40 min each vs ~5 min solo). Reading via
 *      PostgreSQL avoids NFS entirely, and server-side WHERE means we only transfer
 *      needed rows. Partitions on /scratch (~40GB total) enable zero-contention
 *      parallel processing. Takes ~15 min for all 9 partitions.
 *
 * WRDS PostgreSQL schema: tr_mutualfunds.s12 (not tfn.s12)
 *
 * Year ranges are balanced by row count (~22-34M each):
 *   2003-2010: ~34M / 5.4GB  (8 years, pre-explosion)
 *   2011-2016: ~27M / 4.3GB  (6 years, moderate growth)
 *   2017-2018: ~30M / 4.7GB  (2 years, data explosion starts)
 *   2019-2024: ~22-27M / 3.6-4.2GB each (1 year per chunk, post-explosion)
 */

%include "pipeline_config.sas";
%put NOTE: split_s12 started at %sysfunc(datetime(),datetime19.);

/* --- Read PostgreSQL credentials from .pgpass --- */
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

/* --- Extract S12 year-range partitions via PostgreSQL --- */
%macro extract_partition(y1, y2);
    proc sql;
        %pg_connect;
        create table out.s12_&y1._&y2. as
            select * from connection to postgres (
                select fdate, fundname, fundno, rdate, cusip, shares
                from tr_mutualfunds.s12
                where rdate >= %str(%')&y1.-01-01%str(%')
                  and rdate <= %str(%')&y2.-12-31%str(%')
                  and shares > 0
            );
        disconnect from postgres;
    quit;
    proc sql noprint;
        select count(*) format=comma14. into :cnt from out.s12_&y1._&y2.;
    quit;
    %put NOTE: s12_&y1._&y2.: &cnt rows;
%mend;

/* Ranges come from pipeline_config.sas (&S12_RANGES) so this script and
 * run_pipeline.sh cannot disagree about which partitions exist. */
%macro extract_all;
    %local i r;
    %let i = 1;
    %do %while (%scan(&S12_RANGES., &i., %str( )) ne );
        %let r = %scan(&S12_RANGES., &i., %str( ));
        %extract_partition(%scan(&r., 1, -), %scan(&r., 2, -));
        %let i = %eval(&i. + 1);
    %end;
%mend;
%extract_all

%put NOTE: split_s12 complete at %sysfunc(datetime(),datetime19.);
