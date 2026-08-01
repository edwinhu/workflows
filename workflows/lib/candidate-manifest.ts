import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { captureWorktreePath } from "./worktree-capture";

export type CandidateRepresentation = "index" | "worktree";
export type CandidateState = "present" | "deleted";
export type CandidateKind = "regular" | "symlink";

export interface CandidateEntryV1 {
  path: string;
  representation: CandidateRepresentation;
  state: CandidateState;
  kind: CandidateKind;
  executable: boolean;
  byteLength: number;
  digest: string;
  binary: boolean;
}

export interface CandidateExclusionV1 {
  path: string;
  representation: CandidateRepresentation;
  digest: string;
  rationale: string;
}

export interface CandidateBinaryDispositionV1 {
  path: string;
  representation: CandidateRepresentation;
  digest: string;
  disposition: string;
}

export interface CandidateManifestV1 {
  schemaVersion: 1;
  repositoryRoot: string;
  baseCommit: string;
  headCommit: string;
  entries: readonly Readonly<CandidateEntryV1>[];
  exclusions: readonly Readonly<CandidateExclusionV1>[];
  binaryInventory: readonly Readonly<CandidateBinaryDispositionV1>[];
}

export interface CaptureCandidateOptions {
  repositoryRoot: string;
  baseRef: string;
  capturedAt?: string;
  exclusions?: readonly { path: string; representation: CandidateRepresentation; rationale: string }[];
  binaryInventory?: readonly CandidateBinaryDispositionV1[];
}

export interface CapturedCandidate {
  readonly manifest: Readonly<CandidateManifestV1>;
  readonly manifestDigest: string;
  readonly capturedAt: string;
  bytes(path: string, representation: CandidateRepresentation): Uint8Array;
}

const SHA256 = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();
const emptyDigest = digestBytes(new Uint8Array());

function digestBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function runGit(root: string, args: readonly string[], stdin?: Uint8Array): Uint8Array {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe", stdin });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  return new Uint8Array(result.stdout);
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not a valid UTF-8 Git pathname`);
  }
}

function gitText(root: string, args: readonly string[]): string {
  return decodeUtf8(runGit(root, args), "Git output").trim();
}

function nulComponents(bytes: Uint8Array): Uint8Array[] {
  const components: Uint8Array[] = [];
  let start = 0;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] === 0) {
      components.push(bytes.slice(start, index));
      start = index + 1;
    }
  }
  if (start < bytes.byteLength) components.push(bytes.slice(start));
  return components;
}

export function decodeGitPaths(bytes: Uint8Array): string[] {
  return nulComponents(bytes).map((part) => decodeUtf8(part, "Git pathname"));
}

export interface GitFileMetadata { mode: string; oid: string }

function parseMetadataRecord(record: Uint8Array, label: string, indexFormat: boolean): readonly [string, GitFileMetadata] {
  const tab = record.indexOf(9);
  if (tab < 0) throw new Error(`malformed ${label} record`);
  const metadata = decodeUtf8(record.slice(0, tab), `${label} metadata`);
  const path = validateCandidatePath(decodeUtf8(record.slice(tab + 1), "Git pathname"));
  const fields = metadata.split(" ");
  const mode = fields[0] ?? "";
  const oid = indexFormat ? fields[1] ?? "" : fields[2] ?? "";
  if (!/^\d{6}$/.test(mode) || !/^[0-9a-f]{40,64}$/.test(oid)) throw new Error(`malformed ${label} metadata`);
  if (indexFormat && fields[2] !== "0") throw new Error(`unmerged Git index entry: ${path}`);
  return [path, { mode, oid }];
}

export function loadGitMetadata(root: string, treeish: string): { index: Map<string, GitFileMetadata>; tree: Map<string, GitFileMetadata> } {
  const index = new Map<string, GitFileMetadata>();
  for (const record of nulComponents(runGit(root, ["ls-files", "-s", "-z"]))) {
    const [path, metadata] = parseMetadataRecord(record, "Git index", true);
    if (index.has(path)) throw new Error(`duplicate Git index entry: ${path}`);
    index.set(path, metadata);
  }
  const tree = new Map<string, GitFileMetadata>();
  for (const record of nulComponents(runGit(root, ["ls-tree", "-rz", treeish]))) {
    const [path, metadata] = parseMetadataRecord(record, "Git tree", false);
    tree.set(path, metadata);
  }
  return { index, tree };
}

export function loadGitObjects(root: string, oids: readonly string[]): Map<string, Uint8Array> {
  const unique = [...new Set(oids)];
  if (unique.length === 0) return new Map();
  const output = runGit(root, ["cat-file", "--batch"], encoder.encode(`${unique.join("\n")}\n`));
  const objects = new Map<string, Uint8Array>();
  let offset = 0;
  for (const requested of unique) {
    const newline = output.indexOf(10, offset);
    if (newline < 0) throw new Error("malformed git cat-file batch output");
    const header = decodeUtf8(output.slice(offset, newline), "Git object header").split(" ");
    const size = Number(header[2]);
    if (header[0] !== requested || header[1] !== "blob" || !Number.isSafeInteger(size) || size < 0) throw new Error(`invalid Git blob: ${requested}`);
    const end = newline + 1 + size;
    if (end >= output.byteLength || output[end] !== 10) throw new Error("truncated git cat-file batch output");
    objects.set(requested, new Uint8Array(output.slice(newline + 1, end)));
    offset = end + 1;
  }
  return objects;
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`${label} contains unknown field(s): ${unknown.join(", ")}`);
  const missing = keys.filter((key) => !(key in value));
  if (missing.length) throw new Error(`${label} missing field(s): ${missing.join(", ")}`);
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

export function validateCandidatePath(path: string): string {
  if (typeof path !== "string" || path.length === 0 || path.includes("\0") || path.includes("\\")) throw new Error("candidate path is invalid");
  if (isAbsolute(path) || path.startsWith("/") || path.split("/").some((part) => part === "" || part === "." || part === "..")) throw new Error(`candidate path is not canonical: ${path}`);
  if (/%[0-9a-fA-F]{2}/.test(path) || path.includes("%")) throw new Error(`candidate path has ambiguous encoding: ${path}`);
  const normalized = path.normalize("NFC");
  if (normalized !== path) throw new Error(`candidate path has ambiguous Unicode encoding: ${path}`);
  return path;
}

function isBinary(bytes: Uint8Array): boolean {
  const pairs = Math.floor(bytes.byteLength / 2);
  if (pairs >= 4) {
    let evenNuls = 0;
    let oddNuls = 0;
    for (let index = 0; index < bytes.byteLength; index += 1) {
      if (bytes[index] === 0) {
        if (index % 2 === 0) evenNuls += 1;
        else oddNuls += 1;
      }
    }
    if (oddNuls > pairs / 3 && evenNuls < pairs / 8) {
      try { new TextDecoder("utf-16le", { fatal: true }).decode(bytes); return false; } catch {}
    }
    if (evenNuls > pairs / 3 && oddNuls < pairs / 8) {
      const swapped = new Uint8Array(bytes);
      for (let index = 0; index + 1 < swapped.byteLength; index += 2) [swapped[index], swapped[index + 1]] = [swapped[index + 1]!, swapped[index]!];
      try { new TextDecoder("utf-16le", { fatal: true }).decode(swapped); return false; } catch {}
    }
  }
  if (bytes.includes(0)) return true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return false;
  } catch {
    return true;
  }
}

function freezeManifest(manifest: CandidateManifestV1): Readonly<CandidateManifestV1> {
  for (const item of manifest.entries) Object.freeze(item);
  for (const item of manifest.exclusions) Object.freeze(item);
  for (const item of manifest.binaryInventory) Object.freeze(item);
  Object.freeze(manifest.entries);
  Object.freeze(manifest.exclusions);
  Object.freeze(manifest.binaryInventory);
  return Object.freeze(manifest);
}

function entryKey(path: string, representation: CandidateRepresentation): string {
  return `${path}\0${representation}`;
}

function compareLogical(a: { path: string; representation: CandidateRepresentation }, b: { path: string; representation: CandidateRepresentation }): number {
  return a.path.localeCompare(b.path, "en", { sensitivity: "variant" }) || a.representation.localeCompare(b.representation);
}

function canonicalObject(manifest: CandidateManifestV1): CandidateManifestV1 {
  return {
    schemaVersion: 1,
    repositoryRoot: manifest.repositoryRoot,
    baseCommit: manifest.baseCommit,
    headCommit: manifest.headCommit,
    entries: manifest.entries.map((entry) => ({ ...entry })),
    exclusions: manifest.exclusions.map((entry) => ({ ...entry })),
    binaryInventory: manifest.binaryInventory.map((entry) => ({ ...entry })),
  };
}

export function serializeCandidateManifest(manifest: CandidateManifestV1): Uint8Array {
  const validated = parseCandidateManifest(canonicalObject(manifest));
  return encoder.encode(`${JSON.stringify(canonicalObject(validated))}\n`);
}

export function digestCandidateManifest(manifest: CandidateManifestV1): string {
  return digestBytes(serializeCandidateManifest(manifest));
}

function parseRepresentation(value: unknown): CandidateRepresentation {
  if (value !== "index" && value !== "worktree") throw new Error("invalid candidate representation");
  return value;
}

export function parseCandidateManifest(input: unknown): Readonly<CandidateManifestV1> {
  const value: unknown = typeof input === "string" || input instanceof Uint8Array
    ? JSON.parse(typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true }).decode(input))
    : input;
  assertRecord(value, "candidate manifest");
  assertExactKeys(value, ["schemaVersion", "repositoryRoot", "baseCommit", "headCommit", "entries", "exclusions", "binaryInventory"], "candidate manifest");
  if (value.schemaVersion !== 1) throw new Error("unsupported candidate manifest schemaVersion");
  if (typeof value.repositoryRoot !== "string" || !isAbsolute(value.repositoryRoot)) throw new Error("repositoryRoot must be absolute");
  if (typeof value.baseCommit !== "string" || !SHA256.test(value.baseCommit) && !/^[0-9a-f]{40}$/.test(value.baseCommit)) throw new Error("invalid baseCommit");
  if (typeof value.headCommit !== "string" || !SHA256.test(value.headCommit) && !/^[0-9a-f]{40}$/.test(value.headCommit)) throw new Error("invalid headCommit");
  if (!Array.isArray(value.entries) || !Array.isArray(value.exclusions) || !Array.isArray(value.binaryInventory)) throw new Error("manifest lists must be arrays");

  const seen = new Set<string>();
  const casePaths = new Map<string, string>();
  const entries = value.entries.map((raw, index): CandidateEntryV1 => {
    assertRecord(raw, `entry ${index}`);
    assertExactKeys(raw, ["path", "representation", "state", "kind", "executable", "byteLength", "digest", "binary"], `entry ${index}`);
    const path = validateCandidatePath(raw.path as string);
    const representation = parseRepresentation(raw.representation);
    const key = entryKey(path, representation);
    if (seen.has(key)) throw new Error(`duplicate logical entry: ${path} ${representation}`);
    seen.add(key);
    const folded = path.toLocaleLowerCase("en-US");
    const prior = casePaths.get(folded);
    if (prior && prior !== path) throw new Error(`platform case collision: ${prior} and ${path}`);
    casePaths.set(folded, path);
    if (raw.state !== "present" && raw.state !== "deleted") throw new Error("invalid entry state");
    if (raw.kind !== "regular" && raw.kind !== "symlink") throw new Error("invalid entry kind");
    if (typeof raw.executable !== "boolean" || !Number.isSafeInteger(raw.byteLength) || (raw.byteLength as number) < 0 || typeof raw.digest !== "string" || !SHA256.test(raw.digest) || typeof raw.binary !== "boolean") throw new Error("invalid entry metadata");
    if (raw.state === "deleted" && (raw.byteLength !== 0 || raw.digest !== emptyDigest || raw.binary !== false)) throw new Error("deleted entry metadata must be empty");
    return { path, representation, state: raw.state, kind: raw.kind, executable: raw.executable, byteLength: raw.byteLength as number, digest: raw.digest, binary: raw.binary };
  });
  if (entries.some((entry, index) => index > 0 && compareLogical(entries[index - 1]!, entry) >= 0)) throw new Error("candidate entries are not deterministically ordered");

  const parseBound = (raw: unknown, index: number, binary: boolean): CandidateExclusionV1 | CandidateBinaryDispositionV1 => {
    assertRecord(raw, `${binary ? "binary disposition" : "exclusion"} ${index}`);
    const keys = binary ? ["path", "representation", "digest", "disposition"] : ["path", "representation", "digest", "rationale"];
    assertExactKeys(raw, keys, binary ? "binary disposition" : "exclusion");
    const path = validateCandidatePath(raw.path as string);
    const representation = parseRepresentation(raw.representation);
    if (typeof raw.digest !== "string" || !SHA256.test(raw.digest)) throw new Error("invalid bound digest");
    const text = binary ? raw.disposition : raw.rationale;
    if (typeof text !== "string" || text.trim() !== text || text.length === 0) throw new Error(binary ? "invalid disposition" : "invalid exclusion rationale");
    return binary
      ? { path, representation, digest: raw.digest, disposition: text }
      : { path, representation, digest: raw.digest, rationale: text };
  };
  const exclusions = value.exclusions.map((raw, index) => parseBound(raw, index, false) as CandidateExclusionV1);
  const binaryInventory = value.binaryInventory.map((raw, index) => parseBound(raw, index, true) as CandidateBinaryDispositionV1);
  for (const [label, list] of [["exclusion", exclusions], ["binary inventory", binaryInventory]] as const) {
    const keys = new Set<string>();
    for (const item of list) {
      const key = entryKey(item.path, item.representation);
      if (keys.has(key)) throw new Error(`duplicate ${label} entry: ${item.path}`);
      keys.add(key);
      const target = entries.find((entry) => entryKey(entry.path, entry.representation) === key);
      if (!target || target.digest !== item.digest) throw new Error(`${label} digest does not bind a candidate entry`);
      if (label === "binary inventory" && !target.binary) throw new Error("binary inventory names textual content");
    }
    if (list.some((entry, index) => index > 0 && compareLogical(list[index - 1]!, entry) >= 0)) throw new Error(`${label} is not deterministically ordered`);
  }
  const inventoried = new Set(binaryInventory.map((item) => entryKey(item.path, item.representation)));
  const missingBinary = entries.filter((entry) => entry.binary && !inventoried.has(entryKey(entry.path, entry.representation)));
  if (missingBinary.length) throw new Error(`binary inventory missing disposition for ${missingBinary[0]!.path} (${missingBinary[0]!.representation})`);

  return freezeManifest({ schemaVersion: 1, repositoryRoot: value.repositoryRoot, baseCommit: value.baseCommit, headCommit: value.headCommit, entries, exclusions, binaryInventory });
}

export function captureCandidate(options: CaptureCandidateOptions): CapturedCandidate {
  const root = realpathSync(options.repositoryRoot);
  if (!isAbsolute(root)) throw new Error("repository root must be absolute");
  const top = realpathSync(gitText(root, ["rev-parse", "--show-toplevel"]));
  if (top !== root) throw new Error("repositoryRoot must be the canonical Git root");
  const baseCommit = gitText(root, ["rev-parse", `${options.baseRef}^{commit}`]);
  const headCommit = gitText(root, ["rev-parse", "HEAD^{commit}"]);

  const paths = new Set<string>();
  for (const path of decodeGitPaths(runGit(root, ["diff", "--cached", "--name-only", "-z", options.baseRef, "--"]))) paths.add(validateCandidatePath(path));
  for (const path of decodeGitPaths(runGit(root, ["diff", "--name-only", "-z", "--"]))) paths.add(validateCandidatePath(path));
  for (const path of decodeGitPaths(runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"]))) paths.add(validateCandidatePath(path));
  const metadata = loadGitMetadata(root, baseCommit);
  // Gitlinks (submodule pointers, mode 160000) name a COMMIT, not a blob. Feeding one to
  // `git cat-file --batch` throws `invalid Git blob`, which is why the privacy scanner passed at
  // HEAD and failed in any working tree containing the `skills/bmll` submodule. A submodule's
  // contents live in another repository and are not this candidate's content in any case, so the
  // pointer is dropped rather than read.
  const isGitlink = (path: string) =>
    metadata.index.get(path)?.mode === "160000" || metadata.tree.get(path)?.mode === "160000";
  for (const path of [...paths]) if (isGitlink(path)) paths.delete(path);
  const indexObjects = loadGitObjects(root, [...paths].flatMap((path) => metadata.index.get(path)?.oid ?? []));

  const entries: CandidateEntryV1[] = [];
  const owned = new Map<string, Uint8Array>();
  const sortedPaths = [...paths].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "variant" }));
  const casePaths = new Map<string, string>();
  for (const path of sortedPaths) {
    const folded = path.toLocaleLowerCase("en-US");
    const prior = casePaths.get(folded);
    if (prior && prior !== path) throw new Error(`platform case collision: ${prior} and ${path}`);
    casePaths.set(folded, path);

    const indexMetadata = metadata.index.get(path);
    const baseMetadata = metadata.tree.get(path);
    const baseMode = baseMetadata?.mode ?? "";
    if (indexMetadata) {
      const mode = indexMetadata.mode;
      const bytes = indexObjects.get(indexMetadata.oid);
      if (!bytes) throw new Error(`Git index blob was not loaded: ${path}`);
      const copy = new Uint8Array(bytes);
      const entry: CandidateEntryV1 = { path, representation: "index", state: "present", kind: mode === "120000" ? "symlink" : "regular", executable: mode === "100755", byteLength: copy.byteLength, digest: digestBytes(copy), binary: isBinary(copy) };
      entries.push(entry);
      owned.set(entryKey(path, "index"), copy);
    } else if (baseMetadata) {
      entries.push({ path, representation: "index", state: "deleted", kind: baseMode === "120000" ? "symlink" : "regular", executable: baseMode === "100755", byteLength: 0, digest: emptyDigest, binary: false });
      owned.set(entryKey(path, "index"), new Uint8Array());
    }

    const worktree = captureWorktreePath(root, path);
    if (worktree) {
      const copy = new Uint8Array(worktree.bytes);
      const entry: CandidateEntryV1 = { path, representation: "worktree", state: "present", kind: worktree.kind, executable: worktree.executable, byteLength: copy.byteLength, digest: digestBytes(copy), binary: isBinary(copy) };
      entries.push(entry);
      owned.set(entryKey(path, "worktree"), copy);
    } else if (indexMetadata || baseMetadata) {
      const mode = indexMetadata?.mode ?? baseMode;
      entries.push({ path, representation: "worktree", state: "deleted", kind: mode === "120000" ? "symlink" : "regular", executable: mode === "100755", byteLength: 0, digest: emptyDigest, binary: false });
      owned.set(entryKey(path, "worktree"), new Uint8Array());
    }
  }
  entries.sort(compareLogical);

  const byKey = new Map(entries.map((entry) => [entryKey(entry.path, entry.representation), entry]));
  const exclusions: CandidateExclusionV1[] = (options.exclusions ?? []).map((exclusion) => {
    const path = validateCandidatePath(exclusion.path);
    if (typeof exclusion.rationale !== "string" || exclusion.rationale.trim() !== exclusion.rationale || exclusion.rationale.length === 0) throw new Error("exclusion rationale is required");
    const target = byKey.get(entryKey(path, exclusion.representation));
    if (!target) throw new Error(`exclusion does not name a captured representation: ${path}`);
    return { path, representation: exclusion.representation, digest: target.digest, rationale: exclusion.rationale };
  }).sort(compareLogical);
  const binaryInventory = (options.binaryInventory ?? []).map((item) => ({ ...item, path: validateCandidatePath(item.path) })).sort(compareLogical);

  const manifest = parseCandidateManifest({ schemaVersion: 1, repositoryRoot: root, baseCommit, headCommit, entries, exclusions, binaryInventory });
  const manifestDigest = digestCandidateManifest(manifest);
  const capturedAt = options.capturedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error("capturedAt must be an ISO timestamp");
  const capture: CapturedCandidate = {
    manifest,
    manifestDigest,
    capturedAt,
    bytes(path, representation) {
      const canonical = validateCandidatePath(path);
      const bytes = owned.get(entryKey(canonical, representation));
      if (!bytes) throw new Error(`captured representation not found: ${canonical} (${representation})`);
      return new Uint8Array(bytes);
    },
  };
  return Object.freeze(capture);
}
