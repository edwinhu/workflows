# ExecuComp Compensation Data

Executive and director compensation data from S&P's ExecuComp database.

## Tables

| Table | Years | Grain | Description |
|-------|-------|-------|-------------|
| `execcomp.anncomp` | 1992-present | exec-year | Annual compensation for named executives |
| `execcomp.codirfin` | 1996-2006* | firm-year | Director compensation (legacy, **discontinued**) |
| `execcomp.directorcomp` | 2006-present | director-year | Director compensation (current) |

*`codirfin` has rows through 2025 but **all comp fields are NULL after ~2005**. The table is a skeleton.

## CEO Compensation (`anncomp`)

```sql
SELECT gvkey, year, execid, salary, bonus, tdc1,
       option_awards_blk_value, rstkgrnt, ltip, othcomp,
       age, gender, shrown_excl_opts, becameceo
FROM execcomp.anncomp
WHERE ceoann = 'CEO'
```

### Key Variables

| Variable | Description | Notes |
|----------|-------------|-------|
| `tdc1` | Total compensation ($K) | Summary measure |
| `salary` | Base salary ($K) | |
| `bonus` | Cash bonus ($K) | |
| `option_awards_blk_value` | Option grants, Black-Scholes ($K) | Pre-2006 format |
| `rstkgrnt` | Restricted stock grants ($K) | Pre-2006 format |
| `becameceo` | Date became CEO | For computing tenure |
| `ceoann` | CEO annual flag | Filter with `= 'CEO'` |

### Derived Variables

```python
frac_incentive_pay = 1 - (salary + bonus) / tdc1        # where tdc1 > 0
frac_equity_pay = option_awards_blk_value / tdc1         # narrow
frac_equity_pay_broad = (options + rstkgrnt) / tdc1      # broad
ceo_tenure = (year_end_date - becameceo).days / 365.25
```

### Multiple CEOs

Some firm-years have multiple CEO records (transitions). Deduplicate by keeping highest `tdc1`.

## Director Compensation

### Legacy: `codirfin` (1996-~2005)

Firm-year level (one row per firm-year, not per director).

| Variable | Description |
|----------|-------------|
| `anndirret` | Annual retainer ($K) |
| `dirmtgfee` | Per-meeting fee ($K) |
| `nummtgs` | Number of board meetings |
| `dirstk` | Stock-based compensation ($K) |
| `diropt` | Option-based compensation ($K) |

```python
total_director_comp = anndirret + (nummtgs * dirmtgfee) + dirstk + diropt
fraction_equity_pay_dir = (dirstk + diropt) / total_director_comp
```

**CRITICAL**: Rows exist for all years through 2025 but comp fields are NULL after ~2005. Always check for all-null rows and drop them.

### Current: `directorcomp` (2006-present)

Director-year level (one row per director per firm-year). Must aggregate to firm-year.

| Variable | Description |
|----------|-------------|
| `cash_fees` | Cash fees ($K) |
| `stock_awards` | Stock awards ($K) |
| `option_awards` | Option awards ($K) |
| `noneq_incent` | Non-equity incentive ($K) |
| `total_sec` | Total compensation per SEC ($K) |

```python
# Aggregate to firm-year (mean across directors)
agg = df.groupby(["gvkey", "year"]).agg(
    total_director_comp=("total_sec", "mean"),
    meeting_fee=("cash_fees", "mean"),
).reset_index()

# Equity fraction
fraction_equity = (stock_awards.mean() + option_awards.mean()) / total_sec.mean()
```

### Combining Both Tables

```python
# codirfin: 1996-2005 (drop all-null comp rows)
# directorcomp: 2006+ (aggregate to firm-year)
# For overlap year 2006: prefer directorcomp
combined = pd.concat([old[keep_cols], new[keep_cols]])
combined = combined.sort_values(["gvkey", "year"]).drop_duplicates(
    subset=["gvkey", "year"], keep="last"
)
```

## Linking

- **Primary key**: `gvkey` + `year`
- Links to Compustat via `gvkey`
- Links to CRSP via Compustat CCM bridge

## Common Gotchas

1. **`codirfin` looks complete but isn't** -- 4,220 rows/year through 2025, all NULL after 2005
2. **`directorcomp` is director-level** -- must aggregate to firm-year for panel regressions
3. **CEO deduplication** -- ~5% of firm-years have multiple CEO records
4. **Compensation format changed ~2006** -- pre-2006 uses `option_awards_blk_value`/`rstkgrnt`, post-2006 uses different fields in `anncomp`
5. **`gender` in anncomp** -- string field ('MALE'/'FEMALE'), not numeric
