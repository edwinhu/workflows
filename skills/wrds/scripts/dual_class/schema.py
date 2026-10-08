"""Response schema (Vertex responseSchema subset) and stdlib validation of a parsed answer. No network."""
import re

DUAL = ['true', 'false', 'unclear']
LOCATIONS = ['cover', 'item5', 'capital_stock_note', 'vote_window', 'multiple', 'none']

SCHEMA = {
    'type': 'OBJECT',
    'properties': {
        'dual': {'type': 'STRING', 'enum': DUAL},
        'classes': {'type': 'ARRAY', 'items': {
            'type': 'OBJECT',
            'properties': {
                'name': {'type': 'STRING'},
                'votes_per_share': {'type': 'STRING'},
                'shares_outstanding': {'type': 'INTEGER', 'nullable': True},
            },
            'required': ['name', 'votes_per_share', 'shares_outstanding']}},
        'evidence_quote': {'type': 'STRING'},
        'location': {'type': 'STRING', 'enum': LOCATIONS},
    },
    'required': ['dual', 'classes', 'evidence_quote', 'location'],
}


def norm(s):
    return re.sub(r'[^a-z0-9]+', ' ', str(s).lower().replace('’', "'")).strip()


def quote_in_bundle(quote, bundle):
    """Every '...'-separated fragment of >=15 normalised chars occurs in the normalised bundle; >=1 such fragment."""
    frs = [norm(f) for f in re.split(r'\.\.\.|…', quote)]
    frs = [f for f in frs if len(f) >= 15]
    nb = norm(bundle)
    return bool(frs) and all(f in nb for f in frs)


def validate_output(obj, bundle=None):
    """Return a list of problems ([] = valid). Structure, enums, types, then business rules; the verbatim-quote check
    runs only when `bundle` is given."""
    p = []
    if not isinstance(obj, dict):
        return ['not an object']
    for k in SCHEMA['required']:
        if k not in obj:
            p.append(f'missing {k}')
    if p:
        return p
    if obj['dual'] not in DUAL:
        p.append(f'dual not in {DUAL}: {obj["dual"]!r}')
    if obj['location'] not in LOCATIONS:
        p.append(f'location not in {LOCATIONS}: {obj["location"]!r}')
    if not isinstance(obj['evidence_quote'], str):
        p.append('evidence_quote not a string')
    if not isinstance(obj['classes'], list):
        p.append('classes not an array')
        return p
    for i, c in enumerate(obj['classes']):
        if not isinstance(c, dict):
            p.append(f'classes[{i}] not an object'); continue
        for k in ('name', 'votes_per_share', 'shares_outstanding'):
            if k not in c:
                p.append(f'classes[{i}] missing {k}')
        if not isinstance(c.get('name'), str) or not isinstance(c.get('votes_per_share'), str):
            p.append(f'classes[{i}] name/votes_per_share must be strings')
        so = c.get('shares_outstanding')
        if so is not None and (isinstance(so, bool) or not isinstance(so, int)):
            p.append(f'classes[{i}].shares_outstanding must be integer or null')
    if p:
        return p
    if obj['dual'] == 'true':
        if len(obj['classes']) < 2:
            p.append('dual=true needs >=2 classes')
        if not obj['evidence_quote'].strip():
            p.append('dual=true needs evidence_quote')
    if bundle is not None and obj['evidence_quote'].strip() and not quote_in_bundle(obj['evidence_quote'], bundle):
        p.append('evidence_quote not found verbatim in bundle')
    return p
