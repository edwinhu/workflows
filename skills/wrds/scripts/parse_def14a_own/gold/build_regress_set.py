#!/usr/bin/env python3
"""build_regress_set.py — the FIXED regression set for the 2026-09-29 regression round.

Why this exists. The full-archive re-run at parser `092b6fb9`
(`/data/def14a_own/panel`) beat the reference run at `4b36a962`
(`/data/def14a_own/panel_e4e78a95`) on the identical-row duplicate rate and on
yield, and paid for it with two recall losses that NO gate can see: 1,070 filings
that had >= 1 ownership row before and 0 now, and filings that lost a D&O group
row. Both clusters sit in the layouts the duplicate rounds changed. Every existing
gate reads gold-linked filings or the fixed sample; none of them reads the filings
that regressed, so the loop is free to lose them again.

THE SET IS A DIFF OF TWO PANELS, AND IS FIXED ONCE. Nothing here re-parses
anything: the two panels on disk are the evidence, and the set is written once and
locked, exactly like `sample_full.tsv`.

  (a) ZERO-ROW set    old n_rows > 0 AND new n_rows == 0
  (b) GROUP-ROW set   old has_group_row == 1 AND new has_group_row == 0

EXCLUSIONS — X1-X4 affect both sets; X7-X9 affect (b) only; X10-X13 affect
(a) only. All are mechanical and applied to the OLD rows of the
candidate filing, and all meaning "the old rows are demonstrably wrong, so
restoring them is not a target":

  X1  >= 1 old row whose `holder_name` contains a `$`.
      The name column of a beneficial-ownership table carries a person or an
      entity. A `$` in it means the parser read a DOLLAR column as the name:
      a dollar-range-of-equity table (Item 22(b)(5) fund proxies) or a summary
      compensation table. Read in the documents: `Thomas R. $10,001-$50,000 $0`
      (First Trust 2006, `0000875626-06-000515`, an AGGREGATE DOLLAR RANGE OF
      EQUITY SECURITIES table) and `President/CEO - Union National Bank 1996
      $166,500 $38,295 [3]` -> shares=13936 (Univest 1999,
      `0000891554-99-000468`, the SUMMARY COMPENSATION TABLE's All Other
      Compensation column).
  X2  >= 3 old rows, every one carrying the IDENTICAL (shares, percent) pair.
      No real ownership table gives every holder the same holding; a dollar-range
      table does. Read in the documents: Pacholder High Yield Fund 2012
      (`0001193125-12-089540`), 13 trustees each `100000` from "Over $100,000";
      Third Avenue 2002 (`0000930413-02-002213`), 10 trustees each `0` from
      "$0*"; Lincoln National Income Fund 2002 (`0000950116-02-000782`), 6
      directors each `100000` from "over $100,000" while the real
      "Shares of Common Stock Beneficially Owned" column (22,887 / 3,672 / ...)
      went unread.

  X3  NO old row carries a percent AND at least half the filing's old `shares`
      values fall in the N-1A dollar-range endpoint set
      {0, 1, 10000, 50000, 100000, 500000, 1000000}.
      ADDED 2026-09-30, and the rule is quoted VERBATIM from the grind floor
      `regress-zero-row-ceiling-0.761-dollar-range-tables`, which measured it:
        "for each of the 590 set-(a) filings not recovered at commit d73248ab, read
         the OLD rows out of panel_e4e78a95/rows_*.tsv.gz; classify a filing
         dollar_range_shaped when NO old row carries a percent and at least half its
         old shares values fall in the dollar-range endpoint set
         {0,1,10000,50000,100000,500000,1000000} -- the N-1A ranges $1-$10,000 /
         $10,001-$50,000 / $50,001-$100,000 / over $100,000."
      Those are Item 22(b)(5) fund dollar-range tables read as share counts, and
      X1/X2 miss them for the reason that floor gives: "the ranges DIFFER between
      trustees, so no three rows carry one identical (shares,percent) pair and no
      holder_name carries a dollar sign." The floor verified six of six sampled
      filings against the documents' own words (0000950137-04-004256,
      0000950137-07-007193, 0001072613-08-000788, 0001047469-06-007946,
      0000950136-05-005070, and earlier 0000950134-02-001418, 0001047469-06-009764,
      0000891092-05-000978, 0000897101-04-000270, 0000950116-05-000211).
  X4  NO old row carries a percent AND >= 3 distinct old `table_index` values AND at
      least half the old rows carry a `holder_name` that repeats 3+ times in the
      filing — the fund-family COMPENSATION table attached once per fund.
      ADDED 2026-09-30, quoted VERBATIM from the grind floor
      `regress-zero-row-ceiling-0.734-refined`:
        "m3_repeated_per_fund 43 (no percent anywhere, at least 3 distinct old
         table_index values, and at least half the old rows are holder names that
         repeat 3+ times -- the fund-family COMPENSATION table attached once per
         fund, which is the rounds own mechanism M3 and which it says to REJECT)."
      All 43 are one document, 0000051931-18-000890 (American Funds 2018, old n_rows
      375) filed under 43 co-registrant CIKs, whose columns read verbatim from
      -debug: "Aggregate compensation from Fund (inc. voluntarily deferred
      compensation2) | Total compensation from all Funds | Dollar range3 of Fund
      shares owned | Aggregate dollar range3 of shares owned in all overseen Funds"
      — compensation dollars and dollar ranges, no share count and no percent.

WHY X3 AND X4 WERE ADDED. Set (a) was gated at `regress_zero_row_recovered >= 0.95`
on the premise that every filing in it had lost REAL ownership rows. It had not: the
two floors above measured, from the panels themselves, that 205 + 43 = 248 of the
933 set-(a) filings had OLD rows that were themselves wrong, which the duplicate
round REMOVED on purpose in 52f43c4f. That put a hard ceiling of 685/933 = 0.7342 on
the gate, so 0.95 was unreachable and the loop was being paid to re-accept tables
`regress_excluded_emitting_rows_rate` exists to catch. The correction is to the SET,
not to the threshold: 0.95 stays, the mis-specified members leave the denominator,
and they are reported as a DIAGNOSTIC (score.py prints the X3/X4 exclusions and
their emitting-rows rate separately from X1/X2, so re-accepting them is still
visible). `textMoneyBlock` must not be weakened.

A rule that was CONSIDERED AND REJECTED, because a document refuted it: "the old
parse emitted no percent anywhere" (980 of the 1,070). GE 2013
(`0001206774-13-001019`) has no percent anywhere and its old rows are the real
ownership table — `As a group (27) 24,040,027 / 40,202,945` and
`BlackRock 583,104,477` — because the document states no percent at all ("No
director or named executive owns more than 1%"). Share-count-only tables are
therefore KEPT in set (a).

SET-(b) AMENDMENT 2026-09-30. The floor proposes X7 "no old group row of
 the filing carries BOTH a share count and a non-zero percent" and X8 "at least
 half the old group rows of the filing carry a holder_name that is also a value
 in the filings share-class column". X7 alone also catches real ownership tables,
 so require the source grant guard below. X9 corrects position cells falsely
 called group names where the real aggregate is prose-only. These clauses affect
 (b) only: real non-group ownership recoveries in (a) are not removed. Dunham
 0000910472-08-000038 is a parser defect and stays gated. See GRIND_PLAN §13.

SET-(a) AMENDMENT 2026-09-30. X10-X13 use old fields only, with no percent
 anywhere (including numerical zero). X10 requires empty share_class, combined
 table_kind, >=3 table_index values, and >=2 holder names each with an identical
 (holder_name, shares) pair repeated >=3 times. X11 requires normalized names
 exactly {fund, entities n/a}. X12 requires a partnership-accounting name prefix.
 X13 requires one purchase-narrative row whose shares is an integer year 1900-2000.
 Exact rules are in ZERO_RULES; whitespace/case are normalized for name labels.
 They remove 14 named keys from the current gated (a) set and catch 0/513
 recovered keys. They do not change (b); exclusions stay diagnostic. See §14.

SET (c) LOST, 2026-10-01. A second diff: old n_rows > 0 in `panel` (092b6fb9) and
 0 in `panel_a449b66c` (--lost-old-panel / --lost-new-panel). Its old rows come
 from the 092b6fb9 panel; X1-X4 and X10-X13 are re-applied to them, plus the
 (c)-only X14-X20 in LOST_RULES (old-row fields only). Columns cand_lost ..
 lost_old_n_percent_parsed are appended; the 31 (a)/(b) columns are byte-identical
 for (a)/(b) keys and 0/na for (c)-only keys. Gated as regress_lost_recovered.
 Audit: r2000/scratch/lost_audit.tsv; report r2000/scratch/lost_set_setup.md.

SCOPE, not exclusion, for (b). Of the group-row candidates that survive X1/X2,
the GATED set is the filings whose lost group rows include at least one carrying a
PARSED PERCENT; the rest are reported as a DIAGNOSTIC with their own denominator.
The percent is what a group row is scored on — `group_row_detection_rate`'s
denominator is filings with a parsed percent, and the FactSet D&O aggregate is a
percent — and the share-only group-row population is where the report's
compensation/award group labels sit ("All Current Executives as a Group | 271000 |
no percent"). It is a scope decision, disclosed, with the wider population
printed every round; it is NOT a claim that those 1,000-odd rows were wrong.

Inputs   /data/def14a_own/panel_e4e78a95/manifest_*.tsv.gz + rows_*.tsv.gz   (old)
         /data/def14a_own/panel/manifest_*.tsv.gz                           (new)
         <gold-dir>/gold_filelist_all.tsv, <gold-dir>/sample_full.tsv       (union)

Outputs  <gold-dir>/gold_regress.tsv       the set, one row per CANDIDATE filing,
                                           with the flags that say which set it is
                                           in and which exclusion clause fired
         <gold-dir>/regress_filelist.tsv   parser-format filelist for the round
         <gold-dir>/gold_regress.json      sidecar: rules, counts, hashes
         <gold-dir>/round_filelist.tsv     THE 3-WAY UNION this script now owns
                                           (gold_filelist_all + sample_full +
                                           regress_filelist). `sample_full_archive.py`
                                           deliberately no longer writes it: one
                                           writer, one file.

`gold_regress.tsv` is covered by lock.sha256, so the loop cannot edit the set it
is scored on. Determinism: every output is sorted; re-running writes byte-identical
files.
"""

