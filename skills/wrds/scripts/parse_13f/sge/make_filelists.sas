/* make_filelists.sas — per-quarter 13F filing lists, straight from the grid.
 *
 * Reads /wrds/sec/sasdata/wrds_forms.sas7bdat directly. No PostgreSQL: the
 * SAS view of the SEC index is on the same filesystem as the archive, and the
 * whole extract runs in about ten seconds on one compute node.
 *
 * Emits, under &OUTDIR:
 *   filelist_YYYYQQ.txt   archive-relative paths, one per line
 *   buckets.txt           quarter ids, one per line
 *   counts.tsv            quarter, n_filings
 *
 * The path mapping is the one in references/edgar.md:
 *   fname 'edgar/data/1034196/0001104659-20-000437.txt'
 *     -> '000103/1034196/0001104659-20-000437.txt'
 *   (CIK zero-padded to 10, first 6 chars are the parent directory)
 *
 * Quarters here are FILING-date quarters. That is a pure partition of the
 * filing universe, so the union of all shards is invariant to the choice;
 * period-of-report comes out of the filing itself as a parsed column.
 *
 * Run it with the run_sas.sh wrapper — SAS lives on the compute nodes, not on
 * the login host:
 *   qsub -pe onenode 2 -l m_mem_free=8G run_sas.sh make_filelists.sas
 */

%let OUTDIR = /scratch/nyu/hue/parse_13f/filelists;
%let D0 = '01OCT2016'd;
%let D1 = '31MAR2026'd;
%let FORMS = '13F-HR', '13F-HR/A';   /* 13F-NT is a notice: no holdings table */

libname secsas '/wrds/sec/sasdata' access=readonly;

data f13;
  set secsas.wrds_forms(keep=fdate rdate form cik accession fname);
  where form in (&FORMS) and &D0 <= fdate <= &D1;
  length bucket $6 relpath $80 cikint $10;
  bucket  = cats(put(year(fdate), 4.), 'Q', put(qtr(fdate), 1.));
  cikint  = scan(fname, 3, '/');
  relpath = cats(substr(put(input(cikint, best12.), z10.), 1, 6), '/',
                 cikint, '/', scan(fname, 4, '/'));
run;

proc sort data=f13 out=f13s; by bucket relpath; run;

data _null_;
  set f13s;
  by bucket;
  length fn $200;
  fn = cats("&OUTDIR/filelist_", bucket, ".txt");
  file dummy filevar=fn lrecl=300;
  put relpath;
run;

proc sql;
  create table cnt as
    select bucket, count(*) as n_filings
    from f13s group by bucket order by bucket;
quit;

data _null_;
  set cnt;
  file "&OUTDIR/buckets.txt";
  put bucket;
run;

data _null_;
  set cnt;
  file "&OUTDIR/counts.tsv";
  if _n_ = 1 then put "bucket" '09'x "n_filings";
  put bucket '09'x n_filings;
run;

proc sql;
  select count(*) as total_filings, count(distinct bucket) as n_buckets
  from f13s;
quit;
