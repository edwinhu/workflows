# `wrdssec_all.forms` vs `wrdssec_all.wrds_forms`

WRDS exposes **two** SEC EDGAR index tables in the `wrdssec_all` schema. They look
almost identical but differ in one critical dimension: **which CIKs appear per filing**.

## Summary

| Table | One row per | Includes secondary CIKs? | When to use |
|-------|-------------|--------------------------|-------------|
| `wrdssec_all.forms` | `(CIK, accession)` — every CIK named on the filing header | **Yes** | Default when any CIK role matters (subject co, issuer, reporting owner, co-filers) |
| `wrdssec_all.wrds_forms` | `(accession)` — primary filer only | **No** — filer CIK only | When you only need the filer and want one row per accession |

Both tables share the same columns (`cik`, `accession`, `form`, `fdate`, `fname`, `coname`, `fsize`, …) and the same freshness (WRDS ingests from EDGAR near-daily, typical lag ≤ 3 days).

## Why `forms` is the safer default

SEC filings routinely name **more than one CIK** in the `<SEC-HEADER>` block:

| Form | Roles in header |
|------|-----------------|
| SC 13D / SC 13G | `FILED BY` (blockholder) + `SUBJECT COMPANY` (issuer) |
| Form 4 | `REPORTING-OWNER` (insider) + `ISSUER` (company) |
| Form 144 | `FILER` (seller) + `ISSUER` |
| 8-K, 10-K | Usually single `FILER` |

`wrds_forms` keeps only the primary filer. If you query `WHERE cik = X` against
`wrds_forms`, you will miss every filing where X appears as a **subject company,
issuer, or reporting owner** rather than as the filer. For 13D/G, that means you
miss every filing on a company unless that company happens to also be the filer —
which, by construction, it is not.

`forms` keeps every role's CIK, so `WHERE cik = X` returns every filing that
names X in any role.

## When `wrds_forms` is fine

- **Form-type + date-range queries** (e.g., "all SC 13D filings 2020–2024")
  return the same accession set from either table. If your pipeline fans out to
  parse the filing body anyway (header extraction, cover-page parsing), the
  filelist from `wrds_forms` is equivalent.
- **Counting unique accessions.** `wrds_forms` has one row per accession,
  `forms` has N rows (one per CIK on the filing).

## Recommendation

- **Default to `wrdssec_all.forms`.** Use `SELECT DISTINCT fname, …` if you need accession-level output.
- **Use `wrds_forms` only when you specifically want the primary-filer-only, one-row-per-accession view** and you are not filtering by CIK.
- If you need role labels (`FILER`, `SUBJECT COMPANY`, `ISSUER`, …) as well as CIK, neither table exposes them — self-build via `scan_covers` / `sec_index_rga` SGE scanners. See `references/edgar.md` §"Self-built SEC index via SGE".

## Staleness myth

Both tables are updated from the same upstream WRDS ingest job and share the
same fdate frontier (verified 2026-04-19: both tables had filings through 2026-04-16,
within a ~3-day lag of EDGAR's live index). If your pulled data looks
truncated, suspect your **query bounds** first (`fdate BETWEEN '…' AND '…'`), not
the index.

## Example — 13D/G blockholder metadata

```sql
-- Default (forms): captures any CIK role, safer
SELECT DISTINCT fdate, cik, coname, form, accession, fname
FROM wrdssec_all.forms
WHERE form IN ('SC 13D', 'SC 13D/A', 'SC 13G', 'SC 13G/A')
  AND fdate BETWEEN '2020-01-01' AND '2020-12-31';

-- wrds_forms: identical accession set when filtering by form + date
-- (both tables cover the same filings; wrds_forms just drops secondary CIKs)
```

For 13D/G specifically, the filer IS the blockholder and the subject company is
parsed out of the filing body (header block) — so if you don't need to filter by
company CIK at the SQL layer, either table gives the same accession list.
