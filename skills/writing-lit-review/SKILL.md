---
name: writing-lit-review
description: "Internal skill for literature review and source materialization. Called after brainstorm, before setup. NOT user-facing."
user-invocable: false
disable-model-invocation: true
---

# Literature Review & Source Materialization

Gather, discover, and materialize all sources into `references/` so downstream phases (setup, draft, cite-check) operate on local files only.

**Prerequisites:** Brainstorm complete. User has confirmed topic, angle, and audience. Research themes identified (3-6 themes from brainstorm).

```
brainstorm (themes + angle)
     ↓
 LIT REVIEW (this skill)
     ├─ Channel 1: Scholar + Consensus → Paperpile → rclone → references/*.pdf
     ├─ Channel 2: Readwise (personal reading) → export → references/*.md
     ├─ Channel 3: NLM deep research → Obsidian web clipper (user-driven)
     ↓
 setup (PRECIS + OUTLINE + sources.bib)
```

<EXTREMELY-IMPORTANT>
## The Iron Law of Source Materialization

**NO SETUP WITHOUT MATERIALIZED SOURCES. This is not negotiable.**

Before PRECIS.md or OUTLINE.md exist, `references/` must contain local copies of every source you plan to cite. A PRECIS built on metadata-only sources leads to claims that cite-check cannot verify.

**If you catch yourself writing sources.bib entries without local files backing them, STOP.**
</EXTREMELY-IMPORTANT>

## Three Channels — No Overlap

Each channel owns a distinct source type. Never route a source through the wrong channel.

| Channel | Owns | Discovery tool | Storage | Materialization |
|---------|------|---------------|---------|-----------------|
| **Paperpile** | Academic papers (journals, working papers, SSRN) | Scholar + Consensus | Paperpile library | `rclone copy` PDF → `references/<bibkey>.pdf` |
| **Readwise** | User's personal reading (articles, reports, PDFs they've highlighted) | Readwise search | Readwise Reader | `readwise reader-get-document-details` → `references/<bibkey>.md` |
| **Obsidian** | Web sources from deep research (SEC speeches, blog posts, comment letters, news) | NLM deep research | Obsidian vault via web clipper | User clips URL → link/copy to `references/` |

### Channel routing decision

```
Is it an academic paper (journal article, working paper, SSRN)?
  YES → Paperpile channel
  NO  → Has the user already read/highlighted it?
          YES → Readwise channel
          NO  → Found via NLM deep research?
                  YES → Obsidian channel (user clips the URL)
                  NO  → Flag as gap
```

### Rationalization Table

| Excuse | Reality | Do Instead |
|---|---|---|
| "I'll just cite it from memory, the paper is well-known" | Your memory is training data, not a source file | Find it in Paperpile or Scholar |
| "The Readwise article is enough for a journal paper" | Readwise has web captures, not canonical PDFs | Send academic papers through Paperpile |
| "I'll materialize sources later during drafting" | Later never comes. Draft agents cite what's available | Materialize NOW |
| "This SEC speech doesn't need a local copy" | Cite-check needs local text to verify your claims | Clip it to Obsidian or find in Readwise |
| "Scholar found it, I don't need to add to Paperpile" | Scholar gives metadata. Paperpile stores the PDF | Add to Paperpile, then rclone |
| "The web source will always be online" | URLs break. Local copies don't | Clip to Obsidian |

## Process

### Step 1: Set Up References Directory

```bash
mkdir -p references
```

### Step 2: Academic Sources — Paperpile Channel

For each research theme from brainstorm, dispatch parallel search agents:

```
Agent(
  subagent_type="workflows:librarian",
  prompt="Search Google Scholar and Consensus for academic papers about [THEME].
  For each paper found, return: title, author(s), year, journal, DOI if available.
  Focus on empirical papers and seminal works. Return top 5 most relevant."
)
```

Launch all theme agents in a **single message** (parallel execution).

After results return:

1. **Deduplicate** across themes
2. **Check Paperpile** for each paper: `paperpile search "<title>" --json`
3. **Add missing papers** to Paperpile:
   - If DOI available: `paperpile add <doi>`
   - If no DOI: `paperpile find-and-add "<citation>"` (when available)
   - Manual: user adds via Paperpile UI
4. **Batch copy PDFs** from Paperpile to `references/`:

```bash
cd ${CLAUDE_SKILL_DIR}/../cite-check
bun materialize-sources.ts \
  --bib ~/Google\ Drive/My\ Drive/resources/Paperpile/paperpile.bib \
  --refs <project>/references \
  --debug
```

This runs `rclone copy --files-from` for all Paperpile PDFs in one call.

### Step 3: Personal Reading — Readwise Channel

Search Readwise for sources the user has already been reading about the topic:

```
Agent(
  subagent_type="workflows:librarian",
  prompt="Search Readwise Reader for documents related to [TOPIC].
  Search by these queries: [theme1], [theme2], [theme3].
  For each document found, return: title, author, document_id, category.
  Only return documents the user has actually saved (not search results from elsewhere)."
)
```

