"""Clean TAQ trades before computing the spread measures."""
import polars as pl

trades = pl.read_parquet("data/raw/taq_trades_2019.parquet")
quotes = pl.read_parquet("data/raw/taq_nbbo_2019.parquet")

print(f"before correction filter: {trades.height:,} trades")
regular = trades.filter(pl.col("tr_corr") == "00")
print(f"after: {regular.height:,} ({1 - regular.height / trades.height:.2%} removed)")

print(f"before NBBO match: {regular.height:,} trades, {quotes.height:,} quotes")
matched = regular.join_asof(quotes, on="time_m", by="sym_root", strategy="backward")
print(f"after: {matched.height:,}; null best_bid {matched['best_bid'].null_count():,}")

print(f"before crossed-quote filter: {matched.height:,}")
valid = matched.filter(pl.col("best_ask") > pl.col("best_bid"))
print(f"after: {valid.height:,} ({1 - valid.height / matched.height:.2%} removed)")

valid.write_parquet("data/processed/trades_clean.parquet")
