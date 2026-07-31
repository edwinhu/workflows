import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConstraints } from "../scripts/load-constraints";

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "constraint-loader-"));
  temporaryRoots.push(root);
  return root;
}

function writeConstraint(root: string, name: string, appliesTo: string, body: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, `${name}.md`),
    `---\nname: ${name}\napplies-to: [${appliesTo}]\n---\n${body}\n`,
  );
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("loadConstraints public capability", () => {
  test("loads an external constraint directory with exact matching, deterministic output, and marker evidence", () => {
    const root = temporaryRoot();
    const constraintsDir = join(root, "constraints");
    const markerPath = join(root, "state", "loaded.json");
    writeConstraint(constraintsDir, "z-last", "opaque-skill", "Last body.");
    writeConstraint(constraintsDir, "a-first", "opaque-skill", "First body.");
    writeConstraint(constraintsDir, "near-miss", "opaque-skill-extra", "Must not load.");

    const result = loadConstraints({ constraintsDir, skillName: "opaque-skill", markerPath });

    expect(result.output).toBe(
      "# Loaded 2 constraints for opaque-skill (1 skipped)\n" +
        "# Constraint: a-first\nFirst body.\n\n" +
        "# Constraint: z-last\nLast body.\n",
    );
    expect(result.evidence).toEqual({
      skill: "opaque-skill",
      matched: 2,
      skipped: 1,
      constraints: ["a-first.md", "z-last.md"],
      markerPath,
      markerWritten: true,
    });
    expect(JSON.parse(readFileSync(markerPath, "utf8"))).toEqual(result.evidence);
  });

  test("rejects a constraint file whose canonical path escapes the supplied directory", () => {
    const root = temporaryRoot();
    const constraintsDir = join(root, "constraints");
    const outside = temporaryRoot();
    mkdirSync(constraintsDir, { recursive: true });
    writeConstraint(outside, "escaped", "opaque-skill", "Outside body.");
    symlinkSync(join(outside, "escaped.md"), join(constraintsDir, "escaped.md"));

    expect(() =>
      loadConstraints({
        constraintsDir,
        skillName: "opaque-skill",
        markerPath: join(root, "loaded.json"),
      }),
    ).toThrow(/outside canonical constraint root/i);
  });
});
