"""Contract tests for bin/review-check-deck (scripts/lib/review_check_deck.py), review-ledger's deck change check.

Run: uv run --with pytest --with pymupdf --with lxml python3 -m pytest tests/review_check_deck_test.py -q

Ported from teaching's tests/test_review_verify.py (the semantics are teaching's), onto the path a review takes
here: synthetic slides and notes PDFs, a real Ink annotation with a typed note on the marked copy, `review-ledger
ledger` reading it through doc-marks, then `review-ledger verify --check-cmd "review_check_deck.py ..."`.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
LEDGER = ROOT / "scripts" / "lib" / "review_ledger.py"
MODULE = ROOT / "scripts" / "lib" / "review_check_deck.py"
LAUNCHER = ROOT / "bin" / "review-check-deck"

COPY = "Lecture 27 slides review 20261027a.pdf"
NOTES_COPY = "Lecture 27 notes review 20261027a.pdf"
OLD = [{"title": "Alpha.", "body": "issuers face strict liability"},
       {"title": "Beta.", "body": "tracing replaces reliance here"},
       {"title": "Gamma.", "body": "damages are capped by price"},
       {"title": "Delta.", "body": "underwriters may show due diligence"}]


# ── fixtures (teaching's tests/review_fixture.py shapes) ─────────────────────

def make_slides(path: Path, slides: list[dict]) -> Path:
    """One page per slide dict {title, body, color, builds, date}: a footer counter "n / N", one outline entry per slide."""
    doc, toc = pymupdf.open(), []
    for n, s in enumerate(slides, 1):
        for _ in range(s.get("builds", 1)):
            page = doc.new_page(width=842, height=474)
            page.insert_text((44, 22), "1.2. Running Header", fontsize=12)
            page.insert_text((44, 80), s["title"], fontsize=20)
            page.insert_text((44, 160), s["body"], fontsize=16, color=s.get("color", (0, 0, 0)))
            page.insert_text((44, 468), s.get("date", "2026-10-27"), fontsize=8)
            page.insert_text((760, 468), f"{n} / {len(slides)}", fontsize=8)
        toc.append([1, s["title"], doc.page_count])
    doc.set_toc(toc)
    doc.save(path)
    return path


def make_notes(path: Path, entries: list[tuple]) -> Path:
    """Per (slide title, text) a `NEXT SLIDE (title)` heading at outline level 1; per (heading, text, level) the heading
    verbatim at that level."""
    doc, toc = pymupdf.open(), []
    page, y = doc.new_page(width=595, height=842), 90
    for title, text, *level in entries:
        if y > 700:
            page, y = doc.new_page(width=595, height=842), 90
        head = title if level else f"NEXT SLIDE ({title})"
        page.insert_text((72, y), head, fontsize=11)
        toc.append([level[0] if level else 1, head, doc.page_count])
        page.insert_text((72, y + 30), text, fontsize=10)
        y += 90
    doc.set_toc(toc)
    doc.save(path)
    return path


def ink(path: Path, page: int, y: float, note: str = "fix this") -> None:
    """The tablet's mark: one Ink annotation carrying a typed note, as Xodo saves it."""
    doc = pymupdf.open(path)
    a = doc[page - 1].add_ink_annot([[(72, y), (200, y + 6), (300, y + 2)]])
    a.set_info(content=note)
    a.update()
    tmp = path.with_suffix(".tmp.pdf")
    doc.save(tmp)
    doc.close()
    tmp.replace(path)


def damage_contents(path: Path) -> Path:
    """Mangle every uncompressed page content stream's `endstream`: pages open, and reading text makes MuPDF report."""
    doc = pymupdf.open(path)
    xrefs = [x for page in doc for x in page.get_contents() if "/Filter" not in doc.xref_object(x)]
    doc.close()
    data = path.read_bytes()
    for x in xrefs:
        j = data.index(b"endstream", re.search(rb"(?<!\d)%d 0 obj" % x, data).start())
        data = data[:j] + b"endstr   " + data[j + 9:]
    path.write_bytes(data)
    return path


def ledger(tmp_path: Path, copies: list[Path]) -> tuple[Path, list[str]]:
    p = subprocess.run([sys.executable, str(LEDGER), "ledger", *map(str, copies), "--json", "--png-dir",
                        str(tmp_path / "png")], capture_output=True, text=True, check=False)
    assert p.returncode == 0, p.stderr
    path = tmp_path / "ledger.json"
    path.write_text(p.stdout, encoding="utf-8")
    return path, [r["id"] for r in json.loads(p.stdout)["marks"]]


