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

  // Discovery mode: semantic search Readwise highlights for themes (lit review)
  const discoverQuery = flags.discover;
  if (typeof discoverQuery === "string") {
    process.stderr.write(`[discover] searching Readwise highlights for: "${discoverQuery}"\n`);
    const highlights = searchReadwiseHighlights(discoverQuery, true, 30);
    if (!highlights || highlights.length === 0) {
      process.stderr.write(`[discover] no highlights found\n`);
      return 0;
    }

    // Group highlights by document
    const byDoc = new Map<string, { title: string; author: string; category: string; highlights: string[] }>();
    for (const h of highlights) {
      const key = h.attributes.document_title;
      let group = byDoc.get(key);
      if (!group) {
        group = {
          title: h.attributes.document_title,
          author: h.attributes.document_author,
          category: h.attributes.document_category,
          highlights: [],
        };
        byDoc.set(key, group);
      }
      if (h.attributes.highlight_plaintext) {
        group.highlights.push(h.attributes.highlight_plaintext.slice(0, 200));
      }
    }

    process.stderr.write(`[discover] ${highlights.length} highlights across ${byDoc.size} documents:\n\n`);
    for (const [, doc] of byDoc) {
      const author = doc.author ? ` by ${doc.author}` : "";
      console.log(`## ${doc.title}${author} [${doc.category}]`);
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

  if (bibPaths.length === 0) {
    console.error("Usage: materialize-sources --bib <path> [--bib <path2>] --refs <dir> [--drafts <dir>] [--debug]\n       materialize-sources --discover \"<semantic query>\"");
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