import argparse
import csv
import glob
import gzip
import hashlib
import json
import os
import sys
import re
from html.parser import HTMLParser
from concurrent.futures import ProcessPoolExecutor
from collections import Counter, defaultdict

csv.field_size_limit(1 << 24)
TSV = {"delimiter": "\t", "quoting": csv.QUOTE_NONE}


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


ZERO_RULES = {
    "X10_repeated_fund_compensation": "no old percent; all old share_class empty; all table_kind combined; >=3 distinct table_index; >=2 distinct holder names each has an identical (holder_name, shares) pair occurring >=3 times",
    "X11_audit_billing_entities": "no old percent; normalized set of old holder_name equals exactly {fund, entities n/a}",
    "X12_partnership_accounting": "no old percent; an old name begins Allocation of Income/Loss, Allocation of Income or Loss, Reimbursements to General Partners, Property management fees paid, Rental income, or Interest income",
    "X13_purchase_narrative_year": "exactly one old row; no percent; name begins The Company purchased; shares is an integer calendar year 1900-2000",
}


def zero_row_exclusion_flags(old_rows):
    """X10-X13 predicates; membership/recovery flags are deliberately not inputs."""
    if not old_rows or any(r["percent"] != "" for r in old_rows):
        return (0, 0, 0, 0)
    pairs = Counter((r["holder_name"], r["shares"]) for r in old_rows)
    repeated_names = {name for (name, shares), n in pairs.items() if n >= 3}
    x10 = int(all(r["share_class"] == "" and r["table_kind"] == "combined" for r in old_rows)
              and len({r["table_index"] for r in old_rows}) >= 3
              and len(repeated_names) >= 2)
    normalized_names = {" ".join(r["holder_name"].casefold().split()) for r in old_rows}
    x11 = int(normalized_names == {"fund", "entities n/a"})
    prefixes = ("allocation of income/loss", "allocation of income or loss",
                "reimbursements to general partners", "property management fees paid",
                "rental income", "interest income")
    x12 = int(any(name.startswith(prefixes) for name in normalized_names))
    shares = old_rows[0]["shares"]
    x13 = int(len(old_rows) == 1
              and next(iter(normalized_names)).startswith("the company purchased")
              and re.fullmatch(r"[0-9]+", shares) is not None
              and 1900 <= int(shares) <= 2000)
    return (x10, x11, x12, x13)


