#!/usr/bin/env -S uv run python3
"""Constraint: ai-structural-patterns — detect AI structural filler phrases in draft text."""
import re
import sys
from pathlib import Path

# ── Shared draft extractor ─────────────────────────────────────────────
# Path traversal: <workflows>/skills/<skill>/references/<this file>
# We want         <workflows>/scripts/prose_extract.py
_SCRIPTS_DIR = Path(__file__).resolve().parents[3] / "scripts"
if (_SCRIPTS_DIR / "prose_extract.py").exists():
    sys.path.insert(0, str(_SCRIPTS_DIR))
import prose_extract  # noqa: E402

CONSTRAINT = "wikipedia-structural-patterns"
APPLIES_TO = ["writing-draft", "writing-review", "writing-revise"]
SEVERITY = "soft"

_STRUCTURAL_PATTERNS = [
    # Section-ending filler
    (r'^\s*(In\s+summary|In\s+conclusion|To\s+summarize|To\s+conclude|Overall),?\s*[A-Z]',
     "structure: section-ending summary filler ('In summary/conclusion') — cut or rewrite as argument"),
    # Despite-challenges formula
    (r'\bDespite\s+(these\s+)?(challenges?|obstacles?|difficulties|setbacks?)\b',
     "structure: 'Despite these challenges' formula — AI recovery arc, verify it's not formulaic"),
    # Negative parallelism / antithesis flourishes — match BOTH contracted
    # ('it's') and uncontracted ('it is') forms. The uncontracted variant is
    # easy to overlook because most published examples use the contraction.
    (r'\bNot\s+only\b.*\bbut\s+(also\s+)?\b',
     "structure: 'Not only...but also' — often AI padding"),
    (r'\bIt\s+is\s+not\s+just\s+(about|a\s+matter\s+of)\b',
     "structure: 'It is not just about' — AI framing cliché"),
    # "X is not Y, it is/it's Z" / "X is not Y; it is Z" / "X is not Y — it is Z"
    # Matches uncontracted "it is" as well as "it's" / "it’s".
    (r'\bis\s+not\s+[^.;:!?]{2,80}?[,;—-]\s+it[’\']?s?\s+(?:is\s+)?[a-z]',
     "structure: 'is not X, it is Y' antithesis — AI flourish, prefer the positive statement"),
    # "isn't X, it is/it's Y"
    (r"\bisn[’']t\s+[^.;:!?]{2,80}?[,;—-]\s+it[’']?s?\s+(?:is\s+)?[a-z]",
     "structure: \"isn't X, it is Y\" antithesis — AI flourish"),
    # Epigrammatic antithesis: the verbless two-/three-beat summary line that
    # contrasts scattered particulars against a single unifying point —
    # "Different rules, one direction:" / "Scattered rules, singular purpose." /
    # "Same playbook, different target." An AI summary flourish (confirmed
    # empirically: GPT + Gemini both reach for the contrastive bicolon when asked
    # to tie disparate items together). Two scoped rules, both [:.]-capped to
    # avoid legit prose ("different rules, one for each state…", "Same store,
    # same staff, same hours."):
    #   A — contrast lead → unifying tail (optional middle beat for tricolons)
    (r'\b(?:Different|Scattered|Separate|Disparate|Distinct|Varied)\s+\w+,\s+(?:\w+\s+\w+,\s+)?(?:one|a\s+single|single|the\s+same|same|singular|no)\s+(?:\w+\s+){0,2}\w+\s*[:.]',
     "structure: epigrammatic antithesis ('Different X, one Y:' / 'Scattered X, singular Y.') — AI summary flourish; state the point plainly"),
    #   B — the reverse 'Same X, different Y.' form
    (r'\bSame\s+\w+,\s+different\s+\w+\s*[:.]',
     "structure: epigrammatic antithesis ('Same X, different Y.') — AI summary flourish; state the point plainly"),
    # False-unity closer — the LLM-default op-ed/essay ending that enumerates
    # three or more unrelated items and then asserts they share one grand,
    # universal lesson ("Whether it's the Fed, the WHO, or Boeing… the lesson is
    # the same:"; "X, Y, and Z all point to one uncomfortable truth"; "are not
    # separate crises but a single…"). Confirmed empirically across BOTH models
    # (GPT/copilot 20/40, Gemini/agy 9/40 of elicited closers) and tuned to ZERO
    # false positives on 15,162 sentences of pre-2017 finance/accounting journal
    # prose (incl. Delaware opinions). Discovered via scripts/ai-tic-discovery.py
    # (see the personal ai-tic discovery harness (dotfiles)). Two scoped
    # rules — the enumerated "Whether… or…, [unifier]" lead, and the
    # manufactured-unity payload — both conservative SCHEMAS, not fixed phrases:
    #   A — "Whether [it's/we are] X, …, or Y, [the/we/our/humanity…]"
    (r'\bWhether\s+(?:it.?s|we\s+are|you\s+are|through|watching|observing|tracking)\b[^.?!]{20,200}?,\s+or\b[^.?!]{2,90}?,\s+(?:the|we|our|humanity|every)\b',
     "structure: false-unity closer ('Whether X, Y, or Z, the lesson is…') — AI flourish that manufactures unity across unrelated items; state the actual connection or cut"),
    #   B — manufactured-unity payload (lesson/truth is the same; all point to one
    #       truth; not separate crises but a single …; if X,Y,Z share anything, it is)
    (r'(?:\b(?:the\s+)?(?:lesson|throughline|thread|pattern|moral|takeaway)\s+is\s+the\s+same\b'
     r'|\b(?:all\s+)?(?:point\s+to|remind\s+us|confess|confirm|reveal|rhyme\s+with)\b[^.?!]{0,50}?\b(?:the\s+same|a\s+single|one)\b[^.?!]{0,35}?\b(?:truth|lesson|thread|throughline|story|axiom|question|failure|warning|verse|meter)\b'
     r'|\bare\s+not\s+(?:separate|isolated|unrelated|coincidences?)\b[^.?!]{0,70}?(?:\bbut\b|[—–-]\s*they\s+are)\b[^.?!]{0,40}?\b(?:a\s+single|one|the\s+same)\b'
     r'|\bIf\b[^.?!]{15,200}?\b(?:share|tell\s+us|prove)\b[^.?!]{0,15}?\banything,?\s+it\s+is\b'
     r'|\b(?:a\s+single|one|the\s+same)\s+(?:uncomfortable\s+|stubborn\s+|dark\s+|simple\s+|sobering\s+)?(?:truth|throughline|thread|axiom)\b'
     r'|\bnot\s+(?:separate\s+|isolated\s+)?(?:crises|stories|trends|coincidences|contradictions)\b[^.?!]{0,30}?(?:\bbut\b|[—–-]\s*they\s+are)\b)',
     "structure: false-unity payload ('…the lesson is the same' / 'all point to one truth' / 'not separate crises but a single…') — AI flourish forcing a grand shared meaning; make the real link explicit or cut"),
    # "These findings carry significant implications" — the LLM-default academic
    # closer that asserts the results matter ("for both theoretical and practical
    # audiences") rather than saying what they imply. Discovered by the n-gram
    # rate-ratio diff (scripts/ai-tic-discovery.py ngram-diff), then FP-gated
    # against the FULL ~11k-article finance/accounting corpus: 0 hits in
    # 8,733,332 human sentences, cross-model (GPT + Gemini). NOTE the discipline
    # this rule's siblings failed: 'contributes to the growing literature' and
    # 'implications for both theory and practice' looked clean on a 339-article
    # sample but recur in real scholarship at full scale — they were dropped.
    # See the personal ai-tic discovery harness (dotfiles).
    (r'(?:\bthese\s+findings\s+carry\b'
     r'|\b(?:findings|analysis)\s+carry\s+(?:significant\s+|important\s+|broad\s+|key\s+|profound\s+)?implications\b)',
     "structure: 'these findings carry significant implications' — AI academic closer asserting importance; state what the findings actually imply, or cut"),
    # AI gap-statement / results-framing cliché — "we identify a critical gap in
    # the literature" and the "Practically, these findings…" pivot. Surfaced by
    # the n-gram diff on the expanded (182-sample) academic LLM corpus, then
    # FP-gated against the full ~11k-article corpus: ONE near-miss in 8,733,332
    # human sentences (a structurally-identical "fill a critical gap in the …
    # literature" that can't be separated without overfitting), cross-model,
    # recall 19/182. The same expanded run also produced topic-drift noise
    # (machine-learning / ESG / "et al 2021"): modern subjects rare in a pre-2017
    # corpus rank high but are NOT tics — they were ignored. SOFT, so the lone
    # near-miss is acceptable. See the personal ai-tic discovery harness (dotfiles).
    (r'(?:\b(?:a|this|that|important|significant|key|the)\s+critical\s+gap\b'
     r'|\bcritical\s+gap\s+in\s+(?:the|our|this)\b'
     r'|\bpractically,?\s+these\s+findings\b)',
     "structure: AI gap-statement / results-framing cliché ('a critical gap in the literature' / 'Practically, these findings…') — name the specific gap or finding, don't signpost it"),
    # ", not X" parallel tail (only when followed by a prepositional/comparative
    # form that signals the antithetical-parallel cadence)
    (r',\s+not\s+(?:through|by|because|from|via|merely|only|just|simply|to)\b',
     "structure: 'X, not Y' parallel tail — substantive comparisons OK, but two stacked in one sentence is AI cadence"),
    # Weasel attributions
    (r'\b(industry|market|published?)\s+reports?\s+(suggest|indicate|show|note)\b',
     "structure: vague attribution 'industry reports suggest' — cite a specific source"),
    (r'\b(observers?|analysts?|experts?|researchers?|scholars?)\s+(have\s+)?(cited|noted|argued|suggested|observed)\b',
     "structure: vague attribution 'observers have noted' — who specifically?"),
    (r'\bhave\s+been\s+described\s+as\b',
     "structure: passive vague attribution 'have been described as' — by whom?"),
    # AI conversation openers that bleed into prose
    (r'^\s*(Certainly|Of\s+course|Absolutely|Definitely)[!,.]',
     "structure: chatbot opener at start of paragraph"),
    # Imperative scene-setting opener — the LLM-default way to introduce an
    # example ("Consider the X", "Take the X", "Picture this", "Imagine…").
    # Empirically the model's #1 reach for example-intros; reads as signposted
    # / explainer-essay. Anchored to paragraph start to stay high-signal.
    (r'^\s*(?:Consider\b|Take\s+(?:the|this)\b|Picture\s+this\b|Imagine\s+(?:a|the|that|how|if|you)\b|Look\s+no\s+further\b)',
     "structure: imperative scene-setting opener ('Consider…' / 'Take the X' / 'Picture this' / 'Imagine…') — AI-default example intro; open on the concrete sentence instead"),
]


def _find_draft_files(cwd):
    # Shared discovery — picks up .md, .markdown, .docx, .txt under
    # drafts/ and outlines/. See workflows/scripts/prose_extract.py.
    return prose_extract.find_draft_files(cwd)


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []
    draft_files = _find_draft_files(cwd)

    if not draft_files:
        return violations

    for path in draft_files:
        try:

            line_iter = list(prose_extract.iter_lines(path))

        except OSError:

            continue
        for i, line in line_iter:
            for pattern, label in _STRUCTURAL_PATTERNS:
                if re.search(pattern, line, re.IGNORECASE):
                    violations.append(
                        f"{path.relative_to(cwd)}:{i}: {label}"
                    )
    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"WARN: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
