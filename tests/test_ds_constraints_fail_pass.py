"""Every ds constraint reports a finding on a bad input and passes a good one.

Run: python3 -m pytest tests/test_ds_constraints_fail_pass.py -v

Each constraint runs through its real CLI (checks/ds/constraints/_contract.py). The bad input must
exit 1 with a finding that names the constraint; the good input must exit 0 having examined at
least one file or plan, so a constraint that quietly stops looking cannot pass as clean. A
constraint neutered to report nothing fails the bad half; one that scopes itself empty fails the
good half's examined count.
"""

import os
import re
import subprocess
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONSTRAINTS = os.path.join(ROOT, "checks", "ds", "constraints")
GATE = os.path.join(ROOT, "tests", "fixtures", "ds-gate")


def _read(*p):
    with open(os.path.join(*p), encoding="utf-8") as f:
        return f.read()


GATE_BAD, GATE_CLEAN = _read(GATE, "bad", "pipeline.py"), _read(GATE, "clean", "pipeline.py")

CEILING_OK = (
    "import requests\nfrom concurrent.futures import ThreadPoolExecutor\n"
    "# rate limit: 10 req/s, documented ceiling https://example.org/api-limits\n"
    "EFFECTIVE_RPS = 4 / 0.5\n"
    "with ThreadPoolExecutor(4) as ex:\n    ex.map(requests.get, urls)\n"
)
CEILING_BAD = (
    "import requests\nfrom concurrent.futures import ThreadPoolExecutor\n"
    "with ThreadPoolExecutor(4) as ex:\n    ex.map(requests.get, urls)\n"
)

# (constraint, input kind, bad body, good body, finding fragment)
CODE_CASES = [
    ("ds-chart-color",
     'import altair as alt\nalt.Chart(df).encode(\n    color=alt.Color("g:N", scale=alt.Scale(scheme="viridis")))\n',
     'import altair as alt\nalt.Chart(df).encode(\n    color=alt.Color("g:N", scale=alt.Scale(scheme="tableau10")))\n',
     "continuous scheme"),
    ("ds-determinism", "d = df.sample(n=5)\n", "d = df.sample(n=5, random_state=0)\n", "sample"),
    ("ds-error-handling", GATE_BAD, GATE_CLEAN, "dropna"),
    ("ds-idempotency",
     'df.to_sql("t", con, if_exists="append")\n', 'df.to_sql("t", con, if_exists="replace")\n', "append"),
    ("ds-join-audits", GATE_BAD, GATE_CLEAN, "merge"),
    ("ds-network-politeness", CEILING_BAD, CEILING_OK, "rate"),
    ("ds-robustness-checks",
     "import statsmodels.api as sm\nm = sm.OLS(y, X)\nr = m.fit(cov_type='HC3')\n",
     "import statsmodels.api as sm\nm = sm.OLS(y, X)\nr = m.fit(cov_type='HC3')\n# placebo: shuffle the treatment\n",
     "robustness"),
    ("ds-schema-contracts", GATE_BAD, GATE_CLEAN, "schema contract"),
    ("ds-standard-error-spec",
     "import statsmodels.api as sm\nm = sm.OLS(y, X)\nr = m.fit()\n",
     "import statsmodels.api as sm\nm = sm.OLS(y, X)\nr = m.fit(cov_type='HC3')\n",
     "cov_type"),
    ("ds-table-figure-pairing",
     'tbl.to_latex("t.tex")\n', 'tbl.to_latex("t.tex")\nplt.savefig("f.png")\n', "companion figure"),
    ("ds-visualization-integrity",
     "ax2 = ax.twinx()\n", "fig, axes = plt.subplots(2, 1)\nax.set_ylim(0, 10)\n", "twinx"),
]

PLAN_CASES = [
    ("ds-data-pull-profile",
     "# Plan\nPull the full universe, about 150M rows of trades.\n",
     ("# Plan\nPull the full universe, about 150M rows of trades.\n\n## Data Pull Profile\n"
      "| Source | Raw rows | Aggregate | Ratio | Recommend |\nSee docs/investigations/2026-01-01_pull_profile.md\n"),
     "Data Pull Profile"),
    ("ds-external-skill-discovery",
     "# Plan\nFetch with the wrds skill.\n",
     "# Plan\nFetch with the wrds skill.\n\n## External Skill Discovery\nGlob skills/wrds/examples/: ADOPT.\n",
     "External Skill Discovery"),
]


def _run(constraint, project, *, files=None, plan=None):
    cmd = [sys.executable, os.path.join(CONSTRAINTS, constraint + ".py"), "--project-dir", str(project)]
    if files:
        cmd += ["--files", *map(str, files)]
    if plan:
        cmd += ["--plan", str(plan)]
    return subprocess.run(cmd, capture_output=True, text=True, timeout=60, check=False)


def _examined(r):
    m = re.match(r"^[\w-]+: (\d+) ", r.stdout)
    assert m, f"no leg-count first line:\n{r.stdout}{r.stderr}"
    return int(m.group(1))


@pytest.mark.parametrize("name,bad,good,fragment", CODE_CASES, ids=[c[0] for c in CODE_CASES])
def test_code_constraint_flags_bad_and_passes_good(tmp_path, name, bad, good, fragment):
    (tmp_path / "bad").mkdir()
    (tmp_path / "good").mkdir()
    (tmp_path / "bad" / "p.py").write_text(bad)
    (tmp_path / "good" / "p.py").write_text(good)
    rb = _run(name, tmp_path, files=[tmp_path / "bad" / "p.py"])
    assert rb.returncode == 1, f"{name} must flag the bad input:\n{rb.stdout}{rb.stderr}"
    assert _examined(rb) >= 1
    assert re.search(r"p\.py[:\s]", rb.stdout) and fragment in rb.stdout, rb.stdout
    rg = _run(name, tmp_path, files=[tmp_path / "good" / "p.py"])
    assert rg.returncode == 0, f"{name} must pass the good input:\n{rg.stdout}{rg.stderr}"
    assert _examined(rg) >= 1, f"{name} examined nothing on the good input:\n{rg.stdout}"


@pytest.mark.parametrize("name,bad,good,fragment", PLAN_CASES, ids=[c[0] for c in PLAN_CASES])
def test_plan_constraint_flags_bad_and_passes_good(tmp_path, name, bad, good, fragment):
    pb, pg = tmp_path / "bad.md", tmp_path / "good.md"
    pb.write_text(bad)
    pg.write_text(good)
    rb = _run(name, tmp_path, plan=pb)
    assert rb.returncode == 1, f"{name} must flag the bad plan:\n{rb.stdout}{rb.stderr}"
    assert _examined(rb) >= 1 and fragment in rb.stdout, rb.stdout
    rg = _run(name, tmp_path, plan=pg)
    assert rg.returncode == 0, f"{name} must pass the good plan:\n{rg.stdout}{rg.stderr}"
    assert _examined(rg) >= 1, rg.stdout
