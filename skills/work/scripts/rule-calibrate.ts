#!/usr/bin/env bun
// Calibrate the Jev rule checks against the committed calibration set (tests/fixtures/jev/calibration.json).
// Every rule, wired or uncalibrated, is scored by rule-check's own evidence+question path on each of its
// cases, --runs times, against the live Decisions endpoint. A rule passes when every violating case scores
// >= violatingAtLeast and every compliant case < compliantBelow, on every run. Each violating case is also
// scored by every other rule of its set: a score > crossFlagAbove there is a cross-rule hit.
// Exit 0: every wired rule passed. Exit 1: a wired rule failed. Exit 2: Jev unavailable (never a pass).
// Nothing is written to the repo; --json prints to stdout. Manifest paths are absolute, or relative to the
// manifest's `root` (itself relative to the manifest file) when it has one, else to this repo: a plugin
// that ships its own rule set (teaching's constraints/jev) keeps its calibration set in its own tree.
import { spawnSync } from 'child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, relative, resolve } from 'path';
import { changedFiles, changedRanges, collectEvidence, scoreRule } from './rule-check.ts';
import { decisionsCall } from '../../../hooks/work-hold.ts';

const BASE = join(import.meta.dir, '../../..');
const DEFAULT_MANIFEST = join(BASE, 'tests/fixtures/jev/calibration.json');
const CONCURRENCY = 8;

type Kind = 'violating' | 'compliant';
// base: a repo-relative dir committed as the before tree; the case dir is then the working tree on top of it
interface CaseSpec { kind: Kind; path: string; source?: string; base?: string }
interface SetSpec { rulesDir: string; uncalibratedDir?: string; layout: 'files' | 'diff'; rules: Record<string, CaseSpec[]> }
interface Manifest { root?: string; criterion: { violatingAtLeast: number; compliantBelow: number; crossFlagAbove: number }; sets: Record<string, SetSpec> }

function usage(code: number): never {
  console.error('usage: bun skills/work/scripts/rule-calibrate.ts [--set <name>|all] [--rule ID] [--runs 2] [--json] [--manifest PATH]');
  process.exit(code);
}

