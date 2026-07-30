#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { sentinelPath, workflowFromArg } from "./_workflow_policies.ts";
import { allow, deny, readPayload } from "./_gate_common.ts";

const policy = workflowFromArg(Bun.argv.slice(2));
if (!policy) { deny("Clarification guard requires exactly one known --workflow ds|dev|writing|workshop policy."); }
const payload = await readPayload();
const tool = String(payload.tool_name ?? "");
const input = (payload.tool_input as Record<string, unknown>) ?? {};
const cwd = String(payload.cwd ?? process.cwd());
function clarified(): boolean {
  const path = sentinelPath(cwd, policy);
  if (typeof payload.session_id !== "string" || !existsSync(path)) return false;
  try { const value = JSON.parse(readFileSync(path, "utf8")); return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 2 && value.status === "clarified" && value.sessionId === payload.session_id; } catch { return false; }
}
function reconPath(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const path = value.replaceAll("\\", "/").toLowerCase();
  if (policy.workflow === "ds") return /(^|\/)(data|src|notebooks?|analysis|artifacts?|results?|outputs?|tasks?)(\/|$)/.test(path) || /\.ipynb(?:$|[/?*])/.test(path);
  if (policy.workflow === "writing") return /(^|\/)(drafts?|outlines?|references?|sources?|scratch)(\/|$)|\.(?:md|docx|tex|typ|bib|ris)$/.test(path);
  if (policy.workflow === "workshop") return /(^|\/)(presentation|figures?|slides?|notes?|references?|sources?)(\/|$)|\.(?:pdf|pptx|typ|tex|md)$/.test(path);
  return /(^|\/)(src|test|tests|lib|app|config|scripts?)(\/|$)|\.(?:ts|tsx|js|jsx|py|go|rs|java|json|ya?ml)$/.test(path);
}
const dsPatterns = ["python3 -c", "python -c", "import pandas", "import numpy", "import polars", "pd.read_", "pd.DataFrame", "df.head", "df.describe", "df.info", "df.shape", "df.columns", "df.dtypes", ".read_csv", ".read_parquet", ".read_sql", ".read_excel", "pixi run python"];
if (clarified()) allow();
if (tool === "Read" && policy.workflow === "dev" && String(input.file_path).replaceAll("\\", "/").endsWith(".planning/HANDOFF.md")) allow();
if (tool === "Bash") {
  const command = String(input.command ?? "").trim();
  // The sentinel is intentionally a clarification proof, not an access token. Before it exists,
  // Bash cannot inspect a project through an unenumerated alternate reader such as cat or sed.
  const sentinel = policy.clarifySentinel.replaceAll(".", "\\.").replaceAll("/", "\\/");
  const sentinelWrite = new RegExp(`^(?:mkdir -p \\.planning && )?(?:printf|echo) .+ > ${sentinel}$`);
  if (sentinelWrite.test(command)) allow();
  if (policy.workflow === "ds" && dsPatterns.some(pattern => command.includes(pattern))) deny(policy.clarifyReason);
  deny(policy.clarifyReason);
}
if (tool === "Read" && reconPath(input.file_path)) deny(policy.clarifyReason);
if (tool === "Glob" && (reconPath(input.pattern) || reconPath(input.path))) deny(policy.clarifyReason);
if (tool === "Grep" && (reconPath(input.path) || reconPath(input.glob))) deny(policy.clarifyReason);
allow();
