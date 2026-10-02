import polars as pl

COMMON_STOCK = pl.col("shrcd").is_in([10, 11]) & pl.col("exchcd").is_in([1, 2, 3])

msf = pl.read_parquet("data/raw/crsp_msf.parquet")
returns = msf.filter(COMMON_STOCK)

dsf = pl.read_parquet("data/raw/crsp_dsf.parquet")
volume = dsf.filter(COMMON_STOCK)

panel = returns.join(volume, on=["permno", "date"], how="inner")
