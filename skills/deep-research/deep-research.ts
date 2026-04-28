#!/usr/bin/env bun
/**
 * deep-research -- Gemini Deep Research CLI wrapper.
 *
 * Submits a research query to the Gemini Interactions API, polls for
 * completion, and prints the report to stdout. Saves completed reports
 * to /tmp/deep-research-<id>.md.
 *
 * Usage:
 *   bun deep-research.ts "research query"
 *   bun deep-research.ts --fast "research query"
 *   bun deep-research.ts --status <interaction-id>
 *   bun deep-research.ts --json "research query"
 */

import { GoogleGenAI } from "@google/genai";
import type { Interactions } from "@google/genai";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Interaction = Interactions.Interaction;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL_MAX = "deep-research-max-preview-04-2026";
const MODEL_FAST = "deep-research-preview-04-2026";
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_MAX_DURATION_MS = 65 * 60 * 1000; // 65 minutes
const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Client singleton + test seam
// ---------------------------------------------------------------------------

let activeClient: GoogleGenAI | null = null;

export function getClient(): GoogleGenAI {
  if (!activeClient) {
    activeClient = new GoogleGenAI({});
  }
  return activeClient;
}

export function __setClientForTesting(client: GoogleGenAI | null): void {
  activeClient = client;
}

// ---------------------------------------------------------------------------
// submit()
// ---------------------------------------------------------------------------

export async function submit(
  query: string,
  opts: { fast?: boolean } = {},
): Promise<string> {
  const client = getClient();
  const interaction = await client.interactions.create({
    input: query,
    agent: opts.fast ? MODEL_FAST : MODEL_MAX,
    background: true,
    agent_config: { type: "deep-research", thinking_summaries: "auto" },
  });
  console.error(`Interaction ID: ${interaction.id}`);
  return interaction.id;
}

// ---------------------------------------------------------------------------
// poll()
// ---------------------------------------------------------------------------

export interface PollOptions {
  pollIntervalMs?: number;
  maxDurationMs?: number;
}

export async function poll(
  id: string,
  opts: PollOptions = {},
): Promise<Interaction> {
  const client = getClient();
  const interval = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxDuration = opts.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;

  const start = Date.now();
  let retries = 0;

  for (;;) {
    const elapsed = Date.now() - start;
    if (elapsed > maxDuration) {
      throw new Error(
        `Polling timed out after ${Math.round(elapsed / 1000)}s for interaction ${id}`,
      );
    }

    let interaction: Interaction;
    try {
      interaction = (await client.interactions.get(id)) as Interaction;
      retries = 0; // reset on success
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : String(err);
      const isTransient =
        /503|429|service_unavailable|rate_limit/i.test(msg);

      if (isTransient && retries < MAX_RETRIES) {
        retries++;
        console.error(`  [retry ${retries}/${MAX_RETRIES}] ${msg}`);
        await sleep(interval);
        continue;
      }
      throw err;
    }

    const elapsedSec = Math.round((Date.now() - start) / 1000);
    console.error(`  [${elapsedSec}s] status: ${interaction.status}`);

    switch (interaction.status) {
      case "completed":
        return interaction;
      case "failed":
        throw new Error(
          `Interaction ${id} failed: ${JSON.stringify((interaction as any).error ?? "unknown error")}`,
        );
      case "cancelled":
        throw new Error(`Interaction ${id} was cancelled`);
      default:
        // in_progress, requires_action, incomplete -- keep polling
        await sleep(interval);
    }
  }
}

// ---------------------------------------------------------------------------
// formatOutput()
// ---------------------------------------------------------------------------

export function formatOutput(interaction: Interaction): string {
  const outputs = interaction.outputs ?? [];
  const texts = outputs
    .filter((o: any) => o.type === "text")
    .map((o: any) => o.text as string);
  const report = texts.join("\n");

  // Save to /tmp (best-effort, synchronous via Bun.write which returns a promise
  // but we fire-and-forget here since formatOutput is sync-shaped)
  const filePath = `/tmp/deep-research-${interaction.id}.md`;
  void Bun.write(filePath, report);

  return report;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
// CLI entry
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const { args, flags } = parseFlags(Bun.argv.slice(2));

  const fast = Boolean(flags.fast);
  const json = Boolean(flags.json);
  const statusId = typeof flags.status === "string" ? flags.status : undefined;

  let interactionId: string;

  if (statusId) {
    // Resume polling an existing interaction
    interactionId = statusId;
  } else if (args.length > 0) {
    // Submit new query
    const query = args.join(" ");
    interactionId = await submit(query, { fast });
  } else {
    console.error(
      "Usage: bun deep-research.ts [--fast] [--json] [--status <id>] <query>",
    );
    process.exit(1);
  }

  try {
    const result = await poll(interactionId);
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const report = formatOutput(result);
      console.log(report);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`error: ${msg}`);
    process.exit(1);
  }
}
