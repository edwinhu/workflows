import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDependencyCapability } from "../workflows/lib/capability-resolver";

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "capability-resolver-"));
  temporaryRoots.push(root);
  return root;
}

function writeManifest(root: string, manifest: unknown): void {
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(join(root, ".claude-plugin", "capabilities.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function validManifest(implementation = "workflows/lib/example.ts"): unknown {
  return {
    schemaVersion: 1,
    plugin: { name: "synthetic-public-plugin", version: "1.2.3" },
    capabilities: [
      { name: "synthetic.capability", contractVersion: 1, implementation },
    ],
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("resolveDependencyCapability", () => {
  test("returns canonical identity, implementation, and manifest schema evidence", () => {
    const root = temporaryRoot();
    mkdirSync(join(root, "workflows/lib"), { recursive: true });
    writeFileSync(join(root, "workflows/lib/example.ts"), "export {};\n");
    writeManifest(root, validManifest());

    expect(resolveDependencyCapability(root, "synthetic.capability")).toEqual({
      canonicalRoot: root,
      plugin: "synthetic-public-plugin",
      version: "1.2.3",
      capability: "synthetic.capability",
      contractVersion: 1,
      implementationPath: join(root, "workflows/lib/example.ts"),
      manifestSchema: {
        schemaVersion: 1,
        manifestPath: join(root, ".claude-plugin/capabilities.json"),
      },
    });
  });

  test.each([
    ["lexical traversal", "../outside.ts"],
    ["absolute path", "/tmp/outside.ts"],
  ])("rejects %s in implementation paths", (_label, implementation) => {
    const root = temporaryRoot();
    writeManifest(root, validManifest(implementation));
    expect(() => resolveDependencyCapability(root, "synthetic.capability")).toThrow(/implementation path/i);
  });

  test("rejects symlink escape", () => {
    const root = temporaryRoot();
    const outside = temporaryRoot();
    writeFileSync(join(outside, "escape.ts"), "export {};\n");
    mkdirSync(join(root, "workflows/lib"), { recursive: true });
    symlinkSync(join(outside, "escape.ts"), join(root, "workflows/lib/example.ts"));
    writeManifest(root, validManifest());

    expect(() => resolveDependencyCapability(root, "synthetic.capability")).toThrow(/outside canonical dependency root/i);
  });

  test.each([
    ["non-object", []],
    ["unknown top-level key", { ...validManifest() as object, extra: true }],
    ["wrong schema version", { ...validManifest() as object, schemaVersion: 2 }],
    ["invalid plugin version", { ...validManifest() as object, plugin: { name: "synthetic-public-plugin", version: "latest" } }],
    ["unknown capability key", { ...validManifest() as object, capabilities: [{ name: "synthetic.capability", contractVersion: 1, implementation: "workflows/lib/example.ts", extra: true }] }],
  ])("rejects malformed manifest: %s", (_label, manifest) => {
    const root = temporaryRoot();
    writeManifest(root, manifest);
    expect(() => resolveDependencyCapability(root, "synthetic.capability")).toThrow(/manifest/i);
  });

  test("rejects duplicate capabilities", () => {
    const root = temporaryRoot();
    const manifest = validManifest() as { capabilities: unknown[] };
    manifest.capabilities.push({ name: "synthetic.capability", contractVersion: 2, implementation: "workflows/lib/other.ts" });
    writeManifest(root, manifest);
    expect(() => resolveDependencyCapability(root, "synthetic.capability")).toThrow(/duplicate capability/i);
  });

  test("rejects missing capabilities", () => {
    const root = temporaryRoot();
    writeManifest(root, validManifest());
    expect(() => resolveDependencyCapability(root, "absent.capability")).toThrow(/capability not found/i);
  });
});
