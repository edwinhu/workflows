"""Contract tests for the docx <-> typst bridge (skills/docx-typst).

Run: ./scripts/check-tests.sh docx_typst

WHAT THIS SUITE IS PROVING

The bridge rests on four empirical claims about pandoc 3.7 that are cheap to assert and
expensive to rediscover:

  1. The docx round trip `typ -> docx -> typ` reaches a FIXED POINT after one pass. This
     is the load-bearing one: it is what lets the canonical form be committed, which is
     what makes reconciliation a `git merge-file` instead of a human reading two
     documents side by side.
  2. `--reference-doc` yields genuine Word styles (Heading1/Heading2), and the reverse
     conversion recovers `=`/`==` — so the Word file a coauthor edits is structurally
     real, not a wall of bold paragraphs.
  3. `--track-changes=reject` reconstructs a tracked document's ancestor exactly, so one
     returned file supplies BOTH sides of a three-way merge.
  4. Comments carry an anchor and a resolved state that can be recovered from OOXML.

Each is asserted rather than trusted, because all four are properties of an external
binary that this repo does not pin.

FABRICATION, NOT FIXTURES

Tracked changes and comments are synthesized into a pandoc-built docx with lxml rather
than committed as binary fixtures. A binary .docx fixture is unreviewable in a diff and
rots silently against a new pandoc; fabricating from source keeps the input visible in
the test and regenerates it against whatever pandoc is installed.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills" / "docx-typst" / "scripts"
TEMPLATE = ROOT / "skills" / "writing-legal" / "templates" / "law_review_template.docx"
DRIVE_FIXTURE = ROOT / "tests" / "fixtures" / "drive-comments-list.json"

sys.path.insert(0, str(SCRIPTS))

import build as build_mod
import canonicalize
import comments as comments_mod
import provenance
import reconcile

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W14 = "http://schemas.microsoft.com/office/word/2010/wordml"
W15 = "http://schemas.microsoft.com/office/word/2012/wordml"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"

needs_pandoc = pytest.mark.skipif(
    not shutil.which("pandoc"), reason="pandoc not installed"
)

BODY = """= Introduction

The first section makes a claim about disclosure.

== Background

The second section surveys the prior literature.
"""


# ── fabrication helpers ────────────────────────────────────────────────

def _rewrite_zip(src: Path, dst: Path, replace: dict[str, bytes]) -> Path:
    """Copy a package, substituting/adding the named parts. Everything else byte-identical."""
    with zipfile.ZipFile(src) as z:
        names = z.namelist()
        parts = {n: z.read(n) for n in names}
    parts.update(replace)
    order = names + [n for n in replace if n not in names]
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
        for n in order:
            z.writestr(n, parts[n])
    return dst


def _paragraph_text(p) -> str:
    return "".join(t.text or "" for t in p.findall(f".//{{{W}}}t"))


def fabricate_tracked_edit(src: Path, dst: Path, old: str, new: str) -> Path:
    """Rewrite the paragraph reading `old` as a tracked deletion plus a tracked insertion.

    This is what Word writes when someone edits with Track Changes on: the original text
    survives inside `w:del` (as `w:delText`, which Word hides), and the replacement sits
    in `w:ins`. `--track-changes=reject` therefore reproduces the ancestor.
    """
    from lxml import etree

    with zipfile.ZipFile(src) as z:
        doc = etree.fromstring(z.read("word/document.xml"))

    target = next(
        (p for p in doc.iter(f"{{{W}}}p") if _paragraph_text(p).strip() == old.strip()), None
    )
    assert target is not None, f"no paragraph reading {old!r}"

    for child in list(target):
        if etree.QName(child).localname != "pPr":
            target.remove(child)

    def _rev(tag, wid):
        el = etree.SubElement(target, f"{{{W}}}{tag}")
        el.set(f"{{{W}}}id", str(wid))
        el.set(f"{{{W}}}author", "Coauthor")
        el.set(f"{{{W}}}date", "2026-07-14T15:00:00Z")
        return el

    del_el = _rev("del", 900)
    r = etree.SubElement(del_el, f"{{{W}}}r")
    dt = etree.SubElement(r, f"{{{W}}}delText")
    dt.set(XML_SPACE, "preserve")
    dt.text = old

    ins_el = _rev("ins", 901)
    r = etree.SubElement(ins_el, f"{{{W}}}r")
    t = etree.SubElement(r, f"{{{W}}}t")
    t.set(XML_SPACE, "preserve")
    t.text = new

    return _rewrite_zip(src, dst, {"word/document.xml": etree.tostring(doc, xml_declaration=True, encoding="UTF-8")})


COMMENTS_XML = f"""<?xml version="1.0" encoding="UTF-8"?>
<w:comments xmlns:w="{W}" xmlns:w14="{W14}">
  <w:comment w:id="1" w:author="Coauthor" w:date="2026-07-14T15:02:11Z" w:initials="C">
    <w:p w14:paraId="11111111"><w:r><w:t>Is this the right framing for the introduction?</w:t></w:r></w:p>
  </w:comment>
  <w:comment w:id="2" w:author="Edwin Hu" w:date="2026-07-14T16:40:02Z" w:initials="EH">
    <w:p w14:paraId="22222222"><w:r><w:t>Reframed around the doctrinal question.</w:t></w:r></w:p>
  </w:comment>
  <w:comment w:id="3" w:author="Coauthor" w:date="2026-07-14T15:09:44Z" w:initials="C">
    <w:p w14:paraId="33333333"><w:r><w:t>Cite checked - fine as is.</w:t></w:r></w:p>
  </w:comment>
</w:comments>
"""

COMMENTS_EXTENDED_XML = f"""<?xml version="1.0" encoding="UTF-8"?>
<w15:commentsEx xmlns:w15="{W15}">
  <w15:commentEx w15:paraId="11111111" w15:done="0"/>
  <w15:commentEx w15:paraId="22222222" w15:paraIdParent="11111111" w15:done="0"/>
  <w15:commentEx w15:paraId="33333333" w15:done="1"/>
