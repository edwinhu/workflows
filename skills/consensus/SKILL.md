---
name: consensus
description: ALWAYS use before running the `consensus` CLI or hitting consensus.app - "search Consensus", "consensus search", "find RCT papers", "randomized trials on X", "systematic reviews / meta-analyses of X", "clinical papers on X", "empirical papers in top journals only", "papers in these specific journals", "filter by journal quartile", "most-cited papers on X since 2018". Use even when the user names a filter (study type, journal, year range, citations) without saying "Consensus". NOT for a broad multi-source literature sweep - use the research skill, which calls this one.
version: 0.2.0
user-invocable: false
---

# Consensus CLI

Search Consensus.app for academic papers via the `consensus` CLI tool.

**Binary:** `~/projects/consensus-cli/consensus`

**Requires:** a Chrome/Chromium signed in to consensus.app with CDP on port 9250 (override with `CONSENSUS_CDP_PORT`, or `CDP_PORT` for the whole CLI family).

**Check:** `ls ~/projects/consensus-cli/consensus || echo "MISSING: consensus binary not built"`

## Core Command

```bash
consensus search "<query>" [options]
consensus journals [<query>]      # exact journal names accepted by --journal
consensus publishers              # values accepted by --publisher
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
| `--journal <name>` | Restrict to one journal; **repeat** the flag for more. Names must match the index exactly |
| `--journals-file <path>` | Read journal names from a file, one per line (`#` comments and blanks skipped) |
| `--publisher <name>` | Restrict to one publisher; repeat for more |
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

## Journal Filtering — the primary quality gate

**File:** `${CLAUDE_PLUGIN_ROOT}/references/trusted-journals.local.md`

A **shared resource** — the `google-scholar` and `research` skills and the
`librarian` agent read the same file. It is the user's curated list of trusted
journals, one exact name per line, with `#` comments. It is the argument to `--journals-file` — pass the path
directly, do not re-type the names:

```bash
consensus search "<topic>" --n 50 --sort citations \
  --journals-file ~/projects/workflows/references/trusted-journals.local.md
```

**When the user asks for "journals I like", "relevant journals only", "top
journals", or a field they clearly work in, filter SERVER-SIDE with
`--journals-file` (or `--journal` for a narrower subset).** Server-side
filtering means all N results are from trusted venues, instead of filtering a
mixed result set down to two or three afterwards.

For a narrower cut, pass the subset explicitly — one flag per journal, since
journal names contain commas:

```bash
consensus search "insider trading enforcement" --n 20 \
  --journal "Journal of Finance" \
  --journal "Journal of Financial Economics" \
  --journal "Review of Financial Studies"
```

### Adding a journal to the list

A journal name that is not in Consensus's index silently matches nothing — it
does not error. **Verify before adding:**

```bash
consensus journals "review of financial"
```

Then append the exact `name` string to `trusted-journals.local.md`, under the
right `#` section.

### Publishers

`--publisher` is a coarser cut over a fixed vocabulary (`consensus publishers`
lists it: Elsevier, Wiley, Springer Nature, OUP, CUP, JAMA, NEJM, ...). Use it
when the user wants a house rather than a venue; journal filtering is otherwise
strictly better.

### Still mark, still resolve

`--journals-file` also makes the ★ pass trivial: every returned paper is from a
trusted venue, so mark them all ★ and note the filter in the preamble. Without
a journal filter, mark ★ per-paper against the same file, and run the SSRN DOI
resolution below.

## SSRN Label Detection & DOI Resolution

**SSRN label patterns** (journal field is NOT the real venue):
- Contains "eJournal", "Topic)", "SSRN Electronic Journal"
- Starts with a subject code: `PSN:`, `ERN:`, `ERPN:`, `SRPN:`, `POL:`, `LSN:`

Note that SSRN labels **cannot** appear when `--journal`/`--journals-file` is in
play — the filter matches on the indexed journal name, so working-paper labels
are excluded by construction. This section applies to unfiltered searches.

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

The MCP tool is rate-limited to 3 results per search and requires a free account. The CLI binary drives the signed-in enterprise session in the CDP browser and returns up to 100 results.

