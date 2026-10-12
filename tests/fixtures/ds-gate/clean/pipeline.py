import pandas as pd

a = pd.read_csv("a.csv")
assert {"k", "y", "x"} <= set(a.columns), list(a.columns)
print(f"[load] a {len(a):,} rows")
b = a.dropna(subset=["y"])
print(f"[filter] drop NA y: {len(a):,} -> {len(b):,} rows ({len(a) - len(b):,} dropped)")
