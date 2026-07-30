#!/usr/bin/env bun
import { persistDsApprovedPlan } from "../workflows/lib/approved-artifact.ts";
import { workflowFromArg } from "./_workflow_policies.ts";

function fail(message: string): never { console.error(`[approved-artifact-persist] ${message}`); process.exit(2); }
const policy = workflowFromArg(Bun.argv.slice(2));
if (!policy || policy.workflow !== "ds") fail("requires --workflow ds; dev has no native-plan producer yet");
let payload: Record<string, unknown>;
try { payload = JSON.parse(await Bun.stdin.text()); } catch { fail("hook payload is not valid JSON"); }
if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("hook payload must be an object");
if (payload.tool_name !== "ExitPlanMode") process.exit(0);
const input = payload.tool_input;
if (!input || typeof input !== "object" || Array.isArray(input) || typeof (input as Record<string, unknown>).plan !== "string") fail("ExitPlanMode tool input is missing string plan");
if (typeof payload.session_id !== "string" || !payload.session_id.trim()) fail("ExitPlanMode payload is missing a nonempty session_id");
try { persistDsApprovedPlan(process.cwd(), (input as Record<string, string>).plan, payload.session_id); } catch (error) { fail(`could not persist approved artifact: ${error instanceof Error ? error.message : String(error)}`); }
