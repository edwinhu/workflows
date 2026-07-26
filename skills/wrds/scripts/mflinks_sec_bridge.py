#!/usr/bin/env python3
"""Prototype: bridge Thomson S12 `fundno` to CRSP `crsp_portno` via SEC series IDs.

Chain:  S12 name --(fuzzy)--> SEC series name --(exact)--> series_cik
                --(exact)--> crsp_fundno --(exact)--> crsp_portno

Calibrates against a NEGATIVE CONTROL (non-US unbridged S12 funds, which bridge
at 0.3%, so any match there is a false positive) and a POSITIVE set (US funds
that MFLINKS already bridges, which give ground-truth top-1 accuracy).

See docs/investigations/2026-07-26_mflinks-rebuild.md for measured results.

Usage:
    uv run --with psycopg2-binary,pandas,pyarrow,openpyxl,scikit-learn,sparse_dot_topn \
        python mflinks_sec_bridge.py \
            --date 2022-12-31 \
            --sec-csv sc_2022.csv \
            --xlsx S12_Names_20250630.xlsx

SEC annual series/class CSVs live under
https://www.sec.gov/files/investment/data/other/investment-company-series-and-class-information/
Fetch them with a DECLARING User-Agent (name + email) — a spoofed browser UA 403s.
See the `sec-fetch` skill.
"""
import argparse, re, warnings
import numpy as np, pandas as pd, psycopg2
from sklearn.feature_extraction.text import TfidfVectorizer
from sparse_dot_topn import sp_matmul_topn

warnings.filterwarnings("ignore")

# ---------------------------------------------------------------- normalization

ABBR = {
    r"\bINTL\b": "INTERNATIONAL", r"\bINTRNTL\b": "INTERNATIONAL",
    r"\bGOVT\b": "GOVERNMENT", r"\bCORP\b": "CORPORATE", r"\bMUNI\b": "MUNICIPAL",
    r"\bEQ\b": "EQUITY", r"\bMKT\b": "MARKET", r"\bMKTS\b": "MARKETS",
    r"\bEMG\b": "EMERGING", r"\bGRWTH\b": "GROWTH", r"\bGRTH\b": "GROWTH",
    r"\bIDX\b": "INDEX", r"\bSML\b": "SMALL", r"\bCP\b": "CAP",
    r"\bSHS\b": "SHARES", r"\bTR\b": "TRUST", r"\bPTF\b": "PORTFOLIO",
    r"\bPORT\b": "PORTFOLIO", r"\bS&P\b": "SP", r"\bSER\b": "SERIES",
    r"\bAGGR\b": "AGGRESSIVE", r"\bALLOC\b": "ALLOCATION", r"\bDIVID\b": "DIVIDEND",
    r"\bOPPORT\b": "OPPORTUNITIES", r"\bSTRAT\b": "STRATEGY", r"\bMGD\b": "MANAGED",
    r"\bVAL\b": "VALUE",
}
CLASS_WORDS = set("""CLASS CL SHARES SHARE UNITS UNIT INSTITUTIONAL INSTL INST INVESTOR INV
ADVISOR ADVISER ADV RETIREMENT RETIRE SERVICE SVC ADMINISTRATIVE ADMIN ADMIRAL PREMIER
SELECT SIGNAL LOAD NOLOAD A B C D E F G H I J K L M N P Q R S T W X Y Z
R1 R2 R3 R4 R5 R6 R7 A1 A2 C1 C2 T1 Y1 Z1 1 2 3 4 5 6 7 8 9 II III IV NL""".split())
DROP = re.compile(r"\b(THE|FUND|FUNDS|PORTFOLIO|PORTFOLIOS|TRUST|TRUSTS|INC|INCORPORATED"
                  r"|CORP|CORPORATION|LP|LLC|PLC|LTD|COMPANY|CO|OF|AND)\b")


def _strip_class(s: str) -> str:
    t = s.split()
    while len(t) > 1 and t[-1] in CLASS_WORDS:
        t.pop()
    return " ".join(t)


def norm(s) -> str:
    """Normalize a fund name for char-ngram matching."""
    if not isinstance(s, str):
        return ""
    s = s.upper().replace("&", " AND ")
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    for k, v in ABBR.items():
        s = re.sub(k, v, s)
    # mid-name INC means INCOME; trailing INC means Incorporated (dropped below)
    s = re.sub(r"\bINC\b(?!$)", "INCOME", s)
    s = _strip_class(s)
    s = DROP.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return _strip_class(s)


