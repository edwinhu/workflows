#!/usr/bin/env python3
"""Skill metadata system for dynamic prompt building.

This module provides infrastructure for skills to declare their metadata
and for parent skills to consume that metadata for dynamic decision-making.

Based on oh-my-opencode's metadata-driven prompt architecture.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import TypedDict, Literal, Optional
from dataclasses import dataclass
import yaml


# Type definitions
CostLevel = Literal["FREE", "CHEAP", "EXPENSIVE"]
SkillCategory = Literal["workflow", "domain", "phase", "utility"]


@dataclass
class SkillTrigger:
    """Defines when a skill should be invoked."""
    domain: str
    trigger: str


@dataclass
class SkillMetadata:
    """Complete metadata for a skill."""
    name: str
    description: str
    category: SkillCategory
    cost: CostLevel
    triggers: list[SkillTrigger]
    use_when: list[str]
    avoid_when: list[str]
    parent_skill: Optional[str] = None
    requires_approval: bool = False
    tools_required: list[str] = None
    tools_denied: list[str] = None

    def __post_init__(self):
        if self.tools_required is None:
            self.tools_required = []
        if self.tools_denied is None:
            self.tools_denied = []


class SkillMetadataRegistry:
    """Registry for all skill metadata."""

    def __init__(self, skills_dir: str):
        self.skills_dir = Path(skills_dir)
        self._metadata: dict[str, SkillMetadata] = {}
        self._load_all()

    def _load_all(self):
        """Load metadata from all skills."""
        for skill_path in self.skills_dir.rglob("SKILL.md"):
            metadata = self._parse_skill_file(skill_path)
            if metadata:
                self._metadata[metadata.name] = metadata

    def _parse_skill_file(self, path: Path) -> Optional[SkillMetadata]:
        """Parse SKILL.md frontmatter and extract metadata."""
        with open(path, 'r') as f:
            content = f.read()

        # Extract YAML frontmatter
        match = re.match(r'^---\s*\n(.*?)\n---', content, re.DOTALL)
        if not match:
            return None

        try:
            frontmatter = yaml.safe_load(match.group(1))
        except yaml.YAMLError:
            return None

        # Required fields
        if 'name' not in frontmatter or 'description' not in frontmatter:
            return None

        # Parse triggers
        triggers = []
        for trigger_dict in frontmatter.get('triggers', []):
            triggers.append(SkillTrigger(
                domain=trigger_dict['domain'],
                trigger=trigger_dict['trigger']
            ))

        return SkillMetadata(
            name=frontmatter['name'],
            description=frontmatter['description'],
            category=frontmatter.get('category', 'domain'),
            cost=frontmatter.get('cost', 'CHEAP'),
            triggers=triggers,
            use_when=frontmatter.get('use_when', []),
            avoid_when=frontmatter.get('avoid_when', []),
            parent_skill=frontmatter.get('parent_skill'),
            requires_approval=frontmatter.get('requires_approval', False),
            tools_required=frontmatter.get('tools_required', []),
            tools_denied=frontmatter.get('tools_denied', []),
        )

    def get(self, name: str) -> Optional[SkillMetadata]:
        """Get metadata for a specific skill."""
        return self._metadata.get(name)

    def get_by_category(self, category: SkillCategory) -> list[SkillMetadata]:
        """Get all skills in a category."""
        return [m for m in self._metadata.values() if m.category == category]

    def get_by_cost(self, cost: CostLevel) -> list[SkillMetadata]:
        """Get all skills at a cost level."""
        return [m for m in self._metadata.values() if m.cost == cost]

    def get_children(self, parent: str) -> list[SkillMetadata]:
        """Get all child skills of a parent."""
        return [m for m in self._metadata.values() if m.parent_skill == parent]

    def all(self) -> list[SkillMetadata]:
        """Get all registered skills."""
        return list(self._metadata.values())


def build_trigger_table(skills: list[SkillMetadata]) -> str:
    """Build a markdown trigger table from skill metadata."""
    lines = [
        "| User Intent | Skill | Trigger Words |",
        "|-------------|-------|---------------|",
    ]

    for skill in sorted(skills, key=lambda s: s.cost):
        if not skill.triggers:
            continue

        trigger_str = ", ".join(t.trigger for t in skill.triggers)
        lines.append(f"| {skill.triggers[0].domain} | `/{skill.name}` | {trigger_str} |")

    return "\n".join(lines)


def build_cost_table(skills: list[SkillMetadata]) -> str:
    """Build a cost-based decision table."""
    lines = [
        "| Skill | Cost | When to Use |",
        "|-------|------|-------------|",
    ]

    for skill in sorted(skills, key=lambda s: ("FREE", "CHEAP", "EXPENSIVE").index(s.cost)):
        use_when = skill.use_when[0] if skill.use_when else "General use"
        lines.append(f"| `/{skill.name}` | {skill.cost} | {use_when} |")

    return "\n".join(lines)


def build_delegation_table(skills: list[SkillMetadata]) -> str:
    """Build a delegation decision table."""
    lines = [
        "| Domain | Delegate To | Use When | Avoid When |",
        "|--------|-------------|----------|------------|",
    ]

    for skill in skills:
        if not skill.triggers:
            continue

        domain = skill.triggers[0].domain
        use_when = skill.use_when[0] if skill.use_when else "N/A"
        avoid_when = skill.avoid_when[0] if skill.avoid_when else "N/A"

        lines.append(f"| {domain} | `/{skill.name}` | {use_when} | {avoid_when} |")

    return "\n".join(lines)


def get_env_context() -> str:
    """Get environment context for injection into prompts.

    Based on oh-my-opencode's environment context pattern.
    """
    from datetime import datetime
    import locale

    now = datetime.now()

    # Get timezone info
    try:
        import time
        tz_name = time.tzname[time.daylight]
    except:
        tz_name = "UTC"

    # Get locale
    try:
        loc = locale.getlocale()[0] or "en_US"
    except:
        loc = "en_US"

    return f"""<workflow-env>
Current date: {now.strftime('%Y-%m-%d')}
Current time: {now.strftime('%I:%M %p')}
Timezone: {tz_name}
Locale: {loc}
Day of week: {now.strftime('%A')}
</workflow-env>"""


# Convenience functions
def load_registry(skills_dir: str = None) -> SkillMetadataRegistry:
    """Load the skill metadata registry."""
    if skills_dir is None:
        # Default to skills/ in plugin root
        plugin_root = os.environ.get('CLAUDE_PLUGIN_ROOT', os.getcwd())
        skills_dir = os.path.join(plugin_root, 'skills')

    return SkillMetadataRegistry(skills_dir)


if __name__ == "__main__":
    # Test the registry
    registry = load_registry()

    print("=== All Skills ===")
    for skill in registry.all():
        print(f"- {skill.name} ({skill.cost}) - {skill.category}")

    print("\n=== Workflow Skills ===")
    for skill in registry.get_by_category("workflow"):
        print(f"- {skill.name}: {skill.description}")

    print("\n=== Cost Table ===")
    print(build_cost_table(registry.all()))

    print("\n=== Environment Context ===")
    print(get_env_context())