After results return, `materialize-sources.ts` handles Readwise export automatically — entries without `file` fields in the bib are searched in Readwise by title and exported as markdown.

### Step 4: Web Sources — NLM Deep Research Channel

For web sources not in Paperpile or Readwise, use NLM to discover them:

1. **Create NLM notebook** for the project (if not already created):
   ```bash
   nlm create "<project title>"
   ```
   Add key source PDFs and URLs to the notebook.

2. **Discover related sources** via NLM:
   ```bash
   nlm discover-sources <notebook-id> "<research theme>"
   nlm research <notebook-id> "<broader research question>"
   ```

3. **Save discovered URLs to Readwise Reader** for scraping and export:
   Write discovered URLs to a file (one per line, format: `URL | Title | Author`), then:
   ```bash
   cd ${CLAUDE_SKILL_DIR}/../cite-check
   bun materialize-sources.ts \
     --save-urls <url-file> \
     --refs <project>/references \
     --tag <project-tag> \
     --debug
   ```
   This saves each URL to Readwise Reader (which scrapes and converts to markdown), then exports the content to `references/`.

4. **Fallback: Obsidian web clipper** (manual, for sites Readwise can't scrape):
   ```
   These web sources need manual clipping via Obsidian web clipper:
   - [Title 1]: [URL 1]
   ```
   The Writing vault IS the project directory, so clipped files land directly in `references/`.

### Step 5: Build/Update sources.bib

After materialization, ensure `references/sources.bib` has entries for every source in `references/`:

1. For **Paperpile PDFs**: extract bib entries from `paperpile.bib` for cited keys
2. For **Readwise exports**: create `@misc` or `@article` bib entries from the markdown frontmatter
3. Set `file` fields to point to local copies: `file = {<bibkey>.pdf}` or `file = {<bibkey>.md}`

### Step 6: Gap Analysis

Run the materializer in audit mode to check coverage:

```bash
cd ${CLAUDE_SKILL_DIR}/../cite-check
bun materialize-sources.ts \
  --bib <project>/references/sources.bib \
  --refs <project>/references \
  --drafts <project>/drafts \
  --debug
```

Present gaps to user:

```
=== Source Materialization Summary ===
Paperpile PDFs: X copied
Readwise articles: Y exported
Gaps (need manual action): Z
  - [bibkey1]: "Title" → needs Obsidian web clip
  - [bibkey2]: "Title" → not found anywhere
```

## Red Flags — STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|--------|-----------|------------|
| Writing sources.bib without local files in references/ | Downstream cite-check will fail — bib entries without files are useless | Materialize first, then build bib |
| Routing an academic paper through Readwise | Readwise has web captures, not canonical PDFs with proper metadata | Use Paperpile for academic papers |
| Skipping the Paperpile search ("I'll just use the DOI") | Paper may already be in Paperpile — avoid duplicates | Search first, add only if missing |
| Moving to setup without running gap analysis | Gaps found during drafting are 10x harder to fill | Run gap analysis now |
| Creating sources.bib manually instead of from Paperpile export | Manual bib entries have typos, missing fields, wrong citekeys | Extract from paperpile.bib |

## Gate: Exit Lit Review

Before proceeding to writing-setup:

1. **IDENTIFY**: `references/` directory exists with source files
2. **RUN**: `ls references/*.pdf references/*.md | wc -l` — count local source files
3. **READ**: Check `materialize-sources.ts` gap analysis output
4. **VERIFY**: All three conditions met:
   - (a) At least 80% of brainstorm sources have local copies in `references/`
   - (b) Any gaps are explicitly flagged and acknowledged by user
   - (c) `references/sources.bib` exists with `file` fields pointing to local copies
5. **CLAIM**: Only if steps 1-4 pass, proceed to writing-setup

**A gap rate above 20% is a BLOCKER.** Ask the user: "20% of sources are missing. Should we search more, or proceed with known gaps?"

## Why Skipping Hurts the Thing You Care About Most

| Your Drive | Why You Skip | What Actually Happens | The Drive You Failed |
|---|---|---|---|
| **Helpfulness** | "Getting to PRECIS faster helps the user see progress" | The PRECIS cites sources that don't exist locally. Cite-check flags 30% as NOT_IN_STORE. The user has to backtrack and gather sources mid-draft. | **Anti-helpful** |
| **Efficiency** | "Materialization is overhead — we can cite from metadata" | Cite-check can't verify metadata-only citations. Every unverifiable citation is a credibility risk the user discovers at submission time. | **Anti-efficient** |

## No Pause Between Steps

After completing each step, IMMEDIATELY start the next. Do NOT:
- Ask "should I continue to Readwise search?"
- Summarize what you just found
- Wait for confirmation between channels

The three channels are independent — run them all, then present the combined results.

## Phase Complete → Proceed to Setup

After lit review gate passes, immediately proceed to writing-setup:

Read `${CLAUDE_SKILL_DIR}/../writing-setup/SKILL.md` and follow its instructions.
