#!/usr/bin/env -S uv run python3
# /// script
# requires-python = ">=3.9"
# dependencies = ["lxml"]
# ///
"""Three-way merge a coauthor's returned .docx against the repo's Typst source.

THE PROBLEM THIS SOLVES

A coauthor edits the Word document while the repo's source moves on. Reconciling the
two by eye is how source and docx diverge — the failure this skill exists to prevent.
A three-way merge needs an ancestor, and a returned .docx normally has none. This
script finds one, converts all three versions to the same canonical Typst, and hands
them to `git merge-file`.

    ancestor   the source revision the coauthor started from
    theirs     the returned document, their edits applied
    mine       the repo's current source

ANCESTOR RESOLUTION, IN PREFERENCE ORDER

  1. TRACKED CHANGES IN THE RETURNED FILE (best, and self-contained). If the coauthor
     tracked changes, `--track-changes=reject` reconstructs the document as it was
     before their edits and `accept` gives the edited form. One file yields BOTH sides,
     so the ancestor is exact and needs nothing from the repo — it survives even a file
     that was renamed, re-sent, or passed through a third party.

  2. `--base-docx` — the exact .docx that was sent out, if it was kept.

  3. THE PROVENANCE STAMP. `build.py` records the source's git blob sha; `git cat-file`
     recovers those bytes. This works only if that revision was COMMITTED (a blob sha
     alone does not create the object), which is the reason the stamp is a fallback and
     tracked changes are preferred.

If none resolves, the script STOPS rather than guessing. A two-way diff presented as a
merge would silently drop one side's edits — the precise failure being avoided.

CONFLICTS ARE NOT RESOLVED

Where both sides changed the same paragraph, the output carries `<<<<<<<` markers and
the exit code is non-zero. Picking a side automatically would silently discard a
coauthor's edit; a human decides. Exit 0 means a genuinely clean merge.

Usage:
    reconcile.py returned.docx --source body.typ
    reconcile.py returned.docx --source body.typ --base-docx sent.docx
    reconcile.py returned.docx --source body.typ --base ancestor.typ
    reconcile.py returned.docx --source body.typ --apply     # write the merge back
"""

from __future__ import annotations

import argparse
import difflib
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parent))

import provenance
from canonicalize import (
    PandocError,
    canonical_from_docx,
    canonicalize_file,
    canonicalize_text,
)

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

CONFLICT_MARKER = "<<<<<<<"


class ReconcileError(RuntimeError):
    pass


def has_tracked_changes(docx: Path) -> bool:
    """True if word/document.xml carries any insertion or deletion revision."""
    with zipfile.ZipFile(docx) as z:
        if "word/document.xml" not in z.namelist():
            return False
        root = etree.fromstring(z.read("word/document.xml"))
    for tag in ("ins", "del"):
        if root.find(f".//{{{W}}}{tag}") is not None:
            return True
    return False


def _git_blob(sha: str, cwd: Path) -> str | None:
    proc = subprocess.run(
        ["git", "-C", str(cwd), "cat-file", "blob", sha],
        capture_output=True, text=True, check=False,
    )
    return proc.stdout if proc.returncode == 0 else None


def resolve_ancestor(
    returned: Path,
    source: Path,
    base: Path | None = None,
    base_docx: Path | None = None,
    media_dir: Path | None = None,
) -> tuple[str, str]:
    """Return (canonical ancestor text, how it was found).

    Explicit arguments win over inference: a caller who names the base knows something
    the file does not carry.
    """
    if base:
        return canonicalize_file(base), f"--base {base}"

    if base_docx:
        return (
            canonical_from_docx(base_docx, track_changes="accept",
                                media_dir=media_dir, typ_dir=Path(source).resolve().parent),
            f"--base-docx {base_docx}",
        )

    if has_tracked_changes(returned):
        return (
            canonical_from_docx(returned, track_changes="reject",
                                media_dir=media_dir, typ_dir=Path(source).resolve().parent),
            "tracked changes (rejected)",
        )

    props = provenance.read(returned)
    sha = props.get("SourceGitSHA")
    if sha:
        blob = _git_blob(sha, Path(source).resolve().parent)
        if blob is not None:
            return (
                canonicalize_text(blob, resource_path=Path(source).resolve().parent),
                f"provenance stamp (git blob {sha[:12]})",
            )
        raise ReconcileError(
            f"the returned file is stamped with source git blob {sha[:12]}, but that object is not "
            f"in this repository. The source revision that was sent out was probably never "
            f"committed. Pass --base-docx (the file that was sent) or --base (its .typ)."
        )

    raise ReconcileError(
        "no ancestor available: the returned .docx has no tracked changes and no provenance "
        "stamp (Google Docs drops custom properties on export). Pass --base-docx or --base. "
        "Refusing to two-way diff, which would silently drop one side's edits."
    )


