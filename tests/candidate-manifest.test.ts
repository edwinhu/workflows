import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  captureCandidate,
  digestCandidateManifest,
  parseCandidateManifest,
  serializeCandidateManifest,
} from "../workflows/lib/candidate-manifest";

const roots: string[] = [];
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function git(root: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "candidate-manifest-"));
  roots.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "Test User");
  writeFileSync(join(root, "changed.txt"), "base\n");
  writeFileSync(join(root, "deleted.txt"), "delete me\n");
  writeFileSync(join(root, "staged-deleted.txt"), "staged delete\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "base");
  return root;
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("canonical immutable candidate capture", () => {
  test("captures deterministic distinct index, worktree, untracked, deleted, symlink, and binary representations", () => {
    const root = repo();
    writeFileSync(join(root, "changed.txt"), "index\n");
    git(root, "add", "changed.txt");
    writeFileSync(join(root, "changed.txt"), "worktree\n");
    rmSync(join(root, "deleted.txt"));
    git(root, "rm", "-q", "staged-deleted.txt");
    writeFileSync(join(root, "untracked.txt"), "untracked\n");
    mkdirSync(join(root, "links"));
    symlinkSync("../changed.txt", join(root, "links", "current"));
    writeFileSync(join(root, "binary.bin"), Buffer.from([0, 255, 1, 2]));

    const binaryDigest = sha256(Buffer.from([0, 255, 1, 2]));
    const first = captureCandidate({
      repositoryRoot: root,
      baseRef: "HEAD",
      capturedAt: "2026-07-30T12:00:00.000Z",
      exclusions: [{ path: "untracked.txt", representation: "worktree", rationale: "preserved unrelated state" }],
      binaryInventory: [{ path: "binary.bin", representation: "worktree", digest: binaryDigest, disposition: "preserve" }],
    });
    const second = captureCandidate({
      repositoryRoot: root,
      baseRef: "HEAD",
      capturedAt: "2026-07-30T13:00:00.000Z",
      exclusions: [{ path: "untracked.txt", representation: "worktree", rationale: "preserved unrelated state" }],
      binaryInventory: [{ path: "binary.bin", representation: "worktree", digest: binaryDigest, disposition: "preserve" }],
    });

    expect(first.manifest.entries.map(({ path, representation, state }) => `${path}:${representation}:${state}`)).toEqual([
      "binary.bin:worktree:present",
      "changed.txt:index:present",
      "changed.txt:worktree:present",
      "deleted.txt:index:present",
      "deleted.txt:worktree:deleted",
      "links/current:worktree:present",
      "staged-deleted.txt:index:deleted",
      "staged-deleted.txt:worktree:deleted",
      "untracked.txt:worktree:present",
    ]);
    expect(first.manifest.entries.find((e) => e.path === "changed.txt" && e.representation === "index")?.digest).toBe(sha256(Buffer.from("index\n")));
    expect(first.manifest.entries.find((e) => e.path === "changed.txt" && e.representation === "worktree")?.digest).toBe(sha256(Buffer.from("worktree\n")));
    expect(first.manifest.entries.find((e) => e.path === "links/current")?.kind).toBe("symlink");
    expect(first.manifest.entries.find((e) => e.path === "deleted.txt" && e.representation === "worktree")?.byteLength).toBe(0);
    expect(first.manifest.binaryInventory).toEqual([{ path: "binary.bin", representation: "worktree", digest: binaryDigest, disposition: "preserve" }]);
    expect(first.manifest.exclusions[0]?.digest).toBe(sha256(Buffer.from("untracked\n")));
    expect(digestCandidateManifest(first.manifest)).toBe(digestCandidateManifest(second.manifest));
    expect(serializeCandidateManifest(first.manifest)).toEqual(serializeCandidateManifest(second.manifest));
    expect(first.capturedAt).not.toBe(second.capturedAt);
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
        const outside = mkdtempSync(join(tmpdir(), "candidate-outside-"));
        roots.push(outside);
        writeFileSync(join(outside, "child.txt"), "escaped externally\n");
        symlinkSync(outside, join(root, "parent"));
      } else {
        symlinkSync("missing", join(root, "parent"));
      }

      expect(() => captureCandidate({ repositoryRoot: root, baseRef: "HEAD" })).toThrow(/symlink ancestor/i);
    }
  });

  test("preserves final symlink payloads and captures normal files", () => {
    const root = repo();
    writeFileSync(join(root, "normal.txt"), "normal bytes\n");
    symlinkSync("normal.txt", join(root, "final-link"));

    const capture = captureCandidate({ repositoryRoot: root, baseRef: "HEAD" });

    expect(Buffer.from(capture.bytes("normal.txt", "worktree")).toString()).toBe("normal bytes\n");
    expect(Buffer.from(capture.bytes("final-link", "worktree")).toString()).toBe("normal.txt");
    expect(capture.manifest.entries.find((entry) => entry.path === "final-link")?.kind).toBe("symlink");
  });

  test("defensively owns input and output bytes", () => {
    const root = repo();
    writeFileSync(join(root, "owned.txt"), "original");
    const capture = captureCandidate({ repositoryRoot: root, baseRef: "HEAD", capturedAt: "2026-07-30T12:00:00.000Z" });
    const before = capture.bytes("owned.txt", "worktree");
    before[0] = 0;
    expect(Buffer.from(capture.bytes("owned.txt", "worktree")).toString()).toBe("original");
    expect(() => (capture.manifest.entries as unknown as Array<unknown>).push({})).toThrow();
  });

  test("fails closed on missing binary dispositions and digest or exclusion mismatches", () => {
    const root = repo();
    writeFileSync(join(root, "opaque.bin"), Buffer.from([0, 1, 2]));
    expect(() => captureCandidate({ repositoryRoot: root, baseRef: "HEAD" })).toThrow(/binary inventory/i);
    expect(() => captureCandidate({
      repositoryRoot: root,
      baseRef: "HEAD",
      binaryInventory: [{ path: "opaque.bin", representation: "worktree", digest: "0".repeat(64), disposition: "preserve" }],
    })).toThrow(/digest/i);
    expect(() => captureCandidate({
      repositoryRoot: root,
      baseRef: "HEAD",
      exclusions: [{ path: "missing.bin", representation: "worktree", rationale: "unrelated" }],
      binaryInventory: [{ path: "opaque.bin", representation: "worktree", digest: sha256(Buffer.from([0, 1, 2])), disposition: "preserve" }],
    })).toThrow(/exclusion/i);
  });

  test("fails closed on a non-UTF-8 Git pathname in a real repository", () => {
    const root = repo();
    const rawPath = Buffer.concat([Buffer.from(`${root}/invalid-`), Buffer.from([0xff])]);
    writeFileSync(rawPath, "invalid path bytes");
    git(root, "add", "-A");

    expect(() => captureCandidate({ repositoryRoot: root, baseRef: "HEAD" })).toThrow(/UTF-8 Git pathname/i);
  });

  test("uses a bounded number of Git subprocesses independently of candidate path count", () => {
    const root = repo();
    for (let index = 0; index < 40; index += 1) writeFileSync(join(root, `many-${index}.txt`), `value ${index}\n`);
    const original = Bun.spawnSync;
    let gitSpawns = 0;
    Bun.spawnSync = ((command: Parameters<typeof Bun.spawnSync>[0], options?: Parameters<typeof Bun.spawnSync>[1]) => {
      if (Array.isArray(command) && command[0] === "git") gitSpawns += 1;
      return original(command, options as never);
    }) as typeof Bun.spawnSync;
    try {
      captureCandidate({ repositoryRoot: root, baseRef: "HEAD" });
    } finally {
      Bun.spawnSync = original;
    }
    expect(gitSpawns).toBeLessThanOrEqual(10);
  });

  test("strict parsing rejects unknown fields, duplicates, traversal, ambiguous encodings, and case collisions", () => {
    const root = repo();
    writeFileSync(join(root, "new.txt"), "new");
    const capture = captureCandidate({ repositoryRoot: root, baseRef: "HEAD" });
    const json = JSON.parse(Buffer.from(serializeCandidateManifest(capture.manifest)).toString("utf8"));

    expect(() => parseCandidateManifest({ ...json, surprise: true })).toThrow(/unknown/i);
    expect(() => parseCandidateManifest({ ...json, entries: [...json.entries, json.entries[0]] })).toThrow(/duplicate/i);
    expect(() => parseCandidateManifest({ ...json, entries: [{ ...json.entries[0], path: "../escape" }, ...json.entries.slice(1)] })).toThrow(/path/i);
    expect(() => parseCandidateManifest({ ...json, entries: [{ ...json.entries[0], path: "bad%2fpath" }, ...json.entries.slice(1)] })).toThrow(/encoding/i);
    expect(() => parseCandidateManifest({ ...json, entries: [{ ...json.entries[0], path: "NEW.txt" }, ...json.entries] })).toThrow(/case collision/i);
  });
});
