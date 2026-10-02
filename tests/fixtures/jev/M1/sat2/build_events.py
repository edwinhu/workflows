from pathlib import Path
import polars as pl

OUT = Path("data/output")
events = pl.read_parquet("data/processed/events.parquet")
panel = events.filter(pl.col("day").is_between(-10, 10))
panel.write_parquet(OUT / "event_panel.parquet")
fig = panel.group_by("day").agg(pl.col("car").mean()).sort("day").plot.line(x="day", y="car")
fig.save(OUT / "car_figure.png")
