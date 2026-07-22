# Gemini Files API Reference

> **Official docs:** https://ai.google.dev/gemini-api/docs/files.md.txt
> **SDK:** `@google/genai` (TypeScript) / `google-genai` (Python)
> **Last verified:** April 2026

## Overview

The Files API uploads media to Gemini's server for use in prompts or File Search stores. Files are stored for 48 hours and cannot be downloaded.

## Methods

### Upload

```typescript
const file = await client.files.upload({
  file: "/path/to/file.pdf",
  config: {
    displayName: "my-document",
    mimeType: "application/pdf",  // optional, inferred from extension
  },
});
// file.name = "files/abc-123"
// file.state = "PROCESSING" | "ACTIVE" | "FAILED"
```

### Get (check state)

```typescript
const file = await client.files.get({ name: "files/abc-123" });
// file.state, file.sizeBytes, file.mimeType, etc.
```

### List

```typescript
const pager = await client.files.list({ config: { pageSize: 10 } });
for await (const file of pager) {
  console.log(file.name, file.state);
}
```

### Delete

```typescript
await client.files.delete({ name: "files/abc-123" });
```

## File States

| State | Meaning | Action |
|-------|---------|--------|
| `PROCESSING` | File is being processed | Poll with `files.get()` until ACTIVE |
| `ACTIVE` | Ready for use | Proceed with import or prompting |
| `FAILED` | Processing failed | Check `file.error`, re-upload |
| `STATE_UNSPECIFIED` | Unknown state | Treat as PROCESSING, keep polling |

## Limits

| Limit | Value |
|-------|-------|
| Per-file max | 2 GB |
| PDF max | 50 MB |
| Request size max | 100 MB |
| Project storage | 20 GB |
| Expiration | 48 hours (auto-deleted) |

## Production Pattern: Upload + Poll

**CRITICAL: Always poll until ACTIVE before using the file.**

Files start in PROCESSING state. Using a file before it's ACTIVE causes errors.

```typescript
const file = await client.files.upload({ file: path, config: { displayName: name } });

const maxWaitMs = 120_000;
const start = Date.now();
let state = file.state;

while (state === "PROCESSING" || state === "STATE_UNSPECIFIED") {
  if (Date.now() - start > maxWaitMs) {
    throw new Error(`File stuck in ${state} after ${maxWaitMs / 1000}s`);
  }
  await new Promise(r => setTimeout(r, 3000));
  const updated = await client.files.get({ name: file.name! });
  state = updated.state;
}

if (state === "FAILED") {
  throw new Error(`File processing failed: ${JSON.stringify(file.error)}`);
}
// file is now ACTIVE -- safe to use
```

## Known Issues (April 2026)

- **STATE_PENDING stuck bug:** Some files get stuck in PROCESSING. The polling pattern above handles this with a timeout.
- **48-hour expiration:** Files are auto-deleted. For persistent storage, use File Search stores.
