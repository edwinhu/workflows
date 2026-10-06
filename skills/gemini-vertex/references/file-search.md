# Gemini File Search API Reference

> **Developer API, not for production — docs:** https://ai.google.dev/gemini-api/docs/file-search.md.txt
> **SDK:** `@google/genai` (TypeScript) / `google-genai` (Python)
> **Last verified:** 2026-09-30

**Developer-only historical reference; not a production route.** Production Gemini batch uses Vertex with ADC/GCS, never these File API/store calls. See [Cloud batch](vertex-ai.md).

## Overview

File Search stores provide persistent document storage with semantic search. Upload PDFs/text, then query them via Interactions `file_search`. Legacy generateContent uses a different tool shape; do not mix them.

## Store Management

### Create Store

```typescript
const store = await client.fileSearchStores.create({
  config: { displayName: "my-store" },
});
// store.name = "fileSearchStores/abc123"
```

### Get / Delete Store

```typescript
const store = await client.fileSearchStores.get({ name: "fileSearchStores/abc123" });
await client.fileSearchStores.delete({ name: "fileSearchStores/abc123", config: { force: true } });
```

## Document Upload

### WRONG: uploadToFileSearchStore (503 for files >10KB)

```typescript
// DO NOT USE -- 503 bug for files >10KB (April 2026)
await client.fileSearchStores.uploadToFileSearchStore({
  file: path,
  fileSearchStoreName: storeName,
  config: { displayName: bibkey },
});
```

### RIGHT: Two-step upload via Files API + importFile

```typescript
// Step 1: Upload to File Service
const file = await client.files.upload({
  file: path,
  config: { displayName: bibkey },
});

// Step 2: Poll until ACTIVE (see files-api.md)
// ... polling loop ...

// Step 3: Import into store with metadata
const operation = await client.fileSearchStores.importFile({
  fileSearchStoreName: storeName,
  fileName: file.name!,
  config: {
    customMetadata: [{ key: "bibkey", stringValue: bibkey }],
  },
});

// Step 4: Poll import operation
while (!operation.done) {
  await new Promise(r => setTimeout(r, 5000));
  operation = await client.operations.get({ operation }) as any;
}
```

### customMetadata

Key-value pairs stored with the document for filtering during queries.

```typescript
// On import
config: {
  customMetadata: [
    { key: "author", stringValue: "Smith" },
    { key: "year", numericValue: 2024 },
  ],
}

// On query (metadata filter)
fileSearch: {
  fileSearchStoreNames: [storeName],
  metadataFilter: 'author="Smith"',
}
```

**CRITICAL: displayName is NOT reliable after importFile.** The store document gets a random ID as displayName (e.g., "d98ctytgehwv"), not the File's displayName. Always use `customMetadata` for identification.

## Listing Documents (Pagination)

### WRONG: for-await stops after first page

```typescript
// DO NOT USE -- SDK Pager async iterator breaks after page 1
const pager = await client.fileSearchStores.documents.list({ parent: storeName });
for await (const doc of pager) { docs.push(doc); } // only gets ~10-20 docs!
```

### ALSO WRONG: reading pager.params for pageToken

```typescript
// pager.params is INPUT config, not API response -- always undefined
pageToken = (pager.params as any)?.pageToken; // BUG!
```

### RIGHT: hasNextPage() + nextPage()

```typescript
const pager = await client.fileSearchStores.documents.list({
  parent: storeName,
  config: { pageSize: 20 },
});

const docs = [];
let page = pager.page;
while (true) {
  for (const doc of page) {
    const bibkey = doc.customMetadata?.find(
      (m: any) => m.key === "bibkey"
    )?.stringValue ?? doc.displayName ?? "";
    docs.push({ name: doc.name, displayName: doc.displayName, bibkey });
  }
  if (!pager.hasNextPage()) break;
  page = await pager.nextPage();
}
```

## Querying with File Search

```typescript
const interaction = await client.interactions.create({
  model: "gemini-3.8-flash",
  input: "Does this source support the claim?",
  tools: [{
    type: "file_search",
    file_search_store_names: [storeName],
    metadata_filter: 'bibkey="Author2024-ab"',
  }],
  response_format: {
    type: "text",
    mime_type: "application/json",
    schema: { /* see structured-output.md */ },
  },
});
```

### Grounding metadata

Read Interactions model_output text blocks and their citation annotations from `interaction.steps`; do not read legacy candidates from this response. For legacy generateContent responses only, citations remain under `candidates[].groundingMetadata`. See the current [Developer API, not for production: File Search docs](https://ai.google.dev/gemini-api/docs/file-search.md.txt) and [grounding step parsing](flex-inference.md).

## Limits

| Limit | Value |
|-------|-------|
| Per-file max | 100 MB |
| Storage (free tier) | 1 GB |
| Storage (tier 3) | 1 TB |
| API max page_size | 20 |

## Incompatibilities

- File Search cannot combine with Google Search or URL Context in the same request
- File Search is not supported in the Live API

Current project storage tiers: Free 1GB, Tier 1 10GB, Tier 2 100GB, Tier 3 1TB. Stored size includes generated embeddings (typically about 3× input size); Google recommends keeping each store below 20GB for retrieval latency. Historical upload/pagination workarounds above are observations, not permanent service limits.
