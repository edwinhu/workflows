#!/usr/bin/env -S uv run python3
"""Detect widows in a compiled PDF and surgically bind last-two-words in the
markdown paragraph that produces each widow.

Workflow:
    1. Compile DOCX + PDF (via build_docx.py --pdf).
    2. Run this script against the PDF + the project's drafts/ directory.
    3. For each widow detected, find the matching paragraph in drafts/*.md
       and replace the last regular space with `\ ` (pandoc non-breaking space).
    4. Recompile — widow should be gone or the paragraph will at least have a
       binding that prevents single-word widows on the last line.

Usage:
    fix_widows.py PDF PROJECT_DIR [--dry-run]

Approach: widow detection outputs the penultimate line ("prev") and the
widowed last line. The penultimate line's tail is usually unique enough to
find the paragraph in the markdown. Once located, we bind the last space.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# Import detect_widows from check_widows in the same directory
sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_widows import detect_widows  # noqa: E402


def normalize(s: str) -> str:
    """Collapse whitespace, drop pandoc nbsp markers, reconnect hyphen-breaks,
    strip footnote superscripts/markers so PDF text matches markdown.

    Transforms applied:
      - `\\ ` → ` ` (nbsp back to regular space)
      - `-\\s+` → `-` (reconnect hyphen-line-break splits)
      - `[^label]` → `` (strip markdown footnote markers)
      - trailing digits after `.` or `)` (footnote superscripts in PDF) → ``
    """
    s = s.replace('\\ ', ' ')
    s = re.sub(r'-\s+', '-', s)
    s = re.sub(r'\[\^[^\]]+\]', '', s)  # markdown footnote markers
    # PDF-side footnote superscripts: digits immediately after . ) ] " or a word end
    s = re.sub(r'([.?!\)"\]])\d{1,3}(?=\s|$)', r'\1', s)
    s = re.sub(r'\s+', ' ', s)
    return s.strip()


def find_and_bind(drafts_dir: Path, prev_tail: str, widow_line: str, dry_run: bool = False) -> bool:
    """Find the paragraph in drafts/*.md whose rendered text ends with
    `prev_tail ... widow_line` and bind its last space with nbsp.

    Returns True if a paragraph was located and modified (or would be, under
    dry-run).
    """
    # Build a matcher from the widow signature: last ~6 words of prev_tail
    # followed by the widow line. Use a normalized compact form.
    target_end = normalize(f"{prev_tail} {widow_line}")
    # Take the last ~50 chars as the signature (more-than-unique typically)
    signature = target_end[-60:] if len(target_end) >= 60 else target_end

    for draft in sorted(drafts_dir.glob('*.md')):
        text = draft.read_text()
        # Split into paragraphs
        parts = re.split(r'\n\s*\n', text)
        for i, para in enumerate(parts):
            para_normalized = normalize(para)
            if para_normalized.endswith(signature):
                # Located. Bind last non-bracket, non-nbsp space with `\ `.
                new_para = _bind_last_space(para)
                if new_para == para:
                    continue  # already bound or no space found
                if dry_run:
                    print(f"  would bind in {draft.name}: ...{signature}")
                    return True
                parts[i] = new_para
                draft.write_text('\n\n'.join(parts))
                print(f"  bound in {draft.name}: ...{signature}")
                return True
    print(f"  ! could not locate paragraph for widow: ...{signature}")
    return False


def _bind_last_space(para: str) -> str:
    """Replace the last non-bracket, non-nbsp space in the paragraph with `\ `."""
    text = para.rstrip()
    trailing = para[len(text):]
    depth = 0
    last_space = -1
    for i, c in enumerate(text):
        if c == '[':
            depth += 1
        elif c == ']':
            depth = max(0, depth - 1)
        elif c == ' ' and depth == 0:
            if i > 0 and text[i-1] == '\\':
                continue
            last_space = i
    if last_space < 0:
        return para
    return text[:last_space] + '\\ ' + text[last_space+1:] + trailing


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('pdf', type=Path, help='Path to compiled PDF')
    ap.add_argument('project_dir', type=Path, help='Project root (contains drafts/)')
    ap.add_argument('--header', type=str, default=None,
                    help='Running-header text to ignore (e.g., "MIRROR VOTING")')
    ap.add_argument('--dry-run', action='store_true',
                    help='Report fixes without modifying files')
    ap.add_argument('--loop', action='store_true',
                    help='Loop: bind → rebuild → re-detect until no widows (max 5 iters). '
                         'Requires build_docx.py in same directory.')
    ap.add_argument('--max-iter', type=int, default=5,
                    help='Max loop iterations (default 5)')
    args = ap.parse_args()

    if not args.pdf.exists():
        print(f"ERROR: {args.pdf} not found", file=sys.stderr)
        return 1
    drafts = args.project_dir / 'drafts'
    if not drafts.exists():
        print(f"ERROR: {drafts} not found", file=sys.stderr)
        return 1

    def fix_once() -> int:
        widows = detect_widows(args.pdf, running_header=args.header)
        if not widows:
            return 0
        print(f"Found {len(widows)} widows. Binding each:\n")
        fixed = 0
        for prev, last in widows:
            if find_and_bind(drafts, prev, last, dry_run=args.dry_run):
                fixed += 1
        print(f"\n{'(dry-run) ' if args.dry_run else ''}Bound {fixed} of {len(widows)} widow paragraphs.")
        return fixed

    if not args.loop:
        fixed = fix_once()
        if fixed and not args.dry_run:
            print("Recompile and re-run check_widows.py to verify.")
        return 0

    # Loop mode: bind → rebuild → re-detect until no widows or stall.
    import subprocess
    build_script = Path(__file__).parent / 'build_docx.py'
    prev_signatures: set[str] = set()
    for i in range(1, args.max_iter + 1):
        print(f"\n=== Iteration {i} ===")
        current_widows = detect_widows(args.pdf, running_header=args.header)
        current_sigs = frozenset(
            normalize(f"{prev} {last}")[-60:] for prev, last in current_widows
        )
        if not current_widows:
            print(f"\nConverged at iteration {i} — no widows remain.")
            return 0
        if current_sigs == prev_signatures:
            print(f"\nStalled at iteration {i}: same widows after rebuild.")
            print("Likely cause: hyphen-break in a compound word. Reword or use "
                  "non-breaking hyphen. Remaining widows:")
            for prev, last in current_widows:
                print(f"  ...{prev[-70:]}\n     >>> {last} <<<")
            return 2
        prev_signatures = current_sigs

        fixed = fix_once()
        if fixed == 0 or args.dry_run:
            return 0
        print(f"Rebuilding PDF...")
        r = subprocess.run(
            ['uv', 'run', 'python3', str(build_script), str(args.project_dir), '--pdf'],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            print(f"ERROR: build failed:\n{r.stderr}", file=sys.stderr)
            return 1
    print(f"\nReached max-iter={args.max_iter} with widows still present. Manual fix needed.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
