#!/usr/bin/env bun
// Scaffold a Jev rule check, and wire it only after calibration passes.
//
//   bun new-rule.ts <set> <ID> [--manifest PATH] [--layout files|diff]
//   bun new-rule.ts --wire <set> <ID> [--manifest PATH] [--runs 2] [--margin 0.03] [--accept-cross]
//
// Scaffold: creates <uncalibratedDir>/<ID>.py (PROPOSITION/CRITERIA placeholders, evidence() taking
// `changed`), tests/fixtures/jev/<set>/<ID>/{vio,sat} with IDENTICAL placeholder files (so the stub test
// fails until real twins replace them), the rule's calibration-manifest entry, and
// tests/jev-rules/<set>-<ID>.test.ts. Refuses to overwrite any of them. A set the manifest lacks is
// created when --layout is given.
// --wire: refuses while a TODO or a placeholder remains, then runs rule-calibrate --set <set> --rule <ID>
// twice (a third time when any score sits within --margin of a bar) and moves the module into the
// wired rulesDir only if every invocation passed and no cross-rule hit involves the rule.
// Exit 0 done; 1 usage; 2 Jev unavailable (never a pass); 3 refused; 4 calibration did not pass.
// RULE_CALIBRATE overrides the calibrator script (tests stub it).
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';

const BASE = resolve(import.meta.dir, '../../..');
const DEFAULT_MANIFEST = join(BASE, 'tests/fixtures/jev/calibration.json');
const CALIBRATE = process.env.RULE_CALIBRATE || join(BASE, 'skills/work/scripts/rule-calibrate.ts');
const PLACEHOLDER = 'REPLACE-ME.txt';
const PLACEHOLDER_TEXT = 'Replace this file with the minimal twin: references/fixtures.md in the jev-rules skill.\n';

function die(code: number, msg: string): never {
  console.error(`new-rule: ${msg}`);
  process.exit(code);
}

function usage(code: number): never {
  console.error('usage: bun new-rule.ts <set> <ID> [--manifest PATH] [--layout files|diff]\n'
    + '       bun new-rule.ts --wire <set> <ID> [--manifest PATH] [--runs 2] [--margin 0.03] [--accept-cross]');
  process.exit(code);
}

// ---- the manifest is rewritten in whichever of its known shapes it already has, never reformatted
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
const isPrim = (v: Json) => v === null || typeof v !== 'object';
const isLeaf = (v: Json) => isPrim(v) || (Array.isArray(v) ? v.every(isPrim) : Object.values(v).every(isPrim));
const inline = (v: Json): string => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return v.length ? `[ ${v.map(inline).join(', ')} ]` : '[]';
  const ks = Object.keys(v);
  return ks.length ? `{ ${ks.map(k => `${JSON.stringify(k)}: ${inline(v[k])}`).join(', ')} }` : '{}';
};
// workflows' shape: two-space indent, every object or array of primitives on one line
function compact(v: Json, pad = ''): string {
  if (isLeaf(v)) return inline(v);
  const inner = pad + '  ';
  if (Array.isArray(v)) return `[\n${v.map(x => inner + compact(x, inner)).join(',\n')}\n${pad}]`;
  return `{\n${Object.entries(v as Record<string, Json>).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${compact(x, inner)}`).join(',\n')}\n${pad}}`;
}
const SHAPES: ((v: Json) => string)[] = [v => compact(v), v => JSON.stringify(v, null, 1), v => JSON.stringify(v, null, 2)];

function shapeOf(text: string, parsed: Json): (v: Json) => string {
  for (const s of SHAPES) {
    const out = s(parsed);
    if (out === text || out + '\n' === text) return v => s(v) + (text.endsWith('\n') ? '\n' : '');
  }
  die(3, 'the manifest is in none of the known shapes (workflows compact, JSON indent 1 or 2); add the entry by hand');
}

interface CaseSpec { kind: 'violating' | 'compliant'; path: string; source?: string; base?: string }
interface SetSpec { rulesDir: string; uncalibratedDir?: string; layout: 'files' | 'diff'; rules: Record<string, CaseSpec[]> }

function loadManifest(path: string) {
  if (!existsSync(path)) die(3, `no manifest at ${path}`);
  const text = readFileSync(path, 'utf8');
  const data = JSON.parse(text);
  const root = data.root === undefined ? BASE : resolve(dirname(resolve(path)), data.root);
  return { text, data, root, write: shapeOf(text, data) };
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

const stub = (set: string, id: string) => `"""UNCALIBRATED -- not wired. Scaffolded by the jev-rules skill (new-rule.ts ${set} ${id}).
--wire refuses while a placeholder remains. Record each calibration's numbers here.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # the set's own helpers

from _common import _read, render_json

SUBJECT = 'TODO: one <deliverable> (what the judge is auditing)'
DELIVERABLE = 'TODO'

# ONE checkable claim, YES = VIOLATED: name the state field it reads and every exemption.
PROPOSITION = ('TODO: At least one listed <span> <breaks the rule>: ... In the state, that is a <span> '
               'with <field> true.')

CRITERIA = {
    'VIOLATED': 'TODO',
    'SATISFIED': 'TODO',
    'NOT_APPLICABLE': 'TODO: the state lists no <span>',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('spans',)  # the inventory keys holding the candidates; a VIOLATED verdict names their file:line

MAX_ITEMS = 40


def evidence(files, plan_lines=None, changed=None):
    """Deterministic and bounded: file:line spans of exactly the facts PROPOSITION reads, only spans on
    changed lines when \`changed\` is given (None = the whole file), counts and booleans precomputed."""
    spans = []  # TODO: {'file': rel, 'line': n, 'text': clipped span, <the booleans PROPOSITION reads>}
    for rel, a in files:
        lines = _read(a)
        if lines is None:
            continue
    inventory = {'spans': spans[:MAX_ITEMS], 'n_spans': len(spans)}
    return render_json('${id}', files, inventory, [])
`;

