#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { persistApprovedPlan } from "../workflows/lib/approved-artifact.ts";
import { workflowFromArg } from "./_workflow_policies.ts";

function fail(message: string): never { console.error(`[approved-artifact-persist] ${message}`); process.exit(2); }

const policy = workflowFromArg(Bun.argv.slice(2));
if (!policy || policy.workflow === "dev") fail("requires a native-plan workflow: ds, writing, workshop, or workflow-creator; dev has no native-plan producer yet");
let payload: Record<string, unknown>;
try { payload = JSON.parse(await Bun.stdin.text()); } catch { fail("hook payload is not valid JSON"); }
if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("hook payload must be an object");
if (payload.tool_name !== "ExitPlanMode") process.exit(0);
const input = payload.tool_input;
let plan = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>).plan : undefined;
if (typeof plan !== "string") {
  const transcriptPath = payload.transcript_path;
  const toolUseId = payload.tool_use_id;
  if (typeof transcriptPath !== "string" || typeof toolUseId !== "string" || !toolUseId) fail("ExitPlanMode tool input is missing string plan and transcript lookup identity");
  try {
    scan: for (const line of readFileSync(transcriptPath, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      let record: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
        record = parsed as Record<string, unknown>;
      } catch { continue; }
      const message = record.message as Record<string, unknown> | undefined;
      const content = Array.isArray(message?.content) ? message.content : [];
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const tool = block as Record<string, unknown>;
        const toolInput = tool.input as Record<string, unknown> | undefined;
        if (tool.type === "tool_use" && tool.id === toolUseId && tool.name === "ExitPlanMode" && typeof toolInput?.plan === "string") {
          plan = toolInput.plan;
          break scan;
        }
      }
    }
  } catch { fail("ExitPlanMode approved plan could not be recovered from transcript"); }
}
if (typeof plan !== "string") fail("ExitPlanMode tool input is missing string plan");
if (typeof payload.session_id !== "string" || !payload.session_id.trim()) fail("ExitPlanMode payload is missing a nonempty session_id");
try { persistApprovedPlan(process.cwd(), policy.workflow, plan, payload.session_id); } catch (error) { fail(`could not persist approved artifact: ${error instanceof Error ? error.message : String(error)}`); }
