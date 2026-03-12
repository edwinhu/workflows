#!/usr/bin/env python3
"""
SessionEnd hook: Scan transcript for user correction patterns.

Writes pending-patterns.json if repeated corrections detected.
The SessionStart hook reads this file and suggests /pattern-capture.

Must complete within 1.5s (SessionEnd default timeout).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# Regexes that indicate user corrections (case-insensitive)
CORRECTION_PATTERNS = [
    r"\bno[,.]?\s+(don'?t|stop|not|never|instead|again)\b",
    r"\bi\s+(already|just)\s+(told|said|asked|mentioned)\b",
    r"\b(wrong|incorrect|that'?s not|not what i)\b",
    r"\byou keep\b",
    r"\bagain[,.]?\s+(don'?t|please|stop)\b",
    r"\bi keep (telling|saying|asking|having to)\b",
    r"\bhow many times\b",
]

COMPILED_PATTERNS = [re.compile(p, re.IGNORECASE) for p in CORRECTION_PATTERNS]

def get_pending_file(cwd: str) -> Path:
    """Get project-scoped pending patterns file path.

    Uses the same project directory convention as Claude Code:
    ~/.claude/projects/-Users-foo-projects-bar/pending-patterns.json
    """
    if not cwd:
        return Path.home() / '.claude' / 'pending-patterns.json'

    # Claude Code encodes project path by replacing / with -
    # e.g., /Users/foo/projects/bar -> -Users-foo-projects-bar
    project_slug = cwd.replace('/', '-')
    if project_slug.startswith('-'):
        pass  # Keep leading dash (matches Claude Code convention)
    return Path.home() / '.claude' / 'projects' / project_slug / 'pending-patterns.json'


def scan_transcript(transcript_path: str) -> list[dict]:
    """Scan JSONL transcript for user correction messages.

    Returns list of {text, line_number} for messages matching correction patterns.
    """
    corrections = []
    try:
        with open(transcript_path) as f:
            for line_num, line in enumerate(f, 1):
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue

                # Only look at user messages (human turns)
                if entry.get('type') != 'human':
                    continue

                # Extract text content
                content = entry.get('content', '')
                if isinstance(content, list):
                    # Content blocks format
                    text_parts = []
                    for block in content:
                        if isinstance(block, dict) and block.get('type') == 'text':
                            text_parts.append(block.get('text', ''))
                        elif isinstance(block, str):
                            text_parts.append(block)
                    text = ' '.join(text_parts)
                elif isinstance(content, str):
                    text = content
                else:
                    continue

                if not text.strip():
                    continue

                # Check against correction patterns
                for pattern in COMPILED_PATTERNS:
                    if pattern.search(text):
                        # Truncate for storage
                        snippet = text[:200].strip()
                        corrections.append({
                            'text': snippet,
                            'line': line_num,
                            'pattern': pattern.pattern,
                        })
                        break  # One match per message is enough

    except (IOError, OSError) as e:
        print(f"[PatternScan] Failed to read transcript: {e}", file=sys.stderr)

    return corrections


def main():
    # Read hook input
    try:
        hook_input = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, KeyError):
        hook_input = {}

    transcript_path = hook_input.get('transcript_path', '')
    if not transcript_path:
        sys.exit(0)

    cwd = hook_input.get('cwd', '')
    pending_file = get_pending_file(cwd)

    # Scan for corrections
    corrections = scan_transcript(transcript_path)

    if len(corrections) < 2:
        # Below threshold — clean up any stale pending file
        if pending_file.exists():
            try:
                pending_file.unlink()
            except OSError:
                pass
        sys.exit(0)

    # Write pending patterns for SessionStart to pick up
    pending = {
        'session_transcript': transcript_path,
        'correction_count': len(corrections),
        'samples': corrections[:5],  # Keep it small
        'cwd': cwd,
    }

    try:
        pending_file.parent.mkdir(parents=True, exist_ok=True)
        pending_file.write_text(json.dumps(pending, indent=2))
        print(f"[PatternScan] Found {len(corrections)} corrections, wrote {pending_file}", file=sys.stderr)
    except (IOError, OSError) as e:
        print(f"[PatternScan] Failed to write pending patterns: {e}", file=sys.stderr)

    sys.exit(0)


if __name__ == '__main__':
    main()