</w15:commentsEx>
"""


def fabricate_comments(src: Path, dst: Path, anchors: dict[str, str]) -> Path:
    """Anchor comments to paragraphs by text. `anchors` maps comment id -> paragraph text."""
    from lxml import etree

    with zipfile.ZipFile(src) as z:
        doc = etree.fromstring(z.read("word/document.xml"))
        ct = etree.fromstring(z.read("[Content_Types].xml"))
        rels = etree.fromstring(z.read("word/_rels/document.xml.rels"))

    for cid, text in anchors.items():
        p = next(
            (q for q in doc.iter(f"{{{W}}}p") if _paragraph_text(q).strip() == text.strip()), None
        )
        assert p is not None, f"no paragraph reading {text!r}"
        runs = [c for c in p if etree.QName(c).localname == "r"]
        assert runs, f"paragraph {text!r} has no runs to bracket"

        start = etree.Element(f"{{{W}}}commentRangeStart")
        start.set(f"{{{W}}}id", cid)
        runs[0].addprevious(start)

        end = etree.Element(f"{{{W}}}commentRangeEnd")
        end.set(f"{{{W}}}id", cid)
        runs[-1].addnext(end)

        ref_run = etree.Element(f"{{{W}}}r")
        ref = etree.SubElement(ref_run, f"{{{W}}}commentReference")
        ref.set(f"{{{W}}}id", cid)
        end.addnext(ref_run)

    CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
    PR_NS = "http://schemas.openxmlformats.org/package/2006/relationships"

    ov = etree.SubElement(ct, f"{{{CT_NS}}}Override")
    ov.set("PartName", "/word/commentsExtended.xml")
    ov.set("ContentType",
           "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml")

    rel = etree.SubElement(rels, f"{{{PR_NS}}}Relationship")
    rel.set("Id", "rId900")
    rel.set("Type", "http://schemas.microsoft.com/office/2011/relationships/commentsExtended")
    rel.set("Target", "commentsExtended.xml")

    return _rewrite_zip(src, dst, {
        "word/document.xml": etree.tostring(doc, xml_declaration=True, encoding="UTF-8"),
        "word/comments.xml": COMMENTS_XML.encode(),
        "word/commentsExtended.xml": COMMENTS_EXTENDED_XML.encode(),
        "[Content_Types].xml": etree.tostring(ct, xml_declaration=True, encoding="UTF-8"),
        "word/_rels/document.xml.rels": etree.tostring(rels, xml_declaration=True, encoding="UTF-8"),
    })


@pytest.fixture
def canon_body():
    return canonicalize.canonicalize_text(BODY)


# ── C1: canonical form is a fixed point ────────────────────────────────

@needs_pandoc
def test_canonical_form_is_idempotent(canon_body):
    """canon(canon(x)) == canon(x), byte-equal.

    Without this the canonical form cannot be committed: every build would rewrite the
    source, and the git history would fill with churn that means nothing.
    """
    assert canonicalize.canonicalize_text(canon_body) == canon_body


@needs_pandoc
def test_canonicalize_normalizes_the_known_shifts(canon_body):
    """The normalizations are cosmetic and known — not silent semantic damage."""
    assert "#emph[" in canonicalize.canonicalize_text("A _word_ here.\n")
    assert "#strong[" in canonicalize.canonicalize_text("A *word* here.\n")
    assert "“" in canonicalize.canonicalize_text('A "quote" here.\n')
    # headings survive, and pick up a label anchor
    assert canon_body.startswith("= Introduction\n<introduction>")


@needs_pandoc
def test_check_flags_a_non_canonical_file(tmp_path, canon_body):
    off = tmp_path / "body.typ"
    off.write_text("= Introduction\n\nA _word_ here.\n", encoding="utf-8")
    assert canonicalize.main([str(off), "--check"]) == 1

    on = tmp_path / "canon.typ"
    on.write_text(canon_body, encoding="utf-8")
    assert canonicalize.main([str(on), "--check"]) == 0


def test_body_lint_rejects_styling_directives():
    """Show rules in the file pandoc reads collapse `= Heading` into a bold paragraph."""
    problems = canonicalize.lint_body("#show heading: set text(weight: 700)\n\n= H\n", "body.typ")
    assert len(problems) == 1
    assert "#show" in problems[0]

    for directive in ("#set page(margin: 1in)", '#import "x.typ": y', "#let n = 1"):
        assert canonicalize.lint_body(directive + "\n", "b.typ"), directive

    # prose that merely mentions a directive mid-line is not a violation
    assert canonicalize.lint_body("We use a #show rule in main.typ.\n", "b.typ") == []


# ── C2: reference-doc build preserves Word semantics ───────────────────

@needs_pandoc
@pytest.mark.skipif(not TEMPLATE.exists(), reason="law review template not present")
def test_reference_doc_preserves_heading_styles(tmp_path, canon_body):
    src = tmp_path / "body.typ"
    src.write_text(canon_body, encoding="utf-8")
    out = tmp_path / "paper.docx"
    build_mod.build(src, out, reference_doc=TEMPLATE)

    with zipfile.ZipFile(out) as z:
        doc = z.read("word/document.xml").decode("utf-8")
    assert 'w:val="Heading1"' in doc, "no real Heading1 style — Word's outline would be empty"
    assert 'w:val="Heading2"' in doc

    back = canonicalize.docx_to_typ(out)
    assert "= Introduction" in back
    assert "== Background" in back


# ── C3: build embeds provenance atomically ─────────────────────────────

@needs_pandoc
def test_build_embeds_provenance(tmp_path, canon_body):
    """One invocation yields a stamped docx that is still a valid package.

    Atomic on purpose: a stamp the caller can forget is discovered months later, when
    the document comes back and its ancestor is gone.
    """
    src = tmp_path / "body.typ"
    src.write_text(canon_body, encoding="utf-8")
    out = tmp_path / "paper.docx"
    build_mod.build(src, out)

    props = provenance.read(out)
    assert props["SourceSHA256"] == provenance.sha256_file(src)
    assert props["SourcePath"] == str(src)
    assert props["StampVersion"] == provenance.STAMP_VERSION
    assert props["Canonical"] == "yes"

    with zipfile.ZipFile(out) as z:
        assert z.testzip() is None, "stamping produced a corrupt zip"
        names = z.namelist()
        assert "docProps/custom.xml" in names
        assert b"/docProps/custom.xml" in z.read("[Content_Types].xml"), \
            "custom.xml present but not declared — Word calls this corrupt"
        assert b"custom-properties" in z.read("_rels/.rels"), \
            "custom.xml declared but unreachable — no relationship from the package root"
        assert "word/document.xml" in names


@needs_pandoc
def test_build_refuses_a_body_that_styles_itself(tmp_path):
    src = tmp_path / "body.typ"
    src.write_text("#show heading: it => it\n\n= Introduction\n\nText.\n", encoding="utf-8")
    with pytest.raises(ValueError, match="silently destroy headings"):
        build_mod.build(src, tmp_path / "out.docx")
    # the escape hatch exists, and is explicit
    build_mod.build(src, tmp_path / "out.docx", allow_styling=True)


@needs_pandoc
def test_stamping_preserves_existing_custom_properties(tmp_path, canon_body):
    """A template's own properties must survive the stamp, with pids still unique."""
    src = tmp_path / "body.typ"
    src.write_text(canon_body, encoding="utf-8")
    out = tmp_path / "paper.docx"
    canonicalize.typ_to_docx(src, out)
    provenance.stamp(out, {"JournalCode": "VLR"})
    provenance.stamp(out, provenance.source_properties(src))

    props = provenance.read(out)
    assert props["JournalCode"] == "VLR"
    assert props["SourceSHA256"] == provenance.sha256_file(src)

    from lxml import etree
    with zipfile.ZipFile(out) as z:
        root = etree.fromstring(z.read("docProps/custom.xml"))
    pids = [p.get("pid") for p in root]
    assert len(pids) == len(set(pids)), "duplicate pid — Word rejects the part"
    assert all(int(p) >= 2 for p in pids), "pid 0/1 are reserved"


