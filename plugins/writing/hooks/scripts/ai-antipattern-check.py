#!/usr/bin/env python3
"""
AI Anti-Pattern Detection Hook (PostToolUse)

Scans Write/Edit tool output for AI writing anti-patterns from Wikipedia's guide.
Emits warnings to trigger immediate revision.

Severity levels:
- CRITICAL: ChatGPT artifacts, prompt refusals (always warn)
- HIGH: Puffery, promotional language (always warn)
- MEDIUM: Structural patterns (warn if multiple found)
"""

import json
import re
import sys
from typing import NamedTuple


class Pattern(NamedTuple):
    regex: str
    name: str
    fix: str


# CRITICAL: Unambiguous AI artifacts - always warn
CRITICAL_PATTERNS = [
    Pattern(r'turn\d+search\d+', 'ChatGPT search artifact', 'Remove completely'),
    Pattern(r'oaicite:\d+', 'ChatGPT citation placeholder', 'Remove or replace with real citation'),
    Pattern(r'contentReference\[', 'ChatGPT content reference', 'Remove completely'),
    Pattern(r'As an AI(?: language model)?', 'AI self-reference', 'Remove and rewrite naturally'),
    Pattern(r"I hope this (?:helps|email finds you)", 'AI sign-off phrase', 'Remove or use natural closing'),
    Pattern(r'I cannot provide', 'AI refusal phrase', 'Rewrite the content appropriately'),
    Pattern(r'(?:Let me|Allow me to) (?:help|assist|explain)', 'AI preamble', 'Start with substance instead'),
]

# HIGH: Strong AI indicators - always warn
HIGH_PATTERNS = [
    Pattern(r'\bstands as\b', '"stands as"', 'Use "shows", "demonstrates", or be specific'),
    Pattern(r'\bplays a (?:vital|crucial|pivotal|key) role\b', '"plays a vital role"', 'State the effect directly'),
    Pattern(r'\brich tapestry\b', '"rich tapestry"', 'Describe specifically what it contains'),
    Pattern(r'\bnestled (?:in|among)\b', '"nestled"', 'Use "in" or "located in"'),
    Pattern(r"\bit'?s important to note\b", '"it\'s important to note"', 'Just state the important thing'),
    Pattern(r'\bdelves? into\b', '"delves into"', 'Use "examines", "covers", or "discusses"'),
    Pattern(r'\blandscape of\b', '"landscape of"', 'Be specific about what you mean'),
    Pattern(r'\bin conclusion\b', '"in conclusion"', 'Just conclude without announcing it'),
    Pattern(r'\bgroundbreaking\b', '"groundbreaking"', 'Describe what it actually does'),
    Pattern(r'\btransformative\b', '"transformative"', 'Show the transformation with evidence'),
    Pattern(r'\bcut(?:ting)?-edge\b', '"cutting-edge"', 'Specify the technology or approach'),
    Pattern(r'\bunprecedented\b', '"unprecedented"', 'Compare to what came before'),
    Pattern(r'\bseamlessly\b', '"seamlessly"', 'Describe how it actually works'),
    Pattern(r'\brobust\b', '"robust"', 'Be specific about what makes it robust'),
    Pattern(r'\bleverag(?:e|es|ed|ing)\b', '"leverage"', 'Use "use", "employ", or be specific'),
    Pattern(r'\bsynerg(?:y|ies|istic)\b', '"synergy"', 'Describe the actual combination'),
    Pattern(r'\bholistic\b', '"holistic"', 'Be specific about what aspects'),
    Pattern(r'\bparadigm\b', '"paradigm"', 'Use simpler, more specific language'),
]

