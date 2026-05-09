# Embedding Batches with Gemini

Dedicated reference for batch embedding work. Read this before submitting any embedding job >3 items.

## TL;DR

1. **Pick the right model.** Default to `gemini-embedding-001` for short-text classification; only use `-2` if you have multimodal inputs or strong evidence -001 underperforms.
2. **Use file-based JSONL with a per-row `key`.** Inline (`inlined_requests`) silently scrambles response order at scale.
3. **Map outputs back by `key`**, not by position.
4. **Run sentinel verification** after parse: cosine of saved-row vs fresh sync embed of the same text must be ≥0.99.
5. **Look at existing repo code first.** If `src/*embedding*.py` or a prior batch JSONL exists, copy that pattern verbatim.

## Choosing an Embedding Model

| Model | When to use | Available batch path |
|---|---|---|
| **`gemini-embedding-001`** | **Default for text-only tasks** (short titles, sentences, classification, retrieval over text) | `client.batches.create_embeddings()` (Standard API only) |
| `gemini-embedding-2` | Multimodal inputs (text+image), or you have benchmarks showing -2 wins your specific task | `client.batches.create_embeddings()` (Standard API only) |
| `text-embedding-005` | You need Vertex AI Batch console visibility; legacy text encoder | `client.batches.create()` with `vertexai=True` |

**Default to -001 unless you have a reason to switch.** Empirical (PPM TOC project, 2026-04-26): on a 21,796-title classification head-to-head over the same 17 canonical anchors with sentinel-verified alignment, `-001` produced **mean cosine 0.872** to the top anchor vs `-2`'s **0.751**. The two models agreed on best-section assignment only 52.5% of the time, and `-2` over-classified to common attractors (e.g., entries titled literally "Risk Factors" landing in *Plan of Distribution*). `-2` is multimodal-retrained — its text-side geometry is noisier on short titles than the text-specialized `-001`.

**Tradeoffs:**
- `-001` is text-only; embedding 3072-dim by default; SEMANTIC_SIMILARITY task type produces unit-norm vectors
- `-2` is multimodal; same dimensionality and task types; better suited if you'll later embed images alongside text
- `-005` (`text-embedding-005`) is a legacy text encoder accessible via Vertex Batch — use only if you need a Vertex job visible in Cloud Console
- Vertex AI Batch Prediction does **NOT** accept `gemini-embedding-*` models (verified 2026-04, returns 400 `Do not support publisher model ...`). For Gemini-family embeddings, use the Standard API path below.

**Don't switch models mid-project.** If your existing analysis or canonical anchors are embedded with model X, downstream embeddings must use X. Cosine geometries are not portable across models — switching means re-embedding everything (entries + anchors) and re-validating any thresholds.

## The Inline Path Bug — Why You MUST Use Keys

`client.batches.create_embeddings(src={"inlined_requests": EmbedContentBatch(contents=[...])})` returns responses in an undefined order at scale:

- **3-text test:** order preserved (response[i] = embedding of input[i]).
- **21K-text production:** order **scrambled** across parallel workers; positional alignment is wrong.
- `InlinedEmbedContentResponse` has **no per-row key field** — only `response` and `error`. There is no way to recover input→output mapping from inline output alone.
- The bug is silent: norms are unit (looks healthy), embeddings are individually correct, but `saved[i]` is not the embedding of `input[i]` for most i. Detected only by sentinel comparison.

**Lesson learned the hard way (2026-04):** burned two production batches (-2 and -001, ~22K texts each) before discovering this. The fix below was already in repo at `src/toc_embeddings.py`.

## Production Pattern — File-Based, Keyed

### 1. Build keyed JSONL

```python
import json
with open("embed_requests.jsonl", "w") as f:
    for entry in entries:
        f.write(json.dumps({
            "key": entry["id"],                      # YOUR identifier — round-trips unchanged
            "request": {
                "content": {"parts": [{"text": entry["title"]}]},
                "task_type": "SEMANTIC_SIMILARITY",  # snake_case in JSONL
                "output_dimensionality": 3072,       # snake_case in JSONL
            },
        }) + "\n")
```

