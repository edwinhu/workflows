# Canvas LMS Courses

**Instance:** `https://virginialaw.instructure.com`
**Credentials:** `$CANVAS_API_TOKEN_FILE` (agenix-managed, fallback: `~/areas/secreg/.canvas-token`)

## Courses

| Course ID | Name | Content |
|-----------|------|---------|
| 8926 | Appointments Committee 2025-2026 | Job talk papers, CVs, schedules, research agendas |
| 8685 | Securities Regulation 1 | Lecture slides, syllabi, addenda |
| 8642 | Corporations 1 | TBD |
| 8807 | Independent Research 2O | TBD |

## Routing

| User says | Course |
|-----------|--------|
| "appointments", candidate name, "job talk" | 8926 |
| "secreg", "securities regulation" | 8685 |

## API Pattern

```bash
TOKEN=$(cat "$CANVAS_API_TOKEN_FILE" 2>/dev/null || cat ~/areas/secreg/.canvas-token | tr -d '\n')
# List files in a course
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://virginialaw.instructure.com/api/v1/courses/<COURSE_ID>/files?per_page=50"
# Get download URL for a file
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://virginialaw.instructure.com/api/v1/courses/<COURSE_ID>/files/<FILE_ID>"
# Download (use the 'url' field from the response above)
curl -sL "<download_url>" -o /tmp/filename.pdf
```
