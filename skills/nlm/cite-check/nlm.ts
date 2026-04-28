/**
 * NotebookLM CLI wrapper.
 *
 * Shells out to the `nlm` CLI (https://github.com/tmc/nlm or similar) for the
 * two operations cite-check needs: list sources and run a generate-chat
 * prompt. We don't link a Go SDK; the CLI is the contract.
 */

import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_NLM_BIN = join(homedir(), ".local", "bin", "nlm");

export interface NLMResult {
  /** Full stdout from `nlm`. */
  raw: string;
  /** True when the child process exited with code 0. */
  ok: boolean;
  /** Wall-clock duration of the spawn, ms (cumulative across retries). */
  durationMs: number;
  /** Number of spawn attempts made (>=1). Optional; populated by retry wrapper. */
  attempts?: number;
  /**
   * True when, after all retries, the result was either nonzero exit or
   * empty stdout. Optional; populated by retry wrapper.
   */
  finalEmpty?: boolean;
}

export interface NLMSource {
  id: string;
  title: string;
}

/**
 * Parse the column-aligned table emitted by `nlm sources <id>`.
 *
 * Header looks like:
 *   ID                                   TITLE                                ...   TYPE   STATUS   LAST UPDATED
 *
 * We use the column start offsets from the header row. Title runs from the
 * TITLE column up to the TYPE column boundary.
 */
export function parseNlmSourcesTable(stdout: string): NLMSource[] {
  const lines = stdout.split("\n");
  if (lines.length < 2) return [];

  const header = lines[0];
  const idPos = header.indexOf("ID");
  const titlePos = header.indexOf("TITLE");
  const typePos = header.indexOf("TYPE");
  if (idPos < 0 || titlePos < 0 || typePos < 0) return [];

  const out: NLMSource[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    // Tolerate short lines defensively.
    if (line.length < typePos) {
      // Fall back to whitespace splitting.
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        out.push({ id: parts[0], title: parts.slice(1).join(" ") });
      }
      continue;
    }
    const id = line.slice(idPos, titlePos).trim();
    const title = line.slice(titlePos, typePos).trim();
    if (!id) continue;
    out.push({ id, title });
  }
  return out;
}

interface SpawnOpts {
  timeoutMs?: number;
  debug?: boolean;
  nlmBin?: string;
}

/**
 * Pluggable spawner type — exists so tests can mock the spawn without
 * actually invoking a child process.
 */
export type NlmSpawner = (
  args: string[],
  opts: SpawnOpts,
) => Promise<NLMResult>;

async function defaultSpawnNlm(
  args: string[],
  opts: SpawnOpts,
): Promise<NLMResult> {
  const bin = opts.nlmBin ?? DEFAULT_NLM_BIN;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const t0 = Date.now();

  if (opts.debug) {
    process.stderr.write(`[nlm] spawn ${bin} ${args.join(" ")}\n`);
  }

  const proc = Bun.spawn([bin, ...args], {
    stdout: "pipe",
    // Suppress nlm's progress messages by discarding stderr.
    stderr: "ignore",
  });

  const timer = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      // best-effort
    }
  }, timeoutMs);

  let stdout = "";
  try {
    stdout = await new Response(proc.stdout).text();
    await proc.exited;
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Date.now() - t0;
  return { raw: stdout, ok: proc.exitCode === 0, durationMs };
}

let activeSpawner: NlmSpawner = defaultSpawnNlm;

/**
 * Test seam: replace the default Bun.spawn-backed spawner with a fake.
 * Pass `null` to restore the default. Not for production use.
 */
export function __setNlmSpawnerForTesting(s: NlmSpawner | null): void {
  activeSpawner = s ?? defaultSpawnNlm;
}

async function spawnNlm(args: string[], opts: SpawnOpts): Promise<NLMResult> {
  return activeSpawner(args, opts);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Default backoff schedule: 1st call immediate, then 1s and 2s. */
const DEFAULT_RETRY_BACKOFFS_MS = [0, 1000, 2000];

/**
 * Run `nlm generate-chat <notebookId> <prompt> --format <fmt>`.
 *
 * Default `--format plain` (suppresses progress noise). Default 60s timeout.
 *
 * Retries up to 2 additional times (3 total attempts) on either nonzero exit
 * OR empty stdout. Backoffs are cumulative in `durationMs`. The returned
 * `attempts` and `finalEmpty` fields describe the retry outcome.
 */
export async function nlmGenerateChat(
  notebookId: string,
  prompt: string,
  opts: {
    format?: "plain" | "stream";
    timeoutMs?: number;
    debug?: boolean;
    nlmBin?: string;
    /** Override the backoff schedule. Length determines max attempts. */
    retryBackoffsMs?: number[];
    /** Scope the query to specific source(s) by ID. Repeatable. */
    sourceIds?: string[];
  } = {},
): Promise<NLMResult> {
  const format = opts.format ?? "plain";
  const args: string[] = [];
  // Global flags (--source-id, --format) come before the subcommand.
  if (opts.sourceIds) {
    for (const sid of opts.sourceIds) {
      args.push("--source-id", sid);
    }
  }
  args.push("--format", format, "generate-chat", notebookId, prompt);
  const backoffs = opts.retryBackoffsMs ?? DEFAULT_RETRY_BACKOFFS_MS;

  const t0 = Date.now();
  let attempts = 0;
  let last: NLMResult = { raw: "", ok: false, durationMs: 0 };

  for (const backoff of backoffs) {
    if (backoff > 0) await sleep(backoff);
    attempts++;
    last = await spawnNlm(args, opts);
    if (last.ok && last.raw.trim().length > 0) break;
    if (opts.debug) {
      process.stderr.write(
        `[nlm] attempt ${attempts}/${backoffs.length} ${
          last.ok ? "empty" : "exit-nonzero"
        }; will ${attempts < backoffs.length ? "retry" : "give up"}\n`,
      );
    }
  }

  const finalEmpty = !last.ok || last.raw.trim().length === 0;
  const durationMs = Date.now() - t0;
  return { ...last, durationMs, attempts, finalEmpty };
}

/**
 * Run `nlm sources <notebookId>` and parse the resulting table.
 *
 * Returns id+title pairs. Throws if the CLI exits non-zero.
 */
export async function nlmListSources(
  notebookId: string,
  opts: { timeoutMs?: number; debug?: boolean; nlmBin?: string } = {},
): Promise<NLMSource[]> {
  const res = await spawnNlm(["sources", notebookId], opts);
  if (!res.ok) {
    throw new Error(
      `nlm sources ${notebookId} failed (exit nonzero); raw: ${res.raw.slice(0, 400)}`,
    );
  }
  return parseNlmSourcesTable(res.raw);
}
