#!/usr/bin/env python3
"""Extend a CRSP CIZ daily stock panel past CRSP's last date using LSEG.

CRSP updates annually; the CIZ daily file stops at the last December. This builds
the CRSP panel from WRDS Postgres, maps each security's date-effective CUSIP to a
RIC through LSEG symbology, pulls the gap period from LSEG, and splices the two
into one continuous panel.

The splice is done on RETURNS, not on price levels. LSEG's history is back-adjusted
to today's share basis; CRSP's DlyPrc is as-traded on the day. Any split after
CRSP's cutoff puts the two price series on different bases, so a level splice
introduces a fake return on the seam. See `rebuild_price()`.

Pipeline (each step caches to --out):
    universe -> map -> pull -> splice -> coverage

    python crsp_lseg_splice.py all --out data/

Credentials: WRDS via ~/.pgpass; LSEG via RDP_APP_KEY / RDP_USERNAME / RDP_PASSWORD
(the agenix secret exports these as LSEG_*; map them at the call site).
"""
from __future__ import annotations

import argparse
import contextlib
import os
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg2

WRDS = dict(host="wrds-pgdata.wharton.upenn.edu", port=9737, dbname="wrds",
            sslmode="require")

# RIC exchange suffixes that denote a US listing quoted in USD. A bare RIC (no dot)
# is the US composite. Everything else -- .TRE Tradegate, .MU Munich, .SG Stuttgart,
# .TBEA, .MX, .BCU -- is a foreign cross-listing quoted in a FOREIGN CURRENCY, and
# LSEG returns those for ~4% of US CUSIPs without any error. See SKILL.md Iron Law 1.
US_SUFFIXES = {"", "O", "N", "A", "P", "K", "PK", "OQ", "DE"}


# ---------------------------------------------------------------- session

@contextlib.contextmanager
def lseg_session():
    """One LSEG platform session. The machine ID permits ONE concurrent session and
    `signon_control=False` (the library default) FAILS rather than queues, so any
    crashed prior script holds the quota. open() does not raise on auth failure --
    it logs and returns -- so the open_state check below is load-bearing."""
    import lseg.data as ld
    from lseg.data.session import platform

    missing = [k for k in ("RDP_APP_KEY", "RDP_USERNAME", "RDP_PASSWORD")
               if not os.environ.get(k)]
    if missing:
        raise SystemExit(
            f"missing env: {', '.join(missing)}\n"
            "  set -a; . $XDG_RUNTIME_DIR/agenix/lseg-credentials; set +a\n"
            "  export RDP_APP_KEY=$LSEG_APP_KEY RDP_USERNAME=$LSEG_USERNAME "
            "RDP_PASSWORD=$LSEG_PASSWORD")

    s = platform.Definition(
        app_key=os.environ["RDP_APP_KEY"],
        grant=platform.GrantPassword(username=os.environ["RDP_USERNAME"],
                                     password=os.environ["RDP_PASSWORD"]),
        signon_control=True,
    ).get_session()
    s.open()
    if str(s.open_state) != "OpenState.Opened":
        raise RuntimeError(f"LSEG session failed to open: {s.open_state}")
    ld.session.set_default(s)
    try:
        yield s
    finally:
        with contextlib.suppress(Exception):
            s.close()


def _pg(user: str):
    return psycopg2.connect(user=user, **WRDS)


# ---------------------------------------------------------------- 1. universe

UNIV_SQL = """
SELECT h.permno, h.permco, h.cusip9, h.cusip AS cusip8, h.ticker, h.issuernm,
       h.primaryexch, h.securitytype, h.securitysubtype, h.sharetype,
       h.usincflg, h.issuertype, h.tradingstatusflg, h.conditionaltype,
       h.secinfostartdt, h.secinfoenddt
FROM crsp.stksecurityinfohist h
WHERE %(asof)s BETWEEN h.secinfostartdt AND h.secinfoenddt
  AND h.sharetype = 'NS' AND h.securitytype = 'EQTY'
  AND h.securitysubtype = 'COM' AND h.usincflg = 'Y'
  AND h.issuertype IN ('ACOR','CORP')
  AND h.primaryexch IN ('N','A','Q')
  AND h.conditionaltype = 'RW' AND h.tradingstatusflg = 'A'
  AND EXISTS (SELECT 1 FROM crsp.stkdlysecurityprimarydata d
               WHERE d.permno = h.permno AND d.dlycaldt = %(asof)s)
"""

