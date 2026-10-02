import polars as pl

firms = pl.read_parquet("data/processed/firms.parquet")
matched = firms.filter(pl.col("permno").is_not_null())
match_rate = matched.height / firms.height
print(f"CRSP match rate: {match_rate:.1%} ({matched.height:,} of {firms.height:,} firms)")

has_cik = matched.filter(pl.col("cik").is_not_null())
print(f"Share with a CIK: {has_cik.height / matched.height:.1%} (n={matched.height:,} matched firms)")
