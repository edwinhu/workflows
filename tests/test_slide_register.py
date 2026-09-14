"""The `slide-register` system: DECK-ONLY, and advisory by construction.

The craft lens `prose-register` judges slide prose for meta-label bullets and mannered prose. This
is the small DECIDABLE subset of that category — bullets that announce what follows, or that talk
about the deck and the room instead of stating the thing.

  ON   only under `--profile deck`. "The answer:" is unremarkable in a memo; only a slide makes it
       a defect, so `full` and `de-ai` must never see this system.
  SOFT always. Measured precision on a real cleaned deck is poor (see the module comment in
       prose-audit.py) and `hard` in that script means "no false positives".

The `full`-is-unchanged test is the regression that matters most: the golden was captured from the
script BEFORE this system existed.
"""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIT = ROOT / "scripts" / "prose-audit.py"
FIXTURE = Path(__file__).parent / "fixtures" / "slide_register_fixture.typ"
GOLDEN = Path(__file__).parent / "fixtures" / "slide_register_full_spans.json"
PY = ["uv", "run", "--with", "lxml", "--with", "pyyaml", "python3"]


def _audit(*args):
    r = subprocess.run([*PY, str(AUDIT), "--json", *args, str(FIXTURE)],
                       capture_output=True, text=True)
    assert r.returncode in (0, 1), (
        f"prose-audit.py did not run (exit {r.returncode}).\nstderr: {r.stderr[:600]}")
    return json.loads(r.stdout)


def _register_spans(spans):
    return [s for s in spans
            if "slide-register" in (s.get("systems") or [s.get("system", "")])]


def _labels(spans):
    return " ".join(lab for s in spans for lab in (s.get("labels") or []))


def test_full_profile_output_is_unchanged():
    """THE regression. The golden is the pre-change span list over the same fixture."""
    got = _audit("--profile", "full").get("spans", [])
    assert got == json.loads(GOLDEN.read_text()), (
        "the full profile is frozen behaviour — adding a deck-only system must not move it")


def test_room_talk_fires_on_a_deck():
    labels = _labels(_register_spans(_audit("--profile", "deck").get("spans", [])))
    assert "slide-register·room-talk" in labels, labels


def test_announce_fires_on_a_deck():
    labels = _labels(_register_spans(_audit("--profile", "deck").get("spans", [])))
    assert "slide-register·announce" in labels, labels


def test_deictic_fires_on_a_deck():
    labels = _labels(_register_spans(_audit("--profile", "deck").get("spans", [])))
    assert "slide-register·deictic" in labels, labels


def test_nothing_fires_under_full():
    got = _register_spans(_audit("--profile", "full").get("spans", []))
    assert not got, f"slide-register is deck-only; got {_labels(got)}"


def test_nothing_fires_under_de_ai():
    """`--profile de-ai` emits the rewrite worklist, not the span list — it must stay clean too."""
    out = _audit("--profile", "de-ai")
    blob = json.dumps(out)
    assert "slide-register" not in blob


def test_typst_line_comments_are_exempt():
    """Provenance and instructor scaffolding live in `//` comments; a finding there is an FP by
    construction. The fixture repeats two would-be hits behind `//`."""
    spans = _register_spans(_audit("--profile", "deck").get("spans", []))
    comment_lines = [i for i, ln in enumerate(FIXTURE.read_text().split("\n"), 1)
                     if ln.lstrip().startswith("//")]
    assert comment_lines, "fixture must carry `//` lines"
    hit = [s["line"] for s in spans if s["line"] in comment_lines]
    assert not hit, f"findings inside `//` comments: lines {hit}"


def test_a_url_line_is_not_mangled_and_still_audits():
    """`//` masking must be line-anchored only — `https://example.com` is not a comment. The line
    carries a British spelling, so its survival is observable."""
    spans = _audit("--profile", "deck").get("spans", [])
    url_line = next(i for i, ln in enumerate(FIXTURE.read_text().split("\n"), 1)
                    if "https://example.com" in ln)
    on_line = [s for s in spans if s["line"] == url_line]
    assert any("spelling·british" in lab for s in on_line for lab in s["labels"]), (
        f"the URL line must still audit normally; got {on_line}")
    assert not _register_spans(on_line), "no register finding is due on the URL line"


def test_every_finding_is_soft():
    """`hard` means 'no false positives'. These rules do not qualify and may never block a gate."""
    spans = _register_spans(_audit("--profile", "deck").get("spans", []))
    assert spans, "expected findings to check the severity of"
    assert all(s["severity"] == "soft" for s in spans), spans
