#!/usr/bin/env python3
"""Pull LSEG management guidance instances (`TR.Guidance*`) — the content set behind
LSEG Guidance Reports (GR, guidance-reports.com).

See references/guidance.md. Handles the three traps: the 20s default HTTP timeout,
datagrid row padding, and SDate/EDate filtering the GUIDED PERIOD rather than the
announcement date.

  python3 guidance_pull.py AAPL.O MSFT.O --start 2015-01-01 --end 2016-12-31 -o gr.csv
  python3 guidance_pull.py AAPL.O --start 2015-01-01 --end 2016-12-31 --said-between 2015-01-01 2016-12-31
"""
from __future__ import annotations

import argparse
import os
import sys

FIELDS = [
    "TR.GuidanceDate", "TR.GuidanceMeasure", "TR.GuidanceDocType",
    "TR.GuidancePeriodYear", "TR.GuidancePeriodMonth",
    "TR.GuidanceLowValue", "TR.GuidanceHighValue", "TR.GuidanceCurrency",
    "TR.GuidanceText",
]
TEXT_COL = "Guidance Text"
DATE_COL = "Activation Date"


def open_session(timeout: int):
    import lseg.data as ld
    from lseg.data import session
    # Must precede session creation; the default is 20s and guidance payloads exceed it.
    ld.get_config().set_param("http.request-timeout", timeout)
    s = session.platform.Definition(
        app_key=os.environ["LSEG_APP_KEY"],
        grant=session.platform.GrantPassword(
            username=os.environ["LSEG_USERNAME"],
            password=os.environ["LSEG_PASSWORD"]),
        signon_control=True,
    ).get_session()
    s.open()
    if str(s.open_state) != "OpenState.Opened":
        raise RuntimeError(f"session failed: {s.open_state}")
    session.set_default(s)
    return s


def pull(rics: list[str], start: str, end: str, batch: int = 2):
    import lseg.data as ld
    import pandas as pd
    frames = []
    for i in range(0, len(rics), batch):
        chunk = rics[i:i + batch]
        df = ld.get_data(chunk, FIELDS, parameters={"SDate": start, "EDate": end})
        # Datagrid pads each instrument block to the longest column; padded rows carry
        # no content and would inflate an instance count by ~55%.
        df = df[df[TEXT_COL].notna() & (df[TEXT_COL] != "")]
        frames.append(df)
        print(f"  {','.join(chunk)}: {len(df)} instances", file=sys.stderr)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("rics", nargs="+")
    p.add_argument("--start", required=True, help="guided-period start (SDate)")
    p.add_argument("--end", required=True, help="guided-period end (EDate)")
    p.add_argument("--said-between", nargs=2, metavar=("FROM", "TO"),
                   help="additionally filter on Activation Date, the disclosure date")
    p.add_argument("--batch", type=int, default=2, help="instruments per request (default 2)")
    p.add_argument("--timeout", type=int, default=180, help="http.request-timeout seconds")
    p.add_argument("-o", "--out", help="write CSV here (default: stdout summary only)")
    a = p.parse_args()

    s = open_session(a.timeout)
    try:
        df = pull(a.rics, a.start, a.end, a.batch)
    finally:
        s.close()

    if a.said_between:
        import pandas as pd
        lo, hi = pd.Timestamp(a.said_between[0]), pd.Timestamp(a.said_between[1])
        before = len(df)
        df = df[df[DATE_COL].between(lo, hi)]
        print(f"Activation-date filter: {before} -> {len(df)}", file=sys.stderr)

    print(f"\n{len(df)} guidance instances")
    if len(df):
        print(f"activation dates: {df[DATE_COL].min()} -> {df[DATE_COL].max()}")
        quant = df["Guidance Low Value"].notna().mean()
        print(f"quantitative (low value present): {quant:.1%}")
        print("\ntop measures:")
        print(df["Guidance Measure"].replace("", None).dropna().value_counts().head(15).to_string())
    if a.out:
        df.to_csv(a.out, index=False)
        print(f"\nwrote {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