def top1(left, right, thr=0.5):
    """Top-1 char_wb 2-4gram TF-IDF cosine match. Returns (li, ri, score) frame."""
    v = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), min_df=1)
    R = v.fit_transform(right)
    L = v.transform(left)
    M = sp_matmul_topn(L, R.T.tocsr(), top_n=1, threshold=thr, sort=True).tocoo()
    return pd.DataFrame({"li": M.row, "ri": M.col, "score": M.data})


# ---------------------------------------------------------------- data loading

def load_wrds(date, user):
    c = psycopg2.connect(host="wrds-pgdata.wharton.upenn.edu", port=9737,
                         dbname="wrds", user=user, sslmode="require")
    q = lambda s: pd.read_sql(s, c)
    s12 = (q(f"select fundno, fdate, country, fundname from tfn.s12type1 "
             f"where rdate='{date}'")
           .sort_values("fdate").drop_duplicates("fundno", keep="last"))
    bridge = q(f"""select distinct l2.fundno, p.crsp_portno
        from mfl.mflink2 l2
        join mfl.mflink1 l1 on l1.wficn = l2.wficn
        join crsp_q_mutualfunds.portnomap p on p.crsp_fundno = l1.crsp_fundno
        where l2.rdate='{date}' and l2.wficn is not null""")
    m2 = q(f"select fundno, fundname_full from mfl.mflink2 "
           f"where rdate='{date}'").drop_duplicates("fundno")
    # portnomap MUST be date-restricted: crsp_cik_map carries no date bounds
    pm = q(f"""select crsp_fundno, crsp_portno, fund_name
        from crsp_q_mutualfunds.portnomap where begdt<='{date}' and enddt>='{date}'""")
    ck = q("select crsp_fundno, series_cik from crsp_q_mutualfunds.crsp_cik_map")
    ck["series_cik"] = ck.series_cik.str.strip()
    return s12, bridge, m2, pm, ck


def load_sec_series(path):
    """Load an SEC series/class CSV. Header layout drifts across vintages."""
    for skip in (0, 1):
        df = pd.read_csv(path, dtype=str, skiprows=skip, nrows=5)
        cols = [str(c).strip().lower() for c in df.columns]
        if any(c in ("series id", "series_id") for c in cols):
            break
    else:
        raise SystemExit(f"could not find a Series ID column in {path}")
    sc = pd.read_csv(path, dtype=str, skiprows=skip).replace("[NULL]", pd.NA)
    sc.columns = [str(c).strip() for c in sc.columns]
    sid = next(c for c in sc.columns if c.lower() in ("series id", "series_id"))
    snm = next(c for c in sc.columns if c.lower() in ("series name", "series_name"))
    ser = sc.dropna(subset=[sid]).groupby(sid)[snm].first().reset_index()
    ser.columns = ["series_id", "series_name"]
    return ser


