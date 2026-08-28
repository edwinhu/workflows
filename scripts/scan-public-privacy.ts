#!/usr/bin/env bun
import { createHash } from "node:crypto";

import { readFile, stat } from "node:fs/promises";
import { isAbsolute, posix, resolve } from "node:path";
import {
  captureCandidate,
  digestCandidateManifest,
  parseCandidateManifest,
  type CapturedCandidate,
  type CandidateRepresentation,
  type CandidateState,
} from "../workflows/lib/candidate-manifest";

export interface DenyRule {
  id: string;
  pattern: string;
  flags?: string;
}

export interface PrivacyAllowance {
  path: string;
  ruleId: string;
  token: string;
  rationale: string;
  removeStage: number;
}

export interface PrivacyPolicy {
  version: number;
  scanRoots: string[];
  exclusions: string[];
  denyRules: DenyRule[];
  allowlist: PrivacyAllowance[];
}

export interface PrivacyFile {
  path: string;
  content: string;
}

export interface PrivacyFinding {
  path: string;
  line: number;
  column: number;
  ruleId: string;
  match: string;
}

export interface CandidatePrivacyFinding {
  candidateDigest: string;
  path: string;
  representation: CandidateRepresentation;
  state: CandidateState;
  byteDigest: string;
  location: { line: number; column: number } | null;
  ruleId: string;
  match: string;
}

export class PrivacyPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivacyPolicyError";
  }
}

const REQUIRED_RATIONALE = "live reverse integration until private Stage 2 passes";
const GLOB_META = /[*?{}[\]]/;
const REQUIRED_SCAN_ROOTS = ["."];
const REQUIRED_EXCLUSIONS = [".git/**", ".planning/**", "node_modules/**", "scratch/**", "bun.lock"];
const DEBT_COMMAND_PATTERN = ["teaching", ":find-slide-page"].join("");
const DEBT_PLUGIN_PATTERN = ["teaching", "-plugin"].join("");
const TEACHING_CACHE_PATTERN = ["teaching", "teaching"].join("\\/");
const ACCEPTED_BINARY_DISPOSITIONS = new Set(["preserve"]);
// Code-owned: the only tracked binaries this repo may publish, each pinned to its REVIEWED sha256.
// A binary outside this list has no disposition and fails the scan; a listed one whose bytes change
// fails on the digest. Both are the point — a preserved binary is never text-scanned, so the digest
// is the only thing standing between a payload and publication. Re-review before repinning.
const PRESERVED_BINARIES: ReadonlyArray<{ path: string; digest: string }> = [
  { path: "skills/law-econ-docx/examples/sample/figure1.png", digest: "70a977e0f296010321ccf92afa731b46d9e66dc52efbb7067474efaccb21f775" },
  { path: "skills/workshop/fixtures/clean/presentation/notes.pdf", digest: "a75cde5738b43c406c2df69436bc37efbbe573e83fbdde0c3b92597410220016" },
  { path: "skills/workshop/fixtures/clean/presentation/slides.pdf", digest: "4df2355eaa9d1e8495130f32833199f92617bd5ab986c1b96c0c551a63ded609" },
  { path: "skills/wrds/scripts/parse_13f/parse_13f_go/parse_13f_go", digest: "b445eb303ff6395c40a54af52f30c464e42a65dec074f3edd9621fc4d2c98ad2" },
  { path: "skills/wrds/scripts/parse_npx/parse_npx_go/parse_npx_go", digest: "3b8f4edae61a4f099e65a612d6fc187d0a043bb07db3eb47b3a75917b466b048" },
  { path: "references/templates/law_econ_template.docx", digest: "368ce014d5c452672fa1c70aa093a5a5dae264207284b91cbe581e61b7f8e57e" },
  { path: "references/templates/law_review_template.docx", digest: "f53eca12fa5b3e575cbfcb589b5f2d190e3b375bc89a8f378227dfe61c40c7f6" },
];
const REQUIRED_DENY_RULES: DenyRule[] = [
  { id: "private-identifier", pattern: `(?:${DEBT_COMMAND_PATTERN}|${DEBT_PLUGIN_PATTERN}|private (?:repository|repo|plugin|consumer))`, flags: "gi" },
  { id: "cache-path", pattern: `\\.claude\\/plugins\\/cache\\/${TEACHING_CACHE_PATTERN}\\/`, flags: "g" },
  { id: "course-name", pattern: "\\b[A-Z][A-Za-z& -]+ (?:Seminar|Course) 20\\d{2}\\b", flags: "g" },
  { id: "private-provenance", pattern: "\\b(?:developed|extracted|migrated|copied) (?:in|from|for) (?:the )?private (?:repository|repo|plugin|consumer)\\b", flags: "gi" },
];

