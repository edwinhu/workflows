/**
 * Gemini Files API wrapper for cite-check.
 *
 * Uses Google AI Studio (GOOGLE_API_KEY) for citation verification.
 * Uploads PDFs via the Files API and passes file references inline
 * in generateContent calls so Gemini sees the full document.
 */

import { GoogleGenAI, Type } from "@google/genai";
import { readFileSync, statSync, writeFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

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
  filePath?: string;       // absolute path resolved from bib dir + first file field path
  fileRelPath?: string;    // raw relative path from bib file (for cross-directory resolution)
  fileAltRelPaths?: string[]; // additional paths from semicolon-separated file fields
  title?: string;
  url?: string;
  author?: string;         // first author surname
  year?: string;
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
 *
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

    // Find file field in this entry.
    // Paperpile uses semicolon-separated paths when a paper has multiple PDF
    // copies: file = {path/a.pdf;path/b.pdf}. Store the first path as primary
    // and all paths for cross-directory resolution.
    const fileMatch = entry.match(/^\s*file\s*=\s*\{([^}]+)\}/m);
    if (fileMatch) {
      const rawField = fileMatch[1].trim();
      const paths = rawField.split(";").map((p) => p.trim()).filter(Boolean);
      const firstPath = paths[0];
      bibEntry.fileRelPath = firstPath;
      bibEntry.filePath = join(bibDir, firstPath);
      if (paths.length > 1) {
        bibEntry.fileAltRelPaths = paths.slice(1);
      }
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

    // Extract url field
    const urlMatch = entry.match(/^\s*url\s*=\s*\{([^}]+)\}/m);
    if (urlMatch) {
      bibEntry.url = urlMatch[1].trim();
    }

    // Extract author field (first author surname for Readwise fallback)
    const authorMatch = entry.match(/^\s*author\s*=\s*\{([^}]+)\}/m);
    if (authorMatch) {
      // Take first surname: "Hu, Edwin and Smith, John" → "Hu"
      const raw = authorMatch[1].trim();
      const firstAuthor = raw.split(/\s+and\s+/i)[0].split(",")[0].trim();
      bibEntry.author = firstAuthor;
    }

    // Extract year/date field
    const yearMatch = entry.match(/^\s*(?:year|date)\s*=\s*\{(\d{4})/m);
    if (yearMatch) {
      bibEntry.year = yearMatch[1];
    }

    map.set(bibkey, bibEntry);
  }

  return map;
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

// ---------------------------------------------------------------------------
// Google Drive FUSE bypass via rclone
// ---------------------------------------------------------------------------

const GDRIVE_FUSE_PREFIXES = [
  join(homedir(), "Google Drive/My Drive/"),
  join(homedir(), "Library/CloudStorage/") // macOS resolved symlink path
];
const RCLONE_REMOTE = "google-drive:";
const LOCAL_PDF_CACHE = join(homedir(), ".cache/cite-check-pdfs");

/**
 * Detect the Google Drive relative path from either the symlink or resolved path.
 * Google Drive Desktop mounts at ~/Library/CloudStorage/GoogleDrive-<email>/My Drive/
 * and symlinks ~/Google Drive/My Drive/ → there.
 *
 * Returns the path relative to "My Drive/" root, or null if not a Drive path.
 */
function extractDriveRelativePath(absPath: string): string | null {
  // Check ~/Google Drive/My Drive/ prefix
  const symlinkPrefix = GDRIVE_FUSE_PREFIXES[0];
  if (absPath.startsWith(symlinkPrefix)) {
    return absPath.slice(symlinkPrefix.length);
  }
  // Check ~/Library/CloudStorage/GoogleDrive-*/My Drive/ prefix
  const csPrefix = GDRIVE_FUSE_PREFIXES[1];
  if (absPath.startsWith(csPrefix)) {
    // Path is like: .../CloudStorage/GoogleDrive-user@gmail.com/My Drive/resources/...
    const afterCs = absPath.slice(csPrefix.length);
    const myDriveIdx = afterCs.indexOf("/My Drive/");
    if (myDriveIdx !== -1) {
      return afterCs.slice(myDriveIdx + "/My Drive/".length);
    }
  }
  return null;
}

function isDrivePath(absPath: string): boolean {
  return extractDriveRelativePath(absPath) !== null;
}

