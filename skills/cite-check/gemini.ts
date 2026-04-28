/**
 * Gemini File Search API wrapper for cite-check.
 *
 * Uses Google AI Studio (GOOGLE_API_KEY) for grounded generation with
 * File Search stores. Provides store management, document upload, and
 * citation querying with grounding chunks.
 */

import { GoogleGenAI } from "@google/genai";
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join, basename, dirname, extname } from "node:path";
import { homedir, tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Status =
  | "SUPPORTED"
  | "PARTIAL"
  | "UNSUPPORTED"
  | "NOT_IN_STORE"
  | "ERROR";

export interface ClassifyResult {
  status: Status;
  supporting_passage: string;
  explanation: string;
}

export interface GeminiQueryResult {
  classification: ClassifyResult;
  groundingChunks: GroundingChunk[];
  durationMs: number;
}

export interface GroundingChunk {
  text: string;
  sourceTitle?: string;
  customMetadata?: Array<{
    key: string;
    stringValue?: string;
    numericValue?: number;
  }>;
}

export interface StoreDocument {
  name: string;
  displayName: string;
}

export interface StoreConfig {
  storeId: string;
  storeName: string;
  displayName: string;
}

export interface BibEntry {
  bibkey: string;
  filePath?: string; // absolute path resolved from bib dir + relative file field
  title?: string;    // for Readwise search fallback
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_MODEL = "gemini-3.1-flash-lite-preview";

// ---------------------------------------------------------------------------
// Client factory with test seam
// ---------------------------------------------------------------------------

function createDefaultClient(): GoogleGenAI {
  // Uses GOOGLE_API_KEY env var automatically
  return new GoogleGenAI({});
}

let activeClient: GoogleGenAI | null = null;

export function getClient(): GoogleGenAI {
  if (!activeClient) {
    activeClient = createDefaultClient();
  }
  return activeClient;
}

/**
 * Test seam: replace the real GoogleGenAI client with a mock.
 * Pass null to restore default behavior.
 */
export function __setGeminiClientForTesting(
  client: GoogleGenAI | null,
): void {
  activeClient = client;
}

// ---------------------------------------------------------------------------
// Store management
// ---------------------------------------------------------------------------

export async function createStore(
  displayName: string,
): Promise<StoreConfig> {
  const client = getClient();
  const store = await client.fileSearchStores.create({
    config: { displayName },
  });
  const storeId = store.name!.split("/").pop()!;
  return {
    storeId,
    storeName: store.name!,
    displayName,
  };
}

export async function listDocuments(
  storeName: string,
): Promise<StoreDocument[]> {
  const client = getClient();
  const docs: StoreDocument[] = [];

  const pager = await client.fileSearchStores.documents.list({
    parent: storeName,
    config: { pageSize: 20 },
  });

  let page = pager.page;
  while (true) {
    for (const doc of page) {
      docs.push({
        name: doc.name ?? "",
        displayName: doc.displayName ?? "",
      });
    }
    if (!pager.hasNextPage()) break;
    page = await pager.nextPage();
  }

  return docs;
}

export async function uploadPdf(
  storeName: string,
  pdfPath: string,
  bibkey: string,
  opts?: { mimeType?: string; _pollIntervalMs?: number },
): Promise<void> {
  const client = getClient();

  // Step 1: Upload file to File Service (avoids 503 bug with uploadToFileSearchStore for files >10KB)
  const uploadConfig: any = {
    file: pdfPath,
    config: {
      displayName: bibkey,
    },
  };
  if (opts?.mimeType) {
    uploadConfig.config.mimeType = opts.mimeType;
  }
  const file = await client.files.upload(uploadConfig);
  if (!file.name) {
    throw new Error(`File upload returned no name for ${bibkey}`);
  }

  // Step 2: Poll until file is ACTIVE (handles STATE_PENDING stuck bug)
  const maxWaitMs = 120_000; // 2 minutes
  const pollMs = opts?._pollIntervalMs ?? 3_000;
  const start = Date.now();
  let fileState = file.state;
  while (fileState === "PROCESSING" || fileState === "STATE_UNSPECIFIED") {
    if (Date.now() - start > maxWaitMs) {
      throw new Error(`File ${bibkey} stuck in ${fileState} after ${maxWaitMs / 1000}s`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
    const updated = await client.files.get({ name: file.name! });
    fileState = updated.state;
  }
  if (fileState === "FAILED") {
    throw new Error(`File processing failed for ${bibkey}: ${JSON.stringify(file.error)}`);
  }

  // Step 3: Import file into FileSearchStore
  let operation = await client.fileSearchStores.importFile({
    fileSearchStoreName: storeName,
    fileName: file.name,
    config: {
      customMetadata: [{ key: "bibkey", stringValue: bibkey }],
    },
  });

  // Step 4: Poll import operation until done
  while (!operation.done) {
    await new Promise((r) => setTimeout(r, 5000));
    operation = (await client.operations.get({ operation })) as any;
  }
  if (operation.error) {
    throw new Error(`Import failed for ${bibkey}: ${JSON.stringify(operation.error)}`);
  }
}

export async function uploadPdfs(
  storeName: string,
  pdfsDir: string,
): Promise<{ uploaded: number; skipped: number }> {
  const existing = await listDocuments(storeName);
  const existingBibkeys = new Set(existing.map((d) => d.displayName));

  const entries = readdirSync(pdfsDir, { withFileTypes: true });
  const pdfs = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".pdf"))
    .map((e) => ({
      path: join(pdfsDir, e.name),
      bibkey: basename(e.name, extname(e.name)),
    }));

  let uploaded = 0;
  let skipped = 0;
  for (const pdf of pdfs) {
    if (existingBibkeys.has(pdf.bibkey)) {
      skipped++;
      continue;
    }
    await uploadPdf(storeName, pdf.path, pdf.bibkey);
    uploaded++;
  }
  return { uploaded, skipped };
}

// ---------------------------------------------------------------------------
// Bib file parsing
// ---------------------------------------------------------------------------

/**
 * Parse a .bib file and extract bibkey -> file path + title mappings.
 * Returns ALL entries, not just those with `file` fields. Entries without
 * `file` can still be resolved via Readwise if they have a `title`.
 */
export function parseBibFile(bibPath: string): Map<string, BibEntry> {
  const content = readFileSync(bibPath, "utf-8");
  const bibDir = dirname(bibPath);
  const map = new Map<string, BibEntry>();

  // Split into entries by finding each @type{key,
  const entries = content.split(/(?=@\w+\{)/);
  for (const entry of entries) {
    const keyMatch = entry.match(/^@\w+\{([\w:-]+),/);
    if (!keyMatch) continue;
    const bibkey = keyMatch[1];

    const bibEntry: BibEntry = { bibkey };

    // Find file field in this entry -- take the first one
    const fileMatch = entry.match(/^\s*file\s*=\s*\{([^}]+)\}/m);
    if (fileMatch) {
      const relPath = fileMatch[1].trim();
      bibEntry.filePath = join(bibDir, relPath);
    }

    // Extract title field: handles both title = {{Double}} and title = {Single}
    const titleMatch = entry.match(/^\s*title\s*=\s*\{((?:\{[^}]*\}|[^}])*)\}/m);
    if (titleMatch) {
      // Strip outer/inner braces: {{Foo}} -> Foo, {Foo} -> Foo
      let title = titleMatch[1].trim();
      // Remove surrounding braces if present (double-brace case)
      if (title.startsWith("{") && title.endsWith("}")) {
        title = title.slice(1, -1);
      }
      bibEntry.title = title;
    }

    map.set(bibkey, bibEntry);
  }

  return map;
}

// ---------------------------------------------------------------------------
// Title similarity (for Readwise result validation)
// ---------------------------------------------------------------------------

/**
 * Simple word-overlap similarity between two titles.
 * Returns a score 0-1 based on what fraction of query words appear in the candidate.
 */
export function titleSimilarity(query: string, candidate: string): number {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2);
  const queryWords = normalize(query);
  const candidateWords = new Set(normalize(candidate));
  if (queryWords.length === 0) return 0;
  const matches = queryWords.filter(w => candidateWords.has(w)).length;
  return matches / queryWords.length;
}