# ── C4: tracked changes yield their own ancestor ───────────────────────

@needs_pandoc
def test_tracked_reject_reproduces_ancestor(tmp_path, canon_body):
    """The returned file carries its own ancestor — no repo state required.

    This is what makes reconciliation work for a document that was renamed, re-sent, or
    routed through a third party before coming back.
    """
    src = tmp_path / "body.typ"
    src.write_text(canon_body, encoding="utf-8")
    sent = tmp_path / "sent.docx"
    build_mod.build(src, sent)

    returned = fabricate_tracked_edit(
        sent, tmp_path / "returned.docx",
        old="The first section makes a claim about disclosure.",
        new="The first section makes a narrower claim about mandatory disclosure.",
    )
    assert reconcile.has_tracked_changes(returned)

    rejected = canonicalize.canonical_from_docx(returned, track_changes="reject")
    assert rejected == canon_body, "reject did not reproduce the pre-edit canonical body"

    accepted = canonicalize.canonical_from_docx(returned, track_changes="accept")
    assert "narrower claim about mandatory disclosure" in accepted
    assert accepted != canon_body


# ── C5 / C6: three-way merge ───────────────────────────────────────────

def _returned_and_local(tmp_path, canon_body, their_new: str, my_replacement: str):
    src = tmp_path / "body.typ"
    src.write_text(canon_body, encoding="utf-8")
    sent = tmp_path / "sent.docx"
    build_mod.build(src, sent)
    returned = fabricate_tracked_edit(
        sent, tmp_path / "returned.docx",
        old="The first section makes a claim about disclosure.", new=their_new,
    )
    # meanwhile, the repo's source moved
    src.write_text(canon_body.replace(
        "The second section surveys the prior literature.", my_replacement
    ) if my_replacement else canon_body, encoding="utf-8")
    return returned, src


@needs_pandoc
def test_disjoint_edits_merge_clean(tmp_path, canon_body):
    """They edit §1, the repo edits §2 → both survive, no conflict."""
    returned, src = _returned_and_local(
        tmp_path, canon_body,
        their_new="The first section makes a narrower claim about mandatory disclosure.",
        my_replacement="The second section surveys the empirical literature.",
    )
    result = reconcile.reconcile(returned, src)

    assert result["conflicts"] == 0
    assert result["theirsChanged"] and result["mineChanged"]

    merged = Path(result["merged"]).read_text(encoding="utf-8")
    assert "narrower claim about mandatory disclosure" in merged, "coauthor's edit was dropped"
    assert "surveys the empirical literature" in merged, "local edit was dropped"
    assert reconcile.CONFLICT_MARKER not in merged

    diff = Path(result["diff"]).read_text(encoding="utf-8")
    assert diff.strip(), "a merge that changed the file produced an empty diff"


@needs_pandoc
def test_disjoint_merge_exits_zero(tmp_path, canon_body):
    returned, src = _returned_and_local(
        tmp_path, canon_body,
        their_new="The first section makes a narrower claim about mandatory disclosure.",
        my_replacement="The second section surveys the empirical literature.",
    )
    assert reconcile.main([str(returned), "--source", str(src)]) == 0


@needs_pandoc
def test_same_sentence_conflicts(tmp_path, canon_body):
    """Both sides rewrote the same sentence → markers, and a non-zero exit.

    Choosing a side automatically would silently discard someone's edit. The point of
    the merge is to make disagreement visible, not to make it disappear.
    """
    src = tmp_path / "body.typ"
    src.write_text(canon_body, encoding="utf-8")
    sent = tmp_path / "sent.docx"
    build_mod.build(src, sent)
    returned = fabricate_tracked_edit(
        sent, tmp_path / "returned.docx",
        old="The first section makes a claim about disclosure.",
        new="The first section makes a narrower claim about mandatory disclosure.",
    )
    src.write_text(canon_body.replace(
        "The first section makes a claim about disclosure.",
        "The first section makes a broader claim about voluntary disclosure.",
    ), encoding="utf-8")

    result = reconcile.reconcile(returned, src)
    assert result["conflicts"] > 0
    merged = Path(result["merged"]).read_text(encoding="utf-8")
    assert reconcile.CONFLICT_MARKER in merged
    assert "mandatory disclosure" in merged and "voluntary disclosure" in merged

    assert reconcile.main([str(returned), "--source", str(src)]) == 1


@needs_pandoc
def test_no_ancestor_is_an_error_not_a_two_way_diff(tmp_path, canon_body):
    """An untracked, unstamped return has no ancestor. Refusing beats guessing."""
    src = tmp_path / "body.typ"
    src.write_text(canon_body, encoding="utf-8")
    plain = tmp_path / "plain.docx"
    canonicalize.typ_to_docx(src, plain)  # no stamp, no tracked changes

    with pytest.raises(reconcile.ReconcileError, match="no ancestor available"):
        reconcile.reconcile(plain, src)


