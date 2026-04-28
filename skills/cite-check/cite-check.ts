#!/usr/bin/env bun
/**
 * cite-check -- scan markdown drafts for pandoc citations, query Gemini File
 * Search to verify each cite is grounded in the cited source, and write a
 * structured REVIEW-CITES.md report.
 *
 * Pipeline:
 *   1. Walk drafts dir -> read .md files -> extractCitations.
 *   2. Set up Gemini store and upload PDFs (or use existing store).
 *   3. For cites whose bibkey IS in the store, build a verify-prompt and
 *      query Gemini with structured output. Tag SUPPORTED / PARTIAL / UNSUPPORTED.
 *   4. For cites whose bibkey is NOT in the store, tag NOT_IN_STORE
 *      (no query).
 *   5. Write a markdown report and print a one-line summary to stdout.
 *
 * Usage:
 *   bun cite-check.ts --bib <path> [--bib <path2>] [--store <id>]
 *                     [--drafts <dir>] [--out <path>] [--limit N]
 *                     [--dry-run] [--batch] [--debug]
 *
 * Multiple --bib flags are supported. Entries from earlier files take
 * priority when bibkeys collide (e.g., Paperpile first, project-local second).
 *
 * Extracted from librarian-cli on 2026-04-24. The pieces are self-contained:
 * cite-extract.ts (pure function) + gemini.ts (Gemini API wrapper) +
 * cite-check.ts (CLI). No project-internal imports.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
  createStore,
  listDocuments,
  uploadFromBib,
  parseBibFile,
  queryCitation,
  searchReadwise,
  submitBatchCiteCheck,
  type Status,
  type StoreConfig,
  type BibEntry,
  type BatchRequest,
} from "./gemini.js";
import { extractCitations, type Citation } from "./cite-extract.js";

// ---------------------------------------------------------------------------
// Helpers (formerly imported from librarian-cli internals).
// ---------------------------------------------------------------------------

function expandPath(p: string): string {
  if (p.startsWith("~")) return p.replace(/^~/, homedir());
  return isAbsolute(p) ? p : resolve(p);
}

function printError(msg: string): void {
  console.error(`error: ${msg}`);
}

// Minimal argv flag parser (lifted from librarian-cli/src/main.ts).
function parseFlags(argv: string[]): {
  args: string[];
  flags: Record<string, string | boolean>;
} {
  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};

  let i = 0;
  while (i < argv.length) {
    const a = argv[i];

    if (a === "--") {
      args.push(...argv.slice(i + 1));
      break;
    }

    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
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

// ---------------------------------------------------------------------------
// Cite-check core.
// ---------------------------------------------------------------------------

export interface CiteCheckFlags {
  drafts?: string | boolean;
  store?: string | boolean;
  out?: string | boolean;
  "dry-run"?: string | boolean;
  limit?: string | boolean;
  debug?: string | boolean;
  batch?: string | boolean;
  audit?: string | boolean;
}

interface CiteResult {
  cite: Citation;
  status: Status;
  response: string;
}

const STATUS_GLYPH: Record<Status, string> = {
  SUPPORTED: "\u2713 SUPPORTED",
  PARTIAL: "\u26A0 PARTIAL",
  UNSUPPORTED: "\u2717 UNSUPPORTED",
  NOT_IN_STORE: "\u2298 NOT IN STORE",
  ERROR: "\uD83D\uDCA5 ERROR",
};

function readMarkdownFiles(draftsDir: string): { path: string; text: string }[] {
  const entries = readdirSync(draftsDir, { withFileTypes: true });
  const out: { path: string; text: string }[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.toLowerCase().endsWith(".md")) continue;
    const p = join(draftsDir, e.name);
    out.push({ path: p, text: readFileSync(p, "utf-8") });
  }
  return out;
}

/**
 * Build a verification prompt for one or more citations sharing the same claim.
 * When bibkeys.length > 1, the prompt asks Gemini to evaluate the claim against
 * all sources together (compound-cite mode).
 */
