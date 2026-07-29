#!/usr/bin/env bun
/**
 * PostToolUse hook: Log PR URL after gh pr create.
 *
 * When gh pr create succeeds, this hook extracts the PR URL from output
 * and logs it to LEARNINGS.md for easy reference.
 *
 * Port note: this hook NEVER writes to stdout and always exits 0 — there is no deny path. The only
 * observable effects are the appended LEARNINGS.md line and a stderr breadcrumb. A malformed stdin
 * payload must be swallowed (exit 0), exactly as the Python `json.JSONDecodeError` branch did.
 */
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Find .claude/LEARNINGS.md in current project. */
function findLearningsFile(): string | null {
  const learningsPath = join(process.cwd(), ".claude", "LEARNINGS.md");
  return existsSync(learningsPath) ? learningsPath : null;
}

/** Extract GitHub PR URL from gh pr create output. */
function extractPrUrl(output: string): string | null {
  // gh pr create outputs URL on success
  // Format: https://github.com/owner/repo/pull/123
  const match = output.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/);
  return match ? match[0] : null;
}

/** Two-digit zero pad, matching Python's strftime field widths. */
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Append PR URL to LEARNINGS.md. */
function logPrToLearnings(prUrl: string, learningsPath: string): boolean {
  // Local time, minute precision — same as datetime.now().strftime('%Y-%m-%d %H:%M').
  const d = new Date();
  const timestamp =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const entry = `\n- [${timestamp}] PR created: ${prUrl}\n`;

  try {
    appendFileSync(learningsPath, entry, "utf-8");
    return true;
  } catch (e) {
    console.error(`[PRLogger] Failed to log PR: ${e}`);
    return false;
  }
}

// Read hook input
let hookInput: Record<string, unknown>;
try {
  hookInput = JSON.parse(await Bun.stdin.text());
} catch {
  process.exit(0);
}

const toolName = String(hookInput?.tool_name ?? "");
const toolInput = (hookInput?.tool_input ?? {}) as Record<string, unknown>;
const toolResult = (hookInput?.tool_result ?? {}) as Record<string, unknown>;

// Only process Bash tool
if (toolName !== "Bash") process.exit(0);

// Check if this was a gh pr create command
const command = String(toolInput?.command ?? "");
if (!command.includes("gh pr create")) process.exit(0);

// Get output from tool result (Python `a or b`: empty string falls through to `output`)
const output = String(toolResult?.stdout ?? "") || String(toolResult?.output ?? "");
if (!output) process.exit(0);

// Extract PR URL
const prUrl = extractPrUrl(output);
if (!prUrl) process.exit(0);

// Log to LEARNINGS.md (async - Claude won't wait for this)
const learningsPath = findLearningsFile();
if (learningsPath) {
  if (logPrToLearnings(prUrl, learningsPath)) {
    console.error(`[PRLogger] Logged PR: ${prUrl}`);
  }
}

process.exit(0);