def load_aliases(xlsx, date, s12, m2):
    """S12 name aliases: xlsx (long but stale) + mflink2 full + s12type1 (truncated).

    The xlsx uses two-digit years; Python's %y pivot (00-68 -> 2000s, 69-99 -> 1900s)
    is correct here. END_DATE '01-JAN-30' is a 2030 'still active' sentinel — do NOT
    'correct' it backwards.
    """
    x = pd.read_excel(xlsx, sheet_name="Export Worksheet", dtype=str)
    for c in ("START_DATE", "END_DATE"):
        x[c] = pd.to_datetime(x[c], format="%d-%b-%y", errors="coerce")
    x["FUNDNO"] = pd.to_numeric(x.FUNDNO, errors="coerce")
    d = pd.Timestamp(date)
    cur = x[(x.START_DATE <= d) & (x.END_DATE >= d)]
    al = pd.concat([
        cur[["FUNDNO", "FUNDNAME"]].rename(columns={"FUNDNO": "fundno", "FUNDNAME": "name"}),
        m2.rename(columns={"fundname_full": "name"}),
        s12[["fundno", "fundname"]].rename(columns={"fundname": "name"}),
    ]).dropna()
    al = al[al.fundno.isin(s12.fundno)].copy()
    al["n"] = [norm(s) for s in al.name]
    return al[al.n.str.len() >= 6].drop_duplicates(["fundno", "n"])


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True, help="quarter end, e.g. 2022-12-31")
    ap.add_argument("--sec-csv", required=True, help="SEC series/class CSV for that year")
    ap.add_argument("--xlsx", required=True, help="S12_Names_*.xlsx")
    ap.add_argument("--user", default="eddyhu", help="WRDS pg user (~/.pgpass)")
    ap.add_argument("--accept", type=float, default=0.95,
                    help="cosine threshold for the primary accept (default 0.95)")
    ap.add_argument("--out", help="optional parquet path for the accepted bridge")
    a = ap.parse_args()

    s12, bridge, m2, pm, ck = load_wrds(a.date, a.user)
    ser = load_sec_series(a.sec_csv)
    al = load_aliases(a.xlsx, a.date, s12, m2)

    u = s12.merge(bridge.drop_duplicates("fundno").assign(bridged=1), on="fundno", how="left")
    u["bridged"] = u.bridged.fillna(0).astype(int)
    u["grp"] = np.where(u.country.str.strip().ne("UNITED STATES"), "neg_nonus",
                        np.where(u.bridged == 1, "pos_us_bridged", "amb_us"))
    n = u.grp.value_counts()
    print(f"{a.date}: {n.to_dict()}   ({len(al)} aliases, {len(ser)} SEC series)")

    truth = bridge.groupby("fundno").crsp_portno.apply(set).to_dict()
    s2p = (ck.dropna(subset=["series_cik"])
             .merge(pm[["crsp_fundno", "crsp_portno"]], on="crsp_fundno")
             .groupby("series_cik").crsp_portno.apply(set).to_dict())
    in_crsp = set(ck.series_cik.dropna())

    R = (pd.DataFrame({"n": [norm(s) for s in ser.series_name], "key": ser.series_id})
           .query("n.str.len() >= 6")
           .groupby("n").key.apply(lambda s: set(s.dropna())).reset_index())

    m = top1(al.n.tolist(), R.n.tolist(), thr=0.5)
    m = m.assign(fundno=al.fundno.values[m.li], key=R.key.values[m.ri])
    best = m.sort_values(["fundno", "score"]).drop_duplicates("fundno", keep="last")
    best["portnos"] = [set().union(*[s2p.get(s, set()) for s in k]) if k else set()
                       for k in best.key]
    best["series_absent_from_crsp"] = [not (k & in_crsp) for k in best.key]

    print("\nthr    FPR    pos_acc  amb_resolved  amb_rate  implied_prec  combined_prec")
    for t in (0.85, 0.90, 0.95):
        sel = best[best.score >= t]
        x = u[["fundno", "grp"]].merge(sel, on="fundno")
        p = x[x.grp == "pos_us_bridged"]
        ok = sum(1 for f, ps in zip(p.fundno, p.portnos) if ps & truth.get(f, set()))
        acc = ok / max(len(p), 1)
        amb = int((x.grp == "amb_us").sum()); ar = amb / n["amb_us"]
        fpr = (x.grp == "neg_nonus").sum() / n["neg_nonus"]
        ip = 1 - fpr / max(ar, 1e-9)
        print(f"{t:.2f}  {fpr:6.4f}  {acc:7.3f}  {amb:12d}  {ar:8.3f}  {ip:12.3f}  {acc*max(ip,0):13.3f}")

    acc_sel = best[(best.score >= a.accept)].copy()
    resolved = acc_sel[[bool(p) for p in acc_sel.portnos]]
    additive = acc_sel[acc_sel.series_absent_from_crsp]
    amb_n = int(n["amb_us"])
    amb_ids = set(u[u.grp == "amb_us"].fundno)
    r_amb = len(set(resolved.fundno) & amb_ids)
    a_amb = len(set(additive.fundno) & amb_ids)
    print(f"\nAt accept={a.accept}: of {amb_n} ambiguous US funds, "
          f"{r_amb} resolved to a crsp_portno, {a_amb} confirmed CRSP-absent, "
          f"{amb_n - r_amb - a_amb} still ambiguous "
          f"({(amb_n - r_amb - a_amb)/len(u):.2%} of all S12 funds).")
    claimed = set(bridge.crsp_portno)
    dup = sum(1 for p in resolved[resolved.fundno.isin(amb_ids)].portnos if p & claimed)
    if r_amb:
        print(f"Of the {r_amb} resolved, {dup} ({dup/r_amb:.1%}) hit a crsp_portno already "
              f"claimed by a different MFLINKS-bridged fundno -> live double-count risks.")

    if a.out:
        resolved[["fundno", "key", "score", "portnos"]].to_parquet(a.out)
        print(f"wrote {a.out}")


if __name__ == "__main__":
    main()
