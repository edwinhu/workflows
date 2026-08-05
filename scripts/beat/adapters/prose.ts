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
 *   What the harness buys is a reviewer that can read the surrounding repo when a claim in the
 *   draft needs checking — see the probation note below for whether it actually does. The point
 *   is a different set of blind spots, not a different set of rules.
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
 * COST — MEASURED, AND THIS COMMENT HAS NOW BEEN WRONG TWICE, EACH TIME LOW.
 *
 *   v5.127  "$0.12 per adapter"   counted only the ~22k input tokens of system prompt and skill
 *                                 roster — the floor, mistaken for the bill.
 *   v5.131  "$1.18 for the pair"  measured, but on a run where both adapters answered in 1-3 turns.
 *   v5.132  $10.35 for the pair   prose-codex $4.198 (520s, 9 turns), prose-gemini $6.152 (144s,
 *                                 18 turns), same ~40k comment letter.
 *
 * The pattern is the point: cost here is dominated by TURNS, not by the draft. Asking the reviewer
 * to open sources (the probation fix below) is what moved 3 turns to 9-18, and it moved the bill
 * about 9x. A caller sizing a budget from this comment should assume a $5-15 range per pair and
 * read `usage.totalCostUsd` for the real number — which is why that field exists and why no future
 * edit should replace it with a single reassuring figure.
 *
 * THE HARNESS WRAPPER IS OFF PROBATION. It was kept on the bet that a tool loop with repo access
 * would be used if the prompt gave a reason to use it. Measured on v5.131.0 against the rule611
 * comment letter, it is: prose-gemini ran 18 turns with 8 `tool_use` blocks and independently
 * verified eight SEC release line-cites against the source, reporting them sound; prose-codex ran
 * 9 turns over 520s and spawned three subagents of its own. Neither is a 1-turn completion, so the
 * plain-provider-CLI fallback contemplated here is now the WRONG move — it would delete the
 * capability that produced the only externally-verified claim either reviewer made.
 *
 * The cost of that capability is the 9x bill above. Both facts came from the same run.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_SCOPE, type Adapter, type AdapterResult, type Invoke, type ReviewScope } from "../contract.ts";

/** Draft bytes handed to the model. A comment letter is ~40k; past this, chunking beats truncation. */
const MAX_DOC_BYTES = 400_000;

const TIMEOUT_MS = 600_000;

/**
 * Provider transcript kept on EVERY return path, truncated to the TAIL.
 *
 * THE HEAD IS THE WRONG END. `raw` was `stdout.slice(0, 4000)`, and measured on a real review that
 * is 4000 bytes of SessionStart hook chatter: `"total_cost_usd" in raw` was false for both
 * adapters. The whole point of keeping `raw` is the accounting and the tool-use record, and both
 * live in the FINAL events. The tail carries them.
 */
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

YOU CAN READ THE REPOSITORY THIS DRAFT LIVES IN, AND YOU SHOULD. Where the draft asserts a NUMBER,
a citation, a statute or rule reference, or a claim about what a source says, open the source and
check it. Say what you found either way — "I checked X against Y and it holds" is a useful finding,
not a wasted one. A claim you could have checked and did not is the one thing a second reader is
uniquely placed to catch, and it is the reason you are being run through a harness with file access
rather than as a bare completion.

Beyond the spans and those checks, report only defects you can quote. Look for: sentences that
force a re-read, claims stated more strongly than their evidence, paragraphs whose point arrives
late, hedges that name nothing, jargon used before it is defined, and any passage that reads as
machine-written to you specifically.

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

/** The tail of the transcript — where the accounting is. Sliced on a line boundary so the
 *  preserved fragment is still parseable rather than starting mid-token. */
export function tailRaw(stdout: string, limit = MAX_RAW_BYTES): string {
  if (stdout.length <= limit) return stdout;
  const cut = stdout.slice(stdout.length - limit);
  const nl = cut.indexOf("\n");
  return nl === -1 ? cut : cut.slice(nl + 1);
}

/**
 * BOTH ENDS, for the FAILURE paths only.
 *
 * `tailRaw` is right on the success path: the answer parsed, so the transcript is kept for the
 * accounting and the tool-use record, and both live at the end. On a PARSE FAILURE the calculus
 * inverts — the preserved text is the only surviving artifact, and the reason it failed is at the
 * HEAD, which is exactly the part `tailRaw` throws away.
 *
 * This is not hypothetical. The v5.131.0 `prose-codex` failure could not be diagnosed from its own
 * report: `raw` was the last 3982 characters, all of them the well-formed answer, so the report
 * showed a valid JSON object next to a message saying no JSON object was found. Reconstructing the
 * offending head needed the provider's session transcript from disk — evidence that happened to
 * exist and, for a run inside a plan, would not. A truncation that destroys the evidence for the
 * failure it is reporting is worse than no `raw` at all, because it looks like evidence.
 *
 * Head and tail get half the budget each, both cut on line boundaries, with an explicit marker
 * naming what was dropped so nobody mistakes the join for contiguous output.
 */
export function headTailRaw(text: string, limit = MAX_RAW_BYTES): string {
  if (text.length <= limit) return text;
  const half = Math.floor(limit / 2);
  const head = text.slice(0, half);
  const headCut = head.lastIndexOf("\n");
  const keptHead = headCut === -1 ? head : head.slice(0, headCut);

  const tail = text.slice(text.length - (limit - half));
  const tailCut = tail.indexOf("\n");
  const keptTail = tailCut === -1 ? tail : tail.slice(tailCut + 1);

  const elided = text.length - keptHead.length - keptTail.length;
  return `${keptHead}\n…[${elided} characters elided from the middle]…\n${keptTail}`;
}

