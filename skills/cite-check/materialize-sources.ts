#!/usr/bin/env bun
/**
 * materialize-sources -- Copy all cited source documents into a local
 * references/ folder so cite-check can operate purely locally.
 *
 * Two channels:
 *   1. Paperpile PDFs: rclone batch copy from Google Drive
 *   2. Readwise articles: search by title, export markdown
 *
 * Usage:
 *   bun materialize-sources.ts --bib <path> [--bib <path2>] --refs <dir>
 *                              [--drafts <dir>] [--debug]
 *
 * --refs is the target references/ directory. PDFs and markdown files
 * are written there. The bib file's `file` fields are updated in-place
 * to point to local copies.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, basename, dirname, join, resolve, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { parseBibFile, ensureLocalBatch, type BibEntry } from "./gemini.js";
import { extractCitations } from "./cite-extract.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expandPath(p: string): string {
  if (p.startsWith("~")) return p.replace(/^~/, homedir());
  return isAbsolute(p) ? p : resolve(p);
}

// ---------------------------------------------------------------------------
// Readwise integration
// ---------------------------------------------------------------------------

interface ReadwiseDoc {
  document_id: string;
  title: string;
  author?: string;
  category?: string;
}

interface ReadwiseHighlight {
  id: number;
  score: number;
  attributes: {
    document_title: string;
    document_author: string;
    document_category: string;
    document_tags: string[];
    highlight_plaintext: string;
    highlight_note: string;
    highlight_tags: string[];
  };
  url: string;
}

/**
 * Search Readwise highlights using vector search.
 * Returns highlights grouped by source document — the stuff the user
 * actually marked as important while reading.
 */
function searchReadwiseHighlights(
  query: string,
  debug?: boolean,
  limit = 30,
): ReadwiseHighlight[] | null {
  const result = spawnSync("readwise", [
    "readwise-search-highlights",
    "--vector-search-term", query.slice(0, 200),
    "--limit", String(limit),
    "--json",
  ], { encoding: "utf-8", timeout: 30_000 });

  if (result.status !== 0 || !result.stdout) {
    if (debug) {
      process.stderr.write(`[readwise] highlight search failed: ${result.stderr?.slice(0, 100) ?? "no output"}\n`);
    }
    return null;
  }

  try {
    const highlights: ReadwiseHighlight[] = JSON.parse(result.stdout);
    return highlights.length > 0 ? highlights : null;
  } catch {
    return null;
  }
}

/**
 * Tokenize a title into significant words (lowercase, >3 chars, letters only).
 * Used to verify that a Readwise search result actually matches the queried title.
 */
function significantWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

/**
 * Return true if at least `threshold` fraction of `bibWords` appear in `rwTitle`.
 * Prevents semantic search from returning completely unrelated documents.
 */
function titleOverlaps(bibTitle: string, rwTitle: string, threshold = 0.5): boolean {
  const bibWords = significantWords(bibTitle);
  if (bibWords.length === 0) return true; // Can't reject if there's nothing to check
  const rwLower = rwTitle.toLowerCase();
  const matched = bibWords.filter((w) => rwLower.includes(w)).length;
  return matched / bibWords.length >= threshold;
}

/**
 * Search Readwise Reader for a document by title (exact match).
 * Used when matching known bib entries to Readwise documents.
 * Falls back to semantic search if title search returns nothing.
 * After the semantic fallback, verifies the returned document's title
 * overlaps sufficiently with the queried bib title — rejects mismatches.
 */
function searchReadwiseByTitle(title: string, author?: string, debug?: boolean, url?: string): ReadwiseDoc | null {
  // Try URL search first (most precise — exact URL match)
  if (url) {
    const urlResult = spawnSync("readwise", [
      "reader-search-documents",
      "--url-search", url,
      "--limit", "1",
      "--json",
    ], { encoding: "utf-8", timeout: 15_000 });

    if (urlResult.status === 0 && urlResult.stdout) {
      try {
        const docs: ReadwiseDoc[] = JSON.parse(urlResult.stdout);
        if (docs.length > 0) {
          if (debug) process.stderr.write(`[readwise] found by URL: ${url.slice(0, 60)}\n`);
          return docs[0];
        }
      } catch { /* fall through to title search */ }
    }
  }

  // Strip BibTeX braces and escape chars before searching
  const cleanTitle = title.replace(/[{}\\]/g, "").slice(0, 100);

  // Try title search first (precise)
  const titleArgs = ["reader-search-documents", "--title-search", cleanTitle, "--json"];
  if (author) titleArgs.splice(2, 0, "--author-search", author);
  const titleResult = spawnSync("readwise", titleArgs, { encoding: "utf-8", timeout: 30_000 });

  if (titleResult.status === 0 && titleResult.stdout) {
    try {
      const docs: ReadwiseDoc[] = JSON.parse(titleResult.stdout);
      if (docs.length > 0) return docs[0];
    } catch { /* fall through to semantic */ }
  }

  // Fall back to semantic search with author + title (broader)
  const semanticQuery = author ? `${author} ${cleanTitle}` : cleanTitle;
  if (debug) {
    process.stderr.write(`[readwise] title search miss, trying semantic: "${semanticQuery.slice(0, 50)}"\n`);
  }
  const results = searchReadwiseSemantic(semanticQuery, debug);
  if (!results || results.length === 0) return null;

  // Verify the top semantic result actually matches the queried title.
  // Semantic search is broad — it can return completely unrelated documents
  // (e.g., searching "White & Case INDEX Act" returns "Robo-Voting" because
  // they share thematic keywords). Require ≥50% of significant bib title words
  // to appear in the Readwise document title.
  const topDoc = results[0];
  if (!titleOverlaps(cleanTitle, topDoc.title ?? "")) {
    if (debug) {
      process.stderr.write(
        `[readwise] semantic match rejected (title mismatch): bib="${cleanTitle.slice(0, 50)}" ≠ rw="${(topDoc.title ?? "").slice(0, 50)}"\n`,
      );
    }
    return null;
  }

  return topDoc;
}

