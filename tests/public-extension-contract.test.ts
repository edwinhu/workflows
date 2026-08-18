import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

const ROOT = realpathSync(join(import.meta.dir, ".."));
const TARGET_VERSION = "6.0.1";

type Capability = {
  name: string;
  contractVersion: number;
  implementation: string;
};

type ContractRow = {
  capability: string;
  descriptorSchema: string;
  contractVersion: string;
  discoveryInput: string;
  successEvidence: string;
  rejectionEvidence: string;
  compatibility: string;
};

const EXPECTED_ROWS: ContractRow[] = [
  {
    capability: "capability-resolver",
    descriptorSchema: "capabilities.json schema 1",
    contractVersion: "1",
    discoveryInput: "Explicit installed dependency root + capability name",
    successEvidence: "ResolvedDependencyCapability",
    rejectionEvidence: "Thrown Error with stable category text",
    compatibility: "Additive within contract 1; breaking changes require a new contract version",
  },
  {
    capability: "constraint-loader",
    descriptorSchema: "No descriptor; LoadConstraintsOptions API schema 1",
    contractVersion: "1",
    discoveryInput: "Explicit constraint directory + skill name; optional marker path",
    successEvidence: "ConstraintLoadResult with ConstraintLoadEvidence",
    rejectionEvidence: "Thrown Error; CLI exits nonzero with Error text",
    compatibility: "API result and existing CLI output remain compatible within contract 1",
  },
  {
    capability: "craft-spine-runner",
    descriptorSchema: "craft:dispatch args: projectDir + planPath + specHash + goal + tasks, run under the Workflow runtime",
    contractVersion: "1",
    discoveryInput: "Explicit projectDir + the plan's canonical craft:dispatch specHash + the approved task list; never discovers planning authority",
    successEvidence: "{ overallPass, verdict, scoreTable, implemented, verified, findings, refutedFindings, reviews, tasksThatFlagged, carriedForward, domainRun } — the gate computed in JS from raw counts",
    rejectionEvidence: "Thrown Error before any agent is dispatched",
    compatibility: "The spec block in the approved plan is the sole authority and its hash is verified by every dispatched agent; the returned gate keys and the fail-closed-on-dead-agent rule remain compatible within contract 1",
  },
];

function parseContractRows(markdown: string): ContractRow[] {
  const marker = "<!-- public-extension-contract-table -->";
  const start = markdown.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const rows = markdown.slice(start + marker.length).split("\n").filter((line) => line.startsWith("| `"));
  return rows.map((line) => {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim().replaceAll("\\|", "|"));
    expect(cells).toHaveLength(7);
    return {
      capability: cells[0].replaceAll("`", ""),
      descriptorSchema: cells[1],
      contractVersion: cells[2].replaceAll("`", ""),
      discoveryInput: cells[3],
      successEvidence: cells[4],
      rejectionEvidence: cells[5],
      compatibility: cells[6],
    };
  });
}