PANEL_SQL = """
SELECT d.permno, d.dlycaldt AS date, d.dlyprc, d.dlyret, d.dlycap, d.dlyvol
FROM crsp.stkdlysecurityprimarydata d
WHERE d.permno = ANY(%(p)s) AND d.dlycaldt BETWEEN %(s)s AND %(e)s
"""


def crsp_maxdate(user: str) -> pd.Timestamp:
    with _pg(user) as c, c.cursor() as cur:
        cur.execute("SELECT max(dlycaldt) FROM crsp.stkdlysecurityprimarydata")
        return pd.Timestamp(cur.fetchone()[0])


def step_universe(out: Path, user: str, start: str) -> pd.DataFrame:
    """CRSP common-stock universe alive on CRSP's last date, plus its daily panel.

    The CUSIP taken here is `stksecurityinfohist.cusip9` -- the cusip IN EFFECT on
    the as-of date, from the history table. `stksecurityinfohdr.hdrcusip` would
    attach the security's most-recent cusip to its whole history, which is the
    classic undated-join defect. (CIZ inverted the SIZ naming: CIZ `cusip` is the
    historical value, `hdrcusip` is the header one.)
    """
    asof = crsp_maxdate(user)
    print(f"[universe] CRSP CIZ last date = {asof.date()}")
    with _pg(user) as c:
        u = pd.read_sql(UNIV_SQL, c, params={"asof": asof.date()})
        print(f"[universe] common-stock securities on {asof.date()}: {len(u):,}")
        permnos = u.permno.astype(int).tolist()
        panel = pd.read_sql(PANEL_SQL, c,
                            params={"p": permnos, "s": start, "e": asof.date()})
    panel["date"] = pd.to_datetime(panel.date)
    print(f"[universe] CRSP panel rows {start}..{asof.date()}: {len(panel):,}")
    if u.cusip9.isna().any():
        print(f"[universe] WARNING null cusip9: {u.cusip9.isna().sum()}")
    dup = u.cusip9.duplicated().sum()
    if dup:
        print(f"[universe] WARNING duplicate cusip9 across permnos: {dup}")
    out.mkdir(parents=True, exist_ok=True)
    u.to_parquet(out / "universe.parquet")
    panel.to_parquet(out / "crsp_panel.parquet")
    (out / "asof.txt").write_text(str(asof.date()))
    return u


# ---------------------------------------------------------------- 2. map

def step_map(out: Path, chunk: int = 200) -> pd.DataFrame:
    """CUSIP9 -> RIC via LSEG symbology, then screen the result.

    Unresolved CUSIPs are simply ABSENT from the response -- they come back as
    nulls, never as wrong values -- so the risk here is not silent corruption from
    a miss. It is the foreign-venue RIC (Iron Law 1) and the entity mismatch, both
    of which return plausible numbers. Both are screened below and the reason is
    recorded per row rather than dropped silently.
    """
    from lseg.data.content import symbol_conversion as sc

    u = pd.read_parquet(out / "universe.parquet")
    cus = u.cusip9.dropna().unique().tolist()
    print(f"[map] cusip9 to resolve: {len(cus):,}")
    frames = []
    with lseg_session():
        for i in range(0, len(cus), chunk):
            ch = cus[i:i + chunk]
            r = sc.Definition(symbols=ch, from_symbol_type=sc.SymbolTypes.CUSIP,
                              to_symbol_types=[sc.SymbolTypes.RIC,
                                               sc.SymbolTypes.TICKER_SYMBOL,
                                               sc.SymbolTypes.ISIN]).get_data()
            frames.append(r.data.df)
            print(f"  {min(i+chunk,len(cus))}/{len(cus)}", flush=True)
    m = pd.concat(frames).reset_index().rename(columns={"index": "cusip9"})
    u = u.merge(m[["cusip9", "RIC", "TickerSymbol", "IssueISIN"]],
                on="cusip9", how="left")

    u["ric_suffix"] = u.RIC.fillna("").map(lambda r: r.split(".", 1)[1] if "." in r else "")
    # A '^' encodes a delisting stamp: AAAA.O^C26 delisted in month C (=March) 2026.
    u["delisted_ric"] = u.RIC.fillna("").str.contains(r"\^")
    base_suffix = u.ric_suffix.str.split("^").str[0]
    u["us_venue"] = base_suffix.isin(US_SUFFIXES)
    # LSEG returns pandas nullable-string columns; comparing them with .eq() raises
    # "boolean value of NA is ambiguous" rather than yielding False. Normalise to
    # plain str first so an unresolved row compares as a mismatch, not an error.
    def _up(s):
        return s.astype("object").fillna("").astype(str).str.upper()

    crsp_tick = _up(u.ticker)
    tick_ok = _up(u.TickerSymbol) == crsp_tick
    root_ok = _up(u.RIC).str.split(".").str[0] == crsp_tick
    u["entity_ok"] = (tick_ok | root_ok) & u.RIC.notna()

    u["link_status"] = np.select(
        [u.RIC.isna(), ~u.us_venue, ~u.entity_ok],
        ["no_ric", "foreign_venue", "entity_mismatch"], default="ok")
    u["usable"] = u.link_status.isin(["ok", "entity_mismatch"]) & u.us_venue & u.RIC.notna()

    n = len(u)
    print(f"[map] resolved RIC : {u.RIC.notna().sum():,} ({u.RIC.notna().mean():.2%})")
    for k, v in u.link_status.value_counts().items():
        print(f"[map]   {k:16s} {v:6,} ({v/n:.2%})")
    print(f"[map] delist-stamped RICs (delisted after CRSP cutoff): "
          f"{int(u.delisted_ric.sum()):,}")
    u.to_parquet(out / "link.parquet")
    return u