/**
 * Search Readwise Reader using semantic/hybrid search.
 * Used for discovery (lit review) — finds documents by content relevance.
 */
function searchReadwiseSemantic(query: string, debug?: boolean, limit = 10): ReadwiseDoc[] | null {
  const result = spawnSync("readwise", [
    "reader-search-documents",
    "--query", query.slice(0, 200),
    "--limit", String(limit),
    "--json",
  ], { encoding: "utf-8", timeout: 30_000 });

  if (result.status !== 0 || !result.stdout) {
    if (debug) {
      process.stderr.write(`[readwise] semantic search failed for "${query.slice(0, 40)}": ${result.stderr?.slice(0, 100) ?? "no output"}\n`);
    }
    return null;
  }

  try {
    const docs: ReadwiseDoc[] = JSON.parse(result.stdout);
    return docs.length > 0 ? docs : null;
  } catch {
    return null;
  }
}

/**
 * Export a Readwise Reader document as markdown.
 * Returns the markdown content or null.
 */
function exportReadwiseMarkdown(docId: string, debug?: boolean): string | null {
  const result = spawnSync("readwise", [
    "reader-get-document-details",
    "--document-id", docId,
    "--json",
  ], { encoding: "utf-8", timeout: 30_000 });

  if (result.status !== 0 || !result.stdout) {
    if (debug) {
      process.stderr.write(`[readwise] export failed for ${docId}\n`);
    }
    return null;
  }

  try {
    const doc = JSON.parse(result.stdout);
    return doc.content ?? null;
  } catch {
    return null;
  }
}

/**
 * Save a URL to Readwise Reader. Reader scrapes the page and converts
 * to its internal format. After saving, the document can be exported
 * as markdown via reader-get-document-details.
 *
 * Returns the document_id if saved, or null on failure.
 */
