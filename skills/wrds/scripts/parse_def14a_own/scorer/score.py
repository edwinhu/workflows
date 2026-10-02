#!/usr/bin/env python3
"""score.py — score parse_def14a_own output against the gold sets.

Stdlib only. Deterministic: no randomness, output sorted, the same inputs give
byte-identical output.

Metrics, each printed with its denominator:

  (i)   FILING YIELD           share of gold-linked filings with a parsed
                               ownership table. Reported twice: `any row`, and
                               `>=1 parsed percent`, which is the gated one —
                               a table with no percent cannot be scored against
                               a gold percent.
  (ii)  HOLDER RECALL / PRECISION vs blockw
                               match = normalised holder name AND percent within
                               0.5 pp. blockw's universe is 5% blockholders plus
                               director/officer holders, so BOTH sides are
                               restricted to >= 5.0% — scoring a parser row at
                               0.3% against a gold set that does not record it
                               would be measuring the gold set's scope.
  (iii) D&O-GROUP-% and LARGEST-BLOCK-% agreement vs FactSet, within 1.0 pp.
                               DIAGNOSTIC, never gated. Parser D&O group % = max
                               percent over rows flagged is_group_row; gold =
                               FactSet's sum of natural-person holder percents in
                               the proxy window. Parser largest block % = max
                               percent over non-group rows; gold = max single
                               holder percent.
  (iv)  GROUP-ROW DETECTION     share of scored filings with a flagged group row.
  (v)   ISS DIRECTOR YARDSTICK  The modern-era holder-level ruler: (a) director
                               recall, (b) share agreement within 1% and 5%,
                               (c) an individual-row precision PROXY.
                               (a) `iss_director_recall` is GATED when
                               thresholds.json lists it under `minimums` — it was
                               adopted as a gate on 2026-09-29. (b) and (c) are
                               DIAGNOSTIC and never gated. Denominators, era
                               splits and a miss decomposition are printed. See
                               the ISS block below for each definition and its
                               limits.
  (vi)  FULL-ARCHIVE SAMPLE   A fixed, year-stratified sample of the whole
                               archive (`gold/sample_full.tsv`, seed 20260929,
                               ~250 filings per filing year 1994-2026, every
                               gold-linked filing excluded). Three families of
                               number, all reported per year with denominators:
                               (a) DUPLICATE EXCESS. The GATED key since
                               2026-09-29 is the IDENTICAL ROW — (accession, cik,
                               table_kind, holder_name, share_class, shares,
                               percent) — counting excess copies. The looser key
                               (accession, cik, holder_name, share_class) and its
                               same-/cross-`table_kind` split are still computed
                               and printed, now DIAGNOSTIC: same-kind counted one
                               holder listed once per managed account, each row
                               carrying its own shares and percent, as duplicates,
                               and those rows are distinct facts;
                               (b) parsed-percent filing yield per
                               year, gated as a NO-REGRESSION floor against the
                               per-year values recorded in thresholds.json
                               `_sample_yield_floor_by_year`; (c) group-row rate
                               per year, reported.
  (vii) REGRESSION SET        The fixed diff of the two full-archive panels
                               (`gold/gold_regress.tsv`, built once by
                               `gold/build_regress_set.py` from
                               `panel_e4e78a95` = parser 4b36a962 against
                               `panel` = parser 092b6fb9). Two GATED recovery
                               rates, each over a fixed denominator:
                               `regress_zero_row_recovered` = share of the
                               ZERO-ROW set (old n_rows > 0, new n_rows == 0)
                               that parses to >= 1 row again;
                               `regress_group_row_recovered` = share of the
                               GROUP-ROW set (old has_group_row, new none, and
                               >= 1 lost group row carried a parsed percent)
                               with a percent-carrying group row again. The
                               share-only group-row population and the filings
                               whose old rows were demonstrably wrong (the FOUR
                               exclusion clauses recorded in the builder and in
                               gold_regress.json — X1 dollar-in-name, X2
                               one-value-all-rows, and since 2026-09-30 X3 fund
                               dollar-range tables and X4 per-fund compensation
                               tables) are reported as DIAGNOSTICS with their own
                               denominators, per clause, never gated.
                               Since 2026-10-01 a third GATED rate,
                               `regress_lost_recovered`: share of the LOST set
                               (c) (`panel` 092b6fb9 n_rows > 0,
                               `panel_a449b66c` n_rows == 0, minus X1-X4,
                               X10-X13 and X14-X20) that parses to >= 1 row.
                               Since 2026-10-01 a fourth, `regress_lost_d_recovered`:
                               share of the LOST set (d) (`panel_a449b66c`
                               n_rows > 0, `panel_7ac69e96` n_rows == 0, minus
                               X1-X4, X10-X13, X14 and X16-X20 — X15 recorded but
                               not applied — and X21-X23) that parses to >= 1 row.

GATED vs DIAGNOSTIC. The gated set is EXACTLY the keys under `minimums` (a floor,
val >= thr) plus the keys under `maximums` (a ceiling, val <= thr) in
thresholds.json — nothing in this file hard-codes it, and no metric outside those
two sets can change the exit code. Since the 2026-09-29 regression round that is
TWELVE metrics (sets (c) and (d) added 2026-10-01): filing yield (parsed percent), holder recall vs blockw, holder
precision vs blockw, group-row detection, ISS director recall, the sample's
worst-year yield margin, two ceilings on the sample's IDENTICAL-ROW duplicate
excess rate (pooled and worst year; the same-table pair they replaced on
2026-09-29 is now diagnostic), and the four regression-set recovery rates in (vii).
The two FactSet aggregate metrics in (iii)
are computed and printed with their denominators every run and NEVER affect the
exit code, because the FactSet gold is defined by a proxy window over all FactSet
stakes and mixes 13F / Form 4 positions (only 21 of 2,647 linked firm-years carry
a PXY marker); a 1 pp band over that gold would reward chasing gold noise. The
ISS share-agreement pair and the ISS precision proxy are diagnostic for the
reasons recorded in thresholds.json `_history`.

When `iss_director_recall` is gated, the ISS gold filings MUST be covered by the
parser output: scoring a recall on a partial denominator would silently reward a
round that simply parsed fewer ISS filings. Missing ISS manifest coverage, and
`--no-iss`, are both hard errors (exit 2) rather than a quietly smaller gold.

Splits: dev by default; `--holdout` scores the held-out firms and REFUSES while
GRIND_ITERATION is set in the environment, because a loop that can read the
holdout has no holdout.

`--check` exits 0 only if every gated metric clears its threshold in the locked
thresholds file, 1 otherwise. `--verify-lock` (on by default) recomputes the
sha256 of this script, the gold files and the thresholds against lock.sha256 and
exits 3 on any mismatch: a loop that may edit the scorer can pass any threshold.

Exit codes: 0 pass (with --check) or scored, 1 a gated metric is short,
3 the lock does not verify, 4 --holdout refused inside a grind iteration.
"""

import argparse
import csv
import glob
import gzip
import hashlib
import json
import os
import re
import sys
from collections import defaultdict

# Some filings emit a holder_name longer than csv's 128 KiB default field limit —
# an entire paragraph swallowed into the name column by a mis-roled table. Reading
# them must not abort the scorer: the row is scored (and counted against precision)
# like any other. Found 2026-09-29 reading the full-archive panel, where the
# default limit raised `_csv.Error: field larger than field limit (131072)`.
csv.field_size_limit(1 << 24)

PCT_TOL_HOLDER = 0.5     # (ii) percentage points
PCT_TOL_AGG = 1.0        # (iii) percentage points
BLOCK_FLOOR = 5.0        # blockw's covered universe, in percent of class
GOLD_PCT_CEILING = 100.0  # a gold percent above this is a denominator defect, not a holding

SUFFIXES = {
    "JR", "SR", "II", "III", "IV", "V", "MD", "PHD", "ESQ", "CPA",
    "INC", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "LP", "LLP", "LLC",
    "PLC", "NA", "TRUST", "THE", "AND", "ET", "AL", "GROUP", "HOLDINGS", "HOLDING",
}
TOKEN = re.compile(r"[A-Z0-9]+")


def name_key(s):
    """Fold a holder name to a comparable token set.

    blockw writes "WALTON; JIM C." and the proxy writes "Jim C. Walton", so the
    key must be order-free. Single letters are kept as initials but never carry a
    match on their own.
    """
    s = (s or "").upper()
    s = s.replace("&", " AND ")
    toks = [t for t in TOKEN.findall(s) if t not in SUFFIXES]
    return frozenset(t for t in toks if len(t) >= 2), frozenset(t for t in toks if len(t) == 1)


def names_match(a, b):
    """True when two holder names denote the same holder.

    Requires a shared long token; two shared long tokens, or one plus a shared
    initial, or the gold name having only one long token to share.
    """
    a_long, a_init = a
    b_long, b_init = b
    if not a_long or not b_long:
        return False
    shared = a_long & b_long
    if not shared:
        return False
    if len(shared) >= 2:
        return True
    if a_init & b_init:
        return True
    # One long token each (e.g. "FMR" vs "FMR"), or a one-token gold name that is
    # fully contained in the parsed name.
    return len(a_long) == 1 or len(b_long) == 1


# ---- (v) the ISS director yardstick -----------------------------------------
# Matching is SURNAME + FIRST INITIAL, which is what ISS and a proxy table
# reliably agree on. ISS writes "S WALTON" for S. Robson Walton and "H SCOTT JR."
# for H. Lee Scott, Jr.; the proxy writes both out. Middle names, suffixes and
# nicknames therefore must not participate in the key.
ISS_SHARE_TOL = 0.01     # (b) relative, the headline band
ISS_SHARE_TOL_WIDE = 0.05
ISS_TRUNCATION_RATIO = 0.5  # a D&O table with < half of ISS's directors is short

NAME_SUFFIX = {"JR", "SR", "II", "III", "IV", "V", "VI", "MD", "PHD", "ESQ", "CPA",
               "DDS", "DVM", "RN", "JD", "MBA", "DR", "MR", "MRS", "MS", "MISS",
               "RET", "USN", "USA", "USAF"}