def verify(tmp_path: Path, ledger_path: Path, outcomes: dict, deck: Path, vault: Path, *check: str):
    out = tmp_path / "outcomes.json"
    out.write_text(json.dumps(outcomes), encoding="utf-8")
    cmd = f'{sys.executable} "{MODULE}" --deck "{deck}" --copies-dir "{vault}"' + "".join(f' "{c}"' for c in check)
    p = subprocess.run([sys.executable, str(LEDGER), "verify", "--ledger", str(ledger_path), "--outcomes", str(out),
                        "--check-cmd", cmd, "--json"], capture_output=True, text=True, check=False)
    return p.returncode, (json.loads(p.stdout) if p.stdout.strip() else None), p.stderr


def only(res):
    [r] = res["results"]
    return r


def on_page(reason: str, n: int) -> bool:
    return re.search(rf"\bpage {n}\b", reason) is not None


def case(tmp_path, new, marked_page=2, old=OLD, outcome=None, check=(), copy=COPY):
    """The marked copy is `old` with an Ink mark on `marked_page`; the new build is `new`."""
    vault = tmp_path / "vault"
    vault.mkdir(exist_ok=True)
    marked = make_slides(vault / copy, old)
    ink(marked, marked_page, 150)
    deck = make_slides(tmp_path / "new.pdf", [{**s, "date": "2026-10-28"} for s in new])
    led, ids = ledger(tmp_path, [marked])
    [i] = ids
    return verify(tmp_path, led, {i: outcome or {"outcome": "applied", "note": ""}}, deck, vault, *check)


# ── slides ────────────────────────────────────────────────────────────────────

def test_applied_but_unchanged_fails(tmp_path):
    rc, res, err = case(tmp_path, OLD)
    assert rc == 1, err
    assert only(res)["status"] == "FAIL" and "unchanged" in only(res)["reason"] and on_page(only(res)["reason"], 2)


def test_applied_text_change_passes(tmp_path):
    new = [OLD[0], {"title": "Beta.", "body": "tracing replaces reliance here, now with a callout"}, *OLD[2:]]
    rc, res, err = case(tmp_path, new)
    assert rc == 0, (err, res)
    assert only(res)["status"] == "PASS" and "text changed" in only(res)["reason"]


def test_applied_colour_only_change_passes(tmp_path):
    rc, res, err = case(tmp_path, [OLD[0], {**OLD[1], "color": (0.8, 0.1, 0.1)}, *OLD[2:]])
    assert rc == 0, (err, res)
    assert "rendering changed" in only(res)["reason"]


def test_applied_slide_removed_passes(tmp_path):
    rc, res, err = case(tmp_path, [OLD[0], *OLD[2:]])
    assert rc == 0, (err, res)
    assert "gone" in only(res)["reason"]


def test_applied_slide_moved_passes(tmp_path):
    rc, res, err = case(tmp_path, [OLD[0], OLD[2], OLD[1], OLD[3]])
    assert rc == 0, (err, res)
    assert "moved" in only(res)["reason"]


def test_insertions_and_cuts_elsewhere_do_not_count_as_a_move(tmp_path):
    rc, res, _ = case(tmp_path, [{"title": "New.", "body": "inserted"}, OLD[1], OLD[3]])
    assert rc == 1 and only(res)["status"] == "FAIL"


def test_renumbering_alone_is_not_a_change(tmp_path):
    old = [{"title": "Discussion Questions 2 of 3", "body": "2. Why trace?"}, *OLD]
    new = [{"title": "Discussion Questions 1 of 2", "body": "1. Why trace?"}, *OLD]
    rc, res, _ = case(tmp_path, new, marked_page=1, old=old)
    assert rc == 1 and only(res)["status"] == "FAIL"


def test_at_points_to_a_slide_added_elsewhere(tmp_path):
    new = [*OLD, {"title": "Krim v. pcOrder.", "body": "most circuits require strict tracing"}]
    rc, res, err = case(tmp_path, new, outcome={"outcome": "applied", "note": "", "at": "Krim v. pcOrder"})
    assert rc == 0, (err, res)
    assert on_page(only(res)["reason"], 5)


def test_at_text_missing_from_the_build_fails(tmp_path):
    rc, res, _ = case(tmp_path, OLD, outcome={"outcome": "applied", "note": "", "at": "Krim"})
    assert rc == 1 and "no slide in the new build" in only(res)["reason"]


