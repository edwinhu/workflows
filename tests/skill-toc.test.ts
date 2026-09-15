import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const TOC = join(import.meta.dir, "..", "bin", "skill-toc");
const run = (...a: string[]) => {
  const r = spawnSync("python3", [TOC, ...a], { encoding: "utf8" });
  return { code: r.status ?? -1, out: r.stdout + r.stderr };
};

function skill(build: (d: string) => void): string {
  const d = mkdtempSync(join(tmpdir(), "skilltoc-"));
  build(d);
  return d;
}

test("references list the H1 and every H2, because a filename routes badly", () => {
  const d = skill((d) => {
    mkdirSync(join(d, "references"));
    writeFileSync(join(d, "references/api.md"), "# The API\n\n## Rate limits\n\ntext\n\n## Errors\n");
  });
  try {
    const r = run(d, "refs");
    expect(r.code).toBe(0);
    expect(r.out).toContain("- api.md — The API");
    expect(r.out).toContain("Rate limits · Errors");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// Every one of these is line 1 of a real script in this tree, and each was read back as a
// summary by an earlier sed-based version.
test("machinery is never mistaken for a summary", () => {
  const cases: [string, string][] = [
    ["a.sh", '#!/usr/bin/env bash\nset -euo pipefail\nSCRIPT_DIR="$(pwd)"\n'],
    ["b.py", '#!/usr/bin/env python3\n# /// script\n# requires-python = ">=3.10"\n# ///\nimport sys\n'],
    ["c.ts", "// eslint-disable-next-line\nconst x = 1;\n"],
  ];
  const d = skill((d) => {
    mkdirSync(join(d, "scripts"));
    for (const [n, body] of cases) writeFileSync(join(d, "scripts", n), body);
  });
  try {
    const r = run(d, "scripts");
    expect(r.code).toBe(0);
    for (const [n] of cases) expect(r.out).toContain(`- ${n} — NO SUMMARY LINE`);
    expect(r.out).not.toContain("set -euo");
    expect(r.out).not.toContain("requires-python");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("a real header comment IS the summary, past a shebang or a PEP 723 block", () => {
  const d = skill((d) => {
    mkdirSync(join(d, "scripts"));
    writeFileSync(join(d, "scripts/a.sh"), "#!/usr/bin/env bash\n# Does the thing to the stuff.\nset -e\n");
    writeFileSync(join(d, "scripts/b.py"), '#!/usr/bin/env python3\n# /// script\n# requires-python = ">=3.10"\n# ///\n"""Analyse media files."""\n');
  });
  try {
    const r = run(d, "scripts");
    expect(r.out).toContain("- a.sh — Does the thing to the stuff.");
    expect(r.out).toContain("- b.py — Analyse media files.");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// A bang command exiting 1 is TOLERATED by the parser, so an empty listing would load the
// skill reading as "this skill has no references". Only 2 aborts.
test("nothing to index is exit 2, never a clean empty listing", () => {
  const d = skill(() => {});
  try {
    expect(run(d).code).toBe(2);
    expect(run(d, "refs").code).toBe(2);
    expect(run(join(d, "nope")).code).toBe(2);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("no argument is usage, exit 2", () => {
  expect(run().code).toBe(2);
});
