// The source-identity constraint: the source the caption maps to must contain the caption's own
// reporter citation, so a stale or mis-picked export cannot verify an excerpt "verbatim".
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { useTmp } from "../../../tests/helpers/tmp.ts";

const mkTmp = useTmp();
const REPO = path.join(import.meta.dir, "..", "..", "..");
const SCRIPT = path.join(REPO, "checks", "elide", "constraints", "check-source-identity.py");
const WCHECK = path.join(REPO, "bin", "workflow-check");

const CAPTION = "SECURITIES AND EXCHANGE COMMISSION v. LIFE PARTNERS, INC.";
const typ = (cite: string) =>
  `#pagebreak()\n\n#align(center)[\n  #text(13pt, weight: "bold")[${CAPTION}]\n\n` +
  `  United States Court of Appeals, District of Columbia Circuit \\\n${cite}  1996\n]\n\nBody.\n`;

/** A flat-OPC docx (document.xml at the zip root, as Westlaw exports it) holding one paragraph. */
function docx(out: string, text: string) {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
  const driver = `
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w") as z:
    z.writestr("document.xml", sys.stdin.read())
    z.writestr("footnotes.xml", "<a/>")
`;
  const r = spawnSync("python3", ["-c", driver, out], { input: xml, encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) throw new Error(r.stderr);
}

function project(name: string, cite: string, sourceText: string) {
  const dir = path.join(mkTmp("srcid-"), name);
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  const t = path.join(dir, "a.typ");
  fs.writeFileSync(t, typ(cite));
  const d = path.join(dir, "docs", "SEC-v-Life-Partners-87-F3d-536-DC-Cir-1996.westlaw.docx");
  docx(d, sourceText);
  return { dir, typ: t, docx: d };
}

const run = (p: { dir: string; typ: string; docx: string }, runner: "script" | "wcheck") => {
  const args = ["--project-dir", p.dir, "--files", p.typ, p.docx];
  const r =
    runner === "script"
      ? spawnSync("python3", [SCRIPT, ...args], { encoding: "utf8", timeout: 120_000 })
      : spawnSync("python3", [WCHECK, "elide", "--constraints-only", ...args], { encoding: "utf8", timeout: 120_000 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};

describe("check-source-identity", () => {
  test("passes when the mapped docx carries the caption's reporter citation", () => {
    const p = project("right", "87 F.3d 536", "Life Partners, Inc. 87 F.3d 536 (D.C. Cir. 1996) Opinion text.");
    const { code, out } = run(p, "script");
    expect(out).toContain("1 reading");
    expect(code).toBe(0);
  });

  test("fails when the mapped docx is another opinion (a stale or mis-picked export)", () => {
    const p = project("wrong", "87 F.3d 536", "Mutual Benefits Corp. 408 F.3d 737 (11th Cir. 2005) Opinion text.");
    const { code, out } = run(p, "script");
    expect(out).toContain("87 F.3d 536");
    expect(out).toContain("not found in");
    expect(code).toBe(1);
  });

  test("a citation whose digits only occur inside a longer number does not match", () => {
    const p = project("embedded", "87 F.3d 536", "Some Case 187 F.3d 5360 (D.C. Cir. 1996).");
    expect(run(p, "script").code).toBe(1);
  });

  test("fails closed when the caption block carries no reporter citation", () => {
    const p = project("nocite", "", "Life Partners, Inc. 87 F.3d 536 (D.C. Cir. 1996).");
    const { code, out } = run(p, "script");
    expect(out).toContain("no reporter citation");
    expect(code).toBe(1);
  });

  test("a plain-text fallback source with no reporter citation is reported, not failed", () => {
    const p = project("slip", "87 F.3d 536", "unused");
    const txt = p.docx.replace(/\.westlaw\.docx$/, ".txt");
    fs.rmSync(p.docx);
    fs.writeFileSync(txt, "IN THE UNITED STATES COURT OF APPEALS FOR THE DISTRICT OF COLUMBIA CIRCUIT No. 95-5116\n");
    const { code, out } = run({ ...p, docx: txt }, "script");
    expect(out).toContain("IDENTITY NOT CHECKED");
    expect(code).toBe(0);
  });

  test("is a leg of the elide constraints runner, so check.sh reaches it", () => {
    const p = project("runner", "87 F.3d 536", "Mutual Benefits Corp. 408 F.3d 737 (11th Cir. 2005) Opinion text.");
    const { out } = run(p, "wcheck");
    expect(out).toContain("check-source-identity");
    expect(out).toContain("87 F.3d 536");
  });
});
