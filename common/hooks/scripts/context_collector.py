#!/usr/bin/env python3
"""
Context Collector: README and AGENTS.md Discovery

Functions for finding and reading project documentation files.
"""

from __future__ import annotations

from pathlib import Path
from typing import NamedTuple


# Limits to prevent context explosion
MAX_README_LINES = 500
MAX_CONTEXT_CHARS = 50_000


class ContextFile(NamedTuple):
    """Context file information"""
    filename: str
    content: str
    source_path: Path


def find_readme(project_root: Path) -> Path | None:
    """
    Find README.md in project root.

    Args:
        project_root: Project root directory

    Returns:
        Path to README.md if exists, None otherwise
    """
    readme = project_root / 'README.md'
    return readme if readme.exists() else None


def find_agents_md(project_root: Path) -> Path | None:
    """
    Find AGENTS.md in project root.

    Args:
        project_root: Project root directory

    Returns:
        Path to AGENTS.md if exists, None otherwise
    """
    agents = project_root / 'AGENTS.md'
    return agents if agents.exists() else None


def read_readme_truncated(readme_path: Path, max_lines: int) -> str:
    """
    Read first N lines of README.

    Args:
        readme_path: Path to README file
        max_lines: Maximum lines to read

    Returns:
        Truncated README content, empty string on error
    """
    try:
        content = readme_path.read_text(encoding='utf-8')
        lines = content.split('\n')

        if len(lines) <= max_lines:
            return content

        truncated = '\n'.join(lines[:max_lines])
        truncated += f"\n\n[Truncated after {max_lines} lines for context size]"
        return truncated
    except (IOError, UnicodeDecodeError):
        return ""


def read_file_full(file_path: Path) -> str:
    """
    Read file content completely.

    Args:
        file_path: Path to file

    Returns:
        File content, empty string on error
    """
    try:
        return file_path.read_text(encoding='utf-8')
    except (IOError, UnicodeDecodeError):
        return ""


def collect_context_files(project_root: Path) -> list[ContextFile]:
    """
    Collect context files to inject.

    Finds and reads:
    - README.md (truncated to MAX_README_LINES)
    - AGENTS.md (full)

    Args:
        project_root: Project root directory

    Returns:
        List of ContextFile tuples
    """
    files: list[ContextFile] = []

    # README.md (truncated)
    readme = find_readme(project_root)
    if readme:
        content = read_readme_truncated(readme, MAX_README_LINES)
        if content:
            files.append(ContextFile(
                filename='README.md',
                content=content,
                source_path=readme
            ))

    # AGENTS.md (full)
    agents = find_agents_md(project_root)
    if agents:
        content = read_file_full(agents)
        if content:
            files.append(ContextFile(
                filename='AGENTS.md',
                content=content,
                source_path=agents
            ))

    # Limit total size
    total_chars = sum(len(f.content) for f in files)
    if total_chars > MAX_CONTEXT_CHARS:
        # Truncate README further if needed
        files = _truncate_to_limit(files, MAX_CONTEXT_CHARS)

    return files


def _truncate_to_limit(files: list[ContextFile], max_chars: int) -> list[ContextFile]:
    """
    Truncate files to fit within character limit.

    Strategy:
    - Keep AGENTS.md fully (usually small)
    - Truncate README.md to fit remaining space

    Args:
        files: List of context files
        max_chars: Maximum total characters

    Returns:
        Truncated list of files
    """
    # Separate README and others
    readme_files = [f for f in files if f.filename == 'README.md']
    other_files = [f for f in files if f.filename != 'README.md']

    # Calculate space used by other files
    other_chars = sum(len(f.content) for f in other_files)
    available_for_readme = max_chars - other_chars

    if available_for_readme <= 0:
        # No space for README, return only other files
        return other_files

    # Truncate README to fit
    result = other_files.copy()

    for readme in readme_files:
        if len(readme.content) <= available_for_readme:
            result.append(readme)
        else:
            # Truncate README content
            truncated_content = readme.content[:available_for_readme]
            # Try to truncate at last newline
            last_newline = truncated_content.rfind('\n')
            if last_newline > 0:
                truncated_content = truncated_content[:last_newline]

            truncated_content += "\n\n[Truncated due to context size limit]"

            result.append(ContextFile(
                filename=readme.filename,
                content=truncated_content,
                source_path=readme.source_path
            ))

    return result


def format_context_message(files: list[ContextFile]) -> str:
    """
    Format context files into injection message.

    Args:
        files: List of context files

    Returns:
        Formatted message string
    """
    if not files:
        return ""

    sections = []
    for file in files:
        sections.append(f"# {file.filename}\n\n{file.content.strip()}")

    combined = "\n\n---\n\n".join(sections)

    return f"""
<system-reminder>
The following project documentation is available:

{combined}
</system-reminder>
"""
