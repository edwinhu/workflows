#!/usr/bin/env bun
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, basename, dirname, resolve } from 'path';
import { decisionsCall } from '../../../hooks/work-hold.ts';

export const defaultRulesDir = join(__dirname, '../../../constraints/jev');

export interface Verdict {
  rule: string;
  p: number;
  verdict: string;
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
export function scoreRule(ruleName: string, data: any, projectName: string): { p: number } | { unavailable: string } {
  const { state, proposition, criteria, subject, deliverable } = data;

  let filePaths: string[] = [];
  if (state && state.files && Array.isArray(state.files)) {
    filePaths = state.files.map((f: any) => f.path).filter(Boolean);
  }

  const preamble = `You are auditing ${subject || `one ${deliverable ?? 'data-science'} deliverable`} against a written RULE.\nPROJECT: ${projectName}\nEVIDENCE: ${filePaths.join(', ')}\nThe state is a JSON object. Named fields carry what the extractor found; \`searches\` records every pattern looked for, every file covered, and an EMPTY match list where nothing matched -- an absence is a fact, not a gap.\n\n`;

  let fullState = preamble + JSON.stringify(state, null, 1);
  if (fullState.length > 60000) {
    fullState = fullState.substring(0, 60000) + "\n...[STATE TRUNCATED]...";
  }

  const questions = {
    q0: {
      type: 'choice',
      instructions: `Decide whether this is true of the state below (rule ${ruleName}):\n\n${proposition}`,
      criteria: criteria
    }
  };

  let finalError = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    const callRes = decisionsCall(fullState, questions);
    if (callRes.unavailable) {
      finalError = callRes.unavailable;
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

// Score every rule in rulesDir (or only the named ones) on these files; verdicts sorted by p descending.
export function checkRules(opts: {
  files: string[]; plan?: string; root?: string; rulesDir?: string; projectName: string; blockAt: number; only?: string[];
  changed?: Record<string, number[][]> | null;
}): { verdicts: Verdict[]; unavailable: Unavailable[] } {
  const evidenceData = collectEvidence(opts);
  const verdicts: Verdict[] = [];
  const unavailable: Unavailable[] = [];

  for (const [ruleName, data] of Object.entries(evidenceData)) {
    if (opts.only && !opts.only.includes(ruleName)) continue;
    const r = scoreRule(ruleName, data, opts.projectName);
    if ('unavailable' in r) {
      unavailable.push({ rule: ruleName, reason: r.unavailable });
      continue;
    }
    const verdict = r.p >= opts.blockAt ? 'VIOLATED' : 'MET';
    verdicts.push({ rule: ruleName, p: r.p, verdict });
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
  let rulesDir = defaultRulesDir;

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
    } else if (arg === '--rules') {
      rulesDir = argv[++i];
    } else if (arg === '--files') {
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        files.push(argv[++i]);
      }
    }
  }

  let changed: Record<string, number[][]> | null = null;
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
    result = checkRules({ files, plan: plan || undefined, root: projectDir || undefined, rulesDir, projectName, blockAt, changed });
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
