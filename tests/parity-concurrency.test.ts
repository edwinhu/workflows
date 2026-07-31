import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

test("concurrent parity invocations use distinct process-local extraction roots and clean them", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "parity-concurrency-test-"));
  const binDir = join(tempRoot, "bin");
  mkdirSync(binDir);
  const uvShim = join(binDir, "uv");
  writeFileSync(
    uvShim,
    "#!/bin/sh\nprintf '%s\\n' \"$3\" >> \"$PARITY_TEST_LOG\"\nexec \"$REAL_UV\" \"$@\"\n",
  );
  chmodSync(uvShim, 0o755);

  const realUv = Bun.which("uv");
  expect(realUv).not.toBeNull();

  try {
    const commands = ["image-read-guard", "pattern-scan"].map((hook, index) =>
      Bun.spawn(["bun", "scripts/parity.ts", hook], {
        cwd: root,
        env: {
          ...process.env,
          TMPDIR: tempRoot,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
          REAL_UV: realUv!,
          PARITY_TEST_LOG: join(tempRoot, `process-${index}.log`),
        },
        stdout: "pipe",
        stderr: "pipe",
      })
    );
    const results = await Promise.all(commands.map(async (process) => ({
      exit: await process.exited,
      stdout: await new Response(process.stdout).text(),
      stderr: await new Response(process.stderr).text(),
    })));

    expect(results).toEqual(results.map((result) => expect.objectContaining({ exit: 0 })));

    const extractionRoots = [0, 1].map((index) => {
      const pythonPath = readFileSync(join(tempRoot, `process-${index}.log`), "utf8").trim().split("\n")[0]!;
      return resolve(pythonPath, "..", "..");
    });
    expect(extractionRoots[0]).not.toBe(extractionRoots[1]);
    expect(readdirSync(tempRoot).sort()).toEqual(["bin", "process-0.log", "process-1.log"]);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
