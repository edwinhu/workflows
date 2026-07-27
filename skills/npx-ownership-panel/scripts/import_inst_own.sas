/* import_inst_own.sas — land build_inst_own.py's panel as out.inst_own.
 *
 * WHY THIS STEP EXISTS. merge_panel.sas requires out.inst_own and its header
 * still says "(from build_inst_own.sas)". When leg 2 became the EDGAR Python
 * builder, nothing replaced the SAS leg's direct write to the out library, so
 * merge_panel aborted its own prerequisite gate on a pipeline that had
 * otherwise run clean. This is that missing step.
 *
 * WHY CSV AND NOT THE .xpt build_inst_own.py used to write: SAS 9.4 cannot read
 * it ("ERROR: File XIN.DATASET.DATA is not a SAS data set"), and xport's 8-char
 * limit renamed `numowners`->NUMOWN and `io_total`->IO_TOT, which are the names
 * merge_panel's MERGE_ASOF asks for by name.
 *
 * Usage: qsub run_sas.sh import_inst_own.sas <path/to/inst_own.csv>
 */
%let csv = %sysfunc(compress(&sysparm., %str(%'%")));
%put NOTE: IMPORT reading &csv.;

/* The INPUT below is POSITIONAL. build_inst_own.py writes SAS_COLUMNS in this
 * exact order and a drift would silently shift every value one column left.
 * Read the header and abort on mismatch rather than trust it. */
%let expected = permno,rdate,numowners,io_total,ioc_hhi,dbreadth,ior,tso,me,p,cfacshr,io_missing,io_g1,split_quarter,split_adjacent,shortint,si_missing,shortint_adj,io_total_net,si_frac,ior_net,net_clamped;

data _null_;
    infile "&csv." obs=1 truncover lrecl=32767;
    input hdr $32767.;
    call symputx("got", strip(hdr));
run;

%macro check_header;
    %if %quote(&got.) ne %quote(&expected.) %then %do;
        %put ERROR: inst_own.csv header does not match the expected column order.;
        %put ERROR- expected: &expected.;
        %put ERROR- got     : &got.;
        %abort cancel;
    %end;
    %else %put NOTE: IMPORT header OK (22 columns, order verified);
%mend;
%check_header;

data out.inst_own;
    infile "&csv." dsd firstobs=2 truncover lrecl=32767;
    input permno rdate_yyyymmdd numowners io_total ioc_hhi dbreadth ior tso me p
          cfacshr io_missing io_g1 split_quarter split_adjacent shortint
          si_missing shortint_adj io_total_net si_frac ior_net net_clamped;

    /* merge_panel does `recorddate = rdate` and MERGE_ASOFs it against
     * out.meetings.recorddate, which is a SAS date. The panel carries rdate as
     * a YYYYMMDD integer, so convert — comparing 20170930 against a SAS date
     * would match nothing and quietly empty the join. */
    rdate = input(put(rdate_yyyymmdd, 8.), yymmdd8.);
    format rdate yymmdd10.;
    drop rdate_yyyymmdd;
run;

proc sql noprint;
    select count(*), count(distinct permno), min(rdate), max(rdate)
      into :n trimmed, :np trimmed, :d1 trimmed, :d2 trimmed
    from out.inst_own;
quit;
%put NOTE: IMPORTSTAT out.inst_own rows=&n. permnos=&np. rdate=&d1.-&d2.;

%if &n. = 0 %then %do;
    %put ERROR: out.inst_own imported 0 rows.;
    %abort cancel;
%end;