## Red Flags

| Action | Why Wrong | Do Instead |
|--------|-----------|------------|
| **Using `mcp__consensus__search` instead of the CLI** | MCP is rate-limited to 3 results; CLI has no limit | Always use `~/projects/consensus-cli/consensus` |
| **Presenting results without reading trusted-journals.local.md** | User expects journal quality signals on every search | Read the shared trusted-journal list first, always |
| **Filtering trusted journals client-side after an unfiltered search** | Wastes most of the result set — 50 results collapse to 3 | Pass `--journals-file` and get 50 trusted results |
| **Passing a journal name you did not verify** | An unindexed name matches nothing, silently — you get zero papers and blame the query | `consensus journals "<partial>"` first |
| **Comma-separating journals in one `--journal`** | Journal names contain commas; the whole string is treated as one name | Repeat the flag, or use `--journals-file` |
| **Treating SSRN topic labels as real journals without checking DOI** | The paper may be in JF or JAE — you'd miss a trusted hit | Run CrossRef DOI lookup first |
| **Skipping DOI resolution because there are many SSRN-labeled papers** | High-citation SSRN-labeled papers are often published in top venues | Resolve all of them — it's one curl per paper |
| **Using `--rank q1` as a journal quality filter** | The API maps SSRN working papers under Q1 labels — it is not reliable | Use `--journals-file` — it is now an explicit server-side filter |
| **Passing `--n` > 100** | CLI validates and rejects — exits non-zero | Max is 100 |

## Decision Tree

```
User wants papers on a topic
    ↓
Read trusted-journals.local.md
    ↓
Does the user want only their journals / "relevant" / "top" journals,
or is the topic squarely in a field the file covers?
    ↓
YES → consensus search "<topic>" --n 50 --sort citations \
        --journals-file <path to trusted-journals.local.md> [other filters]
      → every result is trusted: mark all ★, say which filter was applied
      → zero results? The filter may be too narrow for the topic —
        rerun unfiltered and mark ★ per-paper instead of widening silently
    ↓
NO  → consensus search "<topic>" --n 50 --sort citations [other filters]
      → per paper:
          journal matches the file? → ★
          SSRN label + doi present? → curl CrossRef → re-check → ★ if match
          else → unresolved / non-trusted
      → present ★ confirmed, ★ resolved, then rest
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

# Only the user's journals — the default for their own fields
consensus search "corporate governance" --n 30 --sort citations \
  --journals-file ~/projects/workflows/references/trusted-journals.local.md

# A narrower cut: the finance top three
consensus search "payout policy" --n 20 \
  --journal "Journal of Finance" \
  --journal "Journal of Financial Economics" \
  --journal "Review of Financial Studies"

# Check a name before adding it to the trusted list
consensus journals "review of financial"

# By publisher house rather than venue
consensus search "machine learning in radiology" --n 20 --publisher Elsevier --publisher Wiley
```

## Operational Notes

1. Chrome must be running with CDP and signed in. Exit codes follow sysexits: 69 = browser unreachable, 77 = not signed in, 75 = CAPTCHA/rate limit — branch on the code, do not parse stderr
2. `consensus journals` is rate-limited hard (429 → exit 75) after ~30 rapid calls. Verifying a batch of names needs ~1.5s between calls and a cool-off after a 429
3. `--rank q1` is imprecise (SSRN papers slip through) — `--journals-file` is the reliable quality gate
4. Journal filters are exact-match on the indexed name and fail silently, not loudly — an empty result set usually means a wrong name, not a dry topic
5. Law reviews ARE indexed — all fourteen T14 flagships resolve. The student-edited business specialties (Journal of Corporation Law, Delaware JCL, Harvard/Columbia BLR, Penn JBL, NYU JLB, Virginia L&B, Berkeley BLJ) are NOT; reach those with `scholar lookup --journal "<name>"`
6. `study_type` comes from Consensus badges and may be `null` for many papers
7. `open_access_pdf_url` is `null` when no PDF is available (not `undefined`)