def merge3(mine: str, ancestor: str, theirs: str, labels: tuple[str, str, str]) -> tuple[str, int]:
    """`git merge-file -p`. Returns (merged text, conflict count).

    git merge-file exits with the number of conflicts, or 255 on an actual error — so
    a large exit code is a failure, not 128 conflicts.
    """
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        files = {}
        for name, text in (("mine", mine), ("ancestor", ancestor), ("theirs", theirs)):
            p = td / f"{name}.typ"
            p.write_text(text, encoding="utf-8")
            files[name] = p
        proc = subprocess.run(
            [
                "git", "merge-file", "-p",
                "-L", labels[0], "-L", labels[1], "-L", labels[2],
                str(files["mine"]), str(files["ancestor"]), str(files["theirs"]),
            ],
            capture_output=True, text=True, check=False,
        )
    if proc.returncode == 255 or proc.returncode < 0:
        raise ReconcileError(f"git merge-file failed: {proc.stderr.strip()}")
    return proc.stdout, proc.returncode


def reconcile(
    returned: Path,
    source: Path,
    base: Path | None = None,
    base_docx: Path | None = None,
    output: Path | None = None,
    apply: bool = False,
    media_dir: Path | None = None,
) -> dict:
    returned, source = Path(returned), Path(source)
    # Both sides of the merge must name their figures the same way, so the ancestor and
    # the returned document are recovered against the SAME media directory and the same
    # anchor — the source file's directory, where the repo's own body.typ already points.
    ancestor_text, ancestor_how = resolve_ancestor(returned, source, base, base_docx, media_dir)
    theirs_text = canonical_from_docx(
        returned, track_changes="accept", media_dir=media_dir,
        typ_dir=source.resolve().parent,
    )
    mine_text = canonicalize_file(source)

    merged, conflicts = merge3(
        mine_text, ancestor_text, theirs_text,
        (f"{source} (repo)", f"ancestor via {ancestor_how}", f"{returned} (coauthor)"),
    )

    out = Path(output) if output else source.with_suffix(".merged.typ")
    if apply:
        out = source
    out.write_text(merged, encoding="utf-8")

    diff_text = "".join(difflib.unified_diff(
        mine_text.splitlines(keepends=True), merged.splitlines(keepends=True),
        fromfile=f"a/{source}", tofile=f"b/{out}",
    ))
    diff_path = out.with_suffix(out.suffix + ".diff")
    diff_path.write_text(diff_text, encoding="utf-8")

    return {
        "ancestor": ancestor_how,
        "conflicts": conflicts,
        "merged": str(out),
        "diff": str(diff_path),
        "theirsChanged": theirs_text != ancestor_text,
        "mineChanged": mine_text != ancestor_text,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("returned", type=Path, help="the .docx the coauthor sent back")
    ap.add_argument("--source", type=Path, required=True, help="the repo's current Typst body file")
    ap.add_argument("--base", type=Path, help="explicit ancestor .typ")
    ap.add_argument("--base-docx", type=Path, help="the .docx that was originally sent out")
    ap.add_argument("--output", type=Path, help="where to write the merge (default: SOURCE.merged.typ)")
    ap.add_argument("--apply", action="store_true", help="write the merge over --source")
    ap.add_argument("--media-dir", type=Path,
                    help="sidecar directory for images embedded in the returned .docx. Required "
                         "if it has any — reconciling without it would drop every figure")
    ap.add_argument("--print-diff", action="store_true", help="also print the unified diff")

    args = ap.parse_args(argv)

    for p in (args.returned, args.source):
        if not p.exists():
            print(f"error: not found: {p}", file=sys.stderr)
            return 2

    try:
        result = reconcile(
            args.returned, args.source, args.base, args.base_docx, args.output, args.apply,
            args.media_dir,
        )
    except (ReconcileError, PandocError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    print(json.dumps(result, indent=2, sort_keys=True))
    if args.print_diff:
        sys.stdout.write(Path(result["diff"]).read_text(encoding="utf-8"))

    if result["conflicts"]:
        print(
            f"\n{result['conflicts']} conflict(s) left in {result['merged']} — both sides edited the "
            f"same passage. Resolve the <<<<<<< blocks by hand; nothing was chosen for you.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
