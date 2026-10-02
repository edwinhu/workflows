"""Clean TAQ trades before computing the spread measures."""
import polars as pl

trades = pl.read_parquet("data/raw/taq_trades_2019.parquet")
quotes = pl.read_parquet("data/raw/taq_nbbo_2019.parquet")

regular = trades.filter(pl.col("tr_corr") == "00")
print(f"after correction filter: {regular.height:,} trades")

matched = regular.join_asof(quotes, on="time_m", by="sym_root", strategy="backward")
print(f"after NBBO match: {matched.height:,} trades")

valid = matched.filter(pl.col("best_ask") > pl.col("best_bid"))
print(f"after crossed-quote filter: {valid.height:,} trades")

valid.write_parquet("data/processed/trades_clean.parquet")