function exactRelativePath(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || isAbsolute(value) || value.includes("\\") || GLOB_META.test(value)) {
    throw new PrivacyPolicyError(`${label} must be an exact project-relative file`);
  }
  const normalized = posix.normalize(value);
  if (normalized !== value || value === "." || value.startsWith("../") || value.includes("/../")) {
    throw new PrivacyPolicyError(`${label} must be an exact project-relative file`);
  }
  return value;
}

function validateRule(rule: DenyRule, ids: Set<string>): void {
  if (!rule || typeof rule.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(rule.id) || ids.has(rule.id)) {
    throw new PrivacyPolicyError("deny rule ids must be unique kebab-case strings");
  }
  if (typeof rule.pattern !== "string" || rule.pattern.length === 0) {
    throw new PrivacyPolicyError(`deny rule ${rule.id} requires a pattern`);
  }
  const flags = rule.flags ?? "g";
  if (!flags.includes("g") || /[^dgimsuvy]/.test(flags)) {
    throw new PrivacyPolicyError(`deny rule ${rule.id} flags must include g and be valid`);
  }
  try {
    new RegExp(rule.pattern, flags);
  } catch {
    throw new PrivacyPolicyError(`deny rule ${rule.id} has an invalid pattern`);
  }
  ids.add(rule.id);
}

export function validatePrivacyPolicy(input: PrivacyPolicy): PrivacyPolicy {
  if (!input || input.version !== 1) throw new PrivacyPolicyError("policy version must be 1");
  if (JSON.stringify(input.scanRoots) !== JSON.stringify(REQUIRED_SCAN_ROOTS)) {
    throw new PrivacyPolicyError('scanRoots must be exactly ["."]');
  }
  if (JSON.stringify(input.exclusions) !== JSON.stringify(REQUIRED_EXCLUSIONS)) {
    throw new PrivacyPolicyError("exclusions must exactly match the code-owned public scan contract");
  }
  if (JSON.stringify(input.denyRules) !== JSON.stringify(REQUIRED_DENY_RULES)) {
    throw new PrivacyPolicyError("denyRules must exactly match the code-owned public privacy contract");
  }
  if (!Array.isArray(input.allowlist)) throw new PrivacyPolicyError("allowlist must be an array");

  const ids = new Set<string>();
  for (const rule of input.denyRules) validateRule(rule, ids);

  const allowanceKeys = new Set<string>();
  for (const allowance of input.allowlist) {
    exactRelativePath(allowance?.path, "allowlist path");
    if (!ids.has(allowance?.ruleId)) throw new PrivacyPolicyError("allowlist ruleId must name a known deny rule");
    if (typeof allowance?.token !== "string" || allowance.token.length === 0 || GLOB_META.test(allowance.token) || allowance.token.includes(".*")) {
      throw new PrivacyPolicyError("allowlist token must be a non-empty literal token");
    }
    if (allowance.rationale !== REQUIRED_RATIONALE) throw new PrivacyPolicyError(`allowlist rationale must be: ${REQUIRED_RATIONALE}`);
    if (allowance.removeStage !== 3) throw new PrivacyPolicyError("allowlist removeStage must be 3");
    const key = `${allowance.path}\0${allowance.ruleId}\0${allowance.token}`;
    if (allowanceKeys.has(key)) throw new PrivacyPolicyError("allowlist entries must be unique");
    allowanceKeys.add(key);
  }
  return input;
}

function inScanRoots(path: string, roots: string[]): boolean {
  return roots.some((root) => root === "." || path === root || path.startsWith(`${root}/`));
}

function excluded(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3);
      return path === prefix || path.startsWith(`${prefix}/`);
    }
    return path === pattern;
  });
}

function newlineOffsets(content: string): number[] {
  const offsets = [-1];
  for (let index = content.indexOf("\n"); index !== -1; index = content.indexOf("\n", index + 1)) offsets.push(index);
  return offsets;
}

function location(offsets: number[], index: number): { line: number; column: number } {
  let low = 0;
  let high = offsets.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] < index) low = middle;
    else high = middle;
  }
  return { line: low + 1, column: index - offsets[low] };
}

class PrivacyScanner {
  private readonly usedAllowances = new Set<number>();
  private readonly findings: PrivacyFinding[] = [];
  private readonly exactAllowances = new Map<string, number>();
  private readonly scannedPaths = new Set<string>();

  constructor(private readonly policy: PrivacyPolicy) {
    for (let index = 0; index < policy.allowlist.length; index++) {
      const allowance = policy.allowlist[index];
      this.exactAllowances.set(`${allowance.path}\0${allowance.ruleId}\0${allowance.token}`, index);
    }
  }

