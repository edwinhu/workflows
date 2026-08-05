/**
 * PROSE ADAPTERS — a second MODEL on a draft, through the Claude Code harness.
 *
 * WHY THESE EXIST SEPARATELY FROM codex.ts / gemini.ts
 *   Those review a git diff and speak to code. A draft has no meaningful diff: prose is judged
 *   whole, and a reviewer needs the surrounding argument to judge any sentence in it.
 *
 * WHY THEY SHELL THE `*-code` WRAPPERS AND NOT `codex` / `agy`
 *   `codex-code` and `gemini-code` are the Claude Code harness pointed at GPT-5.6 and Gemini via
 *   CLIProxyAPI (they end in `exec claude "$@"`), which gives the reviewer a real tool loop and
 *   this repo's skill roster. The stated reason used to be that the reviewer could then be TOLD to
 *   load de-ai-revise and ai-anti-patterns; it no longer is. Those rules now arrive as data in the
 *   prompt (see `buildPrompt`), because an instruction nothing checks is not a shared rule set.
 *   What the harness still buys is a reviewer that can read the surrounding repo when a claim in
 *   the draft needs checking. The point is a different set of blind spots, not different rules.
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

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_SCOPE, type Adapter, type AdapterResult, type Invoke, type ReviewScope } from "../third-party-review.ts";

/** Draft bytes handed to the model. A comment letter is ~40k; past this, chunking beats truncation. */
const MAX_DOC_BYTES = 400_000;

const TIMEOUT_MS = 600_000;

/** Provider transcript kept on EVERY return path, truncated. See `raw` below for why. */
const MAX_RAW_BYTES = 4000;

const PLUGIN_ROOT = resolve(dirname(import.meta.dir), "..", "..");
const PROSE_AUDIT = join(PLUGIN_ROOT, "scripts", "prose-audit.py");
const AUDIT_TIMEOUT_MS = 120_000;

type AuditSpan = {
  id: string; line: number; system: string; severity: string;
  labels: string[]; quote: string; replace_with?: string;
};

/**
 * The deterministic audit, run HERE rather than asked for in the prompt.
 *
 * NOT through `context.invoke`. That seam exists so a test can stand in for the paid provider
 * call; routing a local, free, deterministic subprocess through the same stub would make the
 * adapter test assert against a fake audit, which is the opposite of what this evidence is for.
 * Best-effort: an audit that cannot run yields no spans and the reviewer is told so, rather than
 * the whole review failing over a linter.
 */
