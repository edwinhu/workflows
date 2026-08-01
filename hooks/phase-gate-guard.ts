#!/usr/bin/env bun
/**
 * PreToolUse CLI adapter for the reusable hardened phase-gate evaluator.
 *
 * Environment variables retain the original hook contract. Silence is allow;
 * denials retain the exact _gate_common.ts hook bytes.
 */
import { realpathSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { allow, deny, denyOnCrash } from "./_gate_common.ts";
import { evaluatePhaseGate } from "./lib/phase-gate.ts";

// FIRST STATEMENT WITH AN EFFECT: a throw below becomes a schema-valid deny instead of an
// exit-1, which Claude Code treats as NON-BLOCKING — i.e. a silent allow in a PreToolUse gate.
denyOnCrash("PHASE GATE GUARD");

async function main(): Promise<void> {
  let artifactPath = process.env.GATE_ARTIFACT ?? "";
  if (!artifactPath) allow();
  const projectRoot = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  if (isAbsolute(artifactPath)) {
    try {
      const root = realpathSync(projectRoot);
      const canonical = realpathSync(artifactPath);
      const contained = relative(root, canonical);
      artifactPath = contained && contained !== ".." && !contained.startsWith(`..${sep}`) && !isAbsolute(contained)
        ? contained.split(sep).join("/")
        : artifactPath;
    } catch {
      // Preserve the absolute input so the public evaluator rejects it fail closed.
    }
  }

  let hookInput: Record<string, unknown>;
  try {
    hookInput = JSON.parse(await Bun.stdin.text());
  } catch {
    allow();
  }

  const decision = evaluatePhaseGate(
    projectRoot,
    {
      artifactPath,
      requiredStatus: process.env.GATE_STATUS ?? "",
      requiredFields: process.env.GATE_REQUIRE_FIELDS ?? "",
      gateDescription: process.env.GATE_DESCRIPTION ?? "Phase gate",
      gateRemedy: process.env.GATE_REMEDY ?? "Complete the previous phase first",
      blockedTools: process.env.GATE_BLOCKED_TOOLS
        ? process.env.GATE_BLOCKED_TOOLS.split(",").map((tool) => tool.trim())
        : undefined,
    },
    hookInput!,
  );

  if (decision.kind === "deny") deny(decision.reason);
  allow();
}

await main();
