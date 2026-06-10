# WRDS Cross-Dataset Linkage Map

Which WRDS datasets share join identifiers, and the **link tables** that bridge
them. WRDS identifiers rarely join directly — most cross-vendor links go through
a dedicated crosswalk table with effective-date ranges. **Always honor the
date-range columns** (`linkdt`/`linkenddt`, `sec_start_date`/`sec_end_date`,
etc.); a naive equi-join on the bare id over-counts across reassignments.

Schema-verified 2026-06-09 (column lists and link tables confirmed against
`wrds-pgdata`); per-dataset grain is in each dataset's own reference file.

## Identifier spines

| Spine id | Anchors | Reaches |
|----------|---------|---------|
| **gvkey** | Compustat (`comp.*`) | CRSP (via CCM), DealScan (via link), IBES, ISS, SDC (via cusip) |
| **permno / permco** | CRSP (`crsp.*`) | Compustat (via CCM) |
| **cik** | SEC filings (`wrdssec_all.*`, `edgar` parsing, Form 4, Form D, blockholders, proxy-advisors) | gvkey (via wciklink), mutual-fund family (CRSP MFDB) |
| **cusip** (6-digit issuer / 8–9 full) | CRSP, Compustat, ISS, SDC, FISD bonds, blockholders | nearly everything — but watch 6 vs 8 vs 9-digit forms |
| **ticker** | CRSP, ISS, DealScan, PitchBook, SDC | weak — reused/recycled; never a sole key |
| **personid / dcn,seqnum** | Form 4 insiders (`wrdssec_insiders.*`) | within-Form-4 only |
| **dealid / fundid / investorid** | PitchBook (`pitchbk_*`) | within-PitchBook only (vendor-internal) |
| **lpc_deal_id / lpc_tranche_id** | DealScan flat (`tr_dealscan.dealscan`) | gvkey via the DealScan–WRDS link |
| **mgmt_cd** | CRSP Mutual Fund DB (`crsp.fund_hdr`) | cik (proxy-advisors, N-PX fund families) |

## The load-bearing link tables (schema-verified)

### gvkey ↔ permno/permco — CRSP/Compustat Merged (CCM)
`crsp.ccmxpf_lnkhist` — cols: `gvkey, linkprim, liid, linktype, lpermno, lpermco, linkdt, linkenddt`.
Standard filter: `linktype IN ('LU','LC') AND linkprim IN ('P','C')`, and
`date BETWEEN linkdt AND COALESCE(linkenddt, '9999-12-31')`. This is THE bridge
between the accounting world (Compustat: gvkey) and the returns world (CRSP:
permno). Documented in `compustat.md` / `crsp.md`.

### cik ↔ gvkey — WRDS SEC↔Compustat crosswalk
`wrdssec.wciklink_gvkey` — cols include `cik, gvkey, source, link_desc,
sec_start_date, sec_end_date, link_start_date, link_end_date` (+ per-form-type
filing counts `n10k, n10q, n13d, n13f, …` you can use to pick the best-supported
link). Sibling tables `wrdssec.wciklink_{cusip,names,ticker}` map CIK to those
ids (ISSUER-level only — see `blockholders.md`). Bridges every SEC-filing
dataset (Form 4, Form D, 13D/G blockholders, EDGAR index, proxy-advisors) to the
Compustat/CRSP universe.

### DealScan ↔ Compustat (gvkey) — Wharton link
`wrdsapps_link_dealscan_wscope.dswslink` — cols: `companyid, company,
cleaned_matched_name, code, cusip, sedol, isin, ibtic, iso3, sic, spedis_ratio,
…, fdate`. Maps DealScan borrower `companyid`/`code` to Worldscope/Compustat
identifiers. Grain ≈ `(companyid, code)` (90 dupes on `companyid` alone — see
`lpc-dealscan.md`). NOTE: this links the **legacy** DealScan `companyid`; the
2021+ flat table uses `borrower_id`/`lpc_deal_id` and needs the newer
DealScan-PermID linking (see `lpc-dealscan.md`).

### cik ↔ mutual-fund family — CRSP MFDB
`crsp.fund_hdr` carries CIK and `mgmt_cd`; aggregate fund-level SEC data
(N-PX votes, proxy-advisor contracts) to the family via `cik → mgmt_cd`. Used by
`proxy-advisors.md` and the NPX side of `iss-voting.md`.

## Quick "how do I join X to Y"

| From | To | Path |
|------|-----|------|
| Compustat fundamentals | CRSP returns | `gvkey → crsp.ccmxpf_lnkhist → lpermno` |
| Any SEC filing (cik) | Compustat | `cik → wrdssec.wciklink_gvkey → gvkey` |
| Form 4 insider trades | firm fundamentals | Form 4 `cik → wciklink_gvkey → gvkey → CCM → permno` |
| 13D/G blockholders | firm fundamentals | blockholder panel `company_CIK → wciklink_gvkey → gvkey` |
| DealScan loans (legacy) | Compustat | `companyid → dswslink → gvkey` |
| ISS directors/voting | CRSP | `cusip`/`ticker → crsp.stocknames` (see `iss-*.md`) |
| N-PX / proxy-advisor | fund family | `cik → crsp.fund_hdr.mgmt_cd` |
| SDC deals | firm identifiers | `master_cusip/acusip/tcusip (6-digit) → wrdssec.wciklink_cusip → cik/gvkey` |

## Identifiers that DON'T cross vendors

PitchBook (`dealid`, `fundid`, `investorid`, `companyid`), Form 4
(`dcn`,`seqnum`,`personid`), and ISS internal (`companyid`, `director_detail_id`,
`fundid`) are **vendor-internal** — they join only within their own product.
To leave the vendor, route through `cusip`/`cik`/`ticker` and accept the
name-match fuzziness those carry (PitchBook private companies have no public id
at all — `investor.cikcode` exists only for SEC-registered investors).
