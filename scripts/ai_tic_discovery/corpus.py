"""Human-writing control corpus loader (the negatives set).

The corpus is pre-2020, domain-matched human academic prose (law-review and
finance/economics articles) — pre-2020 guarantees no LLM contamination, and
domain-matching means a rule that survives here won't fire on the kind of
writing the hook actually guards.

Layout (git-tracked):
    corpus/human/*.txt     one document per file, plain UTF-8 prose.

Population is out-of-band (see scripts/ai_tic_discovery/build_corpus.py): PDFs
are extracted to text once and committed, so eval/fp-hunt stay offline and
reproducible. This module only READS the committed .txt files.

Pure-stdlib so the pytest battery can import it.
"""

from __future__ import annotations

import re
from pathlib import Path

# scripts/ai_tic_discovery/corpus.py -> repo root is parents[2].
REPO_ROOT = Path(__file__).resolve().parents[2]
CORPUS_DIR = REPO_ROOT / "corpus" / "human"

# Sentence-ish splitter: break on ., !, ? followed by whitespace + capital /
# quote / digit. Crude but adequate for a line-oriented FP hunt — the real
# linter matches per source line anyway, and over-splitting only makes the
# negatives MORE granular (stricter on the rule), never looser.
_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[\"“'A-Z0-9])")
# Footnote/citation cruft and page furniture we don't want as "prose" negatives.
_SKIP_LINE = re.compile(r"^\s*(\d+\s*$|Electronic copy available|©|doi:)", re.I)


def corpus_files() -> list[Path]:
    if not CORPUS_DIR.is_dir():
        return []
    return sorted(CORPUS_DIR.glob("*.txt"))


def iter_sentences(min_chars: int = 25, max_chars: int = 400):
    """Yield (source_name, sentence) for every prose sentence in the corpus.

    Sentences shorter than `min_chars` (fragments, headings) or longer than
    `max_chars` (extraction run-ons) are skipped so the negatives are clean,
    sentence-sized human prose.
    """
    for f in corpus_files():
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for para in text.splitlines():
            para = para.strip()
            if not para or _SKIP_LINE.match(para):
                continue
            for sent in _SENT_SPLIT.split(para):
                sent = sent.strip()
                if min_chars <= len(sent) <= max_chars:
                    yield f.stem, sent


def load_negatives(min_chars: int = 25, max_chars: int = 400) -> list[str]:
    """Flat list of human sentences for evaluate_regex(negatives=...)."""
    return [s for _, s in iter_sentences(min_chars, max_chars)]


def corpus_stats() -> dict:
    files = corpus_files()
    sents = load_negatives()
    return {
        "files": len(files),
        "sentences": len(sents),
        "chars": sum(len(s) for s in sents),
    }
