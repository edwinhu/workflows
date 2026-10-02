import { afterAll, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, relative } from "path";

// rule-calibrate against a stub Jev: no network. The calibration set is built in a temp dir from the
// writing fixtures, each file renamed <kind>-<rule>.md so the stub can read which case it is scoring off
// the EVIDENCE line of the state. The stub stands in for the model; these tests pin the verdict logic.
const BASE = join(import.meta.dir, "../../..");
const SCRIPT = join(BASE, "skills/work/scripts/rule-calibrate.ts");
const RULES = ["W-ATTRIB", "W-HEDGE", "W-SIGNPOST", "W-BULLETS", "W-FIGURES"];
const tmp = mkdtempSync(join(tmpdir(), "rule-calibrate-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const rules: Record<string, any[]> = {};
for (const rule of RULES) {
  rules[rule] = (["vio", "sat"] as const).map(twin => {
    const dir = join(tmp, "cases", rule, twin);
    mkdirSync(dir, { recursive: true });
    copyFileSync(join(BASE, "tests/fixtures/jev", rule, twin, "test.md"), join(dir, `${twin}-${rule}.md`));
    return { kind: twin === "vio" ? "violating" : "compliant", path: dir };
  });
}
const MANIFEST = join(tmp, "calibration.json");
writeFileSync(MANIFEST, JSON.stringify({
  criterion: { violatingAtLeast: 0.85, compliantBelow: 0.5, crossFlagAbove: 0.5 },
  sets: { writing: { rulesDir: "constraints/jev/writing", uncalibratedDir: "constraints/jev/writing/uncalibrated", layout: "files", rules } },
}));

// p(rule, kind, owner): the default is a perfectly calibrated model; `override` replaces single cells.
async function calibrate(override: (rule: string, kind: string, owner: string) => number | undefined = () => undefined, opts: { down?: boolean; json?: boolean; manifest?: string } = {}) {
  const seen: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = JSON.parse(await req.text());
      const m = /\(rule (\S+)\)/.exec(body.questions.q0.instructions);
      if (!m) return Response.json({ answers: { q0: { probabilities: { YES: 1 } } } });
      const rule = m[1];
      const [, kind, owner] = /EVIDENCE: (vio|sat)-(\S+)\.md/.exec(body.state)!;
      seen.push(`${rule}:${kind}-${owner}`);
      const p = override(rule, kind, owner) ?? (kind === "vio" && owner === rule ? 0.95 : 0.05);
      return Response.json({ answers: { q0: { probabilities: { VIOLATED: p } } } });
    },
  });
  const port = server.port;
  if (opts.down) server.stop(true);
  const args = ["bun", SCRIPT, "--manifest", opts.manifest ?? MANIFEST, "--set", "writing", "--runs", "2"];
  if (opts.json) args.push("--json");
  // async spawn: a spawnSync would block the event loop the stub answers on
  const proc = Bun.spawn(args, {
    env: { ...process.env, WORK_HOLD_DECISIONS_URL: `http://localhost:${port}/`, WORK_HOLD_JUDGE_TOKEN: "test-token", FARM_OUTCOMES: join(tmp, ".farm-outcomes.jsonl") },
    stdout: "pipe", stderr: "pipe",
  });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  if (!opts.down) server.stop(true);
  return { code, out, err, seen };
}

test("exit 0 when every case is inside the criterion; every violating case is cross-scored by every rule", async () => {
  const r = await calibrate();
  expect(r.code).toBe(0);
  expect(r.out).toContain("All wired rules within the criterion.");
  expect(r.out).toContain("Cross-rule hits: none");
  // 5 violating cases x 5 rules + 5 compliant cases x own rule, twice
  expect(r.seen.length).toBe(2 * (25 + 5));
  expect(r.seen).toContain("W-ATTRIB:vio-W-HEDGE");
}, 60000);

test("exit 1 when a wired rule's violating case scores 0.6", async () => {
  const r = await calibrate((rule, kind, owner) => (rule === "W-HEDGE" && kind === "vio" && owner === "W-HEDGE" ? 0.6 : undefined));
  expect(r.code).toBe(1);
  expect(r.out).toMatch(/writing\/W-HEDGE\s+wired\s+.*vio\s+violating\s+0\.60\s+0\.60\s+FAIL/);
  expect(r.out).toContain("FAIL: wired rule(s) outside the criterion: writing/W-HEDGE");
}, 60000);

test("a passing uncalibrated rule is reported ready to wire, a failing one is not, and neither moves the exit", async () => {
  const r = await calibrate((rule, kind) => (rule === "W-FIGURES" && kind === "sat" ? 0.7 : undefined), { json: true });
  expect(r.code).toBe(0);
  const out = JSON.parse(r.out);
  const status = Object.fromEntries(out.rules.map((s: any) => [s.rule, s.status]));
  expect(status).toEqual({ "W-ATTRIB": "pass", "W-HEDGE": "pass", "W-SIGNPOST": "pass", "W-BULLETS": "ready to wire", "W-FIGURES": "not ready" });
  expect(out.rules.find((s: any) => s.rule === "W-BULLETS").wired).toBe(false);
  const text = await calibrate();
  expect(text.out).toContain("Ready to wire (not wired automatically): writing/W-BULLETS, writing/W-FIGURES");
}, 60000);

test("exit 2 with a clear message when Jev is down, never a pass", async () => {
  const r = await calibrate(undefined, { down: true });
  expect(r.code).toBe(2);
  expect(r.err).toContain("Jev unavailable");
  expect(r.err).toContain("This is not a pass.");
  expect(r.out).toBe("");
}, 60000);

test("a rule scoring another rule's violating case above 0.5 is a flagged cross-rule hit", async () => {
  const r = await calibrate((rule, kind, owner) => (rule === "W-ATTRIB" && kind === "vio" && owner === "W-HEDGE" ? 0.7 : undefined));
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/W-HEDGE \S*vio-?\S*\s.*0\.70\*/);
  expect(r.out).toContain("Cross-rule hits:\n  writing/W-ATTRIB on W-HEDGE's");
  expect(r.out).not.toContain("Cross-rule hits: none");
}, 60000);

test("a manifest with a root resolves its rules and case paths against that root, not this repo", async () => {
  // a plugin shipping its own rule set (teaching) keeps its manifest in its own tree, paths relative
  const sub = join(tmp, "plugin", "tests");
  mkdirSync(sub, { recursive: true });
  const rel: Record<string, any[]> = {};
  for (const [rule, cases] of Object.entries(rules)) rel[rule] = cases.map(c => ({ ...c, path: relative(tmp, c.path) }));
  const manifest = join(sub, "calibration.json");
  writeFileSync(manifest, JSON.stringify({
    root: "../..",
    criterion: { violatingAtLeast: 0.85, compliantBelow: 0.5, crossFlagAbove: 0.5 },
    sets: { writing: { rulesDir: relative(tmp, join(BASE, "constraints/jev/writing")), uncalibratedDir: relative(tmp, join(BASE, "constraints/jev/writing/uncalibrated")), layout: "files", rules: rel } },
  }));
  const r = await calibrate(undefined, { manifest });
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  expect(r.out).toContain("All wired rules within the criterion.");
  expect(r.seen).toContain("W-HEDGE:vio-W-HEDGE");
}, 60000);
