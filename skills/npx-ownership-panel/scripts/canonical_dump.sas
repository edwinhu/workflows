/* canonical_dump.sas — emit a SAS dataset as a canonical CSV for byte-identity checks.
 *
 * WHY: the pipeline's output (out.pass_npx) lives on the WRDS grid as a
 * sas7bdat. canonical_hash.py reads parquet/CSV locally. This is the bridge:
 * it writes a deterministic CSV that canonical_hash.py can digest, so a leg
 * rewritten on the grid can be proven identical to its frozen baseline WITHOUT
 * shipping the whole dataset down and WITHOUT trusting sas7bdat bytes (which
 * embed timestamps and page layout and differ between identical runs).
 *
 * THE THREE THINGS THAT MAKE IT CANONICAL, each of which is a real failure mode:
 *
 *   1. SORT. SGE array tasks finish out of order, so the physical row order of a
 *      stacked result is nondeterministic. Sorting on a declared total key is
 *      what makes two runs comparable at all.
 *   2. FIXED NUMERIC FORMAT. SAS BEST. format emits shortest-round-trip, which
 *      changes with the value. A weighted fraction computed via PostgreSQL and
 *      the same fraction computed in a datastep can differ one ULP and print
 *      differently under BEST. — that is not a data change and must not fail the
 *      test. &PREC significant digits (default 12) is the tolerance.
 *   3. MISSING RENDERED EXPLICITLY. SAS missing prints as "." for numerics and
 *      "" for character, so a null numeric and the string "." are
 *      indistinguishable downstream. Both become empty here, matching what
 *      canonical_hash.py does on the python side.
 *
 * USAGE
 *   %include "canonical_dump.sas";
 *   %canonical_dump(data=out.pass_npx, by=itemonagendaid block,
 *                   out=/scratch/nyu/hue/pass_npx_canon.csv);
 * then locally:
 *   scp wrds:/scratch/.../pass_npx_canon.csv .
 *   python canonical_hash.py pass_npx_canon.csv --keys itemonagendaid,block
 *
 * The digest must equal the frozen baseline. Column ORDER does not matter --
 * canonical_hash.py sorts columns itself -- but the column SET does.
 */

%macro canonical_dump(data=, by=, out=, prec=12);

    %if %superq(data)= or %superq(by)= or %superq(out)= %then %do;
        %put ERROR: canonical_dump requires data=, by= and out=;
        %return;
    %end;

    /* --- 1. total order on the declared key ------------------------------- */
    proc sort data=&data. out=_cd_sorted;
        by &by.;
    run;

    /* --- 2. discover the schema so numeric/char are handled separately ----- */
    proc contents data=_cd_sorted out=_cd_vars(keep=name type varnum format) noprint; run;
    proc sort data=_cd_vars; by varnum; run;

    data _null_;
        set _cd_vars end=eof;
        length hdr $32767 num $32767 chr $32767;
        retain hdr num chr "";
        hdr = catx(",", hdr, lowcase(name));
        /* (P) Only numerics WITHOUT a date/time/datetime format get best&prec.
         * A blanket format clobbers them: meetingdate rendered as 15768 (raw SAS
         * days) instead of a date, which is deterministic but makes the dump
         * incomparable to a parquet baseline holding real dates. Caught on the
         * first grid test. Date-formatted numerics keep their own format. */
        if type = 1 and not (upcase(format) in
              ("DATE" "YYMMDD" "MMDDYY" "DDMMYY" "DATETIME" "TIME" "MONYY" "YYMMDDN"))
            then num = catx(" ", num, name);
        else             chr = catx(" ", chr, name);
        if eof then do;
            call symputx("_CD_HDR", hdr);
            call symputx("_CD_NUM", num);
            call symputx("_CD_CHR", chr);
        end;
    run;

    /* --- 3. write it, rendering every value to a stable string ---------- */
    /* One data step, not PROC EXPORT. EXPORT does not reliably honour an
     * attached FORMAT for csv output, so an earlier draft of this macro applied
     * best&prec. and still emitted default-formatted numbers -- the fixed
     * precision silently did nothing. A PUT with DSD is explicit:
     *   - FORMAT is honoured, so numerics render at &prec sig digits
     *   - DSD writes an EMPTY field for a SAS missing, not "." — matching what
     *     canonical_hash.py emits for null on the python side
     *   - DSD quotes any value containing the delimiter, so an embedded comma
     *     in a fund name cannot shift every downstream column
     */
    data _null_;
        set _cd_sorted;
        %if %superq(_CD_NUM) ne %then %do;
            format &_CD_NUM. best&prec..;
        %end;
        /* dequote: the macro must work whether the caller writes
         *   out=/scratch/x.csv      or   out="/scratch/x.csv"
         * Without this, a quoted path expands to ""/scratch/x.csv"" and SAS
         * parses the path fragments as FILE options ("Invalid option name
         * SCRATCH"). Caught on the first grid test of this macro. */
        file "%sysfunc(dequote(&out.))" dsd dlm="," lrecl=32767;
        if _n_ = 1 then put "&_CD_HDR.";
        put (_all_) (~);
    run;

    proc datasets lib=work nolist nowarn;
        delete _cd_sorted _cd_vars;
    quit;

    %put NOTE: canonical_dump wrote %sysfunc(dequote(&out.)) sorted by (&by.) at &prec. sig digits;

%mend canonical_dump;
