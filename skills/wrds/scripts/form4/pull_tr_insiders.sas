/* ===================================================================== */
/* TR-insiders bulk extract (Volkova script 8 port — SAS version).       */
/*                                                                        */
/* Pushes as much work as possible server-side:                          */
/*   1. Range filter on fdate (index-friendly; NEVER year(fdate)=)        */
/*   2. Formtype IN ('3','4','5') + sectitle='COM'                        */
/*   3. cusip6 whitelist loaded from out.cusip6_whitelist                 */
/*   4. Hash-join to CRSP SHROUT (crsp.msf) on (permno, year_month)       */
/*   5. Compute prc_own = 100 * sharesheld / (1000 * shrout)              */
/*   6. Aggregate max(prc_own) per (cusip6, personid, year)               */
/*   7. Export rows with position > 5 to per-year dataset                 */
/*                                                                        */
/* Usage:                                                                 */
/*   sas -sysparm 2024 pull_tr_insiders.sas                              */
/*   qsub run_insider_array.sh      # year-parallel via SGE              */
/*                                                                        */
/* Output: out.tr_insider_panel_&year. (blockholder_CIK, company_cusip6,  */
/*         year, position, owner)                                         */
/* ===================================================================== */

%let year = &sysparm.;
%if %length(&year.)=0 %then %do;
    %put ERROR: must pass -sysparm <year>;
    %abort cancel;
%end;
%put NOTE: Processing TR insiders for year &year.;

/* --- 1. Pull cusip6 whitelist + Form 3/4/5 COM rows for this year ----- */
/* Use PROC SQL pass-through to keep filter on the Postgres side if      */
/* running via remote SAS/ACCESS; otherwise SAS library wins.             */

proc sql;
    create table raw as
        select
            t.fdate,
            t.trandate,
            t.formtype,
            t.personid,
            t.owner,
            t.cname,
            t.cusip6,
            t.sharesheld,
            t.shares_adj,
            t.acqdisp
        from tr_insiders.table1 t
        inner join out.cusip6_whitelist w
            on t.cusip6 = w.cusip6
        where t.fdate between "01jan&year."d and "31dec&year."d
          and t.formtype in ('3', '4', '5')
          and t.sectitle = 'COM'
          and t.sharesheld is not null;
quit;

/* --- 2. Monthly SHROUT from crsp.msf, year-scoped -------------------- */
proc sql;
    create table shrout as
        select
            m.permno,
            m.date,
            m.shrout
        from crsp.msf m
        inner join out.permno_cusip6 p on m.permno = p.permno
        where m.date between "01jan&year."d and "31dec&year."d
          and m.shrout is not null;
quit;

/* Add month-of-filing to raw and shrout for hash key */
data raw_m;
    set raw;
    year_month = intnx('month', trandate, 0, 'B'); /* first of trandate month */
    format year_month yymmdd10.;
run;

data shrout_m;
    set shrout;
    year_month = intnx('month', date, 0, 'B');
    format year_month yymmdd10.;
run;

/* Join cusip6→permno so we can hash on (permno, year_month) */
proc sql;
    create table raw_linked as
        select r.*, p.permno
        from raw_m r
        inner join out.permno_cusip6 p on r.cusip6 = p.cusip6;
quit;

/* --- 3. Hash merge raw rows to SHROUT and compute prc_own ------------ */
data linked;
    if _n_ = 1 then do;
        declare hash h(dataset: "shrout_m");
        h.defineKey("permno", "year_month");
        h.defineData("shrout");
        h.defineDone();
        call missing(shrout);
    end;
    set raw_linked;
    if h.find() = 0 and shrout > 0 then do;
        prc_own = 100 * sharesheld / (1000 * shrout);
        output;
    end;
run;

/* --- 4. Hash accumulator: max(prc_own) per (cusip6, personid) -------- */
/* Plus capture owner name and max transaction date                    */
data agg;
    if _n_ = 1 then do;
        declare hash a();
        a.defineKey("cusip6", "personid");
        a.defineData("cusip6", "personid", "max_prc", "owner", "max_trandate");
        a.defineDone();
        call missing(cusip6, personid, max_prc, owner, max_trandate);
    end;

    set linked end=eof;
    if a.find() ne 0 then do;
        max_prc = prc_own;
        max_trandate = trandate;
    end;
    else do;
        if prc_own > max_prc then max_prc = prc_own;
        if trandate > max_trandate then max_trandate = trandate;
    end;
    a.replace();

    if eof then a.output(dataset: "out.tr_insider_panel_&year.");
run;

/* --- 5. Filter to >5% positions and save -------------------------- */
data out.tr_insider_panel_&year.;
    set out.tr_insider_panel_&year.;
    where max_prc > 5;
    position = round(max_prc, 0.01);
    year = &year.;
    rename cusip6 = company_cusip6 personid = blockholder_CIK owner = blockholder_name;
    keep cusip6 personid max_prc owner position year max_trandate;
run;

proc sql;
    select count(*) as n_rows label="Panel rows for &year."
    from out.tr_insider_panel_&year.;
quit;

%put NOTE: Finished &year. at %sysfunc(datetime(),datetime19.);
