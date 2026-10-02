# Audit Analytics on WRDS — shareholder activism (feed31)

**Check here before parsing 13D cover pages.** `feed31` already holds, for every Schedule 13D and
13D/A, the subject CIK, the filer, the accession and coded purposes. A `scan_covers` run to get
those fields duplicates a single query. Measured 2026-10-01 (hidden-figures, AGK 2019): all 73
13D accessions we had parsed from covers were in `feed31`, with the same subject CIK.

## Access is account-split

| schema | `edwin_hu` (UVA) | `eddyhu` (NYU) |
|---|---|---|
| `audit` (views) | readable | not tested |
| `audit_corp_legal` (tables) | readable | `permission denied for schema audit_corp_legal` |
| `audit_corp_legal_old` | denied | not tested |

Use `edwin_hu`. The same table appears as the view `audit.feed31_shareholder_activism` and the
table `audit_corp_legal.feed31_shareholder_activism`. Also in `audit_corp_legal`: `f14_lit_legal_case`
(securities litigation; see `source-verify`).

## Tables

| table | grain | notes |
|---|---|---|
| `feed31_shareholder_activism` | one row per filing; `active_share_key` unique | 223 columns. Forms: SC 13D, SC 13D/A, plus a few SC TO-T. **No 13G.** |
| `f31_active_shareholder_reason` | 36-row lookup of purpose keys | the `*_text` columns repeat these titles; there is no free text |
| `f31_active_shareholder_to_reason` | filing × reason key | long form of the key columns |
| `audit.feed12_company_block` | one row per `company_fkey` (CIK) | `cusip_number` (9 characters; **one per CIK, not historical**; null for ~27%), ISIN, ticker, `is_in_sp500` |

Key `feed31` columns:
- `company_fkey`: subject CIK
- `active_share_rep_fkey`: filer id, with its name column
- `iss_file_date`: filing date
- `iss_file_fkey`: `edgar/data/<subject CIK>/<accession>.txt`, so the accession is recoverable
- `agg_shares_owned`, `agg_percent_class_owned`: the stake
- `dispute_management`: a flag
- seven pipe-delimited purpose-key columns (`agree_keys`, `concerns_keys`, `control_keys`, `disc_keys`, `dispute_keys`, `other_keys`, `support_keys`; values like `|8|22|`)

Purpose keys used in practice:
- board: 8 (change or nominate the board), 22 (control the board)
- dispute: 13–15; litigation: 31
- settlement-type: 24 (board composition), 28 (litigation settlement), 35 (standstill)
- no stated goal: 16 (investment purposes), 17 (not applicable)

These groupings are readings of the lookup, not AA-defined variables.

Size: 2007–2015 holds 58,259 filings and 8,748 subject CIKs. All four tables pull in about 5 s in
one query each.

## What it is not

- **Not a campaign table.** To build campaigns, group filings by (subject CIK, filer) and take the earliest original SC 13D. Of 20,396 pairs in 2007–2015, 4,534 are amendment-only.
- **No proxy-fight, settlement, seats-sought or SharkWatch50 field.** For those, use SharkRepellent/FactSet or SDC Activism (LSEG; see the `lseg-data` skill). Board keys recover ~62% of SharkRepellent board-representation campaigns within 365 days, but only ~8% on the announcing filing, because board intent usually appears in an amendment. The dispute and settlement keys predict SharkRepellent's proxy-fight and settlement flags no better than a constant.
- **Campaigns without a 13D are absent:** 37% of the AGK 2019 events.

## Linking to CRSP

Link by CIK through a CIK–gvkey–permco history where you have one. Otherwise use the
`feed12_company_block` CUSIP against CRSP name spells valid on the filing date. Because that
CUSIP is a single current value, the link rate climbs from 25% of filings (2007) to 60% (2015),
so link coverage is not constant over time. For historical CUSIPs, parse the cover pages of just
the filings `feed31` names; there is no need to scan the whole forms index.

Worked example (pull script, cross-check, tables): `~/projects/hidden-figures/scripts/92_agk2019_audit_analytics_crosscheck.py`,
`docs/investigations/2026-10-01_audit-analytics-activism.md`.