// ---------------------------------------------------------------------------
// Readwise Reader fallback
// ---------------------------------------------------------------------------

/**
 * Search Readwise Reader for a document by title, return its full text content.
 * Returns null if not found or on error.
 */
export async function resolveFromReadwise(
  title: string,
  opts?: { debug?: boolean },
): Promise<string | null> {
  const readwiseBin = getReadwiseBinPath();

  try {
    // Check binary exists before spawning
    if (!existsSync(readwiseBin)) {
      if (opts?.debug) {
        process.stderr.write(`[readwise] binary not found at ${readwiseBin}\n`);
      }
      return null;
    }

    // Search by title
    const searchProc = Bun.spawn([
      readwiseBin, "reader-search-documents",
      "--query", title,
      "--title-search", title,
      "--limit", "1",
      "--json",
    ], { stdout: "pipe", stderr: "ignore" });

    const searchOut = await new Response(searchProc.stdout).text();
    await searchProc.exited;
    if (searchProc.exitCode !== 0) return null;

    const results = JSON.parse(searchOut);
    // Handle both array and {results: [...]} formats
    const docs = Array.isArray(results) ? results : results.results ?? [];
    if (docs.length === 0) return null;

    const docTitle = docs[0].title ?? "";
    const similarity = titleSimilarity(title, docTitle);
    if (similarity < 0.3) {
      if (opts?.debug) {
        process.stderr.write(
          `[readwise] rejected "${docTitle}" (similarity ${similarity.toFixed(2)}) for "${title}"\n`,
        );
      }
      return null;
    }

    const docId = docs[0].document_id ?? docs[0].id;
    if (!docId) return null;

    if (opts?.debug) {
      process.stderr.write(`[readwise] found "${docTitle}" (${docId}) for search "${title}"\n`);
    }

    // Get full document content
    const detailProc = Bun.spawn([
      readwiseBin, "reader-get-document-details",
      "--document-id", docId,
      "--json",
    ], { stdout: "pipe", stderr: "ignore" });

    const detailOut = await new Response(detailProc.stdout).text();
    await detailProc.exited;
    if (detailProc.exitCode !== 0) return null;

    const detail = JSON.parse(detailOut);
    const content = detail.content ?? detail.markdown ?? "";
    if (!content || content.length < 50) return null;

    if (opts?.debug) {
      process.stderr.write(`[readwise] fetched ${content.length} chars for ${docId}\n`);
    }

    return content;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Readwise Reader search (lightweight, no content fetch)
// ---------------------------------------------------------------------------

let readwiseBinOverride: string | null = null;

/**
 * Test seam: override the readwise binary path.
 * Pass null to restore default behavior.
 */
export function __setReadwisePathForTesting(path: string | null): void {
  readwiseBinOverride = path;
}

function getReadwiseBinPath(): string {
  return readwiseBinOverride ?? join(homedir(), ".local", "bin", "readwise");
}

/**
 * Check if Readwise Reader has a document matching this title.
 * Returns the matched title or null. Does NOT fetch full content.
 */
export async function searchReadwise(
  title: string,
  opts?: { debug?: boolean },
): Promise<string | null> {
  const readwiseBin = getReadwiseBinPath();

  try {
    if (!existsSync(readwiseBin)) {
      if (opts?.debug) {
        process.stderr.write(`[readwise] binary not found at ${readwiseBin}\n`);
      }
      return null;
    }

    const searchProc = Bun.spawn([
      readwiseBin, "reader-search-documents",
      "--query", title,
      "--title-search", title,
      "--limit", "1",
      "--json",
    ], { stdout: "pipe", stderr: "ignore" });

    const searchOut = await new Response(searchProc.stdout).text();
    await searchProc.exited;
    if (searchProc.exitCode !== 0) return null;

    const results = JSON.parse(searchOut);
    const docs = Array.isArray(results) ? results : results.results ?? [];
    if (docs.length === 0) return null;

    const docTitle = docs[0].title ?? "";
    const similarity = titleSimilarity(title, docTitle);
    if (similarity < 0.3) {
      if (opts?.debug) {
        process.stderr.write(
          `[readwise] rejected "${docTitle}" (similarity ${similarity.toFixed(2)}) for "${title}"\n`,
        );
      }
      return null;
    }

    return docTitle;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Text upload (for Readwise content)
// ---------------------------------------------------------------------------

/**
 * Upload text content as a document to the File Search store.
 * Writes to a temp file first since the SDK expects a file path.
 */
export async function uploadText(
  storeName: string,
  content: string,
  bibkey: string,
): Promise<void> {
  const tmpPath = join(tmpdir(), `cite-check-${bibkey}-${Date.now()}.md`);

  try {
    writeFileSync(tmpPath, content, "utf-8");
    await uploadPdf(storeName, tmpPath, bibkey, { mimeType: "text/markdown" });
  } finally {
    try { unlinkSync(tmpPath); } catch { /* best effort cleanup */ }
  }
}

// ---------------------------------------------------------------------------
// Bib-based upload
// ---------------------------------------------------------------------------

/**
 * Upload PDFs for the given bibkeys, resolving paths from the bib map.
 * Skips bibkeys already in the store and bibkeys without a file mapping.
 * When readwiseFallback is true, attempts to find sources without PDFs
 * in Readwise Reader by title.
 */
export async function uploadFromBib(
  storeName: string,
  bibMap: Map<string, BibEntry>,
  bibkeys: string[],
  opts?: { debug?: boolean; readwiseFallback?: boolean },
): Promise<{ uploaded: number; skipped: number; missing: number; fromReadwise: number }> {
  const existing = await listDocuments(storeName);
  const existingBibkeys = new Set(existing.map((d) => d.displayName));

  let uploaded = 0;
  let skipped = 0;
  let missing = 0;
  let fromReadwise = 0;

  for (const bibkey of bibkeys) {
    if (existingBibkeys.has(bibkey)) {
      skipped++;
      continue;
    }

    const entry = bibMap.get(bibkey);

    // Try PDF from bib file first
    if (entry?.filePath) {
      try {
        statSync(entry.filePath);
        if (opts?.debug) {
          process.stderr.write(`[gemini] uploading ${bibkey} <- ${entry.filePath}\n`);
        }
        await uploadPdf(storeName, entry.filePath, bibkey);
        uploaded++;
        continue;
      } catch {
        if (opts?.debug) {
          process.stderr.write(`[gemini] file not found: ${entry.filePath}\n`);
        }
      }
    }

    // Readwise fallback: search by title from bib entry
    if (opts?.readwiseFallback && entry?.title) {
      if (opts?.debug) {
        process.stderr.write(`[gemini] trying Readwise for ${bibkey} ("${entry.title}")\n`);
      }
      const content = await resolveFromReadwise(entry.title, opts);
      if (content) {
        await uploadText(storeName, content, bibkey);
        fromReadwise++;
        continue;
      }
    }

    missing++;
    if (opts?.debug) {
      process.stderr.write(`[gemini] no source found for ${bibkey}\n`);
    }
  }

  return { uploaded, skipped, missing, fromReadwise };
}

// ---------------------------------------------------------------------------
// Batch API types
// ---------------------------------------------------------------------------

export interface BatchRequest {
  key: string; // unique key to match results back to cite groups
  prompt: string;
  metadataFilter?: string;
}

export interface BatchResult {
  key: string;
  classification: ClassifyResult;
  error?: string;
}

// ---------------------------------------------------------------------------
// Batch cite-check
// ---------------------------------------------------------------------------

/**
 * Submit all citation queries as a single Gemini Batch API job.
 * Returns results keyed by the request key.
 */
export async function submitBatchCiteCheck(
  storeName: string,
  requests: BatchRequest[],
  opts?: { model?: string; debug?: boolean; pollIntervalMs?: number },
): Promise<BatchResult[]> {
  const client = getClient();
  const model = opts?.model ?? DEFAULT_MODEL;
  const pollInterval = opts?.pollIntervalMs ?? 30_000;

  // Build inline requests array
  const inlineRequests = requests.map((req) => {
    const fileSearchConfig: any = {
      fileSearchStoreNames: [storeName],
    };
    if (req.metadataFilter) {
      fileSearchConfig.metadataFilter = req.metadataFilter;
    }

    return {
      key: req.key,
      contents: [{ parts: [{ text: req.prompt }], role: "user" as const }],
      config: {
        tools: [{ fileSearch: fileSearchConfig }],
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["SUPPORTED", "PARTIAL", "UNSUPPORTED"],
              description: "Whether the source(s) support the claim",
            },
            supporting_passage: {
              type: "string",
              description: "Quote from the source that supports the claim, or empty string if unsupported",
            },
            explanation: {
              type: "string",
              description: "Brief explanation of the classification",
            },
          },
          required: ["status", "supporting_passage", "explanation"],
        },
      },
    };
  });

  if (opts?.debug) {
    process.stderr.write(`[gemini-batch] submitting ${inlineRequests.length} requests as batch job\n`);
  }

  // Submit batch job
  const batchJob = await client.batches.create({
    model,
    src: inlineRequests,
    config: {
      displayName: `cite-check-batch-${Date.now()}`,
    },
  });

  if (opts?.debug) {
    process.stderr.write(`[gemini-batch] job created: ${batchJob.name}\n`);
  }

  // Poll for completion
  const completedStates = new Set([
    "JOB_STATE_SUCCEEDED",
    "JOB_STATE_FAILED",
    "JOB_STATE_CANCELLED",
    "JOB_STATE_EXPIRED",
  ]);

  let job = batchJob;
  while (!completedStates.has(job.state as string)) {
    if (opts?.debug) {
      process.stderr.write(`[gemini-batch] state: ${job.state}, waiting ${pollInterval / 1000}s...\n`);
    }
    await new Promise((r) => setTimeout(r, pollInterval));
    job = await client.batches.get({ name: job.name! });
  }

  if (opts?.debug) {
    process.stderr.write(`[gemini-batch] job finished: ${job.state}\n`);
  }

  if (job.state !== "JOB_STATE_SUCCEEDED") {
    throw new Error(`Batch job failed with state: ${job.state}`);
  }

  // Parse results from inline responses
  const results: BatchResult[] = [];
  const responses = (job as any).dest?.inlinedResponses ?? [];

  for (let i = 0; i < responses.length; i++) {
    const key = requests[i]?.key ?? `unknown-${i}`;
    const inlineResponse = responses[i];

    if (inlineResponse.error) {
      results.push({
        key,
        classification: {
          status: "ERROR",
          supporting_passage: "",
          explanation: `Batch error: ${JSON.stringify(inlineResponse.error)}`,
        },
        error: JSON.stringify(inlineResponse.error),
      });
      continue;
    }

    const responseText = inlineResponse.response?.text ??
      inlineResponse.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    try {
      const parsed = JSON.parse(responseText || "{}");
      results.push({
        key,
        classification: {
          status: parsed.status ?? "ERROR",
          supporting_passage: parsed.supporting_passage ?? "",
          explanation: parsed.explanation ?? "",
        },
      });
    } catch {
      results.push({
        key,
        classification: {
          status: "ERROR",
          supporting_passage: "",
          explanation: `Failed to parse: ${responseText.slice(0, 200)}`,
        },
      });
    }
  }

  return results;
}

export async function queryCitation(
  storeName: string,
  prompt: string,
  opts?: {
    metadataFilter?: string;
    model?: string;
    debug?: boolean;
  },
): Promise<GeminiQueryResult> {
  const client = getClient();
  const model = opts?.model ?? DEFAULT_MODEL;
  const t0 = Date.now();

  const fileSearchConfig: any = {
    fileSearchStoreNames: [storeName],
  };
  if (opts?.metadataFilter) {
    fileSearchConfig.metadataFilter = opts.metadataFilter;
  }

  if (opts?.debug) {
    process.stderr.write(
      `[gemini] query model=${model} store=${storeName} filter=${opts?.metadataFilter ?? "none"}\n`,
    );
  }

  // Structured output with File Search: uses responseJsonSchema (Gemini 3+).
  // Heuristic fallback in catch block handles edge cases.
  const response = await client.models.generateContent({
    model,
    contents: prompt,
    config: {
      tools: [{ fileSearch: fileSearchConfig }],
      responseMimeType: "application/json",
      responseJsonSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["SUPPORTED", "PARTIAL", "UNSUPPORTED"],
            description: "Whether the source(s) support the claim",
          },
          supporting_passage: {
            type: "string",
            description: "Quote from the source that supports the claim, or empty string if unsupported",
          },
          explanation: {
            type: "string",
            description: "Brief explanation of the classification",
          },
        },
        required: ["status", "supporting_passage", "explanation"],
      },
    },
  });

  const durationMs = Date.now() - t0;

  let classification: ClassifyResult;
  try {
    const parsed = JSON.parse(response.text ?? "{}");
    classification = {
      status: parsed.status ?? "ERROR",
      supporting_passage: parsed.supporting_passage ?? "",
      explanation: parsed.explanation ?? "",
    };
  } catch {
    classification = {
      status: "ERROR",
      supporting_passage: "",
      explanation: `Failed to parse: ${(response.text ?? "").slice(0, 200)}`,
    };
  }

  // Extract grounding chunks
  const groundingChunks: GroundingChunk[] = [];
  const metadata = response.candidates?.[0]?.groundingMetadata;
  if (metadata?.groundingChunks) {
    for (const chunk of metadata.groundingChunks) {
      if (chunk.retrievedContext) {
        groundingChunks.push({
          text: chunk.retrievedContext.text ?? "",
          sourceTitle: chunk.retrievedContext.title ?? undefined,
          customMetadata: (chunk.retrievedContext as any).customMetadata,
        });
      }
    }
  }

  return { classification, groundingChunks, durationMs };
}