describe("public extension contract integration", () => {
  test("all three plugin version fields and capability identity agree at 6.0.1", () => {
    const plugin = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/plugin.json"), "utf8"));
    const marketplace = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/marketplace.json"), "utf8"));
    const manifest = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/capabilities.json"), "utf8"));

    expect(plugin.version).toBe(TARGET_VERSION);
    expect(marketplace.metadata.version).toBe(TARGET_VERSION);
    expect(marketplace.plugins.find((entry: { name: string }) => entry.name === plugin.name)?.version).toBe(TARGET_VERSION);
    expect(manifest.plugin).toEqual({ name: plugin.name, version: TARGET_VERSION });
  });

  test("advertised capability paths and contract versions match the documented consumer API", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/capabilities.json"), "utf8")) as {
      schemaVersion: number;
      capabilities: Capability[];
    };
    const documentation = readFileSync(join(ROOT, "docs/extension-contracts.md"), "utf8");
    const documentedRows = parseContractRows(documentation);

    expect(manifest.schemaVersion).toBe(1);
    expect(documentedRows).toEqual(EXPECTED_ROWS);
    expect(manifest.capabilities.map(({ name, contractVersion }) => ({ name, contractVersion }))).toEqual(
      EXPECTED_ROWS.map(({ capability, contractVersion }) => ({ name: capability, contractVersion: Number(contractVersion) })),
    );
    for (const capability of manifest.capabilities) {
      expect(capability.implementation.startsWith("/")).toBe(false);
      expect(capability.implementation.split("/")).not.toContain("..");
      expect(existsSync(join(ROOT, capability.implementation))).toBe(true);
    }
  });

  test("a published capability is safe for the way it is actually consumed", () => {
    // TWO CONSUMPTION MODES SHARE ONE MANIFEST, AND THEY HAVE DIFFERENT SAFETY PROPERTIES.
    //
    // A MODULE capability is reached by `import(implementationPath)` — literally what
    // a consumer's native workflow adapter does. Importing it must not DO anything.
    // Measured 2026-08-06: `beat-spine-args` shipped in v5.144.0 with no `import.meta.main` guard,
    // so importing it read the consumer's argv, found no --workflow, and called `process.exit(2)` —
    // terminating the consuming process on import. Published and unusable by its only mechanism.
    //
    // A WORKFLOW SCRIPT capability is reached by `Workflow({scriptPath})`. Its top-level `phase()`,
    // `agent()` and `args` exist only inside the Workflow runtime, so importing one THROWS by
    // construction and an import-safety assertion on it is simply the wrong question. What it owes
    // instead is that it parses — a syntax error there fails inside a dispatched episode.
    //
    // The kind is derived from the path rather than declared, because `capabilities.json` is a
    // published schema-1 surface and adding a field to it is a change to somebody else's contract.
    const manifest = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/capabilities.json"), "utf8")) as {
      capabilities: Capability[];
    };
    let modules = 0;
    let scripts = 0;
    for (const capability of manifest.capabilities) {
      const absolute = join(ROOT, capability.implementation);
      const isWorkflowScript = capability.implementation.endsWith(".js");
      // Each probe runs in its own subprocess: the failure mode under test is EXITING, and an
      // in-process import would take this runner down with it rather than failing an assertion.
      const probe = isWorkflowScript
        ? Bun.spawnSync(["node", "--check", absolute], { stdout: "pipe", stderr: "pipe" })
        : Bun.spawnSync(["bun", "-e", `await import(${JSON.stringify(absolute)}); process.stdout.write("OK");`], { stdout: "pipe", stderr: "pipe" });
      if (isWorkflowScript) scripts += 1; else modules += 1;
      expect(`${capability.name}: exit ${probe.exitCode}`).toBe(`${capability.name}: exit 0`);
      if (!isWorkflowScript) {
        expect(`${capability.name}: ${new TextDecoder().decode(probe.stdout)}`).toBe(`${capability.name}: OK`);
      }
    }
    // Both kinds must actually be present, or this test silently stops covering one of them.
    expect(modules).toBeGreaterThan(0);
    expect(scripts).toBeGreaterThan(0);
  });

  test("publishes a PATH broker for the exact installed dependency root", () => {
    const broker = join(ROOT, "bin/workflows-capability-root");
    expect(existsSync(broker)).toBe(true);
    const result = Bun.spawnSync([broker], { stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");
    expect(result.stdout.toString().trim()).toBe(ROOT);
  });

  test("ships without ignored planning files as public contract authority", () => {
    const documentation = readFileSync(join(ROOT, "docs/extension-contracts.md"), "utf8");
    // A gitignored scratch path can never be a public consumer's authority.
    expect(documentation).not.toContain(".planning/STAGE1_EVIDENCE.md");
    expect(documentation).not.toContain(".claude/plans/");
    // The two facts a craft-spine-runner consumer cannot discover for itself.
    expect(documentation).toContain("specHash");
    expect(documentation).toContain("overallPass");
    // Retired names must stay documented as retired, so a consumer of one learns why it broke.
    for (const retired of ["beat-spine-runner", "approved-artifact-policy", "tasklist-reconciler"]) {
      expect(documentation).toContain(retired);
    }
  });
});