/**
 * Check if a path (or its symlink target) points into the Google Drive FUSE mount.
 * Returns the fully resolved path if it does, null otherwise.
 * Handles both the symlink (~/Google Drive/) and the real mount
 * (~/Library/CloudStorage/GoogleDrive-<email>/My Drive/).
 */
function resolveGdrivePath(filePath: string): string | null {
  // Check the path itself first
  if (isDrivePath(filePath)) return filePath;
  // Resolve symlinks: references/All Papers -> ~/Library/CloudStorage/.../All Papers
  try {
    const resolved = realpathSync(filePath);
    if (isDrivePath(resolved)) return resolved;
  } catch {
    // File doesn't exist yet; walk up to find first resolvable ancestor
    let dir = dirname(filePath);
    while (dir !== dirname(dir)) {
      try {
        const resolvedDir = realpathSync(dir);
        if (isDrivePath(resolvedDir)) {
          return join(resolvedDir, filePath.slice(dir.length + 1));
        }
        break;
      } catch {
        dir = dirname(dir);
      }
    }
  }
  return null;
}

/**
 * If a path is on the Google Drive FUSE mount (directly or via symlink),
 * copy it locally via rclone to avoid EDEADLK deadlocks.
 * Returns the local path (original or cached).
 */
export function ensureLocal(
  filePath: string,
  debug?: boolean,
): string {
  const gdrivePath = resolveGdrivePath(filePath);
  if (!gdrivePath) return filePath;

  // Convert FUSE path to rclone remote path
  const relativePath = extractDriveRelativePath(gdrivePath)!;
  const cachedPath = join(LOCAL_PDF_CACHE, basename(gdrivePath));

  // Return cached copy if it exists and has content
  if (existsSync(cachedPath)) {
    try {
      const st = statSync(cachedPath);
      if (st.size > 0) return cachedPath;
    } catch { /* re-download */ }
  }

  if (!existsSync(LOCAL_PDF_CACHE)) mkdirSync(LOCAL_PDF_CACHE, { recursive: true });

  if (debug) {
    process.stderr.write(`[rclone] copying ${basename(filePath)} from Google Drive...\n`);
  }

  const result = spawnSync("rclone", [
    "copyto",
    `${RCLONE_REMOTE}${relativePath}`,
    cachedPath,
  ], { timeout: 30_000 });

  if (result.status !== 0) {
    const err = result.stderr?.toString().slice(0, 200) ?? "unknown error";
    process.stderr.write(`[rclone] WARNING: copy failed: ${err}\n`);
    return filePath; // fall back to FUSE path
  }

  return cachedPath;
}

/**
 * Try to find a PDF on disk by resolving a relative file path against multiple
 * directories. Returns the first path that exists, or null.
 *
 * For local (non-FUSE) paths, uses statSync. For paths that resolve into
 * Google Drive, returns the path without checking existence — the caller
 * should use ensureLocalBatch() or ensureLocal() to copy via rclone.
 */
