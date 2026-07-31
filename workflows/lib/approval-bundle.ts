import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

export type ApprovalCaptureLocationsV1 = Readonly<{ schemaVersion: 1; workflow: string; planPath: string; metadataPath: string; verdictPath: string }>;
export type CapturedApprovalBundleV1 = Readonly<{
  schemaVersion: 1;
  readonly descriptorBytes: Buffer;
  readonly planBytes: Buffer;
  readonly metadataBytes: Buffer;
  readonly verdictBytes: Buffer;
}>;

export function digestBytes(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

function owned(bytes: Uint8Array): Buffer { return Buffer.from(bytes); }

function isContained(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(fromRoot);
}

function safePath(root: string, value: string): string {
  if (!value || isAbsolute(value) || value.includes("\\") || value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("approval path must be canonical project-relative");
  }
  const segments = value.split("/");
  let candidate = root;
  for (const segment of segments) {
    candidate = join(candidate, segment);
    const entry = lstatSync(candidate);
    if (entry.isSymbolicLink()) throw new Error("approval artifact path must not contain a symbolic link");
  }
  if (!lstatSync(candidate).isFile()) throw new Error("approval artifact must be a regular file");
  const canonical = realpathSync(candidate);
  if (!isContained(root, canonical)) throw new Error("approval path escapes project root");
  return canonical;
}

function authenticatedLocations(descriptorBytes: Uint8Array, supplied: ApprovalCaptureLocationsV1): void {
  let value: unknown;
  try { value = JSON.parse(owned(descriptorBytes).toString("utf8")); } catch { throw new Error("approval descriptor is malformed JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("approval descriptor does not authenticate supplied locations");
  const descriptor = value as Record<string, unknown>;
  const keys = ["schemaVersion", "workflow", "planPath", "metadataPath", "verdictPath"] as const;
  if (Object.keys(descriptor).length !== keys.length || keys.some((key) => !Object.hasOwn(descriptor, key) || descriptor[key] !== supplied[key])) {
    throw new Error("approval descriptor does not authenticate supplied locations");
  }
}

function capturedBundle(descriptorBytes: Uint8Array, planBytes: Uint8Array, metadataBytes: Uint8Array, verdictBytes: Uint8Array): CapturedApprovalBundleV1 {
  const bytes = {
    descriptorBytes: owned(descriptorBytes),
    planBytes: owned(planBytes),
    metadataBytes: owned(metadataBytes),
    verdictBytes: owned(verdictBytes),
  };
  return Object.freeze({
    schemaVersion: 1 as const,
    get descriptorBytes() { return owned(bytes.descriptorBytes); },
    get planBytes() { return owned(bytes.planBytes); },
    get metadataBytes() { return owned(bytes.metadataBytes); },
    get verdictBytes() { return owned(bytes.verdictBytes); },
  });
}

export function captureApprovalBundle(projectDir: string, descriptorBytes: Uint8Array, locations: ApprovalCaptureLocationsV1): CapturedApprovalBundleV1 {
  const descriptorSnapshot = owned(descriptorBytes);
  authenticatedLocations(descriptorSnapshot, locations);
  const root = realpathSync(projectDir);
  const paths = [locations.planPath, locations.metadataPath, locations.verdictPath].map((value) => safePath(root, value));
  if (new Set(paths).size !== paths.length) throw new Error("approval paths must be distinct");
  return capturedBundle(descriptorSnapshot, readFileSync(paths[0]), readFileSync(paths[1]), readFileSync(paths[2]));
}

export function copyCapturedApprovalBundle(bundle: CapturedApprovalBundleV1): CapturedApprovalBundleV1 {
  const descriptorBytes = owned(bundle.descriptorBytes);
  const planBytes = owned(bundle.planBytes);
  const metadataBytes = owned(bundle.metadataBytes);
  const verdictBytes = owned(bundle.verdictBytes);
  return capturedBundle(descriptorBytes, planBytes, metadataBytes, verdictBytes);
}
