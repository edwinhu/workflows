/**
 * WHY THE LEAF IS READ THROUGH A DESCRIPTOR AND NOT THROUGH ITS PATHNAME.
 *
 * The obvious shape of this function — `lstat` the leaf to decide what it is, `realpath` it to check
 * containment, then `readFileSync` that pathname — decides and reads through THREE separate lookups
 * of the same name. A same-user process that replaces the name with a symlink to a DIFFERENT in-repo
 * file in between wins every check: containment still holds (the target is inside the root), so the
 * other file's bytes get recorded under this path, tagged with the `kind` and `executable` bits of
 * the file that is no longer there. The observation is then internally inconsistent, which is worse
 * than a missed capture — it is a captured lie.
 *
 * The fix is the one `readArtifactSnapshot` in `approved-artifact.ts` already uses: OPEN FIRST with
 * `O_NOFOLLOW`, and derive everything from the descriptor. The descriptor pins one inode for the
 * life of the capture; renames and relinks of the NAME cannot move it. `O_NOFOLLOW` makes the
 * symlink-swap window fail loudly (ELOOP) instead of silently resolving, `fstat` supplies the kind
 * and mode bits that actually belong to the bytes being read, `/proc/self/fd/N` answers containment
 * for the inode that was opened rather than for whatever the name points at now, and re-`fstat`ing
 * after the read catches a swap that straddles it.
 *
 * The `WorktreeCaptureOptions` hooks exist so this window is testable by INJECTION rather than by
 * rewriting the source into a racy variant. A string-rewriting seam rotted here once already.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readlinkSync, realpathSync, type BigIntStats } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

export interface CapturedWorktreePath {
  kind: "regular" | "symlink";
  executable: boolean;
  bytes: Uint8Array;
}

/**
 * Test seam, mirroring `ArtifactReadOptions` in `approved-artifact.ts`. `beforeOpen` runs in the
 * window between the leaf decision and the pinning open; `afterOpen` runs once the descriptor
 * exists. `noFollowFlag` and `forcePathnameFallback` let a suite disable the platform-specific
 * halves of the pin one at a time.
 */
export type WorktreeCaptureOptions = {
  beforeOpen?: (path: string) => void;
  afterOpen?: (path: string) => void;
  noFollowFlag?: number;
  forcePathnameFallback?: boolean;
};

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

function isSwapped(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error.code === "ELOOP" || error.code === "EMLINK");
}

function isContained(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function sameInode(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameState(left: BigIntStats, right: BigIntStats): boolean {
  return sameInode(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

export function captureWorktreePath(canonicalRoot: string, repositoryPath: string, options: WorktreeCaptureOptions = {}): CapturedWorktreePath | undefined {
  const components = repositoryPath.split("/");
  let current = canonicalRoot;

  for (let index = 0; index < components.length; index += 1) {
    current = join(current, components[index]!);
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }

    const final = index === components.length - 1;
    if (!final) {
      if (stat.isSymbolicLink()) throw new Error(`worktree path has symlink ancestor: ${repositoryPath}`);
      if (!stat.isDirectory()) throw new Error(`worktree path has non-directory ancestor: ${repositoryPath}`);
      continue;
    }

    if (stat.isSymbolicLink()) {
      // A symlink leaf has no descriptor to pin (Node exposes no O_PATH), so the link text is read
      // and the leaf re-examined: a swap between the two lstats is reported rather than recorded.
      const before = lstatSync(current, { bigint: true });
      let target: string;
      try {
        target = readlinkSync(current);
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw new Error(`worktree path changed while capturing: ${repositoryPath}`);
      }
      const after = lstatSync(current, { bigint: true });
      if (!after.isSymbolicLink() || !sameState(before, after)) throw new Error(`worktree path changed while capturing: ${repositoryPath}`);
      return { kind: "symlink", executable: false, bytes: new TextEncoder().encode(target) };
    }
    if (!stat.isFile()) throw new Error(`unsupported worktree file kind: ${repositoryPath}`);

    return readPinnedLeaf(canonicalRoot, current, repositoryPath, options);
  }

  throw new Error("worktree path must not be empty");
}

function readPinnedLeaf(canonicalRoot: string, path: string, repositoryPath: string, options: WorktreeCaptureOptions): CapturedWorktreePath | undefined {
  options.beforeOpen?.(path);

  const noFollow = options.noFollowFlag ?? constants.O_NOFOLLOW;
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | noFollow);
  } catch (error) {
    if (isMissing(error)) return undefined;
    // O_NOFOLLOW turns "the name became a symlink after we decided it was a regular file" into
    // ELOOP. That is the race, not an unreadable repository.
    if (isSwapped(error)) throw new Error(`worktree path changed while capturing: ${repositoryPath}`);
    throw error;
  }

  try {
    const opened = fstatSync(fd, { bigint: true });
    options.afterOpen?.(path);
    if (!opened.isFile()) throw new Error(`unsupported worktree file kind: ${repositoryPath}`);

    // Containment is answered for the INODE that was opened, not for whatever the name resolves to
    // now. On Linux /proc/self/fd/N is the descriptor's own name; elsewhere the pathname is the only
    // answer available and the identity checks below carry the weight.
    const openedPath = process.platform === "linux" && !options.forcePathnameFallback
      ? realpathSync(`/proc/self/fd/${fd}`)
      : realpathSync(path);
    if (!isContained(canonicalRoot, openedPath)) throw new Error(`worktree path escapes repository: ${repositoryPath}`);

    const bytes = readFileSync(fd);
    const afterRead = fstatSync(fd, { bigint: true });
    if (BigInt(bytes.length) !== opened.size || !sameState(opened, afterRead)) throw new Error(`worktree path changed while capturing: ${repositoryPath}`);

    // Last: the NAME must still resolve to the inode whose bytes are about to be recorded under it.
    const leaf = lstatSync(path, { bigint: true });
    if (!leaf.isFile() || !sameInode(leaf, opened)) throw new Error(`worktree path changed while capturing: ${repositoryPath}`);

    return {
      kind: "regular",
      executable: (Number(opened.mode) & 0o111) !== 0,
      bytes: new Uint8Array(bytes),
    };
  } finally {
    closeSync(fd);
  }
}
