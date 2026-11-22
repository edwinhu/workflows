# `wrdssec_all.forms` vs `wrdssec_all.wrds_forms`

Measured 2026-11-22 on wrds-pgdata over five filing weeks (Mon–Fri): 1998-03-02, 2005-03-07, 2015-03-02, 2023-03-06, 2026-03-02.

## Default: `wrds_forms`

Both tables hold one row per `(accession, CIK)` for **every CIK in the SEC header** — filer, subject company, issuer, reporting owner, filed-by. Default to `wrds_forms`: it alone has `accession`, `wrdsfname` (the on-disk path bulk pulls need, `edgar.md` § Grain & Keys), `regcount`, `doccount`, `fsize` and the acceptance timestamps. `forms` has no `accession` (derive it from the `fname` stem) and adds only `gvkey`, `iname` and `source`.

| Table | Key | CIKs per filing | Columns only here |
|---|---|---|---|
| `wrdssec_all.wrds_forms` | `(accession, cik)`; `fname` | every header CIK | `accession`, `wrdsfname`, `regcount`, `doccount`, `fsize`, `secadate`/`secatime` |
| `wrdssec_all.forms` | `fname` | every header CIK | `gvkey`, `iname`, `source` |
| `wrdssec_all.wrds_forms_reg` | `(accession, regcik, regrole)` + `regseq` | every header CIK, with its role | `regrole` and the header blocks (`edgar.md` § pre-parsed header table) |

`fname` is `edgar/data/<cik>/<accession>.txt`, so a co-registrant filing has one `fname` per CIK. Count filings with `COUNT(DISTINCT accession)`.

## Grain (rows = distinct `(accession, cik)` in both tables)

| Week of | `forms` rows | `forms` accessions | `wrds_forms` rows | `wrds_forms` accessions | `wrds_forms` rows with `regcount` > 1 |
|---|---:|---:|---:|---:|---:|
| 1998-03-02 | 6,416 | 5,419 | 6,395 | 5,401 | 1,374 |
| 2005-03-07 | 20,030 | 13,208 | 20,010 | 13,195 | 13,186 |
| 2015-03-02 | 32,443 | 21,620 | 32,438 | 21,616 | 20,708 |
| 2023-03-06 | 24,529 | 16,473 | 24,525 | 16,470 | 16,046 |
| 2026-03-02 | 39,420 | 25,329 | 39,420 | 25,329 | 28,634 |

Every `(accession, regcik)` in `wrds_forms_reg` is in `wrds_forms` in all five weeks. In 1998 `wrds_forms` has 239 more (mostly Form 3/4/5 CIKs the header table lacks).

## Role CIKs are in both tables

Share of `wrds_forms_reg` role CIKs found as `(accession, cik)` in each table, by form (amendments pooled). 100.0% in every cell, both tables:

| Form | Roles | n 1998 | n 2005 | n 2015 | n 2023 | n 2026 |
|---|---|---:|---:|---:|---:|---:|
| SC 13D (SCHEDULE 13D in 2026) | FILED BY / SUBJECT COMPANY | 177 / 177 | 145 / 145 | 115 / 115 | 94 / 94 | 130 / 130 |
| SC 13G (SCHEDULE 13G in 2026) | FILED BY / SUBJECT COMPANY | 258 / 258 | 328 / 328 | 103 / 103 | 314 / 314 | 268 / 268 |
| 4 | REPORTING OWNER / ISSUER | — / 185 ¹ | 5,181 / 4,880 | 8,487 / 8,218 | 6,039 / 5,670 | 9,047 / 8,709 |
| 144 | REPORTING OWNER / SUBJECT COMPANY | — / 2 ¹ | 13 / 13 | 19 / 19 | 104 / 104 | 1,449 / 1,449 |

¹ 1998 headers label the Form 4/144 issuer `SUBJECT COMPANY` and carry no `REPORTING OWNER` block.

So `WHERE cik = X` on `wrds_forms` returns filings naming X in any role. For the role itself, join `wrds_forms_reg` on `accession` and `regcik = cik`.

## Where the two disagree

Set difference of `(cik::bigint, fname)`, per week:

| Week of | in `forms` only | in `wrds_forms` only |
|---|---:|---:|
| 1998-03-02 | 21 | 0 |
| 2005-03-07 | 20 | 0 |
| 2015-03-02 | 5 | 0 |
| 2023-03-06 | 5 | 1 |
| 2026-03-02 | 0 | 0 |

- 48 of the 51 `forms`-only rows are accessions absent from `wrds_forms` altogether, scattered across forms (REGDEX, X-17A-5, CORRESP, UPLOAD, SEC STAFF LETTER, 3/4/5, 8-K, SC 13G, SC 13D/A, PREC14A and others, at most 7 per form-week). Not a role filter: every CIK of such an accession is missing.
- 3 are the same accession filed under a different CIK in `wrds_forms` (two 1998 13F-E/A, one 2005 N-6F/A).
- The one `wrds_forms`-only row is an 8-K whose `fdate` is 2023-03-08 in `wrds_forms` and 2023-03-03 in `forms`.

Need one of those few form types complete for early years: union in `forms`.

## Freshness

`max(fdate)` = 2026-11-19 in `forms`, `wrds_forms` and `wrds_forms_reg` (queried Sunday 2026-11-22). Filings past it: `sec-gov.md`.

## Example — 13D/G on one subject company

```sql
SELECT DISTINCT w.accession, w.fdate, w.form, w.wrdsfname
FROM wrdssec_all.wrds_forms w
JOIN wrdssec_all.wrds_forms_reg r ON r.accession = w.accession AND r.regcik = w.cik
WHERE w.cik = %s                       -- 10-digit string
  AND r.regrole = 'SUBJECT COMPANY'
  AND w.form ~ '^(SC 13[DG]|SCHEDULE 13[DG])'
  AND w.fdate BETWEEN %s AND %s;
```
