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

/**
 * Search Readwise Reader for a document by title.
 * Returns the best match or null.
 */
function searchReadwise(title: string, debug?: boolean): ReadwiseDoc | null {
  // Truncate very long titles for search
  const query = title.slice(0, 100);
  const result = spawnSync("readwise", [
    "reader-search-documents",
    "--query", query,
    "--json",
  ], { encoding: "utf-8", timeout: 30_000 });

  if (result.status !== 0 || !result.stdout) {
    if (debug) {
      process.stderr.write(`[readwise] search failed for "${query.slice(0, 40)}": ${result.stderr?.slice(0, 100) ?? "no output"}\n`);
    }
    return null;
  }

  try {
    const docs: ReadwiseDoc[] = JSON.parse(result.stdout);
    if (!docs.length) return null;
    // Return first result — readwise search is ranked by relevance
    return docs[0];
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

  if (bibPaths.length === 0) {
    console.error("Usage: materialize-sources --bib <path> [--bib <path2>] --refs <dir> [--drafts <dir>] [--debug]");
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
      const doc = searchReadwise(title, debug);

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
