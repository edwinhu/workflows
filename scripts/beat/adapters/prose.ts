/**
 * PROSE ADAPTERS — a second MODEL on a draft, through the Claude Code harness.
 *
 * WHY THESE EXIST SEPARATELY FROM codex.ts / gemini.ts
 *   Those review a git diff and speak to code. A draft has no meaningful diff: prose is judged
 *   whole, and a reviewer needs the surrounding argument to judge any sentence in it.
 *
 * WHY THEY SHELL THE `*-code` WRAPPERS AND NOT `codex` / `agy`
 *   `codex-code` and `gemini-code` are the Claude Code harness pointed at GPT-5.6 and Gemini via
 *   CLIProxyAPI (they end in `exec claude "$@"`). That buys the one thing a raw provider CLI
 *   cannot: the reviewer loads THIS repo's skills, so it can be told to read de-ai-revise and
 *   ai-anti-patterns and apply the same corpus-gated rules we do — while being a different model.
 *   The point is a different set of blind spots, not a different set of rules.
 *
 * THE INVOCATION IS NOT OBVIOUS. Every flag below was established by running it:
 *
 *   1. `--output-format stream-json --verbose`, NOT `json`.
 *      The harness derives `result` from the LAST content block. Gemini-via-proxy appends an
 *      empty `thinking` block after the real text, so `result` is ALWAYS "" for that provider —
 *      while `is_error:false`, `subtype:"success"` and billed output tokens all say it worked.
 *      Measured: text block of 537 chars, then `('thinking', 0)`, then `result: ''`.
 *      Reading `result` would have made every Gemini review return "no findings" and read as
 *      agreement. We concatenate `text` blocks instead, which is also correct for codex and
 *      survives multi-block answers that `result` would truncate.
 *
 *   2. `< /dev/null`. Without it the wrapper blocks ~3s waiting on stdin and warns about it.
 *      Passed as `input: ""` through the Invoke seam.
 *
 *   3. Zero text blocks is `unavailable`, NEVER an empty finding list. That distinction is the
 *      whole reason this file does not read `result`.
 *
 * COST. Each call carries ~22k input tokens of system prompt and skill roster before the draft —
 * about $0.12 floor per adapter per review. That is the price of the skill access, and it is why
 * the step is opt-in and advisory.
 */

import { readFileSync } from "node:fs";
import { DEFAULT_SCOPE, type Adapter, type AdapterResult, type Invoke, type ReviewScope } from "../third-party-review.ts";

/** Draft bytes handed to the model. A comment letter is ~40k; past this, chunking beats truncation. */
const MAX_DOC_BYTES = 400_000;

const TIMEOUT_MS = 600_000;

const PROMPT = `You are giving a SECOND OPINION on a piece of prose that has already passed its
author's own review. You are a different model from the author, and that is the entire point: report
what a reader with different habits notices, not what a style guide says.

FIRST, load these skills and apply them — they carry corpus-gated rules, not vibes:
  - workflows:de-ai-revise      (AI-prose tells, validated against a 14M-sentence law+finance corpus)
  - workflows:ai-anti-patterns  (the anti-pattern catalogue, incl. reference 12 on which tells have decayed)

Then read the document and report only defects you can quote. Look for: sentences that force a
re-read, claims stated more strongly than their evidence, paragraphs whose point arrives late,
hedges that name nothing, jargon used before it is defined, and any passage that reads as
machine-written to you specifically.

Do NOT report: em-dash density alone (a corpus-gated scorer already covers it, and the 2026
Economist study found the signal is now model-specific), spellings that are correct in both US and
UK English, or anything you cannot quote verbatim from the document.

Reply with a SINGLE fenced JSON block and nothing else:

{
  "verdict": "approve" | "needs-attention",
  "summary": "one paragraph",
  "findings": [
    {
      "severity": "critical" | "high" | "medium" | "low",
      "title": "short",
      "detail": "what is wrong and why it matters",
      "quote": "the exact text from the document",
      "suggestion": "concrete replacement, or empty string"
    }
  ]
}

THE DOCUMENT FOLLOWS.
`;

/** Pull assistant text out of a stream-json transcript. See note 1 above for why not `result`. */
export function extractText(stdout: string): string {
  const parts: string[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue; // a non-JSON line is harness chatter, not an event
    }
    const e = event as { type?: string; message?: { content?: { type?: string; text?: string }[] } };
    if (e.type !== "assistant") continue;
    for (const block of e.message?.content ?? []) {
      if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
    }
  }
  return parts.join("").trim();
}

/** The provider's reply, which is a fenced JSON block if it followed instructions. */
export function parseReply(text: string): { verdict?: string; summary?: string; findings?: unknown[] } | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function proseReview(wrapper: string, name: string, context: { projectDir: string; invoke: Invoke; scope: ReviewScope }): AdapterResult {
  const scope = context.scope ?? DEFAULT_SCOPE;
  if (scope.kind !== "document") {
    return { status: "unavailable", findings: [], reason: `${name} reviews documents; got scope "${scope.kind}"` };
  }

  let body: string;
  try {
    body = readFileSync(scope.path, "utf8");
  } catch (error) {
    return { status: "unavailable", findings: [], reason: `could not read ${scope.path}: ${(error as Error).message}` };
  }
  if (!body.trim()) {
    return { status: "unavailable", findings: [], reason: `${scope.path} is empty` };
  }
  if (Buffer.byteLength(body, "utf8") > MAX_DOC_BYTES) {
    return { status: "unavailable", findings: [], reason: `${scope.path} exceeds ${MAX_DOC_BYTES} bytes; chunk it rather than truncating an argument` };
  }

  let run: { code: number; stdout: string; stderr: string };
  try {
    run = context.invoke({
      command: wrapper,
      args: ["--output-format", "stream-json", "--verbose", "-p", `${PROMPT}\n${body}`],
      cwd: context.projectDir,
      input: "", // the wrapper blocks ~3s on stdin without this
      timeoutMs: TIMEOUT_MS,
    });
  } catch (error) {
    return { status: "unavailable", findings: [], reason: `${wrapper} could not be run: ${(error as Error).message}` };
  }

  const text = extractText(run.stdout);
  if (!text) {
    // NOT an empty finding list. The provider may have exited 0, reported success and billed
    // tokens while returning nothing -- that is the observed Gemini failure, and calling it
    // "clean" would launder a dead adapter into agreement.
    return {
      status: "unavailable",
      findings: [],
      reason: `${wrapper} returned no assistant text (exit ${run.code})`,
      raw: run.stdout.slice(0, 4000),
    };
  }

  const reply = parseReply(text);
  if (!reply || !Array.isArray(reply.findings)) {
    return { status: "unparseable", findings: [], reason: `${wrapper} output carried no JSON findings block`, raw: text.slice(0, 4000) };
  }

  return { status: "reviewed", findings: reply.findings, verdict: reply.verdict, summary: reply.summary };
}

export const proseCodexAdapter: Adapter = {
  name: "prose-codex",
  review: context => proseReview("codex-code", "prose-codex", context),
};

export const proseGeminiAdapter: Adapter = {
  name: "prose-gemini",
  review: context => proseReview("gemini-code", "prose-gemini", context),
};