const testFile = (o: { set: string; id: string; layout: string; rulesDir: string; uncal: string; toRoot: string; toBase: string }) =>
  `import { afterAll, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { collectEvidence } from '${o.toBase}/skills/work/scripts/rule-check.ts';
import { caseInput } from '${o.toBase}/skills/work/scripts/rule-calibrate.ts';

// ${o.set}/${o.id}, extractor only (no Jev): the minimal twins must differ in what it extracts, and the
// state must stay under rule-check's 60000-char cap. Scaffolded by the jev-rules skill.
const ROOT = join(import.meta.dir, '${o.toRoot}');
const ID = '${o.id}';
const DIR = existsSync(join(ROOT, '${o.rulesDir}', \`\${ID}.py\`)) ? '${o.rulesDir}' : '${o.uncal}';
const temps: string[] = [];
afterAll(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

function stateOf(twin: 'vio' | 'sat') {
  const input = caseInput('${o.layout}', join(ROOT, 'tests/fixtures/jev/${o.set}', ID, twin), temps);
  const ev = collectEvidence({ ...input, rulesDir: join(ROOT, DIR) });
  expect(ev[ID]).toBeDefined();
  return JSON.stringify(ev[ID].state);
}

test(\`\${ID}: the extractor separates the violating twin from the compliant twin\`, () => {
  const vio = stateOf('vio');
  const sat = stateOf('sat');
  expect(vio.length).toBeLessThan(60000);
  expect(sat.length).toBeLessThan(60000);
  expect(vio).not.toBe(sat);
});

test.todo(\`\${ID}: the decisive count the proposition reads is > 0 on vio and 0 on sat\`);
`;

