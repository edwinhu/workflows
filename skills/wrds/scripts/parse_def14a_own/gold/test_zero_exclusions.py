"""X10-X13 use old-row fields only; each conjunction has negative controls."""
import unittest

from build_regress_set import lost_d_exclusion_flags, lost_exclusion_flags, zero_row_exclusion_flags


class ZeroExclusionTests(unittest.TestCase):
    def row(self, name="Jane Smith", shares="1234", percent="", table="1", kind="combined", share_class=""):
        return {"holder_name": name, "shares": shares, "percent": percent,
                "table_index": table, "table_kind": kind, "share_class": share_class}

    def repeated(self):
        return [self.row(name, shares, table=str(table))
                for table in range(3)
                for name, shares in [("Jane Smith", "1234"), ("John Doe", "5678")]]

    def test_x10_repeated_compensation(self):
        self.assertEqual(zero_row_exclusion_flags(self.repeated()), (1, 0, 0, 0))

    def test_x10_each_conjunct_required(self):
        for field, value in [("percent", "0"), ("share_class", "Common"), ("table_kind", "management")]:
            rows = self.repeated()
            rows[0][field] = value
            with self.subTest(field=field):
                self.assertEqual(zero_row_exclusion_flags(rows), (0, 0, 0, 0))
        rows = self.repeated()
        for row in rows:
            row["table_index"] = "1"
        self.assertEqual(zero_row_exclusion_flags(rows), (0, 0, 0, 0))
        rows = self.repeated()
        rows[-1]["shares"] = "5679"
        self.assertEqual(zero_row_exclusion_flags(rows), (0, 0, 0, 0))
        rows = [r for r in self.repeated() if r["holder_name"] == "Jane Smith"]
        self.assertEqual(zero_row_exclusion_flags(rows), (0, 0, 0, 0))

    def test_x11_exact_normalized_names(self):
        rows = [self.row("  FUND "), self.row("Entities   N/A")]
        self.assertEqual(zero_row_exclusion_flags(rows), (0, 1, 0, 0))
        self.assertEqual(zero_row_exclusion_flags(rows + [self.row("Jane Smith")]), (0, 0, 0, 0))
        self.assertEqual(zero_row_exclusion_flags(rows[:1]), (0, 0, 0, 0))

    def test_x12_all_named_prefixes(self):
        for name in ["Allocation of Income/Loss", "Allocation of Income or Loss", "Reimbursements to General Partners", "Property management fees paid", "Rental income", "Interest income"]:
            with self.subTest(name=name):
                self.assertEqual(zero_row_exclusion_flags([self.row(name + " (1998)")]), (0, 0, 1, 0))
                self.assertEqual(zero_row_exclusion_flags([self.row("Jane " + name)]), (0, 0, 0, 0))

    def test_x13_integer_year_and_single_row(self):
        for year in ["1900", "1998", "2000"]:
            self.assertEqual(zero_row_exclusion_flags([self.row("The Company purchased shares", year)]), (0, 0, 0, 1))
        self.assertEqual(zero_row_exclusion_flags([self.row("The Company  purchased shares", "1987")]), (0, 0, 0, 1))
        for shares in ["1899", "2001", "1998.5", "", "1998.0"]:
            self.assertEqual(zero_row_exclusion_flags([self.row("The Company purchased shares", shares)]), (0, 0, 0, 0))
        self.assertEqual(zero_row_exclusion_flags([self.row("The Company purchased shares", "1998"), self.row()]), (0, 0, 0, 0))
        self.assertEqual(zero_row_exclusion_flags([self.row("Jane: The Company purchased shares", "1998")]), (0, 0, 0, 0))

    def test_percent_including_zero_blocks_all_rules(self):
        fixtures = [self.repeated(), [self.row("Fund"), self.row("Entities N/A")],
                    [self.row("Rental income")], [self.row("The Company purchased shares", "1998")]]
        for rows in fixtures:
            rows[0]["percent"] = "0"
            self.assertEqual(zero_row_exclusion_flags(rows), (0, 0, 0, 0))

    def test_empty_rows(self):
        self.assertEqual(zero_row_exclusion_flags([]), (0, 0, 0, 0))


