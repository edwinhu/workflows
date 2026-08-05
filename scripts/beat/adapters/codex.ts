/**
 * Third-party review adapter: the Codex companion.
 *
 * This is the EASY half of the pair, and it is worth naming why. The companion already ships
 * `adversarial-review --json`, whose payload carries a `result` validated against its own
 * `schemas/review-output.schema.json`:
 *
 *   {verdict, summary, findings[{severity,title,body,file,line_start,line_end,confidence,recommendation}], next_steps}
 *
 * So this adapter NORMALISES rather than invents: every neutral field has a schema-guaranteed source,
 * and nothing is inferred from prose. Compare `gemini.ts`, which gets prose and has to defend itself.
 * The asymmetry between the two is the whole reason two adapters ship instead of one.
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SCOPE, type Adapter, type AdapterResult, type Invoke, type ReviewScope } from "../contract.ts";

const PLUGIN_CACHE = join(homedir(), ".claude", "plugins", "cache", "openai-codex", "codex");

/** Version directories sort numerically per segment, so 1.0.10 beats 1.0.9 rather than losing to it. */
function compareVersions(left: string, right: string): number {
  const l = left.split(".").map(part => Number.parseInt(part, 10));
  const r = right.split(".").map(part => Number.parseInt(part, 10));
  for (let index = 0; index < Math.max(l.length, r.length); index++) {
    const a = Number.isFinite(l[index]) ? l[index] : 0;
    const b = Number.isFinite(r[index]) ? r[index] : 0;
    if (a !== b) return a - b;
  }
  return 0;
}

/** The newest installed companion script, or undefined if the plugin is not installed. */
export function findCompanionScript(cacheDir: string = PLUGIN_CACHE): string | undefined {
  let entries: string[];
  try {
    entries = readdirSync(cacheDir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
  } catch {
    return undefined;
  }
  const candidates = entries.sort(compareVersions).reverse()
    .map(version => join(cacheDir, version, "scripts", "codex-companion.mjs"))
    .filter(path => existsSync(path));
  return candidates[0];
}

function unavailable(reason: string): AdapterResult {
  return { status: "unavailable", findings: [], reason };
}

export function reviewWithCodex(context: { projectDir: string; invoke: Invoke; scope?: ReviewScope; cacheDir?: string }): AdapterResult {
  const script = findCompanionScript(context.cacheDir ?? PLUGIN_CACHE);
  if (!script) return unavailable(`codex companion is not installed under ${context.cacheDir ?? PLUGIN_CACHE}`);

  // The companion already speaks both scopes; the adapter previously hardcoded `working-tree`, which
  // is why it could not review committed work at all.
  const scope = context.scope ?? DEFAULT_SCOPE;
  // A code adapter handed a document scope must SAY it cannot, not silently fall through to
  // working-tree and review a diff nobody asked about. Prose has its own adapters.
  if (scope.kind === "document") {
    return { status: "unavailable", findings: [], reason: `${codexAdapter.name} reviews diffs, not documents; use the prose adapter` };
  }
  const scopeArgs = scope.kind === "branch"
    ? ["--scope", "branch", "--base", scope.base]
    : ["--scope", "working-tree"];

  let run: { code: number; stdout: string; stderr: string };
  try {
    run = context.invoke({
      command: "node",
      args: [script, "adversarial-review", "--wait", "--json", ...scopeArgs],
      cwd: context.projectDir,
    });
  } catch (error) {
    // ENOENT on `node`, a timeout, a killed process. None of these are review outcomes.
    return unavailable(error instanceof Error ? error.message : String(error));
  }

  let payload: any;
  try {
    payload = JSON.parse(run.stdout);
  } catch {
    // A NON-ZERO EXIT WITH NO JSON IS UNAVAILABLE, NOT UNPARSEABLE. The distinction matters to the
    // reader: "the tool did not run" and "the tool ran and said something I could not read" call for
    // different responses, and collapsing them loses the only signal that would tell you which.
    return run.code !== 0
      ? unavailable(`codex companion exited ${run.code}: ${(run.stderr || run.stdout || "").trim().slice(0, 500)}`)
      : { status: "unparseable", findings: [], reason: "codex companion --json output was not JSON", raw: run.stdout };
  }

  // The companion reports its own structured-output parse failure in-band. Trusting `result` without
  // checking `parseError` would read a failed parse as a clean review with zero findings.
  if (payload?.parseError || !payload?.result || typeof payload.result !== "object") {
    const raw = typeof payload?.rawOutput === "string" ? payload.rawOutput : run.stdout;
    return {
      status: "unparseable",
      findings: [],
      reason: typeof payload?.parseError === "string" && payload.parseError
        ? `codex companion could not parse its model's structured output: ${payload.parseError}`
        : "codex companion returned no review result",
      raw,
    };
  }

  const result = payload.result;
  return {
    status: "reviewed",
    verdict: typeof result.verdict === "string" ? result.verdict : null,
    summary: typeof result.summary === "string" ? result.summary : null,
    // Passed through unmapped on purpose: `normalizeFindings` in the core owns the snake_case ->
    // camelCase mapping for BOTH adapters, so the two cannot drift into different neutral shapes.
    findings: Array.isArray(result.findings) ? result.findings : [],
  };
}

export const codexAdapter: Adapter = {
  name: "codex",
  review: context => reviewWithCodex(context),
};
