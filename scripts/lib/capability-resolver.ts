import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const MANIFEST_RELATIVE_PATH = ".claude-plugin/capabilities.json";
const NAME_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

interface CapabilityEntry {
  name: string;
  contractVersion: number;
  implementation: string;
}

interface CapabilityManifest {
  schemaVersion: 1;
  plugin: {
    name: string;
    version: string;
  };
  capabilities: CapabilityEntry[];
}

export interface ResolvedDependencyCapability {
  canonicalRoot: string;
  plugin: string;
  version: string;
  capability: string;
  contractVersion: number;
  implementationPath: string;
  manifestSchema: {
    schemaVersion: 1;
    manifestPath: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(record, key));
}

function manifestError(message: string): Error {
  return new Error(`Invalid capability manifest: ${message}`);
}

function parseManifest(text: string): CapabilityManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw manifestError("malformed JSON");
  }

  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "plugin", "capabilities"])) {
    throw manifestError("expected only schemaVersion, plugin, and capabilities");
  }
  if (value.schemaVersion !== 1) throw manifestError("unsupported schemaVersion");
  if (!isRecord(value.plugin) || !hasExactKeys(value.plugin, ["name", "version"])) {
    throw manifestError("invalid plugin identity");
  }
  if (typeof value.plugin.name !== "string" || !NAME_PATTERN.test(value.plugin.name)) {
    throw manifestError("invalid plugin name");
  }
  if (typeof value.plugin.version !== "string" || !SEMVER_PATTERN.test(value.plugin.version)) {
    throw manifestError("invalid plugin version");
  }
  if (!Array.isArray(value.capabilities) || value.capabilities.length === 0) {
    throw manifestError("capabilities must be a non-empty array");
  }

  const capabilities: CapabilityEntry[] = [];
  const names = new Set<string>();
  for (const rawCapability of value.capabilities) {
    if (!isRecord(rawCapability) || !hasExactKeys(rawCapability, ["name", "contractVersion", "implementation"])) {
      throw manifestError("invalid capability entry");
    }
    if (typeof rawCapability.name !== "string" || !NAME_PATTERN.test(rawCapability.name)) {
      throw manifestError("invalid capability name");
    }
    if (names.has(rawCapability.name)) throw new Error(`Duplicate capability: ${rawCapability.name}`);
    names.add(rawCapability.name);
    if (!Number.isSafeInteger(rawCapability.contractVersion) || (rawCapability.contractVersion as number) < 1) {
      throw manifestError("invalid capability contractVersion");
    }
    if (typeof rawCapability.implementation !== "string" || rawCapability.implementation.length === 0) {
      throw manifestError("invalid capability implementation path");
    }
    capabilities.push({
      name: rawCapability.name,
      contractVersion: rawCapability.contractVersion as number,
      implementation: rawCapability.implementation,
    });
  }

  return {
    schemaVersion: 1,
    plugin: { name: value.plugin.name, version: value.plugin.version },
    capabilities,
  };
}

function isContained(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

export function resolveDependencyCapability(
  dependencyRoot: string,
  capabilityName: string,
): ResolvedDependencyCapability {
  if (typeof dependencyRoot !== "string" || dependencyRoot.length === 0) {
    throw new Error("Dependency root must be explicit");
  }
  if (typeof capabilityName !== "string" || !NAME_PATTERN.test(capabilityName)) {
    throw new Error("Invalid capability name");
  }

  const canonicalRoot = realpathSync(dependencyRoot);
  if (!lstatSync(canonicalRoot).isDirectory()) throw new Error("Dependency root must be a directory");

  const manifestCandidate = join(canonicalRoot, MANIFEST_RELATIVE_PATH);
  const manifestPath = realpathSync(manifestCandidate);
  if (!isContained(canonicalRoot, manifestPath)) {
    throw new Error("Capability manifest is outside canonical dependency root");
  }
  const manifest = parseManifest(readFileSync(manifestPath, "utf8"));
  const capability = manifest.capabilities.find((entry) => entry.name === capabilityName);
  if (!capability) throw new Error(`Capability not found: ${capabilityName}`);

  if (isAbsolute(capability.implementation)) {
    throw manifestError("implementation path must be project-relative");
  }
  const lexicalImplementation = resolve(canonicalRoot, capability.implementation);
  if (!isContained(canonicalRoot, lexicalImplementation)) {
    throw manifestError("implementation path escapes dependency root");
  }
  const implementationPath = realpathSync(lexicalImplementation);
  if (!isContained(canonicalRoot, implementationPath)) {
    throw new Error("Capability implementation is outside canonical dependency root");
  }
  if (!lstatSync(implementationPath).isFile()) {
    throw new Error("Capability implementation must be a file");
  }

  return {
    canonicalRoot,
    plugin: manifest.plugin.name,
    version: manifest.plugin.version,
    capability: capability.name,
    contractVersion: capability.contractVersion,
    implementationPath,
    manifestSchema: { schemaVersion: manifest.schemaVersion, manifestPath },
  };
}
