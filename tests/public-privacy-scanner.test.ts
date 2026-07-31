import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureCandidate, digestCandidateManifest } from "../workflows/lib/candidate-manifest";

import {
  PrivacyPolicyError,
  scanCapturedCandidate,
  scanFiles,
  scanTrackedTree,
  validatePrivacyPolicy,
  type PrivacyPolicy,
} from "../scripts/scan-public-privacy";

const REQUIRED_RATIONALE = ["live reverse integration until pri", "vate Stage 2 passes"].join("");
const DEBT_COMMAND = ["teaching", ":find-slide-page"].join("");
const DEBT_PLUGIN = ["teaching", "-plugin"].join("");
const TEACHING_CACHE = ["teaching", "teaching"].join("/");
const PRIVATE_REPOSITORY = ["private", " repository"].join("");
const COURSE_EXAMPLE = ["Advanced Corporate Law", " Seminar 2028"].join("");

const basePolicy = (): PrivacyPolicy => ({
  version: 1,
  scanRoots: ["."],
  exclusions: [".git/**", ".planning/**", "node_modules/**", "scratch/**", "bun.lock"],
  denyRules: [
    { id: "private-identifier", pattern: `(?:${DEBT_COMMAND}|${DEBT_PLUGIN}|private (?:repository|repo|plugin|consumer))`, flags: "gi" },
    { id: "cache-path", pattern: `\\.claude\\/plugins\\/cache\\/${TEACHING_CACHE.replace("/", "\\/")}\\/`, flags: "g" },
    { id: "course-name", pattern: "\\b[A-Z][A-Za-z& -]+ (?:Seminar|Course) 20\\d{2}\\b", flags: "g" },
    { id: "private-provenance", pattern: "\\b(?:developed|extracted|migrated|copied) (?:in|from|for) (?:the )?private (?:repository|repo|plugin|consumer)\\b", flags: "gi" },
  ],
  allowlist: [],
});

function expectPolicyError(policy: PrivacyPolicy, message: RegExp) {
  expect(() => validatePrivacyPolicy(policy)).toThrow(PrivacyPolicyError);
  expect(() => validatePrivacyPolicy(policy)).toThrow(message);
}

