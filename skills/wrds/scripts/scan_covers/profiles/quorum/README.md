# quorum — bylaw quorum thresholds from DEF 14A proxies

## Why

ISS Voting Analytics carries the **pass**-vote mechanics (`base`, `voterequirement`)
but not the **quorum** threshold, and no WRDS table has one: `iss_va_shareholder.chars`,
`risk.chars` and `risk.chars_us` all return zero rows for `%quorum%`. The only
source is the proxy text.

Needed for any counterfactual where a block abstains rather than votes — full
abstention can break quorum, and whether it does depends on the firm's bylaw, not
on the pass rule.

## Pipeline

```bash
# 1. stage the index (local or grid; hits WRDS PostgreSQL)
python stage.py --start-year 2005 --end-year 2025 --out .

# 2. scan (grid — this reads whole filings, do NOT run it on the login node)
qsub ../../sge/submit_array.sh          # or, serially:
scan_covers -profile quorum -files-from quorum_files.txt \
    -root /wrds/sec/wrds_clean_filings > quorum_raw.tsv

# 3. reduce to one row per (cik, meeting_year)
python build_panel.py --scan quorum_raw.tsv --index quorum_filings.tsv \
    --out data/processed
```

Output `quorum_bylaws.parquet`: `cik, meeting_year, threshold, confidence,
accession, filing_date, match_text`.

## How the threshold is found

Per DGCL §216 the only legal quorum values for public-company bylaws are in
[0.333, 0.50] — the one-third statutory floor and the majority default. Higher
values are recognised to **flag** oddities, not to accept them.

Around every occurrence of "quorum", a ±250-char window is scanned for a
threshold phrase, which must then be anchored:

| Tier | Anchor | Window | Confidence |
|---|---|---|---|
| 1 | an **outstanding** qualifier (`outstanding`, `entitled to vote`, `voting power`, …) | 150 chars | as labelled |
| 2 | a canonical **quorum verb** (`constitutes a quorum`, `necessary for a quorum`, …) | 100 chars | capped at `med` |

The anchor is what separates the quorum rule from the pass rule. "A majority of
the **outstanding shares**" is a quorum; "a majority of the **votes cast**" is
not, and the reject list kills the second — including `plurality`, which is a
director-vote rule and never a meeting quorum.

All occurrences of each pattern are tried, not the first. A proxy typically
states the pass rule *before* the quorum rule, so first-match would
systematically pick the wrong one.

### Confidence ladder

| | Meaning |
|---|---|
| `high` | explicit fraction/percent, tier-1 anchored |
| `med` | boilerplate majority, or a `high` pattern that only reached tier 2 |
| `default` | filing discusses quorum, no threshold extractable → DGCL §216 0.50 |
| `default-noquorum` | filing contains **no** quorum text at all → DGCL §216 0.50 |
| `low` | nothing usable |

**`default` and `default-noquorum` both return 0.50 and are deliberately not
merged.** "We read it and found no number" and "there was nothing to read" are
different claims about the same value, and the dedup ranking prefers the first.
Collapsing them would let an absence pass as a reading.

## Measured

From `mirror/docs/investigations/2026-04-22_bylaw_quorum.md`, on the Russell 3000
scope: **96.6% explicit parse coverage**. Full abstention fails quorum for
**12.82%** of index-block item-rows (79,502 / 619,991), against 13.70% under a
flat DGCL ½ and 4.27% under a flat ⅓ — i.e. the firm-specific threshold matters,
and both flat assumptions are wrong in opposite directions.

## Provenance

Ported from mirror `scripts/bylaw_quorum/parse_quorum_go/`, which is where the
coverage figure was measured. It is a scan_covers **profile** rather than a
fourth standalone binary because this skill's Red Flags section requires it:
*"Create a new standalone Go binary for EDGAR extraction → STOP. `scan_covers` is
a generic profile-based framework. Add a `profiles_*.go` file, not a new binary."*

**Parity verified** against the standalone on fixtures covering every confidence
tier (`high` one-third, `high` one-quarter, `med` majority-outstanding,
`default`, `default-noquorum` ×2) — identical threshold and confidence on all six.

If you tune a pattern here, mirror's copy and the published 96.6% are both stale.

`merge_v12.py` did **not** come across: it joins to mirror's counterfactuals panel
on `(cik, meeting_year)` with a ±5-year asof fallback, which is that paper's
analysis rather than general capability.

## Traps

- **`FullBody`, not a head window.** Quorum text sits in the "Questions and
  Answers About the Meeting" section, anywhere from a few KB into a proxy to most
  of the way through several hundred KB. `HeadBytes` is only the form-type
  pre-filter here.
- **Never run the scan on the login node.** It reads whole filings off NFS.
- **The HTML strip is single-line-restricted** (`<[^>\n]+>`). A multiline tag
  regex ate huge spans when brackets were unbalanced — e.g. `"<=-500 bps"` and
  `"> 500 bps"` on separate lines — silently deleting the text the match needed.
- **The `quorum` column packs three values** as `threshold|confidence|match_text`.
  One full-body scan, three correlated outputs; three `Custom` fields would run it
  three times. `build_panel.py` splits on the first two pipes and the snippet is
  pipe-sanitised in Go.
