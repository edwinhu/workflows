#!/usr/bin/env bun
/**
 * Set `outputStyle` in a project's `.claude/settings.local.json` to the plugin's one structural
 * writing style, for a project whose writing plan is APPROVED.
 *
 * IT TAKES NO STYLE ARGUMENT, AND THERE IS NOTHING TO MAP. One output style ships (`General
 * prose`); it is structural — prose shape and the suppression of Claude Code's software-engineering
 * framing — and carries no register. The measured registers are preloaded into the writing
 * subagents through the `writing-general` base register skill, plus `writing-legal` or
 * `writing-econ` for those domains, which is the only channel that reaches a subagent. The plan's `## Writing Intent` `Domain` is still read, through the same
 * `authenticatedWritingPlan()` that `hooks/writing-prose-check.ts` uses to pick `--style`, and is
 * reported so the caller can see which register the episode is under.
 *
 * NO APPROVED PLAN MEANS NO WRITE. Not a default, not a guess. An unapproved episode has no
 * authenticated register, and picking one would be inventing authority.
 *
 * IT MERGES EXACTLY ONE KEY. `.claude/settings.local.json` carries `permissions` and whatever else
 * the user has put there, it OUTRANKS project settings, and Claude Code adds it to the global git
 * excludes when it writes there — so a clobber is both damaging and invisible to `git status`.
 * Malformed JSON is a REFUSAL, never an overwrite: a settings file that failed to parse is far more
 * likely to be mid-edit than to be garbage, and replacing it would destroy work.
 *
 * IT TAKES EFFECT NEXT SESSION. The output style is part of the system prompt, which Claude Code
 * reads once at session start, so this cannot change the session that runs it. That is why the
 * caller invokes it at the end of the approval/review episode: `writing-setup` already requires a
 * fresh session before implementation, so the boundary the setting needs is one the workflow was
 * taking anyway. Compare the retired plans-directory restart gate, which had to become a GATE because a
 * mid-session `plansDirectory` left the episode unauthenticated. This is prose voice, not
 * authentication — the drafting subagent's preloaded register skills and the plugin-wide prose
 * audit both still apply — so a notice is proportionate where a gate would not be.
 *
 * Usage:
 *   bun scripts/set-output-style.ts <projectRoot>            # write it
 *   bun scripts/set-output-style.ts <projectRoot> --dry-run  # report what it would do
 *
 * Exit: 0 written or already correct, 1 refused (no approved plan, unparseable settings), 2 usage
 * error.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { authenticatedWritingPlan } from "../hooks/lib/writing-plan-context.ts";

/**
 * THE ONLY OUTPUT STYLE. `output-styles/general-prose.md` is structural — it suppresses Claude
 * Code's software-engineering framing and sets prose shape for the MAIN conversation. It carries no
 * register, so there is no domain -> style mapping left to look up and no map file to go stale.
 * The measured registers reach the writing subagents through the preloaded `writing-general` base
 * skill, plus `writing-legal` or `writing-econ` for those domains, which is the only channel that
 * reaches a subagent at all.
 */
const STYLE_NAME = "General prose";

export type Outcome =
  | { ok: true; changed: boolean; style: string; name: string; settingsPath: string }
  | { ok: false; reason: string };

/**
 * Merge exactly `outputStyle` into a settings file, preserving every sibling key AND the file's
 * own key order — a wholesale rewrite of the user's settings would show up as a large diff in a
 * file they may well be reading by hand.
 */
export function mergeOutputStyle(settingsPath: string, name: string, dryRun = false): Outcome {
  let existing: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    let raw: string;
    try {
      raw = readFileSync(settingsPath, "utf8");
    } catch (e) {
      return { ok: false, reason: `cannot read ${settingsPath}: ${(e as Error).message}` };
    }
    if (raw.trim() !== "") {
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          return { ok: false, reason: `${settingsPath} is not a JSON object — refusing to overwrite it` };
        }
        existing = parsed as Record<string, unknown>;
      } catch (e) {
        // REFUSE, DO NOT REPLACE. Far more likely mid-edit than garbage.
        return { ok: false, reason: `${settingsPath} is not valid JSON (${(e as Error).message}) — refusing to overwrite it` };
      }
    }
  }

  if (existing.outputStyle === name) {
    return { ok: true, changed: false, style: "", name, settingsPath };
  }
  if (!dryRun) {
    const merged = { ...existing, outputStyle: name };
    mkdirSync(dirname(settingsPath), { recursive: true });
    // ATOMIC: write a sibling, then rename. A direct write truncates first, so a crash or a full
    // disk between truncate and flush leaves the user with a settings file that is neither the old
    // one nor the new one — and this file carries `permissions`, outranks project settings, and is
    // git-excluded, so there is nothing to restore it from. `rename` within the same directory is
    // atomic on every platform this runs on.
    const tmp = `${settingsPath}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n", "utf8");
      renameSync(tmp, settingsPath);
    } catch (e) {
      try { rmSync(tmp, { force: true }); } catch { /* best effort */ }
      return { ok: false, reason: `could not write ${settingsPath}: ${(e as Error).message}` };
    }
  }
  return { ok: true, changed: true, style: "", name, settingsPath };
}

/** The whole operation: derive the register from the approved plan, then merge. */
export function setOutputStyle(projectRoot: string, dryRun = false): Outcome {
  const root = resolve(projectRoot);
  const plan = authenticatedWritingPlan(root);
  if (!plan) {
    return { ok: false, reason: `no APPROVED receipt-selected writing plan at or above ${root} — nothing to derive a register from` };
  }
  // The gate still runs on the PLAN, not on the style: an unapproved episode has no authenticated
  // register and this script writes nothing for it. The Domain is reported, not looked up.
  const style = (plan.style || "").toLowerCase();
  const result = mergeOutputStyle(join(plan.projectRoot, ".claude", "settings.local.json"), STYLE_NAME, dryRun);
  return result.ok ? { ...result, style } : result;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((a) => !a.startsWith("--"));
  if (positional.length !== 1) {
    console.error("usage: set-output-style.ts <projectRoot> [--dry-run]");
    process.exit(2);
  }
  const result = setOutputStyle(positional[0], dryRun);
  if (!result.ok) {
    console.error(`set-output-style: ${result.reason}`);
    process.exit(1);
  }
  if (!result.changed) {
    console.log(`outputStyle is already "${result.name}" in ${result.settingsPath} — nothing to do.`);
    process.exit(0);
  }
  console.log(
    `${dryRun ? "WOULD SET" : "set"} outputStyle = "${result.name}"  (plan Domain: ${result.style})\n` +
      `  ${result.settingsPath}\n\n` +
      "TAKES EFFECT NEXT SESSION. The output style is part of the system prompt, which Claude Code\n" +
      "reads once at session start — this session keeps whatever style it started with. Drafting\n" +
      "happens in a fresh session anyway, so the next one picks it up.\n" +
      "It shapes the MAIN conversation only; the drafting and reviewing subagents get the same\n" +
      "register through the preloaded `writing-general` skill (plus the domain register skill)\n" +
      "regardless.",
  );
}

if (import.meta.main) await main();
