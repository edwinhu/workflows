import polars as pl

msf = pl.read_parquet("data/raw/crsp_msf.parquet")
returns = msf.filter(pl.col("shrcd").is_in([10, 11]) & pl.col("exchcd").is_in([1, 2, 3]))

dsf = pl.read_parquet("data/raw/crsp_dsf.parquet")
volume = dsf.filter(pl.col("shrcd").is_in([10, 11, 12]) & pl.col("exchcd").is_in([1, 2, 3]))

panel = returns.join(volume, on=["permno", "date"], how="inner")
