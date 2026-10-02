"""Shared extraction for the authoring rules: file kinds, changed lines, frontmatter, sections.

A rule sees only the lines the change added or edited when rule-check passes `changed`; without it
(a file handed over with no diff info) the whole file counts as changed.
"""
import os
import re

SUBJECT = 'one skill, plugin or workflow authoring change (SKILL.md, agent .md, manifests, .planning/ files)'
DELIVERABLE = 'authoring'
MAX_ITEMS = 25
TEXT = 300

FENCE = re.compile(r'^\s*(```|~~~)')
HEADING = re.compile(r'^(#{1,6})\s+(.*)$')


def kind(label):
    """skill | agent | command | context | manifest | planning | other."""
    parts = label.split('/')
    base = parts[-1]
    if '.planning' in parts[:-1]:
        return 'planning'
    if base == 'SKILL.md':
        return 'skill'
    if base.endswith('.md') and 'agents' in parts[:-1]:
        return 'agent'
    if base.endswith('.md') and 'commands' in parts[:-1]:
        return 'command'
    if base in ('CLAUDE.md', 'AGENTS.md') or (base.endswith('.md') and 'rules' in parts[:-1]):
        return 'context'
    if base in ('plugin.json', 'marketplace.json', 'hooks.json'):
        return 'manifest'
    return 'other'


# files the harness loads into context on every invocation (~/.claude/CLAUDE.md rule 8)
CONTEXT_LOADED = ('skill', 'agent', 'command', 'context')


def clip(s, n=TEXT):
    s = s.strip()
    return s if len(s) <= n else s[:n] + '…'


def changed_set(label, changed, n_lines):
    """1-based line numbers the change touched; every line when there is no diff info for the file.
    A pure deletion arrives as [c + 0.5, c + 0.5] and touches no whole line."""
    if changed is None or label not in changed:
        return set(range(1, n_lines + 1))
    out = set()
    for lo, hi in changed[label]:
        a, b = int(-(-lo // 1)), int(hi // 1)  # ceil(lo), floor(hi)
        out.update(range(max(1, a), min(n_lines, b) + 1))
    return out


def whole_file_changed(label, changed, n_lines):
    return n_lines > 0 and len(changed_set(label, changed, n_lines)) == n_lines


def frontmatter(lines):
    """(end_line, {key: (first_line, last_line, value)}) for a leading --- block; (0, {}) if none."""
    if not lines or lines[0].strip() != '---':
        return 0, {}
    keys, cur = {}, None
    for i in range(1, len(lines)):
        t = lines[i]
        if t.strip() in ('---', '...'):
            return i + 1, keys
        m = re.match(r'^([A-Za-z_][\w-]*):\s*(.*)$', t)
        if m:
            cur = m.group(1)
            keys[cur] = [i + 1, i + 1, m.group(2)]
        elif cur and (t.startswith((' ', '\t')) or not t.strip()):
            keys[cur][1] = i + 1
            keys[cur][2] += ' ' + t.strip()
    return 0, {}


def unquote(v):
    v = v.strip()
    if v[:1] in ('>', '|'):
        v = v[1:].lstrip('-+').strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in '"\'':
        v = v[1:-1]
    return v


def body(lines):
    """[(n, text, heading)] for every body line outside frontmatter and code fences; heading is the
    nearest markdown heading above it."""
    end, _ = frontmatter(lines)
    out, fence, heading = [], False, ''
    for i in range(end, len(lines)):
        t = lines[i]
        if FENCE.match(t):
            fence = not fence
            continue
        if fence:
            continue
        h = HEADING.match(t)
        if h:
            heading = clip(h.group(2), 120)
        out.append((i + 1, t, heading))
    return out


def blocks(rows):
    """Consecutive non-blank rows grouped: [[(n, text, heading), ...], ...]."""
    out, cur = [], []
    for r in rows:
        if r[1].strip():
            cur.append(r)
        elif cur:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def root_of(label, abs_path):
    a = os.path.abspath(abs_path)
    return a[: -len(label)].rstrip('/') if a.endswith(label) else os.path.dirname(a)
