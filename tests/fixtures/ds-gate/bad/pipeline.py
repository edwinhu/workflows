import pandas as pd
import statsmodels.api as sm

a = pd.read_csv("a.csv")
b = pd.read_csv("b.csv")
m = a.merge(b, on="k")
m = m.dropna()
res = sm.OLS(m.y, sm.add_constant(m.x)).fit()
res.summary()
