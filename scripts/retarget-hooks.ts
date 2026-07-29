#!/usr/bin/env bun
/**
 * Retarget hook wirings from the Python originals to their TypeScript ports.
 *
 *   uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/x.py   ->   bun ${CLAUDE_PLUGIN_ROOT}/hooks/x.ts
 *
 * Covers `hooks/hooks.json` and every `skills/*​/SKILL.md` frontmatter.
 *
 * SAFETY — this refuses to retarget a hook that has no verified port.
 *   A wiring pointed at a .ts that does not exist is a hook that silently never runs. Worse, per
 *   this repo's enforcement checklist, a gate that fails to execute does not fail loudly: its deny
 *   never fires and the guard is simply gone. So every rewrite requires BOTH:
 *     1. hooks/<name>.ts exists, and
 *     2. tests/golden/<name>.json exists (i.e. it has a behavioral spec that parity can check)
 *   Anything else is reported and left pointing at Python. Mixed states are fine and expected
 *   mid-migration — a half-retargeted repo still works, because each wiring is independent.
 *
 * Usage:
 *   bun scripts/retarget-hooks.ts            # dry run: report only, change nothing
 *   bun scripts/retarget-hooks.ts --apply    # rewrite in place
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const APPLY = process.argv.includes("--apply");

const PATTERN = /uv run python3 (\$\{CLAUDE_(?:PLUGIN_ROOT|SKILL_DIR)\}[^\s"'`]*?\/hooks\/)([a-z0-9-]+)\.py/g;

function portReady(hook: string): { ok: boolean; why: string } {
  const ts = existsSync(join(REPO, "hooks", `${hook}.ts`));
  const golden = existsSync(join(REPO, "tests", "golden", `${hook}.json`));
  if (!ts) return { ok: false, why: "no .ts port" };
  if (!golden) return { ok: false, why: "no golden — port is unverifiable" };
  return { ok: true, why: "" };
}

const targets: string[] = [join(REPO, "hooks", "hooks.json")];
for (const d of readdirSync(join(REPO, "skills"))) {
  const p = join(REPO, "skills", d, "SKILL.md");
  if (existsSync(p)) targets.push(p);
}

let rewrote = 0;
let held = 0;
const heldDetail: string[] = [];

for (const file of targets) {
  const before = readFileSync(file, "utf8");
  let changedHere = 0;
  const after = before.replace(PATTERN, (whole, prefix: string, hook: string) => {
    const { ok, why } = portReady(hook);
    if (!ok) {
      held++;
      heldDetail.push(`  hold  ${hook.padEnd(30)} ${why}  (${file.slice(REPO.length + 1)})`);
      return whole;
    }
    changedHere++;
    return `bun ${prefix}${hook}.ts`;
  });

  if (changedHere) {
    rewrote += changedHere;
    if (APPLY) writeFileSync(file, after);
    console.log(`  ${APPLY ? "rewrote" : "would rewrite"} ${String(changedHere).padStart(2)}  ${file.slice(REPO.length + 1)}`);
  }
}

if (heldDetail.length) {
  console.log("\nheld back (still pointing at Python):");
  for (const l of [...new Set(heldDetail)]) console.log(l);
}

console.log(
  `\n${APPLY ? "retargeted" : "would retarget"} ${rewrote} wiring${rewrote === 1 ? "" : "s"}, held ${held}` +
    (APPLY ? "" : "   — re-run with --apply to write"),
);
