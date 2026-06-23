# Human-writing control corpus (negatives)

The false-positive control corpus for the AI-tic discovery harness: genuine,
pre-LLM human prose **in the genre the prose-lint hook actually guards**
(law-review / finance / accounting scholarship and corporate-law opinions). A
candidate AI-tic regex must score **zero hits** here before it can ship.

## Why this composition

- **Pre-2017** → guarantees no LLM contamination (written before modern LLMs).
- **Domain-matched** → finance/accounting journals + Delaware corporate-law
  opinions, the exact register the user writes in. A rule that survives this
  corpus won't fire on real scholarship. (The seed `whether_universal_lesson`
  regex drew its one false positive from a Delaware opinion — "Whether the
  merger was fair is the question…" — which is precisely why legal prose belongs
  in the negatives.)

## Not committed (copyright)

`human/*.txt` is extracted full-text from copyrighted articles and is **git-
ignored**. It is a local validation artifact, rebuilt on demand. The committed,
shippable negatives live inline in `tests/test_prose_lint_hook.py`.

## Rebuild

Source: the "ResearchPDFs" Google Drive folder (journals organised as
`JF/`, `JFE/`, `RFS/`, `TAR/`, `JAR/`, `JAE/`, `CAR/`, `RAST/`, `AH/`), shared
with the user and added to *My Drive* so Google Drive Desktop syncs it to
`~/Google Drive/My Drive/ResearchPDFs/`. Filenames are `YEAR_Authors_Title.pdf`.

```bash
# 1. Sample pre-2017 PDFs across journals → a local temp dir (materialises the
#    streamed Drive files). ~6 per journal is plenty for an FP corpus.
python3 - <<'PY'
import os, re, shutil
RP = os.path.expanduser("~/Google Drive/My Drive/ResearchPDFs")
DEST = "/tmp/corpus_pdfs"; os.makedirs(DEST, exist_ok=True)
yr = re.compile(r'^(19\d{2}|20(0\d|1[0-6]))_')
for j in ["JF","JFE","RFS","TAR","JAR","JAE","CAR","RAST","AH"]:
    d = os.path.join(RP, j)
    files = sorted(f for f in os.listdir(d) if f.endswith(".pdf") and yr.match(f))
    for f in files[::max(1,len(files)//6)][:6]:
        shutil.copy(os.path.join(d,f), os.path.join(DEST, f"{j}_{f}"))
PY

# 2. Extract body text → corpus/human/*.txt
uv run --with pymupdf4llm python3 scripts/ai_tic_discovery/build_corpus.py /tmp/corpus_pdfs/*.pdf

# 3. Confirm size
uv run --with pyyaml python3 scripts/ai-tic-discovery.py corpus
```

The committed run used 42 documents → ~15,000 sentences / 2.2M chars.
