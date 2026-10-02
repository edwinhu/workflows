# ---------------------------------------------------------------- estimator

def cluster_ols(y: np.ndarray, X: np.ndarray, g: np.ndarray) -> tuple:
    """OLS with cluster-robust covariance on `g`.  Returns (beta, se)."""
    n, k = X.shape
    xtx = X.T @ X
    xtx_inv = np.linalg.pinv(xtx)
    beta = xtx_inv @ (X.T @ y)
    u = y - X @ beta
    order = np.argsort(g, kind="stable")
    gs, Xs, us = g[order], X[order], u[order]
    bounds = np.flatnonzero(np.r_[True, gs[1:] != gs[:-1], True])
    meat = np.zeros((k, k))
    for a, b in pairwise(bounds):
        s = Xs[a:b].T @ us[a:b]
        meat += np.outer(s, s)
    G = len(bounds) - 1
    dof = (G / max(G - 1, 1)) * ((n - 1) / max(n - k, 1))
    V = xtx_inv @ meat @ xtx_inv * dof
    return beta, np.sqrt(np.maximum(np.diag(V), 0.0)), G


def fe_matrix(df: pd.DataFrame, cols: list[str]) -> np.ndarray:
    """intercept + continuous cols + dummies for sic2 and season (drop-first)."""
    parts = [np.ones((len(df), 1))]
    for c in cols:
        parts.append(df[c].to_numpy(dtype=float).reshape(-1, 1))
    for fe in ("sic2", "season"):
        d = pd.get_dummies(df[fe].astype(str), drop_first=True, dtype=float)
        parts.append(d.to_numpy())
    return np.hstack(parts)


def demean(v: np.ndarray, codes: np.ndarray, ngroups: int) -> np.ndarray:
    """subtract group means along axis 0 (v may be 1-D or 2-D)."""
    v2 = v.reshape(len(v), -1)
    sums = np.zeros((ngroups, v2.shape[1]))
    np.add.at(sums, codes, v2)
    cnt = np.bincount(codes, minlength=ngroups).reshape(-1, 1)
    out = v2 - sums[codes] / cnt[codes]
    return out.reshape(v.shape)


# ---------------------------------------------------------------- estimand A / C

def run_level(panel: pd.DataFrame, outcome: str, label: str) -> pd.DataFrame:
    rows = []
    for def_id in DEFS:
        p0 = panel[panel.def_id == def_id]
        for col, exp_label, _kind in EXPOSURES:
            for ctrl_name, ctrls in (("base(log_at)", ["log_at"]),
                                     ("+board_size", ["log_at", "board_size"])):
                if outcome in ctrls:
                    continue          # regressing an outcome on itself
                need = [outcome, col, "sic2", "season", "gvkey", *ctrls]
                d = p0.dropna(subset=need).copy()
                base = {"estimand": label, "outcome": outcome, "def_id": def_id,
                        "exposure": col, "exposure_label": exp_label,
                        "controls": ctrl_name, "n": len(d),
                        "n_gvkey": d.gvkey.nunique() if len(d) else 0}
                if len(d) < 50:
                    rows.append({**base, "note": "structurally empty / n<50"})
                    continue
                x = d[col].to_numpy(dtype=float)
                nz = int((x != 0).sum())
                base.update(n_nonzero_exposure=nz, exposure_mean=float(x.mean()),
                            exposure_sd=float(x.std(ddof=1)),
                            y_mean=float(d[outcome].mean()),
                            y_sd=float(d[outcome].std(ddof=1)))
                if nz < 5 or x.std() == 0:
                    rows.append({**base, "note": f"degenerate: {nz} non-zero"})
                    continue
                X = fe_matrix(d, [col, *ctrls])
                y = d[outcome].to_numpy(dtype=float)
                beta, se, G = cluster_ols(y, X, d.gvkey.to_numpy())
                b, s = float(beta[1]), float(se[1])
                t = b / s if s > 0 else np.nan
                rows.append({**base, "n_clusters": G, "coef": b, "se": s, "t": t,
                             "p": float(2 * stats.norm.sf(abs(t))) if s > 0 else np.nan,
                             "mde80": MDE_K * s,
                             "coef_per_sd": b * base["exposure_sd"],
                             "mde80_per_sd": MDE_K * s * base["exposure_sd"],
                             "note": ""})
    return pd.DataFrame(rows)


# ---------------------------------------------------------------- estimand B

def build_b_panel(panel: pd.DataFrame, ev: pd.DataFrame) -> pd.DataFrame:
    """d slack_{t+1} = slack_{t+1} - slack_t, with Sued_it per event source."""
    p = panel.sort_values(["def_id", "gvkey", "season"]).copy()
    g = p.groupby(["def_id", "gvkey"], sort=False)
    p["slack_next"] = g.slack.shift(-1)
    p["season_next"] = g.season.shift(-1)
    p = p[(p.season_next == p.season + 1)].copy()
    p["d_slack"] = p.slack_next - p.slack
    return p


def sued_flag(p: pd.DataFrame, ev: pd.DataFrame, srcs: list[str],
              lag_years: int) -> np.ndarray:
    e = ev[ev.src.isin(srcs)].copy()
    e["season"] = e.event_date.dt.year - lag_years
    key = set(zip(e.gvkey, e.season))
    return np.fromiter(((gv, se) in key for gv, se in zip(p.gvkey, p.season)),
                       dtype=bool, count=len(p)).astype(float)


def run_b(bp: pd.DataFrame, ev: pd.DataFrame) -> pd.DataFrame:
    rows = []
    arms = [("deriv", ["deriv"]), ("s220", ["s220"]),
            ("pooled", ["deriv", "s220"]), ("fed_deriv", ["fed_deriv"])]
    for def_id in DEFS:
        d0 = bp[(bp.def_id == def_id)].dropna(subset=["d_slack", "season", "gvkey"])
        if len(d0) < 50:
            continue
        for arm, srcs in arms:
            for lag in (0, 1, 2, 3):
                d = d0.copy()
                d["sued"] = sued_flag(d, ev, srcs, lag)
                ntr = int(d.sued.sum())
                base = {"estimand": "B", "def_id": def_id, "arm": arm,
                        "spec": "real" if lag == 0 else f"placebo t-{lag}y",
                        "n": len(d), "n_gvkey": d.gvkey.nunique(), "n_treated": ntr,
                        "y_mean": float(d.d_slack.mean()),
                        "y_sd": float(d.d_slack.std(ddof=1))}
                if ntr < 5:
                    rows.append({**base, "note": f"degenerate: {ntr} treated firm-years"})
                    continue
                fcodes, _ = pd.factorize(d.gvkey)
                nf = fcodes.max() + 1
                yr = pd.get_dummies(d.season.astype(int).astype(str),
                                    drop_first=True, dtype=float).to_numpy()
                X = np.hstack([d.sued.to_numpy(dtype=float).reshape(-1, 1), yr])
                y = d.d_slack.to_numpy(dtype=float)
                yd = demean(y, fcodes, nf)
                Xd = demean(X, fcodes, nf)
                beta, se, G = cluster_ols(yd, Xd, d.gvkey.to_numpy())
                b, s = float(beta[0]), float(se[0])
                t = b / s if s > 0 else np.nan
                rows.append({**base, "n_clusters": G, "coef": b, "se": s, "t": t,
                             "p": float(2 * stats.norm.sf(abs(t))) if s > 0 else np.nan,
                             "mde80": MDE_K * s, "note": ""})
    return pd.DataFrame(rows)