function scaffold(setName: string, id: string, manifestPath: string, layout?: string) {
  const m = loadManifest(manifestPath);
  let spec: SetSpec = m.data.sets?.[setName];
  if (!spec) {
    if (layout !== 'files' && layout !== 'diff') die(3, `the manifest has no set "${setName}"; pass --layout files|diff to create it`);
    spec = { rulesDir: `constraints/jev/${setName}`, uncalibratedDir: `constraints/jev/${setName}/uncalibrated`, layout, rules: {} };
    m.data.sets = { ...(m.data.sets ?? {}), [setName]: spec };
  } else if (layout && layout !== spec.layout) {
    die(3, `set "${setName}" already has layout ${spec.layout}`);
  }
  if (!spec.uncalibratedDir) spec.uncalibratedDir = `${spec.rulesDir}/uncalibrated`;
  const fixtureRel = `tests/fixtures/jev/${setName}/${id}`;
  const testRel = `tests/jev-rules/${setName}-${id}.test.ts`;
  const targets = [`${spec.rulesDir}/${id}.py`, `${spec.uncalibratedDir}/${id}.py`, fixtureRel, testRel];
  const taken = targets.filter(t => existsSync(join(m.root, t)));
  if (spec.rules[id]) taken.push(`the manifest entry ${setName}/${id}`);
  if (taken.length) die(3, `refusing to overwrite: ${taken.join(', ')}`);

  mkdirSync(join(m.root, spec.uncalibratedDir), { recursive: true });
  writeFileSync(join(m.root, spec.uncalibratedDir, `${id}.py`), stub(setName, id));
  for (const twin of ['vio', 'sat']) {
    const dirs = spec.layout === 'diff' ? ['before', 'after'].map(s => join(m.root, fixtureRel, twin, s)) : [join(m.root, fixtureRel, twin)];
    for (const d of dirs) {
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, spec.layout === 'diff' ? `${PLACEHOLDER}.fixture` : PLACEHOLDER), PLACEHOLDER_TEXT);
    }
  }
  spec.rules[id] = [{ kind: 'violating', path: `${fixtureRel}/vio` }, { kind: 'compliant', path: `${fixtureRel}/sat` }];
  writeFileSync(manifestPath, m.write(m.data));
  const testDir = join(m.root, 'tests/jev-rules');
  mkdirSync(testDir, { recursive: true });
  writeFileSync(join(m.root, testRel), testFile({
    set: setName, id, layout: spec.layout, rulesDir: spec.rulesDir, uncal: spec.uncalibratedDir,
    toRoot: relative(testDir, m.root) || '.', toBase: relative(testDir, BASE) || '.',
  }));
  console.log(`new-rule: scaffolded ${setName}/${id} under ${m.root}`);
  for (const t of [`${spec.uncalibratedDir}/${id}.py`, `${fixtureRel}/{vio,sat}`, testRel, `${relative(m.root, resolve(manifestPath))} (entry ${setName}/${id})`]) console.log(`  ${t}`);
  console.log('Next: write the extractor and proposition, replace both placeholder twins, add real accepted cases, then --wire.');
}

