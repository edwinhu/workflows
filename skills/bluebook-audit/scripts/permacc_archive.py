#!/usr/bin/env python3
"""Archive URLs via Perma.cc API and optionally write back to DOCX.

Usage:
    # Archive all URLs (dry run - shows what would be archived)
    python3 scripts/permacc_archive.py --data scratch/footnotes_data.json --dry-run

    # Archive all URLs
    python3 scripts/permacc_archive.py --data scratch/footnotes_data.json --api-key YOUR_KEY

    # Archive and write perma.cc links back to DOCX
    python3 scripts/permacc_archive.py --data scratch/footnotes_data.json --docx file.docx --api-key YOUR_KEY --write-docx

    # Use a specific folder (default: uncategorized)
    python3 scripts/permacc_archive.py --data scratch/footnotes_data.json --api-key YOUR_KEY --folder 12345
"""

import argparse
import json
import os
import time
import zipfile
from pathlib import Path

import requests
from lxml import etree

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"

PERMACC_API = "https://api.perma.cc/v1"


def load_url_inventory(data_path):
    """Load URLs from footnotes data, deduplicate, and filter."""
    with open(data_path) as f:
        data = json.load(f)

    urls = data.get("url_inventory", [])
    needs_archive = []
    seen = set()

    for u in urls:
        url = u["url"].rstrip(";")  # clean trailing semicolons
        # Skip perma.cc links
        if "perma.cc" in url:
            continue
        # Skip duplicates
        if url in seen:
            continue
        # Strip tracking params
        if "utm_source" in url:
            url = url.split("?")[0]
            if url in seen:
                continue
        seen.add(url)
        needs_archive.append({
            "fn_id": u["fn_id"],
            "url": url,
        })

    return needs_archive


def archive_url(url, api_key, folder=None):
    """Create a Perma.cc archive for a URL. Returns archive GUID or None."""
    headers = {"Authorization": f"ApiKey {api_key}"}
    payload = {"url": url}
    if folder:
        payload["folder"] = folder

    try:
        resp = requests.post(
            f"{PERMACC_API}/archives/",
            json=payload,
            headers=headers,
            timeout=60,
        )
        if resp.status_code == 201:
            data = resp.json()
            return data.get("guid")
        else:
            print(f"    ERROR {resp.status_code}: {resp.text[:200]}")
            return None
    except requests.RequestException as e:
        print(f"    ERROR: {e}")
        return None


def load_existing_archives(archive_path):
    """Load previously created archives."""
    if archive_path.exists():
        with open(archive_path) as f:
            return json.load(f)
    return {}


def save_archives(archives, archive_path):
    """Save archive mapping."""
    with open(archive_path, "w") as f:
        json.dump(archives, f, indent=2)


def write_to_docx(archives, docx_path):
    """Write perma.cc URLs back to DOCX footnotes as hyperlinks."""
    z_in = zipfile.ZipFile(docx_path, "r")
    fn_xml = z_in.read("word/footnotes.xml")
    fn_root = etree.fromstring(fn_xml)

    # Load existing rels
    rels_xml = z_in.read("word/_rels/footnotes.xml.rels")
    rels_root = etree.fromstring(rels_xml)

    changes = 0
    for url, info in archives.items():
        guid = info.get("guid")
        if not guid:
            continue
        perma_url = f"https://perma.cc/{guid}"
        fn_id = info.get("fn_id")

        fn = fn_root.find(f".//{{{W}}}footnote[@{{{W}}}id='{fn_id}']")
        if fn is None:
            continue

        # Find and replace the URL in text runs
        for r in fn.findall(f".//{{{W}}}r"):
            t = r.find(f"{{{W}}}t")
            if t is not None and t.text and url in t.text:
                t.text = t.text.replace(url, perma_url, 1)
                t.set(XML_SPACE, "preserve")
                changes += 1
                break

        # Also check hyperlinks
        for hl in fn.findall(f".//{{{W}}}hyperlink"):
            r_id = hl.get(f"{{{R_NS}}}id")
            if r_id:
                # Find the relationship and update target
                for rel in rels_root:
                    if rel.get("Id") == r_id and rel.get("Target") == url:
                        rel.set("Target", perma_url)
                        changes += 1
                        break

    if changes == 0:
        print("No DOCX changes needed")
        z_in.close()
        return

    print(f"Writing {changes} URL replacements to DOCX...")
    fn_out = etree.tostring(fn_root, xml_declaration=True, encoding="UTF-8", standalone=True)
    rels_out = etree.tostring(rels_root, xml_declaration=True, encoding="UTF-8", standalone=True)

    temp_path = docx_path.with_suffix(".tmp.docx")
    with zipfile.ZipFile(temp_path, "w", zipfile.ZIP_DEFLATED) as z_out:
        for item in z_in.infolist():
            if item.filename == "word/footnotes.xml":
                z_out.writestr(item, fn_out)
            elif item.filename == "word/_rels/footnotes.xml.rels":
                z_out.writestr(item, rels_out)
            else:
                z_out.writestr(item, z_in.read(item.filename))
    z_in.close()

    os.replace(temp_path, docx_path)
    print("DOCX updated successfully")


