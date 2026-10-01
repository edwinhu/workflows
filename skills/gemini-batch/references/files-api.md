# Gemini Files API Reference

> **Official docs:** https://ai.google.dev/gemini-api/docs/files.md.txt
> **SDK:** `@google/genai` (TypeScript) / `google-genai` (Python)
> **Last verified:** 2026-09-30

## Overview

The Files API uploads media to Gemini's server for use in prompts or File Search stores. Uploaded media is stored for 48 hours and cannot be downloaded as ordinary source media. Batch result files are a separate use of `client.files.download`; do not confuse that with uploaded media retrieval.

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
| General inline request guidance | Use Files when total request exceeds 100 MB; PDF parsing still caps at 50 MB / 1,000 pages |
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

## Prompting through Interactions

[Files docs](https://ai.google.dev/gemini-api/docs/files.md.txt) use uploaded URIs with typed input blocks, not legacy fileData. For example:

```python
from google import genai

client = genai.Client()
myfile = client.files.upload(file="path/to/sample.mp3")
interaction = client.interactions.create(
    model="gemini-3.8-flash",
    input=[
        {"type": "text", "text": "Describe this audio clip"},
        {"type": "audio", "uri": myfile.uri, "mime_type": myfile.mime_type},
    ],
)
print(interaction.output_text)
```

For Batch keep generateContent fileData/contents request shapes. Files storage limits are not PDF parsing or model context limits. Pre-cut text sections for targeted field extraction; use relevant native PDF pages when layout/scans matter. [Document processing](https://ai.google.dev/gemini-api/docs/document-processing.md.txt) documents PDF limits and model-specific media resolution/tokenization; do not assume a historical 258-token/page figure is universal across new models/configurations.

## Send the PDF, not extracted text — measured evidence

<EXTREMELY-IMPORTANT>
**When the source is a PDF, send the PDF. Do NOT run `pdftotext` and send the string.**

Google’s document-processing guide gives a baseline of **258 tokens per page**, and native text extracted from the PDF is
**not charged at all** ([current document-processing docs](https://ai.google.dev/gemini-api/docs/document-processing.md.txt)). Extracted text is
billed as ordinary input at roughly 4 chars/token, so for text-heavy documents the string is the
*more* expensive representation. Measured on a 1,313-document legal corpus — 21,393 pages,
28.2M extracted characters:

| representation | tokens |
|---|---|
| the PDFs | **5,519,394** |
| pdftotext output | 7,050,563 |

**Sending the PDF avoided about 22% of the extracted-text tokens; extracted text used about 28% more than the PDF.** It also created three problems that do not
exist when you send the document:

- **You will truncate.** A char cap drops whatever sits at the end — in that corpus, counsel's
  signature block, which silently blanked a required field on every long document until it was
  caught by hand.
- **You will OCR scans yourself.** 99 image-only PDFs were run through tesseract at real
  wall-clock cost; Gemini reads scanned pages natively; the measured run used the 258/page baseline.
- **You lose layout.** Tables, exhibits and signature blocks arrive as flattened text, and the
  model can no longer see the structure it would use to disambiguate them.

Reach for `pdftotext` only to *triage* locally (is this file a scan? how long is it?) — never as
the transport into the model.
</EXTREMELY-IMPORTANT>

Limits: **50 MB or 1,000 pages** per file, for both inline data and Files API uploads. Use generateContent `fileData.fileUri` in Batch (GCS for Cloud, uploaded Files URI for Developer); Interactions uses typed document input blocks. Developer Batch also supports inline data within its request-size limit. Gemini 3 media_resolution changes image tokenization; the historical 258/page calculation is not a guarantee for every model/resolution.
