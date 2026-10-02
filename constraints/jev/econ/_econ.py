"""Shared extraction for the econ register rules: the legal set's scholarly-document reader, plus
the sentence spans a finance or accounting paper's rules are about."""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'legal'))

from _scholar import MAX_ITEMS, clip, heading_at, load, prose_files, scope_note, touches  # noqa: F401

EXHIBIT_RX = re.compile(r'\b(?:Tables?|Figures?|Fig\.|Panels?|Columns?|Exhibits?|Appendix|Internet Appendix|'
                        r'Online Appendix)\s+(?:[A-Z]{0,3}\.?\d+(?:\.\d+)?|[IVX]+\b|[A-Z]\b)|@(?:tbl|fig):[\w:-]+',
                        re.IGNORECASE)


def sentences(files, changed=None):
    """[{file, line, end_line, in_scope, heading, sentence, before, after, paragraph_exhibits}]."""
    out = []
    for doc in load(files):
        for p in doc['paras']:
            ss = p['sentences']
            ex = sorted({m.group(0) for s in ss for m in EXHIBIT_RX.finditer(s[2])})
            for i, (line, end, t) in enumerate(ss):
                out.append({'file': doc['file'], 'line': line, 'end_line': end,
                            'in_scope': touches(changed, doc['file'], line, end),
                            'heading': heading_at(doc, line), 'sentence': t,
                            'before': ss[i - 1][2] if i else None,
                            'after': ss[i + 1][2] if i + 1 < len(ss) else None,
                            'paragraph_exhibits': ex[:8]})
    return out


def span(s, n=400):
    return {'file': s['file'], 'line': s['line'], 'section': s['heading'], 'sentence': clip(s['sentence'], n),
            'before': clip(s['before'], 250) if s['before'] else None,
            'after': clip(s['after'], 250) if s['after'] else None}