function buildGroupPrompt(cites: Citation[]): string {
  const lines: string[] = [];
  const bibkeys = cites.map((c) => c.bibkey);
  const claim = cites[0].claim;
  const signal = cites[0].signal;

  if (bibkeys.length === 1) {
    // Single-source prompt (original behavior).
    if (signal) {
      lines.push(
        `Does the cited source titled '${bibkeys[0]}' generally support or relate to this proposition: ${claim}?`,
      );
      lines.push(
        "Conceptual alignment is sufficient -- the source need not contain the exact words.",
      );
    } else {
      lines.push(
        `Does the source titled '${bibkeys[0]}' support this claim: ${claim}?`,
      );
    }
  } else {
    // Compound-cite prompt: multiple sources should together cover the claim.
    const nameList = bibkeys.map((k) => `'${k}'`).join(" and ");
    if (signal) {
      lines.push(
        `Do the cited sources ${nameList}, taken together, generally support or relate to this proposition: ${claim}?`,
      );
      lines.push(
        "Each source may cover a different part of the claim. Conceptual alignment is sufficient.",
      );
    } else {
      lines.push(
        `Do the sources ${nameList}, taken together, support this claim: ${claim}?`,
      );
      lines.push(
        "Each source may cover a different part of the claim -- that is expected for a compound citation.",
      );
    }
  }

  // Shared context (same across the group since they share the same claim).
  const c = cites[0];
  if (c.bodyContext) {
    lines.push(`Body context: ${c.bodyContext}`);
  }
  if (c.footnoteContext) {
    lines.push(`Footnote context: ${c.footnoteContext}`);
  }
  // Include locators from all cites in the group.
  const locators = cites
    .filter((ci) => ci.locator)
    .map((ci) => `${ci.bibkey}: ${ci.locator}`);
  if (locators.length === 1) {
    lines.push(`Focus on ${locators[0]} if specified.`);
  } else if (locators.length > 1) {
    lines.push(`Locators: ${locators.join("; ")}.`);
  }

  if (signal) {
    lines.push(
      "Quote the closest supporting passage from each source if any; respond UNSUPPORTED only if completely unrelated.",
    );
  } else {
    lines.push(
      "Quote the supporting passage from each source if yes; respond UNSUPPORTED if no.",
    );
  }
  return lines.join(" ").trim();
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "...";
}

function escapeCell(s: string): string {
  // Pipes break markdown tables; replace with U+2758. Newlines become spaces.
  return s.replace(/\|/g, "\u2758").replace(/\s+/g, " ").trim();
}

function relPath(absPath: string, draftsDir: string): string {
  if (absPath.startsWith(draftsDir + "/")) {
    const tail = absPath.slice(draftsDir.length + 1);
    return `drafts/${tail}`;
  }
  return absPath;
}