# Set (c) only (2026-10-01): old = /data/def14a_own/panel (092b6fb9), new =
# panel_a449b66c. OLD-row fields only; no new-parser output, no audit label.
LOST_RULES = {
    "X14_year_as_shares": "every numeric old shares value is a calendar year 1900-2030 or < 1000; >= 1 is a year; years are >= half the old rows",
    "X15_percent_only_prose": "<= 2 old rows; every old row has empty shares and a non-empty percent",
    "X16_small_int_shares": "no old percent; <= 4 old rows; every old shares value is an integer 1-99",
    "X17_no_value_rows": "every old row has empty shares AND empty percent",
    "X18_prose_lead_name": "every old holder_name (after a leading footnote number) begins As of, On, At, For [the] fiscal, According to, Person during, If a, Includes, This total/figure, Also includes, Consists of, Options to purchase, Based on/upon, The total, Go to, Click on, Table of contents, or Section <digit>",
    "X19_function_word_tail": "every old holder_name is empty or ends in a function word (and of the on with to for in by at as or from that which is was were than upon)",
    "X20_compensation_title_rows": "no old percent; >= 2 old rows; >= one third of old holder_names begin an officer title (chairman, president, chief, executive, officer, vice president, senior vice, secretary, treasurer, former, board, exec) or end in a year 1950-2029 not preceded by 'since'",
}
LOST_FUNCTION_WORD = r"(and|of|the|on|with|to|for|in|by|at|as|or|from|that|which|is|was|were|than|upon)"
LOST_PROSE_LEAD = (r"(as of|on|at|for (the )?fiscal|according to|person during|if a|includes|"
                   r"this (total|figure)|also includes|consists of|options to purchase|based (on|upon)|"
                   r"the total|go to|click on|table of contents|section \d)\b")
LOST_TITLE = (r"(chairman|president|chief|executive|officer|vice president|senior vice|secretary|"
              r"treasurer|former|board|exec)\b")


def base_exclusion_flags(old_rows):
    """X1-X4 over one filing's old rows; main() asserts this equals its inline (a)/(b) rule."""
    n = len(old_rows)
    vals = Counter((r["shares"], r["percent"]) for r in old_rows)
    x1 = int(any("$" in (r["holder_name"] or "") for r in old_rows))
    x2 = int(n >= 3 and max(vals.values()) == n)
    no_pct = n > 0 and all((r["percent"] or "") == "" for r in old_rows)
    endpoint = 0
    for r in old_rows:
        try:
            endpoint += int(int(r["shares"]) in {0, 1, 10000, 50000, 100000, 500000, 1000000})
        except (TypeError, ValueError):
            pass          # same as main(): an unparsed shares cell is not an endpoint
    x3 = int(no_pct and 2 * endpoint >= n)
    names = Counter(r["holder_name"] or "" for r in old_rows)
    n_rep = sum(1 for r in old_rows if names[r["holder_name"] or ""] >= 3)
    x4 = int(no_pct and len({r["table_index"] for r in old_rows}) >= 3 and 2 * n_rep >= n)
    return (x1, x2, x3, x4)


def lost_exclusion_flags(old_rows):
    """X14-X20 predicates for set (c); membership/recovery flags are deliberately not inputs."""
    n = len(old_rows)
    if n == 0:
        return (0,) * 7
    sh = [int(r["shares"]) if re.fullmatch(r"[0-9]+", r["shares"] or "") else None for r in old_rows]
    names = [" ".join((r["holder_name"] or "").split()) for r in old_rows]
    no_pct = all(r["percent"] == "" for r in old_rows)
    years = sum(1 for v in sh if v is not None and 1900 <= v <= 2030)
    x14 = int(years >= 1 and 2 * years >= n
              and all(v is None or 1900 <= v <= 2030 or v < 1000 for v in sh))
    x15 = int(n <= 2 and all(r["shares"] == "" and r["percent"] != "" for r in old_rows))
    x16 = int(no_pct and n <= 4 and all(v is not None and 1 <= v < 100 for v in sh))
    x17 = int(all(r["shares"] == "" and r["percent"] == "" for r in old_rows))
    x18 = int(all(re.match(LOST_PROSE_LEAD, re.sub(r"^\d+\s+", "", nm), re.I) for nm in names))
    x19 = int(all(nm == "" or re.search(r"\b%s$" % LOST_FUNCTION_WORD, nm, re.I) for nm in names))
    titled = sum(1 for nm in names if re.match(LOST_TITLE, nm, re.I)
                 or re.search(r"(?<!since )\b(19[5-9]\d|20[0-2]\d)$", nm))
    x20 = int(no_pct and n >= 2 and 3 * titled >= n)
    return (x14, x15, x16, x17, x18, x19, x20)


LOST_HEADER = ["cand_lost", "in_set_lost", "lost_excl_x1_x4", "lost_excl_x10_x13",
               "excl_x14_year_as_shares", "excl_x15_percent_only_prose",
               "excl_x16_small_int_shares", "excl_x17_no_value_rows",
               "excl_x18_prose_lead_name", "excl_x19_function_word_tail",
               "excl_x20_compensation_title_rows",
               "lost_old_n_rows", "lost_old_n_percent_parsed"]