  scan(file: PrivacyFile): void {
    const path = exactRelativePath(file.path, "scanned path");
    if (!inScanRoots(path, this.policy.scanRoots) || excluded(path, this.policy.exclusions)) return;
    this.scannedPaths.add(path);
    const offsets = newlineOffsets(file.content);
    for (const rule of this.policy.denyRules) {
      const regex = new RegExp(rule.pattern, rule.flags ?? "g");
      for (const match of file.content.matchAll(regex)) {
        if (match.index === undefined || match[0].length === 0) continue;
        const allowanceIndex = this.exactAllowances.get(`${path}\0${rule.id}\0${match[0]}`);
        if (allowanceIndex !== undefined) {
          this.usedAllowances.add(allowanceIndex);
          continue;
        }
        this.findings.push({ path, ...location(offsets, match.index), ruleId: rule.id, match: match[0] });
      }
    }
  }

  finish(enforceStaleAllowances = true): PrivacyFinding[] {
    const stale = enforceStaleAllowances
      ? this.policy.allowlist.filter((allowance, index) => this.scannedPaths.has(allowance.path) && !this.usedAllowances.has(index))
      : [];
    if (stale.length > 0) {
      const labels = stale.map((item) => `${item.path}:${item.ruleId}:${item.token}`).sort().join(", ");
      throw new PrivacyPolicyError(`stale allowlist entries: ${labels}`);
    }
    return this.findings.sort((a, b) =>
      a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column || a.ruleId.localeCompare(b.ruleId) || a.match.localeCompare(b.match)
    );
  }
}

export function scanFiles(input: PrivacyPolicy, files: PrivacyFile[]): PrivacyFinding[] {
  const scanner = new PrivacyScanner(validatePrivacyPolicy(input));
  for (const file of files) scanner.scan(file);
  return scanner.finish();
}