class LostExclusionTests(unittest.TestCase):
    """X14-X20 (set (c), 2026-10-01): old-row fields only; each has a real-table control."""

    def row(self, name="Jane Smith", shares="12345", percent="1.2"):
        return {"holder_name": name, "shares": shares, "percent": percent}

    def flags(self, rows):
        return dict(zip(["x14", "x15", "x16", "x17", "x18", "x19", "x20"], lost_exclusion_flags(rows)))

    def test_real_ownership_table_fires_nothing(self):
        rows = [self.row("Jane Smith", "120000", "5.1"), self.row("John Doe", "8000", ""),
                self.row("All directors and executive officers as a group", "300000", "12.4")]
        self.assertEqual(lost_exclusion_flags(rows), (0,) * 7)
        self.assertEqual(lost_exclusion_flags([]), (0,) * 7)

    def test_x14_year_as_shares(self):
        self.assertEqual(self.flags([self.row("Director since", "1998", ""), self.row("Age", "54", "")])["x14"], 1)
        self.assertEqual(self.flags([self.row("Jane Smith", "1998", ""), self.row("John Doe", "50000", "")])["x14"], 0)

    def test_x15_percent_only(self):
        self.assertEqual(self.flags([self.row("of the outstanding shares", "", "5")])["x15"], 1)
        self.assertEqual(self.flags([self.row(shares="", percent="5")] * 3)["x15"], 0)

    def test_x16_small_int_needs_no_percent_and_positive(self):
        self.assertEqual(self.flags([self.row("Board met", "7", "")])["x16"], 1)
        self.assertEqual(self.flags([self.row("Board met", "7", "1")])["x16"], 0)
        self.assertEqual(self.flags([self.row("Fund A", "0", "")])["x16"], 0)

    def test_x17_no_values(self):
        self.assertEqual(self.flags([self.row("Vote FOR", "", "")])["x17"], 1)
        self.assertEqual(self.flags([self.row("Vote FOR", "", ""), self.row(shares="10", percent="")])["x17"], 0)

    def test_x18_every_name_prose_lead(self):
        self.assertEqual(self.flags([self.row("1 As of March 1, 2005"), self.row("Includes 500 options")])["x18"], 1)
        self.assertEqual(self.flags([self.row("As of March 1"), self.row("Jane Smith")])["x18"], 0)
        self.assertEqual(self.flags([self.row("Onan Smith")])["x18"], 0)

    def test_x19_function_word_tail(self):
        self.assertEqual(self.flags([self.row("shares held of record by")])["x19"], 1)
        self.assertEqual(self.flags([self.row("shares held of record by"), self.row("Jane Smith")])["x19"], 0)

    def test_x20_titles_and_since_guard(self):
        rows = [self.row("Chief Executive Officer 2004", "450000", ""), self.row("Jane Smith", "1000", ""),
                self.row("John Doe", "900", "")]
        self.assertEqual(self.flags(rows)["x20"], 1)
        self.assertEqual(self.flags([dict(r, percent="1") for r in rows])["x20"], 0)
        bios = [self.row("Joseph L. May 67 Attorney in private practice since 1984", "0", ""),
                self.row("Jane Smith", "100", ""), self.row("John Doe", "200", "")]
        self.assertEqual(self.flags(bios)["x20"], 0)


class LostDExclusionTests(unittest.TestCase):
    """X21-X23 (set (d), 2026-10-01): old-row fields only; fixtures are set-(d) old-row shapes."""

    def row(self, name="Jane Smith", shares="12345", percent=""):
        return {"holder_name": name, "shares": shares, "percent": percent}

    def test_real_ownership_table_fires_nothing(self):
        rows = [self.row("Jane Smith", "120000", "5.1"), self.row("John Doe", "8000", ""),
                self.row("All directors and executive officers as a group", "300000", "12.4")]
        self.assertEqual(lost_d_exclusion_flags(rows), (0, 0, 0))
        self.assertEqual(lost_d_exclusion_flags([]), (0, 0, 0))

    def test_x21_term_of_office(self):
        rows = [self.row("James B. Hawkes Vice Until 2004.", "196"),
                self.row("Samuel L. Hayes, III Class II Until 2004. Jacob H. Schiff Professor", "196")]
        self.assertEqual(lost_d_exclusion_flags(rows)[0], 1)
        self.assertEqual(lost_d_exclusion_flags(rows[:1])[0], 0)
        self.assertEqual(lost_d_exclusion_flags([dict(rows[0], percent="1"), rows[1]])[0], 0)
        self.assertEqual(lost_d_exclusion_flags([rows[0], self.row("Jane Smith", "500")])[0], 0)
        self.assertEqual(lost_d_exclusion_flags([self.row("Classic Fund Trust"), self.row("Class Ivy LLC")])[0], 0)

    def test_x22_holding_verb(self):
        self.assertEqual(lost_d_exclusion_flags([self.row("W&MLLP receives", "96000")])[1], 1)
        self.assertEqual(lost_d_exclusion_flags([self.row("Scott D. Malkin owns of record and beneficially", "33334")])[1], 1)
        self.assertEqual(lost_d_exclusion_flags([self.row("W&MLLP receives", "96000", "2.1")])[1], 0)
        self.assertEqual(lost_d_exclusion_flags([self.row("W&MLLP receives")] * 3)[1], 0)
        self.assertEqual(lost_d_exclusion_flags([self.row("Holdsworth Partners")])[1], 0)

    def test_x23_none_cell(self):
        rows = [self.row("Millard Handley Pryor, None", "100000"), self.row("John Kelley Springer None", "", "1")]
        self.assertEqual(lost_d_exclusion_flags(rows)[2], 1)
        self.assertEqual(lost_d_exclusion_flags([self.row("Millard Pryor, None", "100000", "1")])[2], 0)
        self.assertEqual(lost_d_exclusion_flags([rows[0], self.row("Jane Smith", "500")])[2], 0)
        self.assertEqual(lost_d_exclusion_flags([self.row("Nonesuch Holdings", "500")])[2], 0)


if __name__ == "__main__":
    unittest.main()
