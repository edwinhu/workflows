#!/usr/bin/env python3
"""Turn a coauthor's untracked edits into a reviewable Word redline.

WHY THIS EXISTS

Nadya's July round carried 22 comments but only 4 tracked revisions: the rest of
her prose changes were typed with track changes OFF, so Word's review pane shows
nothing.  Rejecting every tracked change still leaves ~25 touched paragraphs.
This rebuilds those edits as real tracked changes by comparing against a
baseline, so they can be reviewed one at a time in Word or LibreOffice.

TWO OUTPUTS, AND WHY

LibreOffice's CompareDocuments does NOT diff footnote-internal text.  On a
footnote-heavy document that is the dangerous failure, not a cosmetic one: the
body redline silently carries the BASELINE's footnotes and so presents every
footnote edit (in one case including a broken `ttps://` URL the coauthor had
fixed) as though nothing had changed.

So two files are produced:

  1. body      - CompareDocuments output.  Authoritative for body prose only.
  2. footnotes - every footnote lifted into an ordinary body paragraph, then
                 compared.  Baseline footnotes are relabelled with the number
                 their counterpart carries in the revised file, so the diff
                 shows real edits instead of the numbering shift that follows
                 an inserted footnote.

CAVEAT INHERITED FROM THE DOCX

pandoc/text extraction flattens Word NOTEREF fields to cached display text, so
`supra note N` renumbering appears as an edit.  Those are not real edits.  See
the caller's own notes on NOTEREF caching.

USAGE
    python make_redline.py BASELINE.docx REVISED.docx OUTDIR
"""

import argparse
import difflib
import os
import re
import shutil
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
PORT = 2002
SOCK = f"socket,host=127.0.0.1,port={PORT};urp;StarOffice.ComponentContext"
SKIP = ("separator", "continuationSeparator", "continuationNotice")


# --------------------------------------------------------------- footnotes ---
def _para_text(p):
    out = []
    for n in p.iter():
        tag = n.tag.split("}")[-1]
        if tag == "t":
            out.append(n.text or "")
        elif tag == "tab":
            out.append(" ")
    return re.sub(r"\s+", " ", "".join(out)).strip()


def footnotes(path):
    root = ET.fromstring(zipfile.ZipFile(path).read("word/footnotes.xml"))
    out = []
    for fn in root.findall(W + "footnote"):
        if fn.get(W + "type") in SKIP:
            continue
        txt = " ".join(filter(None, (_para_text(p) for p in fn.findall(W + "p"))))
        if txt:
            out.append(txt)
    return out


def footnote_docx_pair(baseline, revised, out_base, out_rev):
    a, b = footnotes(baseline), footnotes(revised)

    # Relabel baseline footnotes with the revised file's numbering.
    labels = [None] * len(a)
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(
        None, a, b, autojunk=False
    ).get_opcodes():
        for k in range(i1, i2):
            off = k - i1
            if tag in ("equal", "replace") and j1 + off < j2:
                labels[k] = j1 + off + 1

    def render(items, labs):
        lines = ["# Footnotes\n"]
        for i, t in enumerate(items):
            n = labs[i] if labs else i + 1
            tag = f"fn {n}" if n else "fn (deleted)"
            lines.append(f"**[{tag}]**  {t}\n")
        return "\n".join(lines)

    for text, out in ((render(a, labels), out_base), (render(b, None), out_rev)):
        md = Path(out).with_suffix(".md")
        md.write_text(text, encoding="utf8")
        subprocess.run(
            ["pandoc", "--from=markdown", "--to=docx", "--wrap=none", str(md), "-o", out],
            check=True,
        )
    return len(a), len(b)


# ------------------------------------------------------------------- office ---
def _uno():
    import uno

    ctx = uno.getComponentContext()
    resolver = ctx.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver", ctx
    )
    return resolver.resolve("uno:" + SOCK)


