#!/usr/bin/env bun
/**
 * Deterministic compliance probe for a plugin repo — including THIS one.
 *
 * WHY DETERMINISTIC, AND NOT ANOTHER workflow-creator-verify REVIEWER
 *   `workflow-creator-verify` fans out LLM reviewers per dimension. That is the right instrument for architecture and
 *   enforcement judgement, and the WRONG one for the three properties below, because every one of them
 *   is a CONFIGURATION fact and the characteristic way to get them wrong is to measure the reference
 *   instead of the mechanism. An agent asked "does this workflow use the beats" greps for the beat's
 *   name and finds it, which is precisely how four defects reached production in one week:
 *
 *     - `workflows/beat-implement.js` was correct and nothing ran it, for four months.
 *     - `writing` and `workshop` dispatched write-capable agents with no writable-path bounds.
 *     - `hooks/work-implement-observation.ts` shipped in v5.106.0 registered in NOTHING; it had 35
 *       passing behaviour tests, none of which asked whether it was ever invoked.
 *     - `teaching` pinned a capability contract by strict equality and nothing compared the pin to
 *       the lifecycle it documents, so an upstream bump broke all 11 of its native skills.
 *
 *   One shape, four instances. So these checks read files and compare sets — no model, no judgement.
 *   They plug into workflow-creator-verify through its existing `mechanicalProbes` seam rather than adding a
 *   dimension, because a probe's exit status is evidence and a reviewer's score is an opinion.
 *
 * WHY IT MUST AUDIT THE PLUGIN THAT HOSTS IT
 *   `workflow-creator` is a META workflow. An auditor that can only inspect the workflows it generates
 *   catches the NEXT workflow's version of a bug and never its own host's — and all four defects above
 *   were in the host. Self-hosting is the requirement, not a bonus: run it with `--target` pointed at
 *   this repo and it audits the beats, hooks and contracts that implement it.
 *
 * Usage:
 *   bun scripts/wc/compliance-probe.ts --target <plugin repo root> [--json]
 * Exit 0 = no findings. Exit 1 = findings (each names file, rule, and remedy).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type Finding = {
  rule: "beat-adoption" | "hook-registration" | "fail-open-without-gate" | "probe-blind";
  severity: "critical" | "major";
  subject: string;
  detail: string;
  remedy: string;
};

// Five since 2026-08-06. PLAN and VERIFY were convention rather than primitive — they lived as
// work-local `skills/work/beats/*.md`, so the approved-artifact receipt and "the verifier is never
// the doer" were re-derived per workflow instead of enforced from one place. `/ds` is what that
// cost: it ran its verifier inside its doer for months, and no probe could see it.
const BEATS = ["beat-clarify", "beat-plan", "beat-implement", "beat-verify", "beat-review"] as const;

function read(path: string): string {
  try { return readFileSync(path, "utf8"); } catch { return ""; }
}

function frontmatter(text: string): string {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  return match?.[1] ?? "";
}

function skillDirs(root: string): string[] {
  const skills = join(root, "skills");
  if (!existsSync(skills)) return [];
  return readdirSync(skills, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(skills, entry.name, "SKILL.md")))
    .map(entry => entry.name)
    .sort();
}

/**
 * The workflows to hold to the beat contract, DISCOVERED rather than hardcoded.
 *
 * `tests/beat-adoption.test.py` hardcodes six names, which means a seventh entry point is not
 * "failing" — it is invisible. `skills/audit-fix-loop` is exactly that: a documented entry with
 * write-capable fixers, no beat reference, and no hooks, sitting outside the tuple. A registry that
 * cannot see a new member reports 18/18 while covering six of seven.
 *
 * Discovery is the union of two sources, because neither alone is complete:
 *   - the canonical policy registry (`hooks/_workflow_policies.ts`), which is authoritative for
 *     built-ins and is what the gates themselves key on; and
 *   - any user-invocable skill that dispatches agents, which is what makes something an entry point
 *     in practice regardless of whether a policy was ever written for it.
 */
