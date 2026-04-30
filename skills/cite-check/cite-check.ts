#!/usr/bin/env bun
/**
 * cite-check -- scan markdown drafts for pandoc citations, query Gemini with
 * inline file references to verify each cite is grounded in the cited source,
 * and write a structured REVIEW-CITES.md report.
 *
 * Pipeline:
 *   1. Walk drafts dir -> read .md files -> extractCitations.
 *   2. Upload cited PDFs via Files API (cached per session).
 *   3. For cites whose bibkey IS uploaded, build a verify-prompt and
 *      query Gemini with structured output. Tag SUPPORTED / PARTIAL / UNSUPPORTED.
 *   4. For cites whose bibkey is NOT uploaded, tag NOT_IN_STORE
 *      (no query).
 *   5. Write a markdown report and print a one-line summary to stdout.
 *
 * Usage:
 *   bun cite-check.ts --bib <path> [--bib <path2>]
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
import { isAbsolute, dirname, join, resolve } from "node:path";
import {
  uploadCitedFiles,
  parseBibFile,
  queryCitation,
  queryCitationsConcurrently,
  searchReadwise,
  resolveFileAcrossDirs,
  loadManifest,
  saveManifest,
  restoreFromManifest,
  updateManifest,
  verifyFileRef,
  type Status,
  type BibEntry,
  type BatchRequest,
  type FileRef,
  type Manifest,
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
  out?: string | boolean;
  "dry-run"?: string | boolean;
  limit?: string | boolean;
  debug?: string | boolean;
  batch?: string | boolean;
  audit?: string | boolean;
  "retry-model"?: string | boolean;
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

  // When the claim is a parenthetical (thematic description of the source),
  // add explicit guidance that this is a topic-level check, not a passage search.
  if (c.parenthetical) {
    lines.push(
      "The claim above is a parenthetical description of what the source is about.",
    );
    lines.push(
      "You only need to confirm the source is generally about this topic -- a matching abstract, introduction, or thesis statement is sufficient.",
    );
  }

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

  if (signal || c.parenthetical) {
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

  if (resolvedBibPaths.length === 0) {
    printError(
      "Usage: cite-check --bib <path> [--bib <path2>] [--drafts <dir>] [--out <path>] [--dry-run] [--batch] [--audit] [--retry-model <model>] [--limit <n>] [--debug]",
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
  const retryModel = typeof flags["retry-model"] === "string"
    ? flags["retry-model"]
    : "gemini-3.1-pro-preview";
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
    const bibDirsForAudit = resolvedBibPaths.map((p) => dirname(p));

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

      // Check if PDF exists on disk (with cross-directory resolution)
      if (entry.filePath || entry.fileRelPath) {
        const resolved = resolveFileAcrossDirs(entry, bibDirsForAudit, debug);
        if (resolved) {
          hasPdf.push(bibkey);
          continue;
        }
      }

      // Check Readwise (URL match first, title fallback)
      if (entry.title || entry.url) {
        const matchedTitle = await searchReadwise(entry.title ?? "", { debug, url: entry.url });
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
    const missingCount =
      missingPaperpile.length + missingReadwise.length + noInfo.length;
    process.stderr.write(
      `\nCoverage: ${total}/${citedBibkeys.length} (${missingCount} missing)\n`,
    );

    return missingCount > 0 ? 1 : 0;
  }

  // 2. Upload cited PDFs via Files API (with persistent manifest).
  const manifestPath = join(draftsDir, ".cite-check-store.json");
  const manifest = loadManifest(manifestPath);
  const fileCache = new Map<string, FileRef>();
  const bibDirs = resolvedBibPaths.map((p) => dirname(p));

  if (!dryRun) {
    try {
      // Upload PDFs for cited bibkeys
      if (bibMap.size > 0) {
        const citedBibkeys = [...new Set(cites.map((c) => c.bibkey))];

        // Restore valid entries from manifest (skip re-upload for files within 48h TTL)
        const restored = restoreFromManifest(manifest, fileCache, citedBibkeys);
        if (restored > 0) {
          process.stderr.write(
            `[cite-check] restored ${restored} files from manifest (within 48h TTL)\n`,
          );
        }

        const remaining = citedBibkeys.filter((k) => !fileCache.has(k));
        process.stderr.write(
          `[cite-check] uploading ${remaining.length} of ${citedBibkeys.length} cited sources (${restored} cached)...\n`,
        );
        const { uploaded, skipped, missing, fromReadwise } = await uploadCitedFiles(
          bibMap,
          remaining,
          fileCache,
          { debug, readwiseFallback: true, bibDirs },
        );
        process.stderr.write(
          `[cite-check] uploaded ${uploaded} + ${fromReadwise} from Readwise, ${skipped + restored} cached, ${missing} missing\n`,
        );

        // Persist updated manifest
        const updatedManifest = updateManifest(manifest, fileCache);
        saveManifest(manifestPath, updatedManifest);
      }
    } catch (err) {
      printError(`File upload failed: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
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
    // BATCH MODE: concurrent isolated queries (5 at a time).
    // Uses separate generateContent calls per query to prevent file reference
    // cross-contamination (the Gemini Batch API shares file context across
    // requests within a single job, causing wrong-source passage retrieval).
    const batchRequests: BatchRequest[] = [];

    for (const g of groups) {
      const inStore = g.cites.filter((c) => fileCache.has(c.bibkey));
      const notInStore = g.cites.filter((c) => !fileCache.has(c.bibkey));

      for (const c of notInStore) {
        results.push({
          cite: c,
          status: "NOT_IN_STORE",
          response: `Bibkey \`${c.bibkey}\` not uploaded.`,
        });
      }

      if (inStore.length === 0) continue;

      const refs = inStore.map(c => fileCache.get(c.bibkey)!);
      const prompt = buildGroupPrompt(inStore);
      batchRequests.push({ key: g.key, prompt, fileRefs: refs });
    }

    if (batchRequests.length > 0) {
      process.stderr.write(
        `[cite-check] batch mode: querying ${batchRequests.length} groups concurrently...\n`,
      );

      const batchResults = await queryCitationsConcurrently(batchRequests, { debug, retryModel });

      // Map results back to cite groups by key
      const resultByKey = new Map(batchResults.map((r) => [r.key, r]));

      for (const g of groups) {
        const inStore = g.cites.filter((c) => fileCache.has(c.bibkey));
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

      // 3a. Partition: which bibkeys are uploaded vs not?
      const inStore = g.cites.filter((c) => fileCache.has(c.bibkey));
      const notInStore = g.cites.filter((c) => !fileCache.has(c.bibkey));

      // Tag NOT_IN_STORE cites immediately.
      for (const c of notInStore) {
        results.push({
          cite: c,
          status: "NOT_IN_STORE",
          response: `Bibkey \`${c.bibkey}\` not uploaded.`,
        });
      }

      // If no cites have files, nothing to query.
      if (inStore.length === 0) continue;

      queryIdx++;

      // Collect file refs for this group's bibkeys
      const refs = inStore.map(c => fileCache.get(c.bibkey)!);

      const prompt = buildGroupPrompt(inStore);
      const label = inStore.map((c) => c.bibkey).join("+");
      process.stderr.write(
        `[cite-check] ${queryIdx}/${groups.length} ${label} @ ${relPath(
          c0.file,
          draftsDir,
        )}:${c0.line} ...`,
      );

      try {
        const geminiResult = await queryCitation(refs, prompt, {
          debug,
          retryModel,
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
// Ask mode: targeted query against a specific source.
// ---------------------------------------------------------------------------

export interface AskFlags {
  debug?: string | boolean;
}

/**
 * Ask a targeted question about a specific source.
 *
 * Usage: bun cite-check.ts ask @Bibkey "question" --bib <path> [--bib <path2>]
 *
 * Uploads the source PDF (or fetches from Readwise), sends the question to
 * Gemini, and prints the answer to stdout.
 */
