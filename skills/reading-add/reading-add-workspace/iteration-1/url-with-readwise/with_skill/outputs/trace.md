# Execution Trace: URL with Readwise

**Task:** "Save this for later reading and also to readwise: https://www.bloomberg.com/news/articles/2026-03-15/sec-enforcement-update"

---

## Pre-flight: Source Classification

The source is already a URL. Per the workflow flowchart:

> Is the source already a file path or URL? YES --> Go to Step 2 (metadata extraction)

However, Step 2 (metadata extraction + rename) is labeled **"files only"** in the skill. So for a URL, we skip Steps 1, 2, and 3 entirely and go straight to Step 4 (daily note) and Step 5 (Readwise).

**Key decision: No metadata extraction for URLs.** The skill explicitly scopes Step 2 to files only. We do NOT try to fetch the page, extract a title, or rename anything.

---

## Step 1: Resolve Source

**Skipped.** The source is already a URL. No resolution needed.

## Step 2: Extract Metadata & Rename

**Skipped.** This step says "(files only)". The source is a URL, not a file.

## Step 3: Copy to Vault Inbox

**Skipped.** Nothing to copy — there is no file. The URL is not downloaded.

## Step 4: Add to Daily Note (under Reading heading)

### Step 4a: Ensure daily note exists

**Tool/command:** Bash
```bash
obsidian vault=Vault daily:read >/dev/null 2>&1 || obsidian vault=Vault daily:append content=""
```

**Why:** The skill says to ensure the daily note exists before editing it. If `obsidian` CLI is unavailable, fall back to manual creation:

```bash
TODAY=$(date +%Y-%m-%d)  # 2026-03-19
DAILY="/Users/vwh7mb/Documents/Notes/Vault/3. Resources/Daily Notes/2026-03-19.md"
if [ ! -f "$DAILY" ]; then
  cat > "$DAILY" << 'TMPL'
# To-Dos
# Reading
# Meetings
# Work
TMPL
fi
```

**Expect back:** Daily note file exists at the expected path.

### Step 4b: Read the daily note

**Tool/command:** Read tool on `/Users/vwh7mb/Documents/Notes/Vault/3. Resources/Daily Notes/2026-03-19.md`

**Why:** The Iron Law says "NEVER use `daily:append`". Must read the file to find the `# Reading` heading and insert after it (or after the last existing item under that heading).

**Expect back:** File contents showing headings like `# To-Dos`, `# Reading`, `# Meetings`, `# Work`, possibly with existing entries.

### Step 4c: Insert entry under # Reading

**Tool/command:** Edit tool on the daily note file

**Old string:** `# Reading` (or the last line under the Reading section)

**New string:** Insert after the `# Reading` line:
```
# Reading
- [ ] [SEC Enforcement Update](https://www.bloomberg.com/news/articles/2026-03-15/sec-enforcement-update)
```

**Why:** The skill format rules say:
- Always a checkbox: `- [ ]`
- For URLs: use a markdown link: `[Title](https://example.com)`
- Never add task metadata

**Title derivation:** Since we did NOT extract metadata (correct for URLs), we derive the title from the URL slug: `sec-enforcement-update` becomes "SEC Enforcement Update". This is a reasonable human-readable title from the URL path.

**No project backlink** — the user did not mention a project.

**Expect back:** Edit succeeds; entry is placed under `# Reading`, not at end of file.

## Step 5: Save to Readwise Reader

**Tool/command:** Bash
```bash
readwise save "https://www.bloomberg.com/news/articles/2026-03-15/sec-enforcement-update" --tag reading-inbox
```

**Why:** The user explicitly said "also to readwise". The skill says: "Only when user explicitly requests Readwise." This qualifies. For URLs, the command is `readwise save` (not `readwise upload`, which is for files).

**Expect back:** Confirmation that the URL was saved to Readwise Reader with the `reading-inbox` tag.

## Step 6: Confirm

**Tool/command:** Direct text output to user

**Message would be:**
> Saved to reading list:
> - Daily note: Added `- [ ] [SEC Enforcement Update](https://...)` under `# Reading` in today's daily note
> - Readwise: Saved URL to Readwise Reader with `reading-inbox` tag

---

## Analysis: Key Behavioral Questions

### Do you try to extract metadata?
**No.** Step 2 is scoped to "(files only)". For a URL, there is no `look-at` call, no attempt to fetch the page, no renaming. This is correct per the skill.

### Do you use markdown link format?
**Yes.** The skill format rules explicitly state: "For URLs: use a markdown link: `[Title](https://example.com)`". This is distinct from files, which use Obsidian wiki-links `[[...]]`.

### Do you save to Readwise?
**Yes.** The user said "also to readwise", which triggers Step 5. The command used is `readwise save` (for URLs), not `readwise upload` (for files).

### Where do you place the daily note entry?
**Under the `# Reading` heading**, inserted via Read + Edit. The Iron Law explicitly forbids using `daily:append` because it would place the entry at the end of the file (after `# Work`), which is the wrong section.

### Total tool calls?
1. Bash: ensure daily note exists
2. Read: read daily note
3. Edit: insert under `# Reading`
4. Bash: `readwise save`

**4 tool calls total.** Efficient — no wasted calls on metadata extraction, web fetching, or source resolution.
