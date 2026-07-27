/* freeze.sas — canonical, deterministic dump of out.pass_npx for identity testing.
 * NOT a byte-compare of sas7bdat/parquet: those embed timestamps, compression state
 * and page layout, so two runs of identical code differ in bytes while the data is
 * the same. This dumps a canonically sorted, fixed-format text form; sha256 of THAT
 * is the identity claim. */
%let tag = &sysparm.;

proc sort data=out.pass_npx out=canon; by itemonagendaid block; run;

/* Fixed formatting at full precision — best20. is deterministic per value and wide
 * enough to expose a float-path difference rather than round it away. */
data _null_;
    set canon;
    file "canon_&tag..txt" lrecl=4000;
    put itemonagendaid best20. "|" block $24. "|"
        n_rows best20. "|" n_for best20. "|" n_against best20. "|"
        n_abstain best20. "|" n_other best20. "|"
        sv_for best20. "|" sv_against best20. "|" sv_abstain best20. "|" n_no_sv best20. "|"
        tna_for best20. "|" tna_against best20. "|" tna_abstain best20. "|" n_no_tna best20. "|"
        n_usable best20. "|" for_frac best20. "|" against_frac best20. "|" abstain_frac best20. "|"
        sv_total best20. "|" tna_total best20. "|" sv_for_frac best20. "|" tna_for_frac best20.;
run;

/* Localisers: if the hash moves, these say WHERE. */
proc sql;
    create table sums_&tag. as
    select count(*) as n_rows_total,
           count(distinct itemonagendaid) as n_items,
           sum(n_rows) as s_n_rows, sum(n_for) as s_n_for, sum(n_against) as s_n_against,
           sum(n_abstain) as s_n_abstain, sum(n_other) as s_n_other,
           sum(sv_for) as s_sv_for, sum(tna_for) as s_tna_for,
           sum(for_frac) as s_for_frac, sum(tna_for_frac) as s_tna_for_frac
    from canon;
    create table blocks_&tag. as
    select block, count(*) as cells, sum(n_rows) as vote_rows
    from canon group by block order by block;
quit;
title "BASELINE SUMS &tag."; proc print data=sums_&tag. noobs; run;
title "BASELINE BLOCKS &tag."; proc print data=blocks_&tag. noobs; run; title;