@needs_pandoc
def test_base_docx_supplies_the_ancestor(tmp_path, canon_body):
    """The fallback for a return that lost both tracked changes and the stamp."""
    src = tmp_path / "body.typ"
    src.write_text(canon_body, encoding="utf-8")
    sent = tmp_path / "sent.docx"
    canonicalize.typ_to_docx(src, sent)

    edited = canon_body.replace(
        "The first section makes a claim about disclosure.",
        "The first section makes a narrower claim about mandatory disclosure.",
    )
    edited_typ = tmp_path / "edited.typ"
    edited_typ.write_text(edited, encoding="utf-8")
    returned = tmp_path / "returned.docx"
    canonicalize.typ_to_docx(edited_typ, returned)

    src.write_text(canon_body.replace(
        "The second section surveys the prior literature.",
        "The second section surveys the empirical literature.",
    ), encoding="utf-8")

    result = reconcile.reconcile(returned, src, base_docx=sent)
    assert result["conflicts"] == 0
    assert result["ancestor"].startswith("--base-docx")
    merged = Path(result["merged"]).read_text(encoding="utf-8")
    assert "mandatory disclosure" in merged and "empirical literature" in merged


@needs_pandoc
def test_provenance_stamp_supplies_the_ancestor(tmp_path, canon_body):
    """The last fallback: no tracked changes, no kept original — but the docx was stamped.

    Works only when that source revision was COMMITTED, since a blob sha alone does not
    create the object. That is why this is third in preference, not first.
    """
    repo = tmp_path / "repo"
    repo.mkdir()
    git = ["git", "-C", str(repo)]
    subprocess.run([*git, "init", "-q"], check=True)
    subprocess.run([*git, "config", "user.email", "t@example.com"], check=True)
    subprocess.run([*git, "config", "user.name", "T"], check=True)

    src = repo / "body.typ"
    src.write_text(canon_body, encoding="utf-8")
    subprocess.run([*git, "add", "body.typ"], check=True)
    subprocess.run([*git, "commit", "-qm", "body"], check=True)

    sent = tmp_path / "sent.docx"
    build_mod.build(src, sent)
    assert provenance.read(sent)["SourceGitSHA"], "no git sha recorded inside a git tree"

    # they edit without tracking; the stamp survives because Word keeps custom properties
    edited = tmp_path / "edited.typ"
    edited.write_text(canon_body.replace(
        "The first section makes a claim about disclosure.",
        "The first section makes a narrower claim about mandatory disclosure.",
    ), encoding="utf-8")
    returned = tmp_path / "returned.docx"
    canonicalize.typ_to_docx(edited, returned)
    provenance.stamp(returned, provenance.read(sent))
    assert not reconcile.has_tracked_changes(returned)

    src.write_text(canon_body.replace(
        "The second section surveys the prior literature.",
        "The second section surveys the empirical literature.",
    ), encoding="utf-8")

    result = reconcile.reconcile(returned, src)
    assert result["ancestor"].startswith("provenance stamp")
    assert result["conflicts"] == 0
    merged = Path(result["merged"]).read_text(encoding="utf-8")
    assert "mandatory disclosure" in merged and "empirical literature" in merged


@needs_pandoc
def test_stamp_pointing_at_an_uncommitted_revision_says_so(tmp_path, canon_body):
    """A stamp whose blob was never committed must name the problem, not fall through."""
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "-C", str(repo), "init", "-q"], check=True)
    src = repo / "body.typ"
    src.write_text(canon_body, encoding="utf-8")

    returned = tmp_path / "returned.docx"
    canonicalize.typ_to_docx(src, returned)
    provenance.stamp(returned, provenance.source_properties(src))

    with pytest.raises(reconcile.ReconcileError, match="never committed"):
        reconcile.reconcile(returned, src)


# ── C7: comment extraction ─────────────────────────────────────────────

@needs_pandoc
def test_comment_extraction(tmp_path, canon_body):
    src = tmp_path / "body.typ"
    src.write_text(canon_body, encoding="utf-8")
    doc = tmp_path / "paper.docx"
    build_mod.build(src, doc)

    para1 = "The first section makes a claim about disclosure."
    para2 = "The second section surveys the prior literature."
    withc = fabricate_comments(doc, tmp_path / "commented.docx",
                               {"1": para1, "2": para1, "3": para2})

    result = comments_mod.from_docx(withc)
    assert result["source"] == "docx"
    threads = {c["id"]: c for c in result["comments"]}
    assert set(threads) == {"1", "3"}, "the reply did not fold into its parent thread"

    t1 = threads["1"]
    assert t1["author"] == "Coauthor"
    assert t1["text"] == "Is this the right framing for the introduction?"
    assert t1["quoted"] == para1, "comment lost the text it points at"
    assert t1["resolved"] is False
    assert len(t1["replies"]) == 1
    assert t1["replies"][0]["author"] == "Edwin Hu"
    assert t1["replies"][0]["text"] == "Reframed around the doctrinal question."

    t3 = threads["3"]
    assert t3["resolved"] is True, "w15:done=1 was not read"
    assert t3["quoted"] == para2
    assert t3["replies"] == []


@needs_pandoc
def test_unresolved_only_filter(tmp_path, canon_body):
    src = tmp_path / "body.typ"
    src.write_text(canon_body, encoding="utf-8")
    doc = tmp_path / "paper.docx"
    build_mod.build(src, doc)
    withc = fabricate_comments(doc, tmp_path / "commented.docx", {
        "1": "The first section makes a claim about disclosure.",
        "2": "The first section makes a claim about disclosure.",
        "3": "The second section surveys the prior literature.",
    })
    out = tmp_path / "c.json"
    assert comments_mod.main(["--from-docx", str(withc), "--output", str(out),
                              "--unresolved-only"]) == 0
    data = json.loads(out.read_text(encoding="utf-8"))
    assert [c["id"] for c in data["comments"]] == ["1"]


@needs_pandoc
def test_document_without_comments_is_empty_not_an_error(tmp_path, canon_body):
    src = tmp_path / "body.typ"
    src.write_text(canon_body, encoding="utf-8")
    doc = tmp_path / "paper.docx"
    build_mod.build(src, doc)
    assert comments_mod.from_docx(doc)["comments"] == []


# ── C8: both backends emit the identical schema ────────────────────────