# Nicknames whose first INITIAL differs from the formal given name. Anything whose
# initial already agrees (Bill/William is B/W, Tony/Anthony is T/A) needs an entry;
# anything that shortens without changing the initial (Tom/Thomas) does not.
NICKNAME = {
    "BOB": "R", "BOBBY": "R", "RICK": "R", "DICK": "R", "RICKY": "R",
    "BILL": "W", "BILLY": "W", "WILL": "W", "WILLIE": "W",
    "JACK": "J", "JIM": "J", "JIMMY": "J", "JACKIE": "J",
    "TONY": "A", "NED": "E", "TED": "E", "TEDDY": "E",
    "PEGGY": "M", "POLLY": "M", "MOLLY": "M", "PEG": "M",
    "HANK": "H", "HAL": "H", "CHUCK": "C", "SKIP": "S", "SANDY": "A",
    "BETTY": "E", "BETSY": "E", "LIZ": "E", "BETH": "E", "BESS": "E",
    "NANCY": "A", "KATE": "K", "KATIE": "K", "GREG": "G",
}
# Words that make a holder an ENTITY rather than a natural person. Used only by the
# (c) precision proxy, to decide whether an unmatched row even LOOKS like a person.
ENTITY_WORD = {
    "INC", "CORP", "CORPORATION", "CO", "COMPANY", "COMPANIES", "LTD", "LIMITED",
    "LP", "LLP", "LLC", "PLC", "NV", "SA", "AG", "AB", "GMBH", "TRUST", "TRUSTS",
    "TRUSTEE", "TRUSTEES", "FOUNDATION", "ESTATE", "FUND", "FUNDS", "PARTNERS",
    "PARTNERSHIP", "ASSOCIATES", "ASSOCIATION", "CAPITAL", "MANAGEMENT",
    "MANAGEMENT'S", "ADVISORS", "ADVISERS", "ADVISORY", "GROUP", "HOLDINGS",
    "HOLDING", "BANK", "BANCORP", "BANCSHARES", "INSURANCE", "ASSURANCE",
    "ENTERPRISES", "INVESTMENTS", "INVESTMENT", "SECURITIES", "SERVICES",
    "FINANCIAL", "GLOBAL", "INTERNATIONAL", "AMERICA", "AMERICAN", "NATIONAL",
    "NA", "SYSTEMS", "PLAN", "ESOP", "KSOP", "401", "401K", "SAVINGS", "PENSION",
    "RETIREMENT", "PROFIT", "SHARING", "FAMILY", "CHARITABLE", "ASSET", "ASSETS",
    "RESEARCH", "EQUITY", "VENTURES", "GP", "SUBSIDIARIES", "AFFILIATES",
    "DIRECTORS", "OFFICERS", "EXECUTIVE", "EXECUTIVES", "ALL", "NOMINEES",
}


def person_key(s):
    """(surname, first-initial) for a natural-person name, or None.

    Order-insensitive to the vendor's convention: ISS writes "LAST, FIRST" never,
    always "FIRST MIDDLE LAST"; blockw writes "WALTON; JIM C." with a semicolon.
    A semicolon or comma before the first space therefore means surname-first.
    """
    raw = (s or "").upper().replace("&", " AND ")
    # "WALTON; JIM C." / "WALTON, JIM C." is surname-first; "H. LEE SCOTT, JR." is
    # not — what follows the separator there is a suffix, which is dropped anyway.
    for sep in (";", ","):
        i = raw.find(sep)
        if i <= 0:
            continue
        head, tail = raw[:i].strip(), raw[i + 1:].strip()
        tail_toks = [t for t in TOKEN.findall(tail) if t not in NAME_SUFFIX]
        if tail_toks and len(TOKEN.findall(head)) <= 3:
            raw = tail + " " + head
        break
    toks = [t for t in TOKEN.findall(raw) if t not in NAME_SUFFIX and not t.isdigit()]
    if len(toks) < 2:
        return None
    surname, given = toks[-1], toks[0]
    if len(surname) < 2:
        return None
    init = NICKNAME.get(given, given[0])
    return (surname, init)


def looks_like_person(s):
    """True when a holder name plausibly denotes a natural person.

    2-5 name tokens, no entity word, no digits. Deliberately permissive: it is the
    numerator of an UPPER BOUND on individual-row precision, not a classifier.
    """
    raw = (s or "").upper().replace("&", " AND ")
    if " AND " in raw:
        return False
    toks = [t for t in TOKEN.findall(raw) if t not in NAME_SUFFIX]
    if not (2 <= len(toks) <= 5):
        return False
    if any(t in ENTITY_WORD or t.isdigit() for t in toks):
        return False
    return sum(1 for t in toks if len(t) >= 2) >= 2


def era_of(year):
    y = int(year)
    if y <= 2006:
        return "2002-2006"
    if y <= 2012:
        return "2007-2012"
    if y <= 2018:
        return "2013-2018"
    return "2019-2024"


ISS_ERAS = ["2002-2006", "2007-2012", "2013-2018", "2019-2024"]


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# EVERY TSV this scorer reads — the parser's rows and manifest, and all six gold
# files — is written with a bare `"\t".join(...)` (Go: strings.Join; Python: the
# gold builders), so NOTHING in this project is quoted. csv's default QUOTE_MINIMAL
# reader therefore mis-reads any field that BEGINS with a double quote: a holder
# name like "Independent" Directors1 swallows the following tabs and newlines and
# two rows become one. Measured 2026-09-29 on the full-archive panel: 114,686 rows
# read against 115,061 rows actually present in the sample filings — 375 rows lost
# and their neighbours corrupted. QUOTE_NONE is the only correct reader here.
TSV = {"delimiter": "\t", "quoting": csv.QUOTE_NONE}


def read_tsv_gz(pattern):
    """Rows from every file matching `pattern`, as dicts. Header per file."""
    n_files = 0
    for path in sorted(glob.glob(pattern)):
        n_files += 1
        with gzip.open(path, "rt") as fh:
            for r in csv.DictReader(fh, **TSV):
                yield r
    if n_files == 0:
        sys.exit("ERROR: no files matched %s" % pattern)


def fnum(s):
    if s is None or s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


class DupExcess:
    """Excess-copy counters for the (vi) sample duplicate metrics.

    ONE streaming accumulator, so the definition scorer/score_test.py exercises is
    the definition main() scores. Rows are added with the filing key (cik,
    accession); every counter is excess COPIES, i.e. (n - 1) summed over groups.

      excess_identical  (holder, cls, table_kind, shares, percent)   [GATED]
      excess_same_table (holder, cls, table_kind, table_index)       diagnostic
      excess_same_kind  (holder, cls, table_kind)                    diagnostic
      excess_total      (holder, cls)                                diagnostic
      excess_cross_kind (distinct table_kinds - 1) per (holder, cls) diagnostic

    `excess_identical` is the gated definition as of 2026-09-29. The earlier gated
    measure was `excess_same_kind`, which counts a holder listed MANY TIMES in one
    table with DIFFERENT shares and percent as duplicates — AllianceBernstein's
    2018 proxy lists one holder once per managed account, 264 of that year's 304
    excess rows. Those rows are distinct facts and gating them paid the loop to
    delete disclosure. `shares` and `percent` are compared as the parser emitted
    them: a row emitted twice by one parse emits byte-identical numbers.
    """

    NAMES = ("excess_total", "excess_same_kind", "excess_cross_kind",
             "excess_same_table", "excess_identical")

    def __init__(self):
        self.whole = defaultdict(int)
        self.kind = defaultdict(int)
        self.table = defaultdict(int)
        self.ident = defaultdict(int)

    def add(self, fkey, r):
        h, c, k = r["holder_name"], r["share_class"], r["table_kind"]
        self.whole[(fkey, h, c)] += 1
        self.kind[(fkey, h, c, k)] += 1
        self.table[(fkey, h, c, k, r["table_index"])] += 1
        self.ident[(fkey, h, c, k, r["shares"], r["percent"])] += 1

    def excess(self):
        """-> {filing key: {counter name: excess copies}}; filings with none omitted."""
        out = {}

        def box(fkey):
            b = out.get(fkey)
            if b is None:
                b = out[fkey] = {n: 0 for n in self.NAMES}
            return b

        for kt, n in self.whole.items():
            if n > 1:
                box(kt[0])["excess_total"] += n - 1
        n_kinds = defaultdict(int)
        for kt, n in self.kind.items():
            n_kinds[kt[:3]] += 1
            if n > 1:
                box(kt[0])["excess_same_kind"] += n - 1
        for kt, nk in n_kinds.items():
            if nk > 1:
                box(kt[0])["excess_cross_kind"] += nk - 1
        for kt, n in self.table.items():
            if n > 1:
                box(kt[0])["excess_same_table"] += n - 1
        for kt, n in self.ident.items():
            if n > 1:
                box(kt[0])["excess_identical"] += n - 1
        return out


class RegressCounters:
    """(vii) recovery counters for the fixed regression set.

    ONE streaming accumulator, so the definition scorer/score_test.py exercises is
    the definition main() scores. Rows are added with the filing key (cik,
    accession); only three facts per filing matter.

      rows[key]        parsed rows now, any kind
      group_any        >= 1 row flagged is_group_row
      group_pct        >= 1 row flagged is_group_row AND carrying a parsed percent

    `recovered_zero_row` is >= 1 row of any kind: the zero-row set lost EVERY row,
    including share-count-only tables the document states no percent for (GE 2013
    is the type case), so requiring a percent here would demand what the filing
    does not contain. `recovered_group_row` requires the PERCENT, because the gated
    group-row set is by construction the filings whose lost group row carried one.
    """

    def __init__(self):
        self.rows = defaultdict(int)
        self.group_any = set()
        self.group_pct = set()

    def add(self, fkey, r):
        self.rows[fkey] += 1
        if r["is_group_row"] == "1":
            self.group_any.add(fkey)
            if r["percent"] != "":
                self.group_pct.add(fkey)

    def recovered_zero_row(self, keys):
        return {k for k in keys if self.rows.get(k, 0) > 0}

    def recovered_group_row(self, keys):
        return {k for k in keys if k in self.group_pct}

    def recovered_group_row_any(self, keys):
        return {k for k in keys if k in self.group_any}