function saveUrlToReadwise(
  url: string,
  opts?: { title?: string; author?: string; tags?: string[]; debug?: boolean },
): string | null {
  const args = ["reader-create-document", "--url", url, "--json"];
  if (opts?.title) args.push("--title", opts.title);
  if (opts?.author) args.push("--author", opts.author);
  if (opts?.tags?.length) args.push("--tags", opts.tags.join(","));

  const result = spawnSync("readwise", args, {
    encoding: "utf-8",
    timeout: 30_000,
  });

  if (result.status !== 0 || !result.stdout) {
    if (opts?.debug) {
      process.stderr.write(`[readwise] save URL failed: ${result.stderr?.slice(0, 200) ?? "no output"}\n`);
    }
    return null;
  }

  try {
    const doc = JSON.parse(result.stdout);
    return doc.id ?? doc.document_id ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Bibkey generation (Paperpile-style: Author2024-xx)
// ---------------------------------------------------------------------------

/**
 * Generate a bibkey from author + year in Paperpile style: Author2024-xx
 * where xx is a random two-char suffix to avoid collisions.
 */
function generateBibkey(author?: string, year?: string): string {
  // Extract first author surname
  let surname = "Unknown";
  if (author) {
    // Handle "First Last", "Last, First", "Organization Name"
    const parts = author.split(/[,;]| and /i)[0].trim().split(/\s+/);
    surname = parts[parts.length - 1] // last word = surname
      .replace(/[^a-zA-Z]/g, "");
    if (!surname) surname = parts[0]?.replace(/[^a-zA-Z]/g, "") || "Unknown";
  }
  // Capitalize first letter
  surname = surname.charAt(0).toUpperCase() + surname.slice(1).toLowerCase();

  const yr = year || new Date().getFullYear().toString();

  // Random two-char suffix (lowercase letters)
  const chars = "abcdefghijklmnopqrstuvwxyz";
  const suffix = chars[Math.floor(Math.random() * 26)] + chars[Math.floor(Math.random() * 26)];

  return `${surname}${yr}-${suffix}`;
}

/**
 * Generate a BibTeX entry from metadata.
 */
function generateBibEntry(bibkey: string, meta: {
  title: string;
  author?: string;
  year?: string;
  url?: string;
  filePath?: string;
}): string {
  const lines = [`@misc{${bibkey},`];
  lines.push(`  title = {${meta.title}},`);
  if (meta.author) lines.push(`  author = {${meta.author}},`);
  if (meta.year) lines.push(`  year = {${meta.year}},`);
  if (meta.url) lines.push(`  url = {${meta.url}},`);
  if (meta.filePath) lines.push(`  file = {${meta.filePath}},`);
  lines.push("}");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseFlags(argv: string[]): {
  args: string[];
  flags: Record<string, string | boolean | string[]>;
} {
  const args: string[] = [];
  const flags: Record<string, string | boolean | string[]> = {};

  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (key === "bib" && i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        // Accumulate multiple --bib flags
        const existing = flags[key];
        if (Array.isArray(existing)) {
          existing.push(argv[i + 1]);
        } else if (typeof existing === "string") {
          flags[key] = [existing, argv[i + 1]];
        } else {
          flags[key] = argv[i + 1];
        }
        i += 2;
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        flags[key] = argv[i + 1];
        i += 2;
      } else {
        flags[key] = true;
        i++;
      }
    } else {
      args.push(a);
      i++;
    }
  }

  return { args, flags };
}

async function main(): Promise<number> {
  const { flags } = parseFlags(Bun.argv.slice(2));

  // Collect bib paths
  const rawBibPaths = flags.bib;
  const bibPaths: string[] = Array.isArray(rawBibPaths)
    ? rawBibPaths.map(expandPath)
    : typeof rawBibPaths === "string"
      ? [expandPath(rawBibPaths)]
      : [];

  // Discovery mode: search both highlights AND documents, merge by title
  const discoverQuery = flags.discover;
  if (typeof discoverQuery === "string") {
    process.stderr.write(`[discover] searching Readwise for: "${discoverQuery}"\n`);

    // Run both searches in parallel (sequential here but fast enough)
    const highlights = searchReadwiseHighlights(discoverQuery, true, 30);
    const docs = searchReadwiseSemantic(discoverQuery, true, 20);

    // Merge into a unified map keyed by document title
    const byDoc = new Map<string, {
      title: string;
      author: string;
      category: string;
      document_id?: string;
      highlights: string[];
      fromHighlights: boolean;
      fromDocSearch: boolean;
    }>();

    // Add highlight results (user actually marked these)
    if (highlights) {
      for (const h of highlights) {
        const key = h.attributes.document_title;
        let group = byDoc.get(key);
        if (!group) {
          group = {
            title: h.attributes.document_title,
            author: h.attributes.document_author,
            category: h.attributes.document_category,
            highlights: [],
            fromHighlights: true,
            fromDocSearch: false,
          };
          byDoc.set(key, group);
        }
        group.fromHighlights = true;
        if (h.attributes.highlight_plaintext) {
          group.highlights.push(h.attributes.highlight_plaintext.slice(0, 200));
        }
      }
    }

    // Add document search results (may include unread/unhighlighted docs)
    if (docs) {
      for (const d of docs) {
        const key = d.title;
        let group = byDoc.get(key);
        if (!group) {
          group = {
            title: d.title,
            author: d.author ?? "",
            category: d.category ?? "",
            document_id: d.document_id,
            highlights: [],
            fromHighlights: false,
            fromDocSearch: true,
          };
          byDoc.set(key, group);
        } else {
          group.fromDocSearch = true;
          if (d.document_id) group.document_id = d.document_id;
        }
      }
    }

    if (byDoc.size === 0) {
      process.stderr.write(`[discover] no results\n`);
      return 0;
    }

    // Sort: highlighted docs first (user engaged with these), then doc-only
    const sorted = [...byDoc.values()].sort((a, b) => {
      if (a.fromHighlights && !b.fromHighlights) return -1;
      if (!a.fromHighlights && b.fromHighlights) return 1;
      return b.highlights.length - a.highlights.length;
    });

    const hlCount = sorted.filter((d) => d.fromHighlights).length;
    const docOnly = sorted.filter((d) => !d.fromHighlights).length;
    process.stderr.write(
      `[discover] ${byDoc.size} documents (${hlCount} with highlights, ${docOnly} from doc search only)\n\n`,
    );

    for (const doc of sorted) {
      const author = doc.author ? ` by ${doc.author}` : "";
      const source = doc.fromHighlights && doc.fromDocSearch
        ? " [highlights + doc]"
        : doc.fromHighlights
          ? " [highlighted]"
          : " [saved, no highlights]";
      console.log(`## ${doc.title}${author} [${doc.category}]${source}`);
      for (const hl of doc.highlights.slice(0, 3)) {
        console.log(`  > ${hl.replace(/\n/g, " ").trim()}`);
      }
      if (doc.highlights.length > 3) {
        console.log(`  ... and ${doc.highlights.length - 3} more highlights`);
      }
      console.log();
    }
    return 0;
  }

  // Save-URLs mode: save URLs to Readwise Reader, generate bibkeys, export to references/
  // Usage: materialize-sources --save-urls <file> --refs <dir> [--bib <path>] [--tag <tag>] [--debug]
  // File format: one URL per line, optionally "URL | Title | Author | Year"
  const saveUrlsFile = flags["save-urls"];
  if (typeof saveUrlsFile === "string") {
    const refsDir = expandPath(typeof flags.refs === "string" ? flags.refs : "./references");
    const tag = typeof flags.tag === "string" ? flags.tag : undefined;
    const debug = !!flags.debug;
    // Optional: append generated bib entries to a .bib file
    const bibOutPath = bibPaths.length > 0 ? bibPaths[bibPaths.length - 1] : join(refsDir, "sources.bib");

    if (!existsSync(refsDir)) mkdirSync(refsDir, { recursive: true });

    // Load existing bib to check for duplicate bibkeys and URL matches
    const existingBib = existsSync(bibOutPath) ? readFileSync(bibOutPath, "utf-8") : "";
    const existingUrls = new Set<string>();
    for (const m of existingBib.matchAll(/url\s*=\s*\{([^}]+)\}/g)) {
      existingUrls.add(m[1].trim());
    }

    const lines = readFileSync(expandPath(saveUrlsFile), "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    process.stderr.write(`[save-urls] processing ${lines.length} URLs → Readwise → ${refsDir}\n`);

    let saved = 0;
    let exported = 0;
    let failed = 0;
    const newBibEntries: string[] = [];

    for (const line of lines) {
      // Parse "URL | Title | Author | Year" or just "URL"
      const parts = line.split("|").map((p) => p.trim());
      const url = parts[0];
      let title = parts[1] || undefined;
      let author = parts[2] || undefined;
      const year = parts[3] || undefined;

      if (!url.startsWith("http")) {
        process.stderr.write(`  [skip] not a URL: ${url.slice(0, 60)}\n`);
        continue;
      }

      // Skip if URL already in bib
      if (existingUrls.has(url)) {
        if (debug) process.stderr.write(`  [in bib] ${title ?? url.slice(0, 50)}\n`);
        continue;
      }

      // Check if already in Readwise by URL
      const existing = spawnSync("readwise", [
        "reader-search-documents",
        "--url-search", url,
        "--limit", "1",
        "--json",
      ], { encoding: "utf-8", timeout: 15_000 });

      let docId: string | null = null;
      let docTitle = title;
      let docAuthor = author;
      if (existing.status === 0 && existing.stdout) {
        try {
          const docs = JSON.parse(existing.stdout);
          if (docs.length > 0) {
            docId = docs[0].document_id;
            docTitle = docTitle ?? docs[0].title;
            docAuthor = docAuthor ?? docs[0].author;
            if (debug) process.stderr.write(`  [exists] ${docTitle ?? url.slice(0, 50)} already in Readwise\n`);
          }
        } catch { /* save fresh */ }
      }

      // Save to Readwise if not already there
      if (!docId) {
        const tags = tag ? [tag] : undefined;
        docId = saveUrlToReadwise(url, { title, author, tags, debug });
        if (docId) {
          saved++;
          process.stderr.write(`  [saved] ${title ?? url.slice(0, 50)} → ${docId}\n`);
          // Wait for Readwise to scrape
          Bun.sleepSync(2000);
        } else {
          failed++;
          process.stderr.write(`  [failed] ${title ?? url.slice(0, 50)}\n`);
          continue;
        }
      }

      // Resolve title/author from Readwise if not provided
      if (!docTitle || !docAuthor) {
        const details = spawnSync("readwise", [
          "reader-get-document-details",
          "--document-id", docId,
          "--json",
        ], { encoding: "utf-8", timeout: 30_000 });
        if (details.status === 0 && details.stdout) {
          try {
            const doc = JSON.parse(details.stdout);
            docTitle = docTitle ?? doc.title;
            docAuthor = docAuthor ?? doc.author;
          } catch { /* use what we have */ }
        }
      }

      // Generate bibkey
      const bibkey = generateBibkey(docAuthor, year);
      const fileName = `${bibkey}.md`;
      const destPath = join(refsDir, fileName);

      if (existsSync(destPath) && statSync(destPath).size > 100) {
        if (debug) process.stderr.write(`  [cached] ${fileName}\n`);
        exported++;
        continue;
      }

      // Export markdown
      const markdown = exportReadwiseMarkdown(docId, debug);
      if (markdown && markdown.length > 50) {
        const header = [
          "---",
          `bibkey: ${bibkey}`,
          `title: "${(docTitle ?? "Untitled").replace(/"/g, '\\"')}"`,
          `author: "${(docAuthor ?? "").replace(/"/g, '\\"')}"`,
          `url: "${url}"`,
          `year: "${year ?? ""}"`,
          `source: readwise`,
          `readwise_id: "${docId}"`,
          "---",
          "",
        ].join("\n");
        writeFileSync(destPath, header + markdown, "utf-8");
        exported++;
        process.stderr.write(`  [exported] ${bibkey}: "${(docTitle ?? "").slice(0, 50)}" → ${fileName}\n`);

        // Generate bib entry
        const bibEntry = generateBibEntry(bibkey, {
          title: docTitle ?? "Untitled",
          author: docAuthor,
          year,
          url,
          filePath: fileName,
        });
        newBibEntries.push(bibEntry);
      } else {
        process.stderr.write(`  [no content] ${bibkey} — Readwise may still be scraping\n`);
      }
    }

    // Append new bib entries to sources.bib
    if (newBibEntries.length > 0) {
      const bibAppend = "\n" + newBibEntries.join("\n\n") + "\n";
      const existingContent = existsSync(bibOutPath) ? readFileSync(bibOutPath, "utf-8") : "";
      writeFileSync(bibOutPath, existingContent + bibAppend, "utf-8");
      process.stderr.write(`\n[save-urls] appended ${newBibEntries.length} bib entries to ${bibOutPath}\n`);
    }

    process.stderr.write(
      `[save-urls] ${saved} saved to Readwise, ${exported} exported to references/, ${failed} failed\n`,
    );

    // Print generated bibkeys for the user
    if (newBibEntries.length > 0) {
      process.stderr.write(`\nGenerated bibkeys (use these in your draft as [@bibkey]):\n`);
      for (const entry of newBibEntries) {
        const keyMatch = entry.match(/@misc\{(\S+),/);
        const titleMatch = entry.match(/title = \{(.+?)\}/);
        if (keyMatch) {
          process.stderr.write(`  @${keyMatch[1]}  ${titleMatch?.[1] ?? ""}\n`);
        }
      }
    }

    return failed > 0 ? 1 : 0;
  }

  if (bibPaths.length === 0) {
    console.error("Usage: materialize-sources --bib <path> [--bib <path2>] --refs <dir> [--drafts <dir>] [--debug]\n       materialize-sources --discover \"<semantic query>\"\n       materialize-sources --save-urls <file> --refs <dir> [--tag <tag>] [--debug]");
    return 1;
  }

  const refsDir = expandPath(typeof flags.refs === "string" ? flags.refs : "./references");
  const draftsDir = flags.drafts ? expandPath(flags.drafts as string) : undefined;
  const debug = !!flags.debug;

  if (!existsSync(refsDir)) mkdirSync(refsDir, { recursive: true });

  // 1. Parse all bib files (first wins on duplicate keys)
  const bibMap = new Map<string, BibEntry>();
  const bibDirs: string[] = [];
  for (const bp of bibPaths) {
    try {
      const entries = parseBibFile(bp);
      for (const [key, entry] of entries) {
        if (!bibMap.has(key)) bibMap.set(key, entry);
      }
      bibDirs.push(dirname(bp));
      process.stderr.write(`[materialize] parsed ${entries.size} entries from ${bp}\n`);
    } catch (err) {
      console.error(`Failed to parse ${bp}: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  // 2. If drafts dir given, only materialize cited bibkeys
  let targetBibkeys: string[];
  if (draftsDir && existsSync(draftsDir)) {
    const files = readdirSync(draftsDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"))
      .map((e) => join(draftsDir, e.name));

    const allCites = files.flatMap((f) => {
      const text = readFileSync(f, "utf-8");
      return extractCitations(text, f);
    });
    targetBibkeys = [...new Set(allCites.map((c) => c.bibkey))];
    process.stderr.write(`[materialize] ${targetBibkeys.length} unique bibkeys cited in ${files.length} draft files\n`);
  } else {
    targetBibkeys = [...bibMap.keys()];
    process.stderr.write(`[materialize] materializing all ${targetBibkeys.length} bib entries (no --drafts filter)\n`);
  }

  // 3. Categorize entries
  const withFile: Array<{ bibkey: string; entry: BibEntry }> = [];
  const withoutFile: Array<{ bibkey: string; entry: BibEntry }> = [];
  const notInBib: string[] = [];

  for (const bibkey of targetBibkeys) {
    const entry = bibMap.get(bibkey);
    if (!entry) {
      notInBib.push(bibkey);
      continue;
    }
    if (entry.filePath || entry.fileRelPath) {
      withFile.push({ bibkey, entry });
    } else {
      withoutFile.push({ bibkey, entry });
    }
  }

  process.stderr.write(
    `[materialize] ${withFile.length} with PDF, ${withoutFile.length} without PDF, ${notInBib.length} not in bib\n`,
  );

  // 4. Paperpile PDFs: batch rclone copy
  let paperpileCopied = 0;
  let paperpileMissing = 0;

  if (withFile.length > 0) {
    process.stderr.write(`[materialize] copying ${withFile.length} Paperpile PDFs...\n`);

    // Resolve paths (trusts bib for Drive paths)
    const toResolve = withFile.map(({ bibkey, entry }) => {
      // Try primary path, then cross-directory fallback
      let resolvedPath = entry.filePath;
      if (resolvedPath && !existsSync(resolvedPath)) {
        // Try relative path against each bib directory
        for (const dir of bibDirs) {
          if (entry.fileRelPath) {
            const candidate = join(dir, entry.fileRelPath);
            resolvedPath = candidate;
            break;
          }
        }
      }
      return { bibkey, resolvedPath: resolvedPath! };
    }).filter((e) => e.resolvedPath);

    const localPaths = ensureLocalBatch(toResolve, debug);

    // Copy from local cache to references/
    // Track bibkeys that fail Paperpile PDF copy — they fall through to Readwise
    const paperpileFailed = new Set<string>();

    for (const { bibkey } of withFile) {
      const localPath = localPaths.get(bibkey);
      if (!localPath || !existsSync(localPath)) {
        paperpileMissing++;
        paperpileFailed.add(bibkey);
        if (debug) process.stderr.write(`  [missing] ${bibkey}\n`);
        continue;
      }

      const destPath = join(refsDir, `${bibkey}.pdf`);
      if (existsSync(destPath) && statSync(destPath).size > 0) {
        // Validate cached file is actually a PDF
        const cachedHeader = readFileSync(destPath, { encoding: null }).slice(0, 5).toString("utf-8");
        if (cachedHeader !== "%PDF-") {
          if (debug) process.stderr.write(`  [not-pdf] ${bibkey}: cached .pdf is not a real PDF, will try Readwise\n`);
          paperpileMissing++;
          paperpileFailed.add(bibkey);
          continue;
        }
        if (debug) process.stderr.write(`  [cached] ${bibkey}\n`);
        paperpileCopied++;
        continue;
      }

      try {
        const content = readFileSync(localPath);
        // Validate the file is actually a PDF before writing as .pdf
        const isPdf = content.length >= 5 && content.slice(0, 5).toString("utf-8") === "%PDF-";
        if (!isPdf) {
          if (debug) process.stderr.write(`  [not-pdf] ${bibkey}: source is not a real PDF, will try Readwise\n`);
          paperpileMissing++;
          paperpileFailed.add(bibkey);
          continue;
        }
        writeFileSync(destPath, content);
        paperpileCopied++;
        if (debug) process.stderr.write(`  [copied] ${bibkey} → ${basename(destPath)}\n`);
      } catch (err) {
        paperpileMissing++;
        paperpileFailed.add(bibkey);
        if (debug) process.stderr.write(`  [error] ${bibkey}: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }

    process.stderr.write(
      `[materialize] Paperpile: ${paperpileCopied} copied, ${paperpileMissing} missing\n`,
    );

    // Move failed Paperpile bibkeys to withoutFile so Readwise step picks them up
    if (paperpileFailed.size > 0) {
      for (const { bibkey, entry } of withFile) {
        if (paperpileFailed.has(bibkey)) {
          withoutFile.push({ bibkey, entry });
        }
      }
      if (debug) {
        process.stderr.write(
          `[materialize] ${paperpileFailed.size} bibkeys falling through to Readwise: ${[...paperpileFailed].join(", ")}\n`,
        );
      }
    }
  }

  // 4b. Collect bibkeys where a real PDF now exists but bib still points to .md
  //     This happens when a Readwise .md was exported first, then the PDF
  //     became available via Paperpile. The bib file field should be updated.
  //     Guard: only override if the file is actually a PDF (check %PDF- magic).
  const bibPdfOverrides: Array<{ bibkey: string }> = [];
  if (bibPaths.length > 0) {
    const bibToCheck = bibPaths[bibPaths.length - 1];
    const bibContent = readFileSync(bibToCheck, "utf-8");
    for (const { bibkey } of withFile) {
      const pdfDest = join(refsDir, `${bibkey}.pdf`);
      if (!existsSync(pdfDest)) continue;
      // Validate it's actually a PDF, not a renamed markdown file
      const fd = Bun.file(pdfDest);
      const header = Buffer.from(await fd.slice(0, 5).arrayBuffer());
      if (header.toString("utf-8") !== "%PDF-") {
        if (debug) process.stderr.write(`  [skip-override] ${bibkey}: .pdf is not a real PDF, keeping .md\n`);
        continue;
      }
      // Check if the bib entry has file = {<bibkey>.md}
      const hasMdFile = new RegExp(
        `file\\s*=\\s*\\{${bibkey}\\.md\\}`,
      ).test(bibContent);
      if (hasMdFile) {
        bibPdfOverrides.push({ bibkey });
        if (debug) process.stderr.write(`  [override] ${bibkey}: .md → .pdf in bib\n`);
      }
    }
  }

  // 5. Readwise: search by title, export markdown, update bib with file fields
  let readwiseFound = 0;
  let readwiseMissing = 0;
  const readwiseGaps: Array<{ bibkey: string; title: string; url?: string }> = [];
  const newBibEntries: string[] = [];
  const bibFileUpdates: Array<{ bibkey: string; fileName: string }> = [];

  // 5a. Entries IN bib but without file field — search Readwise by title
  if (withoutFile.length > 0) {
    process.stderr.write(`[materialize] searching Readwise for ${withoutFile.length} non-PDF sources...\n`);

    for (const { bibkey, entry } of withoutFile) {
      const fileName = `${bibkey}.md`;
      const destPath = join(refsDir, fileName);

      // Skip if already materialized with real content (not a YAML-only stub)
      if (existsSync(destPath)) {
        const fileSize = statSync(destPath).size;
        if (fileSize > 500) {
          // Real content, not just a YAML stub
          if (debug) process.stderr.write(`  [cached] ${bibkey}\n`);
          readwiseFound++;
          bibFileUpdates.push({ bibkey, fileName });
          continue;
        }
        // Small file — likely a stub, re-export
        if (debug) process.stderr.write(`  [stub] ${bibkey} (${fileSize}B) — re-exporting\n`);
      }

      const title = entry.title ?? bibkey;
      const doc = searchReadwiseByTitle(title, entry.author, debug, entry.url);

      if (!doc || !doc.document_id) {
        readwiseMissing++;
        readwiseGaps.push({ bibkey, title, url: entry.url });
        if (debug) process.stderr.write(`  [not found] ${bibkey}: "${title.slice(0, 50)}"\n`);
        continue;
      }

      // Export full markdown
      const markdown = exportReadwiseMarkdown(doc.document_id, debug);
      if (!markdown) {
        readwiseMissing++;
        readwiseGaps.push({ bibkey, title, url: entry.url });
        continue;
      }

      // Write with frontmatter
      const header = [
        "---",
        `bibkey: ${bibkey}`,
        `title: "${title.replace(/"/g, '\\"')}"`,
        `author: ${entry.author ?? doc.author ?? "unknown"}`,
        `year: ${entry.year ?? ""}`,
        `source: readwise`,
        `readwise_id: ${doc.document_id}`,
        `category: ${doc.category ?? "unknown"}`,
        "---",
        "",
      ].join("\n");

      writeFileSync(destPath, header + markdown, "utf-8");
      readwiseFound++;
      bibFileUpdates.push({ bibkey, fileName });
      process.stderr.write(`  [exported] ${bibkey}: "${title.slice(0, 50)}" (${doc.category})\n`);
    }
  }

  // 5b. Entries NOT in any bib — search Readwise, generate bibkey + bib entry
  if (notInBib.length > 0) {
    process.stderr.write(`[materialize] searching Readwise for ${notInBib.length} bibkeys not in any bib file...\n`);

    for (const bibkey of notInBib) {
      const fileName = `${bibkey}.md`;
      const destPath = join(refsDir, fileName);

      if (existsSync(destPath)) {
        const fileSize = statSync(destPath).size;
        if (fileSize > 500) {
          // Real content, not just a YAML stub
          if (debug) process.stderr.write(`  [cached] ${bibkey}\n`);
          readwiseFound++;
          continue;
        }
        // Small file — likely a stub, re-export
        if (debug) process.stderr.write(`  [stub] ${bibkey} (${fileSize}B) — re-exporting\n`);
      }

      // Try to find in Readwise — use bibkey as search hint (e.g., "Daly2026" → "Daly 2026")
      const searchHint = bibkey.replace(/(\d{4}).*$/, " $1").replace(/([a-z])([A-Z])/g, "$1 $2");
      const doc = searchReadwiseByTitle(searchHint, undefined, debug);

      if (!doc || !doc.document_id) {
        readwiseMissing++;
        readwiseGaps.push({ bibkey, title: bibkey, url: undefined });
        if (debug) process.stderr.write(`  [not found] ${bibkey}\n`);
        continue;
      }

      const markdown = exportReadwiseMarkdown(doc.document_id, debug);
      if (!markdown) {
        readwiseMissing++;
        readwiseGaps.push({ bibkey, title: bibkey });
        continue;
      }

      const header = [
        "---",
        `bibkey: ${bibkey}`,
        `title: "${(doc.title ?? "Untitled").replace(/"/g, '\\"')}"`,
        `author: "${(doc.author ?? "").replace(/"/g, '\\"')}"`,
        `source: readwise`,
        `readwise_id: "${doc.document_id}"`,
        `category: ${doc.category ?? "unknown"}`,
        "---",
        "",
      ].join("\n");

      writeFileSync(destPath, header + markdown, "utf-8");
      readwiseFound++;

      // Generate a bib entry for this new source
      const yearMatch = bibkey.match(/(\d{4})/);
      const bibEntry = generateBibEntry(bibkey, {
        title: doc.title ?? "Untitled",
        author: doc.author,
        year: yearMatch?.[1],
        filePath: fileName,
      });
      newBibEntries.push(bibEntry);
      process.stderr.write(`  [exported+bib] ${bibkey}: "${(doc.title ?? "").slice(0, 50)}" (${doc.category})\n`);
    }
  }

  process.stderr.write(
    `[materialize] Readwise: ${readwiseFound} exported, ${readwiseMissing} not found\n`,
  );

  // 6. Update bib files
  // 6a. Add file fields to existing bib entries that got Readwise exports
  //     Also update .md → .pdf for entries where a PDF was copied (Fix 1).
  const hasBibUpdates = bibFileUpdates.length > 0 || bibPdfOverrides.length > 0;
  if (hasBibUpdates && bibPaths.length > 0) {
    // Update the last bib file (project-local sources.bib)
    const bibToUpdate = bibPaths[bibPaths.length - 1];
    let bibContent = readFileSync(bibToUpdate, "utf-8");
    let updated = 0;
    for (const { bibkey, fileName } of bibFileUpdates) {
      // Only add file field if entry exists but has no file field
      const entryPattern = new RegExp(`(@\\w+\\{${bibkey},)`, "m");
      if (entryPattern.test(bibContent) && !new RegExp(`@\\w+\\{${bibkey},[^}]*file\\s*=`, "s").test(bibContent)) {
        bibContent = bibContent.replace(
          entryPattern,
          `$1\n  file = {${fileName}},`,
        );
        updated++;
      }
    }
    // Update .md → .pdf for entries where a Paperpile PDF was copied
    for (const { bibkey } of bibPdfOverrides) {
      const fileFieldPattern = new RegExp(
        `(file\\s*=\\s*\\{)${bibkey}\\.md(\\})`,
      );
      if (fileFieldPattern.test(bibContent)) {
        bibContent = bibContent.replace(fileFieldPattern, `$1${bibkey}.pdf$2`);
        updated++;
        if (debug) process.stderr.write(`[materialize] updated ${bibkey}: file .md → .pdf\n`);
      }
    }
    if (updated > 0) {
      writeFileSync(bibToUpdate, bibContent, "utf-8");
      process.stderr.write(`[materialize] updated ${updated} bib entries in ${bibToUpdate}\n`);
    }
  }

  // 6b. Append new bib entries for sources not in any bib
  if (newBibEntries.length > 0 && bibPaths.length > 0) {
    const bibToAppend = bibPaths[bibPaths.length - 1];
    const bibAppend = "\n" + newBibEntries.join("\n\n") + "\n";
    const existingContent = existsSync(bibToAppend) ? readFileSync(bibToAppend, "utf-8") : "";
    writeFileSync(bibToAppend, existingContent + bibAppend, "utf-8");
    process.stderr.write(`[materialize] appended ${newBibEntries.length} new bib entries to ${bibToAppend}\n`);
  }

  // 7. Summary
  process.stderr.write("\n=== Source Materialization Summary ===\n");
  process.stderr.write(`Target: ${refsDir}\n`);
  process.stderr.write(`Paperpile PDFs: ${paperpileCopied} copied, ${paperpileMissing} missing\n`);
  process.stderr.write(`Readwise articles: ${readwiseFound} exported, ${readwiseMissing} not found\n`);
  if (newBibEntries.length > 0) {
    process.stderr.write(`New bib entries: ${newBibEntries.length}\n`);
  }
  if (bibFileUpdates.length > 0) {
    process.stderr.write(`Bib file fields added: ${bibFileUpdates.length}\n`);
  }

  const totalMissing = paperpileMissing + readwiseMissing;
  const totalFound = paperpileCopied + readwiseFound;
  process.stderr.write(`\nTotal: ${totalFound}/${targetBibkeys.length} materialized`);
  if (totalMissing > 0) {
    process.stderr.write(` (${totalMissing} gaps)\n`);
  } else {
    process.stderr.write(` — all sources available\n`);
  }

  // 8. Print gaps for manual action
  if (readwiseGaps.length > 0) {
    process.stderr.write("\n=== Gaps (need Obsidian web clipper or manual sourcing) ===\n");
    for (const g of readwiseGaps) {
      const urlNote = g.url ? ` → ${g.url}` : "";
      process.stderr.write(`  ${g.bibkey}: "${g.title}"${urlNote}\n`);
    }
  }

  return totalMissing > 0 ? 1 : 0;
}

main().then((code) => process.exit(code));
