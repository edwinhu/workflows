import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureGitObservation, compareGitObservations } from "../workflows/lib/git-observation";

const roots: string[] = [];
function git(root: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "git-observation-"));
  roots.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "Test User");
  writeFileSync(join(root, "tracked.txt"), "base\n");
  writeFileSync(join(root, "deleted.txt"), "delete\n");
  writeFileSync(join(root, "mode.txt"), "mode\n");
  git(root, "add", "."); git(root, "commit", "-qm", "base");
  return root;
}
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

describe("Git-backed boundary observations", () => {
  test("fails closed on a non-UTF-8 Git pathname in a real repository", () => {
    const root = repo();
    const rawPath = Buffer.concat([Buffer.from(`${root}/invalid-`), Buffer.from([0xff])]);
    writeFileSync(rawPath, "invalid path bytes");
    git(root, "add", "-A");

    expect(() => captureGitObservation(root)).toThrow(/UTF-8 Git pathname/i);
  });

  test("rejects internal, external, and dangling symlink ancestors in a real repository", () => {
    for (const target of ["internal", "external", "dangling"] as const) {
      const root = repo();
      mkdirSync(join(root, "parent"));
      writeFileSync(join(root, "parent", "child.txt"), "tracked\n");
      git(root, "add", "parent/child.txt");
      git(root, "commit", "-qm", `add ${target} parent`);
      rmSync(join(root, "parent"), { recursive: true });

      if (target === "internal") {
        mkdirSync(join(root, "actual"));
        writeFileSync(join(root, "actual", "child.txt"), "escaped internally\n");
        symlinkSync("actual", join(root, "parent"));
      } else if (target === "external") {
        const outside = mkdtempSync(join(tmpdir(), "observation-outside-"));
        roots.push(outside);
        writeFileSync(join(outside, "child.txt"), "escaped externally\n");
        symlinkSync(outside, join(root, "parent"));
      } else {
        symlinkSync("missing", join(root, "parent"));
      }

      expect(() => captureGitObservation(root)).toThrow(/symlink ancestor/i);
    }
  });

  test("preserves final symlink payloads and captures normal files", () => {
    const root = repo();
    writeFileSync(join(root, "normal.txt"), "normal bytes\n");
    symlinkSync("normal.txt", join(root, "final-link"));

    const observation = captureGitObservation(root);
    const normalDigest = observation.entries.find((entry) => entry.path === "normal.txt")?.contentDigest;
    const link = observation.entries.find((entry) => entry.path === "final-link");

    expect(normalDigest).toBe(createHash("sha256").update("normal bytes\n").digest("hex"));
    expect(link?.contentDigest).toBe(createHash("sha256").update("normal.txt").digest("hex"));
    expect(link?.kind).toBe("symlink");
  });

  test("uses a bounded number of Git subprocesses independently of changed path count", () => {
    const root = repo();
    for (let index = 0; index < 40; index += 1) writeFileSync(join(root, `many-${index}.txt`), `value ${index}\n`);
    const original = Bun.spawnSync;
    let gitSpawns = 0;
    Bun.spawnSync = ((command: Parameters<typeof Bun.spawnSync>[0], options?: Parameters<typeof Bun.spawnSync>[1]) => {
      if (Array.isArray(command) && command[0] === "git") gitSpawns += 1;
      return original(command, options as never);
    }) as typeof Bun.spawnSync;
    try {
      captureGitObservation(root);
    } finally {
      Bun.spawnSync = original;
    }
    expect(gitSpawns).toBeLessThanOrEqual(10);
  });

  test("captures and compares staged, unstaged, untracked, deleted, mode, binary, and symlink representations", () => {
    const root = repo();
    const pre = captureGitObservation(root);
    writeFileSync(join(root, "tracked.txt"), "staged\n"); git(root, "add", "tracked.txt");
    writeFileSync(join(root, "tracked.txt"), "unstaged\n");
    writeFileSync(join(root, "new.txt"), "new\n");
    unlinkSync(join(root, "deleted.txt"));
    chmodSync(join(root, "mode.txt"), 0o755);
    writeFileSync(join(root, "binary.bin"), Buffer.from([0, 255, 1]));
    symlinkSync("tracked.txt", join(root, "link"));
    const post = captureGitObservation(root);
    const delta = compareGitObservations(pre, post);

    expect(pre.digest).not.toBe(post.digest);
    expect(delta.preDigest).toBe(pre.digest);
    expect(delta.postDigest).toBe(post.digest);
    expect(delta.changedPaths).toEqual(["binary.bin", "deleted.txt", "link", "mode.txt", "new.txt", "tracked.txt"]);
    expect(post.entries.find(e => e.path === "tracked.txt" && e.representation === "index")?.contentDigest)
      .not.toBe(post.entries.find(e => e.path === "tracked.txt" && e.representation === "worktree")?.contentDigest);
    expect(post.entries.find(e => e.path === "deleted.txt" && e.representation === "worktree")?.state).toBe("deleted");
    expect(post.entries.find(e => e.path === "mode.txt" && e.representation === "worktree")?.executable).toBe(true);
    expect(post.entries.find(e => e.path === "binary.bin")?.binary).toBe(true);
    expect(post.entries.find(e => e.path === "link")?.kind).toBe("symlink");
    expect(post.limitations).toContain("transient paths created and removed entirely between captures are not observed");
  });
});