def main():
    parser = argparse.ArgumentParser(description="Archive URLs via Perma.cc")
    parser.add_argument("--data", required=True, help="Path to footnotes_data.json (from extract_footnotes.py)")
    parser.add_argument("--docx", help="Path to DOCX file (required for --write-docx)")
    parser.add_argument("--archives", help="Path to archives JSON (default: scratch/permacc_archives.json beside --data)")
    parser.add_argument("--api-key", help="Perma.cc API key (or set PERMACC_API_KEY env var)")
    parser.add_argument("--folder", help="Perma.cc folder ID")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be archived")
    parser.add_argument("--write-docx", action="store_true", help="Write perma.cc URLs to DOCX")
    parser.add_argument("--delay", type=float, default=3.0, help="Seconds between API calls")
    args = parser.parse_args()

    data_path = Path(args.data)
    if not data_path.exists():
        print(f"ERROR: {data_path} not found")
        return

    archive_path = Path(args.archives) if args.archives else data_path.parent / "permacc_archives.json"
    archive_path.parent.mkdir(parents=True, exist_ok=True)

    urls = load_url_inventory(data_path)
    archives = load_existing_archives(archive_path)

    print(f"URLs to archive: {len(urls)}")
    print(f"Already archived: {len(archives)}")

    if args.dry_run:
        print("\nDry run - would archive:")
        for u in urls:
            status = "DONE" if u["url"] in archives else "PENDING"
            print(f"  [{status}] FN {u['fn_id']}: {u['url']}")
        return

    api_key = args.api_key or os.environ.get("PERMACC_API_KEY")
    if not api_key:
        print("ERROR: --api-key required, or set PERMACC_API_KEY env var")
        return

    # Archive URLs
    new_count = 0
    for i, u in enumerate(urls):
        url = u["url"]
        if url in archives and archives[url].get("guid"):
            guid = archives[url]["guid"]
            print(f"  [{i+1}/{len(urls)}] FN {u['fn_id']}: already archived -> perma.cc/{guid}")
            continue

        print(f"  [{i+1}/{len(urls)}] FN {u['fn_id']}: archiving {url[:80]}...")
        guid = archive_url(url, api_key, folder=args.folder)

        if guid:
            archives[url] = {
                "fn_id": u["fn_id"],
                "guid": guid,
                "perma_url": f"https://perma.cc/{guid}",
            }
            new_count += 1
            save_archives(archives, archive_path)
            print(f"    -> perma.cc/{guid}")
        else:
            archives[url] = {"fn_id": u["fn_id"], "guid": None, "error": True}
            save_archives(archives, archive_path)

        if i < len(urls) - 1:
            time.sleep(args.delay)

    print(f"\nNewly archived: {new_count}")
    print(f"Total archived: {sum(1 for a in archives.values() if a.get('guid'))}")

    if args.write_docx:
        if not args.docx:
            print("ERROR: --docx required when using --write-docx")
            return
        docx_path = Path(args.docx)
        if not docx_path.exists():
            print(f"ERROR: {docx_path} not found")
            return
        write_to_docx(archives, docx_path)


if __name__ == "__main__":
    main()