def test_deck_pages_reduce_to_final_builds(tmp_path):
    new = [{"title": "Other lecture.", "body": "x"}, OLD[0], {**OLD[1], "builds": 3}, *OLD[2:]]
    rc, res, _ = case(tmp_path, new, check=("--pages", "2-7"))
    assert rc == 1 and on_page(only(res)["reason"], 5)  # the last of Beta's builds, deck pages 3-5


DQ_OLD = [OLD[0], {"title": "Discussion Questions 1 of 2", "body": "1. Why trace shares?"}, OLD[1], OLD[2],
          {"title": "Discussion Questions 2 of 2", "body": "2. What mischief do direct listings allow?"}, OLD[3]]


def test_at_on_a_moved_slide_sharing_its_title_passes_by_the_move_rule(tmp_path):
    new = [DQ_OLD[0], DQ_OLD[1], DQ_OLD[4], DQ_OLD[2], DQ_OLD[3], DQ_OLD[5]]
    rc, res, err = case(tmp_path, new, marked_page=5, old=DQ_OLD,
                        outcome={"outcome": "applied", "note": "", "at": "Discussion Questions 2 of 2"})
    assert rc == 0, (err, res)
    assert "moved" in only(res)["reason"] and on_page(only(res)["reason"], 3)


def test_at_on_an_unmoved_unchanged_slide_sharing_its_title_still_fails(tmp_path):
    rc, res, _ = case(tmp_path, DQ_OLD, marked_page=5, old=DQ_OLD,
                      outcome={"outcome": "applied", "note": "", "at": "Discussion Questions 2 of 2"})
    assert rc == 1 and "unchanged" in only(res)["reason"]


# ── notes ─────────────────────────────────────────────────────────────────────

ENTRIES = [("Alpha.", "alpha notes"), ("Beta.", "beta notes"), ("Gamma.", "gamma notes")]


def notes_case(tmp_path, new_text, copy=COPY, notes_copy=NOTES_COPY, target="notes", new_slides=OLD):
    vault = tmp_path / "vault"
    vault.mkdir()
    marked = make_slides(vault / copy, OLD)
    ink(marked, 2, 150)
    make_notes(vault / notes_copy, ENTRIES)
    deck = make_slides(tmp_path / "new.pdf", new_slides)
    notes = make_notes(tmp_path / "new-notes.pdf", [(t, new_text if t == "Beta." else x) for t, x in ENTRIES])
    led, [i] = ledger(tmp_path, [marked])
    return verify(tmp_path, led, {i: {"outcome": "applied", "note": "", "target": target}}, deck, vault,
                  "--notes", str(notes))


def test_notes_target_unchanged_entry_fails(tmp_path):
    rc, res, _ = notes_case(tmp_path, "beta notes")
    assert rc == 1 and "notes entry unchanged" in only(res)["reason"]


def test_notes_target_changed_entry_passes(tmp_path):
    rc, res, err = notes_case(tmp_path, "beta notes: whenever the registration statement updates, liability resets")
    assert rc == 0, (err, res)
    assert "notes entry changed" in only(res)["reason"]


def test_a_workshop_named_pair_checks_both_targets(tmp_path):
    new = [OLD[0], {"title": "Beta.", "body": "tracing replaces reliance here, now with a callout"}, *OLD[2:]]
    rc, res, err = notes_case(tmp_path, "beta notes, rewritten for the seminar audience",
                              copy="CELS talk slides review 20261030a.pdf",
                              notes_copy="CELS talk notes review 20261030a.pdf", target="both", new_slides=new)
    assert rc == 0, (err, res)
    reason = only(res)["reason"]
    assert "text changed" in reason and "notes entry changed" in reason and "; " in reason


NOTES_OLD = [("Recap", "last class we covered shelf registration", 1),
             ("Motivating Hypothetical", "intertelly plans an ipo", 1)]
TODAY = [("October 29, 2026", "", 1), ("NEXT SLIDE (Capitol Account card)", "banks take aim at the fraud penalty", 2)]


def notes_at_case(tmp_path, new_entries, at):
    """A mark on the notes copy inside the Recap entry; the fix landed in another section named by `at`."""
    vault = tmp_path / "vault"
    vault.mkdir()
    make_slides(vault / COPY, OLD)
    marked = make_notes(vault / NOTES_COPY, NOTES_OLD)
    ink(marked, 1, 122)
    deck = make_slides(tmp_path / "new.pdf", OLD)
    notes = make_notes(tmp_path / "new-notes.pdf", new_entries)
    led, [i] = ledger(tmp_path, [marked])
    return verify(tmp_path, led, {i: {"outcome": "applied", "note": "", "at": at}}, deck, vault, "--notes", str(notes))


