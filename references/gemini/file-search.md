# Gemini File Search API Reference

> **Official docs:** https://ai.google.dev/gemini-api/docs/file-search.md.txt
> **SDK:** `@google/genai` (TypeScript) / `google-genai` (Python)
> **Last verified:** April 2026

## Overview

File Search stores provide persistent document storage with semantic search. Upload PDFs/text, then query them via the `fileSearch` tool in `generateContent`.

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
const response = await client.models.generateContent({
  model: "gemini-3.1-flash-lite-preview",
  contents: "Does this source support the claim?",
  config: {
    tools: [{
      fileSearch: {
        fileSearchStoreNames: [storeName],
        metadataFilter: 'bibkey="Author2024-ab"',  // optional: scope to specific doc
      },
    }],
    responseMimeType: "application/json",
    responseJsonSchema: { /* see structured-output.md */ },
  },
});
```

### Grounding Metadata

Responses include grounding chunks showing which passages were used:

```typescript
const metadata = response.candidates?.[0]?.groundingMetadata;
const chunks = metadata?.groundingChunks ?? [];
// Each chunk: { retrievedContext: { uri, title }, customMetadata: [...] }
```

## Limits

| Limit | Value |
|-------|-------|
| Per-file max | 100 MB |
| Storage (free tier) | 1 GB |
| Storage (tier 3) | 1 TB |
| API max page_size | 20 |

## Incompatibilities

- File Search cannot combine with Grounding with Google Search
- File Search is not supported in the Live API