describe("public privacy scanner", () => {
  test("detects every denied privacy class with deterministic sorted findings", () => {
    const findings = scanFiles(basePolicy(), [
      { path: "z.ts", content: `developed in the ${PRIVATE_REPOSITORY}\n` },
      { path: "a.md", content: `${DEBT_PLUGIN}\n${COURSE_EXAMPLE}\n` },
      { path: "m.json", content: `"~/.claude/plugins/cache/${TEACHING_CACHE}/"\n` },
    ]);

    expect(findings.map(({ path, ruleId, match }) => [path, ruleId, match])).toEqual([
      ["a.md", "private-identifier", DEBT_PLUGIN],
      ["a.md", "course-name", COURSE_EXAMPLE],
      ["m.json", "cache-path", `.claude/plugins/cache/${TEACHING_CACHE}/`],
      ["z.ts", "private-provenance", `developed in the ${PRIVATE_REPOSITORY}`],
      ["z.ts", "private-identifier", PRIVATE_REPOSITORY],
    ]);
  });

  test("an exact scoped allowance suppresses only its path, rule, and token", () => {
    const policy = basePolicy();
    policy.allowlist = [{
      path: "hooks/bridge.ts",
      ruleId: "private-identifier",
      token: DEBT_PLUGIN,
      rationale: REQUIRED_RATIONALE,
      removeStage: 3,
    }];

    expect(scanFiles(policy, [
      { path: "hooks/bridge.ts", content: DEBT_PLUGIN },
      { path: "hooks/other.ts", content: DEBT_PLUGIN },
    ]).map((finding) => finding.path)).toEqual(["hooks/other.ts"]);
  });

  test("rejects broad, rationale-free, stale, and unscoped allowlists", () => {
    const broadPath = basePolicy();
    broadPath.allowlist = [{ path: "hooks/**", ruleId: "private-identifier", token: DEBT_PLUGIN, rationale: REQUIRED_RATIONALE, removeStage: 3 }];
    expectPolicyError(broadPath, /exact project-relative file/);

    const broadToken = basePolicy();
    broadToken.allowlist = [{ path: "hooks/bridge.ts", ruleId: "private-identifier", token: ".*", rationale: REQUIRED_RATIONALE, removeStage: 3 }];
    expectPolicyError(broadToken, /literal token/);

    const noRationale = basePolicy();
    noRationale.allowlist = [{ path: "hooks/bridge.ts", ruleId: "private-identifier", token: DEBT_PLUGIN, rationale: "", removeStage: 3 }];
    expectPolicyError(noRationale, /rationale/);

    const stale = basePolicy();
    stale.allowlist = [{ path: "hooks/bridge.ts", ruleId: "private-identifier", token: DEBT_PLUGIN, rationale: REQUIRED_RATIONALE, removeStage: 2 }];
    expectPolicyError(stale, /removeStage must be 3/);

    const unscoped = basePolicy();
    unscoped.allowlist = [{ path: "hooks/bridge.ts", ruleId: "missing-rule", token: DEBT_PLUGIN, rationale: REQUIRED_RATIONALE, removeStage: 3 }];
    expectPolicyError(unscoped, /known deny rule/);
  });

  test("checked-in policy permits only the exact reviewed Stage 3 debt scope", async () => {
    const policy = JSON.parse(await readFile(join(import.meta.dir, "../policy/public-privacy.json"), "utf8")) as PrivacyPolicy;
    expect(validatePrivacyPolicy(policy).scanRoots).toEqual(["."]);
    expect(policy.allowlist).toEqual([
      { path: "hooks/find-slide-page-inject.ts", ruleId: "private-identifier", token: DEBT_PLUGIN, rationale: REQUIRED_RATIONALE, removeStage: 3 },
      { path: "hooks/find-slide-page-inject.ts", ruleId: "cache-path", token: `.claude/plugins/cache/${TEACHING_CACHE}/`, rationale: REQUIRED_RATIONALE, removeStage: 3 },
      { path: "skills/visual-verify/SKILL.md", ruleId: "private-identifier", token: DEBT_COMMAND, rationale: REQUIRED_RATIONALE, removeStage: 3 },
    ]);
  });

  test("pins the complete checked-in security policy contract", async () => {
    const bytes = await readFile(join(import.meta.dir, "../policy/public-privacy.json"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("db95fbc58c648ca4c2dbad4400d00fccd00a6f8764a50260964b442d31f31d96");
  });

  test("rejects every policy-semantic weakening at runtime", () => {
    for (const pattern of ["references/**", "commands/**", "README.md", "unknown/**", "policy/**"] ) {
      const policy = basePolicy();
      policy.exclusions.push(pattern);
      expectPolicyError(policy, /exclusions/);
    }
    for (const mutate of [
      (policy: PrivacyPolicy) => { policy.scanRoots = ["docs"]; },
      (policy: PrivacyPolicy) => { policy.denyRules.shift(); },
      (policy: PrivacyPolicy) => { policy.denyRules.push({ id: "extra", pattern: "secret", flags: "g" }); },
      (policy: PrivacyPolicy) => { policy.denyRules[0].pattern = "(?!)"; },
      (policy: PrivacyPolicy) => { policy.denyRules[0].flags = "g"; },
    ]) {
      const policy = basePolicy();
      mutate(policy);
      expectPolicyError(policy, /scanRoots|denyRules/);
    }
  });

  test("scans denied tokens in non-ignored untracked additions and skips deletions", async () => {
    const root = await mkdtemp(join(tmpdir(), "privacy-untracked-"));
    try {
      await Bun.$`git -C ${root} init -q`;
      await Bun.$`mkdir -p ${join(root, "policy")} ${join(root, "new")}`;
      await writeFile(join(root, "policy/public-privacy.json"), JSON.stringify(basePolicy()));
      await writeFile(join(root, "deleted.md"), "clean");
      await Bun.$`git -C ${root} add policy/public-privacy.json deleted.md`;
      await Bun.$`git -C ${root} -c user.name=test -c user.email=test@example.com commit -qm baseline`;
      await rm(join(root, "deleted.md"));
      await writeFile(join(root, "new/secret.md"), `${DEBT_PLUGIN}\n`);
      expect((await scanTrackedTree(root)).map((finding) => finding.path)).toEqual(["new/secret.md"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("reports a denied staged representation even after its worktree bytes are reverted", async () => {
    const root = await mkdtemp(join(tmpdir(), "privacy-staged-only-"));
    try {
      await Bun.$`git -C ${root} init -q`;
      await Bun.$`mkdir -p ${join(root, "policy")}`;
      await writeFile(join(root, "policy/public-privacy.json"), JSON.stringify(basePolicy()));
      await writeFile(join(root, "split.md"), "clean\n");
      await Bun.$`git -C ${root} add policy/public-privacy.json split.md`;
      await Bun.$`git -C ${root} -c user.name=test -c user.email=test@example.com commit -qm baseline`;
      await writeFile(join(root, "split.md"), `${DEBT_PLUGIN}\n`);
      await Bun.$`git -C ${root} add split.md`;
      await writeFile(join(root, "split.md"), "clean after staging\n");

      expect((await scanTrackedTree(root)).map(({ path, ruleId, match }) => [path, ruleId, match])).toEqual([
        ["split.md", "private-identifier", DEBT_PLUGIN],
      ]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("scans a tracked policy safely while detecting the same denied token in normal files", async () => {
    const root = await mkdtemp(join(tmpdir(), "privacy-policy-self-"));
    try {
      await Bun.$`git -C ${root} init -q`;
      await Bun.$`mkdir -p ${join(root, "policy")} ${join(root, "hooks")} ${join(root, "skills/visual-verify")} ${join(root, "tests/golden")}`;
      await writeFile(join(root, "policy/public-privacy.json"), await readFile(join(import.meta.dir, "../policy/public-privacy.json"), "utf8"));
      await writeFile(join(root, "hooks/find-slide-page-inject.ts"), `${DEBT_PLUGIN} .claude/plugins/cache/${TEACHING_CACHE}/\n`);
      await writeFile(join(root, "skills/visual-verify/SKILL.md"), `${DEBT_COMMAND}\n`);
      await writeFile(join(root, "tests/golden/find-slide-page-inject.json"), "teaching/teaching\n");
      await writeFile(join(root, "note.md"), `${DEBT_PLUGIN}\n`);
      await Bun.$`git -C ${root} add policy/public-privacy.json hooks skills tests`;
      await Bun.$`git -C ${root} -c user.name=test -c user.email=test@example.com commit -qm baseline`;
      await Bun.$`git -C ${root} add note.md`;
      expect((await scanTrackedTree(root)).map((finding) => finding.path)).toEqual(["note.md"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("scans denied tokens in otherwise unlisted tracked paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "privacy-unlisted-"));
    try {
      await Bun.$`git -C ${root} init -q`;
      await Bun.$`mkdir -p ${join(root, "policy")} ${join(root, "unexpected/deep")}`;
      await writeFile(join(root, "policy/public-privacy.json"), JSON.stringify(basePolicy()));
      await writeFile(join(root, "unexpected/deep/note.md"), `${DEBT_PLUGIN}\n`);
      await Bun.$`git -C ${root} add policy/public-privacy.json`;
      await Bun.$`git -C ${root} -c user.name=test -c user.email=test@example.com commit -qm baseline`;
      await Bun.$`git -C ${root} add unexpected/deep/note.md`;

      expect((await scanTrackedTree(root)).map((finding) => finding.path)).toEqual(["unexpected/deep/note.md"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("cannot bypass denied identifiers with UTF-16 text", async () => {
    const root = await mkdtemp(join(tmpdir(), "privacy-encoded-"));
    try {
      await Bun.$`git -C ${root} init -q`;
      await Bun.$`mkdir -p ${join(root, "policy")}`;
      await writeFile(join(root, "policy/public-privacy.json"), JSON.stringify(basePolicy()));
      await Bun.$`git -C ${root} add policy/public-privacy.json`;
      await Bun.$`git -C ${root} -c user.name=test -c user.email=test@example.com commit -qm baseline`;
      await writeFile(join(root, "le.txt"), Buffer.from(`${DEBT_PLUGIN}\n`, "utf16le"));
      const be = Buffer.from(`${DEBT_PLUGIN}\n`, "utf16le");
      for (let index = 0; index < be.length; index += 2) [be[index], be[index + 1]] = [be[index + 1], be[index]];
      await writeFile(join(root, "be.txt"), be);
      await Bun.$`git -C ${root} add policy/public-privacy.json le.txt be.txt`;
      expect((await scanTrackedTree(root)).map((finding) => finding.path)).toEqual(["be.txt", "le.txt"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("fails closed on an unclassified tracked binary file", async () => {
    const root = await mkdtemp(join(tmpdir(), "privacy-binary-"));
    try {
      await Bun.$`git -C ${root} init -q`;
      await Bun.$`mkdir -p ${join(root, "policy")}`;
      await writeFile(join(root, "policy/public-privacy.json"), JSON.stringify(basePolicy()));
      await Bun.$`git -C ${root} add policy/public-privacy.json`;
      await Bun.$`git -C ${root} -c user.name=test -c user.email=test@example.com commit -qm baseline`;
      await writeFile(join(root, "opaque.bin"), Buffer.from([0, 255, 1, 254, 2, 253]));
      await Bun.$`git -C ${root} add policy/public-privacy.json opaque.bin`;
      await expect(scanTrackedTree(root)).rejects.toThrow(/binary inventory.*opaque\.bin|unclassified binary.*opaque\.bin/i);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("scans a tracked symlink payload without following its external target", async () => {
    const root = await mkdtemp(join(tmpdir(), "privacy-symlink-root-"));
    const outside = await mkdtemp(join(tmpdir(), "privacy-symlink-outside-"));
    try {
      await Bun.$`git -C ${root} init -q`;
      await Bun.$`mkdir -p ${join(root, "policy")}`;
      await writeFile(join(root, "policy/public-privacy.json"), JSON.stringify(basePolicy()));
      await Bun.$`git -C ${root} add policy/public-privacy.json`;
      await Bun.$`git -C ${root} -c user.name=test -c user.email=test@example.com commit -qm baseline`;
      await writeFile(join(outside, "secret.txt"), `${DEBT_PLUGIN}\n`);
      await symlink(join(outside, "secret.txt"), join(root, "external-link"));
      await Bun.$`git -C ${root} add policy/public-privacy.json external-link`;

      const findings = await scanTrackedTree(root);
      expect(findings.some((finding) => finding.ruleId === "private-identifier")).toBe(false);
      expect(findings.map((finding) => finding.match)).not.toContain(DEBT_PLUGIN);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("scans immutable candidate representations, deletions, and symlink payloads without rereading paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "privacy-candidate-"));
    try {
      await Bun.$`git -C ${root} init -q`;
      await writeFile(join(root, "split.txt"), "base\n");
      await writeFile(join(root, "deleted.txt"), "base\n");
      await Bun.$`git -C ${root} add split.txt deleted.txt`;
      await Bun.$`git -C ${root} -c user.name=test -c user.email=test@example.com commit -qm baseline`;
      await writeFile(join(root, "split.txt"), `${DEBT_PLUGIN}\n`);
      await Bun.$`git -C ${root} add split.txt`;
      await writeFile(join(root, "split.txt"), `${DEBT_COMMAND}\n`);
      await rm(join(root, "deleted.txt"));
      await symlink(DEBT_PLUGIN, join(root, "payload-link"));

      const captured = captureCandidate({ repositoryRoot: root, baseRef: "HEAD" });
      await writeFile(join(root, "split.txt"), "clean after capture\n");
      await rm(join(root, "payload-link"));

      const results = scanCapturedCandidate(basePolicy(), captured);
      expect(results.map(({ path, representation, state, ruleId, match }) => [path, representation, state, ruleId, match])).toEqual([
        ["deleted.txt", "worktree", "deleted", "candidate-deletion", ""],
        ["payload-link", "worktree", "present", "private-identifier", DEBT_PLUGIN],
        ["split.txt", "index", "present", "private-identifier", DEBT_PLUGIN],
        ["split.txt", "worktree", "present", "private-identifier", DEBT_COMMAND],
      ]);
      for (const result of results) {
        expect(result.candidateDigest).toBe(captured.manifestDigest);
        expect(result.byteDigest).toBe(captured.manifest.entries.find((entry) => entry.path === result.path && entry.representation === result.representation)?.digest);
      }
      expect(results[0]?.location).toBeNull();
      expect(results.slice(1).every((result) => result.location?.line === 1 && result.location.column === 1)).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("standalone scan rejects PNG, ZIP, and ELF magic-prefix payload substitution", async () => {
    const cases = [
      ["skills/law-econ-docx/examples/sample/figure1.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.from(DEBT_PLUGIN)])],
      ["skills/writing-legal/templates/law_econ_template.docx", Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Buffer.from(DEBT_PLUGIN)])],
      ["skills/wrds/scripts/parse_13f/parse_13f_go/parse_13f_go", Buffer.from([0x7f, 0x45, 0x4c, 0x46, ...Buffer.from(DEBT_PLUGIN)])],
    ] as const;
    for (const [path, bytes] of cases) {
      const root = await mkdtemp(join(tmpdir(), "privacy-prefix-"));
      try {
        await Bun.$`git -C ${root} init -q`;
        await writeFile(join(root, "policy.json"), JSON.stringify(basePolicy()));
        await Bun.$`git -C ${root} add policy.json`;
        await Bun.$`git -C ${root} -c user.name=test -c user.email=test@example.com commit -qm baseline`;
        const absolute = join(root, path);
        await Bun.$`mkdir -p ${join(absolute, "..")} `;
        await writeFile(absolute, bytes);
        await Bun.$`git -C ${root} add .`;
        try {
          const findings = await scanTrackedTree(root, "policy.json");
          expect(findings.some((finding) => finding.path === path && finding.match === DEBT_PLUGIN)).toBe(true);
        } catch (error) {
          expect(String(error)).toMatch(/binary inventory|binary.*digest|unclassified binary/i);
        }
      } finally { await rm(root, { recursive: true, force: true }); }
    }
  });

  test("rejects stale, substituted, and reordered candidate manifests before scanning", async () => {
    const root = await mkdtemp(join(tmpdir(), "privacy-candidate-auth-"));
    try {
      await Bun.$`git -C ${root} init -q`;
      await writeFile(join(root, "base.txt"), "base\n");
      await Bun.$`git -C ${root} add base.txt`;
      await Bun.$`git -C ${root} -c user.name=test -c user.email=test@example.com commit -qm baseline`;
      await writeFile(join(root, "a.txt"), `${DEBT_PLUGIN}\n`);
      await writeFile(join(root, "b.txt"), "clean\n");
      const captured = captureCandidate({ repositoryRoot: root, baseRef: "HEAD" });

      expect(() => scanCapturedCandidate(basePolicy(), { ...captured, manifestDigest: "0".repeat(64) })).toThrow(/manifest digest/i);

      const substitutedManifest = { ...captured.manifest, headCommit: "0".repeat(40) };
      expect(digestCandidateManifest(substitutedManifest)).not.toBe(captured.manifestDigest);
      expect(() => scanCapturedCandidate(basePolicy(), { ...captured, manifest: substitutedManifest })).toThrow(/manifest digest/i);

      const reorderedManifest = { ...captured.manifest, entries: [...captured.manifest.entries].reverse() };
      expect(() => scanCapturedCandidate(basePolicy(), { ...captured, manifest: reorderedManifest })).toThrow(/ordered|manifest digest/i);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("captured binary requires one exact accepted inventory disposition", async () => {
    const root = await mkdtemp(join(tmpdir(), "privacy-candidate-inventory-"));
    try {
      await Bun.$`git -C ${root} init -q`;
      await writeFile(join(root, "base.txt"), "base\n");
      await Bun.$`git -C ${root} add base.txt`;
      await Bun.$`git -C ${root} -c user.name=test -c user.email=test@example.com commit -qm baseline`;
      const bytes = Buffer.from([0xff, 0x00, ...Buffer.from(DEBT_PLUGIN)]);
      await writeFile(join(root, "reviewed.bin"), bytes);
      const digest = createHash("sha256").update(bytes).digest("hex");
      const valid = captureCandidate({
        repositoryRoot: root,
        baseRef: "HEAD",
        binaryInventory: [{ path: "reviewed.bin", representation: "worktree", digest, disposition: "preserve" }],
      });
      expect(scanCapturedCandidate(basePolicy(), valid)).toEqual([]);

      const candidateWith = (binaryInventory: unknown[]) => {
        const manifest = { ...valid.manifest, binaryInventory } as typeof valid.manifest;
        return { ...valid, manifest, manifestDigest: digestCandidateManifest(manifest) } as typeof valid;
      };
      expect(() => scanCapturedCandidate(basePolicy(), candidateWith([]))).toThrow(/binary inventory.*missing|missing.*binary inventory/i);
      expect(() => scanCapturedCandidate(basePolicy(), candidateWith([
        { path: "reviewed.bin", representation: "worktree", digest, disposition: "preserve" },
        { path: "reviewed.bin", representation: "worktree", digest, disposition: "preserve" },
      ]))).toThrow(/duplicate.*binary inventory/i);
      expect(() => scanCapturedCandidate(basePolicy(), candidateWith([
        { path: "reviewed.bin", representation: "worktree", digest: "0".repeat(64), disposition: "preserve" },
      ]))).toThrow(/digest.*bind|digest.*match/i);
      expect(() => scanCapturedCandidate(basePolicy(), candidateWith([
        { path: "reviewed.bin", representation: "worktree", digest, disposition: "skip" },
      ]))).toThrow(/disposition/i);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("accepts exact reviewed captured binary bytes without rereading paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "privacy-candidate-binary-"));
    try {
      await Bun.$`git -C ${root} init -q`;
      await writeFile(join(root, "base.txt"), "base\n");
      await Bun.$`git -C ${root} add base.txt`;
      await Bun.$`git -C ${root} -c user.name=test -c user.email=test@example.com commit -qm baseline`;
      const bytes = Buffer.from([255, 254, 253]);
      await writeFile(join(root, "opaque.bin"), bytes);
      const digest = createHash("sha256").update(bytes).digest("hex");
      const captured = captureCandidate({
        repositoryRoot: root,
        baseRef: "HEAD",
        binaryInventory: [{ path: "opaque.bin", representation: "worktree", digest, disposition: "preserve" }],
      });
      await rm(join(root, "opaque.bin"));
      expect(scanCapturedCandidate(basePolicy(), captured)).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("matches a long repeated-prefix allowance in linear time", () => {
    const token = `${"A".repeat(120_000)} Seminar 2028`;
    const policy = basePolicy();
    policy.allowlist = [{
      path: "hooks/bridge.ts",
      ruleId: "course-name",
      token,
      rationale: REQUIRED_RATIONALE,
      removeStage: 3,
    }];
    const started = performance.now();
    expect(scanFiles(policy, [{ path: "hooks/bridge.ts", content: token }])).toEqual([]);
    expect(performance.now() - started).toBeLessThan(500);
  });

  test("reports many matches in a large file with exact linear locations", () => {
    const rows = Array.from({ length: 20_000 }, (_, index) => `clean ${index}`).join("\n");
    const content = `${rows}\n${DEBT_PLUGIN}\n${rows}\n${DEBT_PLUGIN}\n`;
    const started = performance.now();
    const findings = scanFiles(basePolicy(), [{ path: "large.txt", content }]);
    expect(findings.map(({ line, column }) => [line, column])).toEqual([[20_001, 1], [40_002, 1]]);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  test("terminal scan uses captured bytes after a mutation seam and reports the authenticated digest", async () => {
    const root = await mkdtemp(join(tmpdir(), "privacy-terminal-capture-"));
    try {
      await Bun.$`git -C ${root} init -q`;
      await Bun.$`mkdir -p ${join(root, "policy")}`;
      await writeFile(join(root, "policy/public-privacy.json"), JSON.stringify(basePolicy()));
      await writeFile(join(root, "base.txt"), "base\n");
      await Bun.$`git -C ${root} add policy/public-privacy.json base.txt`;
      await Bun.$`git -C ${root} -c user.name=test -c user.email=test@example.com commit -qm baseline`;
      await writeFile(join(root, "secret.txt"), `${DEBT_PLUGIN}\n`);

      let capturedDigest = "";
      const findings = await scanTrackedTree(root, "policy/public-privacy.json", {
        afterCapture(candidate) {
          capturedDigest = candidate.manifestDigest;
          return writeFile(join(root, "secret.txt"), "clean after capture\n");
        },
      });
      expect(findings.map((finding) => finding.match)).toContain(DEBT_PLUGIN);
      expect(findings.every((finding) => finding.candidateDigest === capturedDigest)).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("real CLI rejects a Git pathname containing invalid UTF-8", async () => {
    const root = await mkdtemp(join(tmpdir(), "privacy-terminal-invalid-path-"));
    try {
      await Bun.$`git -C ${root} init -q`;
      await Bun.$`mkdir -p ${join(root, "policy")}`;
      await writeFile(join(root, "policy/public-privacy.json"), JSON.stringify(basePolicy()));
      await Bun.$`git -C ${root} add policy/public-privacy.json`;
      await Bun.$`git -C ${root} -c user.name=test -c user.email=test@example.com commit -qm baseline`;
      const python = Bun.spawnSync(["python3", "-c", "import os,sys; os.open(os.fsencode(sys.argv[1])+b'/bad-\\xff.txt', os.O_CREAT|os.O_WRONLY, 0o600)", root]);
      expect(python.exitCode).toBe(0);

      const cli = Bun.spawnSync(["bun", join(import.meta.dir, "../scripts/scan-public-privacy.ts"), root], { stdout: "pipe", stderr: "pipe" });
      expect(cli.exitCode).toBe(2);
      expect(cli.stderr.toString()).toMatch(/not a valid UTF-8 Git pathname/i);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("active public docs and code comments contain no unallowlisted private metadata", async () => {
    const findings = await scanTrackedTree(join(import.meta.dir, ".."));
    expect(findings).toEqual([]);
  });

  test("rejects stale allowlist entries that do not match current bytes", () => {
    const policy = basePolicy();
    policy.allowlist = [{ path: "hooks/bridge.ts", ruleId: "private-identifier", token: DEBT_PLUGIN, rationale: REQUIRED_RATIONALE, removeStage: 3 }];
    expect(() => scanFiles(policy, [{ path: "hooks/bridge.ts", content: "clean" }])).toThrow(/stale allowlist/);
  });
});