function wire(setName: string, id: string, manifestPath: string, runs: number, margin: number, acceptCross: boolean) {
  const m = loadManifest(manifestPath);
  const spec: SetSpec = m.data.sets?.[setName];
  if (!spec) die(3, `the manifest has no set "${setName}"`);
  const uncal = spec.uncalibratedDir ?? `${spec.rulesDir}/uncalibrated`;
  const from = join(m.root, uncal, `${id}.py`);
  const to = join(m.root, spec.rulesDir, `${id}.py`);
  if (existsSync(to)) die(3, `${spec.rulesDir}/${id}.py is already wired`);
  if (!existsSync(from)) die(3, `no ${uncal}/${id}.py to wire`);
  const todos = readFileSync(from, 'utf8').split('\n').map((l, i) => [i + 1, l] as const).filter(([, l]) => /\bTODO\b/.test(l));
  if (todos.length) die(3, `${uncal}/${id}.py still has placeholders at line(s) ${todos.map(([n]) => n).join(', ')}`);
  const cases = spec.rules[id] ?? [];
  if (!cases.some(c => c.kind === 'violating') || !cases.some(c => c.kind === 'compliant')) die(3, `the manifest needs at least one violating and one compliant case for ${setName}/${id}`);
  for (const c of cases) {
    const d = join(m.root, c.path);
    if (!existsSync(d) || !listFiles(d).length) die(3, `case ${c.path} is missing or empty`);
    const ph = listFiles(d).filter(f => f.endsWith(PLACEHOLDER) || f.endsWith(`${PLACEHOLDER}.fixture`));
    if (ph.length) die(3, `case ${c.path} still holds the placeholder ${relative(m.root, ph[0])}`);
  }

  const invoke = (n: number) => {
    const r = spawnSync('bun', [CALIBRATE, '--manifest', manifestPath, '--set', setName, '--rule', id, '--runs', String(runs), '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status === 2) die(2, `invocation ${n}: Jev unavailable — nothing was wired; this is not a pass\n${(r.stderr || '').trim()}`);
    let out: any;
    try { out = JSON.parse((r.stdout || '').trim().split('\n').pop()!); } catch { die(4, `invocation ${n}: rule-calibrate exited ${r.status} with no JSON\n${(r.stderr || '').trim()}`); }
    const row = (out.rules ?? []).find((x: any) => x.set === setName && x.rule === id);
    const own = (out.cases ?? []).filter((x: any) => x.set === setName && x.rule === id);
    const ps = (k: string) => own.filter((x: any) => x.kind === k).flatMap((x: any) => x.p as number[]);
    const vMin = Math.min(...ps('violating'));
    const cMax = Math.max(...ps('compliant'));
    const hits = (out.cross ?? []).filter((x: any) => x.set === setName && x.flag && (x.rule === id || x.caseRule === id));
    const { violatingAtLeast: vBar, compliantBelow: cBar } = out.criterion;
    const pass = !!row?.pass;
    console.log(`invocation ${n}: ${pass ? 'pass' : 'FAIL'} (lowest violating ${vMin.toFixed(2)}, highest compliant ${cMax.toFixed(2)}, ${hits.length} cross-rule hit(s))`);
    for (const x of own.filter((x: any) => !x.pass)) console.log(`  FAIL ${x.case} ${x.kind} ${x.p.map((p: number) => p.toFixed(2)).join('/')}`);
    for (const h of hits) console.log(`  cross-rule: ${h.rule} on ${h.caseRule}'s ${h.case} = ${h.p.toFixed(2)}`);
    return { pass, hits: hits.length, borderline: vMin < vBar + margin || cMax >= cBar - margin };
  };

  const results = [invoke(1), invoke(2)];
  if (results.every(r => r.pass) && results.some(r => r.borderline)) {
    console.log(`a score sits within ${margin} of a bar: one more invocation`);
    results.push(invoke(3));
  }
  if (!results.every(r => r.pass)) die(4, `${setName}/${id} did not pass every invocation; it stays in ${uncal}/`);
  if (results.some(r => r.hits) && !acceptCross) die(4, `${setName}/${id} passed but has cross-rule hits; resolve them, or pass --accept-cross when both rules rightly fire (one defect breaking two rules)`);
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
  console.log(`new-rule: wired ${setName}/${id} -> ${spec.rulesDir}/${id}.py`);
  console.log('Next: rewrite the module docstring (it no longer says UNCALIBRATED), stage the move, and run the set\'s tests via scripts/test.sh.');
}

function main() {
  const argv = process.argv.slice(2);
  let wireMode = false, acceptCross = false, runs = 2, margin = 0.03, layout: string | undefined;
  let manifest = DEFAULT_MANIFEST;
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--wire') wireMode = true;
    else if (a === '--accept-cross') acceptCross = true;
    else if (a === '--manifest') manifest = resolve(argv[++i] ?? usage(1));
    else if (a === '--layout') layout = argv[++i];
    else if (a === '--runs') runs = parseInt(argv[++i], 10);
    else if (a === '--margin') margin = parseFloat(argv[++i]);
    else if (a === '-h' || a === '--help') usage(0);
    else if (a.startsWith('--')) usage(1);
    else pos.push(a);
  }
  if (pos.length !== 2 || !(runs >= 1) || !(margin >= 0)) usage(1);
  const [setName, id] = pos;
  if (!/^[a-z][a-z0-9-]*$/.test(setName)) die(1, `set name must be lower-case kebab: ${setName}`);
  if (!/^[A-Z][A-Z0-9-]*$/.test(id)) die(1, `rule ID must be upper-case, digits and dashes: ${id}`);
  if (wireMode) wire(setName, id, manifest, runs, margin, acceptCross);
  else scaffold(setName, id, manifest, layout);
}

if (import.meta.main) main();