def test_drive_schema_matches_docx_schema(tmp_path):
    """Key sets equal, asserted against a recorded fixture — no live API call.

    Anything downstream that branched on the backend would drift the moment one side
    grew a field. Pinning the key sets is what stops that.
    """
    payload = json.loads(DRIVE_FIXTURE.read_text(encoding="utf-8"))
    drive = comments_mod.from_drive_payload(payload, "1AbCdEfGhIjK")

    assert sorted(drive) == sorted(comments_mod.TOP_KEYS)
    assert drive["source"] == "drive"
    assert drive["file"] == "1AbCdEfGhIjK"

    for c in drive["comments"]:
        assert sorted(c) == sorted(comments_mod.COMMENT_KEYS)
        for r in c["replies"]:
            assert sorted(r) == sorted(comments_mod.REPLY_KEYS)

    first = drive["comments"][0]
    assert first["author"] == "Coauthor"
    assert first["quoted"] == "This is the first paragraph."
    assert first["resolved"] is False
    assert first["replies"][0]["author"] == "Edwin Hu"
    assert drive["comments"][1]["resolved"] is True


@needs_pandoc
def test_drive_and_docx_key_sets_are_identical(tmp_path, canon_body):
    """The same assertion, run against BOTH backends' real output side by side."""
    src = tmp_path / "body.typ"
    src.write_text(canon_body, encoding="utf-8")
    doc = tmp_path / "paper.docx"
    build_mod.build(src, doc)
    withc = fabricate_comments(doc, tmp_path / "commented.docx", {
        "1": "The first section makes a claim about disclosure.",
        "2": "The first section makes a claim about disclosure.",
        "3": "The second section surveys the prior literature.",
    })
    docx = comments_mod.from_docx(withc)
    drive = comments_mod.from_drive_payload(
        json.loads(DRIVE_FIXTURE.read_text(encoding="utf-8")), "x"
    )

    assert sorted(docx) == sorted(drive)
    assert sorted(docx["comments"][0]) == sorted(drive["comments"][0])
    assert sorted(docx["comments"][0]["replies"][0]) == sorted(drive["comments"][0]["replies"][0])


# ── the scripts are runnable as scripts ────────────────────────────────

@pytest.mark.parametrize("script", ["canonicalize.py", "build.py", "provenance.py",
                                    "reconcile.py", "comments.py"])
def test_script_is_executable_and_has_help(script):
    path = SCRIPTS / script
    assert path.exists(), f"{script} missing"
    proc = subprocess.run([sys.executable, str(path), "--help"],
                          capture_output=True, text=True, check=False)
    assert proc.returncode == 0, proc.stderr
    assert "usage:" in proc.stdout.lower()


# ── C9: real Word output — three pandoc defects, pinned and worked around ──
#
# Everything above this line converts a docx pandoc itself wrote. Genuine Word output
# exercises paths that one never reaches, and all three of these were found by running
# the recovery over a 1.2M Word manuscript (7 headings, 67 footnotes, 26 tables,
# 7 figures) that the synthetic fixtures said was fine.

CONTAINER = """#figure(
  align(center)[#table(
    columns: (100%,),
    align: (auto,),
    [#figure(
      align(center)[#table(
        columns: (50%, 50%),
        align: (left,left,),
        table.header(table.cell(align: left)[Block], table.cell(align: left)[Rule],),
        table.hline(),
        table.cell(align: left)[Index], table.cell(align: left)[Mirror (pro-rata)],
      )]
      , kind: table
      )

    ],
  )]
  , kind: table
  )
"""

# A one-column table with real rows — the thing flattening must NOT touch.
REAL_ONE_COLUMN = """#figure(
  align(center)[#table(
    columns: (100%,),
    align: (auto,),
    table.header(table.cell(align: left)[Heading],),
    table.hline(),
    table.cell(align: left)[First row],
    table.cell(align: left)[Second row],
  )]
  , kind: table
  )
"""

# 1x1 transparent PNG, so the image test needs no binary fixture on disk.
PNG_1X1 = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06"
    b"\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00"
    b"\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _wrap_in_container(block: str) -> str:
    """Put `block` inside one more Word-style one-cell container table."""
    lines = block.rstrip("\n").split("\n")
    inner = "\n".join(("    " + ln) if ln.strip() else ln for ln in lines)
    return (
        "#figure(\n"
        "  align(center)[#table(\n"
        "    columns: (100%,),\n"
        "    align: (auto,),\n"
        "    [" + inner.lstrip(" ") + "\n"
        "\n"
        "    ],\n"
        "  )]\n"
        "  , kind: table\n"
        "  )\n"
    )


def _raw_docx_to_typ(docx: Path) -> str:
    """pandoc's docx -> typst with NO normalization, for pinning its defects."""
    proc = subprocess.run(
        ["pandoc", "-f", "docx", "-t", "typst", "--wrap=none", str(docx), "-o", "-"],
        capture_output=True, text=True, check=True,
    )
    return proc.stdout


@needs_pandoc
def test_pandoc_still_emits_an_unparseable_single_column_table(tmp_path):
    """PIN: the typst WRITER emits `columns: (100%)` and its own READER rejects it.

    `(100%)` is a parenthesized scalar in Typst, not a one-element array, so the reader
    fails with `Could not determine number of columns: VRatio (1 % 1)`. Pandoc's own docx
    writer manufactures the one-cell tables that hit this, by wrapping every `#figure`,
    so a real manuscript hits it once per figure — 26 times in the one this was found on
    (19 tables + 7 images), and the whole file was unrecoverable.

    If this test starts FAILING, pandoc fixed the writer and `_SINGLE_COLUMN_RE` has
    become dead weight rather than load-bearing.
    """
    src = tmp_path / "one.typ"
    src.write_text(REAL_ONE_COLUMN, encoding="utf-8")
    docx = canonicalize.typ_to_docx(src, tmp_path / "one.docx")

    raw = _raw_docx_to_typ(docx)
    assert "columns: (100%)," in raw, "pandoc no longer emits the scalar form"

    bad = tmp_path / "bad.typ"
    bad.write_text(raw, encoding="utf-8")
    with pytest.raises(canonicalize.PandocError, match="Could not determine number of columns"):
        canonicalize.typ_to_docx(bad, tmp_path / "bad.docx")

    # ...and the normalization makes exactly that text parse.
    fixed = tmp_path / "fixed.typ"
    fixed.write_text(canonicalize.normalize_recovered(raw), encoding="utf-8")
    canonicalize.typ_to_docx(fixed, tmp_path / "fixed.docx")


