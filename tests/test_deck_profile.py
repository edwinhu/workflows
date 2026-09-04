"""The `deck` profile: a Typst slide deck is AUDITED with a restricted ruleset, not skipped.

A deck legitimately breaks prose rhythm — it is bullets, not paragraphs — so the rhythm systems
are off. Provenance and correctness claims hold in any register, so those stay on.

  ON   scored-tic (corpus-gated AI tics), wikipedia-* (provenance leaks), style (stylometrics),
       spelling (US register)
  OFF  writing-* (domain style), diction (tiered substitution), em-dash (density budgets)
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIT = ROOT / "scripts" / "prose-audit.py"
FIXTURE = Path(__file__).parent / "fixtures" / "deck_profile_fixture.typ"
PY = ["uv", "run", "--with", "lxml", "--with", "pyyaml", "python3"]


def _audit(*args):
    r = subprocess.run([*PY, str(AUDIT), "--json", *args, str(FIXTURE)],
                       capture_output=True, text=True)
    assert r.returncode in (0, 1), (
        f"prose-audit.py --profile deck did not run (exit {r.returncode}).\n"
        f"stderr: {r.stderr[:600]}"
    )
    return json.loads(r.stdout)


def _systems(spans):
    out = set()
    for s in spans:
        for sy in (s.get("systems") or ([s["system"]] if s.get("system") else [])):
            out.add(sy)
    return out


def test_deck_profile_runs_at_all():
    """RED now: `deck` is not an accepted --profile, so argparse exits 2."""
    _audit("--profile", "deck")


def test_deck_profile_keeps_scored_tics():
    """'The selection is the argument.' is ai-tic sev2 the-x-is-the-y."""
    spans = _audit("--profile", "deck").get("spans", [])
    labels = " ".join(str(s.get("labels") or s.get("label", "")) for s in spans)
    assert "the-x-is-the-y" in labels, (
        "the deck profile must still catch corpus-gated AI tics; got systems "
        f"{sorted(_systems(spans))}"
    )


def test_deck_profile_keeps_spelling():
    """'organisation' is a British form; US register applies on a slide too."""
    spans = _audit("--profile", "deck").get("spans", [])
    assert "spelling" in _systems(spans)


def test_deck_profile_drops_rhythm_systems():
    """No writing-*, no diction, no em-dash density on a deck."""
    got = _systems(_audit("--profile", "deck").get("spans", []))
    banned = {s for s in got if s.startswith("writing-")} | (got & {"diction", "em-dash"})
    assert not banned, f"deck profile must not report rhythm systems; got {sorted(banned)}"


def test_full_profile_still_reports_everything():
    """The default profile is unchanged — this is an ADDITION, not a narrowing."""
    got = _systems(_audit().get("spans", []))
    assert got & {"em-dash"} or any(s.startswith("writing-") for s in got), (
        f"the full profile must still report rhythm systems; got {sorted(got)}"
    )
