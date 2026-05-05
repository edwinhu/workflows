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
 * Search Readwise Reader for a document by title (exact match).
 * Used when matching known bib entries to Readwise documents.
 * Falls back to semantic search if title search returns nothing.
 */
function searchReadwiseByTitle(title: string, author?: string, debug?: boolean): ReadwiseDoc | null {
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
  return results ? results[0] : null;
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

  // Save-URLs mode: save URLs to Readwise Reader, then export to references/
  // Usage: materialize-sources --save-urls <file> --refs <dir> [--tag <tag>] [--debug]
  // File format: one URL per line, optionally "URL | Title | Author"
  const saveUrlsFile = flags["save-urls"];
  if (typeof saveUrlsFile === "string") {
    const refsDir = expandPath(typeof flags.refs === "string" ? flags.refs : "./references");
    const tag = typeof flags.tag === "string" ? flags.tag : undefined;
    const debug = !!flags.debug;

    if (!existsSync(refsDir)) mkdirSync(refsDir, { recursive: true });

    const lines = readFileSync(expandPath(saveUrlsFile), "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    process.stderr.write(`[save-urls] processing ${lines.length} URLs → Readwise → ${refsDir}\n`);

    let saved = 0;
    let exported = 0;
    let failed = 0;

    for (const line of lines) {
      // Parse "URL | Title | Author" or just "URL"
      const parts = line.split("|").map((p) => p.trim());
      const url = parts[0];
      const title = parts[1] || undefined;
      const author = parts[2] || undefined;

      if (!url.startsWith("http")) {
        process.stderr.write(`  [skip] not a URL: ${url.slice(0, 60)}\n`);
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
      if (existing.status === 0 && existing.stdout) {
        try {
          const docs = JSON.parse(existing.stdout);
          if (docs.length > 0) {
            docId = docs[0].document_id;
            if (debug) process.stderr.write(`  [exists] ${title ?? url.slice(0, 50)} already in Readwise\n`);
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
          // Wait a moment for Readwise to scrape the page
          Bun.sleepSync(2000);
        } else {
          failed++;
          process.stderr.write(`  [failed] ${title ?? url.slice(0, 50)}\n`);
          continue;
        }
      }

      // Export markdown to references/
      const safeName = (title ?? url)
        .replace(/[{}\\\/:"*?<>|]/g, "_")
        .replace(/\s+/g, "_")
        .slice(0, 80);
      const destPath = join(refsDir, `${safeName}.md`);

      if (existsSync(destPath) && statSync(destPath).size > 100) {
        if (debug) process.stderr.write(`  [cached] ${safeName}.md\n`);
        exported++;
        continue;
      }

      const markdown = exportReadwiseMarkdown(docId, debug);
      if (markdown && markdown.length > 50) {
        const header = [
          "---",
          `title: "${(title ?? safeName).replace(/"/g, '\\"')}"`,
          `author: "${(author ?? "").replace(/"/g, '\\"')}"`,
          `url: "${url}"`,
          `source: readwise`,
          `readwise_id: "${docId}"`,
          "---",
          "",
        ].join("\n");
        writeFileSync(destPath, header + markdown, "utf-8");
        exported++;
        process.stderr.write(`  [exported] ${safeName}.md (${(markdown.length / 1024).toFixed(0)}KB)\n`);
      } else {
        process.stderr.write(`  [no content] ${safeName} — Readwise may still be scraping\n`);
      }
    }

    process.stderr.write(
      `\n[save-urls] ${saved} saved to Readwise, ${exported} exported to references/, ${failed} failed\n`,
    );
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
    for (const { bibkey } of withFile) {
      const localPath = localPaths.get(bibkey);
      if (!localPath || !existsSync(localPath)) {
        paperpileMissing++;
        if (debug) process.stderr.write(`  [missing] ${bibkey}\n`);
        continue;
      }

      const destPath = join(refsDir, `${bibkey}.pdf`);
      if (existsSync(destPath) && statSync(destPath).size > 0) {
        if (debug) process.stderr.write(`  [cached] ${bibkey}\n`);
        paperpileCopied++;
        continue;
      }

      try {
        const content = readFileSync(localPath);
        writeFileSync(destPath, content);
        paperpileCopied++;
        if (debug) process.stderr.write(`  [copied] ${bibkey} → ${basename(destPath)}\n`);
      } catch (err) {
        paperpileMissing++;
        if (debug) process.stderr.write(`  [error] ${bibkey}: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }

    process.stderr.write(
      `[materialize] Paperpile: ${paperpileCopied} copied, ${paperpileMissing} missing\n`,
    );
  }

  // 5. Readwise: search by title, export markdown
  let readwiseFound = 0;
  let readwiseMissing = 0;
  const readwiseGaps: Array<{ bibkey: string; title: string; url?: string }> = [];

  if (withoutFile.length > 0) {
    process.stderr.write(`[materialize] searching Readwise for ${withoutFile.length} non-PDF sources...\n`);

    for (const { bibkey, entry } of withoutFile) {
      const destPath = join(refsDir, `${bibkey}.md`);

      // Skip if already materialized
      if (existsSync(destPath) && statSync(destPath).size > 0) {
        if (debug) process.stderr.write(`  [cached] ${bibkey}\n`);
        readwiseFound++;
        continue;
      }

      const title = entry.title ?? bibkey;
      const doc = searchReadwiseByTitle(title, debug);

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
      process.stderr.write(`  [exported] ${bibkey}: "${title.slice(0, 50)}" (${doc.category})\n`);
    }

    process.stderr.write(
      `[materialize] Readwise: ${readwiseFound} exported, ${readwiseMissing} not found\n`,
    );
  }

  // 6. Summary
  process.stderr.write("\n=== Source Materialization Summary ===\n");
  process.stderr.write(`Target: ${refsDir}\n`);
  process.stderr.write(`Paperpile PDFs: ${paperpileCopied} copied, ${paperpileMissing} missing\n`);
  process.stderr.write(`Readwise articles: ${readwiseFound} exported, ${readwiseMissing} not found\n`);
  if (notInBib.length > 0) {
    process.stderr.write(`Not in any bib: ${notInBib.length} (${notInBib.slice(0, 5).join(", ")}${notInBib.length > 5 ? "..." : ""})\n`);
  }

  const totalMissing = paperpileMissing + readwiseMissing + notInBib.length;
  const totalFound = paperpileCopied + readwiseFound;
  process.stderr.write(`\nTotal: ${totalFound}/${targetBibkeys.length} materialized`);
  if (totalMissing > 0) {
    process.stderr.write(` (${totalMissing} gaps)\n`);
  } else {
    process.stderr.write(` — all sources available\n`);
  }

  // 7. Print gaps for manual action
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
