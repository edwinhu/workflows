#!/usr/bin/env python3
"""score_test.py — tests for the (v) ISS name matcher and person test, and for
the (vi) duplicate-excess counters.

Stdlib unittest, no fixtures on disk. Every ISS string below is a real value read
out of gold_iss_all.tsv.gz; every proxy string is the form the parser emits for
the same person.

    python3 scorer/score_test.py
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from score import DupExcess, era_of, looks_like_person, person_key  # noqa: E402


class PersonKey(unittest.TestCase):
    def match(self, iss, proxy):
        a, b = person_key(iss), person_key(proxy)
        self.assertIsNotNone(a, iss)
        self.assertIsNotNone(b, proxy)
        return a == b

    def test_iss_initial_only_given_name(self):
        # ISS writes "S WALTON"; the proxy writes it out.
        self.assertTrue(self.match("S WALTON", "S. Robson Walton"))
        self.assertTrue(self.match("S. ROBSON WALTON", "S. Robson Walton"))

    def test_suffix_dropped(self):
        # ISS 2008 writes "H SCOTT JR."; the proxy writes "H. Lee Scott, Jr."
        self.assertTrue(self.match("H SCOTT JR.", "H. Lee Scott, Jr."))
        self.assertTrue(self.match("JOHN SMITH III", "John Q. Smith, III"))

    def test_middle_name_ignored(self):
        self.assertTrue(self.match("JIM C. WALTON", "Jim Walton"))
        self.assertTrue(self.match("GREGORY B. PENNER", "Gregory Boyd Penner"))

    def test_nickname_initial_differs(self):
        self.assertTrue(self.match("BOB A. SMITH", "Robert A. Smith"))
        self.assertTrue(self.match("JIM WALTON", "James Walton"))

    def test_surname_first_with_separator(self):
        self.assertTrue(self.match("S. ROBSON WALTON", "WALTON; S. ROBSON"))
        self.assertTrue(self.match("JIM C. WALTON", "Walton, Jim C."))

    def test_different_people_do_not_match(self):
        self.assertFalse(self.match("JIM C. WALTON", "Alice Walton"))
        self.assertFalse(self.match("JOHN T WALTON", "John T. Smith"))

    def test_single_token_is_not_a_person_key(self):
        self.assertIsNone(person_key("Walton"))
        self.assertIsNone(person_key(""))
        self.assertIsNone(person_key("Jr."))


class LooksLikePerson(unittest.TestCase):
    def test_people(self):
        for s in ("Jim C. Walton", "S. Robson Walton", "H. Lee Scott, Jr.",
                  "Gregory B. Penner", "Alex Gorsky"):
            self.assertTrue(looks_like_person(s), s)

    def test_entities(self):
        for s in ("FMR Corp.", "The Vanguard Group, Inc.", "BlackRock, Inc.",
                  "Walton Enterprises, L.P.", "Capital Research and Management",
                  "State Street Bank and Trust Company",
                  "All directors and executive officers as a group",
                  "Wells Fargo Bank, N.A.", "401(k) Savings Plan"):
            self.assertFalse(looks_like_person(s), s)

    def test_too_many_tokens(self):
        self.assertFalse(looks_like_person("Some Very Long Six Token Name Here"))


class Eras(unittest.TestCase):
    def test_boundaries(self):
        self.assertEqual(era_of(2002), "2002-2006")
        self.assertEqual(era_of(2006), "2002-2006")
        self.assertEqual(era_of(2007), "2007-2012")
        self.assertEqual(era_of(2012), "2007-2012")
        self.assertEqual(era_of(2013), "2013-2018")
        self.assertEqual(era_of(2018), "2013-2018")
        self.assertEqual(era_of(2019), "2019-2024")
        self.assertEqual(era_of(2024), "2019-2024")


class DupExcessCounters(unittest.TestCase):
    """(vi)(a). The GATED counter since 2026-09-29 is `excess_identical`.

    Each case is a shape measured on the corpus, named in thresholds.json
    `_history` under the 2026-09-29 duplicate-metric entries.
    """

    F = ("320193", "0001104659-18-000001")
    ZERO = {n: 0 for n in DupExcess.NAMES}
    FIELDS = ("holder_name", "share_class", "table_kind", "table_index",
              "shares", "percent")

    def counts(self, specs, fkey=None):
        d = DupExcess()
        for s in specs:
            d.add(fkey or self.F, dict(zip(self.FIELDS, s)))
        return d.excess().get(fkey or self.F, dict(self.ZERO))

    def test_alliancebernstein_one_holder_many_accounts_is_not_a_duplicate(self):
        # AllianceBernstein 2018: ONE holder, one share class, one table, listed
        # once per managed account, every row with its OWN shares and percent.
        # 264 of 2018's 304 same-kind excess rows were this shape.
        specs = [("AllianceBernstein L.P.", "", "five_percent", "0",
                  str(1000 + 7 * i), "%.2f" % (1.0 + 0.1 * i)) for i in range(9)]
        ex = self.counts(specs)
        self.assertEqual(ex["excess_identical"], 0)
        # ... and the OLD gated measure called those same nine rows eight
        # duplicates, which is exactly why the gate moved.
        self.assertEqual(ex["excess_same_kind"], 8)
        self.assertEqual(ex["excess_same_table"], 8)
        self.assertEqual(ex["excess_total"], 8)

    def test_exact_repeat_is_a_duplicate(self):
        specs = [("FMR LLC", "Common", "five_percent", "0", "1,234,567", "5.1"),
                 ("FMR LLC", "Common", "five_percent", "0", "1,234,567", "5.1")]
        ex = self.counts(specs)
        self.assertEqual(ex["excess_identical"], 1)

    def test_three_exact_copies_count_two_excess(self):
        one = ("FMR LLC", "Common", "five_percent", "0", "1,234,567", "5.1")
        self.assertEqual(self.counts([one, one, one])["excess_identical"], 2)

    def test_exact_repeat_across_table_index_is_still_a_duplicate(self):
        # table_index is NOT in the identical-row key: the same row emitted out of
        # two tables of one kind is one row emitted twice.
        specs = [("FMR LLC", "Common", "five_percent", "0", "1,234,567", "5.1"),
                 ("FMR LLC", "Common", "five_percent", "3", "1,234,567", "5.1")]
        ex = self.counts(specs)
        self.assertEqual(ex["excess_identical"], 1)
        self.assertEqual(ex["excess_same_table"], 0)

    def test_cross_table_kind_listing_is_not_a_duplicate(self):
        # A director who is also a 5% holder appears in both tables; the document
        # really does that.
        specs = [("Jim C. Walton", "", "five_percent", "0", "1,000", "5.1"),
                 ("Jim C. Walton", "", "management", "1", "1,000", "5.1")]
        ex = self.counts(specs)
        self.assertEqual(ex["excess_identical"], 0)
        self.assertEqual(ex["excess_cross_kind"], 1)

    def test_multi_series_rows_with_empty_share_class_are_not_duplicates(self):
        # Liberty Media 2024: one holder, nine series, share_class empty because
        # the row-level series column is roled `other`. Distinct shares, so
        # distinct rows.
        specs = [("John C. Malone", "", "management", "0", str(500 + i), "")
                 for i in range(9)]
        ex = self.counts(specs)
        self.assertEqual(ex["excess_identical"], 0)
        self.assertEqual(ex["excess_same_kind"], 8)

    def test_same_shares_different_percent_is_not_a_duplicate(self):
        specs = [("FMR LLC", "", "five_percent", "0", "1,000", "5.1"),
                 ("FMR LLC", "", "five_percent", "0", "1,000", "4.9")]
        self.assertEqual(self.counts(specs)["excess_identical"], 0)

    def test_identical_rows_in_different_filings_are_not_duplicates(self):
        one = ("FMR LLC", "Common", "five_percent", "0", "1,000", "5.1")
        d = DupExcess()
        d.add(("320193", "0001104659-18-000001"), dict(zip(self.FIELDS, one)))
        d.add(("789019", "0001104659-18-000002"), dict(zip(self.FIELDS, one)))
        self.assertEqual(d.excess(), {})


if __name__ == "__main__":
    unittest.main(verbosity=2)
