import numpy as np
import polars as pl
from sklearn.model_selection import train_test_split

SEED = 42
rng = np.random.default_rng(SEED)

panel = pl.read_parquet("data/processed/panel.parquet").to_pandas()
train, test = train_test_split(panel, test_size=0.2, random_state=SEED)

draws = []
for _ in range(500):
    fake = rng.permutation(panel["treated"].values)
    draws.append(np.corrcoef(fake, panel["ret"].values)[0, 1])
print("placebo p95:", np.quantile(draws, 0.95))
