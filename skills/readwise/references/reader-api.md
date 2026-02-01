# Readwise Reader API Reference

Source: https://readwise.io/reader_api

## Authentication

```
Authorization: Token XXX
```

Get token from: https://readwise.io/access_token

Validate with GET to `https://readwise.io/api/v2/auth/` (expect 204).

## Document List

**Endpoint:** `GET https://readwise.io/api/v3/list/`

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Retrieve specific document by ID |
| `updatedAfter` | ISO 8601 | Filter by update time |
| `location` | string | `new`, `later`, `shortlist`, `archive`, `feed` |
| `category` | string | `article`, `email`, `rss`, `highlight`, `note`, `pdf`, `epub`, `tweet`, `video` |
| `tag` | string | Filter by tag. **Up to 5 tags** for AND logic. Empty value (`?tag=`) finds untagged. |
| `limit` | int | 1-100 results (default 100) |
| `pageCursor` | string | Pagination token from previous response |
| `withHtmlContent` | bool | Include full HTML content (slower) |
| `withRawSourceUrl` | bool | Include S3 URLs (valid 1 hour) |

### Response Format

```json
{
  “count”: 123,
  “nextPageCursor”: “...”,
  “results”: [
    {
      “id”: “abc123”,
      “url”: “https://example.com/article”,
      “title”: “Article Title”,
      “author”: “Author Name”,
      “location”: “archive”,
      “tags”: [“tag1”, “tag2”],
      “word_count”: 1500,
      “reading_progress”: 0.75,
      “html_content”: “<html>...</html>”
    }
  ]
}
```

## Tag List

**Endpoint:** `GET https://readwise.io/api/v3/tags/`

### Response Format

```json
{
  “count”: 50,
  “results”: [
    {“key”: “tag1”, “name”: “Tag 1”},
    {“key”: “tag2”, “name”: “Tag 2”}
  ]
}
```

## Create Document

**Endpoint:** `POST https://readwise.io/api/v3/save/`

### Request Body

```json
{
  “url”: “https://example.com/article”,
  “html”: “<html>...</html>”,
  “title”: “Optional Title”,
  “author”: “Optional Author”,
  “tags”: [“tag1”, “tag2”],
  “location”: “new”
}
```

## Update Document

**Endpoint:** `PATCH https://readwise.io/api/v3/update/<id>/`

## Delete Document

**Endpoint:** `DELETE https://readwise.io/api/v3/delete/<id>/`

## Rate Limits

| Endpoint Type | Limit |
|---------------|-------|
| Standard (list, get) | 20 requests/minute |
| Create/Update | 50 requests/minute |

Check `Retry-After` header on 429 responses.

## Common Patterns

### Fetch all documents with a tag (with HTML)

```python
params = {
    “tag”: “proxy advisors”,
    “withHtmlContent”: “true”
}
# Paginate using nextPageCursor
```

### Fetch multiple tags (AND logic)

```
?tag=tag1&tag=tag2&tag=tag3
```

Returns documents with ALL specified tags.

### Find untagged documents

```
?tag=
```

## Token Location (agenix-managed)

```
/var/folders/01/wzs3mqmn3jx2b81f0dcq9w8h0000gq/T/agenix/readwise-token
```
