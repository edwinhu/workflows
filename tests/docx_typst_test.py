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
