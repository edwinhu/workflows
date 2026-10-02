"""Build the firm-year panel from CRSP and Compustat."""
import polars as pl

crsp = pl.read_parquet("data/raw/crsp_msf.parquet")
comp = pl.read_parquet("data/raw/comp_funda.parquet")
link = pl.read_parquet("data/raw/ccmxpf_linktable.parquet")
print(f"loaded crsp={crsp.height:,} comp={comp.height:,}")

common = crsp.filter(pl.col("shrcd").is_in([10, 11]))
print(f"[chain] common stock: {crsp.height:,} -> {common.height:,}")
linked = common.join(link, on="permno", how="inner")
print(f"[chain] CCM link: {common.height:,} -> {linked.height:,}")
panel = linked.join(comp, on=["gvkey", "fyear"], how="left")
print(f"[chain] + Compustat (left): {linked.height:,} -> {panel.height:,}")
assert panel.height == linked.height, "left join fanned out"
panel = panel.drop_nulls(subset=["at", "ret"])
print(f"[chain] non-null at, ret: {panel.height:,}")
panel = panel.unique(subset=["permno", "fyear"])
print(f"[chain] one row per permno-year: {panel.height:,}")

panel.write_parquet("data/processed/panel.parquet")
