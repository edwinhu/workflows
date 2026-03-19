# Execution Trace: Add Local PDF to Reading List (No Skill)

**Input:** "Add this PDF to my reading list, it's related to Pass-through Voting: /tmp/bishop-activist-defense.pdf"

---

## Step 1: Read the PDF to extract metadata

**Tool:** `Read` tool on `/tmp/bishop-activist-defense.pdf`
**Why:** Need to extract title, authors, date, and abstract from the PDF to populate the reading list entry.
**Expected back:** The PDF content — at minimum the first page with title, author names, publication venue, date, and abstract.

---

## Step 2: Figure out where the reading list lives

**Problem:** I don't have explicit instructions on where a "reading list" is maintained. The user mentions Obsidian in their CLAUDE.md (`obsidian` for notes). I would likely ask the user where their reading list lives, or search for an existing pattern.

**Tool:** `Bash` — `fd "reading" ~/obsidian-vault/ --type f` or similar
**Why:** Try to find an existing reading list file or daily note template in the vault.
**Expected back:** Uncertain. Might find a `Reading List.md` or a daily notes folder. Without knowing the vault path, this is guesswork.

---

## Step 3: Add entry to... somewhere

**Problem:** Without a skill, I don't know:
- The vault path
- Whether to use a daily note, a dedicated reading list file, or create a literature note
- What format/template to use
- Whether there's a Readwise integration or similar

**Most likely action:** I would ask the user clarifying questions:
- "Where is your Obsidian vault located?"
- "Do you have a specific reading list file or should I add this to today's daily note?"
- "What format do you use for reading list entries?"

---

## What I Would NOT Do (gaps without a skill)

### Metadata extraction
- I would attempt to read the PDF and extract title/authors, but I have no structured process for it.
- I would not know to extract DOI, publication year, or journal name in a standardized way.
- I would not generate a citekey.

### Project backlink
- The user said "it's related to Pass-through Voting." Without a skill, I would likely just include this as a plain-text note or tag, e.g., "Related to: Pass-through Voting."
- I would **not** know to create a `[[Pass-through Voting]]` wikilink or backlink to an existing project note.
- I would **not** know whether "Pass-through Voting" corresponds to an existing project page in the vault.

### Daily note entry
- I have no idea where daily notes live (`Daily/`, `Journal/`, `daily/YYYY-MM-DD.md`?).
- I don't know the daily note template or which section reading items go under.
- I would not append to the correct section — I'd likely create a new file or ask.

### Format
- I would guess at a format, probably something like:
  ```
  - [ ] [Title of Paper](file:///tmp/bishop-activist-defense.pdf) — Authors (Year)
    - Related to: Pass-through Voting
  ```
- This is a generic guess. It would not match any existing vault conventions.

---

## Summary of Gaps

| Aspect | With Skill (expected) | Without Skill (actual) |
|--------|----------------------|----------------------|
| PDF metadata extraction | Structured: title, authors, year, DOI, citekey | Ad hoc, best-effort read |
| Vault path | Known | Unknown — must ask user |
| File placement | Correct daily note or reading list | Unknown — must ask user |
| Entry format | Matches vault template | Generic markdown guess |
| Project backlink | `[[Pass-through Voting]]` wikilink | Plain text "Related to: Pass-through Voting" |
| Section placement | Appended to correct section (e.g., ## Reading) | Unknown — would create new or ask |
| Citekey generation | Automated (e.g., bishopActivistDefense2024) | Not attempted |
| Tags | Structured (#to-read, #paper, etc.) | Not attempted or guessed |

**Bottom line:** Without a skill, I would stall after reading the PDF and ask 2-3 clarifying questions before doing anything. The user's intent ("add to reading list") is clear, but the execution details (where, what format, what metadata) are entirely unknown. The project backlink ("Pass-through Voting") would be treated as free text, not as a structured vault link.
