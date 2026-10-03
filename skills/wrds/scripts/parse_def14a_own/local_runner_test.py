#!/usr/bin/env python3
"""Runner transport tests; real parser/worker, isolated scoring sentinel."""

import gzip
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


class LocalRunnerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.runner = self.root / "runner"
        self.runner.mkdir()
        for name in ("run_baseline.sh", "gate_lib.sh", "gate.sh", "local_shards.sh"):
            if (HERE / name).exists():
                shutil.copy2(HERE / name, self.runner / name)
        shutil.copytree(HERE / "sge", self.runner / "sge")
        shutil.copytree(
            HERE / "parse_def14a_own_go",
            self.runner / "parse_def14a_own_go",
            ignore=shutil.ignore_patterns("parse_def14a_own_go"),
        )
        (self.runner / "scorer").mkdir()
        (self.runner / "scorer/score.py").write_text(
            'import sys\nprint("SCORE_SENTINEL", sys.argv[1:])\nsys.exit(1)\n'
        )
        self.gold = self.root / "gold"
        self.gold.mkdir()
        self.filings = self.root / "filings"
        self.filings.mkdir()
        html = """<html><body>
<p>Security Ownership of Certain Beneficial Owners and Management</p><table>
<tr><th>Name of Beneficial Owner</th><th>Amount and Nature of Beneficial Ownership</th><th>Percent of Class</th></tr>
<tr><td>Walton Enterprises, LLC</td><td>1,682,130,576</td><td>41.3%</td></tr>
<tr><td>All directors and executive officers as a group (23 persons)</td><td>1,700,000,000</td><td>41.8%</td></tr>
</table></body></html>"""
        lines = ""
        for i in range(10):
            accession = f"0000912057-00-{i:06d}"
            path = f"{accession}.txt"
            (self.filings / path).write_text(
                "<SEC-DOCUMENT>x\n<DOCUMENT>\n<TYPE>DEF 14A\n<TEXT>\n"
                + html
                + "\n</TEXT>\n</DOCUMENT>"
            )
            lines += f"{path}\t1750\t{accession}\tDEF 14A\t2000-08-28\tfixture\n"
        for name in (
            "round_filelist.tsv",
            "gold_filelist.tsv",
            "gold_iss_filelist.tsv",
            "sample_full.tsv",
            "regress_filelist.tsv",
        ):
            (self.gold / name).write_text(lines)
        self.bin = self.root / "commands"
        self.bin.mkdir()
        for name, body in (
            ("ssh", "echo GRID_TRANSPORT >&2; exit 91"),
            ("scp", "echo GRID_TRANSPORT >&2; exit 91"),
        ):
            p = self.bin / name
            p.write_text("#!/bin/bash\n" + body + "\n")
            p.chmod(0o755)
        self.env = dict(
            os.environ,
            PATH=str(self.bin) + ":" + os.environ["PATH"],
            GOLD_DIR=str(self.gold),
            DEF14A_WORK=str(self.root / "work"),
            DEF14A_FILINGS=str(self.filings),
            DEF14A_LOCAL_PROCESSES="2",
        )
        self.env.pop("DEF14A_LOCAL", None)

    def run_round(self, mode=None, args=()):
        if mode is not None:
            self.env["DEF14A_LOCAL"] = mode
        return subprocess.run(
            ["bash", str(self.runner / "run_baseline.sh"), *args],
            env=self.env,
            capture_output=True,
            text=True,
            check=False,
        )

    def rows(self, pattern):
        return sorted(
            line
            for p in (self.root / "work/out").glob(pattern)
            for line in gzip.open(p, "rt")
            if not line.startswith("accession")
        )

    def assert_local(self, result):
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertNotIn("GRID_TRANSPORT", result.stderr)
        self.assertIn("SCORE_SENTINEL", result.stdout)
        self.assertTrue((self.root / "work/out/round-ready").exists())
        self.assertEqual(len(self.rows("*.manifest.tsv.gz")), 10)
        self.assertGreater(len(self.rows("*[0-9].tsv.gz")), 0)
        state = json.loads((self.root / "work/out/round-state.json").read_text())
        self.assertEqual(state["phase"], "done")
        self.assertEqual(state["job_ids"], "")
        gate = subprocess.run(
            ["bash", str(self.runner / "gate.sh")],
            env=self.env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(gate.returncode, 0, gate.stdout + gate.stderr)

    def test_forced_local_and_repeat(self):
        result = self.run_round("1", ("--check",))
        self.assert_local(result)
        first = (self.rows("*[0-9].tsv.gz"), self.rows("*.manifest.tsv.gz"))
        self.assert_local(self.run_round("1"))
        self.assertEqual(
            first, (self.rows("*[0-9].tsv.gz"), self.rows("*.manifest.tsv.gz"))
        )
        self.assertIn("'--check'", result.stdout)

    def test_auto_local(self):
        self.assert_local(self.run_round())

    def test_auto_missing_falls_back_to_grid(self):
        self.env["DEF14A_FILINGS"] = str(self.root / "missing")
        result = self.run_round()
        self.assertEqual(result.returncode, 91, result.stdout + result.stderr)
        self.assertIn("GRID_TRANSPORT", result.stderr)

    def test_explicit_grid(self):
        result = self.run_round("0")
        self.assertEqual(result.returncode, 91, result.stdout + result.stderr)

    def test_fetch_only_remains_grid(self):
        result = self.run_round("1", ("--fetch-only",))
        self.assertEqual(result.returncode, 91, result.stdout + result.stderr)
        self.assertIn("skipping build/stage/submit", result.stdout)

    def test_forced_missing_fails_without_transport(self):
        self.env["DEF14A_FILINGS"] = str(self.root / "missing")
        result = self.run_round("1")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("GRID_TRANSPORT", result.stderr)
        self.assertIn("missing local filings", result.stderr)
        self.assertFalse((self.root / "work/out/round-ready").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
