"""Guarded set-(b) rules must not exclude a real group ownership table."""
import tempfile
import unittest
from pathlib import Path

from build_regress_set import group_source_flags


class GroupExclusionTests(unittest.TestCase):
    def classify(self, rows, source):
        with tempfile.TemporaryDirectory() as root:
            Path(root, "source.txt").write_text(source)
            return group_source_flags((("1", "accession"), rows, "source.txt", [root]))[1]

    def row(self, name, shares="", percent=""):
        return {"holder_name": name, "shares": shares, "percent": percent}

    def test_grant_zero_and_share_only(self):
        rows = [self.row("All directors as a group", percent="0"),
                self.row("All officers as a group", shares="1000")]
        source = "<table><tr><td>Name</td><td>Number of Shares Underlying Options Grants</td></tr><tr><td>All directors as a group</td><td>10</td></tr></table>"
        self.assertEqual(self.classify(rows, source), (1, 0, 0))

    def test_missing_old_shares_is_not_exclusion(self):
        rows = [self.row("As a Group", percent="0.04")]
        source = "<table><tr><td>As a Group:</td><td>Bond Fund</td><td>0.04%</td><td>2,103</td></tr></table>"
        self.assertEqual(self.classify(rows, source), (0, 0, 0))

    def test_true_zero_group_stays(self):
        rows = [self.row("All trustees as a group", "0", "0")]
        source = "<table><tr><td>Name</td><td>Shares Owned</td><td>Percent</td></tr><tr><td>All trustees as a group</td><td>0</td><td>0%</td></tr></table>"
        self.assertEqual(self.classify(rows, source), (0, 0, 0))

    def test_class_column_not_holder_column(self):
        rows = [self.row("Individual Investor", "100", "10")]
        source = "<table><tr><td>Share Class</td><td>Name and Address</td></tr><tr><td>Individual Investor</td><td>Jane Smith</td></tr></table>"
        self.assertEqual(self.classify(rows, source), (0, 1, 0))
        self.assertEqual(self.classify(rows, source.replace("Share Class", "Name")), (0, 0, 0))

    def test_position_column_and_prose_guard(self):
        rows = [self.row("Director of Bank", "100", "10")]
        source = "<p>All directors and executive officers as a group owned 100 shares or 10%.</p><table><tr><td>Position</td><td>Name of Beneficial Owner</td></tr><tr><td>Director of Bank</td><td>Jane Smith</td></tr></table>"
        self.assertEqual(self.classify(rows, source), (0, 0, 1))
        self.assertEqual(self.classify(rows, source.replace("as a group owned", "each owned")), (0, 0, 0))


if __name__ == "__main__":
    unittest.main()