export function discoverWorkflows(root: string): string[] {
  const found = new Set<string>();
  const policies = read(join(root, "hooks/_workflow_policies.ts"));
  for (const match of policies.matchAll(/^\s{2}"?([a-z][a-z0-9-]*)"?:\s*Object\.freeze\(\{/gm)) {
    found.add(match[1]);
  }
  for (const name of skillDirs(root)) {
    const text = read(join(root, "skills", name, "SKILL.md"));
    const front = frontmatter(text);
    if (/user-invocable:\s*false/.test(front) || /disable-model-invocation:\s*true/.test(front)) continue;
    // THE TEST IS THE APPROVAL REGIME, NOT "does it mention agents".
    //
    // A first cut used "user-invocable and dispatches agents" and produced eleven false positives:
    // `skill-creator` and `law-review-docx` are utilities with no plan and no approval, and the beat
    // contract genuinely does not apply to them. The beats govern MUTATION UNDER AN APPROVED PLAN, so
    // the signal is registering the guards that enforce exactly that. Measuring the mechanism, again.
    // Gate names differ per plugin. `workflows` uses these two; `teaching` uses `native-workflow.ts
    // gate`. A probe that only knows its own repo's names silently discovers nothing elsewhere.
    if (/orchestrator-mutation-guard|approved-artifact-gate|native-workflow\.ts/.test(front)) found.add(name);
  }
  // Family members are not separate workflows. `writing-revise` is part of `writing` and
  // `workflow-creator-improve` is a second entry to `workflow-creator`; both register the same guards
  // as their parent, so without this they each get reported for the parent's beats. That is the same
  // false-positive shape as above, one level up.
  for (const name of [...found]) {
    if ([...found].some(other => other !== name && name.startsWith(`${other}-`))) found.delete(name);
  }
  return [...found].sort();
}

/** Every SKILL.md in the workflow's family, mirroring how a workflow is actually assembled. */
function family(root: string, workflow: string): string[] {
  const paths: string[] = [];
  for (const name of skillDirs(root)) {
    if (name === workflow || name.startsWith(`${workflow}-`)) paths.push(join(root, "skills", name, "SKILL.md"));
  }
  const beatsDir = join(root, "skills", workflow, "beats");
  if (existsSync(beatsDir)) {
    for (const entry of readdirSync(beatsDir)) if (entry.endsWith(".md")) paths.push(join(beatsDir, entry));
  }
  return paths;
}

export function checkBeatAdoption(root: string): Finding[] {
  const findings: Finding[] = [];
  // THE BEATS MUST BE LOCAL FOR THIS CHECK TO MEAN ANYTHING.
  //
  // "Loads `<beat>/SKILL.md`" is only a sensible test where those files exist in the repo. A CONSUMER
  // plugin reaches them through the published capability manifest instead — `teaching` pins
  // `beat-implement-runner` and calls it through a brokered adapter, which is the sanctioned path and
  // is stricter than a SKILL.md reference. Applied blindly it reported 21 findings against teaching,
  // every one of them "no skill loads a file that does not exist here and could not be loaded if it
  // did": `beat-clarify` and `beat-review` are `user-invocable: false` and are not published as
  // capabilities, so no consumer HAS a way to reach them. That is a gap in what this plugin publishes,
  // not a compliance failure by the consumer, and reporting it as the latter sends someone to fix the
  // wrong repo.
  if (!existsSync(join(root, "skills", "beat-implement"))) {
    const consumes = read(join(root, ".claude-plugin/plugin.json")).includes("workflows")
      || read(join(root, "scripts/native-workflow-adapter.ts")).includes("beat-implement-runner");
    if (!consumes) return findings;
    return [{
      rule: "beat-adoption", severity: "major", subject: root,
      detail: "consumer plugin: reaches the beats through the capability manifest, which this probe cannot verify from here",
      remedy: "audit the consumer's adapter pin against the publisher's capabilities.json. Note that beat-clarify and beat-review are NOT published as capabilities, so no consumer can reach them — that is a publishing gap in the workflows plugin, not a consumer failure.",
    }];
  }
  for (const workflow of discoverWorkflows(root)) {
    const texts = family(root, workflow).map(read);
    for (const beat of BEATS) {
      if (texts.some(text => text.includes(`${beat}/SKILL.md`))) continue;
      findings.push({
        rule: "beat-adoption", severity: "major", subject: `${workflow} -> ${beat}`,
        detail: `no skill in the ${workflow} family loads ${beat}/SKILL.md`,
        remedy: `load the beat, or add an adapter that does. A hand-rolled equivalent inherits none of the beat's enforcement — for beat-implement that means no writable-path bounds on any task.`,
      });
    }
  }
  return findings;
}

/**
 * A hook file nothing points at is inert, and looks identical to a working one in every other check.
 * This is the v5.106.0 defect exactly: `work-implement-observation.ts` existed, was correct, was
 * tested, and was named by no `hooks.json` entry and no skill frontmatter.
 */
export function checkHookRegistration(root: string): Finding[] {
  const hooksDir = join(root, "hooks");
  if (!existsSync(hooksDir)) return [];
  const referenced = new Set<string>();
  const sources = [read(join(hooksDir, "hooks.json"))];
  for (const name of skillDirs(root)) sources.push(frontmatter(read(join(root, "skills", name, "SKILL.md"))));
  for (const text of sources) {
    for (const match of text.matchAll(/hooks\/([A-Za-z0-9_-]+)\.(?:ts|py)/g)) referenced.add(match[1]);
  }
  const findings: Finding[] = [];
  for (const entry of readdirSync(hooksDir).sort()) {
    if (!/\.(ts|py)$/.test(entry) || entry.startsWith("_")) continue;
    const stem = entry.replace(/\.(ts|py)$/, "");
    if (referenced.has(stem)) continue;
    // A library imported by another hook is not an unwired guard.
    const importedElsewhere = readdirSync(hooksDir)
      .filter(other => other !== entry && /\.(ts|py)$/.test(other))
      .some(other => read(join(hooksDir, other)).includes(`./${stem}`));
    if (importedElsewhere) continue;
    findings.push({
      rule: "hook-registration", severity: "critical", subject: `hooks/${entry}`,
      detail: "no hooks.json entry and no skill frontmatter names this hook, so it never runs",
      remedy: "register it on the matcher it guards, or delete it. An unwired guard is indistinguishable from a working one in every test that only exercises its behaviour.",
    });
  }
  return findings;
}

/**
 * A guard that fails open is a deliberate, usually correct choice — denying on your own bug is worse
 * than not checking. It is only safe when something downstream treats the resulting SILENCE as a
 * failure. Fail-open plus no absence gate is a guard that disappears the moment it breaks, with a run
 * indistinguishable from a clean one.
 */
export function checkFailOpenHasGate(root: string): Finding[] {
  const hooksDir = join(root, "hooks");
  if (!existsSync(hooksDir)) return [];
  // A gate is only evidence if the RUNTIME reaches it. `hooks.json` entries and imports from
  // non-test code count; a bash line in a SKILL.md does not, because that runs only when a model
  // chooses to run it — which is exactly how `beat-implement.js` stayed "invoked" for four months.
  const manifest = read(join(root, "hooks/hooks.json"));
  const importers = existsSync(join(root, "hooks"))
    ? readdirSync(join(root, "hooks")).filter(f => /\.(ts|py)$/.test(f)).map(f => read(join(root, "hooks", f))).join("\n")
    : "";
  const gateSources = existsSync(join(root, "scripts"))
    ? (readdirSync(join(root, "scripts"), { recursive: true } as never) as string[])
        .filter((p): p is string => typeof p === "string" && /gate.*\.(ts|py)$/.test(p))
        .map(p => {
          const stemOf = p.split("/").pop()!.replace(/\.(ts|py)$/, "");
          return {
            path: p,
            text: read(join(root, "scripts", p)),
            runtimeReached: manifest.includes(stemOf) || new RegExp(`import[^\n]*${stemOf}`).test(importers),
          };
        })
    : [];
  const findings: Finding[] = [];
  for (const entry of readdirSync(hooksDir).sort()) {
    if (!/\.(ts|py)$/.test(entry) || entry.startsWith("_")) continue;
    const source = read(join(hooksDir, entry));
    // MECHANISM BEFORE PROSE. `denyOnCrash` is the repo's fail-CLOSED handler, so a hook that installs
    // it does not fail open no matter what its comments say — and comments say it often, because the
    // phrase appears while EXPLAINING the hazard ("a gate that fails open is worse than no gate").
    // Matching prose alone flagged `implementer-identity-gate` and `writing-mechanical-gate`, both of
    // which deny on crash. Two false positives out of three findings, from the same reference-not-
    // mechanism error this probe exists to catch. Checked first, deliberately.
    if (/\bdenyOnCrash\(/.test(source)) continue;
    // A LIBRARY IS NOT AN UNGATED GUARD. `hooks/lineage.ts` is imported by another hook rather than
    // wired to an event; its caller owns the wiring, and its own header already documents that it is
    // monitored telemetry which "does not close" the hole it observes. Skipped for the same reason the
    // registration check skips libraries — consistency here is not cosmetic: applying one rule to
    // modules and another to hooks is how a checker grows findings nobody can act on.
    const isLibrary = readdirSync(hooksDir)
      .filter(other => other !== entry && /\.(ts|py)$/.test(other))
      .some(other => read(join(hooksDir, other)).includes(`./${entry.replace(/\.(ts|py)$/, "")}`));
    if (isLibrary) continue;
    const declaresFailOpen = /fail open|fails open|NEVER denies|never deny/i.test(source);
    if (!declaresFailOpen) continue;
    const stem = entry.replace(/\.(ts|py)$/, "");
    // THE EXEMPTION MUST NAME A MECHANISM THAT RUNS, NOT A FILE THAT MENTIONS THE HOOK.
    //
    // This previously read `gateSources.some(gate => gate.includes(stem))` — a SUBSTRING. So a
    // fail-open hook was excused the moment any gate-shaped file contained its name, and
    // `scripts/beat/implement-gate.ts` contains it twice. That gate has ZERO runtime-reached callers:
    // no hooks.json entry, no import outside its own test, and one bash line inside a SKILL.md Gate
    // section, which runs only if a model chooses to run it. So the rule that exists to catch
    // "correct but never invoked" was exempting a hook on the strength of a gate that is itself
    // correct but never invoked — the class, inside the check for the class.
    //
    // A gate now has to be REACHED BY THE RUNTIME to excuse anything: registered in hooks.json, or
    // imported by something that is. Prose in a skill body does not count, and that distinction is
    // the whole lesson of the week — `beat-implement.js` was "invoked" by skill prose for four months.
    //
    // THE FIRST CLAUSE USED TO BE VACUOUS. It read
    //   `gate.path.includes("implement-gate") || gate.text.includes(stem)`
    // and the left half is true for EVERY stem the moment `scripts/beat/implement-gate.ts` exists, so
    // the conjunction collapsed to its second half and the extra clause only made the rule look
    // stricter than it was. Removed rather than repaired: one condition that does work beats two
    // where one is decorative.
    //
    // HONEST LIMIT, since the note above once claimed more than it delivered: this is still a
    // SUBSTRING test. A runtime-reached gate that merely mentions the hook's name — even in a comment
    // — will exempt it. That was NARROWED by requiring runtime reach, not closed. Closing it needs
    // the gate's actual record-reading path traced to this hook's record, which is a call-graph
    // question this lexical probe cannot answer.
    if (gateSources.some(gate => gate.text.includes(stem) && gate.runtimeReached)) continue;
    findings.push({
      rule: "fail-open-without-gate", severity: "critical", subject: `hooks/${entry}`,
      detail: "declares that it fails open, and no gate that the RUNTIME REACHES treats its silence as failure. A gate file may name it — that is not the test. The gate must be registered in hooks.json or imported by something that is; a bash line in a SKILL.md runs only if a model chooses to run it.",
      remedy: "either give the absence-gate a runtime-reached invocation, or make the hook deny on its own errors. NOTE scripts/beat/implement-gate.ts already implements the refusal correctly and has zero runtime-reached callers — writing the gate was never the missing part.",
    });
  }
  return findings;
}

/**
 * DISCOVERING NOTHING IS A FINDING, NOT A PASS.
 *
 * Pointed at `teaching` — 19 skills, 6 hooks — this probe discovered ZERO workflows and reported
 * "0 findings". That reads as clean and means "nothing was examined", because discovery keyed on
 * `workflows`' own gate names and teaching uses a different one. A checker that returns green when it
 * does not understand its target is worse than no checker: it converts ignorance into reassurance.
 *
 * Same principle as `scripts/beat/implement-gate.ts` treating a missing record as a refusal, applied
 * to the checker itself — which is where it was missing, one release after being written down.
 */
export function checkProbeUnderstoodTarget(root: string): Finding[] {
  const skills = skillDirs(root);
  if (!skills.length) return [];
  if (discoverWorkflows(root).length) return [];
  return [{
    rule: "probe-blind", severity: "critical", subject: root,
    detail: `${skills.length} skill(s) present but no workflow discovered, so every other check ran against an empty set and reported clean`,
    remedy: "teach discoverWorkflows this repo's approval-gate name, or state explicitly that it has no workflows. Do not read this run's other results as evidence of anything.",
  }];
}

export function probeCompliance(root: string): Finding[] {
  const blind = checkProbeUnderstoodTarget(root);
  // Short-circuit deliberately: reporting per-workflow results beside "we found no workflows" invites
  // reading the empty ones as passes.
  if (blind.length) return blind;
  return [...checkHookRegistration(root), ...checkFailOpenHasGate(root), ...checkBeatAdoption(root)];
}

if (import.meta.main) {
  const argv = process.argv;
  const target = argv[argv.indexOf("--target") + 1];
  if (!target || target.startsWith("--")) {
    console.error("compliance-probe requires --target <plugin repo root>");
    process.exit(2);
  }
  const findings = probeCompliance(target);
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ target, findings }, null, 2));
  } else {
    for (const finding of findings) {
      console.log(`${finding.severity.toUpperCase()}  [${finding.rule}] ${finding.subject}\n    ${finding.detail}\n    -> ${finding.remedy}`);
    }
    console.log(`compliance-probe: ${findings.length} finding(s) in ${target}`);
  }
  process.exit(findings.length ? 1 : 0);
}
