// `bun test` globs only *.test.{ts,mjs,js}, so a *.test.sh beside them is run by nothing —
// tests/teammate-idle-report-check.test.sh (29 assertions) sat unrun for exactly that reason.
// This wrapper is a GLOB, not a list, so the next shell suite is gated without an edit here.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const TESTS_DIR = import.meta.dir;
const suites = readdirSync(TESTS_DIR)
  .filter((f) => f.endsWith(".test.sh"))
  .sort();

describe("shell suites under tests/", () => {
  test("at least one shell suite is discovered", () => {
    // A glob that matches nothing passes silently; this is the check that it looked.
    expect(suites.length).toBeGreaterThan(0);
  });

  for (const suite of suites) {
    test(
      suite,
      () => {
        const r = spawnSync("bash", [join(TESTS_DIR, suite)], {
          encoding: "utf8",
          timeout: 300_000,
        });
        if (r.status !== 0) {
          throw new Error(
            `${suite} exited ${r.status}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`,
          );
        }
      },
      300_000,
    );
  }
});
