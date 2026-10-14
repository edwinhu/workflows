import { expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = dirname(import.meta.dir);
const CHECK = join(ROOT, "skills/workflow-creator/scripts/check.sh");

// gate-vacuity.test.ts proves a gate CAN fail on a scaffolded copy, and compares the copy to the real
// tree's verdict rather than to 0, so a real tree that is red passes it. These two skills' own gates
// are not in workflow-audit's population, so nothing else ran them over the real tree.
for (const skill of ["plugin-creator", "skill-creator"]) {
  test(`${skill}'s own gate is green on the checked-in tree`, () => {
    const r = spawnSync("bash", [CHECK, "--target", join("skills", skill)], {
      cwd: ROOT, encoding: "utf8", timeout: 240_000,
    });
    const legs = (r.stdout + r.stderr).split("\n").filter((l) => /^leg \S+ exit=[1-9]/.test(l));
    expect({ status: r.status, failedLegs: legs }).toEqual({ status: 0, failedLegs: [] });
  }, 250_000);
}