@needs_pandoc
def test_container_tables_do_not_grow_across_the_round_trip(tmp_path):
    """A one-cell container table is unwrapped, so the nesting cannot accumulate.

    Pandoc's docx writer wraps every `#figure` in a container (19 `<w:tbl>` in, 38 out)
    and reads the wrapper back as real nesting, so a level is added on EVERY trip: 19
    containers became 57 after one round trip and 133 after two. Without flattening there
    is no fixed point at all, so `--check` can never pass and nothing downstream of the
    canonical form works.
    """
    src = tmp_path / "body.typ"
    src.write_text(CONTAINER, encoding="utf-8")
    docx = canonicalize.typ_to_docx(src, tmp_path / "body.docx")

    once = canonicalize.canonical_from_docx(docx)
    assert "columns: (100%" not in once, "the container survived recovery"
    assert "Mirror (pro-rata)" in once, "flattening ate the table it was wrapping"
    assert once.count("#table(") == 1

    twice = canonicalize.canonicalize_text(once, resource_path=tmp_path)
    assert twice == once, "container-bearing input never reaches a fixed point"


def test_flattening_spares_a_real_one_column_table():
    """A one-column table with rows is data, not a pandoc figure wrapper."""
    assert canonicalize.flatten_container_tables(REAL_ONE_COLUMN) == REAL_ONE_COLUMN

    flat = canonicalize.flatten_container_tables(CONTAINER)
    assert flat.count("#table(") == 1
    assert "columns: (50%, 50%)" in flat

    # a container nested inside a container unwraps all the way down — which is the
    # shape the round trip itself produces, one more level per trip
    doubled = _wrap_in_container(CONTAINER)
    assert doubled.count("columns: (100%,)") == 2
    assert canonicalize.flatten_container_tables(doubled).count("columns: (100%") == 0


def test_flattening_survives_prose_that_does_not_balance():
    """Interval notation like `(0,5\\]` leaves an unclosed paren in the cell.

    A bracket-balancing scanner gives up here — and these were precisely the tables that
    needed flattening, so the failure was silent and selective.
    """
    with_interval = CONTAINER.replace("[Index]", "[(0,5\\]]")
    flat = canonicalize.flatten_container_tables(with_interval)
    assert "columns: (100%" not in flat
    assert "(0,5\\]" in flat


# ── C10: word-final apostrophes are not closing double quotes ──────────

@needs_pandoc
def test_pandoc_still_misreads_a_word_final_apostrophe(tmp_path):
    """PIN: the writer unsmartens `’` to `'`, and the reader re-reads it as `”`.

    So `Officers’ Retirement` survives one pass as `Officers'` and becomes
    `Officers” Retirement` on the second — the pipe converges on corruption instead of on
    its input. 14 of them in the manuscript, in citation titles where a wrong quote reads
    as a typo nobody traces back to the converter.
    """
    src = tmp_path / "q.typ"
    src.write_text("Police Officers' Retirement and it's fine.\n", encoding="utf-8")
    docx = canonicalize.typ_to_docx(src, tmp_path / "q.docx")
    raw = _raw_docx_to_typ(docx)
    assert "Officers”" in raw, "pandoc no longer mis-smartens a word-final apostrophe"
    assert "it's" in raw, "an interior apostrophe was never the problem"


@needs_pandoc
def test_word_final_apostrophe_round_trips(tmp_path):
    text = "Police Officers’ Retirement System and the authors’ synthesis and it’s fine.\n"
    once = canonicalize.canonicalize_text(text, resource_path=tmp_path)
    assert "”" not in once, "an apostrophe became a closing double quote"
    assert "Officers’" in once and "authors’" in once
    assert canonicalize.canonicalize_text(once, resource_path=tmp_path) == once


def test_normalization_leaves_raw_and_math_alone():
    """pandoc does not smarten inside raw spans, raw blocks or math, so neither do we."""
    assert canonicalize.normalize_recovered("A `shell x'` span.\n") == "A `shell x'` span.\n"
    block = "```py\nx = users'\n```\n"
    assert canonicalize.normalize_recovered(block) == block
    assert canonicalize.normalize_recovered("$a'$ and $b$\n") == "$a'$ and $b$\n"
    # ...but the prose beside them is still fixed
    assert canonicalize.normalize_recovered("`x'` and Officers' pay\n") == \
        "`x'` and Officers’ pay\n"


# ── C11: embedded images are never dropped silently ────────────────────

def _docx_with_image(tmp_path) -> tuple[Path, Path]:
    media = tmp_path / "media"
    media.mkdir()
    (media / "figure1.png").write_bytes(PNG_1X1)
    src = tmp_path / "body.typ"
    src.write_text(
        '= Results\n\n#figure(image("media/figure1.png", width: 1in),\n'
        "  caption: [\n    A figure.\n  ]\n)\n",
        encoding="utf-8",
    )
    return src, canonicalize.typ_to_docx(src, tmp_path / "body.docx")


@needs_pandoc
def test_recovering_an_image_without_a_media_dir_refuses(tmp_path):
    """The dangerous direction: pandoc drops images and produces a healthy-looking file.

    Seven figures vanished from a 207KB recovery with no error, leaving empty containers
    and orphaned captions. Refusing is the only outcome that surfaces the loss.
    """
    _, docx = _docx_with_image(tmp_path)
    with pytest.raises(canonicalize.PandocError, match="embeds 1 image"):
        canonicalize.canonical_from_docx(docx)


@needs_pandoc
def test_images_are_extracted_and_survive_the_round_trip(tmp_path):
    _, docx = _docx_with_image(tmp_path)
    out = tmp_path / "out"
    out.mkdir()

    recovered = canonicalize.canonical_from_docx(
        docx, media_dir=out / "media", typ_dir=out
    )
    paths = canonicalize.image_paths(recovered)
    assert len(paths) == 1, "the figure was dropped"
    assert (out / paths[0]).exists(), f"{paths[0]} is referenced but not on disk"
    assert "A figure." in recovered

    body = out / "body.typ"
    body.write_text(recovered, encoding="utf-8")
    assert canonicalize.main([str(body), "--check"]) == 0, "image paths break the fixed point"


@needs_pandoc
def test_a_missing_image_is_an_error_not_a_warning(tmp_path):
    """pandoc replaces an unfetchable image with its alt text and still exits 0."""
    src = tmp_path / "body.typ"
    src.write_text('#figure(image("media/gone.png", width: 1in))\n', encoding="utf-8")
    with pytest.raises(canonicalize.PandocError, match="could not open an image"):
        canonicalize.typ_to_docx(src, tmp_path / "out.docx")


@needs_pandoc
def test_round_trip_that_loses_an_image_raises(tmp_path):
    """A count mismatch is refused rather than returned as a shorter document."""
    with pytest.raises(canonicalize.PandocError, match="no resource_path was given"):
        canonicalize.canonicalize_text('#figure(image("media/x.png"))\n')