# ---------------------------------------------------------------- 3. pull

def step_pull(out: Path, end: str | None = None,
              hist_chunk: int = 25, ret_chunk: int = 40) -> None:
    """Pull the gap period from LSEG: price+volume via get_history, daily total
    return via get_data(TR.TotalReturn1D).

    TR.TotalReturn1D is CRSP DlyRet's analogue and validates against it to ~1e-7
    (see references/coverage.md). It is returned in PERCENT; the /100 is applied
    in step_splice, not here, so the cached file matches what the API sent.

    The window STARTS ON the CRSP cutoff date, not the day after. That overlap day
    is the anchor: LSEG's quote on the cutoff, compared with CRSP's DlyPrc on the
    same day, measures each security's adjustment-basis ratio directly, and it is
    what `dlycap` is scaled by. Starting a day later would leave both unavailable.
    """
    import lseg.data as ld

    asof = pd.Timestamp((out / "asof.txt").read_text().strip())
    start = asof.date().isoformat()
    end = end or (pd.Timestamp.today() - pd.Timedelta(days=1)).date().isoformat()
    link = pd.read_parquet(out / "link.parquet")
    rics = link.loc[link.usable, "RIC"].dropna().unique().tolist()
    print(f"[pull] gap {start} .. {end}  RICs={len(rics):,}")

    hist, rets, t0 = [], [], time.time()
    with lseg_session():
        for i in range(0, len(rics), hist_chunk):
            ch = rics[i:i + hist_chunk]
            try:
                hist.append(ld.get_history(universe=ch,
                                           fields=["TRDPRC_1", "ACVOL_UNS"],
                                           start=start, end=end, interval="daily"))
            except Exception as e:
                print(f"  hist ERR @{i}: {type(e).__name__} {str(e)[:70]}", flush=True)
            if i % (hist_chunk * 20) == 0:
                print(f"  hist {i+len(ch)}/{len(rics)} {time.time()-t0:.0f}s", flush=True)
        H = pd.concat(hist, axis=1)
        H.to_parquet(out / "lseg_hist.parquet")
        print(f"[pull] history shape {H.shape}")

        for i in range(0, len(rics), ret_chunk):
            ch = rics[i:i + ret_chunk]
            try:
                rets.append(ld.get_data(
                    universe=ch,
                    fields=["TR.TotalReturn1D", "TR.TotalReturn1D.date"],
                    parameters={"SDate": start, "EDate": end, "Frq": "D"}))
            except Exception as e:
                print(f"  ret ERR @{i}: {type(e).__name__} {str(e)[:70]}", flush=True)
            if i % (ret_chunk * 20) == 0:
                print(f"  ret {i+len(ch)}/{len(rics)} {time.time()-t0:.0f}s", flush=True)
    R = pd.concat(rets, ignore_index=True)
    R.to_parquet(out / "lseg_ret.parquet")
    print(f"[pull] return rows {len(R):,}  elapsed {time.time()-t0:.0f}s")


# ---------------------------------------------------------------- 4. splice

def _long_hist(H: pd.DataFrame) -> pd.DataFrame:
    lg = (H.stack(level=0, future_stack=True).reset_index()
            .rename(columns={"level_1": "RIC", "Date": "date"}))
    lg["date"] = pd.to_datetime(lg.date)
    for c in ("TRDPRC_1", "ACVOL_UNS"):
        lg[c] = pd.to_numeric(lg[c], errors="coerce")
    return lg.dropna(subset=["TRDPRC_1"], how="all")


