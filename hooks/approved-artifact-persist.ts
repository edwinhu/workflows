#!/usr/bin/env bun
import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { persistApprovedPlan } from "../workflows/lib/approved-artifact.ts";
import { workflowFromArg } from "./_workflow_policies.ts";

function fail(message: string): never { console.error(`[approved-artifact-persist] ${message}`); process.exit(2); }
function defer(message: string): never { console.error(`[approved-artifact-persist] ${message}`); process.exit(1); }

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
  let toolUsePlan: string | undefined;
  let toolUseCount = 0;
  let approvedPath: unknown;
  let resultCount = 0;
  try {
    for (const line of readFileSync(transcriptPath, "utf8").split(/\r?\n/)) {
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
        const result = block as Record<string, unknown>;
        if (result.type === "tool_use" && result.id === toolUseId && result.name === "ExitPlanMode") {
          toolUseCount += 1;
          const candidate = result.input;
          if (candidate && typeof candidate === "object" && !Array.isArray(candidate) && typeof (candidate as Record<string, unknown>).plan === "string") {
            toolUsePlan = (candidate as Record<string, unknown>).plan;
          }
        }
        if (result.type === "tool_result" && result.tool_use_id === toolUseId) {
          resultCount += 1;
          const toolUseResult = record.toolUseResult;
          approvedPath = toolUseResult && typeof toolUseResult === "object" && !Array.isArray(toolUseResult)
            ? (toolUseResult as Record<string, unknown>).filePath
            : undefined;
        }
      }
    }
  } catch { fail("ExitPlanMode approved plan could not be recovered from transcript"); }
  if (toolUseCount > 1 || resultCount > 1) fail("ExitPlanMode transcript contains duplicate matching records");
  if (resultCount === 1 && (typeof approvedPath !== "string" || !isAbsolute(approvedPath))) fail("ExitPlanMode toolUseResult.filePath must name an absolute regular nonempty file");

  let resultPlan: string | undefined;
  let resultBytes: Buffer | undefined;
  if (resultCount === 1) {
    try {
      const fd = openSync(approvedPath, "r");
      try {
        const status = fstatSync(fd);
        if (!status.isFile() || status.size === 0) fail("ExitPlanMode toolUseResult.filePath must name an absolute regular nonempty file");
        resultBytes = readFileSync(fd);
      } finally {
        closeSync(fd);
      }
      if (resultBytes.length === 0) fail("ExitPlanMode toolUseResult.filePath must name an absolute regular nonempty file");
      resultPlan = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(resultBytes);
      if (!Buffer.from(resultPlan, "utf8").equals(resultBytes)) fail("ExitPlanMode approved plan file must contain exact valid UTF-8 bytes");
    } catch (error) {
      if (error instanceof TypeError) fail("ExitPlanMode approved plan file must contain exact valid UTF-8 bytes");
      fail("ExitPlanMode toolUseResult.filePath must name an absolute regular nonempty file");
    }
  }
  if (toolUsePlan !== undefined && resultPlan !== undefined && !Buffer.from(toolUsePlan, "utf8").equals(resultBytes)) fail("ExitPlanMode transcript tool-use and tool-result plans disagree");
  plan = toolUsePlan ?? resultPlan;
  if (typeof plan !== "string") defer("ExitPlanMode matching transcript tool-result was not found");
}
if (typeof plan !== "string") fail("ExitPlanMode tool input is missing string plan");
if (typeof payload.session_id !== "string" || !payload.session_id.trim()) fail("ExitPlanMode payload is missing a nonempty session_id");
try { persistApprovedPlan(process.cwd(), policy.workflow, plan, payload.session_id); } catch (error) { defer(`could not persist approved artifact: ${error instanceof Error ? error.message : String(error)}`); }
