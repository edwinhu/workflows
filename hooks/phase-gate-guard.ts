#!/usr/bin/env bun
/**
 * PreToolUse CLI adapter for the reusable hardened phase-gate evaluator.
 *
 * Environment variables retain the original hook contract. Silence is allow;
 * denials retain the exact _gate_common.ts hook bytes.
 */
import { realpathSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { allow, deny, denyOnCrash, parsePayload } from "./_gate_common.ts";
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

  // A PreToolUse GATE DENIES ON A PAYLOAD IT CANNOT READ. The `catch { exit 0 }` here was
  // Python parity, and it is precisely what `denyOnCrash` cannot reach: the handler covers
  // throws that ESCAPE, and a local catch means none does. Measured — unparseable stdin, and
  // for the raw-`JSON.parse` gates also `null`/`"s"`/`[1,2]`, produced exit 0 with no output,
  // i.e. a silent ALLOW on every malformed payload. `parsePayload` denies on a non-object and
  // lets a parse error propagate to the handler, which denies too.
  const hookInput: Record<string, unknown> = parsePayload(await Bun.stdin.text());

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
    hookInput,
  );

  if (decision.kind === "deny") deny(decision.reason);
  allow();
}

await main();