def rebuild_price(g: pd.DataFrame) -> pd.Series:
    """Chain the gap price off CRSP's last DlyPrc using LSEG's total returns.

    NOT `lseg_price` directly. LSEG's TRDPRC_1 history is back-adjusted to the
    current share basis, so for a security that split after the CRSP cutoff its
    January price is stated on a different basis than CRSP's December price. A
    level splice makes that basis change look like a one-day return of -50% (or
    +900% for a reverse split). Chaining on returns keeps the series on CRSP's
    basis and puts the corporate action where it belongs -- in the return.

    Total return chaining reinvests dividends into the price, so the result is a
    total-return index anchored at CRSP's last price, not a quoted price. The raw
    LSEG quote is kept alongside as `lseg_prc` for anyone who wants the level.
    """
    return g.p0.iloc[0] * (1.0 + g.ret).cumprod()


def step_splice(out: Path) -> pd.DataFrame:
    asof = pd.Timestamp((out / "asof.txt").read_text().strip())
    link = pd.read_parquet(out / "link.parquet")
    crsp = pd.read_parquet(out / "crsp_panel.parquet")
    H = _long_hist(pd.read_parquet(out / "lseg_hist.parquet"))
    R = (pd.read_parquet(out / "lseg_ret.parquet")
           .rename(columns={"Instrument": "RIC", "Daily Total Return": "ret",
                            "Date": "date"}))
    R["date"] = pd.to_datetime(R.date).dt.tz_localize(None).dt.normalize()
    R["ret"] = pd.to_numeric(R.ret, errors="coerce") / 100.0   # percent -> decimal

    key = link.loc[link.usable, ["permno", "RIC", "ticker", "issuernm",
                                 "link_status"]].dropna(subset=["RIC"])
    # INNER join on the price series, not left. TR.TotalReturn1D is calendar-padded:
    # it returns the SAME number of days for every instrument (std 0.0 across the
    # universe), including instruments that delisted mid-gap. Keeping a return with
    # no same-day trade price manufactures flat rows after a stock stops trading and
    # inflates every coverage number computed off the row count.
    with_ret = key.merge(R[["RIC", "date", "ret"]], on="RIC", how="inner")
    gap = (with_ret.merge(H[["RIC", "date", "TRDPRC_1", "ACVOL_UNS"]],
                          on=["RIC", "date"], how="inner")
                   .rename(columns={"TRDPRC_1": "lseg_prc", "ACVOL_UNS": "dlyvol"})
                   .dropna(subset=["lseg_prc"]))
    print(f"[splice] dropped {len(with_ret)-len(gap):,} of {len(with_ret):,} return "
          f"rows with no same-day trade price (TR.TotalReturn1D calendar padding)")

    # The anchor: LSEG's own quote on the CRSP cutoff date, before that day is
    # dropped from the gap. Everything level-based is expressed relative to it, so
    # LSEG's adjustment basis cancels instead of leaking into the panel.
    anchor = (gap[gap.date == asof].dropna(subset=["lseg_prc"])
                 .groupby("permno").lseg_prc.last().rename("lseg_anchor"))

    p0 = (crsp.sort_values("date").groupby("permno")
              .agg(p0=("dlyprc", "last"), cap0=("dlycap", "last"),
                   last_dt=("date", "last")).reset_index())
    p0 = p0[p0.last_dt == asof].merge(anchor, on="permno", how="left")
    # crsp_price / lseg_price on the SAME day. ~1.0 means the two agree; anything
    # else is LSEG's back-adjustment for a corporate action after the cutoff, or a
    # bad link that survived the venue screen. Reported by step_coverage.
    p0["adj_ratio"] = p0.p0 / p0.lseg_anchor

    gap = gap[gap.date > asof].dropna(subset=["ret"])
    gap = gap.merge(p0[["permno", "p0", "cap0", "lseg_anchor", "adj_ratio"]],
                    on="permno", how="inner").sort_values(["permno", "date"])
    gap["dlyprc"] = gap.groupby("permno", group_keys=False).apply(
        rebuild_price, include_groups=False)
    # Market cap moves with the PRICE relative, not the total return -- chaining it
    # on TR.TotalReturn1D would reinvest every dividend into shares outstanding and
    # inflate cap by the cumulative yield. lseg_prc/lseg_anchor is a clean
    # price relative: both are on LSEG's single adjusted basis, so splits cancel
    # (as they must for cap) and dividends are excluded (as they must be).
    gap["dlycap"] = gap.cap0 * (gap.lseg_prc / gap.lseg_anchor)
    gap["dlyret"] = gap.ret
    gap["source"] = "LSEG"

    crsp = crsp.copy()
    crsp["source"] = "CRSP"
    cols = ["permno", "date", "dlyprc", "dlyret", "dlycap", "dlyvol", "source"]
    panel = pd.concat([crsp[cols], gap[cols + ["RIC", "lseg_prc", "adj_ratio"]]],
                      ignore_index=True).sort_values(["permno", "date"])
    panel.to_parquet(out / "panel_spliced.parquet")
    print(f"[splice] spliced panel rows={len(panel):,}  "
          f"CRSP={int((panel.source=='CRSP').sum()):,}  "
          f"LSEG={int((panel.source=='LSEG').sum()):,}")
    print(f"[splice] permnos with gap data: {gap.permno.nunique():,} "
          f"of {len(p0):,} alive at cutoff ({gap.permno.nunique()/max(len(p0),1):.2%})")
    return panel


