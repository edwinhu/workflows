"""Contract tests for bin/review-deliver (scripts/lib/review_deliver.py): deliver a deck's review copies to the vault, tick the round.

Run: uv run --with pytest --with pymupdf python3 -m pytest tests/review_deliver_test.py -q

Ported from teaching's tests/test_review_deliver.py (the semantics are teaching's) onto the generic CLI with a
workshop-shaped talk deck. Every call targets a scratch vault under tmp_path; nothing touches ~/notes.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import subprocess
import sys
import urllib.parse
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
MODULE = ROOT / "scripts" / "lib" / "review_deliver.py"
LAUNCHER = ROOT / "bin" / "review-deliver"

TEMPLATE = """---
tags: [daily]
---
# 📅 Today

Plan.

# 💼 Work"""

DAY = "2026-10-30"
DATE = "20261030"
NAME = "CELS talk"
FOLDER = ("Inbox", "Reading", "CELS talk Review")


def run(*args):
    p = subprocess.run([sys.executable, str(MODULE), *map(str, args)], capture_output=True, text=True, check=False)
    return p.returncode, p.stdout, p.stderr


def pdf(path: Path, text: str, pages: int = 3) -> Path:
    doc = pymupdf.open()
    for i in range(pages):
        doc.new_page().insert_text((72, 72), f"{text} page {i + 1}")
    doc.save(path, garbage=4, deflate=True)
    return path


def setup(tmp_path, template=TEMPLATE):
    root = tmp_path / "notes"
    if template is not None:
        (root / "Resources" / "Templates").mkdir(parents=True)
        (root / "Resources" / "Templates" / "Daily Note.md").write_text(template)
    deck = pdf(tmp_path / "slides.pdf", "Blockholders raise dividends")
    notes = pdf(tmp_path / "notes.pdf", "Speaker notes", pages=1)
    return root, deck, notes


def vault_of(root: Path) -> Path:
    return root.joinpath(*FOLDER)


def daily_of(root: Path) -> Path:
    return root / "Resources" / "Daily Notes" / f"{DAY}.md"


def deliver(root, deck, notes, *extra):
    args = ["deliver", "--name", NAME, "--slides", deck, "--vault-root", root, "--date", DATE, *extra]
    if notes is not None:
        args += ["--notes", notes]
    return run(*args)


def rel(name: str) -> str:
    return urllib.parse.quote("/".join((*FOLDER, name)), safe="")


def xodo(name: str) -> str:
    return f"[Xodo](tasker://assistantactions?task=XodoOpen&par1={rel(name)})"


def S(letter: str) -> str:
    return f"{NAME} slides review {DATE}{letter}.pdf"


def N(letter: str) -> str:
    return f"{NAME} notes review {DATE}{letter}.pdf"


# ── deliver ───────────────────────────────────────────────────────────────────

def test_letter_increments_and_both_files_land(tmp_path):
    root, deck, notes = setup(tmp_path)
    rc, out, err = deliver(root, deck, notes)
    assert rc == 0, err
    assert json.loads(out)["slides_file"] == str(vault_of(root) / S("a"))
    rc, out, err = deliver(root, deck, notes)
    assert rc == 0, err
    res = json.loads(out)
    assert res["slides_file"] == str(vault_of(root) / S("b")) and res["notes_file"] == str(vault_of(root) / N("b"))
    assert sorted(p.name for p in vault_of(root).iterdir()) == sorted([S("a"), S("b"), N("a"), N("b")])
    assert (vault_of(root) / N("b")).read_bytes() == notes.read_bytes()
    assert res["cap_bytes"] == 5_000_000 and res["slides_bytes"] == (vault_of(root) / S("b")).stat().st_size


def test_bare_date_counts_as_a_and_other_dates_and_names_are_independent(tmp_path):
    root, deck, notes = setup(tmp_path)
    v = vault_of(root)
    v.mkdir(parents=True)
    (v / f"{NAME} slides review {DATE}.pdf").write_bytes(b"x")
    (v / f"{NAME} notes review 20261029c.pdf").write_bytes(b"x")
    (v / f"Other talk slides review {DATE}f.pdf").write_bytes(b"x")
    rc, out, err = deliver(root, deck, notes)
    assert rc == 0, err
    assert json.loads(out)["slides_file"].endswith(S("b"))


def test_a_copy_carrying_ink_is_never_touched_by_the_next_delivery(tmp_path):
    root, deck, notes = setup(tmp_path)
    assert deliver(root, deck, notes)[0] == 0
    inked = vault_of(root) / S("a")
    inked.write_bytes(b"the tablet's ink")
    rc, out, err = deliver(root, deck, notes)
    assert rc == 0, err
    assert inked.read_bytes() == b"the tablet's ink"
    assert json.loads(out)["slides_file"].endswith(S("b"))