# ── C12: what the codex and gemini reviews found ───────────────────────
#
# Both models independently flagged the same top defects in the C9-C11 work. These pin
# the ones that reproduced. A third — "an authored one-cell callout box is flattened" —
# was a FALSE POSITIVE as reported (a single-line cell never matched the line shape), but
# a multi-line one would have, so the predicate was tightened and it is pinned below too.

CALLOUT = """#figure(
  align(center)[#table(
    columns: (100%,),
    align: (auto,),
    [#strong[Key Takeaway:]
    An authored one-cell box, not a pandoc wrapper.
    ],
  )]
  , kind: table
  )
"""


def test_an_authored_one_cell_box_is_not_flattened():
    """Only a cell that OPENS with `#figure(` is pandoc's wrapper.

    Pandoc manufactures the container exclusively around a figure — 19 of 19 in the
    manuscript. An authored callout box, framed panel or theorem block has the same
    outline and prose in the cell, and dissolving it into loose text would be silent
    data loss to clean up an artifact that is not there.
    """
    assert canonicalize.flatten_container_tables(CALLOUT) == CALLOUT
    assert canonicalize.normalize_recovered(CALLOUT) == CALLOUT


def test_a_tail_shaped_raw_block_does_not_end_the_cell_early():
    """Literal text inside a raw block must not be read as the container's closing lines."""
    trap = CONTAINER.replace(
        "    [#figure(",
        "    [#figure(\n      ```typst\n    ],\n  )]\n  , kind: table\n  )\n      ```",
        1,
    )
    flat = canonicalize.flatten_container_tables(trap)
    assert "Mirror (pro-rata)" in flat, "the cell was truncated at the raw block"
    assert flat.count("```") == 2, "the raw block was split"


def test_rewrites_never_reach_raw_blocks_or_math():
    """A document quoting Typst source must not have its examples edited.

    `_SINGLE_COLUMN_RE` originally ran over the whole document, so a fenced block showing
    `columns: (100%),` was rewritten — the normalization corrupting the content it was
    meant to preserve.
    """
    block = "```typst\ncolumns: (100%),\n```\n"
    assert canonicalize.normalize_recovered(block) == block
    span = "Write `columns: (100%),` in the source.\n"
    assert canonicalize.normalize_recovered(span) == span
    # a double-backtick span containing a single backtick stays whole
    dbl = "A ``users' ` sample`` here.\n"
    assert canonicalize.normalize_recovered(dbl) == dbl
    # ...while the real thing outside is still normalized
    assert "columns: (100%,)," in canonicalize.normalize_recovered("    columns: (100%),\n")


def test_one_stray_dollar_does_not_disable_every_later_rewrite():
    """Math is bounded to a block, so an unpaired `$` cannot swallow the document.

    With an unbounded DOTALL span, one stray `$` protected everything after it and every
    apostrophe past that point silently went uncorrected on the next round trip.
    """
    text = "Budget $100 for it.\n\nThe Officers' Retirement System.\n\nThe authors' view.\n"
    out = canonicalize.normalize_recovered(text)
    assert "Officers’" in out and "authors’" in out
    assert "$100" in out


def test_an_image_call_inside_a_raw_span_is_not_an_image():
    """Prose ABOUT an image call is not one — it must not enter the count or the mapping."""
    assert canonicalize.image_paths('A `image("fake.png")` sample.\n') == []
    assert canonicalize.image_paths('```\nimage("fake.png")\n```\n') == []

    mixed = 'Use `image("fake.png")` like #figure(image("media/real.png"))\n'
    assert canonicalize.image_paths(mixed) == ["media/real.png"]
    # the mapping lands on the real call, not the quoted one
    assert 'image("media/moved.png")' in canonicalize.set_image_paths(mixed, ["media/moved.png"])
    assert 'image("fake.png")' in canonicalize.set_image_paths(mixed, ["media/moved.png"])


# ── C13: figures are identified by content, not by pandoc's filename ───

@needs_pandoc
def test_an_unedited_return_reconciles_to_a_no_op(tmp_path):
    """The defect this pins: pandoc names extracted media after the docx's internal rIds.

    The same figure comes out of the repo's `body.typ` as `figure1.png` and out of a
    returned `.docx` as `rId9.png`, so a document the coauthor did not touch differed from
    the source on EVERY figure line — `reconcile.py` reported figures as changed that
    nobody changed, and `media/` gained a duplicate copy per run. `_adopt_media` matches
    on the bytes so both sides of the merge name the same image the same way.
    """
    media = tmp_path / "media"
    media.mkdir()
    (media / "figure1.png").write_bytes(PNG_1X1)
    body = tmp_path / "body.typ"
    body.write_text(
        '= Results\n\nProse.\n\n#figure(image("media/figure1.png", width: 1in),\n'
        "  caption: [\n    A figure.\n  ]\n)\n",
        encoding="utf-8",
    )
    body.write_text(canonicalize.canonicalize_file(body), encoding="utf-8")

    returned = tmp_path / "returned.docx"
    canonicalize.typ_to_docx(body, returned)

    theirs = canonicalize.canonical_from_docx(
        returned, "accept", media_dir=media, typ_dir=tmp_path
    )
    assert theirs == canonicalize.canonicalize_file(body), \
        "an untouched return differs from the source — every figure reads as edited"
    assert sorted(p.name for p in media.iterdir()) == ["figure1.png"], \
        "reconciling duplicated the media"


@needs_pandoc
def test_a_genuinely_changed_figure_gets_its_own_name(tmp_path):
    """Content-addressing must not collapse two DIFFERENT images onto one file."""
    media = tmp_path / "media"
    media.mkdir()
    (media / "figure1.png").write_bytes(PNG_1X1)
    other = PNG_1X1[:-4] + b"\x00\x00\x00\x00"  # same length, different bytes

    src = tmp_path / "src"
    src.mkdir()
    (src / "media").mkdir()
    (src / "media" / "figure1.png").write_bytes(other)
    body = src / "body.typ"
    body.write_text('#figure(image("media/figure1.png", width: 1in))\n', encoding="utf-8")
    docx = canonicalize.typ_to_docx(body, tmp_path / "b.docx")

    recovered = canonicalize.canonical_from_docx(docx, media_dir=media, typ_dir=tmp_path)
    names = sorted(p.name for p in media.iterdir())
    assert len(names) == 2, f"different bytes were collapsed onto one file: {names}"
    assert (media / "figure1.png").read_bytes() == PNG_1X1, "the original was overwritten"
    [ref] = canonicalize.image_paths(recovered)
    assert (tmp_path / ref).read_bytes() == other, "the reference points at the wrong bytes"