# ---------------------------------------------------------------- 5. coverage

def step_coverage(out: Path) -> pd.DataFrame:
    """Coverage against the CRSP-at-cutoff denominator, plus a seam sanity check."""
    asof = pd.Timestamp((out / "asof.txt").read_text().strip())
    link = pd.read_parquet(out / "link.parquet")
    panel = pd.read_parquet(out / "panel_spliced.parquet")
    gap = panel[panel.source == "LSEG"]
    n = len(link)

    print(f"\n{'='*64}\nCOVERAGE  (denominator = {n:,} CRSP common stocks "
          f"trading {asof.date()})\n{'='*64}")
    rows = [("CRSP universe at cutoff", n),
            ("  RIC resolved", int(link.RIC.notna().sum())),
            ("  usable link (US venue)", int(link.usable.sum())),
            ("  with >=1 gap observation", gap.permno.nunique())]
    for lab, v in rows:
        print(f"{lab:34s} {v:7,}  {v/n:7.2%}")

    if len(gap):
        days = gap.date.nunique()
        per = gap.groupby("permno").size()
        full = int((per >= days * 0.9).sum())
        print(f"\ngap trading days observed        {days:7,}")
        print(f"permno-days filled               {len(gap):7,} of "
              f"{link.usable.sum()*days:,} possible "
              f"({len(gap)/max(link.usable.sum()*days,1):.2%})")
        print(f"permnos >=90% of gap days        {full:7,}  {full/n:7.2%}")
        print(f"\nlast LSEG date in panel: {gap.date.max().date()}")

        # seam check: the first spliced return should not be an outlier
        first = gap.sort_values("date").groupby("permno").first()
        print(f"\nseam sanity -- first spliced daily return:")
        print(f"  median {first.dlyret.median():+.4%}   "
              f"|ret|>25%: {int((first.dlyret.abs()>0.25).sum())} permnos")

        # adjustment-basis audit, from the overlap day both sources cover
        ar = first.adj_ratio.dropna()
        off = ar[(ar < 0.98) | (ar > 1.02)]
        print(f"\nadjustment basis (CRSP price / LSEG price on {asof.date()}):")
        print(f"  median {ar.median():.4f}   within +/-2% of 1.0: "
              f"{(len(ar)-len(off))/max(len(ar),1):.2%}")
        print(f"  off-basis securities: {len(off):,} -- LSEG back-adjusted these "
              f"for a post-cutoff corporate action.")
        print(f"  (their LEVELS are on CRSP's basis because the splice chains on "
              f"returns; a level splice would have broken exactly here)")

    print(f"\nlink_status breakdown:")
    for k, v in link.link_status.value_counts().items():
        print(f"  {k:18s} {v:6,} {v/n:7.2%}")
    return link


# ---------------------------------------------------------------- cli

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("step", choices=["universe", "map", "pull", "splice",
                                     "coverage", "all"])
    ap.add_argument("--out", type=Path, default=Path("data"))
    ap.add_argument("--user", default=os.environ.get("WRDS_USER", "eddyhu"))
    ap.add_argument("--start", default="2020-01-01",
                    help="CRSP panel start (default 2020-01-01)")
    ap.add_argument("--end", default=None, help="gap end date (default yesterday)")
    a = ap.parse_args()

    steps = ["universe", "map", "pull", "splice", "coverage"] if a.step == "all" \
        else [a.step]
    for s in steps:
        if s == "universe":
            step_universe(a.out, a.user, a.start)
        elif s == "map":
            step_map(a.out)
        elif s == "pull":
            step_pull(a.out, a.end)
        elif s == "splice":
            step_splice(a.out)
        elif s == "coverage":
            step_coverage(a.out)


if __name__ == "__main__":
    main()
