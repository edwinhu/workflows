#!/usr/bin/env python3
"""Audit ALL footnotes via Gemini with formatting-aware text.

Uses the Gemini REST API directly (no SDK dependency).
Requires GOOGLE_API_KEY environment variable.

Usage:
    python3 scripts/gemini_audit.py --docx path/to/file.docx
    python3 scripts/gemini_audit.py --docx path/to/file.docx --output results.json
    python3 scripts/gemini_audit.py --docx path/to/file.docx --subset 3,11,33,35
"""

import argparse
import asyncio
import json
import os
import zipfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from lxml import etree

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models"

PROMPT = """You are a Bluebook citation expert (21st edition, law review footnote format).

Analyze this footnote. The text includes FORMATTING ANNOTATIONS:
- *text* = italic
- [SC]text[/SC] = small caps
- Plain text = roman (no formatting)

IMPORTANT RULES FOR LAW REVIEW FOOTNOTES (Rule 2.1):
- Case names: ITALIC (e.g., *Smith v. Jones*)
- Book titles: SMALL CAPS (e.g., [SC]Economic Analysis of Law[/SC])
- Journal/periodical names: SMALL CAPS (e.g., [SC]U. Pa. L. Rev.[/SC])
- Article/note/comment titles: ITALIC (e.g., *On the Expressive Function*)
- Signals (see, see also, cf., e.g.,): ITALIC
- Id., supra, infra: ITALIC
- Short form hereinafter names: roman (e.g., GAO Report, CRS Report)
- Statute/regulation text: roman

Only flag ACTUAL formatting errors based on the annotations shown.
Do NOT flag issues with missing footnote numbers — those have been resolved.
Do NOT flag general style preferences — only clear Bluebook violations.

FOOTNOTE {fn_num}:
{formatted_text}

Respond in JSON:
{{
  "fn_num": {fn_num},
  "issues": [
    {{
      "type": "typeface|abbreviation|short_form|other",
      "element": "the specific text element",
      "current_format": "italic|small_caps|roman",
      "correct_format": "italic|small_caps|roman",
      "rule": "Bluebook rule reference",
      "description": "brief explanation"
    }}
  ],
  "severity": "clean|minor|moderate|major",
  "false_positive_note": "any note about previously flagged issues that are actually correct"
}}
"""


def extract_formatted_footnotes(docx_path, subset=None):
    """Extract footnotes with formatting annotations from DOCX."""
    z = zipfile.ZipFile(docx_path, "r")
    root = etree.fromstring(z.read("word/footnotes.xml"))
    z.close()

    footnotes = {}
    for fn in root.findall(f".//{{{W}}}footnote"):
        fid = int(fn.get(f"{{{W}}}id", "0"))
        if fid < 1:
            continue
        if subset and fid not in subset:
            continue

        parts = []
        for r in fn.findall(f".//{{{W}}}r"):
            t = r.find(f"{{{W}}}t")
            if t is None or not t.text:
                continue
            if r.find(f"{{{W}}}footnoteRef") is not None:
                continue

            rpr = r.find(f"{{{W}}}rPr")
            is_italic = rpr is not None and rpr.find(f"{{{W}}}i") is not None
            has_sc = rpr is not None and rpr.find(f"{{{W}}}smallCaps") is not None

            text = t.text
            if is_italic and has_sc:
                parts.append(f"*[SC]{text}[/SC]*")
            elif is_italic:
                parts.append(f"*{text}*")
            elif has_sc:
                parts.append(f"[SC]{text}[/SC]")
            else:
                parts.append(text)

        for hl in fn.findall(f".//{{{W}}}hyperlink"):
            for r in hl.findall(f"{{{W}}}r"):
                t = r.find(f"{{{W}}}t")
                if t is not None and t.text:
                    parts.append(f"[LINK]{t.text}[/LINK]")

        footnotes[fid] = "".join(parts).strip()

    return footnotes


async def call_gemini(api_key, model, prompt, semaphore):
    """Call Gemini REST API with structured JSON output."""
    async with semaphore:
        url = f"{GEMINI_API}/{model}:generateContent?key={api_key}"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.1,
            },
        }
        data = json.dumps(payload).encode("utf-8")
        req = Request(url, data=data, headers={"Content-Type": "application/json"})

        loop = asyncio.get_event_loop()
        try:
            response = await loop.run_in_executor(None, lambda: urlopen(req, timeout=60))
            body = json.loads(response.read())
            text = body["candidates"][0]["content"]["parts"][0]["text"]
            return json.loads(text)
        except (HTTPError, KeyError, json.JSONDecodeError) as e:
            return {"error": str(e)}


async def audit_footnote(api_key, model, fn_num, formatted_text, semaphore):
    """Audit a single footnote via Gemini."""
    prompt = PROMPT.format(fn_num=fn_num, formatted_text=formatted_text)
    result = await call_gemini(api_key, model, prompt, semaphore)

    if "error" in result:
        print(f"  ERROR FN {fn_num}: {result['error']}")
        return {"fn_num": fn_num, "issues": [], "severity": "error", "error": result["error"]}
    return result


async def main():
    parser = argparse.ArgumentParser(description="Audit footnotes via Gemini with formatted text")
    parser.add_argument("--docx", required=True, help="Path to DOCX file")
    parser.add_argument("--output", help="Output JSON path (default: scratch/gemini_audit.json)")
    parser.add_argument("--subset", help="Comma-separated footnote IDs to audit (default: all)")
    parser.add_argument("--concurrency", type=int, default=10, help="Max concurrent Gemini calls")
    parser.add_argument("--model", default="gemini-2.5-flash", help="Gemini model name")
    args = parser.parse_args()

    docx_path = Path(args.docx)
    if not docx_path.exists():
        print(f"ERROR: {docx_path} not found")
        return

    output_path = Path(args.output) if args.output else docx_path.parent / "scratch" / "gemini_audit.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    subset = None
    if args.subset:
        subset = set(int(x.strip()) for x in args.subset.split(","))

    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("ERROR: GOOGLE_API_KEY not set")
        return

    print(f"Extracting formatted footnotes from {docx_path.name}...")
    footnotes = extract_formatted_footnotes(docx_path, subset=subset)
    print(f"Extracted {len(footnotes)} footnotes")

    if not footnotes:
        print("No footnotes to audit.")
        return

    sample_fn = next(iter(footnotes))
    print(f"\nSample FN {sample_fn}:")
    print(f"  {footnotes[sample_fn][:200]}")

    print(f"\nAuditing {len(footnotes)} footnotes via Gemini ({args.model})...")
    semaphore = asyncio.Semaphore(args.concurrency)

    tasks = []
    for fn_num, text in sorted(footnotes.items()):
        tasks.append(audit_footnote(api_key, args.model, fn_num, text, semaphore))

    results = await asyncio.gather(*tasks)

    with open(output_path, "w") as f:
        json.dump(results, f, indent=2)

    by_severity = {}
    total_issues = 0
    for r in results:
        sev = r.get("severity", "unknown")
        by_severity[sev] = by_severity.get(sev, 0) + 1
        total_issues += len(r.get("issues", []))

    print(f"\nResults saved to {output_path}")
    print(f"Total issues found: {total_issues}")
    print("By severity:")
    for sev, count in sorted(by_severity.items()):
        print(f"  {sev}: {count}")


if __name__ == "__main__":
    asyncio.run(main())