def lost_columns(key, cand_c, lost_rows, lost_old, counts):
    """The set-(c) tail of one gold_regress.tsv row. X1-X4 and X10-X13 are the
    existing rules re-applied to the set-(c) old panel's rows; X14-X20 are (c)-only."""
    if key not in cand_c:
        return [0] * 11 + ["na", "na"]
    rs = lost_rows[key]
    base = base_exclusion_flags(rs)
    zero = zero_row_exclusion_flags(rs)
    lost = lost_exclusion_flags(rs)
    x1_x4, x10_x13 = int(any(base)), int(any(zero))
    excluded = x1_x4 or x10_x13 or any(lost)
    counts["lost_candidates"] += 1
    counts["lost_excl_x1_x4"] += x1_x4
    counts["lost_excl_x10_x13"] += x10_x13
    for name, flag in zip(sorted(LOST_RULES), lost):
        counts["lost_excl_" + name.split("_")[0].lower()] += flag
    counts["lost_excl_any"] += int(bool(excluded))
    counts["set_lost"] += int(not excluded)
    m = lost_old[key]
    return [1, int(not excluded), x1_x4, x10_x13, *lost, m["n_rows"], m["n_percent_parsed"]]


def read_candidate_rows(task):
    """Filter within each shard worker; only candidate rows cross process boundaries."""
    path, keys = task
    scanned, selected = 0, []
    with gzip.open(path, "rt") as fh:
        for r in csv.DictReader(fh, **TSV):
            scanned += 1
            key = (r["cik"].lstrip("0") or "0", r["accession"])
            if key in keys:
                selected.append((key, r))
    return scanned, selected


def read_manifests(panel_dir):
    """-> {(cik, accession): row}. Raises if the panel is not on disk."""
    paths = sorted(glob.glob(os.path.join(panel_dir, "manifest_*.tsv.gz")))
    if not paths:
        sys.exit("ERROR: no manifest_*.tsv.gz under %s" % panel_dir)
    out = {}
    for p in paths:
        with gzip.open(p, "rt") as fh:
            for r in csv.DictReader(fh, **TSV):
                key = (r["cik"].lstrip("0") or "0", r["accession"])
                if key in out:
                    sys.exit("ERROR: duplicate manifest key %s in %s" % (key, p))
                out[key] = r
    print("[in ] %s: %d manifest rows" % (panel_dir, len(out)))
    return out



# Set-(b) only: the floor's broad X7 is unsafe on real ownership tables.
# X7 is guarded by a document-confirmed grant header; X8 reads the actual
# Share Class column, not the old parser's empty share_class field. X9 covers
# the floor's prose-only aggregate whose old "group" names were position cells.
GROUP_RULES = {
    "X7": "no old group row of the filing carries BOTH a share count and a non-zero percent",
    "X8": "at least half the old group rows of the filing carry a holder_name that is also a value in the filings share-class column",
    "X9": "all old group names are Director-of position cells, with the real group aggregate only in prose",
}