export async function cmdAsk(
  args: string[],
  flags: AskFlags,
  bibPaths?: string[],
): Promise<number> {
  const debug = !!flags.debug;

  // Collect --bib paths
  const resolvedBibPaths: string[] = bibPaths
    ? bibPaths.map(expandPath)
    : (() => {
        const raw = Bun.argv.slice(2);
        const paths: string[] = [];
        for (let i = 0; i < raw.length; i++) {
          if (raw[i] === "--bib" && i + 1 < raw.length) {
            paths.push(expandPath(raw[i + 1]));
            i++;
          }
        }
        return paths;
      })();

  if (resolvedBibPaths.length === 0) {
    printError("ask mode requires --bib <path>");
    return 1;
  }

  // Parse positional args: first is bibkey (with or without @), rest is the question
  const filteredArgs = args.filter((a) => a !== "ask");
  if (filteredArgs.length < 2) {
    printError(
      "Usage: cite-check ask @Bibkey \"question\" --bib <path>",
    );
    return 1;
  }

  const bibkey = filteredArgs[0].replace(/^@/, "");
  const question = filteredArgs.slice(1).join(" ");

  // Parse bib files
  const bibMap = new Map<string, BibEntry>();
  for (const bp of resolvedBibPaths) {
    try {
      const entries = parseBibFile(bp);
      for (const [key, entry] of entries) {
        if (!bibMap.has(key)) bibMap.set(key, entry);
      }
    } catch (err) {
      printError(
        `failed to parse bib file ${bp}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 1;
    }
  }

  const entry = bibMap.get(bibkey);
  if (!entry) {
    printError(`bibkey '${bibkey}' not found in any bib file`);
    return 1;
  }

  // Upload the source (with manifest caching)
  const manifestPath = join(dirname(resolvedBibPaths[0]), ".cite-check-store.json");
  const manifest = loadManifest(manifestPath);
  const fileCache = new Map<string, FileRef>();
  const bibDirs = resolvedBibPaths.map((p) => dirname(p));

  // Try manifest first
  const restored = restoreFromManifest(manifest, fileCache, [bibkey]);

  let sourceType = "cached";
  if (restored === 0) {
    const { uploaded, fromReadwise, missing } = await uploadCitedFiles(
      bibMap,
      [bibkey],
      fileCache,
      { debug, readwiseFallback: true, bibDirs },
    );

    if (missing > 0) {
      printError(
        `source for '${bibkey}' not found (no PDF on disk, no Readwise match)`,
      );
      return 1;
    }

    sourceType = uploaded > 0 ? "PDF" : "Readwise";

    // Persist updated manifest
    const updatedManifest = updateManifest(manifest, fileCache);
    saveManifest(manifestPath, updatedManifest);
  }

  const ref = fileCache.get(bibkey);
  if (!ref) {
    printError(`failed to upload source for '${bibkey}'`);
    return 1;
  }

  process.stderr.write(
    `[ask] querying ${bibkey} (${sourceType})...\n`,
  );

  // Query Gemini with the question
  const prompt = `Based on the source document titled '${bibkey}'${entry.title ? ` ("${entry.title}")` : ""}, answer this question:\n\n${question}\n\nQuote relevant passages from the source to support your answer. If the source does not address this question, say so clearly.`;

  try {
    const result = await queryCitation([ref], prompt, { debug });
    // Print the answer -- for ask mode, show explanation + passage
    const cls = result.classification;
    if (cls.supporting_passage) {
      console.log(`**Passage:** "${cls.supporting_passage}"\n`);
    }
    console.log(`**Answer:** ${cls.explanation}`);
    console.log(`\n_Status: ${cls.status} (${result.durationMs}ms)_`);
    return 0;
  } catch (err) {
    printError(
      `Gemini error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
}

// ---------------------------------------------------------------------------
// Standalone entrypoint.
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const rawArgs = Bun.argv.slice(2);
  const { args, flags } = parseFlags(rawArgs);

  // Dispatch: "ask" subcommand vs default cite-check
  if (args[0] === "ask") {
    cmdAsk(args, flags as AskFlags).then((code) => process.exit(code));
  } else {
    cmdCiteCheck(args, flags as CiteCheckFlags).then((code) =>
      process.exit(code),
    );
  }
}
