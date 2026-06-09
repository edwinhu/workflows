---
name: research
description: This skill should be used when the user asks to "find papers", "search academic literature", "find citations", "literature search", "find research on", "what does the literature say about", or any request to search for academic papers across multiple sources.
version: 0.2.0
user-invocable: false
---

# Academic Literature Search

Multi-source academic search with deduplication, DOI resolution, and journal filtering.

**Always read `${CLAUDE_SKILL_DIR}/../google-scholar/domain-knowledge.local.md` before presenting results.**

## IRON LAW: Always Use the Script

**NEVER run the sources manually in sequence. ALWAYS use the research script. This is not negotiable.**

```bash
uv run python3 "${CLAUDE_SKILL_DIR}/scripts/research.py" "<query>" [--n 50] [--min-citations N]
```

The script parallelizes all sources and DOI resolution automatically. Doing it manually serializes everything and triples wall time.

## Sources

| Source | Tool | Strength | Default |
|--------|------|----------|---------|
| `scholar lookup` | Keyword/citation-ranked | Finance classics, foundational papers | ✅ |
| `consensus` CLI | Empirical corpus, sorted by citations | Accounting/finance empirical literature | ✅ |
| Paperpile bib | Personal library (`My Library.bib`) | Papers already in your collection | ✅ |
| `scholar search` | NL semantic | Law reviews, conceptual literature | opt-in (`--scholar-search`) |

`scholar search` is opt-in because it shares rate limits with `scholar lookup` and 429s when run in parallel. Add `--scholar-search` when you specifically want semantic/NL results.

## Output Schema

The script outputs a JSON array. Each paper has:

```json
{
  "title": "...",
  "authors": ["..."],
  "year": 2023,
  "journal": "...",           // original journal label (may be SSRN)
  "journal_resolved": "...",  // CrossRef-resolved journal (present if SSRN label was resolved)
  "doi": "...",
  "citations": 150,
  "takeaway": "...",
  "url": "...",
  "sources": ["lookup", "consensus"]  // all sources that returned this paper
}
```

## LLM Review Step (After Script)

After running the script, read `${CLAUDE_SKILL_DIR}/../google-scholar/domain-knowledge.local.md` and cross-reference each paper's effective journal (use `journal_resolved` if present, else `journal`) against the trusted list:

- ★ = journal matches trusted list
- Papers in `sources: ["lookup", "consensus"]` (multiple sources) = higher confidence
- Papers from `bib` source = already in user's library (flag with 📚)

### Presentation Format

```
★ [Title](url) — Authors (Year), *Journal*, N citations  [sources]
  > Takeaway: ...

📚 ★ [Title](url) — Authors (Year), *Journal*  [in your library]
  > Takeaway: ...
```

Trusted papers first (sorted by citations desc), then non-trusted in a collapsed table.

## Red Flags

- About to run the sources manually in sequence → STOP. That serializes the work and triples wall time; run `uv run python3 research.py "<query>"`.
- About to call `mcp__consensus__search` → STOP. It is rate-limited to 3 results; the script uses the CLI binary automatically.
- About to present results before reading domain-knowledge.local.md → STOP. The ★ trusted-journal signals come from that file; read it first, always.
- About to use the `journal` field when `journal_resolved` is present → STOP. The SSRN label hides the real venue; always prefer `journal_resolved`.

## Common Patterns

```bash
# Standard search
uv run python3 "${CLAUDE_SKILL_DIR}/scripts/research.py" "mandatory disclosure"

# With citation floor
uv run python3 "${CLAUDE_SKILL_DIR}/scripts/research.py" "poison pill" --min-citations 50

# More results from Consensus
uv run python3 "${CLAUDE_SKILL_DIR}/scripts/research.py" "corporate governance" --n 100

# Disable streaming (wait for all sources, output pretty-printed JSON)
uv run python3 "${CLAUDE_SKILL_DIR}/scripts/research.py" "mandatory disclosure" --no-stream
```

## Streaming Mode (default)

Without `--stream`, the script waits for all four sources before emitting anything — Consensus takes ~60s, so fast sources (bib <1s, Scholar ~10s) sit idle.

With `--stream`, the script emits one NDJSON line per event as it happens:

```json
{"event": "source", "source": "bib", "papers": [...]}
{"event": "source", "source": "scholar-lookup", "papers": [...]}
{"event": "source", "source": "scholar-search", "papers": [...]}
{"event": "source", "source": "consensus", "papers": [...]}
{"event": "final", "papers": [...]}
```

- `source` events: raw papers from each source as it completes (may have duplicates across sources)
- `final` event: deduplicated + CrossRef-resolved unified set

Process `source` events as they arrive to present early results; use `final` for the complete deduplicated list. Pass `--no-stream` for batch mode (pretty-printed JSON after all sources complete).