class SourceTables(HTMLParser):
    """Leaf tables retain cell roles; outer layout tables are not evidence."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.tables, self.text = [], [], []

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            if self.stack:
                self.stack[-1]["nested"] = True
            self.stack.append({"rows": [], "row": None, "cell": None, "nested": False})
        elif self.stack:
            t = self.stack[-1]
            if tag == "tr":
                t["row"] = []
            elif tag in ("td", "th") and t["row"] is not None:
                t["cell"] = []

    def handle_data(self, data):
        self.text.append(data)
        if self.stack and self.stack[-1]["cell"] is not None:
            self.stack[-1]["cell"].append(data)

    def handle_endtag(self, tag):
        if not self.stack:
            return
        t = self.stack[-1]
        if tag in ("td", "th") and t["cell"] is not None:
            t["row"].append(" ".join(" ".join(t["cell"]).split()))
            t["cell"] = None
        elif tag == "tr" and t["row"] is not None:
            t["rows"].append(t["row"])
            t["row"] = None
        elif tag == "table":
            self.stack.pop()
            if not t["nested"]:
                self.tables.append(t["rows"])


def group_source_flags(task):
    key, groups, source, roots = task
    paths = [os.path.join(root, source) for root in roots]
    paths += [os.path.join(root, key[1] + ".txt") for root in roots]
    path = next((p for p in paths if os.path.isfile(p)), None)
    if path is None:
        raise FileNotFoundError("group exclusion needs original source: " + source)
    with open(path) as fh:
        raw = fh.read()
    doc = SourceTables()
    doc.feed(raw)
    classes, positions, grant_names, table_group = set(), set(), set(), set()
    for table in doc.tables:
        for i, row in enumerate(table):
            cells = [c.casefold() for c in row]
            for label, dest in (("share class", classes), ("position", positions)):
                if label in cells:
                    col = cells.index(label)
                    dest.update(r[col].casefold() for r in table[i+1:] if len(r) > col and r[col])
            head = " ".join(cells)
            if re.search(r"shares underlying options grants|restricted shares received", head):
                grant_names.update(r[0].casefold() for r in table[i+1:] if r)
            if not re.search(r"options grants|restricted shares received", " ".join(" ".join(r) for r in table).casefold()):
                table_group.update(c.casefold() for r in table for c in r if re.search(r"as a group", c, re.I))
    paired = sum(r["shares"] != "" and r["percent"] != "" and float(r["percent"]) != 0 for r in groups)
    pct_groups = [r for r in groups if r["percent"] != ""]
    # Require mixed zero-percent/share-only old group rows plus source-confirmed
    # grant labels. True zero ownership and split-column tables stay gated.
    x7 = int(paired == 0 and len(groups) >= 2 and bool(pct_groups)
             and all(float(r["percent"]) == 0 and r["holder_name"].casefold() in grant_names for r in pct_groups)
             and not table_group)
    hits = sum(r["holder_name"].casefold() in classes for r in groups)
    x8 = int(bool(groups) and 2 * hits >= len(groups))
    plain = " ".join(" ".join(doc.text).split())
    role_hits = sum(r["holder_name"].casefold() in positions for r in groups)
    x9 = int(bool(groups) and role_hits == len(groups) and not table_group
             and re.search(r"directors and executive officers.{0,80}as a group owned [\d,]+ shares or [\d.]+%", plain, re.I) is not None)
    return key, (x7, x8, x9), {"source_file": source, "sha256": sha256_of(path),
                              "group_rows": len(groups), "paired_group_rows": paired,
                              "share_class_name_matches": hits, "position_name_matches": role_hits}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--old-panel", default="/data/def14a_own/panel_e4e78a95")
    ap.add_argument("--new-panel", default="/data/def14a_own/panel")
    ap.add_argument("--gold-dir", default=os.environ.get("GOLD_DIR", "/data/def14a_own/gold"))
    ap.add_argument("--source-root", action="append", default=None,
                    help="local original filings for guarded set-(b) exclusions")
    ap.add_argument("--lost-old-panel", default="/data/def14a_own/panel",
                    help="set (c) old panel (parser 092b6fb9)")
    ap.add_argument("--lost-new-panel", default="/data/def14a_own/panel_a449b66c",
                    help="set (c) new panel (parser a449b66c)")
    args = ap.parse_args()
    roots = args.source_root or ["/data/def14a_own/work/regsamp18", "/data/def14a_own/work/regsamp"]
    g = args.gold_dir

    old = read_manifests(args.old_panel)
    new = read_manifests(args.new_panel)

    # JOIN AUDIT (E3): the two panels are the same 207,912 filings by construction —
    # the same filelist and the same shard plan, hashed equal in the run-2 report.
    # If that ever stops holding, say so loudly rather than diffing a subset.
    both = sorted(set(old) & set(new))
    print("[join] old=%d new=%d matched=%d old_only=%d new_only=%d" % (
        len(old), len(new), len(both), len(set(old) - set(new)), len(set(new) - set(old))))
    if len(both) != len(old) or len(both) != len(new):
        sys.exit("ERROR: the two panels do not cover the same filings; a diff over a "
                 "subset is not the regression this round is about")

    cand_a, cand_b = set(), set()
    for key in both:
        o, n = old[key], new[key]
        if int(o["n_rows"]) > 0 and int(n["n_rows"]) == 0:
            cand_a.add(key)
        if o["has_group_row"] == "1" and n["has_group_row"] == "0":
            cand_b.add(key)
    cands = cand_a | cand_b
    print("[set] candidates: (a) zero-row %d ; (b) group-row %d ; union %d" % (
        len(cand_a), len(cand_b), len(cands)))

    # ---- set (c), 2026-10-01: a SECOND panel diff, its own old panel -----------
    lost_old = read_manifests(args.lost_old_panel)
    lost_new = read_manifests(args.lost_new_panel)
    lost_both = set(lost_old) & set(lost_new)
    print("[join] lost old=%d new=%d matched=%d old_only=%d new_only=%d" % (
        len(lost_old), len(lost_new), len(lost_both),
        len(set(lost_old) - set(lost_new)), len(set(lost_new) - set(lost_old))))
    if len(lost_both) != len(lost_old) or len(lost_both) != len(lost_new):
        sys.exit("ERROR: the set-(c) panels do not cover the same filings")
    cand_c = {k for k in lost_both
              if int(lost_old[k]["n_rows"]) > 0 and int(lost_new[k]["n_rows"]) == 0}
    missing_c = cand_c - set(old)
    src_diff = [k for k in cand_c if k in old and old[k]["source_file"] != lost_old[k]["source_file"]]
    print("[set] candidates: (c) lost %d ; also (a) %d ; also (b) %d ; new keys %d ; "
          "not in the (a)/(b) old manifest %d ; source_file disagreements %d" % (
              len(cand_c), len(cand_c & cand_a), len(cand_c & cand_b), len(cand_c - cands),
              len(missing_c), len(src_diff)))
    if missing_c or src_diff:
        sys.exit("ERROR: set-(c) keys missing from, or disagreeing with, the (a)/(b) manifest")

    # ---- the OLD rows of the candidate filings, for X1..X4 and for the report ----
    # N-1A DOLLAR-RANGE ENDPOINTS, quoted from the 0.761 floor: the $1-$10,000 /
    # $10,001-$50,000 / $50,001-$100,000 / over $100,000 bands, plus 0 and the
    # $500,001-$1,000,000 band the later forms add. A `shares` value equal to one of
    # these and no percent anywhere is a dollar RANGE read as a share COUNT.
    DOLLAR_RANGE_ENDPOINTS = {0, 1, 10000, 50000, 100000, 500000, 1000000}

    group_rows = defaultdict(list)
    old_rows = defaultdict(list)
    n_scanned_rows = 0
    n_old_rows = 0
    val_count = defaultdict(lambda: defaultdict(int))   # key -> (shares, percent) -> n
    name_count = defaultdict(lambda: defaultdict(int))  # key -> holder_name -> n   (X4)
    tables = defaultdict(set)                           # key -> {table_index}      (X4)
    names = defaultdict(list)                           # key -> [holder_name, ...] (X4)
    stat = defaultdict(lambda: {"rows": 0, "dollar": 0, "grp": 0, "grp_pct": 0,
                                "pct": 0, "endpoint": 0})
    paths = sorted(glob.glob(os.path.join(args.old_panel, "rows_*.tsv.gz")))
    if not paths:
        sys.exit("ERROR: no old row shards under " + args.old_panel)
    # A shard is already a large CPU task; chunksize=1 distributes the 33 shards.
    with ProcessPoolExecutor(max_workers=min(8, len(paths))) as pool:
        for scanned, selected in pool.map(read_candidate_rows, [(p, cands) for p in paths], chunksize=1):
            n_scanned_rows += scanned
            for key, r in selected:
                old_rows[key].append(r)
                n_old_rows += 1
                s = stat[key]
                s["rows"] += 1
                if "$" in (r["holder_name"] or ""):
                    s["dollar"] += 1
                if r["is_group_row"] == "1":
                    s["grp"] += 1
                    group_rows[key].append(r)
                    if (r["percent"] or "") != "":
                        s["grp_pct"] += 1
                val_count[key][(r["shares"], r["percent"])] += 1
                # --- X3 / X4 inputs ---
                if (r["percent"] or "") != "":
                    s["pct"] += 1
                try:
                    if int(r["shares"]) in DOLLAR_RANGE_ENDPOINTS:
                        s["endpoint"] += 1
                except (TypeError, ValueError):
                    pass          # an unparsed shares cell is not an endpoint
                tables[key].add(r["table_index"])
                nm = r["holder_name"] or ""
                names[key].append(nm)
                name_count[key][nm] += 1
    print("[in ] old rows in candidate filings: %d" % n_old_rows)
    print("[transform] old rows %d -> candidate rows %d -> filing aggregates %d" % (
        n_scanned_rows, n_old_rows, len(old_rows)))
    print("[join] candidates=%d old-row keys=%d matched=%d match_rate=%d/%d" % (
        len(cands), len(old_rows), len(cands & set(old_rows)), len(cands & set(old_rows)), len(cands)))
    if set(old_rows) != cands or any(len(old_rows[k]) != int(old[k]["n_rows"]) for k in cands):
        sys.exit("ERROR: candidate old-row coverage/counts disagree with manifests")

    lost_rows = defaultdict(list)
    lost_paths = sorted(glob.glob(os.path.join(args.lost_old_panel, "rows_*.tsv.gz")))
    if not lost_paths:
        sys.exit("ERROR: no old row shards under " + args.lost_old_panel)
    n_lost_scanned = 0
    with ProcessPoolExecutor(max_workers=min(8, len(lost_paths))) as pool:
        for scanned, selected in pool.map(read_candidate_rows, [(p, cand_c) for p in lost_paths], chunksize=1):
            n_lost_scanned += scanned
            for key, r in selected:
                lost_rows[key].append(r)
    n_lost_rows = sum(len(v) for v in lost_rows.values())
    print("[transform] lost old rows %d -> set-(c) rows %d -> filing aggregates %d" % (
        n_lost_scanned, n_lost_rows, len(lost_rows)))
    if set(lost_rows) != cand_c or any(len(lost_rows[k]) != int(lost_old[k]["n_rows"]) for k in cand_c):
        sys.exit("ERROR: set-(c) old-row coverage/counts disagree with manifests")
    # Shard order is not row order; fix it so every rule sees one canonical sequence.
    for key in lost_rows:
        lost_rows[key].sort(key=lambda r: (int(r["table_index"]), int(r["row_index"])))

    tasks = []
    for key in sorted(cand_b):
        groups = group_rows[key]
        # Cheap OLD-row predicates bound document reads. No current recovery flag
        # or accession whitelist is used to select an exclusion.
        pct_groups = [r for r in groups if r["percent"] != ""]
        zero_grant_shape = len(groups) >= 2 and pct_groups and all(float(r["percent"]) == 0 for r in pct_groups)
        class_shape = groups and 2 * sum(re.fullmatch(r"individual investor(?: class)?", r["holder_name"], re.I) is not None for r in groups) >= len(groups)
        role_shape = groups and all(re.match(r"director of\b", r["holder_name"], re.I) for r in groups)
        if stat[key]["grp_pct"] and (zero_grant_shape or class_shape or role_shape):
            tasks.append((key, groups, old[key]["source_file"], roots))
    group_flags, evidence = {}, {}
    if tasks:
        with ProcessPoolExecutor(max_workers=min(8, len(tasks))) as pool:
            for key, flags, proof in pool.map(group_source_flags, tasks, chunksize=1):
                group_flags[key] = flags
                evidence["%s|%s" % key] = proof
    print("[source] guarded group classification: %d tasks -> %d matched sources (100%%)" % (len(tasks), len(evidence)))

    rows, counts = [], defaultdict(int)
    for key in sorted(cands | cand_c):
        cik, acc = key
        if key not in cands:
            # A set-(c)-only key: the (a)/(b) columns say "not a candidate", and the
            # e4e78a95 old-row statistics, which were never read for it, say so.
            m = old[key]
            rows.append([acc, cik, m["filing_date"], m["source_file"], m["form"]]
                        + [0] * 16 + ["na"] * 10 + lost_columns(key, cand_c, lost_rows, lost_old, counts))
            continue
        s = stat[key]
        vals = val_count[key]
        max_same = max(vals.values()) if vals else 0
        x1 = 1 if s["dollar"] > 0 else 0
        x2 = 1 if (s["rows"] >= 3 and max_same == s["rows"]) else 0
        # X3 / X4 — both require "no percent anywhere" in the OLD rows, which is the
        # condition the two floors state and which is NOT on its own an exclusion
        # (GE 2013 refuted that; see the rejected rule above). It is the CONJUNCTION
        # with the dollar-range shape (X3) or the per-fund repetition (X4) that is.
        no_pct = s["rows"] > 0 and s["pct"] == 0
        x3 = 1 if (no_pct and 2 * s["endpoint"] >= s["rows"]) else 0
        n_rep_rows = sum(1 for nm in names[key] if name_count[key][nm] >= 3)
        x4 = 1 if (no_pct and len(tables[key]) >= 3 and 2 * n_rep_rows >= s["rows"]) else 0
        excluded = x1 or x2 or x3 or x4
        x10, x11, x12, x13 = zero_row_exclusion_flags(old_rows[key]) if key in cand_a else (0, 0, 0, 0)
        excluded_a = excluded or x10 or x11 or x12 or x13
        in_a = 1 if (key in cand_a and not excluded_a) else 0
        x7, x8, x9 = group_flags.get(key, (0, 0, 0))
        excluded_b = excluded or x7 or x8 or x9
        in_b_gated = 1 if (key in cand_b and not excluded_b and s["grp_pct"] > 0) else 0
        in_b_diag = 1 if (key in cand_b and not excluded and s["grp_pct"] == 0) else 0
        m = old[key]
        rows.append([acc, cik, m["filing_date"], m["source_file"], m["form"],
                     1 if key in cand_a else 0, 1 if key in cand_b else 0,
                     in_a, in_b_gated, in_b_diag, x1, x2, x3, x4, x7, x8, x9, x10, x11, x12, x13,
                     m["n_rows"], m["n_percent_parsed"], s["grp"], s["grp_pct"],
                     s["rows"], max_same,
                     s["pct"], s["endpoint"], len(tables[key]), n_rep_rows]
                    + lost_columns(key, cand_c, lost_rows, lost_old, counts))
        if base_exclusion_flags(old_rows[key]) != (x1, x2, x3, x4):
            sys.exit("ERROR: base_exclusion_flags disagrees with the inline X1-X4 for %s" % (key,))
        counts["candidates"] += 1
        counts["cand_a"] += 1 if key in cand_a else 0
        counts["cand_b"] += 1 if key in cand_b else 0
        counts["excl_x1"] += x1
        counts["excl_x2"] += x2
        counts["excl_x3"] += x3
        counts["excl_x4"] += x4
        counts["excl_x7"] += x7
        counts["excl_x8"] += x8
        counts["excl_x9"] += x9
        for clause, flag in zip(("x10", "x11", "x12", "x13"), (x10, x11, x12, x13)):
            counts["excl_" + clause] += flag
            counts["excl_" + clause + "_new_from_a"] += int(bool(flag and not excluded))
        counts["excl_x10_x13_new_from_a"] += int(bool((x10 or x11 or x12 or x13) and not excluded))
        counts["excl_group_new"] += int(bool((x7 or x8 or x9) and not excluded))
        counts["excl_x1_only"] += 1 if (x1 and not x2) else 0
        counts["excl_x2_only"] += 1 if (x2 and not x1) else 0
        counts["excl_both"] += 1 if (x1 and x2) else 0
        # What the 2026-09-30 correction ACTUALLY removed, which is the number the
        # amendment is judged on: candidates X3/X4 catch that X1/X2 did not.
        counts["excl_x3_new"] += 1 if (x3 and not (x1 or x2)) else 0
        counts["excl_x4_new"] += 1 if (x4 and not (x1 or x2 or x3)) else 0
        counts["excl_x3_or_x4_new"] += 1 if ((x3 or x4) and not (x1 or x2)) else 0
        counts["excl_x3_or_x4_new_from_a"] += 1 if (
            key in cand_a and (x3 or x4) and not (x1 or x2)) else 0
        counts["excl_x3_or_x4_new_from_b"] += 1 if (
            key in cand_b and (x3 or x4) and not (x1 or x2)) else 0
        counts["excl_any"] += 1 if (excluded_a or excluded_b) else 0
        counts["excl_from_a"] += 1 if (key in cand_a and excluded_a) else 0
        counts["excl_from_b"] += 1 if (key in cand_b and excluded_b) else 0
        counts["set_a"] += in_a
        counts["set_b_gated"] += in_b_gated
        counts["set_b_diag"] += in_b_diag
        counts["set_a_and_b_gated"] += 1 if (in_a and in_b_gated) else 0

    header = ["accession", "cik", "filing_date", "source_file", "form",
              "cand_zero_row", "cand_group_row",
              "in_set_zero_row", "in_set_group_row_gated", "in_set_group_row_diag",
              "excl_x1_dollar_in_name", "excl_x2_one_value_all_rows",
              "excl_x3_dollar_range_table", "excl_x4_m3_repeated_per_fund",
              "excl_x7_group_grant_zero", "excl_x8_group_share_class_name",
              "excl_x9_group_position_name_prose",
              "excl_x10_repeated_fund_compensation", "excl_x11_audit_billing_entities",
              "excl_x12_partnership_accounting", "excl_x13_purchase_narrative_year",
              "old_n_rows", "old_n_percent_parsed", "old_group_rows",
              "old_group_rows_with_percent", "old_rows_counted", "old_max_identical_value",
              # the X3/X4 inputs, so every exclusion can be re-checked from this file
              "old_rows_with_percent", "old_rows_range_endpoint_shares",
              "old_distinct_table_index", "old_rows_name_repeated_3plus"] + LOST_HEADER
    out_path = os.path.join(g, "gold_regress.tsv")
    rows.sort(key=lambda r: (r[0], int(r[1])))
    with open(out_path, "w") as fh:
        fh.write("\t".join(header) + "\n")
        for r in rows:
            fh.write("\t".join(str(x) for x in r) + "\n")
    print("[out] %s: %d candidate filings" % (out_path, len(rows)))
    for k in sorted(counts):
        print("       %-20s %d" % (k, counts[k]))

    # ---- the filelist the round submits -------------------------------------
    # EVERY candidate is submitted, including the excluded ones: the diagnostic
    # over the group-row population needs them, and a set the round does not parse
    # is a set the scorer cannot see.
    fl_path = os.path.join(g, "regress_filelist.tsv")
    fl = sorted({(r[3], r[1], r[0], r[4], r[2]) for r in rows})
    with open(fl_path, "w") as fh:
        for src, cik, acc, form, fdate in fl:
            fh.write("\t".join([src, cik, acc, form, fdate, "regress"]) + "\n")
    print("[out] %s: %d filings" % (fl_path, len(fl)))

    # ---- round_filelist.tsv, the 3-way union THIS script owns ----------------
    gold_path = os.path.join(g, "gold_filelist_all.tsv")
    sample_path = os.path.join(g, "sample_full.tsv")
    for p in (gold_path, sample_path):
        if not os.path.exists(p):
            sys.exit("ERROR: %s missing — round_filelist.tsv is the union of "
                     "gold_filelist_all.tsv, sample_full.tsv and regress_filelist.tsv" % p)
    union, seen, per_src = [], set(), {}
    for src in (gold_path, sample_path, fl_path):
        n_kept = 0
        with open(src) as fh:
            for line in fh:
                f = line.rstrip("\n").split("\t")
                if f[0] in seen:
                    continue
                seen.add(f[0])
                union.append(line.rstrip("\n"))
                n_kept += 1
        per_src[os.path.basename(src)] = {
            "lines": sum(1 for _ in open(src)), "new_paths_contributed": n_kept}
    union.sort()
    round_path = os.path.join(g, "round_filelist.tsv")
    with open(round_path, "w") as fh:
        for line in union:
            fh.write(line + "\n")
    print("[out] %s: %d filings" % (round_path, len(union)))
    for k, v in sorted(per_src.items()):
        print("       %-24s lines=%-6d new paths=%d" % (k, v["lines"], v["new_paths_contributed"]))

    side = {
        "built": "gold/build_regress_set.py",
        "purpose": "fixed regression set for the 2026-09-29 regression round",
        "old_panel": args.old_panel,
        "new_panel": args.new_panel,
        "old_panel_parser_commit": "4b36a962 (panel committed at e4e78a95)",
        "new_panel_parser_commit": "092b6fb9",
        "definition": {
            "set_zero_row": "old n_rows > 0 AND new n_rows == 0",
            "set_group_row": "old has_group_row == 1 AND new has_group_row == 0",
        },
        "exclusions": {
            "X1_dollar_in_name": ">= 1 old row whose holder_name contains '$' — the "
                                 "parser read a DOLLAR column as the name column "
                                 "(dollar-range-of-equity or summary compensation table)",
            "X2_one_value_all_rows": ">= 3 old rows, all carrying the identical "
                                     "(shares, percent) pair — no real ownership table "
                                     "gives every holder the same holding",
            "X3_dollar_range_table": "ADDED 2026-09-30, quoted from grind floor "
                                     "regress-zero-row-ceiling-0.761-dollar-range-tables: "
                                     "'classify a filing dollar_range_shaped when NO old "
                                     "row carries a percent and at least half its old "
                                     "shares values fall in the dollar-range endpoint set "
                                     "{0,1,10000,50000,100000,500000,1000000} -- the N-1A "
                                     "ranges $1-$10,000 / $10,001-$50,000 / "
                                     "$50,001-$100,000 / over $100,000.'",
            "X4_m3_repeated_per_fund": "ADDED 2026-09-30, quoted from grind floor "
                                       "regress-zero-row-ceiling-0.734-refined: "
                                       "'m3_repeated_per_fund 43 (no percent anywhere, at "
                                       "least 3 distinct old table_index values, and at "
                                       "least half the old rows are holder names that "
                                       "repeat 3+ times -- the fund-family COMPENSATION "
                                       "table attached once per fund, which is the rounds "
                                       "own mechanism M3 and which it says to REJECT).'",
            "why_X3_X4_added": "set (a) was gated at regress_zero_row_recovered >= 0.95 on "
                               "the premise that every member had lost REAL ownership rows. "
                               "The two floors above measured, from the panels, that 205 + "
                               "43 = 248 of the 933 set-(a) filings had OLD rows that were "
                               "themselves wrong and that the duplicate round removed on "
                               "purpose in 52f43c4f, putting a hard ceiling of 685/933 = "
                               "0.7342 on the gate. The SET is corrected; the 0.95 "
                               "thresholds are unchanged; the removed filings remain a "
                               "reported diagnostic",
            "rejected_rule": "'old parse emitted no percent anywhere' (980 of the 1,070) "
                             "was REJECTED: GE 2013 0001206774-13-001019 states no percent "
                             "at all and its old rows are the real table",
        },
        "zero_row_exclusion_rules": ZERO_RULES,
        "lost_set": {
            "added": "2026-10-01",
            "definition": "set (c): old n_rows > 0 AND new n_rows == 0, old = lost_old_panel, new = lost_new_panel",
            "lost_old_panel": args.lost_old_panel,
            "lost_new_panel": args.lost_new_panel,
            "lost_old_panel_parser_commit": "092b6fb9",
            "lost_new_panel_parser_commit": "a449b66c",
            "exclusion": "X1-X4 and X10-X13 re-applied to the set-(c) old rows (columns lost_excl_x1_x4 / lost_excl_x10_x13), plus the set-(c)-only X14-X20; old-row fields only",
            "exclusion_rules": LOST_RULES,
            "gated_metric": "regress_lost_recovered = |{in_set_lost: >= 1 parsed row now}| / |in_set_lost|",
            "audit": "/home/eh/projects/r2000/scratch/lost_audit.tsv; report /home/eh/projects/r2000/scratch/lost_set_setup.md",
            "old_rows": n_lost_rows,
        },
        "zero_row_exclusion_scope": "X10-X13: set (a) candidates only; old-row fields only; no percent means empty field, not numerical zero; name labels normalize whitespace/case; set (b) gated and diagnostic unchanged; thresholds unchanged; all candidates still submitted and excluded filings reported diagnostic",
        "group_exclusion_rules": GROUP_RULES,
        "group_exclusion_guards": {
            "X7": "mixed old group rows (>=2), percent-carrying group rows all zero and named in a source grant table; no non-grant table group cell",
            "X8": "old group majority Individual Investor[/Class] shape, then equality against actual source Share Class cells",
            "X9": "all old group names begin Director of, equal source Position cells, no table group cell; directors-and-officers group shares/percent aggregate in prose",
            "scope": "set (b) only; set (a) unchanged; not an exclusion merely because old shares are missing",
            "retained_counterexample": "0000910472-08-000038: As a Group | Corporate/Government Bond Fund-N Class | 0.04% | 2,103; genuine table, parser defect",
        },
        "group_source_evidence": dict(sorted(evidence.items())),
        "group_row_scope": "of the group-row candidates surviving X1/X2, the GATED set is "
                           "those whose lost group rows include >= 1 carrying a parsed "
                           "percent; the rest are a printed diagnostic",
        "counts": dict(sorted(counts.items())),
        "old_rows_in_candidate_filings": n_old_rows,
        "filelist_filings": len(fl),
        "round_filelist_filings": len(union),
        "round_filelist_sources": per_src,
        "sha256_gold_regress_tsv": sha256_of(out_path),
        "sha256_regress_filelist_tsv": sha256_of(fl_path),
        "sha256_round_filelist_tsv": sha256_of(round_path),
    }
    side_path = os.path.join(g, "gold_regress.json")
    with open(side_path, "w") as fh:
        json.dump(side, fh, indent=2, sort_keys=True)
        fh.write("\n")
    print("[out] %s  sha256(gold_regress.tsv)=%s" % (side_path, side["sha256_gold_regress_tsv"]))


if __name__ == "__main__":
    main()
