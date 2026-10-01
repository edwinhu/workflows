import { expect, test } from "bun:test";
import { $ } from "bun";
import { join } from "path";
import { spawnSync } from "child_process";
import * as fs from "fs";

const RULES = ["DEN", "DQ4", "A4", "DQ1", "DQ6", "R1", "E7", "M1", "UNI", "A1"];
const BASE_DIR = join(import.meta.dir, "../../..");

async function getEvidence(rule: string, twin: "sat" | "vio") {
    const py = join(BASE_DIR, "constraints/jev/evidence.py");
    let ext = "py";
    if (rule === "A4") ext = "md";
    const file = join(BASE_DIR, `tests/fixtures/jev/${rule}/${twin}/test.${ext}`);
    const { stdout } = await $`python3 ${py} --files ${file}`.quiet();
    return JSON.parse(stdout.toString());
}

test("evidence.py discovers all ten rules", async () => {
    const state = await getEvidence("DEN", "sat");
    expect(Object.keys(state).sort()).toEqual(RULES.sort());
});

test("every rule's criteria carry the four options", async () => {
    const state = await getEvidence("DEN", "sat");
    for (const r of RULES) {
        expect(Object.keys(state[r].criteria).sort()).toEqual([
            "INSUFFICIENT_EVIDENCE",
            "NOT_APPLICABLE",
            "SATISFIED",
            "VIOLATED"
        ].sort());
    }
});

const TARGETS: Record<string, string> = {
    DEN: "lines that STATE a base/denominator for a rate",
    DQ4: "the row-count chain: input -> transform -> output",
    A4: "every figure / plot / image reference",
    DQ1: "the empty/constant/null column diagnostic",
    DQ6: "an explicit BEFORE/AFTER comparison",
    R1: "every recorded vintage: pull time, source mtime, hash, commit",
    E7: "THE CEILING it is measured against",
    M1: "every path this code WRITES",
    UNI: "signs that a predicate is RESTATED rather than shared",
    A1: "ANY additional robustness check beyond the spec curve"
};

const PRESENCE_DEFECT: Record<string, boolean> = {
    M1: true,
    UNI: true
};

for (const rule of RULES) {
    test(`${rule} VIO twin shows the defect in its targeted search`, async () => {
        const satAll = await getEvidence(rule, "sat");
        const vioAll = await getEvidence(rule, "vio");
        
        const sat = satAll[rule].state;
        const vio = vioAll[rule].state;
        
        const targetWhat = TARGETS[rule];
        const satSearch = sat.searches.find((s: any) => s.what === targetWhat);
        const vioSearch = vio.searches.find((s: any) => s.what === targetWhat);
        
        expect(satSearch).toBeDefined();
        expect(vioSearch).toBeDefined();
        
        const satMatches = satSearch.matches.length;
        const vioMatches = vioSearch.matches.length;
        
        if (PRESENCE_DEFECT[rule]) {
            // Defect is presence: VIO has matches, SAT has 0 matches
            expect(satMatches).toBe(0);
            expect(vioMatches).toBeGreaterThan(0);
        } else {
            // Defect is absence: SAT has matches, VIO has 0 matches
            expect(satMatches).toBeGreaterThan(0);
            expect(vioMatches).toBe(0);
        }
    });
}


test('evidence.py labels files relative to --root', async () => {
    const tmpDir = fs.mkdtempSync(join(require('os').tmpdir(), 'jev-evidence-root-'));
    fs.mkdirSync(join(tmpDir, 'data'));
    fs.mkdirSync(join(tmpDir, 'data', 'output'));
    const testFile = join(tmpDir, 'data', 'output', 'x.csv');
    fs.writeFileSync(testFile, 'a,b,c\n1,2,3');
    
    const py = join(BASE_DIR, "constraints/jev/evidence.py");
    const { stdout } = await $`python3 ${py} --files ${testFile} --root ${tmpDir}`.quiet();
    const stateAll = JSON.parse(stdout.toString());
    
    // Check DEN or another rule that echoes files
    const denState = stateAll['DEN'].state;
    // We just check if the path is data/output/x.csv
    const fileMatches = denState.files.some((f: any) => f.path === 'data/output/x.csv');
    expect(fileMatches).toBe(true);
});
