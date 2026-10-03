import re

from _common import render_json
from _scholar import MAX_ITEMS, SIGNAL_RX, authority_kinds, clip, load, pieces, prose_files, scope_note, touches

DELIVERABLE = 'law review'

PROPOSITION = ('A "supra" short form is used for an authority Bluebook rule 4.2 bars from it: a case; a '
               'statute, including one cited through an institutional author or website ("State of '
               'Delaware, supra note 25" for DGCL § 216); a constitution; a regulation; a restatement; a '
               'model code; or legislative material other than a hearing, including a bill, enacted or not '
               '("119th Congress, supra note 3" for S. 1670). A regulation includes an agency adopting or '
               'proposing release published in the Federal Register (rule 14.2(a)), such as an SEC final '
               'or proposed rule cited by its release title with a [hereinafter] short form ("2020 SEC '
               'Regulation, supra note 4" for 85 Fed. Reg. 55,082). Rule 4.2 excepts only an extremely '
               'long name, which a release title is not. Those take their own short forms ("Brown, 347 '
               'U.S. at 495"; "tit. 8, § 216"; "S. 1670 § 2"; "Proxy Voting Advice, 87 Fed. Reg. at '
               '43,170" if the rule is cited in the same footnote or one of the preceding five, rule '
               '14.6(c)) or a repeated full cite. A release not published in the Federal Register, such '
               'as a no-action letter or a litigation release, is not a regulation, and rule 4.2 allows '
               'it supra as an unpublished or agency document. A supra for a book, article, report, '
               'hearing, court filing, periodical, unpublished or nonprint source is correct, and so is '
               'an internal cross-reference ("supra Part II.A", "supra note 12").')

CRITERIA = {
    'VIOLATED': 'at least one supra short form refers to a case, a statute (also when cited through an '
                'institutional author or website), a constitution, a regulation (including an agency '
                'adopting or proposing release published in the Federal Register), a restatement, a model '
                'code, a bill (enacted or not) or other non-hearing legislative material',
    'SATISFIED': 'every supra short form refers to a source rule 4.2 allows (books, articles, reports, '
                 'hearings, court filings, periodicals, unpublished or nonprint material, an agency release '
                 'not published in the Federal Register) or is an internal cross-reference',
    'NOT_APPLICABLE': 'the state holds no supra short form that names a source',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('supra_short_forms',)
# what the inventory read, whole-file: 0 over a covered file is UNAVAILABLE, never MET (rule-check.ts)
EXAMINED = 'n_sentences_searched'

# `Name, supra note 12, at 4` / `Name, supra, at 4` / `Name, supra notes 3-4`; an internal
# cross-reference (`supra Part II`, `supra text accompanying note 3`, bare `supra note 3`) is not one.
SUPRA_RX = re.compile(r'([^;]{1,160}?),?\s+supra(?:\s+notes?\s+([\d?]+))?(?=[\s,.;]|$)')
XREF_RX = re.compile(r'\bsupra\s+(?:Parts?|Sections?|§|text|notes?\s+[\d?]+\s+and accompanying|'
                     r'[IVX]+\b|subsection|pp?\.)', re.IGNORECASE)


def _name(lead):
    lead = re.split(r'(?<=[.)\]])\s+(?=[A-Z])|;', lead)[-1].strip()
    return SIGNAL_RX.sub('', lead).strip(' ,')


def _origin(notes, k, name):
    """The earliest note up to k that defines `name` (hereinafter) or names it outside a supra."""
    key = name.split(',')[0].strip()
    for p in notes[:k + 1]:
        if f'hereinafter {key}' in p['text']:
            return p
    last = key.split()[-1] if key.split() else ''
    for p in notes[:k + 1]:
        i = p['text'].find(last)
        if last and i >= 0 and not re.match(r'[^;]{0,40}?\bsupra\b', p['text'][i:]):
            return p
    return None


def evidence(files, plan_lines=None, changed=None):
    sites, n_all, n_xref = [], 0, 0
    docs = load(files)
    for doc in docs:
        notes = doc['notes']
        by_n = {n['n']: n for n in notes}
        for k, note in enumerate(notes):
            n_xref += len(XREF_RX.findall(note['text']))
            for m in SUPRA_RX.finditer(note['text']):
                if XREF_RX.match(note['text'], m.start() + m.group(0).rfind('supra')):
                    continue
                name = _name(m.group(1))
                if not name or re.search(r'(?:^|\s)(?:[Ss]ee|[Cc]f\.|accord|also)$', name):
                    continue
                n_all += 1
                if not touches(changed, doc['file'], note['line'], note['end_line']):
                    continue
                target = m.group(2)
                tnote = by_n.get(int(target)) if target and target.isdigit() else None
                first = _origin(notes, k, name)
                key = name.split(',')[0].split()[-1]
                full = tnote if tnote and key in tnote['text'] else first
                clause = next((c for c in pieces(full['text']) if key in c), full['text']) if full else ''
                sites.append({
                    'file': doc['file'], 'line': note['line'], 'footnote': note['n'],
                    'short_form': clip(name + m.group(0)[m.group(0).rfind(','):] if ',' in m.group(0)[len(m.group(1)):]
                                       else name + ', supra', 200),
                    'name_before_supra': clip(name, 120),
                    'full_cite_clause_naming_it': clip(clause, 300) if full else None,
                    'authority_kind_hint_from_that_clause': authority_kinds(clause) if full else [],
                    'points_to_note': target,
                    'that_note_text': clip(tnote['text'], 400) if tnote else None,
                    'earliest_note_naming_it': ({'footnote': first['n'], 'text': clip(first['text'], 400)}
                                                if first and first is not tnote else None),
                })
    inventory = {
        'n_sentences_searched': sum(len(p['sentences']) for d in docs for p in d['paras']),
        'supra_short_forms': sites[:MAX_ITEMS],
        'n_supra_short_forms_listed': len(sites),
        'n_supra_short_forms_in_files': n_all,
        'n_internal_cross_references_skipped': n_xref,
    }
    if scope_note(changed):
        inventory['diff_scope_note'] = scope_note(changed)
    return render_json('L-SUPRA', prose_files(files), inventory, [])
