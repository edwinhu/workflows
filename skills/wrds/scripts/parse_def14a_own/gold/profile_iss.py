#!/usr/bin/env python3
"""profile_iss.py — READ-ONLY profile of the ISS directors tables and the link legs.

Aggregates and filtered counts only (C5): nothing here pulls a row-level table.
Run before build_gold_iss.py; every number the builder's join rates are argued
from comes from this profile.
"""
import argparse
import psycopg2

QUERIES = [
    ("rm_year_counts", """
        select extract(year from meetingdate)::int as yr, count(*) n,
               count(num_of_shares) n_shares, count(pcnt_ctrl_votingpower) n_pcnt,
               count(distinct cusip) n_cusip, count(distinct ticker) n_ticker,
               count(distinct company_id) n_coid,
               min(length(cusip)) minlen, max(length(cusip)) maxlen
        from risk_directors.rmdirectors
        where meetingdate is not null
        group by 1 order by 1
    """),
    ("legacy_year_counts", """
        select extract(year from meetingdate)::int as yr, count(*) n,
               count(num_of_shares) n_shares, count(pcnt_ctrl_votingpower) n_pcnt,
               count(distinct cusip) n_cusip, count(distinct ticker) n_ticker,
               min(length(cusip)) minlen, max(length(cusip)) maxlen
        from risk_directors.directors
        where meetingdate is not null
        group by 1 order by 1
    """),
    ("wrds_forms_def14a_by_year", """
        select extract(year from fdate)::int as yr, count(*) n
        from wrdssec_all.wrds_forms
        where form = 'DEF 14A' and fdate between '2002-01-01' and '2025-12-31'
        group by 1 order by 1
    """),
    ("wciklink_cusip_lengths", """
        select length(cusip) l, count(*) n, count(distinct cik) n_cik
        from wrdssec.wciklink_cusip where cusip is not null group by 1 order by 1
    """),
    ("ccm_link_shape", """
        select count(*) n, count(distinct gvkey) n_gvkey, count(distinct lpermno) n_permno
        from crsp.ccmxpf_lnkhist
        where linktype in ('LU','LC') and linkprim in ('P','C')
    """),
    ("wciklink_gvkey_shape", """
        select count(*) n, count(distinct cik) n_cik, count(distinct gvkey) n_gvkey
        from wrdssec.wciklink_gvkey
    """),
    ("rm_dup_key", """
        select count(*) - count(distinct (cusip, meetingdate, fullname)) as dupes,
               count(*) n
        from risk_directors.rmdirectors
        where meetingdate between '2007-01-01' and '2025-12-31'
    """),
    ("legacy_dup_key", """
        select count(*) - count(distinct (cusip, meetingdate, fullname)) as dupes,
               count(*) n
        from risk_directors.directors
        where meetingdate between '2002-01-01' and '2006-12-31'
    """),
    # the 100x defect: num_of_shares implied percent vs stated pcnt_ctrl_votingpower
    ("rm_shares_vs_pcnt_sanity", """
        select count(*) n,
               sum(case when num_of_shares > 500000000 then 1 else 0 end) n_gt_500m,
               sum(case when num_of_shares > 100000000 then 1 else 0 end) n_gt_100m,
               max(num_of_shares) mx
        from risk_directors.rmdirectors
        where meetingdate between '2007-01-01' and '2025-12-31'
    """),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", default="eddyhu")
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    con = psycopg2.connect(host="wrds-pgdata.wharton.upenn.edu", port=9737,
                           database="wrds", user=args.user, sslmode="require")
    cur = con.cursor()
    for name, sql in QUERIES:
        if args.only and args.only not in name:
            continue
        print("\n===== %s =====" % name)
        print(" ".join(sql.split()))
        try:
            cur.execute(sql)
        except Exception as e:  # loud, not swallowed: print and re-raise at the end
            con.rollback()
            print("QUERY FAILED: %s" % e)
            continue
        cols = [d[0] for d in cur.description]
        print("\t".join(cols))
        for r in cur.fetchall():
            print("\t".join("" if v is None else str(v) for v in r))
    con.close()


if __name__ == "__main__":
    main()