def _start_office(profile):
    subprocess.run(["pkill", "-x", "soffice.bin"], check=False)
    time.sleep(2)
    shutil.rmtree(profile, ignore_errors=True)
    subprocess.Popen(
        [
            "soffice", "--headless", "--invisible", "--nologo", "--nodefault",
            "--norestore", f"-env:UserInstallation=file://{profile}",
            f"--accept={SOCK}",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(15)


def _clear_locks(*dirs):
    for d in dirs:
        for lock in Path(d).glob(".~lock.*"):
            lock.unlink(missing_ok=True)


def office_op(op, *args, profile, attempts=3):
    """soffice is crash-prone on a full-article compare; retry on a fresh process."""
    for attempt in range(1, attempts + 1):
        _start_office(f"{profile}_{attempt}")
        try:
            return op(_uno(), *args)
        except Exception as exc:  # noqa: BLE001 - any UNO failure is retryable
            print(f"  attempt {attempt} failed: {exc}", file=sys.stderr)
    raise RuntimeError(f"office operation failed after {attempts} attempts")


def _pv(**kw):
    from com.sun.star.beans import PropertyValue

    return tuple(PropertyValue(Name=k, Value=v) for k, v in kw.items())


def _url(p):
    import uno

    return uno.systemPathToFileUrl(os.path.abspath(p))


def accept_all(ctx, src, dest):
    smgr = ctx.ServiceManager
    desktop = smgr.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
    disp = smgr.createInstanceWithContext("com.sun.star.frame.DispatchHelper", ctx)
    doc = desktop.loadComponentFromURL(_url(src), "_blank", 0, _pv(Hidden=True))
    if doc is None:
        raise RuntimeError(f"could not load {src}")
    n = len(doc.getRedlines())
    disp.executeDispatch(
        doc.getCurrentController().getFrame(), ".uno:AcceptAllTrackedChanges", "", 0, ()
    )
    doc.storeToURL(_url(dest), _pv(FilterName="MS Word 2007 XML"))
    doc.close(False)
    return n


def compare(ctx, revised, baseline, dest):
    """NOTE the argument order.  LibreOffice treats the LOADED document as
    current and the compared file as the older one, so the revised file must be
    the one that is opened.  Reversing this silently inverts every insertion
    and deletion."""
    smgr = ctx.ServiceManager
    desktop = smgr.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
    disp = smgr.createInstanceWithContext("com.sun.star.frame.DispatchHelper", ctx)
    doc = desktop.loadComponentFromURL(_url(revised), "_blank", 0, _pv(Hidden=True))
    if doc is None:
        raise RuntimeError(f"could not load {revised}")
    disp.executeDispatch(
        doc.getCurrentController().getFrame(),
        ".uno:CompareDocuments", "", 0, _pv(URL=_url(baseline)),
    )
    n = len(doc.getRedlines())
    doc.RecordChanges = True
    doc.ShowChanges = True
    doc.storeToURL(_url(dest), _pv(FilterName="MS Word 2007 XML"))
    doc.close(False)
    return n


def relabel(path, label):
    """CompareDocuments attributes every change to 'Unknown Author'."""
    tmp = str(path) + ".tmp"
    zin = zipfile.ZipFile(path)
    zout = zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED)
    total = 0
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename in ("word/document.xml", "word/footnotes.xml", "word/endnotes.xml"):
            s, n = re.subn(
                r'(<w:(?:ins|del)\b[^>]*?w:author=")[^"]*(")',
                lambda m: m.group(1) + label + m.group(2),
                data.decode("utf8"),
            )
            total += n
            data = s.encode("utf8")
        zout.writestr(item, data)
    zout.close()
    zin.close()
    shutil.move(tmp, path)
    return total


# --------------------------------------------------------------------- main ---
def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("baseline")
    ap.add_argument("revised")
    ap.add_argument("outdir")
    ap.add_argument("--label", default="Redline vs baseline",
                    help="author name stamped on every generated revision")
    args = ap.parse_args()

    out = Path(args.outdir)
    out.mkdir(parents=True, exist_ok=True)
    profile = os.environ.get("CLAUDE_JOB_DIR", "/tmp") + "/lo_redline"
    _clear_locks(out, Path(args.baseline).parent, Path(args.revised).parent)

    accepted = out / "_revised-accepted.docx"
    n = office_op(accept_all, args.revised, str(accepted), profile=profile)
    print(f"accepted {n} pre-existing tracked revisions -> {accepted}")

    body = out / "redline_body.docx"
    n = office_op(compare, str(accepted), args.baseline, str(body), profile=profile)
    print(f"body redline: {n} changes -> {body}")

    fb, fr = out / "_fn_baseline.docx", out / "_fn_revised.docx"
    na, nb = footnote_docx_pair(args.baseline, str(accepted), str(fb), str(fr))
    print(f"footnotes: {na} baseline / {nb} revised")

    fn = out / "redline_footnotes.docx"
    n = office_op(compare, str(fr), str(fb), str(fn), profile=profile)
    print(f"footnote redline: {n} changes -> {fn}")

    for f in (body, fn):
        print(f"  relabelled {relabel(f, args.label)} revisions in {f.name}")


if __name__ == "__main__":
    main()