def test_every_letter_used_is_a_refusal(tmp_path):
    root, deck, notes = setup(tmp_path)
    v = vault_of(root)
    v.mkdir(parents=True)
    (v / S("z")).write_bytes(b"x")
    rc, _, err = deliver(root, deck, notes)
    assert rc == 1 and "every letter" in err
    assert sorted(p.name for p in v.iterdir()) == [S("z")]


def test_over_cap_names_the_size_and_delivers_nothing(tmp_path):
    root, deck, notes = setup(tmp_path)
    rc, _, err = deliver(root, deck, notes, "--cap-bytes", "500")
    assert rc == 1 and "OVER CAP" in err and "500" in err and "bytes" in err
    assert not vault_of(root).exists() or not any(vault_of(root).iterdir())
    assert not daily_of(root).exists()


def test_a_bloated_slides_copy_is_resaved_under_the_cap(tmp_path):
    root, _, notes = setup(tmp_path)
    doc = pymupdf.open()
    for i in range(30):
        doc.new_page().insert_text((72, 72), f"page {i} " * 40)
    bloated = tmp_path / "bloated.pdf"
    doc.save(bloated)  # no compression
    size = bloated.stat().st_size
    rc, out, err = deliver(root, bloated, notes, "--cap-bytes", str(size - 1))
    assert rc == 0, err
    res = json.loads(out)
    assert res["resaved"] is True and res["slides_bytes"] < size
    assert pymupdf.open(res["slides_file"]).page_count == 30
    assert bloated.stat().st_size == size  # the source deck is untouched


def test_a_notes_copy_over_the_cap_is_refused_not_resaved(tmp_path):
    root, deck, _ = setup(tmp_path)
    doc = pymupdf.open()
    for i in range(30):
        doc.new_page().insert_text((72, 72), f"note {i} " * 40)
    fat = tmp_path / "fat-notes.pdf"
    doc.save(fat)
    rc, _, err = deliver(root, deck, fat, "--cap-bytes", str(deck.stat().st_size + 10))
    assert rc == 1 and "OVER CAP" in err
    assert not vault_of(root).exists() or not any(vault_of(root).iterdir())


def test_no_markdown_file_but_the_daily_note_is_created(tmp_path):
    root, deck, notes = setup(tmp_path)
    before = sorted(p.relative_to(root) for p in root.rglob("*.md"))
    rc, _, err = deliver(root, deck, notes)
    assert rc == 0, err
    after = sorted(p.relative_to(root) for p in root.rglob("*.md"))
    assert sorted(set(after) - set(before)) == [daily_of(root).relative_to(root)]


def test_the_template_is_copied_and_one_todo_line_lands_under_work(tmp_path):
    root, deck, notes = setup(tmp_path)
    rc, out, err = deliver(root, deck, notes)
    assert rc == 0, err
    res = json.loads(out)
    want = f"- [ ] {NAME} review copy: [[{S('a')}]] · {xodo(S('a'))} · [[{N('a')}]] · {xodo(N('a'))}"
    assert res["todo_line"] == want and res["daily_note"] == str(daily_of(root))
    assert "%2F" in want and "%20" in want
    assert daily_of(root).read_text() == TEMPLATE + "\n" + want + "\n"


def test_label_and_item_shape_the_line(tmp_path):
    root, deck, notes = setup(tmp_path)
    rc, out, err = deliver(root, deck, notes, "--label", "CELS 2026", "--item", "Final Check")
    assert rc == 0, err
    assert json.loads(out)["todo_line"].startswith(f"- [ ] CELS 2026 final check: [[{S('a')}]]")


def test_the_line_goes_after_the_last_work_line_and_a_second_round_follows_it(tmp_path):
    root, deck, notes = setup(tmp_path)
    existing = "# 💼 Work\n- [ ] earlier task\n\n- [x] another\n\n\n# 🏠 Home\n- [ ] dishes\n"
    daily_of(root).parent.mkdir(parents=True)
    daily_of(root).write_text(existing)
    rc, out, err = deliver(root, deck, notes)
    assert rc == 0, err
    todo = json.loads(out)["todo_line"]
    assert daily_of(root).read_text() == "# 💼 Work\n- [ ] earlier task\n\n- [x] another\n" + todo + "\n\n\n# 🏠 Home\n- [ ] dishes\n"
    rc, out, err = deliver(root, deck, notes)
    assert rc == 0, err
    lines = daily_of(root).read_text().split("\n")
    i = lines.index(todo)
    assert lines[i + 1] == json.loads(out)["todo_line"] and S("b") in lines[i + 1]


def test_an_empty_work_section_takes_the_line_directly_under_the_heading(tmp_path):
    root, deck, notes = setup(tmp_path)
    daily_of(root).parent.mkdir(parents=True)
    daily_of(root).write_text("# 💼 Work\n# Other\n")
    rc, out, err = deliver(root, deck, notes)
    assert rc == 0, err
    lines = daily_of(root).read_text().split("\n")
    assert lines[0] == "# 💼 Work" and lines[1] == json.loads(out)["todo_line"] and lines[2] == "# Other"


