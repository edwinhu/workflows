#!/usr/bin/env bun
/**
 * cite-check — scan markdown drafts for pandoc citations, query NotebookLM to
 * verify each cite is grounded in the cited source, and write a structured
 * REVIEW-CITES.md report.
 *
 * Pipeline:
 *   1. Walk drafts dir → read .md files → extractCitations.
 *   2. List notebook sources (titles == bibkeys for items added by `nlm add`).
 *   3. For cites whose bibkey IS in the notebook, build a verify-prompt and
 *      shell out to `nlm generate-chat`. Tag SUPPORTED / PARTIAL / UNSUPPORTED.
 *   4. For cites whose bibkey is NOT in the notebook, tag NOT-IN-NOTEBOOK
 *      (no NLM call).
 *   5. Write a markdown report and print a one-line summary to stdout.
 *
 * Rate limit defaults to 1s between NLM calls.
 *
 * Usage:
 *   bun cite-check.ts --drafts <dir> --notebook <id> [--out <path>]
 *                     [--limit N] [--rate-ms 1500] [--dry-run] [--debug]
 *
 * Extracted from librarian-cli on 2026-04-24. The pieces are self-contained:
 * cite-extract.ts (pure function) + nlm.ts (Bun.spawn wrapper) +
 * cite-check.ts (CLI). No project-internal imports.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { nlmGenerateChat, nlmListSources } from "./nlm.js";
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

interface CiteCheckFlags {
  drafts?: string | boolean;
  notebook?: string | boolean;
  out?: string | boolean;
  "dry-run"?: string | boolean;
  "rate-ms"?: string | boolean;
  limit?: string | boolean;
  debug?: string | boolean;
}

type Status =
  | "SUPPORTED"
  | "PARTIAL"
  | "UNSUPPORTED"
  | "NOT_IN_NOTEBOOK"
  | "ERROR";

interface CiteResult {
  cite: Citation;
  status: Status;
  response: string;
}

const STATUS_GLYPH: Record<Status, string> = {
  SUPPORTED: "✓ SUPPORTED",
  PARTIAL: "⚠ PARTIAL",
  UNSUPPORTED: "✗ UNSUPPORTED",
  NOT_IN_NOTEBOOK: "⊘ NOT IN NOTEBOOK",
  ERROR: "💥 ERROR",
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

function buildPrompt(c: Citation): string {
  return buildGroupPrompt([c]);
}

/**
 * Build a verification prompt for one or more citations sharing the same claim.
 * When bibkeys.length > 1, the prompt asks NLM to evaluate the claim against
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
        "Conceptual alignment is sufficient — the source need not contain the exact words.",
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
        "Each source may cover a different part of the claim — that is expected for a compound citation.",
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

function classify(response: string): { status: Status; snippet: string } {
  const trimmed = response.trim();
  if (/UNSUPPORTED/i.test(trimmed)) {
    return { status: "UNSUPPORTED", snippet: trimmed.slice(0, 300) };
  }
  // Heuristic for "supported": contains a quoted passage > 20 chars OR a
  // markdown blockquote.
  const quoteMatch = /"([^"]{20,})"/.exec(trimmed);
  const blockQuoteMatch = /(^|\n)\s*>\s+(.+)/.exec(trimmed);
  if (quoteMatch) {
    return {
      status: "SUPPORTED",
      snippet: `"${quoteMatch[1].slice(0, 280)}"`,
    };
  }
  if (blockQuoteMatch) {
    return {
      status: "SUPPORTED",
      snippet: blockQuoteMatch[2].slice(0, 300),
    };
  }
  return { status: "PARTIAL", snippet: trimmed.slice(0, 300) };
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "...";
}

function escapeCell(s: string): string {
  // Pipes break markdown tables; replace with U+2758. Newlines become spaces.
  return s.replace(/\|/g, "❘").replace(/\s+/g, " ").trim();
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
    notebookId: string;
    fileCount: number;
    citationCount: number;
    draftsDir: string;
  },
): string {
  const counts: Record<Status, number> = {
    SUPPORTED: 0,
    PARTIAL: 0,
    UNSUPPORTED: 0,
    NOT_IN_NOTEBOOK: 0,
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
  lines.push(`NLM notebook: ${meta.notebookId}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- ✓ Supported: ${counts.SUPPORTED}`);
  lines.push(`- ⚠ Partial: ${counts.PARTIAL}`);
  lines.push(`- ✗ Unsupported: ${counts.UNSUPPORTED}`);
  lines.push(`- ⊘ Not in notebook: ${counts.NOT_IN_NOTEBOOK}`);
  lines.push(`- 💥 Error: ${counts.ERROR}`);
  lines.push("");
  lines.push("## Details");
  lines.push("");
  lines.push("| Status | File:Line | Bibkey | Claim | NLM Response |");
  lines.push("|--------|-----------|--------|-------|--------------|");
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

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function cmdCiteCheck(
  args: string[],
  flags: CiteCheckFlags,
): Promise<number> {
  // No positional args.
  void args;

  const notebookId =
    typeof flags.notebook === "string" ? flags.notebook : undefined;
  if (!notebookId) {
    printError(
      "Usage: cite-check --notebook <id> [--drafts <dir>] [--out <path>] [--dry-run] [--rate-ms <n>] [--limit <n>] [--debug]",
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
  const rateMs = (() => {
    const v = flags["rate-ms"];
    if (typeof v === "string") {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n >= 0 ? n : 1000;
    }
    return 1000;
  })();
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

  // 2. List notebook sources, build a Set of titles AND a title→id map
  //    (titles == bibkeys for `nlm add`-style sources).
  let sourceTitles = new Set<string>();
  const sourceIdByTitle = new Map<string, string>();
  if (!dryRun) {
    try {
      const sources = await nlmListSources(notebookId, { debug });
      for (const s of sources) {
        sourceTitles.add(s.title);
        sourceIdByTitle.set(s.title, s.id);
      }
      process.stderr.write(
        `[cite-check] notebook has ${sources.length} sources\n`,
      );
    } catch (err) {
      printError(
        `nlm sources failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 1;
    }
  }

  // 2b. Group citations that share the same (file, line, claim) — these are
  //     compound cites from multi-cite brackets like [@a; @b]. Each group is
  //     queried as a unit with all source IDs so NLM can see both sources.
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

  if (dryRun) {
    process.stderr.write(
      `[cite-check] dry-run: would query NLM for ${groups.length} groups (${cites.length} citations)\n`,
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
  }

  let queryIdx = 0;
  for (const g of groups) {
    const groupBibkeys = g.cites.map((c) => c.bibkey);
    const c0 = g.cites[0];

    // 3a. Partition: which bibkeys are in the notebook vs not?
    const inNotebook = g.cites.filter((c) => sourceTitles.has(c.bibkey));
    const notInNotebook = g.cites.filter((c) => !sourceTitles.has(c.bibkey));

    // Tag NOT_IN_NOTEBOOK cites immediately.
    for (const c of notInNotebook) {
      results.push({
        cite: c,
        status: "NOT_IN_NOTEBOOK",
        response: `Bibkey \`${c.bibkey}\` not in NLM notebook.`,
      });
    }

    // If no cites in the notebook, nothing to query.
    if (inNotebook.length === 0) continue;

    // 3b. Rate limit between NLM calls.
    if (queryIdx > 0 && rateMs > 0) {
      await sleep(rateMs);
    }
    queryIdx++;

    // Resolve source IDs for scoping.
    const sourceIds = inNotebook
      .map((c) => sourceIdByTitle.get(c.bibkey))
      .filter((id): id is string => !!id);

    const prompt = buildGroupPrompt(inNotebook);
    const label = inNotebook.map((c) => c.bibkey).join("+");
    process.stderr.write(
      `[cite-check] ${queryIdx}/${groups.length} ${label} @ ${relPath(
        c0.file,
        draftsDir,
      )}:${c0.line} ...`,
    );

    let res;
    try {
      res = await nlmGenerateChat(notebookId, prompt, {
        debug,
        sourceIds: sourceIds.length > 0 ? sourceIds : undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(` error\n`);
      for (const c of inNotebook) {
        results.push({
          cite: c,
          status: "ERROR",
          response: `nlm error: ${msg}`,
        });
      }
      continue;
    }

    if (res.finalEmpty) {
      const attempts = res.attempts ?? 1;
      process.stderr.write(` ERROR (exit nonzero or empty after ${attempts} attempts)\n`);
      for (const c of inNotebook) {
        results.push({
          cite: c,
          status: "ERROR",
          response: `nlm exit nonzero or empty after ${attempts} attempts`,
        });
      }
      continue;
    }

    const cls = classify(res.raw);
    process.stderr.write(` ${cls.status} (${res.durationMs}ms)\n`);
    // All cites in the group share the joint verdict and response.
    for (const c of inNotebook) {
      results.push({ cite: c, status: cls.status, response: cls.snippet });
    }
  }

  // 4. Write the report.
  const report = renderReport(results, {
    notebookId,
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
    NOT_IN_NOTEBOOK: 0,
    ERROR: 0,
  };
  for (const r of results) counts[r.status]++;
  process.stderr.write(
    `[cite-check] ${results.length} cites checked: ✓${counts.SUPPORTED} ⚠${counts.PARTIAL} ✗${counts.UNSUPPORTED} 💥${counts.ERROR} ⊘${counts.NOT_IN_NOTEBOOK} → wrote ${outPath}\n`,
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
