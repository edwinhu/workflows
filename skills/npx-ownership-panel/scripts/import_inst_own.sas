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

/* EXISTENCE FIRST, THEN THE HEADER. This used to read the header in open code
 * and check afterwards. When the CSV was absent the infile failed, `got` was
 * never set, and the comparison then died with "A character operand was found in
 * the %EVAL function" -> "The macro CHECK_HEADER will stop executing" — so the
 * guard reported neither a missing file nor a header mismatch. It just stopped,
 * and the run continued past it into an empty out.inst_own.
 *
 * A guard that fails to run is worse than no guard, because its name still
 * appears in the log. Order matters: check the file is there, THEN read it.
 * %superq compares the raw text without re-scanning it for macro triggers. */
%macro check_header;
    %if not %sysfunc(fileexist("&csv.")) %then %do;
        %put ERROR: inst_own.csv not found at &csv.;
        %put ERROR- build_inst_own.py did not write it. Its schema guard refuses;
        %put ERROR- to emit a CSV whose columns disagree with SAS_COLUMNS, so the;
        %put ERROR- cause is upstream in leg 2, not here.;
        data _null_; abort abend; run;
    %end;

    data _null_;
        infile "&csv." obs=1 truncover lrecl=32767;
        input hdr $32767.;
        call symputx("got", strip(hdr));
    run;

    %if %superq(got) ne %superq(expected) %then %do;
        %put ERROR: inst_own.csv header does not match the expected column order.;
        %put ERROR- expected: %superq(expected);
        %put ERROR- got     : %superq(got);
        data _null_; abort abend; run;
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

/* `%if` / `%abort cancel` IN OPEN CODE DOES NOT WORK, and this is what that
 * costs. Observed 2026-07-27: the CSV was absent, this check fired and printed
 * its ERROR — and then SAS said "ERROR: The %ABORT statement is not valid in
 * open code", carried on, and left out.inst_own existing with ZERO rows.
 * merge_panel's gate saw a dataset that existed and built a full panel with no
 * institutional ownership in it.
 *
 * So the detection was right and only the stopping was broken, which is the
 * worst version: a check that reports a fatal condition and then does not stop
 * is indistinguishable in a log from a check that passed. Wrapped in a macro so
 * %if and %abort are in macro context, and `abort abend` in a data step is what
 * actually returns non-zero to SGE. */
%macro _require_rows;
    %if &n. = 0 %then %do;
        %put ERROR: out.inst_own imported 0 rows.;
        %put ERROR- The CSV was missing or empty. build_inst_own.py refuses to;
        %put ERROR- write it when its own schema guard fails, so look THERE first;
        %put ERROR- rather than at this step.;
        data _null_; abort abend; run;
    %end;
%mend;
%_require_rows
