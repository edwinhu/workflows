import { afterAll, expect, test } from "bun:test";
import { $ } from "bun";
import { join } from "path";
import * as fs from "fs";
import * as os from "os";
import { useTmp } from "../../../tests/helpers/tmp.ts";

const mkTmp = useTmp();

// The ds rules under checks/ds/rules: extractor state on each rule's fixtures, and rule-check.ts
// against a local stub Jev. No network.

const WIRED = ["A1", "A4", "DEN", "DQ4", "DQ6", "E7", "M1", "R1", "UNI"];
const UNCALIBRATED = ["DQ1"];
const RULES = [...WIRED, ...UNCALIBRATED];
const BASE_DIR = join(import.meta.dir, "../../..");
const PY = join(BASE_DIR, "checks/_jev/evidence.py");
const DS_DIR = join(BASE_DIR, "checks/ds/rules");
const UNCAL_DIR = join(DS_DIR, "uncalibrated");
const FIX = join(BASE_DIR, "tests/fixtures/jev");
const made: string[] = [];
afterAll(() => made.forEach(d => fs.rmSync(d, { recursive: true, force: true })));

async function getEvidence(rule: string, twin: "sat" | "vio") {
    const file = join(FIX, `${rule}/${twin}/test.${rule === "A4" ? "md" : "py"}`);
    const dir = ["--rules-dir", UNCALIBRATED.includes(rule) ? UNCAL_DIR : DS_DIR];
    const { stdout } = await $`python3 ${PY} --files ${file} ${dir}`.quiet();
    return JSON.parse(stdout.toString());
}

// A vio2/sat2 fixture dir: the one code or prose file, and plan.md when the rule reads a plan.
function twin2(rule: string, kase: "vio2" | "sat2") {
    const dir = join(FIX, rule, kase);
    const names = fs.readdirSync(dir);
    return { dir, file: names.find(n => n !== "plan.md")!, plan: names.includes("plan.md") ? "plan.md" : null };
}

async function state2(rule: string, kase: "vio2" | "sat2") {
    const { dir, file, plan } = twin2(rule, kase);
    const p = plan ? ["--plan", join(dir, plan)] : [];
    const { stdout } = await $`python3 ${PY} --rules-dir ${DS_DIR} --root ${dir} --files ${join(dir, file)} ${p}`.quiet();
    return JSON.parse(stdout.toString())[rule].state;
}

test("evidence.py discovers only the wired rules; the uncalibrated ones sit below the glob", async () => {
    expect(Object.keys(await getEvidence("A1", "sat"))).toEqual(WIRED);
    expect(Object.keys(await getEvidence("DQ1", "sat"))).toEqual(UNCALIBRATED);
});

test("every rule's criteria carry the four options", async () => {
    const state = { ...(await getEvidence("A1", "sat")), ...(await getEvidence("DQ1", "sat")) };
    for (const r of RULES) {
        expect(Object.keys(state[r].criteria).sort()).toEqual([
            "INSUFFICIENT_EVIDENCE",
            "NOT_APPLICABLE",
            "SATISFIED",
            "VIOLATED"
        ]);
    }
});

test("A1 old twins are comment-only and read N/A: no estimator, so no specification curve site", async () => {
    for (const twin of ["vio", "sat"] as const) {
        const st = (await getEvidence("A1", twin)).A1.state;
        expect(st.n_estimation_sites).toBe(0);
        expect(st.n_specification_curve_sites).toBe(0);
    }
});

test("A1 counts winsorizing and subsamples as specification choices, and a placebo loop as a check, not a curve", async () => {
    const vio = await state2("A1", "vio2");
    expect(vio.n_specification_curve_sites).toBe(1);
    expect(vio.n_robustness_check_sites).toBe(0);
    const sat = await state2("A1", "sat2");
    expect(sat.n_estimation_sites).toBe(2);
    expect(sat.n_specification_curve_sites).toBe(1);
    expect(sat.estimations_inside_a_robustness_loop.length).toBe(1);
    expect(sat.robustness_check_kinds).toEqual(["placebo", "resampling_inference"]);
});

