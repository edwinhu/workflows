# Execution Trace: "Find the paper attachment for the appointments workshop and put it on my reading list"

## Without Skill — General Knowledge Only

### Step 1: Search email for the attachment

**Tool/command:** `assistant` agent with `superhuman` — search emails for "appointments workshop"
**Why:** The user said "the paper attachment," implying a specific paper was sent via email (likely as a PDF attachment) in connection with an "appointments workshop." Email is the most likely source for a paper attachment tied to a specific event.
**Expected result:** One or more email threads mentioning "appointments workshop" with a PDF attachment. Likely a faculty appointments committee workshop with a candidate's job market paper or a scholarly article to discuss.

### Step 2: Identify the correct email and attachment

**Tool/command:** Review the email search results manually.
**Why:** Multiple emails may mention "appointments workshop." Need to find the one with an actual paper attachment (PDF).
**Expected result:** A single email with a PDF attachment — probably something like `Smith_JMP_2026.pdf` or `workshop_paper.pdf`.

### Step 3: Download the attachment

**Tool/command:** `assistant` agent with `superhuman` or `gws` — download/save the attachment.
**Why:** Need the file locally to add it to the reading list.
**Expected result:** PDF saved to a local path, e.g., `/tmp/smith_paper.pdf`.

### Step 4: Add to reading list

**Tool/command:** `assistant` agent with `obsidian` or `readwise` — add the paper to the reading list.
**Why:** The user said "put it on my reading list." This likely means adding it to Readwise (since the `mcp__readwise__search_readwise_highlights` tool exists, suggesting Readwise integration) or to an Obsidian reading list note.
**Expected result:** Paper added to reading list with title, source context ("appointments workshop"), and the PDF either uploaded or linked.

---

## Analysis: Order of Operations

### What I would actually do (without a skill):

1. **Email first** — yes, absolutely. "The paper attachment" with the definite article implies a known, specific attachment the user already received. This is not a web search task.
2. **NOT web/SSRN first** — searching the web would be wrong here. The user didn't say "find a paper about X." They said "the paper attachment for the appointments workshop," which is a specific artifact sent to them.
3. **Calendar as backup** — if email search returned nothing, I'd check the calendar for an "appointments workshop" event, which might have the paper linked in the event description or notes.
4. **Save location** — unclear without a skill. I'd likely save the PDF to a temporary location and then add it to whatever reading list system the user prefers (Readwise, Obsidian, or a local folder).

### Failure modes without a skill:

- **No clear reading list target.** Without a skill defining where the "reading list" lives (Readwise? Obsidian note? A folder?), I'd have to guess or ask the user.
- **No attachment extraction workflow.** The `assistant` agent can search email, but extracting and saving attachments programmatically may require multiple round-trips and unclear tool support.
- **Ambiguity resolution is manual.** If multiple workshops or multiple attachments exist, I'd need to ask the user to disambiguate rather than having a structured resolution process.
- **No metadata extraction.** A skill could automatically extract paper title, authors, abstract from the PDF. Without one, I'd just save the raw file with minimal context.

### What a skill would improve:

1. Defined resolution order: email -> calendar -> ask user
2. Defined reading list destination (e.g., Readwise, specific Obsidian vault path)
3. Automatic metadata extraction from the PDF (title, authors, DOI)
4. Structured error handling for common failures (no attachment found, multiple matches, etc.)