# MEDIUM: Structural patterns - warn if multiple found
MEDIUM_PATTERNS = [
    Pattern(r'\bDespite (?:these |the )?challenges?\b', '"Despite challenges" formula', 'State reality directly'),
    Pattern(r'\bHowever,.*\. Nevertheless,', 'Negative parallelism', 'Combine or rephrase'),
    Pattern(r'\bIn summary\b', '"In summary"', 'Just summarize without announcing'),
    Pattern(r'\bTo summarize\b', '"To summarize"', 'Just summarize without announcing'),
    Pattern(r'\bFirstly\b.*\bSecondly\b.*\bThirdly\b', 'Rule of three', 'Use natural number for content'),
    Pattern(r'\bsome experts (?:say|believe|argue)\b', 'Weasel wording', 'Cite specific sources'),
    Pattern(r'\bit is (?:widely )?believed\b', 'Weasel wording', 'Cite specific sources'),
    Pattern(r'\bmany (?:people|experts|researchers) (?:say|believe)\b', 'Weasel wording', 'Cite specific sources'),
]


def get_content_from_input(hook_input: dict) -> str:
    """Extract content from Write or Edit tool input."""
    tool_name = hook_input.get('tool_name', '')
    tool_input = hook_input.get('tool_input', {})

    if tool_name == 'Write':
        return tool_input.get('content', '')
    elif tool_name == 'Edit':
        return tool_input.get('new_string', '')

    return ''


def check_patterns(content: str, patterns: list[Pattern]) -> list[tuple[Pattern, list[str]]]:
    """Check content against patterns, return matches with context."""
    matches = []
    for pattern in patterns:
        found = re.findall(pattern.regex, content, re.IGNORECASE)
        if found:
            # Get unique matches
            unique = list(set(found))[:3]  # Limit to 3 examples
            matches.append((pattern, unique))
    return matches


def format_warning(critical: list, high: list, medium: list) -> str:
    """Format warning message for Claude."""
    lines = ["AI WRITING ANTI-PATTERNS DETECTED", ""]

    if critical:
        lines.append("CRITICAL (must fix):")
        for pattern, examples in critical:
            lines.append(f"  - {pattern.name}: {pattern.fix}")
            if examples:
                lines.append(f"    Found: {', '.join(repr(e) for e in examples[:2])}")
        lines.append("")

    if high:
        lines.append("HIGH (strongly recommend fixing):")
        for pattern, examples in high:
            lines.append(f"  - {pattern.name}: {pattern.fix}")
        lines.append("")

    if medium:
        lines.append("MEDIUM (consider revising):")
        for pattern, examples in medium:
            lines.append(f"  - {pattern.name}: {pattern.fix}")
        lines.append("")

    lines.append("REVISE the content to remove these patterns before proceeding.")

    return "\n".join(lines)


def main():
    try:
        hook_input = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')

    # Only check Write and Edit tools
    if tool_name not in ('Write', 'Edit'):
        sys.exit(0)

    content = get_content_from_input(hook_input)
    if not content:
        sys.exit(0)

    # Skip if content is too short (likely not prose)
    if len(content) < 100:
        sys.exit(0)

    # Skip code files
    file_path = hook_input.get('tool_input', {}).get('file_path', '')
    code_extensions = ('.py', '.js', '.ts', '.sh', '.json', '.yaml', '.yml', '.toml', '.css', '.html', '.sql')
    if file_path.endswith(code_extensions):
        sys.exit(0)

    # Check patterns
    critical_matches = check_patterns(content, CRITICAL_PATTERNS)
    high_matches = check_patterns(content, HIGH_PATTERNS)
    medium_matches = check_patterns(content, MEDIUM_PATTERNS)

    # Determine if we should warn
    should_warn = False

    # Always warn on critical
    if critical_matches:
        should_warn = True

    # Always warn on high
    if high_matches:
        should_warn = True

    # Warn on medium only if 2+ patterns found
    if len(medium_matches) >= 2:
        should_warn = True

    if should_warn:
        warning = format_warning(critical_matches, high_matches, medium_matches)
        result = {
            "systemMessage": warning
        }
        print(json.dumps(result))
    else:
        # No issues, exit cleanly
        sys.exit(0)


if __name__ == '__main__':
    main()
