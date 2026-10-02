"""Build the firm-year panel from CRSP and Compustat."""
import polars as pl

crsp = pl.read_parquet("data/raw/crsp_msf.parquet")
comp = pl.read_parquet("data/raw/comp_funda.parquet")
link = pl.read_parquet("data/raw/ccmxpf_linktable.parquet")
print(f"loaded crsp={crsp.height:,} comp={comp.height:,}")

common = crsp.filter(pl.col("shrcd").is_in([10, 11]))
linked = common.join(link, on="permno", how="inner")
panel = linked.join(comp, on=["gvkey", "fyear"], how="left")
panel = panel.drop_nulls(subset=["at", "ret"])
panel = panel.unique(subset=["permno", "fyear"])

panel.write_parquet("data/processed/panel.parquet")