export function scanCapturedCandidate(input: PrivacyPolicy, candidate: CapturedCandidate): CandidatePrivacyFinding[] {
  const policy = validatePrivacyPolicy(input);
  const manifest = parseCandidateManifest(candidate.manifest);
  const actualManifestDigest = digestCandidateManifest(manifest);
  if (candidate.manifestDigest !== actualManifestDigest) {
    throw new PrivacyPolicyError(`candidate manifest digest mismatch: expected ${actualManifestDigest}, received ${candidate.manifestDigest}`);
  }
  const results: CandidatePrivacyFinding[] = [];
  for (const entry of manifest.entries) {
    if (!inScanRoots(entry.path, policy.scanRoots) || excluded(entry.path, policy.exclusions)) continue;
    if (entry.state === "deleted") {
      results.push({
        candidateDigest: candidate.manifestDigest,
        path: entry.path,
        representation: entry.representation,
        state: entry.state,
        byteDigest: entry.digest,
        location: null,
        ruleId: "candidate-deletion",
        match: "",
      });
      continue;
    }
    const bytes = Buffer.from(candidate.bytes(entry.path, entry.representation));
    const byteDigest = digest(bytes);
    if (byteDigest !== entry.digest) {
      throw new PrivacyPolicyError(`captured bytes digest does not match candidate entry: ${entry.path} (${entry.representation})`);
    }
    if (entry.binary) {
      requireReviewedBinary(candidate, entry.path, entry.representation, entry.digest);
      continue;
    }
    const decoded = decodeTextCandidate(entry.path, bytes, entry.representation);
    const content = entry.path === "policy/public-privacy.json" ? policySafeContent(decoded) : decoded;
    const scanner = new PrivacyScanner(policy);
    scanner.scan({ path: entry.path, content });
    for (const finding of scanner.finish(false)) {
      results.push({
        candidateDigest: candidate.manifestDigest,
        path: finding.path,
        representation: entry.representation,
        state: entry.state,
        byteDigest: entry.digest,
        location: { line: finding.line, column: finding.column },
        ruleId: finding.ruleId,
        match: finding.match,
      });
    }
  }
  return results.sort((a, b) =>
    a.path.localeCompare(b.path) || a.representation.localeCompare(b.representation)
    || (a.location?.line ?? 0) - (b.location?.line ?? 0)
    || (a.location?.column ?? 0) - (b.location?.column ?? 0)
    || a.ruleId.localeCompare(b.ruleId) || a.match.localeCompare(b.match)
  );
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireReviewedBinary(candidate: CapturedCandidate, path: string, representation: CandidateRepresentation, byteDigest: string): void {
  const matches = candidate.manifest.binaryInventory.filter((item) => item.path === path && item.representation === representation);
  if (matches.length === 0) throw new PrivacyPolicyError(`binary inventory missing disposition for ${path} (${representation})`);
  if (matches.length > 1) throw new PrivacyPolicyError(`duplicate binary inventory entry for ${path} (${representation})`);
  const disposition = matches[0]!;
  if (disposition.digest !== byteDigest) throw new PrivacyPolicyError(`binary inventory digest does not bind candidate entry: ${path} (${representation})`);
  if (!ACCEPTED_BINARY_DISPOSITIONS.has(disposition.disposition)) {
    throw new PrivacyPolicyError(`invalid binary inventory disposition for ${path} (${representation})`);
  }
}

function decodeTextCandidate(path: string, bytes: Buffer, representation?: CandidateRepresentation): string {
  const evenNuls = bytes.filter((value, index) => index % 2 === 0 && value === 0).length;
  const oddNuls = bytes.filter((value, index) => index % 2 === 1 && value === 0).length;
  const pairs = Math.floor(bytes.length / 2);
  if (pairs > 0 && oddNuls > pairs / 3 && evenNuls < pairs / 8) return new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
  if (pairs > 0 && evenNuls > pairs / 3 && oddNuls < pairs / 8) {
    const swapped = Buffer.from(bytes);
    for (let index = 0; index + 1 < swapped.length; index += 2) [swapped[index], swapped[index + 1]] = [swapped[index + 1], swapped[index]];
    return new TextDecoder("utf-16le", { fatal: true }).decode(swapped);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {}
  throw new PrivacyPolicyError(`unclassified binary candidate file: ${path}${representation ? ` (${representation})` : ""}`);
}

function policySafeContent(content: string): string {
  const parsed = JSON.parse(content) as PrivacyPolicy;
  return JSON.stringify({
    ...parsed,
    denyRules: parsed.denyRules.map((rule) => ({ ...rule, pattern: "<code-owned-deny-pattern>" })),
    allowlist: parsed.allowlist.map((allowance) => ({ ...allowance, token: "<reviewed-token>", rationale: "<reviewed-rationale>" })),
  });
}

export interface ScanTrackedTreeOptions {
  afterCapture?: (candidate: CapturedCandidate) => void | Promise<void>;
}

interface CapturedPrivacyScan {
  candidate: CapturedCandidate;
  findings: CandidatePrivacyFinding[];
}

async function captureAndScanTrackedTree(
  root: string,
  policyPath: string,
  options: ScanTrackedTreeOptions,
): Promise<CapturedPrivacyScan> {
  const canonicalRoot = resolve(root);
  const rootStat = await stat(canonicalRoot);
  if (!rootStat.isDirectory()) throw new Error(`scan root is not a directory: ${canonicalRoot}`);
  const policy = JSON.parse(await readFile(resolve(canonicalRoot, policyPath), "utf8")) as PrivacyPolicy;
  validatePrivacyPolicy(policy);
  // Authorization is the code-owned path list; captureCandidate binds each disposition to the bytes
  // it actually captured, and a path this candidate does not carry contributes nothing.
  const binaryInventory = PRESERVED_BINARIES.flatMap(({ path, digest: reviewed }) =>
    (["index", "worktree"] as const).map((representation) => ({ path, representation, digest: reviewed, disposition: "preserve" })));
  const candidate = captureCandidate({ repositoryRoot: canonicalRoot, baseRef: "HEAD", binaryInventory });
  await options.afterCapture?.(candidate);
  const findings: CandidatePrivacyFinding[] = [];
  const seen = new Set<string>();
  for (const finding of scanCapturedCandidate(policy, candidate)) {
    if (finding.ruleId === "candidate-deletion") continue;
    const key = `${finding.path}\0${finding.byteDigest}\0${finding.ruleId}\0${finding.match}\0${finding.location?.line ?? 0}\0${finding.location?.column ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push(finding);
  }
  return { candidate, findings };
}

export async function scanTrackedTree(
  root: string,
  policyPath = "policy/public-privacy.json",
  options: ScanTrackedTreeOptions = {},
): Promise<CandidatePrivacyFinding[]> {
  return (await captureAndScanTrackedTree(root, policyPath, options)).findings;
}

async function main(): Promise<void> {
  const root = resolve(process.argv[2] ?? import.meta.dir, process.argv[2] ? "." : "..");
  try {
    const { candidate, findings } = await captureAndScanTrackedTree(root, "policy/public-privacy.json", {});
    for (const finding of findings) {
      const location = finding.location === null ? "deletion" : `${finding.location.line}:${finding.location.column}`;
      console.error(`${finding.path}:${location} [${finding.representation}:${finding.ruleId}] ${JSON.stringify(finding.match)}`);
    }
    if (findings.length > 0) {
      console.error(`public privacy scan failed: ${findings.length} finding(s); candidate manifest ${candidate.manifestDigest}`);
      process.exitCode = 1;
    } else {
      console.log(`public privacy scan passed: 0 findings; candidate manifest ${candidate.manifestDigest}`);
    }
  } catch (error) {
    console.error(`public privacy scan error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

if (import.meta.main) await main();
