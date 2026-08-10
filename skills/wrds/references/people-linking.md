# Linking PEOPLE across vendors — WRDS People Link

Companies have CCM, CIK crosswalks and tickers. **People have WRDS People Link**, and it is easy to
miss: it lives under Linking Suite rather than beside the people datasets, and the postgres tables
are `wrdsapps_plink_*` rather than anything named "people".

Pairwise identity links across **Execucomp, BoardEx, Thomson/Refinitiv Insiders, CIQ People
Intelligence, and 2iQ Insiders**. Web form:
`/pages/get-data/linking-suite-wrds/wrds-people-link/`.

## The identifiers it bridges

| dataset | person id |
|---|---|
| Compustat Execucomp | `execid` |
| BoardEx | `directorid` |
| Thomson/Refinitiv Insiders | `personid` |
| CIQ People Intelligence | `personid` |
| 2iQ Insiders | `insiderid` |

## What is actually readable (measured, and account-split)

| table | rows | account |
|---|---:|---|
| `wrdsapps_plink_exec_ciq.exec_ciq_link` | 55,182 | eddyhu |
| `wrdsapps_plink_exec_trinsider.exec_trinsider_link` | 59,942 | eddyhu |
| `wrdsapps_plink_trinsider_ciq.trinsider_ciq_link` | 790,551 | eddyhu |
| `wrdsapps_plink_exec_boardex.exec_boardex_link` | 44,373 | **edwin_hu** |
| `wrdsapps_plink_boardex_ciq` | — | **DENIED to both** |

The `_link` tables carry the id pair plus `score` and `matchstyle`; the un-suffixed sibling
(`exec_ciq`, `trinsider_ciq`, …) carries the fuller record with company and name fields.

## BoardEx ↔ CIQ has no direct table — chain through Execucomp

`wrdsapps_plink_boardex_ciq` is the one you want and it is denied unless the account holds BOTH
source subscriptions. The workaround:

```
BoardEx directorid --exec_boardex_link--> execid --exec_ciq_link--> CIQ personid
```

Measured: 44,373 + 55,182 rows chain to **51,387 directorid↔personid pairs** covering 37,710 BoardEx
directors and 34,722 CIQ people.

**The chain inherits Execucomp's universe.** Execucomp covers named officers at S&P 1500 firms, so
the bridge reaches roughly 29% of directors on a small/mid-cap sample (2,122 of 7,208 in one test).
It is a measurement instrument for the subset it covers, not a general person key.

If your account holds both BoardEx and CIQ, request `wrdsapps_plink_boardex_ciq` — it removes the
Execucomp bottleneck and any fuzzy person-matching waterfall built to work around it.

## Why this matters more than it sounds

Name matching people is the highest-risk join in this kind of work: vendors disagree on nicknames
("Al Berkeley III" vs "Alfred Berkeley"), on ordering (CIQ writes `Last, First`; BoardEx writes
`First Last`), and on suffixes. An order-insensitive key plus BoardEx's `usualname` recovers much of
it, but only an identifier settles it.

Worked example of what the identifier route buys: comparing two vendors' rosters for the same
companies, a name-based overlap looked like a nickname problem until People Link showed that of
7,208 BoardEx directors, only 2,122 mapped to a CIQ personid at all and just 953 of those appeared
in the CIQ roster — the vendors genuinely held different people. A name comparison could not have
distinguished that from a spelling artifact.
