#!/usr/bin/env python3
"""score_test.py — tests for the (v) ISS name matcher and person test.

Stdlib unittest, no fixtures on disk. Every ISS string below is a real value read
out of gold_iss_all.tsv.gz; every proxy string is the form the parser emits for
the same person.

    python3 scorer/score_test.py
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from score import era_of, looks_like_person, person_key  # noqa: E402


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


if __name__ == "__main__":
    unittest.main(verbosity=2)