def verify_lock(lock_path, files):
    """Every path in the lock must hash to its recorded value."""
    with open(lock_path) as fh:
        want = {}
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            h, name = line.split(None, 1)
            want[name.strip()] = h
    bad = []
    for name, path in sorted(files.items()):
        if name not in want:
            bad.append("%s: not in lock" % name)
            continue
        got = sha256_of(path)
        if got != want[name]:
            bad.append("%s: lock=%s actual=%s" % (name, want[name][:16], got[:16]))
    missing = sorted(set(want) - set(files))
    for name in missing:
        bad.append("%s: in lock but not presented" % name)
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", required=True, help="glob for parser row files (*.tsv.gz)")
    ap.add_argument("--manifest", required=True, help="glob for parser manifest files (*.manifest.tsv.gz)")
    ap.add_argument("--gold-dir", default=os.environ.get("GOLD_DIR", "/data/def14a_own/gold"))
    ap.add_argument("--thresholds", default=os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                                        "..", "thresholds.json"))
    ap.add_argument("--lock", default=os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                                  "..", "lock.sha256"))
    ap.add_argument("--holdout", action="store_true", help="score the HOLDOUT firms instead of dev")
    ap.add_argument("--iss-holdout", action="store_true",
                    help="score the ISS HOLDOUT firms for the (v) block instead of ISS dev")
    ap.add_argument("--no-iss", action="store_true", help="skip the (v) ISS block entirely")
    ap.add_argument("--iss-miss-report", default="",
                    help="write the per-(filing,director) ISS recall decomposition here")
    ap.add_argument("--sample-filelist", default="",
                    help="the fixed full-archive sample filelist "
                         "(default <gold-dir>/sample_full.tsv); '' after --gold-dir resolution")
    ap.add_argument("--no-sample", action="store_true", help="skip the (vi) full-archive sample block")
    ap.add_argument("--sample-report", default="",
                    help="write the per-year sample table here as TSV")
    ap.add_argument("--record-sample-floors", default="",
                    help="write the measured per-year sample yields MINUS the slack as a "
                         "thresholds.json `_sample_yield_floor_by_year` fragment. Run ONCE, "
                         "by a human, to set the no-regression floors; never from a loop.")
    ap.add_argument("--sample-floor-slack", type=float, default=0.005,
                    help="the per-year no-regression slack subtracted by --record-sample-floors")
    ap.add_argument("--no-regress", action="store_true",
                    help="skip the (vii) regression-set block")
    ap.add_argument("--regress-report", default="",
                    help="write the per-filing regression-set recovery detail here as TSV")
    ap.add_argument("--check", action="store_true", help="exit 0 iff every gated metric clears its threshold")
    ap.add_argument("--no-verify-lock", action="store_true", help="skip the hash lock (for lock creation only)")
    ap.add_argument("--miss-report", default="", help="write the per-filing miss decomposition here")
    ap.add_argument("--json-out", default="", help="write the metrics as JSON here")
    args = ap.parse_args()

    g = args.gold_dir
    if args.holdout and os.environ.get("GRIND_ITERATION"):
        print("REFUSED: --holdout inside a grind iteration (GRIND_ITERATION=%s). "
              "A loop that can read the holdout has no holdout."
              % os.environ["GRIND_ITERATION"], file=sys.stderr)
        sys.exit(4)
    if args.iss_holdout and os.environ.get("GRIND_ITERATION"):
        print("REFUSED: --iss-holdout inside a grind iteration (GRIND_ITERATION=%s). "
              "A loop that can read the holdout has no holdout."
              % os.environ["GRIND_ITERATION"], file=sys.stderr)
        sys.exit(4)

    thresholds = json.load(open(args.thresholds))
    # The gated set is the keys under `minimums`, and nothing else. ISS recall is
    # gated iff thresholds.json says so, so this file never has to be edited to
    # move it in or out of the gate.
    gate_floor = dict(thresholds["minimums"])
    gate_ceiling = dict(thresholds.get("maximums", {}))
    sample_gated = any(n.startswith("sample_") for n in list(gate_floor) + list(gate_ceiling))
    if sample_gated and args.no_sample:
        print("ERROR: --no-sample but thresholds.json gates a sample_* metric. "
              "A gated metric cannot be switched off from the command line.",
              file=sys.stderr)
        sys.exit(2)
    regress_gated = any(n.startswith("regress_") for n in list(gate_floor) + list(gate_ceiling))
    if regress_gated and args.no_regress:
        print("ERROR: --no-regress but thresholds.json gates a regress_* metric. "
              "A gated metric cannot be switched off from the command line.",
              file=sys.stderr)
        sys.exit(2)
    iss_gated = "iss_director_recall" in gate_floor
    if iss_gated and args.no_iss:
        print("ERROR: --no-iss but thresholds.json gates iss_director_recall. "
              "A gated metric cannot be switched off from the command line.",
              file=sys.stderr)
        sys.exit(2)

    if not args.no_verify_lock:
        files = {
            "scorer/score.py": os.path.abspath(__file__),
            "thresholds.json": os.path.abspath(args.thresholds),
            "gold/gold_blockw.tsv.gz": os.path.join(g, "gold_blockw.tsv.gz"),
            "gold/gold_factset.tsv.gz": os.path.join(g, "gold_factset.tsv.gz"),
            "gold/gold_factset_firmyear.tsv.gz": os.path.join(g, "gold_factset_firmyear.tsv.gz"),
            "gold/holdout.tsv": os.path.join(g, "holdout.tsv"),
        }
        if not args.no_iss:
            files["gold/gold_iss.tsv.gz"] = os.path.join(g, "gold_iss.tsv.gz")
            files["gold/holdout_iss.tsv"] = os.path.join(g, "holdout_iss.tsv")
        if not args.no_sample:
            files["gold/sample_full.tsv"] = args.sample_filelist or os.path.join(g, "sample_full.tsv")
        if not args.no_regress:
            files["gold/gold_regress.tsv"] = os.path.join(g, "gold_regress.tsv")
        bad = verify_lock(args.lock, files)
        if bad:
            print("LOCK MISMATCH:", file=sys.stderr)
            for b in bad:
                print("  " + b, file=sys.stderr)
            sys.exit(3)
        print("[lock] %s verified over %d files" % (args.lock, len(files)))

    want_split = "holdout" if args.holdout else "dev"
    split = {}
    with open(os.path.join(g, "holdout.tsv")) as fh:
        for r in csv.DictReader(fh, **TSV):
            split[r["cik"].lstrip("0") or "0"] = r["split"]
    print("[in ] holdout.tsv: %d firms (%d %s)" % (
        len(split), sum(1 for v in split.values() if v == want_split), want_split))

    def in_split(cik):
        return split.get(str(cik).lstrip("0") or "0") == want_split

    # ---- gold ---------------------------------------------------------------
    # blockw holder rows, keyed by (cik_int, accession)
    gold_block = defaultdict(list)
    gold_block_filings = set()
    n_block_rows = n_block_noblock = 0
    for r in read_tsv_gz(os.path.join(g, "gold_blockw.tsv.gz")):
        cik = r["cik"].lstrip("0") or "0"
        if not in_split(cik):
            continue
        key = (cik, r["accession"])
        gold_block_filings.add(key)
        if r["no_blockholder"] == "1":
            n_block_noblock += 1
            continue
        pct = fnum(r["holder_pct"])
        if pct is None or pct > GOLD_PCT_CEILING:
            continue
        gold_block[key].append({"name": r["holder_name"], "key": name_key(r["holder_name"]),
                                "pct": pct})
        n_block_rows += 1
    print("[in ] gold blockw (%s): %d filings, %d holder rows, %d no-blockholder rows" % (
        want_split, len(gold_block_filings), n_block_rows, n_block_noblock))

    gold_fs = {}
    for r in read_tsv_gz(os.path.join(g, "gold_factset_firmyear.tsv.gz")):
        cik = r["cik"].lstrip("0") or "0"
        if not in_split(cik):
            continue
        lb, ins = fnum(r["largest_block_pct"]), fnum(r["insider_sum_pct"])
        gold_fs[(cik, r["accession"])] = {
            "largest": lb if (lb is not None and lb <= GOLD_PCT_CEILING) else None,
            "insider_sum": ins if (ins is not None and ins <= GOLD_PCT_CEILING) else None,
            "n_pxy": int(r["n_pxy_rows"] or 0),
        }
    print("[in ] gold factset (%s): %d filings" % (want_split, len(gold_fs)))

    gold_filings = gold_block_filings | set(gold_fs)
    if not gold_filings:
        sys.exit("ERROR: no gold filings in split %s" % want_split)

    # ---- (v) ISS gold -------------------------------------------------------
    # Loaded BEFORE the parser output so the row reader can keep ISS filings too.
    # The ISS split is independent of the blockw/factset split and has its own
    # holdout file: the sampled ISS firms are not the blockw/factset firms.
    iss_want = "holdout" if args.iss_holdout else "dev"
    iss_split, iss_dir, iss_filings = {}, defaultdict(list), set()
    n_iss_rows = n_iss_flagged = 0
    if not args.no_iss:
        with open(os.path.join(g, "holdout_iss.tsv")) as fh:
            for r in csv.DictReader(fh, **TSV):
                iss_split[r["cik"].lstrip("0") or "0"] = r["split"]
        for r in read_tsv_gz(os.path.join(g, "gold_iss.tsv.gz")):
            cik = r["cik"].lstrip("0") or "0"
            if iss_split.get(cik) != iss_want:
                continue
            key = (cik, r["accession"])
            iss_filings.add(key)
            n_iss_rows += 1
            if r["any_flag"] == "1":
                n_iss_flagged += 1
                continue
            pk = person_key(r["director_name"])
            iss_dir[key].append({
                "name": r["director_name"], "pk": pk,
                "shares": fnum(r["num_of_shares"]), "pct": fnum(r["pcnt_ctrl_votingpower"]),
                "year": int(r["gold_year"]), "era": era_of(r["gold_year"]),
                "table": r["iss_table"],
            })
        print("[in ] gold iss (%s): %d firms (%d %s), %d filings, %d director rows "
              "(%d flagged and EXCLUDED, %d usable)" % (
                  iss_want, len(iss_split),
                  sum(1 for v in iss_split.values() if v == iss_want), iss_want,
                  len(iss_filings), n_iss_rows, n_iss_flagged, n_iss_rows - n_iss_flagged))

    # ---- (vi) the fixed full-archive sample ---------------------------------
    # Keyed on (cik, accession) like everything else; the YEAR is the sample
    # filelist's own filing date, never the parser's `proxy_year`, so a parser
    # change cannot move a filing between year buckets and move the metric with it.
    sample_year = {}
    if not args.no_sample:
        spath = args.sample_filelist or os.path.join(g, "sample_full.tsv")
        with open(spath) as fh:
            for line in fh:
                f = line.rstrip("\n").split("\t")
                if len(f) < 5:
                    continue
                sample_year[(f[1].lstrip("0") or "0", f[2])] = int(f[4][:4])
        print("[in ] sample %s: %d filings, %d filing years" % (
            spath, len(sample_year), len(set(sample_year.values()))))

    # ---- (vii) the fixed regression set -------------------------------------
    # Membership is READ, never derived: `gold/gold_regress.tsv` was built once from
    # the two panels by gold/build_regress_set.py, is covered by lock.sha256, and
    # carries the flags that say which set each filing is in and which exclusion
    # clause fired. Re-deriving it here from a panel would let a round that
    # re-parsed the archive move its own denominator.
    # Clause names are explicit: X1-X4 affect both sets, X7-X9 only (b), X10-X13 only (a). X3/X4 (2026-09-30) are the fund dollar-range and
    # per-fund compensation families; they get their OWN diagnostic denominator
    # below, because the whole point of the correction is that re-accepting them
    # stays visible after they leave the gated set.
    EXCL_COLS = ["excl_x1_dollar_in_name", "excl_x2_one_value_all_rows",
                 "excl_x3_dollar_range_table", "excl_x4_m3_repeated_per_fund",
                 "excl_x10_repeated_fund_compensation", "excl_x11_audit_billing_entities",
                 "excl_x12_partnership_accounting", "excl_x13_purchase_narrative_year"]
    GROUP_EXCL_COLS = ["excl_x7_group_grant_zero", "excl_x8_group_share_class_name",
                       "excl_x9_group_position_name_prose"]
    EXCL_COLS += GROUP_EXCL_COLS
    reg_excl_group = set()
    reg_excl_group_by_clause = defaultdict(set)
    reg_a, reg_bg, reg_bd, reg_excl, reg_excl_zero = set(), set(), set(), set(), set()
    reg_excl_zero_by_clause = defaultdict(set)
    reg_meta = {}
    present = []
    # Set (c), 2026-10-01: the LOST set (old panel rows > 0, panel_a449b66c 0 rows).
    # Read from the same gold file; absent columns mean a pre-(c) gold and an empty set.
    LOST_EXCL_COLS = ["lost_excl_x1_x4", "lost_excl_x10_x13",
                      "excl_x14_year_as_shares", "excl_x15_percent_only_prose",
                      "excl_x16_small_int_shares", "excl_x17_no_value_rows",
                      "excl_x18_prose_lead_name", "excl_x19_function_word_tail",
                      "excl_x20_compensation_title_rows"]
    reg_c, reg_c_excl = set(), set()
    reg_c_excl_by_clause = defaultdict(set)
    lost_present = False
    # Set (d), 2026-10-01: panel_a449b66c rows > 0, panel_7ac69e96 0 rows. X15 is
    # recorded in lost_d_x15_not_applied but excludes nothing, so it is not listed.
    LOST_D_EXCL_COLS = ["lost_d_excl_x1_x4", "lost_d_excl_x10_x13",
                        "lost_d_excl_x14_x20_less_x15", "excl_x21_term_of_office_name",
                        "excl_x22_holding_verb_name", "excl_x23_none_cell_name"]
    reg_d, reg_d_excl = set(), set()
    reg_d_excl_by_clause = defaultdict(set)
    lost_d_present = False
    if not args.no_regress:
        rpath = os.path.join(g, "gold_regress.tsv")
        with open(rpath) as fh:
            rdr = csv.DictReader(fh, **TSV)
            present = [c for c in EXCL_COLS if c in (rdr.fieldnames or [])]
            if not present:
                sys.exit("ERROR: %s carries none of the exclusion columns %s — rebuild it "
                         "with gold/build_regress_set.py" % (rpath, EXCL_COLS))
            lost_present = "cand_lost" in (rdr.fieldnames or [])
            lost_d_present = "cand_lost_d" in (rdr.fieldnames or [])
            for r in rdr:
                key = (r["cik"].lstrip("0") or "0", r["accession"])
                reg_meta[key] = r
                if lost_present and r["cand_lost"] == "1":
                    if r["in_set_lost"] == "1":
                        reg_c.add(key)
                    else:
                        reg_c_excl.add(key)
                        for c in LOST_EXCL_COLS:
                            if r[c] == "1":
                                reg_c_excl_by_clause[c].add(key)
                if lost_d_present and r["cand_lost_d"] == "1":
                    if r["in_set_lost_d"] == "1":
                        reg_d.add(key)
                    else:
                        reg_d_excl.add(key)
                        for c in LOST_D_EXCL_COLS:
                            if r[c] == "1":
                                reg_d_excl_by_clause[c].add(key)
                if r["in_set_zero_row"] == "1":
                    reg_a.add(key)
                if r["in_set_group_row_gated"] == "1":
                    reg_bg.add(key)
                if r["in_set_group_row_diag"] == "1":
                    reg_bd.add(key)
                fired = [c for c in present if r[c] == "1"]
                if fired:
                    reg_excl.add(key)
                    # The diagnostic denominator is the excluded ZERO-ROW candidates
                    # only. An excluded filing that merely lost its group row still
                    # emits rows, so counting it would make the diagnostic read ~1.0
                    # whatever the parser does.
                    zero_fired = [c for c in fired if c not in GROUP_EXCL_COLS]
                    if r["cand_zero_row"] == "1" and zero_fired:
                        reg_excl_zero.add(key)
                        for c in zero_fired:
                            reg_excl_zero_by_clause[c].add(key)
                    group_fired = [c for c in fired if c in GROUP_EXCL_COLS]
                    if r["cand_group_row"] == "1" and group_fired:
                        reg_excl_group.add(key)
                        for c in group_fired:
                            reg_excl_group_by_clause[c].add(key)
        print("[in ] regress %s: %d candidate filings — set(a) zero-row %d, "
              "set(b) group-row GATED %d, set(b) share-only DIAGNOSTIC %d, excluded %d "
              "(of which zero-row candidates %d)" % (
                  rpath, len(reg_meta), len(reg_a), len(reg_bg), len(reg_bd),
                  len(reg_excl), len(reg_excl_zero)))
        print("[in ] regress exclusion clauses in force: %s" % ", ".join(
            "%s=%d" % (c.replace("excl_", ""), len(reg_excl_zero_by_clause[c]))
            for c in present if c not in GROUP_EXCL_COLS))
        print("[in ] regress set-(b)-only exclusion clauses: %s" % ", ".join(
            "%s=%d" % (c.replace("excl_", ""), len(reg_excl_group_by_clause[c]))
            for c in GROUP_EXCL_COLS))
        if lost_present:
            print("[in ] regress set(c) LOST: %d candidates, gated %d, excluded %d (%s)" % (
                len(reg_c) + len(reg_c_excl), len(reg_c), len(reg_c_excl), ", ".join(
                    "%s=%d" % (c, len(reg_c_excl_by_clause[c])) for c in LOST_EXCL_COLS)))
        if lost_d_present:
            print("[in ] regress set(d) LOST_D: %d candidates, gated %d, excluded %d (%s)" % (
                len(reg_d) + len(reg_d_excl), len(reg_d), len(reg_d_excl), ", ".join(
                    "%s=%d" % (c, len(reg_d_excl_by_clause[c])) for c in LOST_D_EXCL_COLS)))

    # ---- parser output ------------------------------------------------------
    man = {}
    iss_man = set()
    sample_man = set()
    reg_man = set()
    for r in read_tsv_gz(args.manifest):
        cik = r["cik"].lstrip("0") or "0"
        key = (cik, r["accession"])
        if key in gold_filings:
            man[key] = r
        if key in iss_filings:
            iss_man.add(key)
        if key in sample_year:
            sample_man.add(key)
        if key in reg_meta:
            reg_man.add(key)
    print("[in ] parser manifest rows matching gold filings: %d" % len(man))

    # ISS coverage, checked BEFORE anything is scored. A recall computed over the
    # ISS filings that happen to be in the output is a recall over a denominator
    # the parser chose, which is exactly the number a gate must not be allowed to
    # read. With the gate on, partial coverage is fatal; with it off, it is a
    # printed warning, because the metric is only diagnostic then.
    if not args.no_iss:
        n_iss_covered = len(iss_man)
        n_iss_filings = len(iss_filings)
        print("[in ] parser manifest rows matching ISS %s filings: %d / %d (%.2f%%)" % (
            iss_want, n_iss_covered, n_iss_filings,
            100 * n_iss_covered / n_iss_filings if n_iss_filings else 0.0))
        if n_iss_covered < n_iss_filings:
            missing = sorted(iss_filings - iss_man)
            msg = ("ISS COVERAGE SHORT: %d of %d ISS %s gold filings have no manifest row. "
                   "Re-run the grid pass over the union filelist "
                   "(DEF14A_FILELIST=gold_filelist_all.tsv bash run_baseline.sh). "
                   "First 5 missing (cik, accession): %s" % (
                       n_iss_filings - n_iss_covered, n_iss_filings, iss_want,
                       ", ".join("%s/%s" % k for k in missing[:5])))
            if iss_gated:
                print("ERROR: " + msg, file=sys.stderr)
                sys.exit(2)
            print("WARNING: " + msg, file=sys.stderr)

    if not args.no_sample:
        n_s_cov, n_s = len(sample_man), len(sample_year)
        print("[in ] parser manifest rows matching SAMPLE filings: %d / %d (%.2f%%)" % (
            n_s_cov, n_s, 100 * n_s_cov / n_s if n_s else 0.0))
        if n_s_cov < n_s:
            missing = sorted(set(sample_year) - sample_man)
            msg = ("SAMPLE COVERAGE SHORT: %d of %d sample filings have no manifest row. "
                   "Re-run the grid pass over the round filelist "
                   "(DEF14A_FILELIST=round_filelist.tsv bash run_baseline.sh). "
                   "First 5 missing (cik, accession): %s" % (
                       n_s - n_s_cov, n_s, ", ".join("%s/%s" % k for k in missing[:5])))
            if sample_gated:
                print("ERROR: " + msg, file=sys.stderr)
                sys.exit(2)
            print("WARNING: " + msg, file=sys.stderr)

    if not args.no_regress and reg_meta:
        n_r_cov, n_r = len(reg_man), len(reg_meta)
        print("[in ] parser manifest rows matching REGRESSION filings: %d / %d (%.2f%%)" % (
            n_r_cov, n_r, 100 * n_r_cov / n_r if n_r else 0.0))
        if n_r_cov < n_r:
            missing = sorted(set(reg_meta) - reg_man)
            msg = ("REGRESSION COVERAGE SHORT: %d of %d regression-set filings have no "
                   "manifest row. Re-run the grid pass over the round filelist "
                   "(DEF14A_FILELIST=round_filelist.tsv bash run_baseline.sh). "
                   "First 5 missing (cik, accession): %s" % (
                       n_r - n_r_cov, n_r, ", ".join("%s/%s" % k for k in missing[:5])))
            if regress_gated:
                print("ERROR: " + msg, file=sys.stderr)
                sys.exit(2)
            print("WARNING: " + msg, file=sys.stderr)

    # Per-year sample accumulators. Every duplicate counter comes from DupExcess
    # (see its docstring): the decomposition
    #   excess_total = excess_same_table_kind + excess_cross_table_kind
    # still holds by construction, and `excess_identical` is the GATED one.
    def sample_box():
        return dict({"filings": 0, "rows": 0, "with_pct": 0, "with_group": 0},
                    **{n: 0 for n in DupExcess.NAMES})
    dup = DupExcess()
    sample_has_pct = set()
    sample_has_group = set()
    sample_n_rows = defaultdict(int)

    # (vii) accumulator: three facts per regression-set filing, all that the two
    # recovery rates and their diagnostics need. See RegressCounters.
    reg = RegressCounters()

    parsed = defaultdict(list)
    n_rows_read = n_iss_parsed_rows = 0
    for r in read_tsv_gz(args.rows):
        cik = r["cik"].lstrip("0") or "0"
        key = (cik, r["accession"])
        if key in reg_meta:
            reg.add(key, r)
        if key in sample_year:
            sample_n_rows[key] += 1
            dup.add(key, r)
            if r["percent"] != "":
                sample_has_pct.add(key)
            if r["is_group_row"] == "1":
                sample_has_group.add(key)
        in_gold, in_iss = key in gold_filings, key in iss_filings
        if not (in_gold or in_iss):
            continue
        n_rows_read += 1 if in_gold else 0
        n_iss_parsed_rows += 1 if in_iss else 0
        parsed[key].append({
            "name": r["holder_name"], "key": name_key(r["holder_name"]),
            "pct": fnum(r["percent"]), "marker": r["percent_marker"],
            "group": r["is_group_row"] == "1", "inst": r["is_institution"] == "1",
            "cls": r["share_class"], "kind": r["table_kind"],
            # (v) only
            "shares": fnum(r["shares"]), "tix": r["table_index"],
            "pk": person_key(r["holder_name"]),
        })
    print("[in ] parser ownership rows in gold filings: %d" % n_rows_read)
    if not args.no_iss:
        print("[in ] parser ownership rows in ISS %s filings: %d" % (iss_want, n_iss_parsed_rows))

    # ---- (i) filing yield ---------------------------------------------------
    scored = sorted(gold_filings)
    n_gold = len(scored)
    n_present = sum(1 for k in scored if k in man)
    has_any = {k for k in scored if parsed.get(k)}
    has_pct = {k for k in scored if any(p["pct"] is not None for p in parsed.get(k, []))}
    yield_any = len(has_any) / n_gold
    yield_pct = len(has_pct) / n_gold
    print("\n== (i) FILING YIELD (denominator = %d gold-linked %s filings) ==" % (n_gold, want_split))
    print("  filings present in the parser manifest : %d (%.2f%%)" % (n_present, 100 * n_present / n_gold))
    print("  >=1 ownership row                      : %d (%.2f%%)" % (len(has_any), 100 * yield_any))
    print("  >=1 PARSED PERCENT  [gated]            : %d (%.2f%%)" % (len(has_pct), 100 * yield_pct))

    # ---- (ii) holder recall / precision vs blockw ---------------------------
    gold_rows_scored = tp_recall = 0
    miss_name = miss_pct = miss_notable = 0
    cand_rows = tp_prec = 0
    for k in scored:
        gold = [x for x in gold_block.get(k, []) if x["pct"] >= BLOCK_FLOOR]
        prows = parsed.get(k, [])
        cands = [p for p in prows if (not p["group"]) and p["pct"] is not None and p["pct"] >= BLOCK_FLOOR]
        for x in gold:
            gold_rows_scored += 1
            if not prows:
                miss_notable += 1
                continue
            nm = [p for p in prows if names_match(p["key"], x["key"])]
            if not nm:
                miss_name += 1
                continue
            if any(p["pct"] is not None and abs(p["pct"] - x["pct"]) <= PCT_TOL_HOLDER for p in nm):
                tp_recall += 1
            else:
                miss_pct += 1
        if gold_block.get(k):  # precision only where blockw covers the filing
            for p in cands:
                cand_rows += 1
                if any(names_match(p["key"], x["key"]) and abs(p["pct"] - x["pct"]) <= PCT_TOL_HOLDER
                       for x in gold_block[k]):
                    tp_prec += 1
    recall = tp_recall / gold_rows_scored if gold_rows_scored else 0.0
    precision = tp_prec / cand_rows if cand_rows else 0.0
    print("\n== (ii) HOLDER MATCH vs blockw (name + percent within %.1f pp, both sides >= %.1f%%) ==" % (
        PCT_TOL_HOLDER, BLOCK_FLOOR))
    print("  RECALL    [gated]: %d / %d gold holder rows = %.2f%%" % (tp_recall, gold_rows_scored, 100 * recall))
    print("    missed, filing had no parsed row : %d" % miss_notable)
    print("    missed, no name match            : %d" % miss_name)
    print("    missed, name matched, percent off : %d" % miss_pct)
    print("  PRECISION [gated]: %d / %d parsed non-group rows >= %.1f%% = %.2f%%" % (
        tp_prec, cand_rows, BLOCK_FLOOR, 100 * precision))

    # ---- (iii) aggregates vs FactSet ---------------------------------------
    def agg_agreement(field, pick):
        n_comp = n_ok = 0
        gaps = []
        for k in scored:
            gf = gold_fs.get(k)
            if not gf or gf[field] is None:
                continue
            v = pick(parsed.get(k, []))
            if v is None:
                continue
            n_comp += 1
            gap = abs(v - gf[field])
            gaps.append(gap)
            if gap <= PCT_TOL_AGG:
                n_ok += 1
        gaps.sort()
        med = gaps[len(gaps) // 2] if gaps else None
        mad = sum(gaps) / len(gaps) if gaps else None
        return n_ok, n_comp, med, mad

    def pick_group(rows):
        vals = [p["pct"] for p in rows if p["group"] and p["pct"] is not None]
        return max(vals) if vals else None

    def pick_largest(rows):
        vals = [p["pct"] for p in rows if (not p["group"]) and p["pct"] is not None]
        return max(vals) if vals else None

    g_ok, g_n, g_med, g_mad = agg_agreement("insider_sum", pick_group)
    l_ok, l_n, l_med, l_mad = agg_agreement("largest", pick_largest)
    grp_agree = g_ok / g_n if g_n else 0.0
    lrg_agree = l_ok / l_n if l_n else 0.0
    print("\n== (iii) AGGREGATE AGREEMENT vs FactSet (within %.1f pp) — DIAGNOSTIC, NOT GATED ==" % PCT_TOL_AGG)
    print("  D&O group %% vs FactSet insider sum  [DIAGNOSTIC]: %d / %d comparable = %.2f%%  (median |gap| %s pp, MAD %s pp)" % (
        g_ok, g_n, 100 * grp_agree, fmt(g_med), fmt(g_mad)))
    print("  largest block %% vs FactSet largest  [DIAGNOSTIC]: %d / %d comparable = %.2f%%  (median |gap| %s pp, MAD %s pp)" % (
        l_ok, l_n, 100 * lrg_agree, fmt(l_med), fmt(l_mad)))
    print("  the FactSet gold is a proxy-window selection over all FactSet stakes (13F / Form 4 mixed;")
    print("  21 of 2,647 linked firm-years carry a PXY marker), so these two never affect the exit code.")

    # ---- (iv) group-row detection ------------------------------------------
    n_grp = sum(1 for k in has_pct if any(p["group"] for p in parsed[k]))
    grp_rate = n_grp / len(has_pct) if has_pct else 0.0
    print("\n== (iv) GROUP-ROW DETECTION (denominator = %d filings with a parsed percent) ==" % len(has_pct))
    print("  filings with a flagged D&O group row [gated]: %d (%.2f%%)" % (n_grp, 100 * grp_rate))

    # ---- (v) ISS DIRECTOR YARDSTICK — DIAGNOSTIC, NEVER GATED ---------------
    #
    # (a) DIRECTOR RECALL. Denominator = non-flagged ISS director rows whose filing
    #     is in the ISS split. Numerator = rows whose (surname, first initial) key
    #     matches at least one parsed row in the SAME filing. Names only: a share
    #     count that disagrees is still a found director.
    # (b) SHARE AGREEMENT. Denominator = matched rows where BOTH sides state a
    #     share count. Numerator = |parsed/iss - 1| <= 1% (and <= 5%). Both sides
    #     are AS-REPORTED counts at the record date, so this is a like-for-like
    #     comparison, unlike the percent (percent-of-class vs voting power).
    # (c) PRECISION PROXY — an UPPER BOUND, not precision. Denominator = parsed
    #     non-group, non-institution rows in ISS-split filings whose name looks
    #     like a natural person. Numerator = rows that either match an ISS director
    #     OR sit in a table that already carries >=1 matched ISS director. The
    #     second arm is the officer allowance: the proxy's table legitimately lists
    #     executive officers (and retired/departed insiders, and family members who
    #     are not directors) whom ISS does not carry at all, and ISS's universe is
    #     S&P 1500 directors only. A person-shaped row inside the very table whose
    #     directors were matched is therefore PLAUSIBLY an officer rather than a
    #     parse error. It cannot distinguish a real officer from a person-shaped
    #     mis-parse in that table, which is exactly why it is a bound and why it is
    #     reported alongside the blockw precision that IS gated.
    iss_metrics = {}
    if not args.no_iss and iss_dir:
        def era_box():
            return {"den": 0, "hit": 0, "sh_den": 0, "sh1": 0, "sh5": 0,
                    "c_den": 0, "c_iss": 0, "c_off": 0}
        eras = {e: era_box() for e in ISS_ERAS}
        tot = era_box()
        iss_causes = defaultdict(int)
        cause_examples = defaultdict(list)
        iss_detail = []

        for k in sorted(iss_filings):
            dirs = iss_dir.get(k, [])
            if not dirs:
                continue
            prows = parsed.get(k, [])
            era = dirs[0]["era"]
            # tables that carry at least one matched ISS director
            dir_keys = {d["pk"] for d in dirs if d["pk"]}
            matched_tables = {p["tix"] for p in prows if p["pk"] and p["pk"] in dir_keys}
            n_person_rows = sum(1 for p in prows
                                if not p["group"] and not p["inst"] and looks_like_person(p["name"]))
            truncated = bool(prows) and n_person_rows < ISS_TRUNCATION_RATIO * len(dirs)

            for d in dirs:
                for box in (eras[era], tot):
                    box["den"] += 1
                hits = [p for p in prows if d["pk"] and p["pk"] == d["pk"]]
                if hits:
                    for box in (eras[era], tot):
                        box["hit"] += 1
                    psh = [p["shares"] for p in hits if p["shares"] is not None]
                    if psh and d["shares"] and d["shares"] > 0:
                        for box in (eras[era], tot):
                            box["sh_den"] += 1
                        rel = min(abs(v / d["shares"] - 1.0) for v in psh)
                        if rel <= ISS_SHARE_TOL:
                            for box in (eras[era], tot):
                                box["sh1"] += 1
                        if rel <= ISS_SHARE_TOL_WIDE:
                            for box in (eras[era], tot):
                                box["sh5"] += 1
                        cause = "ok" if rel <= ISS_SHARE_TOL_WIDE else "name_found_shares_off"
                    elif psh:
                        cause = "ok"
                    else:
                        cause = "name_found_no_share_count_parsed"
                elif not prows:
                    cause = "no_table"
                elif truncated:
                    cause = "table_truncated"
                else:
                    cause = "name_not_found"
                iss_causes[cause] += 1
                if len(cause_examples[cause]) < 5 and k[1] not in [
                        a for _, a in cause_examples[cause]]:
                    cause_examples[cause].append((k[0], k[1]))
                iss_detail.append((k[0], k[1], era, d["name"], cause,
                                   "" if d["shares"] is None else "%d" % round(d["shares"]),
                                   len(prows), n_person_rows, len(dirs)))

            for p in prows:
                if p["group"] or p["inst"] or not looks_like_person(p["name"]):
                    continue
                for box in (eras[era], tot):
                    box["c_den"] += 1
                if p["pk"] and p["pk"] in dir_keys:
                    for box in (eras[era], tot):
                        box["c_iss"] += 1
                elif p["tix"] in matched_tables:
                    for box in (eras[era], tot):
                        box["c_off"] += 1

        def rate(n, d):
            return (n / d) if d else 0.0

        iss_a_tag = "gated" if iss_gated else "DIAGNOSTIC"
        print("\n== (v) ISS DIRECTOR YARDSTICK (%s split) — (a) %s, (b) and (c) DIAGNOSTIC ==" % (
            iss_want, "GATED" if iss_gated else "DIAGNOSTIC"))
        print("  ISS filings in split: %d ; with >=1 usable director row: %d" % (
            len(iss_filings), sum(1 for k in iss_filings if iss_dir.get(k))))
        print("  (a) director recall  [%s]: %d / %d non-flagged ISS director rows = %.2f%%" % (
            iss_a_tag, tot["hit"], tot["den"], 100 * rate(tot["hit"], tot["den"])))
        print("  (b) share agreement  [DIAGNOSTIC]: within 1%%  %d / %d matched rows with both counts = %.2f%%" % (
            tot["sh1"], tot["sh_den"], 100 * rate(tot["sh1"], tot["sh_den"])))
        print("                                     within 5%%  %d / %d = %.2f%%" % (
            tot["sh5"], tot["sh_den"], 100 * rate(tot["sh5"], tot["sh_den"])))
        print("  (c) precision proxy  [DIAGNOSTIC]: %d / %d parsed person-shaped non-group non-institution rows = %.2f%%" % (
            tot["c_iss"] + tot["c_off"], tot["c_den"],
            100 * rate(tot["c_iss"] + tot["c_off"], tot["c_den"])))
        print("        of which matched an ISS director : %d (%.2f%%)" % (
            tot["c_iss"], 100 * rate(tot["c_iss"], tot["c_den"])))
        print("        of which allowed as an officer   : %d (%.2f%%)" % (
            tot["c_off"], 100 * rate(tot["c_off"], tot["c_den"])))
        print("  (c) is an UPPER BOUND: the officer arm cannot separate a real executive")
        print("      officer from a person-shaped mis-parse inside the same table.")

        print("\n  -- by era (denominators shown) --")
        print("  %-11s %19s %19s %19s" % ("era", "(a) recall", "(b) within 1%", "(c) proxy"))
        for e in ISS_ERAS:
            b = eras[e]
            print("  %-11s %7.2f%% (%5d) %7.2f%% (%5d) %7.2f%% (%5d)" % (
                e, 100 * rate(b["hit"], b["den"]), b["den"],
                100 * rate(b["sh1"], b["sh_den"]), b["sh_den"],
                100 * rate(b["c_iss"] + b["c_off"], b["c_den"]), b["c_den"]))
        print("  %-11s %7.2f%% (%5d) %7.2f%% (%5d) %7.2f%% (%5d)" % (
            "ALL", 100 * rate(tot["hit"], tot["den"]), tot["den"],
            100 * rate(tot["sh1"], tot["sh_den"]), tot["sh_den"],
            100 * rate(tot["c_iss"] + tot["c_off"], tot["c_den"]), tot["c_den"]))
        print("  -- (b) within 5% by era --")
        for e in ISS_ERAS:
            b = eras[e]
            print("  %-11s %7.2f%% (%5d)" % (e, 100 * rate(b["sh5"], b["sh_den"]), b["sh_den"]))

        print("\n  -- (a) MISS DECOMPOSITION (denominator = %d non-flagged ISS director rows) --" % tot["den"])
        for c in sorted(iss_causes, key=lambda c: (-iss_causes[c], c)):
            print("  %-36s %6d (%5.2f%%)   e.g. %s" % (
                c, iss_causes[c], 100 * iss_causes[c] / tot["den"],
                ", ".join(a for _, a in cause_examples[c])))
        print("  `ok` and `name_found_shares_off` are both (a) HITS: (a) is a name-only")
        print("  recall, so a found director with a wrong share count is not an (a) miss.")

        iss_metrics = {
            "iss_split": iss_want,
            "iss_filings": len(iss_filings),
            "iss_director_rows_total": n_iss_rows,
            "iss_director_rows_flagged": n_iss_flagged,
            "iss_director_recall": rate(tot["hit"], tot["den"]),
            "iss_director_rows_scored": tot["den"],
            "iss_share_agreement_1pct": rate(tot["sh1"], tot["sh_den"]),
            "iss_share_agreement_5pct": rate(tot["sh5"], tot["sh_den"]),
            "iss_share_comparable_rows": tot["sh_den"],
            "iss_individual_precision_proxy": rate(tot["c_iss"] + tot["c_off"], tot["c_den"]),
            "iss_individual_candidate_rows": tot["c_den"],
            "iss_individual_matched_director": tot["c_iss"],
            "iss_individual_allowed_officer": tot["c_off"],
            "iss_miss_causes": dict(sorted(iss_causes.items())),
            "iss_by_era": {e: dict(eras[e]) for e in ISS_ERAS},
        }
        if args.iss_miss_report:
            iss_detail.sort()
            with open(args.iss_miss_report, "w") as fh:
                fh.write("cik\taccession\tera\tdirector_name\tcause\tiss_shares"
                         "\tn_parsed_rows\tn_person_rows\tn_iss_directors\n")
                for row in iss_detail:
                    fh.write("\t".join(str(x) for x in row) + "\n")
            print("[out] %s: %d rows" % (args.iss_miss_report, len(iss_detail)))

    # ---- (vi) FULL-ARCHIVE SAMPLE -------------------------------------------
    #
    # (a) DUPLICATE EXCESS. The GATED key since 2026-09-29 is the IDENTICAL ROW —
    #     (accession, cik, table_kind, holder_name, share_class, shares, percent) —
    #     counting excess copies, n-1 per group. A row that repeats every field is
    #     the same row emitted twice under any reading; table_index is deliberately
    #     OUT of the key, so one row emitted from two tables of one kind still
    #     counts.
    #     The looser key (accession, cik, holder_name, share_class) is still
    #     computed and printed, now DIAGNOSTIC, with its exact decomposition:
    #         n - 1  =  Σ_kinds (n_in_kind - 1)      "same table_kind"
    #                +  (n_distinct_kinds - 1)       "cross table_kind"
    #     Neither part is gated any more, and for different reasons. Cross-kind is
    #     what the DOCUMENT does: a director who is also a 5% holder is listed in
    #     the 5% table AND the management table, and both rows are real. Same-kind
    #     counts one holder listed once per managed account — each row with its own
    #     shares and percent — as duplicates; that is the AllianceBernstein 2018
    #     shape, 264 of that year's 304 excess rows, and gating it paid the loop to
    #     delete distinct facts. See DupExcess and thresholds.json `_history`.
    # (b) PARSED-PERCENT YIELD per year — the same definition as (i), on the
    #     sample instead of the gold set. Gated as a NO-REGRESSION FLOOR per year:
    #     the floors live in thresholds.json `_sample_yield_floor_by_year` and were
    #     recorded at HEAD minus a slack, so a round may not buy duplicate
    #     cleanliness by dropping rows in any single year.
    # (c) GROUP-ROW RATE per year — reported, so a regression is visible.
    sample_metrics = {}
    if not args.no_sample and sample_year:
        syears = sorted(set(sample_year.values()))
        sb = {y: sample_box() for y in syears}
        stot = sample_box()
        for key, y in sample_year.items():
            for box in (sb[y], stot):
                box["filings"] += 1
                box["rows"] += sample_n_rows.get(key, 0)
                box["with_pct"] += 1 if key in sample_has_pct else 0
                # (c)'s denominator is `with_pct`, matching (iv), so its numerator
                # must be the INTERSECTION — a filing with a group row but no
                # parsed percent is not in the denominator and cannot be in the
                # numerator either, or the rate exceeds 1.
                box["with_group"] += 1 if (key in sample_has_group
                                           and key in sample_has_pct) else 0
        for fkey, ex in dup.excess().items():
            for box in (sb[sample_year[fkey]], stot):
                for nm, v in ex.items():
                    box[nm] += v

        def srate(n, d):
            return (n / d) if d else 0.0

        dup_ident = srate(stot["excess_identical"], stot["rows"])
        dup_same = srate(stot["excess_same_kind"], stot["rows"])
        dup_cross = srate(stot["excess_cross_kind"], stot["rows"])
        dup_1tbl = srate(stot["excess_same_table"], stot["rows"])
        yields = {y: srate(sb[y]["with_pct"], sb[y]["filings"]) for y in syears}
        grouprate = {y: srate(sb[y]["with_group"], sb[y]["with_pct"]) for y in syears}
        dup_ident_y = {y: srate(sb[y]["excess_identical"], sb[y]["rows"]) for y in syears}
        dup_same_y = {y: srate(sb[y]["excess_same_kind"], sb[y]["rows"]) for y in syears}
        dup_cross_y = {y: srate(sb[y]["excess_cross_kind"], sb[y]["rows"]) for y in syears}
        dup_1tbl_y = {y: srate(sb[y]["excess_same_table"], sb[y]["rows"]) for y in syears}
        worst_ident_year = max(syears, key=lambda y: dup_ident_y[y])
        worst_dup_year = max(syears, key=lambda y: dup_same_y[y])

        floors = {int(k): float(v)
                  for k, v in (thresholds.get("_sample_yield_floor_by_year") or {}).items()}
        margins = {y: yields[y] - floors[y] for y in syears if y in floors}
        worst_margin = min(margins.values()) if margins else None
        worst_margin_year = min(margins, key=lambda y: margins[y]) if margins else None

        print("\n== (vi) FULL-ARCHIVE SAMPLE (seed 20260929, %d filings, %d filing years) ==" % (
            stot["filings"], len(syears)))
        print("  parser rows in sample filings: %d" % stot["rows"])
        print("  (a) duplicate excess, denominator = %d parsed rows in sample filings." % stot["rows"])
        print("      IDENTICAL ROW is the GATED definition since 2026-09-29:")
        print("      (accession, cik, table_kind, holder_name, share_class, shares, percent)")
        print("      excess IDENTICAL ROWS       [GATED]       : %6d (%6.3f%%)" % (
            stot["excess_identical"], 100 * dup_ident))
        print("      -- and on the looser key (accession, cik, holder_name, share_class),")
        print("         all DIAGNOSTIC since 2026-09-29 --")
        print("      excess TOTAL                              : %6d (%6.3f%%)" % (
            stot["excess_total"], 100 * srate(stot["excess_total"], stot["rows"])))
        print("      of it, SAME table_kind      [DIAGNOSTIC]  : %6d (%6.3f%%)" % (
            stot["excess_same_kind"], 100 * dup_same))
        print("        of THAT, inside ONE table_index         : %6d (%6.3f%%)" % (
            stot["excess_same_table"], 100 * dup_1tbl))
        print("      of it, CROSS table_kind     [DIAGNOSTIC]  : %6d (%6.3f%%)" % (
            stot["excess_cross_kind"], 100 * dup_cross))
        print("      cross-kind is the 5%-table AND management-table listing the same")
        print("      holder; the document really does that, so it is never gated.")
        print("      same-kind counts one holder listed once per managed account with")
        print("      DIFFERENT shares and percent as duplicates, which it is not — that")
        print("      is why the gate moved to the identical-row key.")
        print("  (b) parsed-percent yield, pooled: %d / %d = %.4f" % (
            stot["with_pct"], stot["filings"], srate(stot["with_pct"], stot["filings"])))
        print("  (c) group-row rate, pooled      : %d / %d = %.4f" % (
            stot["with_group"], stot["with_pct"], srate(stot["with_group"], stot["with_pct"])))

        print("\n  -- by filing year --")
        print("  %-5s %7s %8s %10s %9s %9s %9s %9s %9s %9s" % (
            "year", "filings", "rows", "dup_ident", "dup_same", "dup_1tbl", "dup_x",
            "yield", "floor", "grouprow"))
        for y in syears:
            print("  %-5d %7d %8d %9.3f%% %8.3f%% %8.3f%% %8.3f%% %9.4f %9s %9.4f" % (
                y, sb[y]["filings"], sb[y]["rows"], 100 * dup_ident_y[y],
                100 * dup_same_y[y],
                100 * dup_1tbl_y[y], 100 * dup_cross_y[y], yields[y],
                ("%.4f" % floors[y]) if y in floors else "n/a", grouprate[y]))
        print("  worst dup_ident year [GATED]: %d at %.3f%%" % (
            worst_ident_year, 100 * dup_ident_y[worst_ident_year]))
        print("  worst dup_same  year [DIAG ]: %d at %.3f%%" % (
            worst_dup_year, 100 * dup_same_y[worst_dup_year]))
        if worst_margin is None:
            print("  yield floors: NOT RECORDED in thresholds.json "
                  "`_sample_yield_floor_by_year` — run score.py --record-sample-floors once")
        else:
            print("  worst yield margin vs floor: %+.4f in %d" % (worst_margin, worst_margin_year))

        sample_metrics = {
            "sample_filings": stot["filings"],
            "sample_rows": stot["rows"],
            # GATED since 2026-09-29: the identical-row key.
            "sample_dup_excess_identical_row_rate": dup_ident,
            "sample_dup_excess_identical_row_rate_max_year": dup_ident_y[worst_ident_year],
            "sample_dup_excess_identical_row_worst_year": worst_ident_year,
            "sample_dup_excess_total_rate": srate(stot["excess_total"], stot["rows"]),
            # DIAGNOSTIC since 2026-09-29; these two were the gated pair before.
            "sample_dup_excess_same_table_rate": dup_same,
            "sample_dup_excess_same_table_rate_max_year": dup_same_y[worst_dup_year],
            "sample_dup_excess_same_table_worst_year": worst_dup_year,
            "sample_dup_excess_same_table_index_rate": dup_1tbl,
            "sample_dup_excess_cross_table_rate": dup_cross,
            "sample_filing_yield_parsed_percent": srate(stot["with_pct"], stot["filings"]),
            "sample_group_row_rate": srate(stot["with_group"], stot["with_pct"]),
            "sample_yield_by_year": {str(y): yields[y] for y in syears},
            "sample_group_row_rate_by_year": {str(y): grouprate[y] for y in syears},
            "sample_dup_identical_row_rate_by_year": {str(y): dup_ident_y[y] for y in syears},
            "sample_dup_same_table_rate_by_year": {str(y): dup_same_y[y] for y in syears},
            "sample_dup_cross_table_rate_by_year": {str(y): dup_cross_y[y] for y in syears},
            "sample_dup_same_table_index_rate_by_year": {str(y): dup_1tbl_y[y] for y in syears},
            "sample_rows_by_year": {str(y): sb[y]["rows"] for y in syears},
            "sample_filings_by_year": {str(y): sb[y]["filings"] for y in syears},
        }
        if worst_margin is not None:
            sample_metrics["sample_yield_worst_year_margin"] = worst_margin
            sample_metrics["sample_yield_worst_year"] = worst_margin_year

        if args.sample_report:
            with open(args.sample_report, "w") as fh:
                fh.write("year\tfilings\trows\texcess_identical_row"
                         "\tdup_identical_row_rate"
                         "\texcess_total\texcess_same_table_kind"
                         "\texcess_same_table_index\texcess_cross_table_kind"
                         "\tdup_same_table_rate\tdup_cross_table_rate"
                         "\tfilings_with_parsed_percent\tyield_parsed_percent\tyield_floor"
                         "\tfilings_with_group_row\tgroup_row_rate\n")
                for y in syears:
                    fh.write("%d\t%d\t%d\t%d\t%.6f\t%d\t%d\t%d\t%d\t%.6f\t%.6f\t%d\t%.6f\t%s\t%d\t%.6f\n" % (
                        y, sb[y]["filings"], sb[y]["rows"],
                        sb[y]["excess_identical"], dup_ident_y[y], sb[y]["excess_total"],
                        sb[y]["excess_same_kind"], sb[y]["excess_same_table"],
                        sb[y]["excess_cross_kind"], dup_same_y[y], dup_cross_y[y],
                        sb[y]["with_pct"], yields[y],
                        ("%.6f" % floors[y]) if y in floors else "", sb[y]["with_group"],
                        grouprate[y]))
            print("[out] %s: %d year rows" % (args.sample_report, len(syears)))

        if args.record_sample_floors:
            frag = {"_sample_yield_floor_by_year": {
                str(y): round(max(0.0, yields[y] - args.sample_floor_slack), 6) for y in syears}}
            with open(args.record_sample_floors, "w") as fh:
                json.dump(frag, fh, indent=2, sort_keys=True)
                fh.write("\n")
            print("[out] %s: per-year yield floors = measured minus %.4f" % (
                args.record_sample_floors, args.sample_floor_slack))

    # ---- (vii) REGRESSION SET ------------------------------------------------
    #
    # Three GATED recovery rates over denominators fixed in gold_regress.tsv
    # (the third, regress_lost_recovered over set (c), and the fourth,
    # regress_lost_d_recovered over set (d), both since 2026-10-01):
    #   regress_zero_row_recovered   = |{set(a): >= 1 parsed row now}| / |set(a)|
    #   regress_group_row_recovered  = |{set(b) gated: >= 1 group row with a parsed
    #                                   percent now}| / |set(b) gated|
    # Both were 0.0000 by construction at the commit the set was cut from — the new
    # panel IS the parser that lost them — so these are the round's target, not a
    # no-regression floor.
    #
    # Reported, never gated: recovery over the share-only group-row population (the
    # old group row carried no percent; the report's compensation/award group labels
    # live there), recovery over the EXCLUDED filings (X1/X2 — if the round drags
    # those back it is re-introducing dollar-range and compensation tables, and the
    # duplicate ceilings and blockw precision are the gates that will say so), and
    # the row counts, so a "recovery" that emits one junk row is visible.
    regress_metrics = {}
    if not args.no_regress and reg_meta:
        def rrate(hits, den):
            return (len(hits) / len(den)) if den else 0.0

        a_hit = reg.recovered_zero_row(reg_a)
        bg_hit = reg.recovered_group_row(reg_bg)
        bg_any = reg.recovered_group_row_any(reg_bg)
        bd_hit = reg.recovered_group_row_any(reg_bd)
        ex_hit = reg.recovered_zero_row(reg_excl_zero)
        a_rate, bg_rate = rrate(a_hit, reg_a), rrate(bg_hit, reg_bg)
        old_rows_a = sum(int(reg_meta[k]["old_n_rows"]) for k in reg_a)
        new_rows_a = sum(reg.rows.get(k, 0) for k in reg_a)

        print("\n== (vii) REGRESSION SET (fixed diff of panel_e4e78a95 -> panel; "
              "%d candidate filings) ==" % len(reg_meta))
        print("  (a) ZERO-ROW set: old n_rows > 0 and new n_rows == 0, after the %d "
              "set-(a) exclusion clauses" % len([c for c in present if c not in GROUP_EXCL_COLS]))
        print("      recovered >=1 row   [GATED]: %d / %d = %.4f" % (
            len(a_hit), len(reg_a), a_rate))
        print("      rows: %d in the old panel over those filings, %d now" % (
            old_rows_a, new_rows_a))
        print("  (b) GROUP-ROW set: old group row, new none, >=1 lost group row carried a percent")
        print("      group row with a percent back [GATED]: %d / %d = %.4f" % (
            len(bg_hit), len(reg_bg), bg_rate))
        print("      of those filings, any group row at all: %d / %d" % (
            len(bg_any), len(reg_bg)))
        print("  DIAGNOSTIC, never gated:")
        print("      share-only group-row population, any group row back: %d / %d = %.4f" % (
            len(bd_hit), len(reg_bd), rrate(bd_hit, reg_bd)))
        print("      EXCLUDED zero-row filings (X1 dollar-in-name / X2 one-value-all-rows /")
        print("      X3 fund dollar-range / X4 per-fund compensation / X10 repeated compensation /")
        print("      X11 audit billing / X12 partnership accounting / X13 purchase-narrative year)")
        print("      that emit >=1 row again: %d / %d = %.4f  — a RISE here is the round" % (
            len(ex_hit), len(reg_excl_zero), rrate(ex_hit, reg_excl_zero)))
        print("      re-accepting non-ownership rows, not recovering ownership [DIAGNOSTIC]")
        # PER CLAUSE, so the 2026-09-30 set correction is auditable: the 285 filings
        # X3/X4 removed from set (a) are still counted here every round. Clauses can
        # overlap, so these denominators sum to more than the total above.
        for c in EXCL_COLS:
            den = reg_excl_zero_by_clause.get(c, set())
            if not den:
                continue
            hit = reg.recovered_zero_row(den)
            print("        %-32s %d / %d = %.4f" % (
                c.replace("excl_", ""), len(hit), len(den), rrate(hit, den)))

        c_hit = reg.recovered_zero_row(reg_c)
        c_ex_hit = reg.recovered_zero_row(reg_c_excl)
        c_rate = rrate(c_hit, reg_c)
        if lost_present:
            print("  (c) LOST set: old panel (092b6fb9) n_rows > 0, panel_a449b66c n_rows == 0,")
            print("      after X1-X4 / X10-X13 re-applied and X14-X20")
            print("      recovered >=1 row   [GATED]: %d / %d = %.4f" % (
                len(c_hit), len(reg_c), c_rate))
            print("      EXCLUDED set-(c) filings emitting >=1 row again: %d / %d = %.4f "
                  "[DIAGNOSTIC]" % (len(c_ex_hit), len(reg_c_excl), rrate(c_ex_hit, reg_c_excl)))
            for c in LOST_EXCL_COLS:
                den = reg_c_excl_by_clause[c]
                if den:
                    hit = reg.recovered_zero_row(den)
                    print("        %-36s %d / %d = %.4f" % (c, len(hit), len(den), rrate(hit, den)))

        d_hit = reg.recovered_zero_row(reg_d)
        d_ex_hit = reg.recovered_zero_row(reg_d_excl)
        d_rate = rrate(d_hit, reg_d)
        if lost_d_present:
            print("  (d) LOST_D set: panel_a449b66c n_rows > 0, panel_7ac69e96 n_rows == 0,")
            print("      after X1-X4 / X10-X13 / X14,X16-X20 (X15 not applied) and X21-X23")
            print("      recovered >=1 row   [GATED]: %d / %d = %.4f" % (
                len(d_hit), len(reg_d), d_rate))
            print("      EXCLUDED set-(d) filings emitting >=1 row again: %d / %d = %.4f "
                  "[DIAGNOSTIC]" % (len(d_ex_hit), len(reg_d_excl), rrate(d_ex_hit, reg_d_excl)))
            for c in LOST_D_EXCL_COLS:
                den = reg_d_excl_by_clause[c]
                if den:
                    hit = reg.recovered_zero_row(den)
                    print("        %-36s %d / %d = %.4f" % (c, len(hit), len(den), rrate(hit, den)))

        group_ex_hit = reg.recovered_group_row(reg_excl_group)
        print("      EXCLUDED set-(b) targets, group row with percent back: %d / %d = %.4f" % (
            len(group_ex_hit), len(reg_excl_group), rrate(group_ex_hit, reg_excl_group)))
        for c in GROUP_EXCL_COLS:
            den = reg_excl_group_by_clause[c]
            hit = reg.recovered_group_row(den)
            print("        %-36s %d / %d = %.4f [DIAGNOSTIC]" % (
                c.replace("excl_", ""), len(hit), len(den), rrate(hit, den)))

        regress_metrics = {
            "regress_zero_row_recovered": a_rate,
            "regress_zero_row_denominator": len(reg_a),
            "regress_zero_row_recovered_n": len(a_hit),
            "regress_zero_row_old_rows": old_rows_a,
            "regress_zero_row_new_rows": new_rows_a,
            "regress_group_row_recovered": bg_rate,
            "regress_group_row_denominator": len(reg_bg),
            "regress_group_row_recovered_n": len(bg_hit),
            "regress_group_row_any_group_row_back": len(bg_any),
            "regress_group_row_share_only_recovered": rrate(bd_hit, reg_bd),
            "regress_group_row_share_only_denominator": len(reg_bd),
            "regress_excluded_emitting_rows_rate": rrate(ex_hit, reg_excl_zero),
            "regress_excluded_denominator": len(reg_excl_zero),
            "regress_excluded_filings_total": len(reg_excl),
            "regress_excluded_group_row_recovered": rrate(group_ex_hit, reg_excl_group),
            "regress_excluded_group_row_denominator": len(reg_excl_group),
            "regress_candidate_filings": len(reg_meta),
            "regress_manifest_covered": len(reg_man),
        }
        if lost_present:
            regress_metrics.update({
                "regress_lost_recovered": c_rate,
                "regress_lost_denominator": len(reg_c),
                "regress_lost_recovered_n": len(c_hit),
                "regress_lost_excluded_emitting_rows_rate": rrate(c_ex_hit, reg_c_excl),
                "regress_lost_excluded_denominator": len(reg_c_excl),
            })
        if lost_d_present:
            regress_metrics.update({
                "regress_lost_d_recovered": d_rate,
                "regress_lost_d_denominator": len(reg_d),
                "regress_lost_d_recovered_n": len(d_hit),
                "regress_lost_d_excluded_emitting_rows_rate": rrate(d_ex_hit, reg_d_excl),
                "regress_lost_d_excluded_denominator": len(reg_d_excl),
            })
        # Per-clause diagnostics, never gated. Named after the clause so the
        # 2026-09-30 X3/X4 correction is checkable from metrics_dev.json alone.
        for c in EXCL_COLS:
            den = reg_excl_zero_by_clause.get(c, set())
            if not den:
                continue
            regress_metrics["regress_%s_emitting_rows_rate" % c.replace("excl_", "")] = \
                rrate(reg.recovered_zero_row(den), den)
            regress_metrics["regress_%s_denominator" % c.replace("excl_", "")] = len(den)
        for c in GROUP_EXCL_COLS:
            den = reg_excl_group_by_clause[c]
            regress_metrics["regress_%s_group_row_recovered" % c.replace("excl_", "")] = rrate(reg.recovered_group_row(den), den)
            regress_metrics["regress_%s_group_row_denominator" % c.replace("excl_", "")] = len(den)
        if args.regress_report:
            with open(args.regress_report, "w") as fh:
                fh.write("cik\taccession\tfiling_date\tin_set_zero_row\tin_set_group_row_gated"
                         "\tin_set_group_row_diag\texcluded\texcl_clauses\told_n_rows"
                         "\told_group_rows"
                         "\told_group_rows_with_percent\tnew_n_rows\tnew_group_row_any"
                         "\tnew_group_row_with_percent\trecovered\tin_set_lost\tin_set_lost_d\n")
                for k in sorted(reg_meta):
                    r = reg_meta[k]
                    in_a = r["in_set_zero_row"] == "1"
                    in_bg = r["in_set_group_row_gated"] == "1"
                    in_c = lost_present and r["in_set_lost"] == "1"
                    in_d = lost_d_present and r["in_set_lost_d"] == "1"
                    # `recovered` is only meaningful for a filing in a GATED set;
                    # for the diagnostic and excluded rows it is `na`, not 1, so
                    # counting the column cannot overstate the recovery.
                    if not (in_a or in_bg or in_c or in_d):
                        rec = "na"
                    else:
                        rec = 1 if ((not (in_a or in_c or in_d) or reg.rows.get(k, 0) > 0)
                                    and (not in_bg or k in reg.group_pct)) else 0
                    fh.write("\t".join(str(x) for x in [
                        k[0], k[1], r["filing_date"], r["in_set_zero_row"],
                        r["in_set_group_row_gated"], r["in_set_group_row_diag"],
                        1 if k in reg_excl else 0,
                        ",".join(c.replace("excl_", "") for c in present if r[c] == "1") or "-",
                        r["old_n_rows"], r["old_group_rows"],
                        r["old_group_rows_with_percent"], reg.rows.get(k, 0),
                        1 if k in reg.group_any else 0, 1 if k in reg.group_pct else 0,
                        rec, r["in_set_lost"] if lost_present else 0,
                        r["in_set_lost_d"] if lost_d_present else 0]) + "\n")
            print("[out] %s: %d rows" % (args.regress_report, len(reg_meta)))

    # ---- miss decomposition -------------------------------------------------
    causes = defaultdict(int)
    detail = []
    for k in scored:
        m = man.get(k)
        prows = parsed.get(k, [])
        gold = [x for x in gold_block.get(k, []) if x["pct"] >= BLOCK_FLOOR]
        gf = gold_fs.get(k)
        cause = ""
        if m is None:
            cause = "link_failure_not_in_manifest"
        elif m.get("parse_status") != "ok":
            cause = "read_error"
        elif not prows:
            cause = "no_table_found_plain_text" if m.get("parser") == "text_table" else "no_table_found_html"
        elif not any(p["pct"] is not None for p in prows):
            cause = "table_found_no_percent"
        elif gold and not any(
                any(names_match(p["key"], x["key"]) for p in prows) for x in gold):
            cause = "name_mismatch"
        elif gold and not any(
                any(names_match(p["key"], x["key"]) and p["pct"] is not None
                    and abs(p["pct"] - x["pct"]) <= PCT_TOL_HOLDER for p in prows) for x in gold):
            cause = "percent_mismatch"
        elif not any(p["group"] for p in prows):
            cause = "group_row_missing"
        elif gf and gf["largest"] is not None and pick_largest(prows) is not None \
                and abs(pick_largest(prows) - gf["largest"]) > PCT_TOL_AGG:
            cause = "aggregate_gap_multi_class_or_denominator"
        else:
            cause = "ok"
        causes[cause] += 1
        detail.append((k[0], k[1], cause, len(prows), len(gold),
                       "" if m is None else m.get("parser", "")))
    print("\n== MISS DECOMPOSITION (denominator = %d gold-linked %s filings) ==" % (n_gold, want_split))
    for c in sorted(causes, key=lambda c: (-causes[c], c)):
        print("  %-42s %6d (%5.2f%%)" % (c, causes[c], 100 * causes[c] / n_gold))

    if args.miss_report:
        detail.sort()
        with open(args.miss_report, "w") as fh:
            fh.write("cik\taccession\tcause\tn_parsed_rows\tn_gold_rows_ge5\tparser\n")
            for row in detail:
                fh.write("\t".join(str(x) for x in row) + "\n")
        print("[out] %s: %d rows" % (args.miss_report, len(detail)))

    metrics = {
        "split": want_split,
        "gold_filings": n_gold,
        "filing_yield_any_row": yield_any,
        "filing_yield_parsed_percent": yield_pct,
        "holder_recall_blockw": recall,
        "holder_precision_blockw": precision,
        "holder_gold_rows_scored": gold_rows_scored,
        "holder_candidate_rows": cand_rows,
        "group_pct_agreement_factset": grp_agree,
        "group_pct_comparable": g_n,
        "largest_block_agreement_factset": lrg_agree,
        "largest_block_comparable": l_n,
        "group_row_detection_rate": grp_rate,
        "median_abs_gap_group_pp": g_med,
        "mad_group_pp": g_mad,
        "median_abs_gap_largest_pp": l_med,
        "mad_largest_pp": l_mad,
        "miss_causes": dict(sorted(causes.items())),
    }
    metrics.update(iss_metrics)
    metrics.update(sample_metrics)
    metrics.update(regress_metrics)
    if args.json_out:
        with open(args.json_out, "w") as fh:
            json.dump(metrics, fh, indent=2, sort_keys=True)
            fh.write("\n")
        print("[out] %s" % args.json_out)

    values = {
        "filing_yield_parsed_percent": yield_pct,
        "holder_recall_blockw": recall,
        "holder_precision_blockw": precision,
        "group_row_detection_rate": grp_rate,
        "group_pct_agreement_factset": grp_agree,
        "largest_block_agreement_factset": lrg_agree,
    }
    for nm in ("iss_director_recall", "iss_share_agreement_1pct",
               "iss_share_agreement_5pct", "iss_individual_precision_proxy"):
        if nm in iss_metrics:
            values[nm] = iss_metrics[nm]
    for nm, v in sample_metrics.items():
        if isinstance(v, float):
            values[nm] = v
    for nm, v in regress_metrics.items():
        if isinstance(v, float):
            values[nm] = v
    # GATED = exactly the keys in thresholds["minimums"] (floors, val >= thr) plus
    # thresholds["maximums"] (ceilings, val <= thr). Every other metric is
    # diagnostic: printed with its denominator, never able to change the exit code.
    gated_names = list(gate_floor) + list(gate_ceiling)
    unknown = [n for n in gated_names if n not in values]
    if unknown:
        sys.exit("ERROR: thresholds.json gates unknown or uncomputable metric(s): %s. "
                 "A gated per-year yield margin needs `_sample_yield_floor_by_year` "
                 "populated — run score.py --record-sample-floors once, by hand."
                 % ", ".join(sorted(unknown)))
    diag_names = [n for n in thresholds.get("diagnostics", []) if n in values]

    print("\n== GATED METRICS (%d: %d floor + %d ceiling; thresholds %s) ==" % (
        len(gated_names), len(gate_floor), len(gate_ceiling), os.path.abspath(args.thresholds)))
    failed = []
    for name in gate_floor:
        val, thr = values[name], gate_floor[name]
        ok = val >= thr
        print("  %-42s %.4f  >= %.4f  %s" % (name, val, thr, "PASS" if ok else "FAIL"))
        if not ok:
            failed.append("%s: %.4f < %.4f (floor)" % (name, val, thr))
    for name in gate_ceiling:
        val, thr = values[name], gate_ceiling[name]
        ok = val <= thr
        print("  %-42s %.4f  <= %.4f  %s" % (name, val, thr, "PASS" if ok else "FAIL"))
        if not ok:
            failed.append("%s: %.4f > %.4f (ceiling)" % (name, val, thr))

    if diag_names:
        print("\n== DIAGNOSTIC METRICS (%d; no threshold, NO effect on the exit code) ==" % len(diag_names))
        for name in diag_names:
            print("  %-42s %.4f  (diagnostic)" % (name, values[name]))

    if args.check:
        if failed:
            print("\nCHECK FAIL (%d of %d gated metric(s) short):" % (len(failed), len(gated_names)))
            for f in failed:
                print("  " + f)
            sys.exit(1)
        print("\nCHECK PASS: all %d gated metrics clear their thresholds" % len(gated_names))
        sys.exit(0)
    if failed:
        print("\n(%d gated metric(s) below threshold; --check would exit 1)" % len(failed))


def fmt(v):
    return "n/a" if v is None else "%.3f" % v


if __name__ == "__main__":
    main()
