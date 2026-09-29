/* make_filelists.sas — per-year DEF 14A filing lists, straight from the grid.
 *
 * Reads /wrds/sec/sasdata/wrds_forms.sas7bdat directly. No PostgreSQL: the SAS
 * view of the SEC index is on the same filesystem as the archive.
 *
 * Emits, under &OUTDIR:
 *   filelist_YYYY.tsv   relpath <TAB> cik <TAB> accession <TAB> form <TAB> fdate
 *   buckets.txt         year ids, one per line
 *   counts.tsv          bucket, n_filings
 *
 * The filelist is TAB-separated, not a bare path list, because the parser needs
 * the FILING DATE and it is not derivable from the archive path. parse_13f's
 * filelists are paths only for exactly that reason — a 13F carries its own
 * period of report inside the document; a proxy's ownership table does not.
 *
 * The path mapping is the one in references/edgar.md:
 *   fname 'edgar/data/104169/0000104169-24-000123.txt'
 *     -> '000010/104169/0000104169-24-000123.txt'
 *   (CIK zero-padded to 10, first 6 chars are the parent directory)
 *
 * Buckets are FILING-date years. That is a pure partition of the filing
 * universe, so the union of all shards is invariant to the choice.
 *
 * Run it with the run_sas.sh wrapper — SAS lives on the compute nodes, not on
 * the login host:
 *   qsub -pe onenode 2 -l m_mem_free=8G sge/run_sas.sh sge/make_filelists.sas
 */

%let OUTDIR = /scratch/nyu/eddyhu/parse_def14a_own/filelists;
%let D0 = '01JAN1996'd;
%let D1 = '31DEC2021'd;
%let FORMS = 'DEF 14A';   /* DEFA14A is a supplement; DEFM14A is a merger proxy */

libname secsas '/wrds/sec/sasdata' access=readonly;

data px;
  set secsas.wrds_forms(keep=fdate rdate form cik accession fname coname);
  where form in (&FORMS) and &D0 <= fdate <= &D1;
  length bucket $4 relpath $120 cikint $10;
  bucket  = put(year(fdate), 4.);
  cikint  = scan(fname, 3, '/');
  relpath = cats(substr(put(input(cikint, best12.), z10.), 1, 6), '/',
                 cikint, '/', scan(fname, 4, '/'));
run;

proc sort data=px out=pxs; by bucket relpath; run;

data _null_;
  set pxs;
  by bucket;
  length fn $200;
  fn = cats("&OUTDIR/filelist_", bucket, ".tsv");
  file dummy filevar=fn lrecl=400;
  put relpath '09'x cikint '09'x accession '09'x form '09'x fdate yymmdd10.;
run;

proc sql;
  create table cnt as
    select bucket, count(*) as n_filings
    from pxs group by bucket order by bucket;
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
  from pxs;
quit;