/**
 * The provider's own accounting, lifted out of the terminal `result` event into typed fields.
 *
 * Leaving it inside `raw` meant it survived only by luck of truncation, and a caller wanting the
 * cost had to re-parse a transcript. These are the three numbers anyone actually asks for after an
 * opt-in paid step: what it cost, how long it took, and how many turns it burned.
 */
export function extractUsage(stdout: string): { totalCostUsd: number | null; durationMs: number | null; numTurns: number | null } {
  const out = { totalCostUsd: null as number | null, durationMs: null as number | null, numTurns: null as number | null };
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event: { type?: string; total_cost_usd?: unknown; duration_ms?: unknown; num_turns?: unknown };
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (event.type !== "result") continue;
    if (typeof event.total_cost_usd === "number") out.totalCostUsd = event.total_cost_usd;
    if (typeof event.duration_ms === "number") out.durationMs = event.duration_ms;
    if (typeof event.num_turns === "number") out.numTurns = event.num_turns;
  }
  return out;
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

/**
 * Every substring of the reply that could plausibly BE the answer, in the order we should try them.
 *
 * Fenced blocks first and in document order, then an unterminated trailing fence (a reply cut off
 * before its closing ```), then the whole text, then the widest brace slice. The last two matter
 * for a provider that answers with bare JSON and no fence at all.
 */
function jsonCandidates(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) out.push(match[1]);
  const unterminated = text.match(/```(?:json)?\s*([\s\S]*)$/);
  if (unterminated && !unterminated[1].includes("```")) out.push(unterminated[1]);
  out.push(text);
  const first = text.indexOf("{"), last = text.lastIndexOf("}");
  if (first !== -1 && last > first) out.push(text.slice(first, last + 1));
  return out.map(candidate => candidate.trim()).filter(Boolean);
}

/**
 * The provider's reply, selected BY CONTRACT rather than by position.
 *
 * THE BUG THIS REPLACES, measured on the rule611 letter at v5.131.0. `prose-codex` returned
 * `unparseable` — "codex-code output carried no JSON findings block" — while having produced a
 * complete, well-formed answer with SEVEN findings, one of them anchored to span S009 and one
 * naming a truncated sentence in the letter that no internal gate had caught. All seven were
 * discarded here. The old implementation took the FIRST fenced block in the whole concatenated
 * reply and committed to it; the concatenation contained six earlier fences that were not the
 * answer, and the first of them held an arithmetic aside:
 *
 *     ```text
 *     49,135,555 − 19,751 − 9,150 = 49,106,654
 *     ```
 *
 * which is not JSON, so `JSON.parse` threw and the answer three fences later was never reached.
 * `prose-gemini` survived the same release only because its reply happened to contain exactly one
 * fence — position was doing the work of a contract, and it worked until it didn't.
 *
 * WHAT IS CONFIRMED AND WHAT IS NOT. That the first fence wins and that a non-JSON earlier fence
 * therefore kills the reply is CONFIRMED: replaying this function over the reviewer's reconstructed
 * text reproduces `unparseable` exactly, and repairing the selection rule recovers all seven
 * findings. WHERE those earlier fences came from is NOT confirmed — the reviewer's own turns hold
 * only the final answer (twice, both parseable), and subagent text was measured NOT to reach stdout
 * as assistant text. The stdout head that would say was destroyed by the truncation this file used
 * to apply on the failure path; see `headTailRaw`. That is precisely why the fix is a contract and
 * not a guess: selecting the first candidate that SATISFIES THE CONTRACT is correct under every
 * candidate explanation, including the one we could not test.
 *
 * A parseable object that lacks `findings` is kept as a FALLBACK rather than returned outright, so
 * the caller can still tell "no JSON anywhere" from "JSON that ignored the schema" — two failures
 * that used to share one reason string and one remedy.
 */
export function parseReply(text: string): { verdict?: string; summary?: string; findings?: unknown[]; spanIds?: unknown } | undefined {
  let offContract: Record<string, unknown> | undefined;
  for (const candidate of jsonCandidates(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue; // not JSON — an arithmetic aside, a quoted snippet, a diff the reviewer showed
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const object = parsed as Record<string, unknown>;
    if (Array.isArray(object.findings)) return object; // satisfies the contract; stop looking
    offContract ??= object;
  }
  return offContract;
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
      // Head AND tail: a provider that emitted nothing usable fails at the START of the stream
      // (a bad flag, a refused auth, a hook that aborted), which is the half `tailRaw` drops.
      raw: headTailRaw(run.stdout),
      usage: extractUsage(run.stdout),
    };
  }

  const reply = parseReply(text);
  if (!reply || !Array.isArray(reply.findings)) {
    // TWO DISTINCT FAILURES, and they used to share one sentence. "No JSON at all" means the
    // reviewer answered in prose and the prompt needs work; "JSON without a findings array" means
    // it answered in the wrong shape and the schema needs work. Reading the second as the first
    // cost a release, because the reported reason was inconsistent with the reported `raw` and the
    // contradiction had to be resolved by hand.
    return {
      status: "unparseable", findings: [],
      reason: reply
        ? `${wrapper} returned a JSON object with no "findings" array (keys: ${Object.keys(reply).join(", ") || "none"})`
        : `${wrapper} output carried no JSON object`,
      // BOTH ENDS: on this path `raw` is the only artifact, and the cause is at the head.
      raw: headTailRaw(text),
      // The stdout transcript SEPARATELY, because `raw` here is the extracted text and therefore
      // can never contain a tool_use block. Without this, "did the reviewer open any files?" was
      // answerable only when the run succeeded.
      transcript: headTailRaw(run.stdout),
      usage: extractUsage(run.stdout),
    };
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
    raw: tailRaw(run.stdout),
    usage: extractUsage(run.stdout),
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