export function resolveFileAcrossDirs(
  entry: BibEntry,
  bibDirs: string[],
  debug?: boolean,
): string | null {
  // Collect all relative paths to try (primary + alternates from semicolon-separated fields)
  const relPaths: string[] = [];
  if (entry.fileRelPath) relPaths.push(entry.fileRelPath);
  if (entry.fileAltRelPaths) relPaths.push(...entry.fileAltRelPaths);

  // 1. Try primary resolved path first
  if (entry.filePath) {
    // If it resolves to Google Drive, trust the bib — don't stat the FUSE mount
    if (resolveGdrivePath(entry.filePath)) return entry.filePath;
    try {
      statSync(entry.filePath);
      return entry.filePath;
    } catch {
      if (debug) {
        process.stderr.write(`[gemini] file not found at primary path: ${entry.filePath}\n`);
      }
    }
  }

  // 2. Try resolving each relative path against each bib directory
  for (const relPath of relPaths) {
    for (const dir of bibDirs) {
      const candidate = join(dir, relPath);
      if (candidate === entry.filePath) continue; // already tried
      if (resolveGdrivePath(candidate)) return candidate;
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
 * Batch-copy all Google Drive files to the local cache in a single rclone call.
 * Uses `rclone copy --files-from` which is much faster than individual copyto calls.
 *
 * Returns a map of relative Drive path → local cache path for files that landed.
 */
export function ensureLocalBatch(
  entries: Array<{ bibkey: string; resolvedPath: string }>,
  debug?: boolean,
): Map<string, string> {
  const result = new Map<string, string>();
  const driveFiles: Array<{ bibkey: string; relativePath: string; cachedPath: string }> = [];
  const localFiles: Array<{ bibkey: string; path: string }> = [];

  if (!existsSync(LOCAL_PDF_CACHE)) mkdirSync(LOCAL_PDF_CACHE, { recursive: true });

  for (const { bibkey, resolvedPath } of entries) {
    const gdrivePath = resolveGdrivePath(resolvedPath);
    if (!gdrivePath) {
      // Local file — use directly
      localFiles.push({ bibkey, path: resolvedPath });
      continue;
    }
    const relativePath = extractDriveRelativePath(gdrivePath)!;
    const cachedPath = join(LOCAL_PDF_CACHE, basename(gdrivePath));

    // Already cached locally with content?
    if (existsSync(cachedPath)) {
      try {
        if (statSync(cachedPath).size > 0) {
          result.set(bibkey, cachedPath);
          continue;
        }
      } catch { /* re-download */ }
    }

    driveFiles.push({ bibkey, relativePath, cachedPath });
  }

  // Local files: just map them through
  for (const { bibkey, path } of localFiles) {
    result.set(bibkey, path);
  }

  // Batch rclone copy for all Drive files in one call
  if (driveFiles.length > 0) {
    // Write a files-from list (one relative path per line)
    const filesList = driveFiles.map((f) => f.relativePath).join("\n") + "\n";
    const filesFromPath = join(LOCAL_PDF_CACHE, ".files-from.txt");
    writeFileSync(filesFromPath, filesList, "utf-8");

    if (debug) {
      process.stderr.write(
        `[rclone] batch copying ${driveFiles.length} PDFs from Google Drive...\n`,
      );
    }

    const rcloneResult = spawnSync("rclone", [
      "copy",
      "--files-from", filesFromPath,
      `${RCLONE_REMOTE}`,
      LOCAL_PDF_CACHE,
      "--no-traverse",
    ], { timeout: 120_000 });

    if (rcloneResult.status !== 0 && debug) {
      process.stderr.write(
        `[rclone] batch copy exited ${rcloneResult.status}: ${rcloneResult.stderr?.toString().slice(0, 300) ?? ""}\n`,
      );
    }

    // Check which files actually landed
    for (const f of driveFiles) {
      // rclone copy --files-from preserves directory structure, so the file
      // lands at LOCAL_PDF_CACHE/<relativePath> not LOCAL_PDF_CACHE/<basename>
      const landedPath = join(LOCAL_PDF_CACHE, f.relativePath);
      if (existsSync(landedPath)) {
        try {
          if (statSync(landedPath).size > 0) {
            result.set(f.bibkey, landedPath);
            continue;
          }
        } catch { /* fall through to missing */ }
      }
      if (debug) {
        process.stderr.write(`[rclone] missing after batch copy: ${f.relativePath}\n`);
      }
    }
  }

  return result;
}

/**
 * Upload all cited PDFs from bib entries. Returns a map of bibkey -> FileRef.
 * Skips bibkeys already in the cache.
 *
 * For Google Drive paths, uses a single rclone batch copy instead of
 * per-file existence checks. Trust the bib file — copy everything, then
 * see what landed.
 */
export async function uploadCitedFiles(
  bibMap: Map<string, BibEntry>,
  citedBibkeys: string[],
  cache: Map<string, FileRef>,
  opts?: { debug?: boolean; bibDirs?: string[] },
): Promise<{ uploaded: number; skipped: number; missing: number }> {
  let uploaded = 0, skipped = 0, missing = 0;
  const dirs = opts?.bibDirs ?? [];

  // 1. Resolve all paths (no I/O for Drive paths — just trust the bib)
  const toResolve: Array<{ bibkey: string; resolvedPath: string }> = [];
  const noPath: string[] = [];

  for (const bibkey of citedBibkeys) {
    if (cache.has(bibkey)) { skipped++; continue; }
    const entry = bibMap.get(bibkey);
    if (!entry?.filePath && !entry?.fileRelPath) {
      noPath.push(bibkey);
      continue;
    }
    const resolvedPath = resolveFileAcrossDirs(entry, dirs, opts?.debug);
    if (resolvedPath) {
      toResolve.push({ bibkey, resolvedPath });
    } else {
      noPath.push(bibkey);
    }
  }

  // 2. Batch-copy Drive files locally (one rclone call)
  const localPaths = ensureLocalBatch(toResolve, opts?.debug);

  // 3. Upload each local file to Gemini
  for (const { bibkey } of toResolve) {
    const localPath = localPaths.get(bibkey);
    if (!localPath) {
      missing++;
      if (opts?.debug) {
        process.stderr.write(`[gemini] no local file for ${bibkey} after batch copy\n`);
      }
      continue;
    }
    try {
      const ext = localPath.split(".").pop()?.toLowerCase();
      const mimeType = ext === "md" ? "text/markdown" : ext === "pdf" ? "application/pdf" : undefined;
      const ref = await uploadFile(localPath, { displayName: bibkey, mimeType });
      cache.set(bibkey, ref);
      uploaded++;
      if (opts?.debug) {
        process.stderr.write(`[gemini] uploaded ${bibkey}: ${ref.name}\n`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[gemini] WARNING: failed to upload ${bibkey}: ${msg}\n`,
      );
      missing++;
    }
  }

  // 4. Count entries with no file path at all
  missing += noPath.length;
  if (opts?.debug && noPath.length > 0) {
    process.stderr.write(
      `[gemini] ${noPath.length} bibkeys have no file path: ${noPath.slice(0, 5).join(", ")}${noPath.length > 5 ? "..." : ""}\n`,
    );
  }

  return { uploaded, skipped, missing };
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

/**
 * JSON schema for structured citation verification output.
 * Shared between queryCitation and retry logic.
 */
const CITE_CHECK_SCHEMA = {
  type: "object" as const,
  properties: {
    status: {
      type: "string" as const,
      enum: ["SUPPORTED", "PARTIAL", "UNSUPPORTED"],
      description: "Whether the source(s) support the claim",
    },
    supporting_passage: {
      type: "string" as const,
      description: "Quote from the source that supports the claim, or empty string if unsupported",
    },
    explanation: {
      type: "string" as const,
      description: "Brief explanation of the classification",
    },
  },
  required: ["status", "supporting_passage", "explanation"],
};

function parseClassification(text: string | null | undefined): ClassifyResult {
  try {
    const parsed = JSON.parse(text ?? "{}");
    return {
      status: parsed.status ?? "ERROR",
      supporting_passage: parsed.supporting_passage ?? "",
      explanation: parsed.explanation ?? "",
    };
  } catch {
    return {
      status: "ERROR",
      supporting_passage: "",
      explanation: `Failed to parse: ${(text ?? "").slice(0, 200)}`,
    };
  }
}

export async function queryCitation(
  fileRefs: FileRef[],
  prompt: string,
  opts?: {
    model?: string;
    debug?: boolean;
    /** Model to use when retrying UNSUPPORTED results. If set, UNSUPPORTED
     *  results from the primary model are retried once with this model. */
    retryModel?: string;
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
      responseJsonSchema: CITE_CHECK_SCHEMA,
    },
  });

  const durationMs = Date.now() - t0;
  let classification = parseClassification(response.text);

  // Retry UNSUPPORTED with a stronger model if configured
  if (classification.status === "UNSUPPORTED" && opts?.retryModel) {
    if (opts?.debug) {
      process.stderr.write(
        `[gemini] UNSUPPORTED → retrying with ${opts.retryModel}\n`,
      );
    }
    const retryT0 = Date.now();
    const retryResponse = await client.models.generateContent({
      model: opts.retryModel,
      contents: [{ parts, role: "user" }],
      config: {
        temperature: 0,
        responseMimeType: "application/json",
        responseJsonSchema: CITE_CHECK_SCHEMA,
      },
    });
    const retryClassification = parseClassification(retryResponse.text);
    const totalMs = Date.now() - t0;

    if (retryClassification.status !== "UNSUPPORTED") {
      // Retry found support — use the retry result
      if (opts?.debug) {
        process.stderr.write(
          `[gemini] retry overturned → ${retryClassification.status} (${Date.now() - retryT0}ms)\n`,
        );
      }
      return { classification: retryClassification, durationMs: totalMs };
    }
    // Both said UNSUPPORTED — confirmed
    return { classification, durationMs: totalMs };
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
  opts?: { model?: string; debug?: boolean; concurrency?: number; retryModel?: string },
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
