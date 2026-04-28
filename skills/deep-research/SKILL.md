---
name: deep-research
description: This skill should be used when the user asks to "deep research", "comprehensive research on", "thorough investigation of", "research report on", "deep dive into", "literature review on", or needs Gemini Deep Research for web-grounded multi-source synthesis beyond what Google Scholar and Consensus provide.
version: 0.1.0
user-invocable: false
agent: librarian
---

# Deep Research

Web-grounded deep research via Gemini Interactions API.

## IRON LAW: Always Use the Script

**NEVER call the Gemini Interactions API manually. ALWAYS use `bun deep-research.ts`. This is non-negotiable.**

```bash
cd "${CLAUDE_SKILL_DIR}" && bun deep-research.ts "research query"
```

The script handles model selection, interaction submission, polling with retries, timeout enforcement, and report formatting. Calling the Interactions API by hand means you skip retry logic, miss the 65-minute timeout guard, and lose the saved report file.

## When to Use

Deep Research is the **LAST RESORT** in the librarian's source hierarchy. It costs $1-7 per query, takes minutes not seconds, and produces a broad web-grounded report rather than precise academic citations.

```
User needs information on a topic
    |
    v
Check curated sources FIRST (all must be exhausted):
  1. Paperpile bib (local library)
  2. Google Scholar (scholar search/lookup)
  3. Consensus (consensus search)
  4. NLM notebooks (existing sources)
  5. Readwise (highlights/full-text)
    |
    v
Are there still significant gaps?
    |
    +-- NO --> Stop. Curated sources are sufficient.
    |
    +-- YES
          |
          v
        Has the user explicitly asked for broader/deeper research?
          |
          +-- NO --> Report gaps, suggest deep research, WAIT for approval.
          |
          +-- YES --> Run deep-research.ts
```

### Trigger signals (use this skill):
- User says "deep research", "thorough investigation", "comprehensive report"
- User explicitly asks for web-grounded synthesis beyond academic databases
- Curated sources have been exhausted and user wants more

### NOT-triggers (do NOT use this skill):
- User wants a specific known paper -- use Scholar or Consensus
- User wants papers from their own library -- use Paperpile bib or Readwise
- User wants citation metadata -- use Scholar with `--bibtex`
- User has not exhausted curated sources yet
- User has not explicitly approved the cost

## Commands

### Basic (thorough report)

```bash
cd "${CLAUDE_SKILL_DIR}" && bun deep-research.ts "What is the current state of mandatory climate disclosure regulation worldwide?"
```

### Fast (quick scan)

```bash
cd "${CLAUDE_SKILL_DIR}" && bun deep-research.ts --fast "ESG disclosure enforcement mechanisms"
```

### Resume polling an existing interaction

```bash
cd "${CLAUDE_SKILL_DIR}" && bun deep-research.ts --status <interaction-id>
```

### JSON output (raw interaction object)

```bash
cd "${CLAUDE_SKILL_DIR}" && bun deep-research.ts --json "corporate governance reform trends"
```

## Models

| Model | Flag | Queries | Time | Cost | Use when |
|-------|------|---------|------|------|----------|
| `deep-research-max` | (default) | ~160 web queries | 5-20 min | ~$3-7 | Thorough reports, literature reviews, multi-faceted questions |
| `deep-research` | `--fast` | ~80 web queries | 2-10 min | ~$1-3 | Quick scans, narrow questions, time-sensitive requests |

## Cost Warning

**$1-7 per query. NEVER auto-invoke. Always ask the user first.**

This is the most expensive tool in the librarian's toolkit. Before every invocation:

1. Confirm the user explicitly requested deep research
2. Report which curated sources were already checked and what gaps remain
3. State the estimated cost range ($1-3 for fast, $3-7 for thorough)
4. Wait for the user's go-ahead

### Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "The user probably wants this" | $3-7 burned on assumption | Ask first, always |
| "I'll just do a quick scan" | Even --fast costs $1-3 | Check Scholar/Consensus first -- they are free |
| "The curated sources didn't have enough" | Did you try ALL five? | Exhaust Paperpile, Scholar, Consensus, NLM, Readwise before reaching for this |
| "It's faster than searching multiple sources" | It takes 5-20 minutes and costs money | The free tools return in seconds |

## Integration with Librarian Workflow

```
Paperpile bib  -->  Scholar  -->  Consensus  -->  NLM / Readwise
       (local)       (free)        (free)          (free)
                                                      |
                                                      v
                                          [GAPS IDENTIFIED + USER ASKS]
                                                      |
                                                      v
                                          Deep Research (THIS SKILL)
                                            $1-7, 2-20 min
                                                      |
                                                      v
                                          Curate results to NLM
                                          (save report, extract key sources)
```

After deep research completes:
1. Present the report to the user
2. Extract key sources cited in the report
3. If the user wants to keep specific sources, add them to NLM notebooks
4. The report is also saved to `/tmp/deep-research-<id>.md` for reference

## Red Flags -- STOP If You Catch Yourself:

| # | Action | Why Wrong | Do Instead |
|---|--------|-----------|------------|
| 1 | Using before checking curated sources | Scholar, Consensus, Paperpile, NLM, Readwise are free and fast | Exhaust all five curated sources first |
| 2 | Using for known paper lookup | Deep Research returns web-grounded reports, not citation metadata | Use `scholar lookup --bibtex` or `scholar cite` |
| 3 | Launching without user's explicit request | $1-7 per query; unauthorized spending violates trust | Report gaps, state cost, wait for go-ahead |
| 4 | Calling Interactions API directly (without the script) | Skips retry logic, timeout guard, report file save | Always use `bun deep-research.ts` |
| 5 | Ignoring the report and re-searching the same topic | Wastes another $1-7 for information you already have | Read the saved report at `/tmp/deep-research-<id>.md` |

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_API_KEY` | Yes | Gemini API key with Deep Research access |

**Timeout:** 65 minutes maximum polling duration (covers the API's 60-min hard limit plus buffer).

**Polling interval:** 10 seconds between status checks.

**Retries:** Up to 3 retries on transient errors (503, 429, service_unavailable, rate_limit).

## Output

The script prints the research report to stdout as Markdown. It also saves the report to `/tmp/deep-research-<interaction-id>.md` for later reference.

With `--json`, it prints the full interaction object as JSON (useful for debugging or extracting structured metadata).

On failure, it prints the error to stderr and exits non-zero.

## Limitations

- **Beta API** -- the Gemini Interactions API is in preview; behavior may change
- **No structured output** -- reports are free-form Markdown, not JSON-structured citations
- **Max 60 minutes** -- the API enforces a hard time limit on research sessions
- **Cost per query** -- $1-7 depending on model; no free tier
- **Web-grounded, not academic-specific** -- results include news, blogs, and general web sources alongside academic content; always cross-reference claims against Scholar/Consensus for academic rigor
- **No incremental results** -- the report arrives all at once when polling completes; no streaming
