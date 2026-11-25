#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pikepdf"]
# ///
"""Strip identifying metadata from production artifacts, keeping ONLY the
creation and modification dates.

Those two dates are evidentiary — they date the artifact and altering them
alters the record. Everything else (author, generator, producer, tool and OS
strings, document ids, PNG text chunks) goes.

    scrub_metadata.py [--dry-run] FILE...

Handles .pdf, .docx/.xlsx/.pptx, .png. Rewrites in place; --dry-run only
reports. Reports rather than repairs a date that is obviously not real
(python-docx stamps everything 2013-12-23).
"""
import re, shutil, sys, zipfile
from pathlib import Path

KEEP_XMP = ("xmp:CreateDate", "xmp:ModifyDate", "xmp:MetadataDate")
KEEP_CORE = ("dcterms:created", "dcterms:modified")
BOGUS = ("2013-12-23",)          # python-docx's hardcoded stamp


def scrub_pdf(p: Path, dry: bool) -> list[str]:
    import pikepdf
    found = []
    with pikepdf.open(p, allow_overwriting_input=True) as pdf:
        for k, v in list(pdf.docinfo.items()):
            if str(k) in ("/CreationDate", "/ModDate"):
                continue
            found.append(f"Info {k} = {v}")
            if not dry:
                del pdf.docinfo[k]
        if pdf.Root.get("/Metadata") is not None:
            xmp = bytes(pdf.Root.Metadata.read_bytes()).decode("utf-8", "replace")
            for tag in re.findall(r"<(\w+:[\w]+)>", xmp):
                if tag.startswith(("rdf:", "x:")) or tag in KEEP_XMP:
                    continue
                found.append(f"XMP {tag}")
            if not dry:
                del pdf.Root["/Metadata"]      # dates survive in the Info dict
        if not dry:
            pdf.save(p.with_suffix(p.suffix + ".tmp"))
            p.with_suffix(p.suffix + ".tmp").replace(p)
    return found


# app.xml also carries harmless integer statistics (Pages, Words, Lines). Blanking
# those yields a file Word reads as malformed, so only the identity-bearing strings
# are cleared there. core.xml is cleared wholesale except the two dates.
APP_STRIP = ("Application", "AppVersion", "Template", "Company", "Manager",
             "LastModifiedBy", "HyperlinkBase")


def scrub_ooxml(p: Path, dry: bool) -> list[str]:
    found, out = [], {}
    with zipfile.ZipFile(p) as z:
        for n in ("docProps/core.xml", "docProps/app.xml"):
            if n not in z.namelist():
                continue
            x = z.read(n).decode("utf-8")
            # dates carry an xsi:type attribute, so match attributed tags too
            for tag, val in re.findall(r"<([\w:]+)(?:\s[^>]*)?>([^<]+)</\1>", x):
                if tag in KEEP_CORE:
                    if any(b in val for b in BOGUS):
                        found.append(f"!! {n} {tag} = {val}  (not a real date — REPORTED, not stripped)")
                    continue
                if n.endswith("app.xml") and tag not in APP_STRIP:
                    continue
                found.append(f"{n} {tag} = {val}")
                x = re.sub(rf"(<{tag}(?:\s[^>]*)?>){re.escape(val)}(</{tag}>)", r"\1\2", x)
            out[n] = x.encode("utf-8")
        if dry or not out:
            return found
        tmp = p.with_suffix(p.suffix + ".tmp")
        with zipfile.ZipFile(p) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zo:
            for i in zin.infolist():
                zo.writestr(i, out.get(i.filename, zin.read(i.filename)))
        tmp.replace(p)
    return found


def scrub_png(p: Path, dry: bool) -> list[str]:
    import struct
    d = p.read_bytes()
    found, out, i = [], bytearray(d[:8]), 8
    while i < len(d):
        ln = struct.unpack(">I", d[i:i + 4])[0]
        typ = d[i + 4:i + 8]
        if typ in (b"tEXt", b"iTXt", b"zTXt", b"eXIf"):
            found.append(f"PNG {typ.decode()} chunk ({ln} bytes)")
        else:
            out += d[i:i + 12 + ln]          # tIME is a date; it stays
        i += 12 + ln
        if typ == b"IEND":
            break
    if found and not dry:
        p.write_bytes(bytes(out))
    return found


def main() -> int:
    args = sys.argv[1:]
    dry = "--dry-run" in args
    files = [Path(a) for a in args if a != "--dry-run"]
    if not files:
        print(__doc__)
        return 2
    for f in files:
        fn = {".pdf": scrub_pdf, ".docx": scrub_ooxml, ".xlsx": scrub_ooxml,
              ".pptx": scrub_ooxml, ".png": scrub_png}.get(f.suffix.lower())
        if fn is None:
            print(f"{f}: unhandled type"); continue
        hits = fn(f, dry)
        print(f"{f}: {'would strip' if dry else 'stripped'} {len(hits)} field(s)")
        for h in hits:
            print(f"    {h}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