`key` is your domain identifier (e.g. `"<doc_id>:<entry_idx>"`). Must be unique per row.

### 2. Upload + submit

```python
from google import genai
from google.genai.types import EmbeddingsBatchJobSource

client = genai.Client()  # GOOGLE_API_KEY
uploaded = client.files.upload(
    file="embed_requests.jsonl",
    config={"mime_type": "application/jsonl"},
)
job = client.batches.create_embeddings(
    model="gemini-embedding-001",
    src=EmbeddingsBatchJobSource(file_name=uploaded.name),
    config={"display_name": "embed_v1"},
)
```

### 3. Parse results by `key`

Output JSONL has one line per request, with the same `key`:
```
{"key": "doc_A:0", "response": {"embedding": {"values": [0.012, -0.034, ...]}}}
```

```python
import numpy as np
client = genai.Client()
job = client.batches.get(name=job_name)
blob = client.files.download(file=job.dest.file_name)

embeddings = {}
for line in blob.decode().splitlines():
    if not line.strip(): continue
    rec = json.loads(line)
    embeddings[rec["key"]] = np.array(rec["response"]["embedding"]["values"], dtype=np.float32)

out = np.array([embeddings[e["id"]] for e in entries], dtype=np.float32)
np.save("embeddings.npy", out)
```

### 4. Sentinel verification (mandatory)

After parsing, fresh-embed 5 random titles via sync API and assert cosine ≥0.99:

```python
from google.genai import types
import random
config = types.EmbedContentConfig(task_type="SEMANTIC_SIMILARITY", output_dimensionality=3072)
random.seed(7)
for i in random.sample(range(len(entries)), 5):
    fresh = np.array(client.models.embed_content(
        model="gemini-embedding-001", contents=entries[i]["title"], config=config
    ).embeddings[0].values)
    sim = float((out[i] @ fresh) / (np.linalg.norm(out[i]) * np.linalg.norm(fresh)))
    assert sim >= 0.99, f"row {i} mismatch: cos={sim:.4f} — alignment broken"
```

If any sentinel fails, do not proceed downstream — re-check key uniqueness, parse logic, and that you used file-based (not inline) submission.

## Schema Reference

**JSONL request line (snake_case):**
```json
{"key": "<your_id>", "request": {"content": {"parts": [{"text": "..."}]}, "task_type": "SEMANTIC_SIMILARITY", "output_dimensionality": 3072}}
```

**Job config:** `{"display_name": "..."}` — that's it. No `dest=` for embeddings (output goes to a file the SDK manages).

**Output access:**
- File-based: `job.dest.file_name` → `client.files.download(file=...)` → JSONL with `{"key": ..., "response": {"embedding": {"values": [...]}}}` per line.
- Inline (avoid): `job.dest.inlined_embed_content_responses` → positional list, no keys, order **unreliable** at scale.

**Task types:** `SEMANTIC_SIMILARITY`, `RETRIEVAL_DOCUMENT`, `RETRIEVAL_QUERY`, `CLASSIFICATION`, `CLUSTERING`. Match the task type used for your canonical anchors — mismatch breaks cosine geometry.

## Sync API Quirk — TESTING ONLY

`client.models.embed_content(contents=[t1, t2, t3])` with `gemini-embedding-2` returns ONLY ONE embedding — the list gets concatenated. (Differs from `-001`, which batched.) Use sync for single-text smoke tests only:

```python
v = client.models.embed_content(
    model="gemini-embedding-001",
    contents=text,                       # single string
    config=types.EmbedContentConfig(task_type="SEMANTIC_SIMILARITY", output_dimensionality=3072),
).embeddings[0].values
```

For production batches (≥4 texts), always use the file-based keyed path above.

## Working example

`examples/embeddings_batch.py` — `submit / status / download` CLI implementing this exact pattern with built-in sentinel verification.
