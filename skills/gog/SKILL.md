---
name: gog
description: This skill should be used when the user asks about “email”, “Gmail”, “calendar”, “Google Calendar”, “Google Drive”, “contacts”, “Google Sheets”, “Google Docs”, “Google Tasks”, “Google Keep”, “send email”, “create event”, “search drive”, or needs to interact with Google Workspace services via the gog CLI.
version: 0.1.0
---

# Google Workspace CLI (gog)

Use `gog` for Gmail, Calendar, Drive, Contacts, Sheets, Docs, Tasks, Keep, and more. Requires OAuth setup.

## Setup (One-Time)

```bash
# Add OAuth credentials
gog auth credentials /path/to/client_secret.json

# Authorize account for services
gog auth add you@gmail.com --services gmail,calendar,drive,contacts,docs,sheets,tasks,keep

# Verify setup
gog auth list
```

## Gmail

```bash
# Search threads (grouped by conversation)
gog gmail search ‘newer_than:7d’ --max 10

# Search individual messages
gog gmail messages search “in:inbox from:example.com” --max 20 --account you@example.com

# Send plain text email
gog gmail send --to recipient@example.com --subject “Subject” --body “Message body”

# Send multi-line email (from file)
gog gmail send --to recipient@example.com --subject “Subject” --body-file ./message.txt

# Send from stdin
gog gmail send --to recipient@example.com --subject “Subject” --body-file -

# Send HTML email
gog gmail send --to recipient@example.com --subject “Subject” --body-html “<p>Hello</p>”

# Create draft
gog gmail drafts create --to recipient@example.com --subject “Subject” --body-file ./message.txt

# Send draft
gog gmail drafts send <draftId>

# Reply to message
gog gmail send --to recipient@example.com --subject “Re: Subject” --body “Reply” --reply-to-message-id <msgId>
```

### Email Formatting Tips

- Prefer plain text. Use `--body-file` for multi-paragraph messages.
- `--body` does not unescape `\n`. Use heredoc or `$’Line 1\n\nLine 2’` for inline newlines.
- Use `--body-html` only when rich formatting is needed.
- HTML tags: `<p>`, `<br>`, `<strong>`, `<em>`, `<a href="url">`, `<ul>/<li>`.

Example (plain text via stdin):
```bash
gog gmail send --to recipient@example.com \
  --subject “Meeting Follow-up” \
  --body-file - <<'EOF'
Hi Name,

Thanks for meeting today. Next steps:
- Item one
- Item two

Best regards,
Your Name
EOF
```

## Calendar

```bash
# List events
gog calendar events <calendarId> --from <iso> --to <iso>

# Create event
gog calendar create <calendarId> --summary “Meeting” --from <iso> --to <iso>

# Create event with color
gog calendar create <calendarId> --summary “Meeting” --from <iso> --to <iso> --event-color 7

# Update event
gog calendar update <calendarId> <eventId> --summary “New Title” --event-color 4

# Show available colors
gog calendar colors
```

### Calendar Color IDs

| ID | Color   |
|----|---------|
| 1  | #a4bdfc |
| 2  | #7ae7bf |
| 3  | #dbadff |
| 4  | #ff887c |
| 5  | #fbd75b |
| 6  | #ffb878 |
| 7  | #46d6db |
| 8  | #e1e1e1 |
| 9  | #5484ed |
| 10 | #51b749 |
| 11 | #dc2127 |

## Drive

```bash
# Search files
gog drive search “query” --max 10
```

## Contacts

```bash
# List contacts
gog contacts list --max 20

# Search contacts
gog contacts search <name>
```

## Tasks

```bash
# List task lists
gog tasks list

# Add task
gog tasks add “Task description” --list <listId>
```

## Keep

Note: Google Keep access requires a Service Account.

```bash
# List notes
gog keep list

# Search notes
gog keep search <query>
```

## Sheets

```bash
# Get cell range
gog sheets get <sheetId> “Tab!A1:D10” --json

# Update cells
gog sheets update <sheetId> “Tab!A1:B2” --values-json ‘[[“A”,”B”],[“1”,”2”]]’ --input USER_ENTERED

# Append rows
gog sheets append <sheetId> “Tab!A:C” --values-json ‘[[“x”,”y”,”z”]]’ --insert INSERT_ROWS

# Clear range
gog sheets clear <sheetId> “Tab!A2:Z”

# Get metadata
gog sheets metadata <sheetId> --json
```

## Docs

```bash
# Export to text
gog docs export <docId> --format txt --out /tmp/doc.txt

# Print contents
gog docs cat <docId>
```

Note: In-place edits require a Docs API client (not available in gog).

## Environment Variables

- `GOG_ACCOUNT=you@gmail.com` - Avoid repeating `--account` flag

## Tips

- For scripting, use `--json` and `--no-input` flags.
- Always confirm before sending mail or creating events.
- `gog gmail search` returns threads; use `gog gmail messages search` for individual emails.