function renderReport(
  results: CiteResult[],
  meta: {
    storeName: string;
    fileCount: number;
    citationCount: number;
    draftsDir: string;
  },
): string {
  const counts: Record<Status, number> = {
    SUPPORTED: 0,
    PARTIAL: 0,
    UNSUPPORTED: 0,
    NOT_IN_STORE: 0,
    ERROR: 0,
  };
  for (const r of results) counts[r.status]++;

  // Sort by file then line.
  const sorted = [...results].sort((a, b) => {
    if (a.cite.file !== b.cite.file) {
      return a.cite.file.localeCompare(b.cite.file);
    }
    return a.cite.line - b.cite.line;
  });

  const lines: string[] = [];
  lines.push("# Citation Review");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(
    `Drafts scanned: ${meta.fileCount} files, ${meta.citationCount} citations`,
  );
  lines.push(`Gemini store: ${meta.storeName}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- \u2713 Supported: ${counts.SUPPORTED}`);
  lines.push(`- \u26A0 Partial: ${counts.PARTIAL}`);
  lines.push(`- \u2717 Unsupported: ${counts.UNSUPPORTED}`);
  lines.push(`- \u2298 Not in store: ${counts.NOT_IN_STORE}`);
  lines.push(`- \uD83D\uDCA5 Error: ${counts.ERROR}`);
  lines.push("");
  lines.push("## Details");
  lines.push("");
  lines.push("| Status | File:Line | Bibkey | Claim | Response |");
  lines.push("|--------|-----------|--------|-------|----------|");
  for (const r of sorted) {
    const fileLine = `${relPath(r.cite.file, meta.draftsDir)}:${r.cite.line}`;
    const fnTag = r.cite.footnoteContext ? " (see fn)" : "";
    const signalTag = r.cite.signal ? `[${r.cite.signal}] ` : "";
    const claim = signalTag + truncate(r.cite.claim, 100) + fnTag;
    const resp = truncate(r.response, 200);
    lines.push(
      `| ${STATUS_GLYPH[r.status]} | ${escapeCell(fileLine)} | ${escapeCell(
        r.cite.bibkey,
      )} | ${escapeCell(claim)} | ${escapeCell(resp)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export async function cmdCiteCheck(
  args: string[],
  flags: CiteCheckFlags,
  bibPaths?: string[],
): Promise<number> {
  // No positional args.
  void args;

  // Collect --bib paths: prefer explicit parameter, fall back to scanning argv.
  const resolvedBibPaths: string[] = bibPaths
    ? bibPaths.map(expandPath)
    : (() => {
        const raw = Bun.argv.slice(2);
        const paths: string[] = [];
        for (let i = 0; i < raw.length; i++) {
          if (raw[i] === "--bib" && i + 1 < raw.length) {
            paths.push(expandPath(raw[i + 1]));
            i++; // skip value
          }
        }
        return paths;
      })();

  const storeId =
    typeof flags.store === "string" ? flags.store : undefined;

  if (resolvedBibPaths.length === 0 && !storeId) {
    printError(
      "Usage: cite-check --bib <path> [--bib <path2>] [--store <id>] [--drafts <dir>] [--out <path>] [--dry-run] [--batch] [--audit] [--limit <n>] [--debug]",
    );
    return 1;
  }

  const draftsDir = expandPath(
    typeof flags.drafts === "string" ? flags.drafts : "./drafts",
  );
  const outPath = expandPath(
    typeof flags.out === "string"
      ? flags.out
      : join(draftsDir, "REVIEW-CITES.md"),
  );
  const dryRun = !!flags["dry-run"];
  const debug = !!flags.debug;
  const limit = (() => {
    const v = flags.limit;
    if (typeof v === "string") {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    }
    return undefined;
  })();

  // 1. Read drafts and extract citations.
  let files: { path: string; text: string }[];
  try {
    files = readMarkdownFiles(draftsDir);
  } catch (err) {
    printError(
      `failed to read drafts dir ${draftsDir}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 1;
  }
  if (files.length === 0) {
    printError(`no .md files found in ${draftsDir}`);
    return 1;
  }

  const allCites: Citation[] = [];
  for (const f of files) {
    allCites.push(...extractCitations(f.text, f.path));
  }
  process.stderr.write(
    `[cite-check] scanned ${files.length} files, found ${allCites.length} citations\n`,
  );

  // Apply --limit if set.
  const cites = limit !== undefined ? allCites.slice(0, limit) : allCites;
  if (limit !== undefined) {
    process.stderr.write(
      `[cite-check] --limit=${limit}: checking first ${cites.length} citations\n`,
    );
  }

  // Parse bib files for PDF mappings (merge all; first bib wins for duplicate keys).
  const bibMap = new Map<string, BibEntry>();
  for (const bp of resolvedBibPaths) {
    try {
      const entries = parseBibFile(bp);
      // Merge -- first bib wins for duplicate keys (e.g., Paperpile takes priority).
      for (const [key, entry] of entries) {
        if (!bibMap.has(key)) {
          bibMap.set(key, entry);
        }
      }
      process.stderr.write(
        `[cite-check] parsed ${entries.size} entries from ${bp}\n`,
      );
    } catch (err) {
      printError(
        `failed to parse bib file ${bp}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 1;
    }
  }
  if (resolvedBibPaths.length > 0) {
    const withFile = [...bibMap.values()].filter((e) => e.filePath).length;
    process.stderr.write(
      `[cite-check] ${bibMap.size} total bib entries (${withFile} with PDFs) across ${resolvedBibPaths.length} file(s)\n`,
    );
  }

  // -- Audit mode: check source availability and exit (no Gemini queries).
  const auditMode = !!flags.audit;

  if (auditMode) {
    const citedBibkeys = [...new Set(cites.map((c) => c.bibkey))];

    const hasPdf: string[] = [];
    const hasReadwise: Array<{ bibkey: string; matchedTitle: string }> = [];
    const missingPaperpile: Array<{ bibkey: string; title: string }> = [];
    const missingReadwise: Array<{
      bibkey: string;
      title: string;
      bibType: string;
    }> = [];
    const noInfo: string[] = [];

    // Bib entry types that belong in Paperpile (academic sources)
    const paperpileTypes = new Set([
      "article",
      "unpublished",
      "techreport",
      "inproceedings",
      "phdthesis",
      "mastersthesis",
    ]);

    for (const bibkey of citedBibkeys) {
      const entry = bibMap.get(bibkey);

      if (!entry) {
        noInfo.push(bibkey);
        continue;
      }

      // Check if PDF exists on disk
      if (entry.filePath) {
        try {
          statSync(entry.filePath);
          hasPdf.push(bibkey);
          continue;
        } catch {
          // file field exists but file missing on disk -- fall through
        }
      }

      // Check Readwise
      if (entry.title) {
        const matchedTitle = await searchReadwise(entry.title, { debug });
        if (matchedTitle) {
          hasReadwise.push({ bibkey, matchedTitle });
          continue;
        }
      }

      // Missing -- classify where it should go
      const title = entry.title ?? "(no title)";

      // Determine bib entry type from source bib files
      let bibType = "unknown";
      for (const bp of resolvedBibPaths) {
        try {
          const content = readFileSync(bp, "utf-8");
          const typeMatch = content.match(
            new RegExp(
              `@(\\w+)\\{${bibkey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},`,
            ),
          );
          if (typeMatch) {
            bibType = typeMatch[1].toLowerCase();
            break;
          }
        } catch {
          /* skip */
        }
      }

      if (paperpileTypes.has(bibType)) {
        missingPaperpile.push({ bibkey, title });
      } else {
        missingReadwise.push({ bibkey, title, bibType });
      }
    }

    // Print audit report
    process.stderr.write(`\n=== Source Audit ===\n`);
    process.stderr.write(
      `${citedBibkeys.length} unique bibkeys cited in ${files.length} draft files\n\n`,
    );

    process.stderr.write(`PDF on disk: ${hasPdf.length}\n`);
    process.stderr.write(`Readwise found: ${hasReadwise.length}\n`);

    if (missingPaperpile.length > 0) {
      process.stderr.write(
        `\nMissing -- add to Paperpile (${missingPaperpile.length}):\n`,
      );
      for (const m of missingPaperpile) {
        process.stderr.write(`  ${m.bibkey.padEnd(40)} "${m.title}"\n`);
      }
    }

    if (missingReadwise.length > 0) {
      process.stderr.write(
        `\nMissing -- add to Readwise (${missingReadwise.length}):\n`,
      );
      for (const m of missingReadwise) {
        process.stderr.write(
          `  ${m.bibkey.padEnd(40)} "${m.title}" [${m.bibType}]\n`,
        );
      }
    }

    if (noInfo.length > 0) {
      process.stderr.write(
        `\nNot in any bib file (${noInfo.length}):\n`,
      );
      for (const k of noInfo) {
        process.stderr.write(`  ${k}\n`);
      }
    }

    const total = hasPdf.length + hasReadwise.length;
    const missing =
      missingPaperpile.length + missingReadwise.length + noInfo.length;
    process.stderr.write(
      `\nCoverage: ${total}/${citedBibkeys.length} (${missing} missing)\n`,
    );

    return missing > 0 ? 1 : 0;
  }

  // 2. Set up Gemini store and upload PDFs for cited bibkeys.
  let storeName: string;
  let sourceBibkeys = new Set<string>();

  if (!dryRun) {
    try {
      if (storeId) {
        storeName = `fileSearchStores/${storeId}`;
        process.stderr.write(
          `[cite-check] using existing store ${storeName}\n`,
        );
      } else {
        // Auto-create store named after first bib file
        const bibName = resolvedBibPaths.length > 0
          ? (resolvedBibPaths[0].split("/").pop()?.replace(/\.bib$/, "") ?? "cite-check")
          : "cite-check";
        const config: StoreConfig = await createStore(
          `cite-check-${bibName}`,
        );
        storeName = config.storeName;
        process.stderr.write(`[cite-check] created store ${storeName}\n`);
      }

      // Upload PDFs for cited bibkeys only (with Readwise fallback)
      if (resolvedBibPaths.length > 0 && bibMap.size > 0) {
        const citedBibkeys = [...new Set(cites.map((c) => c.bibkey))];
        process.stderr.write(
          `[cite-check] uploading PDFs for ${citedBibkeys.length} cited bibkeys...\n`,
        );
        const { uploaded, skipped, missing, fromReadwise } = await uploadFromBib(
          storeName,
          bibMap,
          citedBibkeys,
          { debug, readwiseFallback: true },
        );
        process.stderr.write(
          `[cite-check] uploaded ${uploaded} PDFs + ${fromReadwise} from Readwise, skipped ${skipped} (already indexed), ${missing} missing\n`,
        );
      }

      // List documents to build bibkey set
      const docs = await listDocuments(storeName);
      sourceBibkeys = new Set(docs.map((d) => d.displayName));
      process.stderr.write(
        `[cite-check] store has ${docs.length} documents\n`,
      );
    } catch (err) {
      printError(
        `Gemini store setup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 1;
    }
  } else {
    // In dry-run mode, storeName is only used for display.
    storeName = storeId ? `fileSearchStores/${storeId}` : "(dry-run)";
  }

  // 2b. Group citations that share the same (file, line, claim) -- these are
  //     compound cites from multi-cite brackets like [@a; @b]. Each group is
  //     queried as a unit so Gemini can see all sources.
  interface CiteGroup {
    cites: Citation[];
    key: string;
  }
  const groupMap = new Map<string, CiteGroup>();
  for (const c of cites) {
    const key = `${c.file}:${c.line}:${c.claim}`;
    let g = groupMap.get(key);
    if (!g) {
      g = { cites: [], key };
      groupMap.set(key, g);
    }
    g.cites.push(c);
  }
  const groups = [...groupMap.values()];
  const compoundCount = groups.filter((g) => g.cites.length > 1).length;
  if (compoundCount > 0) {
    process.stderr.write(
      `[cite-check] ${compoundCount} compound-cite groups detected (will query jointly)\n`,
    );
  }

  // 3. Iterate cite groups, classify each.
  const results: CiteResult[] = [];
  const batchMode = !!flags.batch;

  if (dryRun) {
    process.stderr.write(
      `[cite-check] dry-run: would query Gemini for ${groups.length} groups (${cites.length} citations)\n`,
    );
    for (const g of groups) {
      const prompt = buildGroupPrompt(g.cites);
      const bibkeys = g.cites.map((c) => c.bibkey).join("+");
      const c0 = g.cites[0];
      console.log(
        `--- ${bibkeys} @ ${relPath(c0.file, draftsDir)}:${c0.line} ---\n${prompt}\n`,
      );
    }
    return 0;
  } else if (batchMode) {
    // BATCH MODE: Submit all queries as a single Gemini Batch API job
    const batchRequests: BatchRequest[] = [];

    for (const g of groups) {
      const inStore = g.cites.filter((c) => sourceBibkeys.has(c.bibkey));
      const notInStore = g.cites.filter((c) => !sourceBibkeys.has(c.bibkey));

      for (const c of notInStore) {
        results.push({
          cite: c,
          status: "NOT_IN_STORE",
          response: `Bibkey \`${c.bibkey}\` not in Gemini store.`,
        });
      }

      if (inStore.length === 0) continue;

      const bibkeys = inStore.map((c) => c.bibkey);
      const metadataFilter =
        bibkeys.length > 1
          ? bibkeys.map((k) => `bibkey="${k}"`).join(" OR ")
          : undefined;

      const prompt = buildGroupPrompt(inStore);
      batchRequests.push({ key: g.key, prompt, metadataFilter });
    }

    if (batchRequests.length > 0) {
      process.stderr.write(
        `[cite-check] batch mode: submitting ${batchRequests.length} queries...\n`,
      );

      const batchResults = await submitBatchCiteCheck(storeName, batchRequests, { debug });

      // Map results back to cite groups by key
      const resultByKey = new Map(batchResults.map((r) => [r.key, r]));

      for (const g of groups) {
        const inStore = g.cites.filter((c) => sourceBibkeys.has(c.bibkey));
        if (inStore.length === 0) continue;

        const batchResult = resultByKey.get(g.key);
        if (!batchResult) {
          for (const c of inStore) {
            results.push({ cite: c, status: "ERROR", response: "No batch result returned" });
          }
          continue;
        }

        const cls = batchResult.classification;
        const snippet = cls.supporting_passage
          ? `"${cls.supporting_passage.slice(0, 280)}"`
          : cls.explanation.slice(0, 300);

        for (const c of inStore) {
          results.push({ cite: c, status: cls.status, response: snippet });
        }
      }
    }
  } else {
    // SEQUENTIAL MODE: query Gemini one group at a time
    let queryIdx = 0;
    for (const g of groups) {
      const c0 = g.cites[0];

      // 3a. Partition: which bibkeys are in the store vs not?
      const inStore = g.cites.filter((c) => sourceBibkeys.has(c.bibkey));
      const notInStore = g.cites.filter((c) => !sourceBibkeys.has(c.bibkey));

      // Tag NOT_IN_STORE cites immediately.
      for (const c of notInStore) {
        results.push({
          cite: c,
          status: "NOT_IN_STORE",
          response: `Bibkey \`${c.bibkey}\` not in Gemini store.`,
        });
      }

      // If no cites in the store, nothing to query.
      if (inStore.length === 0) continue;

      queryIdx++;

      // Build metadata filter for compound cites.
      const bibkeys = inStore.map((c) => c.bibkey);
      const metadataFilter =
        bibkeys.length > 1
          ? bibkeys.map((k) => `bibkey="${k}"`).join(" OR ")
          : undefined; // single-source: search full store

      const prompt = buildGroupPrompt(inStore);
      const label = inStore.map((c) => c.bibkey).join("+");
      process.stderr.write(
        `[cite-check] ${queryIdx}/${groups.length} ${label} @ ${relPath(
          c0.file,
          draftsDir,
        )}:${c0.line} ...`,
      );

      try {
        const geminiResult = await queryCitation(storeName, prompt, {
          metadataFilter,
          debug,
        });

        const cls = geminiResult.classification;
        const snippet = cls.supporting_passage
          ? `"${cls.supporting_passage.slice(0, 280)}"`
          : cls.explanation.slice(0, 300);

        process.stderr.write(` ${cls.status} (${geminiResult.durationMs}ms)\n`);
        // All cites in the group share the joint verdict and response.
        for (const c of inStore) {
          results.push({ cite: c, status: cls.status, response: snippet });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(` error\n`);
        for (const c of inStore) {
          results.push({
            cite: c,
            status: "ERROR",
            response: `Gemini error: ${msg}`,
          });
        }
        continue;
      }
    }
  }

  // 4. Write the report.
  const report = renderReport(results, {
    storeName,
    fileCount: files.length,
    citationCount: allCites.length,
    draftsDir,
  });

  try {
    writeFileSync(outPath, report, "utf-8");
  } catch (err) {
    printError(
      `failed to write report ${outPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 1;
  }

  // 5. Summary line.
  const counts: Record<Status, number> = {
    SUPPORTED: 0,
    PARTIAL: 0,
    UNSUPPORTED: 0,
    NOT_IN_STORE: 0,
    ERROR: 0,
  };
  for (const r of results) counts[r.status]++;
  process.stderr.write(
    `[cite-check] ${results.length} cites checked: \u2713${counts.SUPPORTED} \u26A0${counts.PARTIAL} \u2717${counts.UNSUPPORTED} \uD83D\uDCA5${counts.ERROR} \u2298${counts.NOT_IN_STORE} \u2192 wrote ${outPath}\n`,
  );
  console.log(outPath);
  return 0;
}

// ---------------------------------------------------------------------------
// Standalone entrypoint.
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const rawArgs = Bun.argv.slice(2);
  const { args, flags } = parseFlags(rawArgs);
  cmdCiteCheck(args, flags as CiteCheckFlags).then((code) =>
    process.exit(code),
  );
}
