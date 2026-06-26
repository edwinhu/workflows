# PLAN: ds-grain-pause fixture — RESOLVED variant (grain decision baked into the Verify)

Implementation Language: python

The resolution of the `PLAN.md` R4 pause: the human chose "extend grain to
`(cusip, event_ts, price)`". A GATE-CHANGING decision is baked into the PLAN by editing
the **Verify assertion** (and the grain text) — not by passing `args.decisions` alone,
which would leave a stale gate the implementer re-blocks on. With the Verify now asserting
the `+price` grain, all 5 prints are unique and the task resumes to a gate-passing master.

This is the committable analogue of muni's `+seqno` resolution: resolving the grain meant
editing the assertion, then recompiling.

## Task Breakdown

| Task | Deps | Outputs | Expected Output | Verify | Implements |
|------|------|---------|-----------------|--------|------------|
| **G1** [engineer] — Build `out/master.csv` from `data/trades.csv`: one row per customer print, grain UNIQUE on `cusip x event_ts x price`, and KEEP every print (no dedup, no dropped rows). | — | `out/master.csv` | all 5 prints, unique on (cusip, event_ts, price) | `python3 -c "import csv; rows=list(csv.DictReader(open('out/master.csv'))); keys=[(r['cusip'],r['event_ts'],r['price']) for r in rows]; assert len(keys)==len(set(keys)), 'grain not unique on (cusip,event_ts,price)'; assert len(rows)==5, 'lost prints: expected all 5'"` | GRAIN-01 |
