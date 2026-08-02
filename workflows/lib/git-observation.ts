import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
  decodeGitPaths,
  loadGitMetadata,
  loadGitObjects,
  runGit,
  validateCandidatePath,
  type CandidateKind,
  type CandidateRepresentation,
  type CandidateState,
} from "./candidate-manifest";
import { captureWorktreePath } from "./worktree-capture";

export interface GitObservationEntry {
  path: string;
  representation: CandidateRepresentation;
  state: CandidateState;
  kind: CandidateKind;
  executable: boolean;
  byteLength: number;
  contentDigest: string;
  binary: boolean;
}
export interface GitObservation {
  schemaVersion: 1;
  repositoryRoot: string;
  headCommit: string;
  entries: readonly Readonly<GitObservationEntry>[];
  digest: string;
  limitations: readonly string[];
}
export interface GitObservationDelta {
  preDigest: string;
  postDigest: string;
  changedPaths: readonly string[];
}

const encoder = new TextEncoder();
const empty = new Uint8Array();
const digestBytes = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const emptyDigest = digestBytes(empty);

function text(root: string, args: readonly string[]): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(runGit(root, args)).trim();
}
function binary(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return true;
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return false; } catch { return true; }
}
function entry(path: string, representation: CandidateRepresentation, state: CandidateState, kind: CandidateKind, executable: boolean, bytes: Uint8Array): GitObservationEntry {
  const owned = new Uint8Array(bytes);
  return { path, representation, state, kind, executable, byteLength: owned.byteLength, contentDigest: digestBytes(owned), binary: binary(owned) };
}
function compare(a: GitObservationEntry, b: GitObservationEntry): number {
  return a.path.localeCompare(b.path, "en", { sensitivity: "variant" }) || a.representation.localeCompare(b.representation);
}
function logical(entry: GitObservationEntry): string {
  return JSON.stringify([entry.path, entry.representation, entry.state, entry.kind, entry.executable, entry.byteLength, entry.contentDigest, entry.binary]);
}

export function captureGitObservation(repositoryRoot: string): Readonly<GitObservation> {
  const root = realpathSync(repositoryRoot);
  if (!isAbsolute(root) || realpathSync(text(root, ["rev-parse", "--show-toplevel"])) !== root) throw new Error("repositoryRoot must be the canonical Git root");
  const headCommit = text(root, ["rev-parse", "HEAD^{commit}"]);
  const changed = new Set<string>([
    ...decodeGitPaths(runGit(root, ["diff", "--cached", "--name-only", "-z", "HEAD", "--"])).map(validateCandidatePath),
    ...decodeGitPaths(runGit(root, ["diff", "--name-only", "-z", "--"])).map(validateCandidatePath),
    ...decodeGitPaths(runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"])).map(validateCandidatePath),
  ]);
  const metadata = loadGitMetadata(root, "HEAD");
  // GITLINKS (submodule pointers, mode 160000) NAME A COMMIT, NOT A BLOB, and that commit lives in
  // another repository — so `git cat-file --batch` reports it missing and `loadGitObjects` throws
  // `invalid Git blob`. The whole observation then fails, which the gate correctly treats as a hard
  // refusal, so EVERY dispatch in a repo containing a submodule was unadjudicable. Found by running
  // the live hook against this very repo, whose `skills/bmll` submodule pointer moved.
  //
  // `candidate-manifest.ts:328` already carries this exact fix, naming this exact submodule. The
  // observation path was never given it — the same defect, in the sibling that walks the same index.
  // A submodule's contents are not this repository's content in any case; the pointer is dropped.
  const isGitlink = (path: string) =>
    metadata.index.get(path)?.mode === "160000" || metadata.tree.get(path)?.mode === "160000";
  for (const path of [...changed]) if (isGitlink(path)) changed.delete(path);
  const indexObjects = loadGitObjects(root, [...changed].flatMap((path) => metadata.index.get(path)?.oid ?? []));
  const entries: GitObservationEntry[] = [];
  for (const path of [...changed].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "variant" }))) {
    const indexMetadata = metadata.index.get(path);
    const headMetadata = metadata.tree.get(path);
    const fallbackMode = indexMetadata?.mode ?? headMetadata?.mode ?? "";
    if (indexMetadata) {
      const bytes = indexObjects.get(indexMetadata.oid);
      if (!bytes) throw new Error(`Git index blob was not loaded: ${path}`);
      const mode = indexMetadata.mode;
      entries.push(entry(path, "index", "present", mode === "120000" ? "symlink" : "regular", mode === "100755", bytes));
    } else if (headMetadata) {
      entries.push({ path, representation: "index", state: "deleted", kind: fallbackMode === "120000" ? "symlink" : "regular", executable: fallbackMode === "100755", byteLength: 0, contentDigest: emptyDigest, binary: false });
    }
    const worktree = captureWorktreePath(root, path);
    if (worktree) {
      entries.push(entry(path, "worktree", "present", worktree.kind, worktree.executable, worktree.bytes));
    } else if (indexMetadata || headMetadata) {
      entries.push({ path, representation: "worktree", state: "deleted", kind: fallbackMode === "120000" ? "symlink" : "regular", executable: fallbackMode === "100755", byteLength: 0, contentDigest: emptyDigest, binary: false });
    }
  }
  entries.sort(compare);
  entries.forEach(Object.freeze);
  Object.freeze(entries);
  const limitations = Object.freeze([
    "transient paths created and removed entirely between captures are not observed",
    "captures do not claim a race-free global filesystem instant or resistance to a malicious same-user process",
  ]);
  const digest = digestBytes(encoder.encode(JSON.stringify({ schemaVersion: 1, repositoryRoot: root, headCommit, entries })));
  return Object.freeze({ schemaVersion: 1, repositoryRoot: root, headCommit, entries, digest, limitations });
}

export function compareGitObservations(pre: GitObservation, post: GitObservation): Readonly<GitObservationDelta> {
  if (pre.repositoryRoot !== post.repositoryRoot) throw new Error("observations use different repository roots");
  const before = new Map(pre.entries.map(item => [`${item.path}\0${item.representation}`, logical(item)]));
  const after = new Map(post.entries.map(item => [`${item.path}\0${item.representation}`, logical(item)]));
  const keys = new Set([...before.keys(), ...after.keys()]);
  const changedPaths = [...new Set([...keys].filter(key => before.get(key) !== after.get(key)).map(key => key.split("\0", 1)[0]!))]
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "variant" }));
  return Object.freeze({ preDigest: pre.digest, postDigest: post.digest, changedPaths: Object.freeze(changedPaths) });
}
