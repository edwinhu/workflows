#!/usr/bin/env bun
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, basename, dirname, resolve } from 'path';
import { decisionsCall, OPENROUTER_OUT_OF_CREDITS } from '../../../hooks/work-hold.ts';

export const defaultRulesDir = join(__dirname, '../../../constraints/jev');

export interface Verdict {
  rule: string;
  p: number;
  verdict: string;
  /** --batch only: the rule's one-line statement (statement()). */
  statement?: string;
  /** VIOLATED only, when the rule declares SPANS: the `file:line` candidates the verdict was judged over. */
  spans?: string[];
}
export interface Unavailable {
  rule: string;
  reason: string;
}

// Changed and untracked files of a git working tree, as absolute paths.
export function changedFiles(projectDir: string): string[] {
  const diffRes = spawnSync('git', ['-C', projectDir, 'diff', '--name-only', 'HEAD'], { encoding: 'utf8' });
  if (diffRes.error) throw diffRes.error;
  const diff = (diffRes.stdout || '').trim();

  const untrackedRes = spawnSync('git', ['-C', projectDir, 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' });
  if (untrackedRes.error) throw untrackedRes.error;
  const untracked = (untrackedRes.stdout || '').trim();

  const allFiles = [...diff.split('\n'), ...untracked.split('\n')].filter(Boolean);
  return allFiles.map(f => join(projectDir, f));
}

// Changed line ranges per changed or untracked file (absolute path -> [lo, hi] pairs, inclusive), from
// `git diff -U0 HEAD`; an untracked file is all of its lines. A pure deletion after line c is the point
// [c + 0.5, c + 0.5], so it hits only a statement that spans both c and c + 1. Null when git cannot diff.
export function changedRanges(projectDir: string): Record<string, number[][]> | null {
  const git = (...a: string[]) => spawnSync('git', ['-C', projectDir, '-c', 'core.quotepath=off', ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const top = git('rev-parse', '--show-toplevel');
  const diff = git('diff', '--no-color', '--no-ext-diff', '-U0', 'HEAD');
  if (top.status !== 0 || diff.status !== 0) return null;
  const root = top.stdout.trim();
  const out: Record<string, number[][]> = {};
  let cur: number[][] | null = null;
  for (const ln of diff.stdout.split('\n')) {
    if (ln.startsWith('+++ ')) {
      cur = ln === '+++ /dev/null' ? null : (out[resolve(root, ln.slice(6))] = []);
      continue;
    }
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(ln);
    if (m && cur) {
      const start = parseInt(m[1], 10);
      const n = m[2] === undefined ? 1 : parseInt(m[2], 10);
      cur.push(n === 0 ? [start + 0.5, start + 0.5] : [start, start + n - 1]);
    }
  }
  const untracked = git('ls-files', '--others', '--exclude-standard', '--full-name');
  for (const f of untracked.stdout.split('\n').filter(Boolean)) {
    const abs = resolve(root, f);
    let n = 1;
    try { n = Math.max(1, readFileSync(abs, 'utf8').split('\n').length); } catch { /* unreadable: evidence skips it */ }
    out[abs] = [[1, n]];
  }
  return out;
}

// Every rule's {state, proposition, criteria, ...} from the rules directory's extractor; throws on failure.
// `changed` (from changedRanges) scopes the rules that take it to the lines the round added or changed.
export function collectEvidence(opts: { files: string[]; plan?: string; root?: string; rulesDir?: string; changed?: Record<string, number[][]> | null }): Record<string, any> {
  const rulesDir = opts.rulesDir || defaultRulesDir;
  const argsList = ['--files', ...opts.files];
  if (opts.plan) {
    argsList.push('--plan', opts.plan);
  }
  if (opts.root) {
    argsList.push('--root', opts.root);
  }

  // a rules directory without its own evidence.py (constraints/jev/writing) is run by the default one
  let evidenceScript = join(rulesDir, 'evidence.py');
  if (!existsSync(evidenceScript)) {
    evidenceScript = join(defaultRulesDir, 'evidence.py');
    argsList.push('--rules-dir', rulesDir);
  }

  // a large diff yields megabytes of evidence; the default buffer would fail it silently
  let changedDir = '';
  if (opts.changed) {
    changedDir = mkdtempSync(join(tmpdir(), 'rule-check-changed-'));
    writeFileSync(join(changedDir, 'changed.json'), JSON.stringify(opts.changed));
    argsList.push('--changed-lines', join(changedDir, 'changed.json'));
  }
  const evidenceRes = spawnSync('python3', [evidenceScript, ...argsList], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (changedDir) rmSync(changedDir, { recursive: true, force: true });
  if (evidenceRes.status !== 0) {
    throw new Error(`evidence.py failed: ${evidenceRes.stderr}`);
  }
  try {
    return JSON.parse(evidenceRes.stdout);
  } catch (e) {
    throw new Error(`evidence.py returned invalid JSON: ${evidenceRes.stdout}`);
  }
}

// One rule's Decisions call: P(VIOLATED), or the reason it could not be had (one retry).
const STATE_CAP = 60000;

function evidencePaths(state: any): string[] {
  return state && Array.isArray(state.files) ? state.files.map((f: any) => f.path).filter(Boolean) : [];
}

function preamble(subject: string, projectName: string, paths: string[]): string {
  return `You are auditing ${subject} against a written RULE.\nPROJECT: ${projectName}\nEVIDENCE: ${paths.join(', ')}\nThe state is a JSON object. Named fields carry what the extractor found; \`searches\` records every pattern looked for, every file covered, and an EMPTY match list where nothing matched -- an absence is a fact, not a gap.\n\n`;
}

function cap(text: string, n: number): string {
  return text.length > n ? text.substring(0, n) + "\n...[STATE TRUNCATED]..." : text;
}

export function scoreRule(
  ruleName: string, data: any, projectName: string, opts: { caller?: string; cache?: boolean } = {},
): { p: number } | { unavailable: string } {
  const { state, proposition, criteria, subject, deliverable } = data;
  const fullState = cap(
    preamble(subject || `one ${deliverable ?? 'data-science'} deliverable`, projectName, evidencePaths(state)) + JSON.stringify(state, null, 1),
    STATE_CAP,
  );

  const questions = {
    q0: {
      type: 'choice',
      instructions: `Decide whether this is true of the state below (rule ${ruleName}):\n\n${proposition}`,
      criteria: criteria
    }
  };

  let finalError = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    // a retry follows a reply that failed, which is never cached; the first ask may be answered from the cache
    const callRes = decisionsCall(fullState, questions, opts);
    if (callRes.unavailable) {
      finalError = callRes.unavailable;
      if (finalError === OPENROUTER_OUT_OF_CREDITS) break;
      continue;
    }

    let ans;
    try {
      ans = JSON.parse(callRes.stdout!);
    } catch (e) {
      finalError = 'empty or invalid reply';
      continue;
    }

    if (!ans?.answers?.q0?.probabilities) {
      finalError = 'missing answers.q0.probabilities in reply';
      continue;
    }

    const p = ans.answers.q0.probabilities.VIOLATED;
    if (p === undefined || p === null) {
      finalError = 'missing VIOLATED probability';
      continue;
    }

    return { p };
  }

  return { unavailable: finalError };
}

// Every rule in ONE Decisions call: one question per rule over one state holding each rule's evidence
// under its own heading, the state cap split evenly between them. No retry: the per-edit Jev mod
// (hooks/jev/) spends one call per edit, and a failure is every rule unavailable.
export function scoreRulesBatch(
  evidenceData: Record<string, any>, projectName: string, opts: { maxTimeSeconds?: number } = {},
): Record<string, { p: number } | { unavailable: string }> {
  const names = Object.keys(evidenceData);
  if (names.length === 0) return {};
  const { state, questions } = batchRequest(evidenceData, projectName);
  const all = (reason: string) => Object.fromEntries(names.map(n => [n, { unavailable: reason }]));
  const callRes = decisionsCall(state, questions, opts);
  if (callRes.unavailable) return all(callRes.unavailable);
  let ans: any;
  try {
    ans = JSON.parse(callRes.stdout!);
  } catch {
    return all('empty or invalid reply');
  }
  return Object.fromEntries(names.map((n, i) => {
    const p = ans?.answers?.[`q${i}`]?.probabilities?.VIOLATED;
    return [n, typeof p === 'number' ? { p } : { unavailable: `missing answers.q${i}.probabilities.VIOLATED in reply` }];
  }));
}

/** The one Decisions request scoreRulesBatch sends, built without sending it (the spend replay reads it). */
export function batchRequest(evidenceData: Record<string, any>, projectName: string) {
  const names = Object.keys(evidenceData);
  const first = evidenceData[names[0]];
  const paths = [...new Set(names.flatMap(n => evidencePaths(evidenceData[n].state)))];
  const share = Math.floor(STATE_CAP / names.length);
  const sections = names.map(n => cap(`=== RULE ${n} STATE ===\n${JSON.stringify(evidenceData[n].state, null, 1)}`, share));
  const state = preamble(first.subject || `one ${first.deliverable ?? 'data-science'} deliverable`, projectName, paths)
    + `Each rule's state is under its own === RULE <name> STATE === heading; judge each question on its rule's section alone.\n\n`
    + sections.join('\n\n');
  const questions = Object.fromEntries(names.map((n, i) => [`q${i}`, {
    type: 'choice',
    instructions: `Decide whether this is true of the state under === RULE ${n} STATE === (rule ${n}):\n\n${evidenceData[n].proposition}`,
    criteria: evidenceData[n].criteria,
  }]));
  return { state, questions };
}

// The first clause of a rule's proposition: the one line a per-edit note quotes.
// NON-VACUITY: a rule declaring EXAMINED (evidence.py passes examinedKey/examined) names the count of
// what its inventory read. Over a covered non-empty file a zero means the extractor read nothing, and
// a judge handed that empty inventory answers MET; the rule is unavailable instead. A rule covering no
// non-empty file does not apply, and keeps its old path.
export function unexamined(data: any): string | null {
  if (!data || data.examinedKey === undefined) return null;
  const files = Array.isArray(data.state?.files) ? data.state.files : [];
  const covered = files.filter((f: any) => typeof f?.lines === 'number' && f.lines > 0).length;
  if (covered === 0) return null;
  if (typeof data.examined !== 'number') {
    return `its inventory carries no count ${data.examinedKey} — what it examined is unknown (COULD-NOT-CHECK)`;
  }
  if (data.examined === 0) {
    return `its inventory examined 0 ${data.examinedKey} in ${covered} covered file(s) — nothing was judged (COULD-NOT-CHECK)`;
  }
  return null;
}

export function statement(proposition: string): string {
  const one = String(proposition ?? '').replace(/\s+/g, ' ').trim().split(/(?<=[^.]{12})[:.;](?:\s|$)/)[0];
  return one.length > 140 ? one.slice(0, 139) + '…' : one;
}

// Score every rule in rulesDir, or in each of rulesDirs (a register set on top of the writing set), or
// only the named ones, on these files; verdicts sorted by p descending.
export function checkRules(opts: {
  files: string[]; plan?: string; root?: string; rulesDir?: string; rulesDirs?: string[]; projectName: string; blockAt: number; only?: string[];
  changed?: Record<string, number[][]> | null; batch?: boolean; maxTimeSeconds?: number;
}): { verdicts: Verdict[]; unavailable: Unavailable[] } {
  const dirs = opts.rulesDirs?.length ? opts.rulesDirs : [opts.rulesDir || defaultRulesDir];
  const evidenceData = Object.assign({}, ...dirs.map(rulesDir => collectEvidence({ ...opts, rulesDir })));
  const verdicts: Verdict[] = [];
  const unavailable: Unavailable[] = [];
  const chosen = Object.entries(evidenceData).filter(([n]) => !opts.only || opts.only.includes(n));
  for (const [ruleName, data] of chosen) {
    const why = unexamined(data);
    if (why) unavailable.push({ rule: ruleName, reason: why });
  }
  const picked = Object.fromEntries(chosen.filter(([, data]) => !unexamined(data)));
  const batched = opts.batch ? scoreRulesBatch(picked, opts.projectName, { maxTimeSeconds: opts.maxTimeSeconds }) : null;

  for (const [ruleName, data] of Object.entries(picked)) {
    const r = batched ? batched[ruleName] : scoreRule(ruleName, data, opts.projectName);
    if ('unavailable' in r) {
      unavailable.push({ rule: ruleName, reason: r.unavailable });
      continue;
    }
    const verdict = r.p >= opts.blockAt ? 'VIOLATED' : 'MET';
    const v: Verdict = batched ? { rule: ruleName, p: r.p, verdict, statement: statement(data.proposition) } : { rule: ruleName, p: r.p, verdict };
    if (verdict === 'VIOLATED' && Array.isArray(data.spans) && data.spans.length) v.spans = data.spans;
    verdicts.push(v);
  }

  verdicts.sort((a, b) => b.p - a.p);
  return { verdicts, unavailable };
}

function main() {
  let files: string[] = [];
  let projectDir = '';
  let projectOverride = '';
  let plan = '';
  let blockAt = 0.85;
  const rulesDirs: string[] = [];
  let batch = false;
  let maxTimeSeconds: number | undefined;
  let changedFile = '';

  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project-dir') {
      projectDir = argv[++i];
    } else if (arg === '--project') {
      projectOverride = argv[++i];
    } else if (arg === '--plan') {
      plan = argv[++i];
    } else if (arg === '--block-at') {
      blockAt = parseFloat(argv[++i]);
    } else if (arg === '--batch') {
      batch = true;
    } else if (arg === '--max-time') {
      maxTimeSeconds = parseFloat(argv[++i]);
    } else if (arg === '--changed-lines') {
      changedFile = argv[++i];
    } else if (arg === '--rules') {
      // repeatable: `--rules <writing> --rules <legal>` scores the register set on top of the general one
      rulesDirs.push(argv[++i]);
    } else if (arg === '--files') {
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        files.push(argv[++i]);
      }
    }
  }

  // the spend log's caller: --batch is the per-edit Jev mod's path, every other run a rule leg
  process.env.JEV_CALLER ||= batch ? 'jev-edit' : 'rule-check';

  let changed: Record<string, number[][]> | null = null;
  if (changedFile) {
    try {
      // '-' reads it from stdin: the per-edit Jev mod passes it there, so no temp file is written
      changed = JSON.parse(readFileSync(changedFile === '-' ? 0 : changedFile, 'utf8'));
    } catch (e) {
      console.error(`Failed to read --changed-lines ${changedFile}:`, e);
      process.exit(1);
    }
  }
  if (projectDir) {
    try {
      files = files.concat(changedFiles(projectDir));
      changed = changedRanges(projectDir);
    } catch (e) {
      console.error("Failed to list files from git:", e);
      process.exit(1);
    }
  }

  if (files.length === 0) {
    console.log(JSON.stringify({ verdicts: [], unavailable: [] }));
    process.exit(0);
  }

  let projectName = 'unknown';
  if (projectOverride) {
    projectName = projectOverride;
  } else if (projectDir) {
    projectName = basename(projectDir);
  } else {
    const res = spawnSync('git', ['-C', dirname(files[0]), 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
    if (res.status === 0 && res.stdout && res.stdout.trim()) {
      projectName = basename(res.stdout.trim());
    }
  }

  let result!: ReturnType<typeof checkRules>;
  try {
    result = checkRules({ files, plan: plan || undefined, root: projectDir || undefined, rulesDirs, projectName, blockAt, changed, batch, maxTimeSeconds });
  } catch (e: any) {
    console.error(e.message);
    process.exit(1);
  }
  const { verdicts, unavailable } = result;

  console.log(JSON.stringify({ verdicts, unavailable }));

  if (unavailable.length > 0) {
    process.exit(1);
  } else if (verdicts.some(v => v.p >= blockAt)) {
    process.exit(2);
  } else {
    process.exit(0);
  }
}

if (import.meta.main) main();
