#!/usr/bin/env bun
/**
 * Shared PreToolUse-hook shell for the dev/ds plan-executable guards — TypeScript port of
 * hooks/_plan_guard_common.py.
 *
 * Each guard file supplies only its domain config (scripts subdir, parser module name, domain
 * label, deny prose) via `PlanGuardConfig` and calls `run(CONFIG)`.
 *
 * THE PARSER STAYS IN PYTHON ON PURPOSE. `validate_plan` is documented as delegating to "the SAME
 * tolerant parser the domain's compile script uses to emit run.js, so a plan that COMPILES also
 * PASSES this gate". That parser is scripts/<subdir>/<module>.py (itself importing
 * scripts/lib/plan_table_core.py) and is shared with the compile path, so re-implementing it here
 * would fork the source of truth and let a plan compile while the gate rejects it (or worse, the
 * reverse). We shell out to it instead, and reproduce the Python original's failure mode when the
 * import blows up: traceback on stderr, exit 1.
 */

import { existsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { deny } from "./_gate_common.ts";

export type PlanGuardConfig = {
  /** this hook file's own directory (import.meta.dir of the guard) */
  hooksDir: string;
  /** "dev" | "ds" — scripts/<subdir> holds the parser module */
  scriptsSubdir: string;
  /** "dev_plan_table" | "ds_plan_table" */
  parserModule: string;
  /** "Implementation Order" | "Task Breakdown" (for CLI messages) */
  tableLabel: string;
  /** (planPath, violations) -> full deny() reason */
  denyReason: (planPath: string, violations: string[]) => string;
};

/**
 * str(PurePosixPath(p)) — pathlib drops "." components and collapses repeated separators, so
 * "./a//b/" stringifies as "a/b". The deny prose embeds this string, so it has to match.
 */
export function pyPathStr(p: string): string {
  const absolute = p.startsWith("/");
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  const joined = parts.join("/");
  if (absolute) return "/" + joined;
  return joined === "" ? "." : joined;
}

/** str(PurePosixPath(p).parent / name) */
export function pyPathParentJoin(p: string, name: string): string {
  const absolute = p.startsWith("/");
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  parts.pop();
  parts.push(name);
  const joined = parts.join("/");
  return absolute ? "/" + joined : joined;
}

const PARSE_SNIPPET = [
  "import json, sys",
  "sys.path.insert(0, sys.argv[1])",
  'mod = __import__(sys.argv[2], fromlist=["parse_plan"])',
  'print("\\x00PARITY\\x00" + json.dumps(mod.parse_plan(open(sys.argv[3]).read()).violations))',
].join("\n");

/**
 * Return list of human-readable violations ([] == executable).
 *
 * The parser call is deliberately LAZY (done here, not at module load): the PreToolUse matcher
 * fires on every Write/Edit in a session, but only a write to PLAN_REVIEWED.md ever reaches this
 * function — the hundreds of unrelated calls exit early in run() before validatePlan runs.
 */
export function validatePlan(cfg: PlanGuardConfig, planPath: string): string[] {
  if (!(existsSync(planPath) && statSync(planPath).isFile())) {
    return [`PLAN.md not found at ${planPath}`];
  }
  const scriptsDir = `${dirname(cfg.hooksDir)}/scripts/${cfg.scriptsSubdir}`;
  const r = Bun.spawnSync(["uv", "run", "python3", "-c", PARSE_SNIPPET, scriptsDir, cfg.parserModule, planPath]);
  const out = new TextDecoder().decode(r.stdout);
  const marker = out.lastIndexOf("\x00PARITY\x00");
  if (r.exitCode !== 0 || marker < 0) {
    // Mirror the Python original dying on a failed `__import__`: traceback on stderr, exit 1.
    process.stderr.write(new TextDecoder().decode(r.stderr));
    process.exit(r.exitCode === 0 ? 1 : r.exitCode);
  }
  return JSON.parse(out.slice(marker + "\x00PARITY\x00".length).split("\n")[0]);
}

export function run(cfg: PlanGuardConfig, argv: string[], stdinText: () => Promise<string>): Promise<never> {
  return (async () => {
    // Standalone CLI mode: validate a given PLAN.md, print report, exit 0/1.
    if (argv.length > 0 && argv[0] !== "-") {
      const v = validatePlan(cfg, pyPathStr(argv[0]));
      if (v.length) {
        console.log("PLAN NOT EXECUTABLE:\n- " + v.join("\n- "));
        process.exit(1);
      }
      console.log(`PLAN executable: ${cfg.tableLabel} table is complete and the Deps DAG is valid.`);
      process.exit(0);
    }

    // Hook mode.
    let hookInput: Record<string, unknown>;
    try {
      hookInput = JSON.parse(await stdinText());
    } catch {
      process.exit(0);
    }
    const toolName = (hookInput as Record<string, unknown>)?.["tool_name"] ?? "";
    if (toolName !== "Write" && toolName !== "Edit") process.exit(0);
    const toolInput = (hookInput["tool_input"] ?? {}) as Record<string, unknown>;
    const filePath = String(toolInput["file_path"] ?? "");
    if (!filePath || !filePath.endsWith("PLAN_REVIEWED.md")) process.exit(0); // only the approval artifact

    const planPath = pyPathParentJoin(filePath, "PLAN.md");
    const violations = validatePlan(cfg, planPath);
    if (violations.length) deny(cfg.denyReason(planPath, violations));
    process.exit(0);
  })() as Promise<never>;
}
