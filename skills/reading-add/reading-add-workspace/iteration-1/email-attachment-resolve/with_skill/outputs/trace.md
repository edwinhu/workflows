# Execution Trace: "Find the paper attachment for the appointments workshop and put it on my reading list"

## Analysis of User Request

Key phrases:
- **"attachment"** -- triggers the Iron Law: "Attachment Means Email" -- search email FIRST, no web/SSRN/scholar
- **"appointments workshop"** -- context for the email search query
- **"put it on my reading list"** -- triggers the reading-add ingestion workflow (Steps 2-6)

The skill's flowchart routes this as: User said "attachment" --> `superhuman search` --> download attachment --> proceed.

---

## Step-by-Step Execution Trace

### Step 1: Search email for the attachment

**Tool/command:** `superhuman search "appointments workshop paper" --limit 5`

**Why:** The user said "attachment" -- per the Iron Law ("Attachment Means Email") and the source resolution table, email is searched FIRST and ONLY. The skill explicitly forbids searching SSRN, web, or Google Scholar before checking email. The search query combines "appointments workshop" (event context) with "paper" (attachment type).

**Expected result:** A list of email messages matching the query, each with message ID, subject, sender, date, and attachment indicators. Expect to find an email related to an appointments workshop that has a PDF attachment.

---

### Step 2: Download the attachment

**Tool/command:** `superhuman attachment download <message-id> --output /tmp/`

**Why:** The skill instructs to download the attachment using the message ID from Step 1's search results. The file lands in /tmp/ for processing.

**Expected result:** A PDF file downloaded to `/tmp/`, e.g. `/tmp/some-paper.pdf`. If the email has multiple attachments, all related ones would be noted.

---

### Step 3: Extract metadata from the PDF

**Tool/command:**
```bash
LOOK_AT=$(${CLAUDE_SKILL_DIR}/../../skills/look-at/scripts/look_at.py) && python3 "$LOOK_AT" \
    --file "/tmp/some-paper.pdf" \
    --goal "Extract the title, authors, and date/year from the first page. Return as: Title: ..., Authors: ..., Date: ..."
```

**Why:** The skill requires metadata extraction using look-at to determine the correct filename per the naming convention (`Author (Date) - Title.pdf`).

**Expected result:** Structured metadata, e.g.:
- Title: "Judicial Appointments and Reform"
- Authors: "Smith, Jones"
- Date: "2026"

---

### Step 4: Propose filename and confirm with user

**Action:** Present the proposed filename to the user for confirmation.

**Why:** The skill explicitly says "Confirm the proposed filename with the user before copying." Also warns that Gemini may misread dates.

**Expected interaction:** "I found a paper: **Smith, Jones (2026) - Judicial Appointments and Reform.pdf** -- does this filename look right?"

---

### Step 5: Copy to vault inbox

**Tool/command:**
```bash
mkdir -p "/Users/vwh7mb/Documents/Notes/Vault/3. Resources/Inbox"
cp "/tmp/some-paper.pdf" "/Users/vwh7mb/Documents/Notes/Vault/3. Resources/Inbox/Smith, Jones (2026) - Judicial Appointments and Reform.pdf"
```

**Why:** The vault inbox is the designated landing zone. Syncthing handles distribution to other devices (e.g., Onyx Boox e-reader).

**Expected result:** File copied successfully to the vault inbox with the confirmed name.

---

### Step 6: Ensure daily note exists

**Tool/command:**
```bash
obsidian vault=Vault daily:read >/dev/null 2>&1 || obsidian vault=Vault daily:append content=""
```

Fallback if CLI unavailable:
```bash
TODAY=$(date +%Y-%m-%d)
DAILY="/Users/vwh7mb/Documents/Notes/Vault/3. Resources/Daily Notes/${TODAY}.md"
if [ ! -f "$DAILY" ]; then
  cat > "$DAILY" << 'TMPL'
# To-Dos
# Reading
# Meetings
# Work
TMPL
fi
```

**Why:** The daily note must exist before we can insert a reading entry into it.

**Expected result:** Daily note exists at the expected path (either already existed or was just created).

---

### Step 7: Insert reading entry under the # Reading heading

**Tool/command:** Read the daily note file, then use Edit to insert a new line after `# Reading` (or after the last existing item under that heading).

**Entry to insert:** `- [ ] [[Smith, Jones (2026) - Judicial Appointments and Reform.pdf]]`

**Why:** The skill's Iron Law on section placement forbids using `daily:append` (which appends to end of file, after # Work). Must use Read + Edit to place the entry under `# Reading` specifically.

**Expected result:** The daily note now has the reading checkbox entry in the correct section.

---

### Step 8: Confirm to user

**Action:** Report back:
- Renamed filename: `Smith, Jones (2026) - Judicial Appointments and Reform.pdf`
- Saved to: `/Users/vwh7mb/Documents/Notes/Vault/3. Resources/Inbox/`
- Daily note entry: `- [ ] [[Smith, Jones (2026) - Judicial Appointments and Reform.pdf]]`
- Readwise: not requested, skipped

---

## Key Decision Points

### Would I search email first?
**YES.** The word "attachment" is the decisive trigger. The skill has an Iron Law specifically for this: "When the user says 'attachment' ... search email FIRST." The source resolution table maps "attachment" directly to `superhuman search`. No web, SSRN, or scholar search would be attempted before (or instead of) email.

### Would I try web/SSRN first?
**NO.** The skill's Red Flags table explicitly calls this out as wrong: "Searching SSRN/web/scholar when user said 'attachment'" is listed as an anti-pattern. The Iron Law section reinforces this with the example: "WRONG: User says 'attachment' -> search SSRN -> search web -> search scholar -> finally check email" (labeled as 12+ wasted tool calls).

### What order of operations?
1. `superhuman search` (email) -- resolve the source
2. `superhuman attachment download` -- get the file
3. `look-at` -- extract metadata
4. Confirm filename with user -- human verification
5. `cp` to vault inbox -- file placement
6. Ensure daily note exists -- prerequisite for entry
7. Read + Edit daily note -- insert under # Reading (not append)
8. Confirm to user -- report results

### Would calendar be searched?
The user said "appointments workshop" which sounds like an event, and the flowchart does have a path for "from the meeting/workshop" that checks calendar. However, the word "attachment" takes precedence -- it routes directly to email search per the source resolution table. The "appointments workshop" phrase is used as a search query term for the email, not as a calendar lookup trigger. If email search returned nothing, checking the calendar for a related event (and then searching for emails around that event's date) would be a reasonable fallback.