def test_notes_at_names_a_new_section_after_the_unchanged_marked_entry(tmp_path):
    rc, res, err = notes_at_case(tmp_path, [NOTES_OLD[0], *TODAY, NOTES_OLD[1]], "October 29, 2026")
    assert rc == 0, (err, res)
    assert "october 29, 2026" in only(res)["reason"].lower()


def test_notes_at_section_unchanged_from_the_marked_copy_fails(tmp_path):
    rc, res, _ = notes_at_case(tmp_path, NOTES_OLD, "Motivating Hypothetical")
    assert rc == 1 and "unchanged" in only(res)["reason"]


def test_notes_at_heading_missing_from_the_build_fails(tmp_path):
    rc, res, _ = notes_at_case(tmp_path, NOTES_OLD, "October 29, 2026")
    assert rc == 1 and "no notes entry in the new build" in only(res)["reason"]


# ── robustness and the could-not-run contract ─────────────────────────────────

def test_a_damaged_deck_keeps_mupdf_off_stdout(tmp_path):
    """MuPDF's reports on a damaged deck go to stderr: with its default channel pointed at stdout, stdout still
    carries exactly the one reason line review-ledger reads."""
    vault = tmp_path / "vault"
    vault.mkdir()
    make_slides(vault / COPY, OLD)
    deck = damage_contents(make_slides(tmp_path / "new.pdf", OLD))
    p = subprocess.run([sys.executable, str(MODULE), "--deck", str(deck), "--copies-dir", str(vault)],
                       input=json.dumps({"mark": mark_row(), "outcome": {"outcome": "applied", "note": ""}}),
                       capture_output=True, text=True, check=False, env={**os.environ, "PYMUPDF_MESSAGE": "fd:1"})
    assert p.returncode in (0, 1), p.stderr
    lines = p.stdout.splitlines()
    assert len(lines) == 1, p.stdout
    assert "MuPDF" not in p.stdout and "syntax error" not in p.stdout


def direct(stdin: str, *args: str):
    return subprocess.run([sys.executable, str(MODULE), *args], input=stdin, capture_output=True, text=True, check=False)


def mark_row(copy=COPY, page=2):
    return {"n": 1, "id": f"{Path(copy).stem}#p{page}.1", "copy": copy, "source": "pdf", "kind": "Ink", "page": page,
            "heading": "Beta.", "typed": "fix this", "under": "", "png": None, "rect": [52, 130, 320, 176],
            "author": None, "created": None}


def test_could_not_run(tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    make_slides(vault / COPY, OLD)
    deck = make_slides(tmp_path / "new.pdf", OLD)
    good = json.dumps({"mark": mark_row(), "outcome": {"outcome": "applied", "note": ""}})
    assert direct(good, "--deck", str(deck), "--copies-dir", str(vault)).returncode == 1  # the arguments work
    assert direct("").returncode == 2
    assert direct(good, "--copies-dir", str(vault)).returncode == 2
    assert direct("{not json", "--deck", str(deck), "--copies-dir", str(vault)).returncode == 2
    missing = json.dumps({"mark": mark_row(copy="Lecture 27 slides review 20261027z.pdf"),
                          "outcome": {"outcome": "applied", "note": ""}})
    assert direct(missing, "--deck", str(deck), "--copies-dir", str(vault)).returncode == 2
    escape = json.dumps({"mark": mark_row(copy="../new.pdf"), "outcome": {"outcome": "applied", "note": ""}})
    assert direct(escape, "--deck", str(deck), "--copies-dir", str(vault)).returncode == 2
    notes = json.dumps({"mark": mark_row(), "outcome": {"outcome": "applied", "note": "", "target": "notes"}})
    assert direct(notes, "--deck", str(deck), "--copies-dir", str(vault)).returncode == 2
    assert direct(good, "--deck", str(deck), "--copies-dir", str(vault), "--pages", "3-9").returncode == 2


def test_launcher_runs_the_check(tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    make_slides(vault / COPY, OLD)
    deck = make_slides(tmp_path / "new.pdf", OLD)
    p = subprocess.run([str(LAUNCHER), "--deck", str(deck), "--copies-dir", str(vault)],
                       input=json.dumps({"mark": mark_row(), "outcome": {"outcome": "applied", "note": ""}}),
                       capture_output=True, text=True, check=False)
    assert p.returncode == 1, p.stderr
    assert "unchanged" in p.stdout