def test_adopt_media_suffixes_a_name_collision(tmp_path):
    """Same basename, different bytes: suffix rather than overwrite.

    Reached when pandoc's extracted name happens to equal one already in the media
    directory. Overwriting there would swap one figure for another with no diff to see.
    """
    media = tmp_path / "media"
    media.mkdir()
    (media / "figure1.png").write_bytes(PNG_1X1)
    incoming = tmp_path / "figure1.png"
    incoming.write_bytes(PNG_1X1[:-4] + b"\x00\x00\x00\x00")

    existing = canonicalize._digests(media)
    dest = canonicalize._adopt_media(incoming, media, existing)
    assert dest.name == "figure1-2.png"
    assert (media / "figure1.png").read_bytes() == PNG_1X1

    # ...and identical bytes reuse the existing name instead of adding a copy
    same = tmp_path / "whatever.png"
    same.write_bytes(PNG_1X1)
    assert canonicalize._adopt_media(same, media, existing).name == "figure1.png"
    assert sorted(p.name for p in media.iterdir()) == ["figure1-2.png", "figure1.png"]


# --------------------------------------------------------------------------
# Hand-authored short forms (bib_to_entries.py --shorts)
#
# citeproc derives a short form from the AUTHORS, so every work by the same
# authors collapses to one string. Bluebook Rule 4.2 needs a shortened title
# (4.2(a)) or a declared `hereinafter` form (4.2(b)) instead, and neither is
# derivable from bibliographic data. The override layer is what supplies them.
#
# These exercise load_shorts/emit directly rather than through pandoc, so they
# stay fast and do not depend on citeproc being installed.
# --------------------------------------------------------------------------

import bib_to_entries


def _entries():
    return {
        "kahan2008": {"full": "Kahan & Rock, #emph[Hanging Chads], 96 Geo. L.J. 1227",
                      "date": " (2008)", "pin-sep": ", ", "short": "Kahan & Rock"},
        "kahan2020": {"full": "Kahan & Rock, #emph[Index Funds], 100 B.U. L. Rev. 1771",
                      "date": " (2020)", "pin-sep": ", ", "short": "Kahan & Rock"},
    }


def test_shorts_override_is_typst_source_so_a_title_can_be_italicized(tmp_path):
    """The whole point: Rule 4.2(a) wants the title, and titles are italic.

    `short` is eval()'d as markup by bluebook.typ, so an override carrying
    `#emph[...]` renders italic. A schema that only accepted a plain string
    could not express a conforming short form at all.
    """
    toml = tmp_path / "short-forms.toml"
    toml.write_text('[shorts]\nkahan2008 = "Kahan & Rock, #emph[Hanging Chads]"\n')
    got = bib_to_entries.load_shorts(toml, _entries())
    assert got == {"kahan2008": "Kahan & Rock, #emph[Hanging Chads]"}


def test_shorts_rejects_an_override_for_a_key_not_in_the_bib(tmp_path):
    """A stale override is worse than none.

    It reads as though the disambiguation was handled while the citation it was
    meant to fix still renders bare -- the failure this whole layer exists to
    prevent, reintroduced silently. So it is fatal, not a warning.
    """
    toml = tmp_path / "short-forms.toml"
    toml.write_text('[shorts]\nkahan2019 = "Kahan & Rock, #emph[Nonexistent]"\n')
    with pytest.raises(SystemExit) as exc:
        bib_to_entries.load_shorts(toml, _entries())
    assert "kahan2019" in str(exc.value)


def test_shorts_rejects_a_non_string_value(tmp_path):
    toml = tmp_path / "short-forms.toml"
    toml.write_text("[shorts]\nkahan2008 = 3\n")
    with pytest.raises(SystemExit) as exc:
        bib_to_entries.load_shorts(toml, _entries())
    assert "kahan2008" in str(exc.value)


def test_a_bare_table_is_accepted_without_the_shorts_header(tmp_path):
    toml = tmp_path / "short-forms.toml"
    toml.write_text('kahan2008 = "Kahan & Rock, #emph[Hanging Chads]"\n')
    assert bib_to_entries.load_shorts(toml, _entries()) == {
        "kahan2008": "Kahan & Rock, #emph[Hanging Chads]"}


def test_emit_marks_an_overridden_short_and_stays_readable_by_typst(tmp_path):
    """The marker is provenance; the file still has to parse.

    `--diff` reads the module back with `typst eval`, so a comment that broke
    parsing would disarm the one guard against a citation changing unread.
    """
    if not shutil.which("typst"):
        pytest.skip("typst not installed")

    entries = _entries()
    entries["kahan2008"]["short"] = "Kahan & Rock, #emph[Hanging Chads]"
    text = bib_to_entries.emit(entries, "sources.bib", {"kahan2008"})
    assert "// hand-authored" in text
    assert text.count("// hand-authored") == 1, "only the overridden key is marked"

    module = tmp_path / "cite-data.typ"
    module.write_text(text, encoding="utf-8")
    back = bib_to_entries.parse_existing(module)
    assert back["kahan2008"]["short"] == "Kahan & Rock, #emph[Hanging Chads]"
    assert back["kahan2020"]["short"] == "Kahan & Rock"


def test_an_override_silences_the_collision_it_resolves(tmp_path):
    """The audit is a worklist; it has to go quiet as the work gets done.

    An audit that keeps reporting a collision already fixed trains everyone to
    stop reading it, which is how the next real one gets missed.
    """
    bib = tmp_path / "sources.bib"
    bib.write_text(
        "@article{kahan2008,\n  author = {Marcel Kahan and Edward B. Rock},\n"
        "  title = {{The Hanging Chads of Corporate Voting}},\n  year = {2008}\n}\n\n"
        "@article{kahan2020,\n  author = {Marcel Kahan and Edward B. Rock},\n"
        "  title = {{Index Funds and Corporate Governance}},\n  year = {2020}\n}\n",
        encoding="utf-8")

    assert any("shared by 2 works" in p for p in bib_to_entries.audit(bib, _entries()))

    resolved = _entries()
    resolved["kahan2008"]["short"] = "Kahan & Rock, #emph[Hanging Chads]"
    assert not any("shared by" in p for p in bib_to_entries.audit(bib, resolved))
