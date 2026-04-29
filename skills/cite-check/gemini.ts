/**
 * Gemini Files API wrapper for cite-check.
 *
 * Uses Google AI Studio (GOOGLE_API_KEY) for citation verification.
 * Uploads PDFs via the Files API and passes file references inline
 * in generateContent calls so Gemini sees the full document.
 */

import { GoogleGenAI, Type } from "@google/genai";
import { readFileSync, statSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
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

export interface BibEntry {
  bibkey: string;
  filePath?: string;    // absolute path resolved from bib dir + relative file field
  fileRelPath?: string; // raw relative path from bib file (for cross-directory resolution)
  title?: string;       // for Readwise search fallback
}

/** Cached file upload result */
export interface FileRef {
  name: string;   // e.g. "files/abc-123"
  uri: string;    // e.g. "https://generativelanguage.googleapis.com/..."
  mimeType: string;
}

// ---------------------------------------------------------------------------
// Manifest: persistent file upload cache
// ---------------------------------------------------------------------------

/** A manifest entry tracks an uploaded file and when it was uploaded. */
export interface ManifestEntry extends FileRef {
  uploadedAt: number; // epoch ms
}

/** On-disk manifest mapping bibkey -> ManifestEntry. */
export interface Manifest {
  [bibkey: string]: ManifestEntry;
}

/** Gemini Files API retains uploads for 48 hours. */
const MANIFEST_TTL_MS = 48 * 60 * 60 * 1000;

/** Load a manifest from disk. Returns empty object if file doesn't exist or is invalid. */
export function loadManifest(path: string): Manifest {
  try {
    if (!existsSync(path)) return {};
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return {};
  }
}

/** Save a manifest to disk. */
export function saveManifest(path: string, manifest: Manifest): void {
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

/**
 * Verify that a file ref is still alive on the Gemini Files API.
 * Returns true if the file exists and is ACTIVE, false otherwise.
 */
export async function verifyFileRef(ref: FileRef): Promise<boolean> {
  try {
    const client = getClient();
    const file = await client.files.get({ name: ref.name });
    return file.state === "ACTIVE";
  } catch {
    return false;
  }
}

/**
 * Pre-populate a cache from a manifest, filtering out expired entries.
 * Entries within TTL are added to the cache without verification (fast path).
 * Returns the number of entries restored.
 */
export function restoreFromManifest(
  manifest: Manifest,
  cache: Map<string, FileRef>,
  bibkeys: string[],
): number {
  const now = Date.now();
  let restored = 0;
  for (const bibkey of bibkeys) {
    if (cache.has(bibkey)) continue;
    const entry = manifest[bibkey];
    if (!entry) continue;
    if (now - entry.uploadedAt > MANIFEST_TTL_MS) continue;
    cache.set(bibkey, { name: entry.name, uri: entry.uri, mimeType: entry.mimeType });
    restored++;
  }
  return restored;
}

/**
 * Update manifest from cache after uploads. Preserves existing entries that
 * are still within TTL; adds/refreshes entries from the cache.
 */
export function updateManifest(
  manifest: Manifest,
  cache: Map<string, FileRef>,
): Manifest {
  const now = Date.now();
  // Prune expired entries
  const updated: Manifest = {};
  for (const [key, entry] of Object.entries(manifest)) {
    if (now - entry.uploadedAt <= MANIFEST_TTL_MS) {
      updated[key] = entry;
    }
  }
  // Add/refresh from cache
  for (const [bibkey, ref] of cache) {
    if (!updated[bibkey]) {
      updated[bibkey] = { ...ref, uploadedAt: now };
    }
  }
  return updated;
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
      bibEntry.fileRelPath = relPath;
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
// Files API: upload
// ---------------------------------------------------------------------------

/** Upload a file to the Files API. Returns the file ref for use in generateContent. */
export async function uploadFile(
  filePath: string,
  opts?: { displayName?: string; mimeType?: string; _pollIntervalMs?: number },
): Promise<FileRef> {
  const client = getClient();
  const uploadConfig: Record<string, unknown> = {
    file: filePath,
    config: {
      displayName: opts?.displayName,
      mimeType: opts?.mimeType,
    },
  };
  const file = await client.files.upload(uploadConfig);
  if (!file.name) throw new Error(`Upload returned no name for ${filePath}`);

  // Poll until ACTIVE
  const maxWaitMs = 120_000;
  const pollMs = opts?._pollIntervalMs ?? 3_000;
  const start = Date.now();
  let state = file.state;
  while (state === "PROCESSING" || state === "STATE_UNSPECIFIED") {
    if (Date.now() - start > maxWaitMs) {
      throw new Error(`File stuck in ${state} after ${maxWaitMs / 1000}s`);
    }
    await new Promise(r => setTimeout(r, pollMs));
    const updated = await client.files.get({ name: file.name! });
    state = updated.state;
  }
  if (state === "FAILED") {
    throw new Error(`File processing failed: ${JSON.stringify(file.error)}`);
  }

  return {
    name: file.name,
    uri: file.uri ?? "",
    mimeType: file.mimeType ?? "application/pdf",
  };
}

/** Upload text content as a file. Writes to temp file, uploads, cleans up. */
export async function uploadTextFile(
  content: string,
  displayName: string,
): Promise<FileRef> {
  const tmpPath = join(tmpdir(), `cite-check-${displayName}-${Date.now()}.md`);
  try {
    writeFileSync(tmpPath, content, "utf-8");
    return await uploadFile(tmpPath, { displayName, mimeType: "text/markdown" });
  } finally {
    try { unlinkSync(tmpPath); } catch { /* best effort */ }
  }
}

/**
 * Try to find a PDF on disk by resolving a relative file path against multiple
 * directories. Returns the first path that exists, or null.
 */
export function resolveFileAcrossDirs(
  entry: BibEntry,
  bibDirs: string[],
  debug?: boolean,
): string | null {
  // 1. Try primary resolved path first
  if (entry.filePath) {
    try {
      statSync(entry.filePath);
      return entry.filePath;
    } catch {
      if (debug) {
        process.stderr.write(`[gemini] file not found at primary path: ${entry.filePath}\n`);
      }
    }
  }

  // 2. Try resolving the raw relative path against each bib directory
  if (entry.fileRelPath) {
    for (const dir of bibDirs) {
      const candidate = join(dir, entry.fileRelPath);
      if (candidate === entry.filePath) continue; // already tried
      try {
        statSync(candidate);
        if (debug) {
          process.stderr.write(`[gemini] found via fallback dir: ${candidate}\n`);
        }
        return candidate;
      } catch {
        // not in this dir, try next
      }
    }
  }

  return null;
}

/**
 * Upload all cited PDFs from bib entries. Returns a map of bibkey -> FileRef.
 * Skips bibkeys already in the cache.
 *
 * When bibDirs is provided, file paths that don't resolve from the entry's own
 * bib directory are tried against each directory in bibDirs. This handles the
 * common case where sources.bib has `file = {All Papers/...}` paths that are
 * relative to the Paperpile folder, not the project's references/ directory.
 */
export async function uploadCitedFiles(
  bibMap: Map<string, BibEntry>,
  citedBibkeys: string[],
  cache: Map<string, FileRef>,
  opts?: { debug?: boolean; readwiseFallback?: boolean; bibDirs?: string[] },
): Promise<{ uploaded: number; skipped: number; missing: number; fromReadwise: number }> {
  let uploaded = 0, skipped = 0, missing = 0, fromReadwise = 0;
  const dirs = opts?.bibDirs ?? [];

  for (const bibkey of citedBibkeys) {
    if (cache.has(bibkey)) { skipped++; continue; }

    const entry = bibMap.get(bibkey);

    // Try PDF file path from bib entry (with cross-directory fallback)
    if (entry?.filePath || entry?.fileRelPath) {
      const resolvedPath = entry ? resolveFileAcrossDirs(entry, dirs, opts?.debug) : null;
      if (resolvedPath) {
        const ref = await uploadFile(resolvedPath, { displayName: bibkey });
        cache.set(bibkey, ref);
        uploaded++;
        if (opts?.debug) {
          process.stderr.write(`[gemini] uploaded ${bibkey}: ${ref.name}\n`);
        }
        continue;
      }
    }

    // Readwise fallback
    if (opts?.readwiseFallback && entry?.title) {
      if (opts?.debug) {
        process.stderr.write(`[gemini] trying Readwise for ${bibkey} ("${entry.title}")\n`);
      }
      const content = await resolveFromReadwise(entry.title, opts);
      if (content) {
        const ref = await uploadTextFile(content, bibkey);
        cache.set(bibkey, ref);
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
  fileRefs: FileRef[];
}

export interface BatchResult {
  key: string;
  classification: ClassifyResult;
  error?: string;
}

// ---------------------------------------------------------------------------
// Response text extraction (for batch responses)
// ---------------------------------------------------------------------------

/**
 * Extract response text from a Gemini batch response object.
 * Handles both hydrated GenerateContentResponse class instances (with .text string)
 * and raw JSON objects from the batch API (with candidates array).
 */
export function extractResponseText(response: unknown): string {
  if (!response) return "";
  const resp = response as Record<string, unknown>;
  // 1. Try .text property (hydrated GenerateContentResponse class)
  if (typeof resp.text === "string") return resp.text;
  // 2. Try candidates path (raw JSON from batch API), joining all text parts
  const candidates = resp.candidates as Array<Record<string, unknown>> | undefined;
  const parts = (candidates?.[0]?.content as Record<string, unknown> | undefined)?.parts;
  if (Array.isArray(parts)) {
    return parts
      .filter((p: Record<string, unknown>) => typeof p.text === "string")
      .map((p: Record<string, unknown>) => p.text as string)
      .join("");
  }
  return "";
}

// ---------------------------------------------------------------------------
// Batch cite-check
// ---------------------------------------------------------------------------

/**
 * Submit all citation queries as a single Gemini Batch API job.
 * Returns results keyed by the request key.
 *
 * Now uses inline file references (fileData) instead of fileSearch tools,
 * which means we can use responseMimeType + responseSchema for structured output.
 */
export async function submitBatchCiteCheck(
  requests: BatchRequest[],
  opts?: { model?: string; debug?: boolean; pollIntervalMs?: number },
): Promise<BatchResult[]> {
  const client = getClient();
  const model = opts?.model ?? DEFAULT_MODEL;
  const pollInterval = opts?.pollIntervalMs ?? 30_000;

  // Build inline requests array
  const inlineRequests = requests.map((req) => {
    const parts: Array<Record<string, unknown>> = req.fileRefs.map(ref => ({
      fileData: { fileUri: ref.uri, mimeType: ref.mimeType },
    }));
    parts.push({ text: req.prompt });

    return {
      key: req.key,
      contents: [{ parts, role: "user" as const }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            status: { type: Type.STRING, enum: ["SUPPORTED", "PARTIAL", "UNSUPPORTED"] },
            supporting_passage: { type: Type.STRING },
            explanation: { type: Type.STRING },
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
  const responses = (job as Record<string, unknown> & { dest?: { inlinedResponses?: unknown[] } }).dest?.inlinedResponses ?? [];

  for (let i = 0; i < responses.length; i++) {
    const key = requests[i]?.key ?? `unknown-${i}`;
    const inlineResponse = responses[i] as Record<string, unknown>;

    // Raw response debug logging (before any parsing)
    if (opts?.debug) {
      process.stderr.write(`[gemini-batch] raw response ${i} (${key}): ${JSON.stringify(inlineResponse, null, 2).slice(0, 500)}\n`);
    }

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

    const responseText = extractResponseText(inlineResponse.response);

    if (opts?.debug) {
      process.stderr.write(`[gemini-batch] response ${i} (${key}): ${responseText.slice(0, 300)}\n`);
    }

    if (!responseText) {
      results.push({
        key,
        classification: { status: "ERROR", supporting_passage: "", explanation: "Empty response" },
      });
      continue;
    }

    // Parse JSON structured output
    let classification: ClassifyResult;
    try {
      const parsed = JSON.parse(responseText);
      classification = {
        status: parsed.status ?? "ERROR",
        supporting_passage: parsed.supporting_passage ?? "",
        explanation: parsed.explanation ?? "",
      };
    } catch {
      classification = {
        status: "ERROR",
        supporting_passage: "",
        explanation: `Failed to parse JSON: ${responseText.slice(0, 200)}`,
      };
    }

    results.push({ key, classification });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Sequential query
// ---------------------------------------------------------------------------

export async function queryCitation(
  fileRefs: FileRef[],
  prompt: string,
  opts?: {
    model?: string;
    debug?: boolean;
  },
): Promise<{ classification: ClassifyResult; durationMs: number }> {
  const client = getClient();
  const model = opts?.model ?? DEFAULT_MODEL;
  const t0 = Date.now();

  // Build content parts: file refs first, then the prompt
  const parts: Array<Record<string, unknown>> = fileRefs.map(ref => ({
    fileData: { fileUri: ref.uri, mimeType: ref.mimeType },
  }));
  parts.push({ text: prompt });

  if (opts?.debug) {
    process.stderr.write(
      `[gemini] query model=${model} fileRefs=${fileRefs.length}\n`,
    );
  }

  const response = await client.models.generateContent({
    model,
    contents: [{ parts, role: "user" }],
    config: {
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

  return { classification, durationMs };
}

// ---------------------------------------------------------------------------
// Concurrent batch query (isolated per-request, no cross-contamination)
// ---------------------------------------------------------------------------

/**
 * Run multiple citation queries concurrently using isolated generateContent
 * calls. Each request gets its own HTTP call, so file references cannot leak
 * across queries (unlike the Batch API which shares file context within a job).
 *
 * Concurrency is capped to avoid rate limits.
 */
export async function queryCitationsConcurrently(
  requests: BatchRequest[],
  opts?: { model?: string; debug?: boolean; concurrency?: number },
): Promise<BatchResult[]> {
  const concurrency = opts?.concurrency ?? 5;
  const results: BatchResult[] = new Array(requests.length);

  // Process in chunks of `concurrency`
  for (let i = 0; i < requests.length; i += concurrency) {
    const chunk = requests.slice(i, i + concurrency);
    const promises = chunk.map(async (req, j) => {
      try {
        const result = await queryCitation(req.fileRefs, req.prompt, opts);
        results[i + j] = { key: req.key, classification: result.classification };
      } catch (err) {
        results[i + j] = {
          key: req.key,
          classification: {
            status: "ERROR",
            supporting_passage: "",
            explanation: `Query error: ${err instanceof Error ? err.message : String(err)}`,
          },
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });
    await Promise.all(promises);

    if (opts?.debug && i + concurrency < requests.length) {
      process.stderr.write(
        `[gemini] completed ${Math.min(i + concurrency, requests.length)}/${requests.length} queries\n`,
      );
    }
  }

  return results;
}