export function runProseAudit(path: string): AuditSpan[] {
  try {
    const proc = spawnSync(
      "uv",
      ["run", "--with", "lxml", "--with", "pyyaml", "python3", PROSE_AUDIT, "--json", path],
      { encoding: "utf8", timeout: AUDIT_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
    );
    // Exit 1 means hard spans were found. That is a result, not a failure.
    if (proc.status !== 0 && proc.status !== 1) return [];
    const parsed = JSON.parse(proc.stdout) as { spans?: AuditSpan[] };
    return Array.isArray(parsed.spans) ? parsed.spans : [];
  } catch {
    return [];
  }
}

function spanBlock(spans: AuditSpan[]): string {
  if (!spans.length) {
    return `DETERMINISTIC PROSE AUDIT: it produced no spans for this document. Return "spanIds": [] on every finding.`;
  }
  const hard = spans.filter(s => s.severity === "hard").length;
  return `DETERMINISTIC PROSE AUDIT — ${spans.length} span(s), ${hard} hard. This is the SAME evidence the
author's own reviewers were given, computed by the same script, with the same ids. Do not re-derive
it and do not run a scorer; disagreement with these spans is useful, silent duplication is not.

${spans.map(s => `  ${s.id}  [${s.severity}] L${s.line} ${s.system}: ${s.labels.join(" | ")} — ${JSON.stringify(s.quote)}${s.replace_with ? `  →  ${s.replace_with}` : ""}`).join("\n")}

A \`hard\` span is a provenance leak or a phrase that appeared ~0 times in 14.3M sentences of human
law and finance prose; it is almost never defensible. A \`soft\` span has a real false-positive rate
— judging one correct in context is a real answer, and saying so is useful.`;
}

/**
 * THE PROMPT IS EVIDENCE, NOT INSTRUCTION.
 *
 * It used to open by telling the reviewer to load two skills first and apply them — de-ai-revise
 * and ai-anti-patterns. Nothing checked whether that happened, and — because this adapter threw away
 * the success-path transcript — no artifact survived from which anyone could have checked. After
 * the rule611 comment-letter review neither external reviewer gave any evidence it had applied
 * those rules, and the question turned out to be unanswerable rather than merely unanswered.
 *
 * So the rules arrive as data: the audit's span list, plus the ~15 lines of reference-12 findings
 * that genuinely cannot be regexed, inlined verbatim below. What remains asked-for is what only a
 * different reader can give.
 */
function buildPrompt(spans: AuditSpan[]): string {
  return `You are giving a SECOND OPINION on a piece of prose that has already passed its
author's own review. You are a different model from the author, and that is the entire point: report
what a reader with different habits notices, not what a style guide says.

${spanBlock(spans)}

WHAT THE SPANS CANNOT TELL YOU — findings from The Economist's 2026 corpus study (55,940 sentences
of AI rewrites across 14 model variants, against news, fiction, and their own prose). These are
dated judgements, not rules, and no regex can express them:

  - A word-level AI tic has a HALF-LIFE. Models drop the tells people mock: "delve", "rich
    tapestry" and "leveraging" have all decayed since 2024. Weight CONSTRUCTION-level tics (the
    reasoning-chain leak, the chatbot opener, "not X but Y") above vocabulary tics — a construction
    comes from how the model plans a sentence, not from a token preference.
  - EM-DASHES SPLIT BY MODEL; they did not die. Only Claude now uses more of them than human
    writers, and ChatGPT uses markedly fewer than anyone. Do NOT read a low em-dash count as human,
    and do not report em-dash density on its own.
  - The study names "significant", "increasingly" and "consequences" as AI-overused. In scholarly
    law and finance prose "significant" runs >80 per million and is unremarkable. THE REGISTER YOU
    ARE READING DECIDES, not a news-and-fiction baseline.
  - "not only … but also" and "not X but Y" are LLM favourites AND legitimate distinction-drawing
    moves in legal prose. Only the redundant-restatement form is a tell ("not partially, not
    ambiguously, but definitively" — three negations for one idea).
  - What the study did find, and what is worth looking for: bland, pretentious prose lavished with
    Latinate words; long words crowding out Saxon ones; almost no semicolons; hardly any
    parentheses; long sentences with no short punchy ones between them; nominalisations
    ("expansion" for "expand"); and triads whose three members restate one idea.

Now read the document and report only defects you can quote. Beyond the spans, look for: sentences
that force a re-read, claims stated more strongly than their evidence, paragraphs whose point
arrives late, hedges that name nothing, jargon used before it is defined, and any passage that
reads as machine-written to you specifically.

Do NOT report: em-dash density alone, spellings that are correct in both US and UK English, or
anything you cannot quote verbatim from the document.

Reply with a SINGLE fenced JSON block and nothing else:

{
  "verdict": "approve" | "needs-attention",
  "summary": "one paragraph",
  "spanIds": ["every audit span id you considered, or [] if none were supplied"],
  "findings": [
    {
      "severity": "critical" | "high" | "medium" | "low",
      "title": "short",
      "detail": "what is wrong and why it matters",
      "quote": "the exact text from the document",
      "spanIds": ["the audit span ids this finding rests on, or []"],
      "suggestion": "concrete replacement, or empty string"
    }
  ]
}

THE DOCUMENT FOLLOWS.
`;
}

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
export function parseReply(text: string): { verdict?: string; summary?: string; findings?: unknown[]; spanIds?: unknown } | undefined {
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

  const spans = runProseAudit(scope.path);

  let run: { code: number; stdout: string; stderr: string };
  try {
    run = context.invoke({
      command: wrapper,
      args: ["--output-format", "stream-json", "--verbose", "-p", `${buildPrompt(spans)}\n${body}`],
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
      raw: run.stdout.slice(0, MAX_RAW_BYTES),
    };
  }

  const reply = parseReply(text);
  if (!reply || !Array.isArray(reply.findings)) {
    return { status: "unparseable", findings: [], reason: `${wrapper} output carried no JSON findings block`, raw: text.slice(0, MAX_RAW_BYTES) };
  }

  // `raw` ON THE SUCCESS PATH TOO. It used to be carried only by `unavailable` and `unparseable`,
  // so the one case where the provider actually worked was the one case that left no transcript —
  // and `total_cost_usd`, the tool-use record, and any evidence of what the reviewer did with the
  // spans all went in the bin with it. That is why nobody could answer whether the rule611
  // reviewers had applied the rules their prompt named. Truncated, because the point is an
  // auditable trace, not an archive.
  return {
    status: "reviewed",
    findings: reply.findings,
    verdict: reply.verdict,
    summary: reply.summary,
    // The ids the reviewer says it CONSIDERED, not just the ones a finding rests on. Dropping this
    // would leave "read the spans and disagreed" indistinguishable from "never looked" — the exact
    // distinction the injection exists to make, and the one the internal reviewers are judged on.
    spanIds: Array.isArray(reply.spanIds)
      ? reply.spanIds.filter((id): id is string => typeof id === "string" && id.trim() !== "")
      : [],
    raw: run.stdout.slice(0, MAX_RAW_BYTES),
  };
}

export const proseCodexAdapter: Adapter = {
  name: "prose-codex",
  review: context => proseReview("codex-code", "prose-codex", context),
};

export const proseGeminiAdapter: Adapter = {
  name: "prose-gemini",
  review: context => proseReview("gemini-code", "prose-gemini", context),
};
