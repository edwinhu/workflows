---
name: consensus
description: This skill should be used when the user asks to "search Consensus", "consensus search", "find RCT papers", "find clinical papers", "search medical literature via consensus", "find papers on consensus.app", or needs to search Consensus.app for academic/medical literature via the consensus CLI tool.
version: 0.1.0
user-invocable: false
---

# Consensus CLI

Search Consensus.app for academic papers via the `consensus` CLI tool.

**Binary:** `~/projects/consensus-cli/consensus`

**Requires:** Dia browser running with CDP enabled on port 9222.

**Check:** `ls ~/projects/consensus-cli/consensus || echo "MISSING: consensus binary not built"`

## Core Command

```bash
consensus search "<query>" [options]
```

### Flags

| Flag | Description |
|------|-------------|
| `--n <int>` | Result count (default 20, max 100) |
| `--type <csv>` | Study types: `rct,systematic,meta,non_rct,observational,lit_review,case,animal,in_vitro` |
| `--years <range>` | Year range: `2018-2024` or past N years (e.g. `5`) |
| `--min-citations <int>` | Minimum citation count |
| `--rank <q1\|q2\|q3\|q4>` | Journal quartile filter (SJR) |
| `--human` | Human studies only |
| `--rct` | Shorthand for `--type rct` |
| `--open-access` | Open access papers only |
| `--domain <csv>` | Fields of study (e.g. `Medicine,Chemistry`) |
| `--country <csv>` | Country filter (e.g. `USA,UK`) |
| `--page <int>` | Page number (default 0) |
| `--sort <field>` | Client-side sort: `citations` (descending) |

### Output Fields (per paper)

```json
{
  "title": "...",
  "authors": ["..."],
  "year": 2023,
  "journal": "...",
  "doi": "...",
  "citations": 150,
  "study_type": "rct",
  "takeaway": "One-sentence finding...",
  "open_access_pdf_url": "https://... or null",
  "url": "https://consensus.app/papers/..."
}
```

## Domain Knowledge Integration

**ALWAYS read the domain knowledge file before presenting results.**

**File:** `${CLAUDE_SKILL_DIR}/../google-scholar/domain-knowledge.local.md`

This file contains the user's curated list of trusted journals and authors. Use it to:

1. **Mark trusted sources** — ★ before papers whose `journal` matches a trusted journal
2. **Resolve SSRN labels via DOI** — when `journal` looks like an SSRN label, use the `doi` field to look up the real journal (see DOI Resolution below)
3. **Filter on request** — when user asks for "relevant journals only", return only ★ papers
4. **Suggest refinements** — use known trusted authors to suggest follow-up searches

## SSRN Label Detection & DOI Resolution

**SSRN label patterns** (journal field is NOT the real venue):
- Contains "eJournal", "Topic)", "SSRN Electronic Journal"
- Starts with a subject code: `PSN:`, `ERN:`, `ERPN:`, `SRPN:`, `POL:`, `LSN:`

**When a paper has an SSRN-label journal AND a non-null `doi`:**

```bash
curl -s "https://api.crossref.org/works/<doi>" | uv run python3 -c "
import json, sys
d = json.load(sys.stdin)
msg = d.get('message', {})
ct = msg.get('container-title', [])
print(ct[0] if ct else 'NOT FOUND')
"
```

Use the resolved journal name to re-check against the trusted list. If it matches, mark ★ with a note: `★ (resolved via DOI from SSRN label)`.

**If doi is null or CrossRef returns no container-title:** leave as unresolved SSRN label.

### Presentation Format

```
★ [Title](url) — Authors (Year), *Journal*, N citations
  > Takeaway: ...

★ [Title](url) — Authors (Year), *Resolved Journal* (resolved via DOI), N citations
  > Takeaway: ...

[Title](url) — Authors (Year), *Journal* [SSRN label, unresolved], N citations
  > Takeaway: ...
```

Trusted papers first (confirmed then resolved), then unresolved, then non-trusted.

## IRON LAW: Always Use the CLI Binary

**NEVER use `mcp__consensus__search`. ALWAYS use the `~/projects/consensus-cli/consensus` binary. This is not negotiable.**

The MCP tool is rate-limited to 3 results per search and requires a free account. The CLI binary uses the enterprise account session in Dia and returns up to 100 results with no rate limit.

## Red Flags — STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|--------|-----------|------------|
| **Using `mcp__consensus__search` instead of the CLI** | MCP is rate-limited to 3 results; CLI has no limit | Always use `~/projects/consensus-cli/consensus` |
| **Presenting results without reading domain-knowledge.local.md** | User expects journal quality signals on every search | Read domain knowledge first, always |
| **Treating SSRN topic labels as real journals without checking DOI** | The paper may be in JF or JAE — you'd miss a trusted hit | Run CrossRef DOI lookup first |
| **Skipping DOI resolution because there are many SSRN-labeled papers** | High-citation SSRN-labeled papers are often published in top venues | Resolve all of them — it's one curl per paper |
| **Using `--rank q1` as a journal quality filter** | The API maps SSRN working papers under Q1 labels — it is not reliable | Use domain-knowledge.local.md + DOI resolution instead |
| **Passing `--n` > 100** | CLI validates and rejects — exits non-zero | Max is 100 |

## Decision Tree

```
User wants papers on a topic
    ↓
Read domain-knowledge.local.md
    ↓
Run: consensus search "<topic>" --n 50 --sort citations [filters]
    ↓
For each paper:
  journal matches trusted list? → ★
  journal is SSRN label + doi present? → curl CrossRef → re-check → ★ if match
  else → unresolved / non-trusted
    ↓
Present: ★ confirmed, ★ resolved, then rest
    ↓
User wants "only relevant journals"?
  YES → Return only ★ papers
  NO  → Return all, stars indicate quality
```

## Common Patterns

```bash
# Basic search — sort by citations to surface highest-impact papers first
consensus search "mandatory disclosure effects" --n 50 --sort citations

# Restrict to RCTs
consensus search "aspirin cardiovascular" --rct --n 10

# Recent papers, high-citation
consensus search "ESG disclosure" --years 5 --min-citations 50

# Systematic reviews only
consensus search "minimum wage employment" --type systematic

# Combine server-side quartile hint with domain-knowledge filtering
consensus search "corporate governance" --rank q1 --n 30
# (then filter ★ from output using domain-knowledge.local.md)
```

## Operational Notes

1. Dia browser must be running — if CDP fails, the CLI exits 1 with "Dia browser not running (CDP port 9222 unreachable)"
2. Consensus.app uses guest-mode rate limiting — avoid rapid back-to-back searches
3. `--rank q1` is imprecise (SSRN papers slip through) — domain-knowledge.local.md is the reliable quality gate
4. `study_type` comes from Consensus badges and may be `null` for many papers
5. `open_access_pdf_url` is `null` when no PDF is available (not `undefined`)