// The count each extractor reports for its defect: [field, on vio2, on sat2]. The stub Jev below
// reads the same field, so a block means the defect reached the state.
const DEFECT: Record<string, [string, number, number]> = {
    A1: ["n_specification_curve_sites_without_robustness_check", 1, 0],
    A4: ["n_main_result_tables_without_figure", 1, 0],
    DEN: ["n_rates_without_base", 2, 0],
    DQ4: ["n_transforms_without_output_count", 5, 0],
    DQ6: ["n_transforms_without_before_and_after", 1, 0],
    E7: ["n_clients_failing_a_fact", 1, 0],
    M1: ["n_writes_outside_plan_paths", 2, 0],
    R1: ["n_unseeded_draws", 2, 0],
    UNI: ["n_columns_filtered_literally_at_2_or_more_sites", 2, 0],
};

for (const rule of Object.keys(DEFECT)) {
    const [field, vio, sat] = DEFECT[rule];
    test(`${rule} state: ${field} is ${vio} on vio2 and ${sat} on sat2`, async () => {
        expect((await state2(rule, "vio2"))[field]).toBe(vio);
        expect((await state2(rule, "sat2"))[field]).toBe(sat);
    });
}

test("M1 state records whether a plan was supplied", async () => {
    expect((await state2("M1", "vio2")).plan_supplied).toBe(true);
    expect((await getEvidence("M1", "vio")).M1.state.plan_supplied).toBe(false);
});

