/**
 * Third-party review adapter: the Antigravity (`agy`) one-shot CLI.
 *
 * THIS IS THE HARD HALF, AND THAT IS WHY IT EXISTS.
 *
 * The codex companion returns JSON validated against a published schema. `agy -p` returns PROSE —
 * whatever the model felt like emitting, possibly with a JSON block in it, possibly with commentary
 * wrapped around the block, possibly with neither. So this adapter ASKS for JSON and then parses
 * DEFENSIVELY, and the two failure modes it must never exhibit are:
 *
 *   1. Inventing findings from prose. "It mentions a race condition, so that's a finding" is the
 *      adapter making up a claim the provider never made in a form anyone can act on.
 *   2. Returning zero findings to represent a parse failure. That makes a broken adapter
 *      indistinguishable from a clean review — the exact silent-zero the status field exists to stop.
 *
 * On anything it cannot read it returns `status:"unparseable"` carrying the raw stdout, so a human
 * can see what actually came back. A second adapter with genuinely different output characteristics
 * is also the only way the neutrality of the shared contract is observed rather than claimed: a
 * contract with one implementation is shaped by that implementation whether or not anyone notices.
 */
import type { Adapter, AdapterResult, Invoke } from "../third-party-review.ts";

/** Diff bytes handed to the model. Past this the prompt costs more than the extra context is worth. */
const MAX_DIFF_BYTES = 240_000;

const PROMPT_HEADER = `You are an adversarial code reviewer giving a SECOND OPINION on a change that has already
passed its author's own verification. Look for defects that survive a careful self-review: incorrect
edge-case handling, unstated assumptions, contract violations between modules, tests that assert
something weaker than they appear to, and error paths that silently succeed.

Reply with a SINGLE fenced JSON block and nothing else. The JSON object must have exactly these keys:

{
  "verdict": "approve" | "needs-attention",
  "summary": "one paragraph",
  "findings": [
    {
      "severity": "critical" | "high" | "medium" | "low",
      "title": "short title",
      "body": "what is wrong and why it matters",
      "file": "repo-relative path or null",
      "lineStart": integer or null,
      "lineEnd": integer or null,
      "confidence": number between 0 and 1,
      "recommendation": "what to do about it"
    }
  ]
}

If you find nothing, return "findings": [] with "verdict": "approve". Do not report style
preferences. Do not invent line numbers you did not read.

THE DIFF UNDER REVIEW:
`;

function unavailable(reason: string): AdapterResult {
  return { status: "unavailable", findings: [], reason };
}
function unparseable(reason: string, raw: string): AdapterResult {
  return { status: "unparseable", findings: [], reason, raw };
}

/**
 * Pull the first balanced JSON object out of arbitrary text.
 *
 * A regex cannot do this — braces nest, and a `}` inside a string literal is not a closing brace —
 * and getting it wrong here means truncating a real review into an unparseable one. Scans for the
 * first `{` and tracks depth while respecting string state and escapes.
 */
export function extractJsonObject(source: string): string | undefined {
  const start = source.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return undefined;
}

export function reviewWithGemini(context: { projectDir: string; invoke: Invoke }): AdapterResult {
  let diff: { code: number; stdout: string; stderr: string };
  try {
    // Working-tree scope, matching the other adapter's `--scope working-tree`, so the two adapters
    // review the SAME change. Comparing their findings would otherwise compare two different diffs.
    diff = context.invoke({ command: "git", args: ["diff", "HEAD"], cwd: context.projectDir });
  } catch (error) {
    return unavailable(`could not capture the working-tree diff: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (diff.code !== 0) return unavailable(`git diff HEAD exited ${diff.code}: ${(diff.stderr || "").trim().slice(0, 500)}`);
  // An empty diff is NOT a clean review — there was nothing to review. Saying "reviewed, 0 findings"
  // here would credit the provider with a pass it never performed.
  if (!diff.stdout.trim()) return unavailable("the working tree has no changes to review");

  const truncated = diff.stdout.length > MAX_DIFF_BYTES;
  const body = truncated
    ? `${diff.stdout.slice(0, MAX_DIFF_BYTES)}\n\n[diff truncated at ${MAX_DIFF_BYTES} bytes]`
    : diff.stdout;

  let run: { code: number; stdout: string; stderr: string };
  try {
    run = context.invoke({ command: "agy", args: ["-p", `${PROMPT_HEADER}${body}`], cwd: context.projectDir });
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
  if (run.code !== 0 && !run.stdout.trim()) {
    return unavailable(`agy exited ${run.code}: ${(run.stderr || "").trim().slice(0, 500)}`);
  }

  const block = extractJsonObject(run.stdout);
  if (!block) return unparseable("agy output contained no JSON object", run.stdout);
  let parsed: any;
  try {
    parsed = JSON.parse(block);
  } catch (error) {
    return unparseable(`the JSON block in agy output did not parse: ${error instanceof Error ? error.message : String(error)}`, run.stdout);
  }
  // A parsed object that is not the requested SHAPE is still a parse failure. Accepting
  // `{"answer": "looks fine"}` as a clean review is the same fabrication as reading prose.
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.findings)) {
    return unparseable("agy returned JSON without a findings array", run.stdout);
  }
  if (!parsed.findings.every((entry: unknown) => !!entry && typeof entry === "object" && !Array.isArray(entry))) {
    return unparseable("agy returned a findings array whose entries are not objects", run.stdout);
  }

  return {
    status: "reviewed",
    verdict: typeof parsed.verdict === "string" ? parsed.verdict : null,
    summary: typeof parsed.summary === "string" ? parsed.summary : null,
    findings: parsed.findings,
  };
}

export const geminiAdapter: Adapter = {
  name: "gemini",
  review: context => reviewWithGemini(context),
};
