import { expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { useTmp } from '../../../tests/helpers/tmp.ts';

// new-rule.ts against temp trees: no network. --wire runs a stub calibrator (RULE_CALIBRATE) that
// answers each invocation from a scripted plan and counts how often it was called.
const BASE = join(import.meta.dir, '../../..');
const SCRIPT = join(import.meta.dir, 'new-rule.ts');
const REAL_MANIFEST = readFileSync(join(BASE, 'tests/fixtures/jev/calibration.json'), 'utf8');
const mkTmp = useTmp();

// a root holding a manifest; `root: "."` keeps every scaffolded path inside the temp dir
function tree(manifestText: string) {
  const root = mkTmp('new-rule-test-');
  const manifest = join(root, 'calibration.json');
  writeFileSync(manifest, manifestText);
  return { root, manifest };
}
// the real workflows manifest, shape untouched, with a root key in its own compact style
const realCopy = () => tree(REAL_MANIFEST.replace(/^\{\n/, '{\n  "root": ".",\n'));

function run(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync('bun', [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('scaffolds module, twins, manifest entry and test in the real manifest shape, changing no line it does not own', () => {
  const { root, manifest } = realCopy();
  const before = readFileSync(manifest, 'utf8');
  const r = run(['typst', 'T-DEMO', '--manifest', manifest]);
  expect(r.code).toBe(0);
  const mod = join(root, 'constraints/jev/typst/uncalibrated/T-DEMO.py');
  expect(readFileSync(mod, 'utf8')).toMatch(/def evidence\(files, plan_lines=None, changed=None\):/);
  const vio = readFileSync(join(root, 'tests/fixtures/jev/typst/T-DEMO/vio/REPLACE-ME.txt'), 'utf8');
  expect(readFileSync(join(root, 'tests/fixtures/jev/typst/T-DEMO/sat/REPLACE-ME.txt'), 'utf8')).toBe(vio);
  const after = readFileSync(manifest, 'utf8');
  expect(JSON.parse(after).sets.typst.rules['T-DEMO']).toEqual([
    { kind: 'violating', path: 'tests/fixtures/jev/typst/T-DEMO/vio' },
    { kind: 'compliant', path: 'tests/fixtures/jev/typst/T-DEMO/sat' },
  ]);
  // only the closing bracket before the new entry gains a comma
  const kept = new Set(after.split('\n'));
  expect(before.split('\n').filter(l => !kept.has(l)).length).toBeLessThanOrEqual(1);
  // the generated test's imports resolve from where it sits
  const testPath = join(root, 'tests/jev-rules/typst-T-DEMO.test.ts');
  const imports = [...readFileSync(testPath, 'utf8').matchAll(/from '(\.[^']+\.ts)'/g)].map(m => resolve(dirname(testPath), m[1]));
  expect(imports.length).toBe(2);
  for (const p of imports) expect(existsSync(p)).toBe(true);
});

test('the stub module loads through evidence.py and reports its placeholder proposition', () => {
  const { root, manifest } = realCopy();
  expect(run(['demo', 'D-ONE', '--manifest', manifest, '--layout', 'files']).code).toBe(0);
  const r = spawnSync('python3', [join(BASE, 'constraints/jev/evidence.py'), '--files', join(root, 'tests/fixtures/jev/demo/D-ONE/vio/REPLACE-ME.txt'),
    '--rules-dir', join(root, 'constraints/jev/demo/uncalibrated')], { encoding: 'utf8' });
  expect(r.status).toBe(0);
  const out = JSON.parse(r.stdout);
  expect(out['D-ONE'].proposition).toMatch(/^TODO/);
  expect(out['D-ONE'].state.n_spans).toBe(0);
});

test('the generated test is red on the identical placeholder twins and green once the extractor separates real twins', () => {
  const { root, manifest } = realCopy();
  expect(run(['demo', 'D-TWO', '--manifest', manifest, '--layout', 'files']).code).toBe(0);
  const gen = join(root, 'tests/jev-rules/demo-D-TWO.test.ts');
  const bunTest = () => spawnSync('bun', ['test', gen], { cwd: root, encoding: 'utf8' });
  expect(bunTest().status).not.toBe(0);
  const fx = join(root, 'tests/fixtures/jev/demo/D-TWO');
  rmSync(join(fx, 'vio/REPLACE-ME.txt'));
  rmSync(join(fx, 'sat/REPLACE-ME.txt'));
  writeFileSync(join(fx, 'vio/a.md'), 'one\ntwo\n');
  writeFileSync(join(fx, 'sat/a.md'), 'one\n');
  const r = bunTest();
  expect(r.stderr).toContain('1 pass');
  expect(r.status).toBe(0);
});

test('refuses to overwrite and leaves the manifest byte-identical', () => {
  const { manifest } = realCopy();
  expect(run(['typst', 'T-DEMO', '--manifest', manifest]).code).toBe(0);
  const once = readFileSync(manifest, 'utf8');
  const r = run(['typst', 'T-DEMO', '--manifest', manifest]);
  expect(r.code).toBe(3);
  expect(r.err).toContain('refusing to overwrite');
  expect(readFileSync(manifest, 'utf8')).toBe(once);
  // an existing wired rule is taken too
  expect(run(['authoring', 'A-PAD', '--manifest', realCopy().manifest]).code).toBe(3);
});

test('an unknown set needs --layout; diff layout gets before/after placeholders and an uncalibratedDir', () => {
  const { root, manifest } = realCopy();
  expect(run(['newset', 'N-ONE', '--manifest', manifest]).code).toBe(3);
  expect(run(['newset', 'N-ONE', '--manifest', manifest, '--layout', 'diff']).code).toBe(0);
  const set = JSON.parse(readFileSync(manifest, 'utf8')).sets.newset;
  expect(set).toMatchObject({ rulesDir: 'constraints/jev/newset', uncalibratedDir: 'constraints/jev/newset/uncalibrated', layout: 'diff' });
  for (const p of ['vio/before', 'vio/after', 'sat/before', 'sat/after']) expect(existsSync(join(root, 'tests/fixtures/jev/newset/N-ONE', p, 'REPLACE-ME.txt.fixture'))).toBe(true);
  // a set that has no uncalibratedDir (elide) gains one
  const m2 = realCopy();
  expect(run(['elide', 'EL-DEMO', '--manifest', m2.manifest]).code).toBe(0);
  expect(JSON.parse(readFileSync(m2.manifest, 'utf8')).sets.elide.uncalibratedDir).toBe('constraints/jev/elide/uncalibrated');
});

test('an indent-1 manifest with a root key (teaching shape) keeps its shape; an unknown shape is refused untouched', () => {
  const data = { root: '.', criterion: { violatingAtLeast: 0.85, compliantBelow: 0.5, crossFlagAbove: 0.5 }, sets: { notes: { rulesDir: 'constraints/jev/notes', layout: 'files', rules: {} } } };
  const { manifest } = tree(JSON.stringify(data, null, 1) + '\n');
  expect(run(['notes', 'N-DEMO', '--manifest', manifest]).code).toBe(0);
  const after = readFileSync(manifest, 'utf8');
  expect(after).toBe(JSON.stringify(JSON.parse(after), null, 1) + '\n');
  const odd = tree(JSON.stringify(data));
  const r = run(['notes', 'N-DEMO', '--manifest', odd.manifest]);
  expect(r.code).toBe(3);
  expect(readFileSync(odd.manifest, 'utf8')).toBe(JSON.stringify(data));
});

// ---- --wire, with a stub calibrator
const STUB = `const { readFileSync, writeFileSync, existsSync } = require('fs');
const n = existsSync(process.env.STUB_COUNT) ? Number(readFileSync(process.env.STUB_COUNT, 'utf8')) + 1 : 1;
writeFileSync(process.env.STUB_COUNT, String(n));
writeFileSync(process.env.STUB_COUNT + '.argv', JSON.stringify(process.argv.slice(2)));
const plan = JSON.parse(process.env.STUB_PLAN)[n - 1];
if (plan.code === 2) { console.error('Jev unavailable'); process.exit(2); }
const cases = [{ set: 'typst', rule: 'T-DEMO', case: 'vio', kind: 'violating', p: plan.vio, pass: plan.vio.every(p => p >= 0.85) },
               { set: 'typst', rule: 'T-DEMO', case: 'sat', kind: 'compliant', p: plan.sat, pass: plan.sat.every(p => p < 0.5) }];
const pass = cases.every(c => c.pass);
console.log(JSON.stringify({ criterion: { violatingAtLeast: 0.85, compliantBelow: 0.5, crossFlagAbove: 0.5 }, runs: 2,
  rules: [{ set: 'typst', rule: 'T-DEMO', wired: false, pass, status: pass ? 'ready to wire' : 'not ready' }], cases,
  cross: (plan.cross || []).map(p => ({ set: 'typst', rule: 'T-HOLLOW', caseRule: 'T-DEMO', case: 'vio', run: 1, p, flag: p > 0.5 })), exit: 0 }));
`;

function filled() {
  const t = realCopy();
  expect(run(['typst', 'T-DEMO', '--manifest', t.manifest]).code).toBe(0);
  const mod = join(t.root, 'constraints/jev/typst/uncalibrated/T-DEMO.py');
  const fill = () => {
    writeFileSync(mod, readFileSync(mod, 'utf8').replace(/TODO:?\s*/g, ''));
    for (const twin of ['vio', 'sat']) {
      const d = join(t.root, 'tests/fixtures/jev/typst/T-DEMO', twin);
      rmSync(join(d, 'REPLACE-ME.txt'));
      writeFileSync(join(d, 'slides.typ'), `== ${twin}\n`);
    }
  };
  return { ...t, mod, wired: join(t.root, 'constraints/jev/typst/T-DEMO.py'), fill };
}

function wire(t: { manifest: string; root: string }, plan: object[], extra: string[] = []) {
  const stub = join(t.root, 'stub-calibrate.js');
  writeFileSync(stub, STUB);
  const count = join(t.root, 'stub-count');
  const r = run(['--wire', 'typst', 'T-DEMO', '--manifest', t.manifest, ...extra], { RULE_CALIBRATE: stub, STUB_PLAN: JSON.stringify(plan), STUB_COUNT: count });
  return { ...r, calls: existsSync(count) ? Number(readFileSync(count, 'utf8')) : 0, argv: existsSync(count + '.argv') ? JSON.parse(readFileSync(count + '.argv', 'utf8')) : [] };
}

const GOOD = { vio: [0.95, 0.96], sat: [0.05, 0.04] };

test('--wire refuses while a TODO or a placeholder twin remains, without calling the calibrator', () => {
  const t = filled();
  let r = wire(t, [GOOD, GOOD]);
  expect(r.code).toBe(3);
  expect(r.err).toContain('placeholders at line(s)');
  writeFileSync(t.mod, readFileSync(t.mod, 'utf8').replace(/TODO:?\s*/g, ''));
  r = wire(t, [GOOD, GOOD]);
  expect(r.code).toBe(3);
  expect(r.err).toContain('still holds the placeholder');
  expect(r.calls).toBe(0);
  expect(existsSync(t.mod)).toBe(true);
});

test('--wire moves the module after two passing invocations of this one rule', () => {
  const t = filled();
  t.fill();
  const r = wire(t, [GOOD, GOOD]);
  expect(r.code).toBe(0);
  expect(r.calls).toBe(2);
  expect(r.argv).toEqual(expect.arrayContaining(['--set', 'typst', '--rule', 'T-DEMO', '--runs', '2', '--json']));
  expect(existsSync(t.wired)).toBe(true);
  expect(existsSync(t.mod)).toBe(false);
});

test('--wire keeps the rule uncalibrated when either invocation fails', () => {
  const t = filled();
  t.fill();
  const r = wire(t, [GOOD, { vio: [0.84, 0.9], sat: [0.05, 0.05] }]);
  expect(r.code).toBe(4);
  expect(r.out).toContain('FAIL vio violating 0.84/0.90');
  expect(existsSync(t.mod)).toBe(true);
  expect(existsSync(t.wired)).toBe(false);
});

test('a borderline pass needs a third invocation, and a failing third keeps it out', () => {
  const t = filled();
  t.fill();
  const edge = { vio: [0.86, 0.87], sat: [0.05, 0.05] };
  let r = wire(t, [edge, GOOD, { vio: [0.83, 0.9], sat: [0.05, 0.05] }]);
  expect(r.calls).toBe(3);
  expect(r.code).toBe(4);
  expect(existsSync(t.mod)).toBe(true);
  rmSync(join(t.root, 'stub-count'));
  r = wire(t, [edge, GOOD, GOOD]);
  expect(r.calls).toBe(3);
  expect(r.code).toBe(0);
});

test('Jev unavailable is exit 2 and never a pass', () => {
  const t = filled();
  t.fill();
  const r = wire(t, [{ code: 2 }]);
  expect(r.code).toBe(2);
  expect(r.err).toContain('not a pass');
  expect(existsSync(t.mod)).toBe(true);
});

test('a cross-rule hit blocks the move unless --accept-cross', () => {
  const t = filled();
  t.fill();
  const hit = { ...GOOD, cross: [0.7] };
  let r = wire(t, [hit, hit]);
  expect(r.code).toBe(4);
  expect(r.out).toContain('cross-rule: T-HOLLOW on T-DEMO');
  expect(existsSync(t.mod)).toBe(true);
  rmSync(join(t.root, 'stub-count'));
  r = wire(t, [hit, hit], ['--accept-cross']);
  expect(r.code).toBe(0);
  expect(existsSync(t.wired)).toBe(true);
});

test('bad names are usage errors', () => {
  const { manifest } = realCopy();
  expect(run(['Typst', 'T-DEMO', '--manifest', manifest]).code).toBe(1);
  expect(run(['typst', 't-demo', '--manifest', manifest]).code).toBe(1);
  expect(run(['typst', '--manifest', manifest]).code).toBe(1);
  expect(readdirSync(dirname(manifest))).toEqual(['calibration.json']);
});