def test_no_daily_note_and_no_template_is_could_not_run_and_writes_nothing(tmp_path):
    root, deck, notes = setup(tmp_path, template=None)
    rc, _, err = deliver(root, deck, notes)
    assert rc == 2 and "template" in err
    assert not vault_of(root).exists() or not any(vault_of(root).iterdir())


def test_a_daily_note_without_a_work_heading_is_could_not_run_and_writes_nothing(tmp_path):
    root, deck, notes = setup(tmp_path, template="# 📅 Today\n\nPlan.\n")
    rc, _, err = deliver(root, deck, notes)
    assert rc == 2 and "Work" in err
    assert not vault_of(root).exists() or not any(vault_of(root).iterdir())
    assert not daily_of(root).exists()


def test_a_vault_dir_outside_the_vault_root_is_could_not_run(tmp_path):
    root, deck, notes = setup(tmp_path)
    rc, _, err = deliver(root, deck, notes, "--vault-dir", tmp_path / "elsewhere")
    assert rc == 2 and "vault-root" in err
    assert not (tmp_path / "elsewhere").exists()


def test_without_notes_only_the_slides_copy_is_delivered(tmp_path):
    root, deck, _ = setup(tmp_path)
    rc, out, err = deliver(root, deck, None)
    assert rc == 0, err
    res = json.loads(out)
    assert res["notes_file"] is None and res["notes_bytes"] is None
    assert res["todo_line"] == f"- [ ] {NAME} review copy: [[{S('a')}]] · {xodo(S('a'))}"
    assert [p.name for p in vault_of(root).iterdir()] == [S("a")]


def test_could_not_run(tmp_path):
    root, deck, notes = setup(tmp_path)
    assert run()[0] == 2
    assert run("deliver", "--slides", deck, "--vault-root", root)[0] == 2           # no --name
    assert run("deliver", "--name", NAME, "--vault-root", root)[0] == 2             # no --slides
    assert deliver(root, tmp_path / "missing.pdf", notes)[0] == 2
    assert deliver(root, deck, notes, "--date", "2026-10-30")[0] == 2
    assert run("tick", "--vault-root", root)[0] == 2                                # no --file


def test_launcher_delivers(tmp_path):
    root, deck, notes = setup(tmp_path)
    p = subprocess.run([str(LAUNCHER), "deliver", "--name", NAME, "--slides", str(deck), "--notes", str(notes),
                        "--vault-root", str(root), "--date", DATE], capture_output=True, text=True, check=False)
    assert p.returncode == 0, p.stderr
    assert json.loads(p.stdout)["slides_file"].endswith(S("a"))


# ── tick ──────────────────────────────────────────────────────────────────────

def tick(root, *args):
    return run("tick", "--vault-root", root, *args)


def test_tick_marks_the_one_line_with_today_and_reports_a_repeat(tmp_path):
    root, deck, notes = setup(tmp_path)
    assert deliver(root, deck, notes)[0] == 0
    other = daily_of(root).parent / "2026-10-29.md"
    other.write_text("# 💼 Work\n- [ ] unrelated\n")
    today = dt.datetime.now().astimezone().strftime("%Y-%m-%d")
    rc, out, err = tick(root, "--file", S("a"))
    assert rc == 0, err
    done = [ln for ln in daily_of(root).read_text().split("\n") if S("a") in ln]
    assert len(done) == 1 and done[0].startswith(f"- [x] {NAME} review copy:") and done[0].endswith(f" ✅ {today}")
    assert other.read_text() == "# 💼 Work\n- [ ] unrelated\n"
    rc, out, _ = tick(root, "--file", S("a"))
    assert rc == 0 and "already ticked" in out
    rc, _, err = tick(root, "--file", S("q"))
    assert rc == 1 and "no checkbox item" in err


def test_tick_refuses_when_two_daily_notes_name_the_file(tmp_path):
    d = tmp_path / "notes" / "Resources" / "Daily Notes"
    d.mkdir(parents=True)
    (d / "2026-10-28.md").write_text("- [ ] x [[a.pdf]]\n")
    (d / "2026-10-29.md").write_text("- [ ] y [[a.pdf]]\n")
    rc, _, err = tick(tmp_path / "notes", "--file", "a.pdf")
    assert rc == 1 and "2 checkbox items" in err
    assert (d / "2026-10-28.md").read_text() == "- [ ] x [[a.pdf]]\n"


def test_tick_with_note_marks_only_the_line_naming_the_file(tmp_path):
    note = tmp_path / "n.md"
    note.write_text(f"- [ ] Final check: [[{S('a')}]]\n- [ ] Final check (copy added)\n")
    rc, _, err = tick(tmp_path, "--note", note, "--file", S("a"))
    assert rc == 0, err
    text = note.read_text()
    assert re.search(rf"- \[x\] Final check: \[\[{re.escape(S('a'))}\]\] ✅ \d{{4}}-\d{{2}}-\d{{2}}\n", text)
    assert "- [ ] Final check (copy added)" in text
