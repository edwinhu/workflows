import re

MD_ROW = re.compile(r'^\s*\|.*\|\s*$')
MD_SEP = re.compile(r'^\s*\|[\s:|-]+\|\s*$')

def _tables_in_md(lines):
    """(first_line_no, caption, header_row, n_rows) for every markdown table."""
    out = []
    i = 0
    while i < len(lines) - 1:
        if MD_ROW.match(lines[i]) and MD_SEP.match(lines[i + 1]):
            start = i
            j = i + 2
            while j < len(lines) and MD_ROW.match(lines[j]):
                j += 1
            caption = ''
            for k in range(start - 1, max(-1, start - 6), -1):
                s = lines[k].strip()
                if s and not MD_ROW.match(s):
                    caption = s[:200]
                    break
            out.append((start + 1, caption, lines[start].strip()[:300], j - start - 2))
            i = j
        else:
            i += 1
    return out

def _read(abs_path):
    try:
        with open(abs_path, 'r', encoding='utf-8', errors='replace') as f:
            return f.read().splitlines()
    except Exception:
        return None

def _hits(lines, pattern, flags=re.I):
    rx = re.compile(pattern, flags)
    return [(i + 1, lines[i]) for i in range(len(lines)) if rx.search(lines[i])]

def _search(files, pattern, what, keep=40, window=0):
    """One search over every file.  Absence is a fact, recorded as an empty match list."""
    per_file, total, searched_lines = [], 0, 0
    for rel, abs_path in files:
        lines = _read(abs_path)
        if lines is None:
            per_file.append({'file': rel, 'readable': False, 'matches': []})
            continue
        searched_lines += len(lines)
        hs = _hits(lines, pattern)
        total += len(hs)
        ms = []
        for n, t in hs[:keep]:
            m = {'line': n, 'text': t.strip()[:300]}
            if window:
                lo, hi = max(1, n - window), min(len(lines), n + window)
                m['context'] = [f'{k}| {lines[k - 1][:200]}' for k in range(lo, hi + 1)]
            ms.append(m)
        per_file.append({'file': rel, 'readable': True, 'n_lines': len(lines),
                         'n_matches': len(hs), 'matches': ms})
    return {'what': what, 'pattern': pattern, 'files': [f for f, _ in files],
            'lines_searched': searched_lines, 'total_matches': total, 'per_file': per_file}

def render_json(rule, files, inventory, searched):
    obj = {
        'rule': rule,
        'files': [{'path': rel,
                   'lines': (len(_read(a)) if a and _read(a) is not None else None)}
                  for rel, a in files]
    }
    if inventory:
        obj.update(inventory)
    obj['searches'] = [{'what': s['what'], 'pattern': s['pattern'],
                        'files_searched': s['files'], 'lines_searched': s['lines_searched'],
                        'matches': [{'file': pf['file'], **m}
                                    for pf in s['per_file'] for m in pf.get('matches', [])],
                        'files_with_zero_matches':
                            [pf['file'] for pf in s['per_file'] if not pf.get('matches')]}
                       for s in searched if s is not None]
    return obj

def _render(hits, ctx_lines=None, width=400):
    return '\n'.join(f'{n:5d}| {t[:width]}' for n, t in hits)
