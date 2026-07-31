import { lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

export interface CapturedWorktreePath {
  kind: "regular" | "symlink";
  executable: boolean;
  bytes: Uint8Array;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

function isContained(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function captureWorktreePath(canonicalRoot: string, repositoryPath: string): CapturedWorktreePath | undefined {
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
      return { kind: "symlink", executable: false, bytes: new TextEncoder().encode(readlinkSync(current)) };
    }
    if (!stat.isFile()) throw new Error(`unsupported worktree file kind: ${repositoryPath}`);

    const canonicalTarget = realpathSync(current);
    if (!isContained(canonicalRoot, canonicalTarget)) throw new Error(`worktree path escapes repository: ${repositoryPath}`);
    return {
      kind: "regular",
      executable: (stat.mode & 0o111) !== 0,
      bytes: new Uint8Array(readFileSync(canonicalTarget)),
    };
  }

  throw new Error("worktree path must not be empty");
}
