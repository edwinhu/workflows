import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureWorktreePath, type CapturedWorktreePath } from "../workflows/lib/worktree-capture";

const roots: string[] = [];
function root(): string {
  const created = mkdtempSync(join(tmpdir(), "worktree-capture-"));
  roots.push(created);
  return created;
}
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
function attempt(fn: () => CapturedWorktreePath | undefined): { captured?: CapturedWorktreePath; error?: unknown } {
  try { return { captured: fn() }; } catch (error) { return { error }; }
}

describe("worktree leaf capture", () => {
  test("captures regular, executable, and symlink leaves with no options supplied", () => {
    const dir = root();
    mkdirSync(join(dir, "nested"));
    writeFileSync(join(dir, "nested", "plain.txt"), "plain\n");
    writeFileSync(join(dir, "nested", "run.sh"), "#!/bin/sh\n");
    chmodSync(join(dir, "nested", "run.sh"), 0o755);
    symlinkSync("plain.txt", join(dir, "nested", "link"));

    const plain = captureWorktreePath(dir, "nested/plain.txt")!;
    expect(plain).toEqual({ kind: "regular", executable: false, bytes: new TextEncoder().encode("plain\n") });
    expect(captureWorktreePath(dir, "nested/run.sh")!.executable).toBe(true);
    const link = captureWorktreePath(dir, "nested/link")!;
    expect(link.kind).toBe("symlink");
    expect(text(link.bytes)).toBe("plain.txt");
    expect(captureWorktreePath(dir, "nested/absent.txt")).toBeUndefined();
  });

  test("rejects symlink and non-directory ancestors", () => {
    const dir = root();
    mkdirSync(join(dir, "actual"));
    writeFileSync(join(dir, "actual", "child.txt"), "child\n");
    symlinkSync("actual", join(dir, "parent"));
    writeFileSync(join(dir, "file"), "file\n");

    expect(() => captureWorktreePath(dir, "parent/child.txt")).toThrow(/symlink ancestor/i);
    expect(() => captureWorktreePath(dir, "file/child.txt")).toThrow(/non-directory ancestor/i);
  });

  // THE CHECK-TO-USE WINDOW ON THE LEAF.
  //
  // captureWorktreePath used to decide "regular file" from an lstat, then realpath the same NAME,
  // then readFileSync that name — three lookups. Replacing the name with a symlink to a DIFFERENT
  // IN-REPO file in between passed containment (the target is inside the root) and recorded the
  // other file's bytes under this path, wearing the vanished file's kind and mode bits.
  //
  // The assertion that matters here is the BYTES one, not the error one: an implementation that
  // reports some other error still fails this test if it recorded decoy.txt's contents, which is the
  // consequence the pin exists to prevent. `beforeOpen` fires inside the window itself, so no source
  // rewriting is involved and the seam cannot rot the way a String.replace seam did.
  test("never records a substituted in-repo file's bytes when the leaf is relinked before the open", () => {
    const dir = root();
    writeFileSync(join(dir, "victim.txt"), "victim\n");
    writeFileSync(join(dir, "decoy.txt"), "decoy!\n");

    let swapped = false;
    const { captured, error } = attempt(() => captureWorktreePath(dir, "victim.txt", {
      beforeOpen(path) {
        if (swapped) return;
        swapped = true;
        unlinkSync(path);
        symlinkSync("decoy.txt", path);
      },
    }));

    expect(swapped).toBe(true);
    expect(captured && text(captured.bytes)).not.toBe("decoy!\n");
    expect(captured?.kind).not.toBe("regular");
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/changed while capturing/i);
  });

  // The same swap on the far side of the open. The descriptor already pins the honest inode, so the
  // bytes read are still the victim's — the failure this catches is recording them under a NAME that
  // no longer denotes them.
  test("reports a leaf renamed out from under the open descriptor", () => {
    const dir = root();
    writeFileSync(join(dir, "victim.txt"), "victim\n");
    writeFileSync(join(dir, "decoy.txt"), "decoy!\n");

    let swapped = false;
    const { captured, error } = attempt(() => captureWorktreePath(dir, "victim.txt", {
      afterOpen(path) {
        if (swapped) return;
        swapped = true;
        renameSync(join(dir, "decoy.txt"), path);
      },
    }));

    expect(swapped).toBe(true);
    expect(captured && text(captured.bytes)).not.toBe("decoy!\n");
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/changed while capturing/i);
  });

  // Non-Linux takes the pathname branch for containment. Forcing it here keeps that half honest on a
  // Linux CI box, where /proc/self/fd otherwise hides a regression in it.
  test("pins the leaf on the pathname-fallback containment branch too", () => {
    const dir = root();
    writeFileSync(join(dir, "victim.txt"), "victim\n");
    writeFileSync(join(dir, "decoy.txt"), "decoy!\n");

    let swapped = false;
    const { captured, error } = attempt(() => captureWorktreePath(dir, "victim.txt", {
      forcePathnameFallback: true,
      beforeOpen(path) {
        if (swapped) return;
        swapped = true;
        unlinkSync(path);
        symlinkSync("decoy.txt", path);
      },
    }));

    expect(swapped).toBe(true);
    expect(captured && text(captured.bytes)).not.toBe("decoy!\n");
    expect(error).toBeInstanceOf(Error);
  });

  test("a leaf deleted inside the window is missing, not an error", () => {
    const dir = root();
    writeFileSync(join(dir, "victim.txt"), "victim\n");

    const captured = captureWorktreePath(dir, "victim.txt", { beforeOpen: (path) => unlinkSync(path) });
    expect(captured).toBeUndefined();
  });

  // Dropping O_NOFOLLOW is exactly the pre-fix behaviour, so this states what that costs: the open
  // follows the substituted link, and the remaining identity checks are what stop the decoy bytes
  // from being returned.
  test("without O_NOFOLLOW the substituted link is still not recorded as this path's content", () => {
    const dir = root();
    writeFileSync(join(dir, "victim.txt"), "victim\n");
    writeFileSync(join(dir, "decoy.txt"), "decoy!\n");

    let swapped = false;
    const { captured, error } = attempt(() => captureWorktreePath(dir, "victim.txt", {
      noFollowFlag: 0,
      beforeOpen(path) {
        if (swapped) return;
        swapped = true;
        unlinkSync(path);
        symlinkSync("decoy.txt", path);
      },
    }));

    expect(swapped).toBe(true);
    expect(captured && text(captured.bytes)).not.toBe("decoy!\n");
    expect(error).toBeInstanceOf(Error);
  });
});
