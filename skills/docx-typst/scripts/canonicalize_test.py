# /// script
# requires-python = ">=3.10"
# dependencies = ["pytest"]
# ///
"""Contract tests for canonicalize.py: the pure normalizers, the body lint and the CLI guards.

Nothing here needs pandoc: every pandoc-touching function is exercised only up to its guard.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import canonicalize as c

CONTAINER = "\n".join([
    "#figure(",
    "  align(center)[#table(",
    "    columns: (100%,),",
    "    align: (auto,),",
    "    [#figure(",
    '      image("a.png"),',
    "    )",
    "    ],",
    "  )]",
    "  , kind: table",
    "  )",
])


def test_lint_flags_each_directive_with_line_number_and_reason():
    text = "= Title\n#show heading: set text(red)\nprose\n  #set page(width: 1cm)\n#let x = 1\n#import \"a.typ\"\n"
    problems = c.lint_body(text, "body.typ")
    assert [p.split(" — ")[0] for p in problems] == [
        "body.typ:2: #show", "body.typ:4: #set", "body.typ:5: #let", "body.typ:6: #import",
    ]
    assert "collapse `= Heading`" in problems[0]


def test_lint_ignores_directives_mid_line_and_similar_names():
    assert c.lint_body("text with #set inline\n#settings\n#shower\n") == []


def test_lint_empty_text_has_no_problems():
    assert c.lint_body("") == []


def test_single_column_gets_trailing_comma():
    out = c.normalize_recovered("    columns: (100%),\n")
    assert out == "    columns: (100%,),\n"


def test_multi_column_width_list_is_untouched():
    src = "  columns: (50%, 50%),\n"
    assert c.normalize_recovered(src) == src


def test_word_final_apostrophe_becomes_curly_and_interior_stays():
    assert c.normalize_recovered("Officers' Retirement and it's Comm'n") == "Officers’ Retirement and it's Comm'n"


def test_doubled_apostrophe_is_not_a_word_final_apostrophe():
    assert c.normalize_recovered("said ''hi''") == "said ''hi''"


def test_normalize_leaves_raw_spans_and_math_alone():
    src = "`cats'` and ```\nofficers'\n``` and $x'$ but dogs'"
    assert c.normalize_recovered(src) == "`cats'` and ```\nofficers'\n``` and $x'$ but dogs’"


def test_normalize_is_idempotent():
    once = c.normalize_recovered("Officers' x\n    columns: (100%),\n")
    assert c.normalize_recovered(once) == once


def test_flatten_unwraps_one_cell_figure_container():
    assert c.flatten_container_tables(CONTAINER) == '#figure(\n  image("a.png"),\n)'


def test_flatten_keeps_authored_one_cell_table():
    authored = CONTAINER.replace("[#figure(", "[Callout text")
    assert c.flatten_container_tables(authored) == authored


def test_flatten_leaves_ordinary_text_alone():
    assert c.flatten_container_tables("a\n\nb\n") == "a\n\nb\n"


def test_image_paths_in_order_and_skip_raw_spans():
    text = 'image("one.png") `image("fake.png")` then image("two/x.svg", width: 1cm)'
    assert c.image_paths(text) == ["one.png", "two/x.svg"]


def test_set_image_paths_replaces_nth_and_skips_raw_spans():
    text = 'image("rId1.png") `image("fake.png")` image("rId2.png")'
    assert c.set_image_paths(text, ["a.png", "b.png"]) == 'image("a.png") `image("fake.png")` image("b.png")'


def test_digests_missing_dir_is_empty(tmp_path):
    assert c._digests(tmp_path / "nope") == {}


def test_adopt_media_reuses_identical_content_name(tmp_path):
    media = tmp_path / "media"
    media.mkdir()
    (media / "figure1.png").write_bytes(b"AAA")
    src = tmp_path / "rId9.png"
    src.write_bytes(b"AAA")
    existing = c._digests(media)
    assert c._adopt_media(src, media, existing) == media / "figure1.png"
    assert sorted(p.name for p in media.iterdir()) == ["figure1.png"]


def test_adopt_media_suffixes_name_collision_with_different_content(tmp_path):
    media = tmp_path / "media"
    media.mkdir()
    (media / "x.png").write_bytes(b"AAA")
    src = tmp_path / "other" / "x.png"
    src.parent.mkdir()
    src.write_bytes(b"BBB")
    dest = c._adopt_media(src, media, c._digests(media))
    assert dest.name == "x-2.png"
    assert (media / "x.png").read_bytes() == b"AAA" and dest.read_bytes() == b"BBB"


def test_run_turns_missing_resource_warning_into_error(monkeypatch):
    class P:
        returncode = 0
        stderr = "[WARNING] Could not fetch resource nope.png: gone\n"
    monkeypatch.setattr(c.subprocess, "run", lambda *a, **k: P())
    with pytest.raises(c.PandocError, match="replaced it with its alt text") as ei:
        c._run(["pandoc"])
    assert "Could not fetch resource nope.png" in str(ei.value)


def test_run_nonzero_exit_reports_code_and_stderr(monkeypatch):
    class P:
        returncode = 64
        stderr = "boom\n"
    monkeypatch.setattr(c.subprocess, "run", lambda *a, **k: P())
    with pytest.raises(c.PandocError, match=r"failed \(64\):\nboom"):
        c._run(["pandoc", "x"])


def test_require_pandoc_missing(monkeypatch):
    monkeypatch.setattr(c.shutil, "which", lambda _n: None)
    with pytest.raises(c.PandocError, match="pandoc not found on PATH"):
        c.require_pandoc()


def test_canonicalize_text_refuses_images_without_resource_path(monkeypatch):
    monkeypatch.setattr(c, "require_pandoc", lambda: "pandoc")
    with pytest.raises(c.PandocError, match="no resource_path was given"):
        c.canonicalize_text('#image("a.png")\n')


def test_canonical_from_docx_requires_media_dir_when_images_found(monkeypatch, tmp_path):
    monkeypatch.setattr(c, "docx_to_typ", lambda *a, **k: 'image("media/rId1.png")')
    with pytest.raises(c.PandocError, match=r"embeds 1 image\(s\).*--media-dir"):
        c.canonical_from_docx(tmp_path / "d.docx")


def test_cli_lint_failure_exits_1_and_lists_problems(tmp_path, capsys):
    body = tmp_path / "body.typ"
    body.write_text("= H\n#set page(width: 1cm)\n")
    assert c.main([str(body), "--lint"]) == 1
    err = capsys.readouterr().err
    assert "body lint failed" in err and f"{body}:2: #set" in err


def test_cli_lint_pass_exits_0(tmp_path, capsys):
    body = tmp_path / "body.typ"
    body.write_text("= H\nprose\n")
    assert c.main([str(body), "--lint"]) == 0
    assert f"body lint passed: {body}" in capsys.readouterr().err


def test_cli_without_input_is_usage_error(capsys):
    with pytest.raises(SystemExit) as ei:
        c.main([])
    assert ei.value.code == 2
    assert "pass a .typ file or --from-docx" in capsys.readouterr().err


def test_cli_pandoc_error_exits_2(monkeypatch, tmp_path, capsys):
    body = tmp_path / "body.typ"
    body.write_text("prose\n")
    def boom(*a, **k):
        raise c.PandocError("pandoc not found on PATH")
    monkeypatch.setattr(c, "canonicalize_text", boom)
    assert c.main([str(body)]) == 2
    assert "error: pandoc not found on PATH" in capsys.readouterr().err


def test_cli_check_reports_diff_when_not_canonical(monkeypatch, tmp_path, capsys):
    body = tmp_path / "body.typ"
    body.write_text("old\n")
    monkeypatch.setattr(c, "canonicalize_text", lambda t, resource_path=None: "new\n")
    assert c.main([str(body), "--check"]) == 1
    err = capsys.readouterr().err
    assert f"not canonical: {body}" in err and "-old" in err and "+new" in err


def test_cli_check_passes_when_fixed_point(monkeypatch, tmp_path, capsys):
    body = tmp_path / "body.typ"
    body.write_text("same\n")
    monkeypatch.setattr(c, "canonicalize_text", lambda t, resource_path=None: t)
    assert c.main([str(body), "--check"]) == 0
    assert f"canonical: {body}" in capsys.readouterr().err


def test_cli_in_place_rewrites_and_output_writes(monkeypatch, tmp_path):
    body = tmp_path / "body.typ"
    body.write_text("a\n")
    monkeypatch.setattr(c, "canonicalize_text", lambda t, resource_path=None: "b\n")
    assert c.main([str(body), "--in-place"]) == 0
    assert body.read_text() == "b\n"
    out = tmp_path / "o.typ"
    body.write_text("a\n")
    assert c.main([str(body), "--output", str(out)]) == 0
    assert out.read_text() == "b\n" and body.read_text() == "a\n"


def test_cli_in_place_with_from_docx_is_error(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(c, "canonical_from_docx", lambda *a, **k: "x\n")
    assert c.main(["--from-docx", str(tmp_path / "d.docx"), "--in-place"]) == 2
    assert "--in-place needs a .typ input" in capsys.readouterr().err
