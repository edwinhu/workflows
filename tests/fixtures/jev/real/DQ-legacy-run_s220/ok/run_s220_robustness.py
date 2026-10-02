# --- excerpt: source lines 20-36 ---
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.run_s220_composition import (
    KS,
    OUTCOMES,
    SEED,
    Wide,
    assign_cohorts,
)

ROOT = Path(__file__).resolve().parents[1]
PROC = ROOT / "data" / "processed"
OUT = ROOT / "data" / "output"
NBOOT = 1000

# --- excerpt: source lines 58-139 ---
def block_b(panel: pd.DataFrame, real: pd.DataFrame) -> pd.DataFrame:
    have = real[(real.ever_sued == 1) & real.k.isin([1, 2])]
    both = (have.groupby("gvkey").k.nunique() == 2)
    keep = set(both[both].index)
    print(f"[B] treated firms observed at BOTH k=+1 and k=+2: {len(keep)}", flush=True)
    sub = panel[(panel.ever_sued == 0) | panel.gvkey.isin(keep)].copy()
    p = assign_cohorts(sub, 0)
    names = [y for y, _ in OUTCOMES]
    w = Wide(p, names)
    rng = np.random.default_rng(SEED)
    n = len(w.firms)
    draws = [rng.integers(0, n, n) for _ in range(NBOOT)]
    rows = []
    for y in names:
        est, ntr, nct = w.att(y, KS)
        boots = {k: [] for k in KS}
        for d in draws:
            e, _, _ = w.att(y, KS, d)
            for k in KS:
                boots[k].append(e[k])
        for k in KS:
            b = np.array(boots[k], float)
            b = b[np.isfinite(b)]
            se = float(np.std(b, ddof=1)) if len(b) > 2 else np.nan
            t = est[k] / se if np.isfinite(se) and se > 0 else np.nan
            rows.append({"outcome": y, "k": k, "att": est[k], "se": se, "t": t,
                         "mde80": 2.802 * se, "n_treated": ntr[k], "n_control": nct[k]})
    d = pd.DataFrame(rows)
    print("[B] balanced-panel CS ATT\n"
          + d.pivot(index="outcome", columns="k", values=["att", "t"]).round(4).to_string(),
          flush=True)
    return d


def block_c() -> pd.DataFrame:
    bx = pd.read_parquet(PROC / "board_company_year_panel.parquet")
    link = pd.read_parquet(PROC / "s220_case_link.parquet").dropna(subset=["gvkey_resp"])
    first = (link.sort_values("filed_on").groupby("gvkey_resp")
             .filed_on.first().rename("filed_first").reset_index()
             .rename(columns={"gvkey_resp": "gvkey"}))
    print(f"[C] linked cases before the filing-date floor: {len(first)}", flush=True)
    first = first.query("filed_first >= '2005-01-01'")
    print(f"[C] linked cases after the filing-date floor: {len(first)}", flush=True)
    bx = bx[bx.gvkey.notna() & (bx.hocountryname == "United States")
            & (bx.board_size >= 3)].copy()
    bx["myear"] = bx.annualreportdate.dt.year
    bx = bx.sort_values(["gvkey", "myear", "board_size"]).drop_duplicates(
        ["gvkey", "myear"], keep="last")
    n0 = len(bx)
    bx = bx.merge(first, on="gvkey", how="left", validate="m:1")
    assert len(bx) == n0
    bx["ever_sued"] = bx.filed_first.notna().astype(int)
    bx["meetingdate"] = bx.annualreportdate
    print(f"[C] BoardEx US firm-years={len(bx)}, gvkeys={bx.gvkey.nunique()}; "
          f"sued gvkeys present={bx.loc[bx.ever_sued == 1, 'gvkey'].nunique()} "
          f"of {len(first)} linked", flush=True)
    p = assign_cohorts(bx, 0)
    tr = p[(p.ever_sued == 1) & p.base_year.notna()]
    print("[C] treated firms by k:\n"
          + tr[tr.k.between(-2, 2)].groupby("k").gvkey.nunique().to_string(), flush=True)
    names = ["board_size", "ned_share", "n_ned"]
    w = Wide(p, names)
    rng = np.random.default_rng(SEED)
    n = len(w.firms)
    draws = [rng.integers(0, n, n) for _ in range(NBOOT)]
    rows = []
    for y in names:
        est, ntr, nct = w.att(y, KS)
        boots = {k: [] for k in KS}
        for d in draws:
            e, _, _ = w.att(y, KS, d)
            for k in KS:
                boots[k].append(e[k])
        for k in KS:
            b = np.array(boots[k], float)
            b = b[np.isfinite(b)]
            se = float(np.std(b, ddof=1)) if len(b) > 2 else np.nan
            t = est[k] / se if np.isfinite(se) and se > 0 else np.nan
            rows.append({"outcome": y, "k": k, "att": est[k], "se": se, "t": t,
                         "mde80": 2.802 * se, "n_treated": ntr[k], "n_control": nct[k]})
    d = pd.DataFrame(rows)
    print("[C] BoardEx CS ATT\n" + d.round(4).to_string(index=False), flush=True)
    return d


