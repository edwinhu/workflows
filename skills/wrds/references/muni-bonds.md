# Municipal bonds on WRDS

**Do NOT use FISD for munis.** `fisd_fisd` (`fisd_mergedissue` / `fisd_mergedissuer`) is the
**corporate/agency/Treasury** bond database (~140k securities). `issuer_type = 'M'` munis in
FISD are incidental, not comprehensive — FISD is not the muni source.

There are **two dedicated muni sources** on WRDS — but see the access caveat: only one is readable.

> **⚠️ Access caveat (Edwin's WRDS subscription — verified this session):** Of the two sources
> below, **only `msrb` is readable.** `tr_sdc_municipals` is *visible* in the catalog
> (`information_schema` / `pg_class` show `deals_data` ~1.6M rows, `ratings` / `maturity` ~916k)
> and its fields are documented, but `SELECT` returns **`permission denied for schema
> tr_sdc_municipals`** — SDC Municipals is **NOT licensed** on this subscription (same for
> `tr_sdc_municipals_old`). The SDC field list below is therefore **aspirational** unless the
> institution adds the SDC subscription. Every other *readable* bond schema (`fisd*`, `markit`,
> `contrib_bond_*`) is **corporate, not muni**.
>
> **Consequence:** `msrb` gives muni **trades + CUSIP-level coupon/maturity/dated_date** but **no
> ratings and no GO-vs-revenue flag.** For muni **ratings** or **GO vs revenue**, WRDS is a **dead
> end** on this subscription → (a) ask the WRDS admin to **add the SDC subscription**, (b) use
> **LSEG/Refinitiv** reference data, or (c) **MSRB EMMA**.

## 1. `msrb.msrb` — MSRB RTRS trades (PRIMARY muni source)

Real-time transaction reporting for the muni secondary market. **Key = 9-digit `cusip`.** ~25
columns. Carries a **CUSIP-level security master inline** — no separate master table needed.

- **Security-master fields (inline):** `coupon`, `maturity_date`, `dated_date`, `security_description`.
- **Trade fields:** `trade_type_indicator` (**P** = purchase from customer / **S** = sale to
  customer / **D** = inter-dealer), `dollar_price`, `yield`, `par_traded`, `trade_date`,
  `time_of_trade`, `settlement_date`, `ats_indicator`, `brokers_broker_indicator`, `cusip6`,
  `rtrs_control_number`, `version_number`.
- `msrb.msrb_lookup` = `cusip6` → `security_description` with `st_date` / `end_date` only.
- Other schemas: `msrb_all`, `msrbsamp` (sample).

**Use for:** muni trades, AND CUSIP-level coupon/maturity via a clean 9-digit join. For a
security master, pull `DISTINCT cusip, coupon, maturity_date, dated_date`. Large table — do bulk
pulls via `qsub` (see `references/sas-etl.md` / HPC patterns), not interactive.

## 2. `tr_sdc_municipals` — SDC Municipals (NOT accessible on this subscription — see caveat)

**`SELECT` is permission-denied on this subscription** — the field list below is documented from
the catalog but cannot be queried until SDC is licensed. New-issue / DEAL-level characteristics.

Primary-market deal characteristics. Keyed by **`master_deal_no`** (one representative
`issuecusip1` per deal). The per-maturity 9-digit CUSIP link is **imperfect** — join on
`cusip6` / issuer, or use the maturity table.

Tables and the fields that matter:
- **`deals_data`** — `bankq` (bank-qualified), `main_callflag` (callable), `taxable`,
  `security` / `specrev` / `general_trans` (GO vs revenue), `amt` / `netp` / `accamt` (issue
  size), `statecode`, `muni_uopcode` (use-of-proceeds / sector), `offtype` (competitive vs
  negotiated), `sale` / `deldate`, `ytm` / `finyield`, `refunded` / `reftype`, `insamt` (insurance).
- **`ratings`** — `fitchrating1`, `moody_rating`, `sp_rating` (per munitranche).
- **`maturity`** — maturity dates / coupons per tranche.
- **`calldata`**, **`managers`**.

**Use for:** ratings, GO vs revenue, bank-qualified, callable, issue size, sector
(use-of-proceeds), competitive vs negotiated, state.

## Recommended muni-characteristics pull (given the access reality)

- **`msrb.msrb`** — the only readable muni source: trades + CUSIP-level **coupon / maturity /
  dated_date** (clean 9-digit join). This is all WRDS gives you on this subscription.
- **`tr_sdc_municipals`** *(would give ratings / sector / size / structure, but is permission-denied
  here)*. To get **ratings** and **GO-vs-revenue** you must go outside WRDS-as-licensed: add the SDC
  subscription (WRDS admin), or use **LSEG/Refinitiv** reference data, or **MSRB EMMA**.

Context: documented while sourcing a **selection control** for the muni-pennying paper — bond
characteristics to control for selection in the bid-wanted auction-penalty result.
