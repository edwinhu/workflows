import itertools

import pandas as pd
import statsmodels.formula.api as smf

panel = pd.read_parquet("data/processed/firm_year.parquet")

CONTROLS = ["log_at", "log_at + leverage", "log_at + leverage + roa"]
SAMPLES = {"all": None, "post2010": "year >= 2010", "nonfin": "sic2 not in (60, 61, 62)"}
WINSOR = [None, 0.01]

rows = []
for controls, (sample, cut), w in itertools.product(CONTROLS, SAMPLES.items(), WINSOR):
    d = panel.query(cut) if cut else panel
    y = d.outcome.clip(*d.outcome.quantile([w, 1 - w])) if w else d.outcome
    fit = smf.ols(f"y ~ treated + {controls} + C(year)", data=d.assign(y=y)).fit(
        cov_type="cluster", cov_kwds={"groups": d.gvkey})
    rows.append({"controls": controls, "sample": sample, "winsor": w,
                 "coef": fit.params["treated"], "p": fit.pvalues["treated"]})

curve = pd.DataFrame(rows).sort_values("coef")
curve.to_csv("data/output/spec_curve.csv", index=False)
print(f"{(curve.p < 0.05).sum()} of {len(curve)} specifications significant at 5%")
