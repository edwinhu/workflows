#!/usr/bin/env bun
/** PostToolUse hook: suggest /writing-revise after a plan-bound edit threshold.
 *
 * The active writing identity is the APPROVED receipt-selected generated plan.
 * The sole mutable counter is narrow hidden state at
 * `.planning/.state/writing.json`, bound to that plan's SHA-256; retired
 * `ACTIVE_WORKFLOW.md` is conversion input only and is never read or written.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { atomicWrite } from "../workflows/lib/approved-artifact.ts";
import { context, readPayload } from "./_gate_common.ts";
import { authenticatedWritingPlan, writingStatePath } from "./lib/writing-plan-context.ts";

type WritingState = { schemaVersion: 1; planHash: string; editsSinceVerify: number };
const DEFAULT_THRESHOLD = 10;

function validState(value: unknown, planHash: string): value is WritingState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return Object.keys(state).length === 3
    && state.schemaVersion === 1
    && state.planHash === planHash
    && typeof state.editsSinceVerify === "number"
    && Number.isSafeInteger(state.editsSinceVerify)
    && state.editsSinceVerify >= 0;
}

/** State is only created after authenticating an approved canonical plan. */
function loadState(path: string, planHash: string): WritingState | null {
  if (!existsSync(path)) return { schemaVersion: 1, planHash, editsSinceVerify: 0 };
  try {
    const state: unknown = JSON.parse(readFileSync(path, "utf8"));
    return validState(state, planHash) ? state : null;
  } catch {
    return null;
  }
}

function persistState(path: string, state: WritingState): void {
  mkdirSync(dirname(path), { recursive: true });
  atomicWrite(path, `${JSON.stringify(state)}\n`);
}

async function main(): Promise<void> {
  let payload: Record<string, unknown>;
  try {
    payload = await readPayload();
  } catch {
    return;
  }
  const toolName = payload.tool_name;
  if (toolName !== "Write" && toolName !== "Edit" && toolName !== "MultiEdit") return;
  const filePath = (payload.tool_input as Record<string, unknown> | undefined)?.file_path;
  if (typeof filePath !== "string" || !filePath.endsWith(".md")) return;

  const plan = authenticatedWritingPlan(filePath);
  if (!plan) return;
  const statePath = writingStatePath(plan.projectRoot);
  const state = loadState(statePath, plan.plan.hash);
  // A malformed, tampered, or stale state must not be overwritten by a hook.
  if (!state) return;

  const edits = state.editsSinceVerify + 1;
  if (edits < DEFAULT_THRESHOLD) {
    persistState(statePath, { ...state, editsSinceVerify: edits });
    return;
  }
  persistState(statePath, { ...state, editsSinceVerify: 0 });
  context(
    "PostToolUse",
    `📝 ${edits} edits since last verify (style: ${plan.style || "general"}, phase: edit). ` +
      "Consider `/writing-revise` to apply fixes and polish.",
  );
}

await main();