function stripSuffix(dir: string) {
  for (const name of readdirSync(dir)) {
    if (name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) stripSuffix(p);
    else if (name.endsWith('.fixture')) renameSync(p, p.slice(0, -'.fixture'.length));
  }
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

// The extractor input for one case: files layout hands the case dir over as is, diff layout replays
// before/ as a commit and after/ as the working tree, as jev-dev-rules.test.ts does. A case with a base
// is replayed the same way, base as before/ and the case dir as after/, in either layout.
export function caseInput(layout: string, caseDir: string, temps: string[], baseDir?: string): { files: string[]; plan?: string; root: string; changed: Record<string, number[][]> | null } {
  if (layout === 'files' && !baseDir) {
    const all = listFiles(caseDir);
    const plan = all.find(f => relative(caseDir, f) === 'plan.md');
    return { files: all.filter(f => f !== plan), plan, root: caseDir, changed: null };
  }
  const d = mkdtempSync(join(tmpdir(), 'rule-calibrate-'));
  temps.push(d);
  const git = (...a: string[]) => spawnSync('git', ['-C', d, ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  const before = baseDir ?? join(caseDir, 'before');
  if (existsSync(before)) cpSync(before, d, { recursive: true });
  stripSuffix(d);
  git('add', '-A');
  git('commit', '-qm', 'before', '--allow-empty');
  cpSync(baseDir ? caseDir : join(caseDir, 'after'), d, { recursive: true });
  stripSuffix(d);
  return { files: changedFiles(d), root: d, changed: changedRanges(d) };
}

// Worker mode: score one rule on one evidence entry in its own process, so the sync curl calls run in parallel.
function worker(jobFile: string) {
  const { rule, data, project } = JSON.parse(readFileSync(jobFile, 'utf8'));
  // never the reply cache: calibration re-asks on purpose, and run-to-run spread is what it measures
  console.log(JSON.stringify(scoreRule(rule, data, project, { caller: 'rule-calibrate', cache: false })));
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

const fmt = (p: number | undefined) => (p === undefined ? '-' : p.toFixed(2));

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--score-job') return worker(argv[1]);
  let setName = 'all';
  let only = '';
  let runs = 2;
  let asJson = false;
  let manifestPath = DEFAULT_MANIFEST;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--set') setName = argv[++i];
    else if (a === '--rule') only = argv[++i];
    else if (a === '--runs') runs = parseInt(argv[++i], 10);
    else if (a === '--json') asJson = true;
    else if (a === '--manifest') manifestPath = argv[++i];
    else if (a === '-h' || a === '--help') usage(0);
    else usage(1);
  }
  if (!(runs >= 1)) usage(1);
  const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const ROOT = manifest.root === undefined ? BASE : resolve(dirname(resolve(manifestPath)), manifest.root);
  const { violatingAtLeast, compliantBelow, crossFlagAbove } = manifest.criterion;
  const setNames = setName === 'all' ? Object.keys(manifest.sets) : [setName];
  for (const s of setNames) if (!manifest.sets[s]) { console.error(`unknown set: ${s}`); process.exit(1); }

  // Jev first: an unreachable endpoint must read as exit 2, never as a table of failures or passes.
  const ping = decisionsCall('{"ping": true}', { q0: { type: 'choice', instructions: 'Is this a ping?', criteria: { YES: 'it is', NO: 'it is not' } } }, { maxTimeSeconds: 30, caller: 'rule-calibrate', cache: false });
  let pingOk = false;
  if (ping.stdout !== null) { try { pingOk = !!JSON.parse(ping.stdout)?.answers; } catch { /* not JSON */ } }
  if (!pingOk) {
    console.error(`rule-calibrate: Jev unavailable at ${process.env.WORK_HOLD_DECISIONS_URL || 'https://openrouter.ai/api/alpha/decisions'}: ${ping.unavailable ?? `unusable reply: ${String(ping.stdout).slice(0, 200)}`}`);
    console.error('No rule was calibrated. This is not a pass.');
    process.exit(2);
  }

  const temps: string[] = [];
  // process.exit skips finally blocks; an exit handler runs on every path out
  process.on('exit', () => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });
  const scratch = mkdtempSync(join(tmpdir(), 'rule-calibrate-jobs-'));
  temps.push(scratch);
  const env = { ...process.env, FARM_OUTCOMES: process.env.FARM_OUTCOMES || join(scratch, 'farm-outcomes.jsonl') };

  interface Job { set: string; rule: string; caseRule: string; casePath: string; kind: Kind; run: number; file: string }
  interface RuleInfo { set: string; rule: string; wired: boolean }
  const rules: RuleInfo[] = [];
  const jobs: Job[] = [];
  let jobN = 0;
  for (const s of setNames) {
    const spec = manifest.sets[s];
    const dirs: [string, boolean][] = [[resolve(ROOT, spec.rulesDir), true]];
    if (spec.uncalibratedDir) dirs.push([resolve(ROOT, spec.uncalibratedDir), false]);
    const setRules = new Map<string, boolean>();
    // evidence per case dir, collected once over both the wired and the uncalibrated rules directory
    const evCache = new Map<string, Record<string, any>>();
    const evidenceFor = (c: CaseSpec) => {
      const casePath = c.path;
      if (!evCache.has(casePath)) {
        const input = caseInput(spec.layout, resolve(ROOT, casePath), temps, c.base && resolve(ROOT, c.base));
        const ev: Record<string, any> = {};
        for (const [dir, wired] of dirs) {
          const got = collectEvidence({ ...input, rulesDir: dir });
          for (const [r, d] of Object.entries(got)) { ev[r] = d; setRules.set(r, wired); }
        }
        evCache.set(casePath, ev);
      }
      return evCache.get(casePath)!;
    };
    // every rule the extractors know, so a rule without cases is reported rather than silently skipped
    for (const cases of Object.values(spec.rules)) for (const c of cases) evidenceFor(c);
    for (const r of Object.keys(spec.rules)) if (!setRules.has(r)) { console.error(`manifest names ${s}/${r}, which no rules directory defines`); process.exit(1); }
    for (const [r, wired] of setRules) rules.push({ set: s, rule: r, wired });
    const project = `calibration-${s}`;
    for (let run = 1; run <= runs; run++) {
      for (const [caseRule, cases] of Object.entries(spec.rules)) {
        for (const c of cases) {
          const ev = evidenceFor(c);
          const scorers = c.kind === 'violating' ? [...setRules.keys()] : [caseRule];
          for (const rule of scorers) {
            if (only && rule !== only && caseRule !== only) continue;
            const file = join(scratch, `job-${jobN++}.json`);
            writeFileSync(file, JSON.stringify({ rule, data: ev[rule], project }));
            jobs.push({ set: s, rule, caseRule, casePath: c.path, kind: c.kind, run, file });
          }
        }
      }
    }
  }

  const results = await pool(jobs, CONCURRENCY, async j => {
    const proc = Bun.spawn(['bun', import.meta.path, '--score-job', j.file], { env, stdout: 'pipe', stderr: 'pipe' });
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    await proc.exited;
    try { return JSON.parse(out.trim().split('\n').pop()!) as { p: number } | { unavailable: string }; }
    catch { return { unavailable: `worker failed: ${err.trim().slice(0, 200)}` }; }
  });

  const lost = jobs.map((j, i) => ({ j, r: results[i] })).filter(x => 'unavailable' in x.r);
  if (lost.length) {
    for (const { j, r } of lost.slice(0, 5)) console.error(`rule-calibrate: Jev unavailable scoring ${j.rule} on ${j.casePath} (run ${j.run}): ${(r as any).unavailable}`);
    console.error(`${lost.length} of ${jobs.length} scores could not be had. No verdict is reported; this is not a pass.`);
    process.exit(2);
  }
  const score = (i: number) => (results[i] as { p: number }).p;

  // own-case rows: rule x case, one P(VIOLATED) per run
  interface Row { set: string; rule: string; wired: boolean; case: string; kind: Kind; p: number[]; pass: boolean }
  const rows: Row[] = [];
  const rowKey = new Map<string, Row>();
  jobs.forEach((j, i) => {
    if (j.rule !== j.caseRule) return;
    const key = `${j.set}\0${j.rule}\0${j.casePath}`;
    let row = rowKey.get(key);
    if (!row) {
      row = { set: j.set, rule: j.rule, wired: rules.find(r => r.set === j.set && r.rule === j.rule)!.wired, case: j.casePath, kind: j.kind, p: [], pass: true };
      rowKey.set(key, row);
      rows.push(row);
    }
    row.p[j.run - 1] = score(i);
  });
  for (const row of rows) row.pass = row.p.every(p => (row.kind === 'violating' ? p >= violatingAtLeast : p < compliantBelow));

  const cross = jobs.map((j, i) => ({ j, p: score(i) })).filter(x => x.j.rule !== x.j.caseRule)
    .map(({ j, p }) => ({ set: j.set, rule: j.rule, caseRule: j.caseRule, case: j.casePath, run: j.run, p, flag: p > crossFlagAbove }));

  const summary = rules.filter(r => !only || r.rule === only).map(r => {
    const own = rows.filter(x => x.set === r.set && x.rule === r.rule);
    const pass = own.length > 0 && own.every(x => x.pass);
    const status = r.wired ? (pass ? 'pass' : own.length ? 'FAIL' : 'FAIL (no cases)') : (pass ? 'ready to wire' : own.length ? 'not ready' : 'no cases');
    return { ...r, cases: own.length, pass, status };
  });
  const failedWired = summary.filter(s => s.wired && !s.pass);
  const code = failedWired.length ? 1 : 0;

  if (asJson) {
    console.log(JSON.stringify({ criterion: manifest.criterion, runs, rules: summary, cases: rows, cross, exit: code }));
    process.exit(code);
  }

  console.log(`rule-calibrate: criterion violating >= ${violatingAtLeast}, compliant < ${compliantBelow}, on all ${runs} run(s); cross-rule flag > ${crossFlagAbove}`);
  console.log(`${jobs.length} Jev calls\n`);
  const runCols = Array.from({ length: runs }, (_, i) => `run${i + 1}`);
  const header = ['rule', 'wired?', 'case', 'kind', ...runCols, 'result'];
  const body = rows.map(r => [`${r.set}/${r.rule}`, r.wired ? 'wired' : 'uncal', r.case.replace(/^tests\/fixtures\/jev\//, ''), r.kind, ...runCols.map((_, i) => fmt(r.p[i])), r.pass ? 'pass' : 'FAIL']);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map(b => b[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  console.log(line(header));
  console.log(widths.map(w => '-'.repeat(w)).join('  '));
  for (const b of body) console.log(line(b));

  console.log(`\nCross-rule matrix (rule scored on other rules' violating cases; max over runs; * = > ${crossFlagAbove})`);
  for (const s of setNames) {
    const setCases = [...new Set(cross.filter(c => c.set === s).map(c => `${c.caseRule}:${c.case}`))];
    if (!setCases.length) continue;
    const scorers = [...new Set(cross.filter(c => c.set === s).map(c => c.rule))];
    const cellOf = (rule: string, key: string) => {
      const ps = cross.filter(c => c.set === s && c.rule === rule && `${c.caseRule}:${c.case}` === key).map(c => c.p);
      if (!ps.length) return '';
      const m = Math.max(...ps);
      return fmt(m) + (m > crossFlagAbove ? '*' : '');
    };
    const labels = setCases.map(k => { const [cr, p] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)]; return `${cr} ${p.replace(/^tests\/fixtures\/jev\//, '')}`; });
    const lw = Math.max(`${s} case \\ rule`.length, ...labels.map(l => l.length));
    const cw = Math.max(6, ...scorers.map(r => r.length));
    console.log(`${`${s} case \\ rule`.padEnd(lw)}  ${scorers.map(r => r.padEnd(cw)).join(' ')}`.trimEnd());
    setCases.forEach((k, i) => console.log(`${labels[i].padEnd(lw)}  ${scorers.map(r => cellOf(r, k).padEnd(cw)).join(' ')}`.trimEnd()));
    console.log('');
  }
  const flags = cross.filter(c => c.flag);
  const flagged = [...new Set(flags.map(c => `${c.set}/${c.rule} on ${c.caseRule}'s ${c.case}`))];
  console.log(`Cross-rule hits:${flagged.length ? '' : ' none'}`);
  for (const f of flagged) console.log(`  ${f}`);

  console.log('\nSummary');
  const sw = Math.max(...summary.map(s => `${s.set}/${s.rule}`.length));
  for (const s of summary) console.log(`  ${`${s.set}/${s.rule}`.padEnd(sw)}  ${(s.wired ? 'wired' : 'uncalibrated').padEnd(13)} ${s.status}`);
  const ready = summary.filter(s => !s.wired && s.pass);
  if (ready.length) console.log(`\nReady to wire (not wired automatically): ${ready.map(s => `${s.set}/${s.rule}`).join(', ')}`);
  console.log(failedWired.length ? `\nFAIL: wired rule(s) outside the criterion: ${failedWired.map(s => `${s.set}/${s.rule}`).join(', ')}` : '\nAll wired rules within the criterion.');
  process.exit(code);
}

if (import.meta.main) await main();
