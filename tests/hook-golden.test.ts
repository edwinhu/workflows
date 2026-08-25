import { expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

// Every hook still behaves as recorded. When a change to a hook is intended, re-record with
// `bun scripts/hook-golden.ts --all --record` and read the golden diff — that diff is the review.
test("every hook matches its recorded golden", async () => {
  const proc = Bun.spawn(["bun", "scripts/hook-golden.ts", "--all", "--quiet"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(`${stdout}${stderr}`.trim() + `\nexit=${exit}`).toContain("exit=0");
}, 600_000);