async function ruleCheck(rule: string, kase: "vio2" | "sat2") {
    const { dir, file, plan } = twin2(rule, kase);
    const d = mkTmp(`jev-ds-${rule}-${kase}-`);
    made.push(d);
    fs.cpSync(dir, d, { recursive: true });
    const server = Bun.serve({
        port: 0,
        async fetch(req) {
            const body = JSON.parse(await req.text());
            const r = /\(rule (\w+)\)/.exec(body.questions.q0.instructions)![1];
            const state = JSON.parse(body.state.slice(body.state.indexOf("{")));
            const p = DEFECT[r] && state[DEFECT[r][0]] > 0 ? 0.95 : 0.05;
            return Response.json({ answers: { q0: { probabilities: { VIOLATED: p }, choice: p > 0.5 ? "VIOLATED" : "SATISFIED" } } });
        },
    });
    const args = ["--workflow", "ds", "--project-dir", d, "--files", join(d, file), ...(plan ? ["--plan", join(d, plan)] : [])];
    // async spawn: a spawnSync would block the event loop the stub answers on
    const proc = Bun.spawn(["bun", join(import.meta.dir, "rule-check.ts"), ...args], {
        env: { ...process.env, WORK_HOLD_DECISIONS_URL: `http://localhost:${server.port}/`, WORK_HOLD_JUDGE_TOKEN: "test-token", FARM_OUTCOMES: join(d, ".farm-outcomes.jsonl") },
        stdout: "pipe", stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    server.stop(true);
    const out = JSON.parse(stdout.trim().split("\n").pop()!);
    return { code, verdict: out.verdicts.find((v: any) => v.rule === rule).verdict };
}

for (const rule of Object.keys(DEFECT)) {
    test(`${rule}: rule-check blocks vio2 and passes sat2`, async () => {
        const vio = await ruleCheck(rule, "vio2");
        expect(vio.code).toBe(2);
        expect(vio.verdict).toBe("VIOLATED");
        const sat = await ruleCheck(rule, "sat2");
        expect(sat.verdict).toBe("MET");
    }, 30000);
}

test('evidence.py labels files relative to --root', async () => {
    const tmpDir = mkTmp('jev-evidence-root-');
    made.push(tmpDir);
    fs.mkdirSync(join(tmpDir, 'data', 'output'), { recursive: true });
    const testFile = join(tmpDir, 'data', 'output', 'x.py');
    fs.writeFileSync(testFile, 'a = 1\n');
    const { stdout } = await $`python3 ${PY} --rules-dir ${DS_DIR} --files ${testFile} --root ${tmpDir}`.quiet();
    const a1State = JSON.parse(stdout.toString())['A1'].state;
    expect(a1State.files.some((f: any) => f.path === 'data/output/x.py')).toBe(true);
});

// siblings(): untouched files nearest first (own dir, parent's files, the parent's other subdirectories),
// capped at MAX_SIBLINGS, never above root, never hidden or NOISE_DIRS. Called through python -c.
async function siblingLabels(root: string, touched: string[]): Promise<{ max: number; labels: string[] }> {
    const code = 'import sys, json; sys.path.insert(0, sys.argv[1]); import evidence as e; ' +
        'r = e.siblings([(f, f) for f in sys.argv[3:]], sys.argv[2]); print(json.dumps({"max": e.MAX_SIBLINGS, "labels": [l for l, _ in r]}))';
    const { stdout } = await $`python3 -c ${code} ${join(BASE_DIR, 'checks/_jev')} ${root} ${touched}`.quiet();
    return JSON.parse(stdout.toString());
}

function touch(dir: string, names: string[]) {
    fs.mkdirSync(dir, { recursive: true });
    for (const n of names) fs.writeFileSync(join(dir, n), 'x = 1\n');
}

test('siblings() fills the cap own dir first, then parent files, then sibling packages, each tier sorted', async () => {
    const root = fs.realpathSync(mkTmp('jev-siblings-cap-'));
    const outside = fs.realpathSync(mkTmp('jev-siblings-outside-'));
    const top = join(root, 'top');
    const num = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${String(i).padStart(2, '0')}.py`);
    touch(join(top, 'own'), [...num('o', 60), 'touched.py']);
    touch(top, num('p', 30));
    for (const pkg of ['pkgA', 'pkgB', 'pkgC']) touch(join(top, pkg), num(`${pkg}_`, 20));
    // contribute nothing: a NOISE_DIRS dir, a hidden dir, a symlinked dir pointing outside root
    touch(join(top, 'node_modules'), ['n.py']);
    touch(join(top, 'scratch'), ['s.py']);
    touch(join(top, '.hidden'), ['h.py']);
    touch(outside, ['escape.py']);
    fs.symlinkSync(outside, join(top, 'zlink'));
    fs.symlinkSync(outside, join(top, 'alink'));
    // a parent-level file symlinked outside root, and hidden files in the own and parent dirs
    fs.symlinkSync(join(outside, 'escape.py'), join(top, 'p15_escape.py'));
    touch(join(top, 'own'), ['.o_hidden.py']);
    touch(top, ['.p_hidden.py']);

    const { max, labels } = await siblingLabels(root, [join(top, 'own', 'touched.py')]);
    expect(max).toBe(100);
    expect(labels.length).toBe(max);
    const own = num('o', 60).map(n => `top/own/${n}`);
    const parent = num('p', 30).map(n => `top/${n}`);
    const pkgA = num('pkgA_', 20).slice(0, 10).map(n => `top/pkgA/${n}`);
    expect(labels).toEqual([...own, ...parent, ...pkgA]);
    expect(labels.some(l => l.includes('touched'))).toBe(false);
    for (const bad of ['node_modules', 'scratch', '.hidden', '.o_hidden', '.p_hidden', 'p15_escape', 'zlink', 'alink', 'escape', 'pkgB', 'pkgC'])
        expect(labels.some(l => l.includes(bad))).toBe(false);
});

test('siblings() reaches every package, in name order, once the cap leaves room', async () => {
    const root = fs.realpathSync(mkTmp('jev-siblings-room-'));
    const top = join(root, 'top');
    touch(join(top, 'own'), ['a.py', 'touched.py']);
    touch(top, ['top.py']);
    for (const pkg of ['pkgB', 'pkgA']) touch(join(top, pkg), ['m.py']);
    const { labels } = await siblingLabels(root, [join(top, 'own', 'touched.py')]);
    expect(labels).toEqual(['top/own/a.py', 'top/top.py', 'top/pkgA/m.py', 'top/pkgB/m.py']);
});
