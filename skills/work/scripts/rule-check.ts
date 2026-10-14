#!/usr/bin/env bun
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, basename, dirname, resolve } from 'path';
import { decisionsCall, decisionThreshold, OPENROUTER_OUT_OF_CREDITS } from '../../../hooks/work-hold.ts';

/** The shared Jev infrastructure (evidence.py, _common.py, _ds.py); `_jev` is not a workflow. */
export const jevDir = join(__dirname, '../../../checks/_jev');
/** collectEvidence's directory when a caller names none (the module API; the CLI always takes --workflow). */
export const defaultRulesDir = join(__dirname, '../../../checks/ds/rules');
const WORKFLOW_CHECK = join(__dirname, '../../../bin/workflow-check');

/** A workflow's rule directories, parents included, as bin/workflow-check --list resolves them from the layout. */
export function workflowRuleDirs(workflow: string): string[] {
  const r = spawnSync('python3', [WORKFLOW_CHECK, workflow, '--list'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`workflow-check ${workflow} --list exit ${r.status}: ${(r.stderr || r.error?.message || '').trim()}`);
  const dirs = JSON.parse(r.stdout).ruleDirs;
  if (!Array.isArray(dirs)) throw new Error(`workflow-check ${workflow} --list printed no ruleDirs`);
  return dirs;
}

export interface Verdict {
  rule: string;
  p: number;
  verdict: string;
  /** --batch only: the rule's one-line statement (statement()). */
  statement?: string;
  /** VIOLATED only, when the rule declares SPANS: the `file:line` candidates the verdict was judged over. */
  spans?: string[];
  /** 'openai' when the luna fallback answered: the verdict was judged at decisionThreshold, not blockAt. */
  provider?: string;
}
export interface Unavailable {
  rule: string;
  reason: string;
}

const SNAPSHOT = join(__dirname, 'tree-snapshot.sh');

/** A snapshot tree of the working tree as it stands now, to diff against a recorded args.runBaseline tree
 *  (two trees, so untracked files are diffed like any other). Null when git cannot snapshot (not a repo). */
function nowTree(projectDir: string): { top: string; now: string } | null {
  const snap = spawnSync('bash', [SNAPSHOT, projectDir], { encoding: 'utf8' });
  const top = spawnSync('git', ['-C', projectDir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (snap.status !== 0 || top.status !== 0 || !snap.stdout.trim()) return null;
  return { top: top.stdout.trim(), now: snap.stdout.trim() };
}

// Changed and untracked files of a git working tree, as absolute paths. `since` (a tree-ish) scopes it to
// what changed after that tree, not after HEAD.
export function changedFiles(projectDir: string, since?: string): string[] {
  if (since) {
    const t = nowTree(projectDir);
    if (!t) return [];
    const r = spawnSync('git', ['-C', projectDir, '-c', 'core.quotepath=off', 'diff', '--name-only', '--diff-filter=d', since, t.now], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (r.error) throw r.error;
    return (r.stdout || '').split('\n').filter(Boolean).map(f => join(projectDir, f));
  }
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
// `git diff -U0 HEAD` (or, with `since`, `git diff -U0 <since> <tree of now>`); an untracked file is all of its lines. A pure deletion after line c is the point
// [c + 0.5, c + 0.5], so it hits only a statement that spans both c and c + 1. Null when git cannot diff.
export function changedRanges(projectDir: string, since?: string): Record<string, number[][]> | null {
  const git = (...a: string[]) => spawnSync('git', ['-C', projectDir, '-c', 'core.quotepath=off', ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const top = git('rev-parse', '--show-toplevel');
  // `since`: the recorded tree against a fresh snapshot of now, so a line already there when the run began is out of scope
  const now = since ? nowTree(projectDir) : null;
  if (since && !now) return null;
  const diff = since ? git('diff', '--no-color', '--no-ext-diff', '-U0', since, now!.now) : git('diff', '--no-color', '--no-ext-diff', '-U0', 'HEAD');
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
  // under `since` the untracked files are already in the tree diff above
  const untracked = since ? { stdout: '' } : git('ls-files', '--others', '--exclude-standard', '--full-name');
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

  // a rules directory without its own evidence.py (checks/ds/rules) is run by the shared one in checks/_jev
  let evidenceScript = join(rulesDir, 'evidence.py');
  if (!existsSync(evidenceScript)) {
    evidenceScript = join(jevDir, 'evidence.py');
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

// One rule's Decisions call: P(VIOLATED) and the reply's provider, or the reason it could not be had (one retry).
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
  ruleName: string, data: any, projectName: string, opts: { caller?: string; cache?: boolean; fallback?: boolean } = {},
): { p: number; provider?: string } | { unavailable: string } {
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

    return ans.provider ? { p, provider: ans.provider } : { p };
  }

  return { unavailable: finalError };
}

// Every rule in ONE Decisions call: one question per rule over one state holding each rule's evidence
// under its own heading, the state cap split evenly between them. No retry: the per-edit Jev mod
// (hooks/jev/) spends one call per edit, and a failure is every rule unavailable.
export function scoreRulesBatch(
  evidenceData: Record<string, any>, projectName: string, opts: { maxTimeSeconds?: number } = {},
): Record<string, { p: number; provider?: string } | { unavailable: string }> {
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
    if (typeof p !== 'number') return [n, { unavailable: `missing answers.q${i}.probabilities.VIOLATED in reply` }];
    return [n, ans.provider ? { p, provider: ans.provider } : { p }];
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
    const verdict = r.p >= decisionThreshold(r, opts.blockAt) ? 'VIOLATED' : 'MET';
    const v: Verdict = batched ? { rule: ruleName, p: r.p, verdict, statement: statement(data.proposition) } : { rule: ruleName, p: r.p, verdict };
    if (r.provider) v.provider = r.provider;
    if (verdict === 'VIOLATED' && Array.isArray(data.spans) && data.spans.length) v.spans = data.spans;
    verdicts.push(v);
  }

  verdicts.sort((a, b) => b.p - a.p);
  return { verdicts, unavailable };
}

/**
 * The one JSON line on stdout, and a copy at $RULE_CHECK_OUT when it is set: a caller that runs this
 * under bin/workflow-check (work-checks.sh, for a ruleChecks of `workflow-check <wf> --rules-only`)
 * reads the verdicts there, since the runner's own stdout is its leg-count report.
 */
function emit(result: { verdicts: Verdict[]; unavailable: Unavailable[]; scope?: string }) {
  const line = JSON.stringify(result);
  if (process.env.RULE_CHECK_OUT) {
    try {
      writeFileSync(process.env.RULE_CHECK_OUT, line + '\n');
    } catch (e: any) {
      console.error(`rule-check: could not write RULE_CHECK_OUT ${process.env.RULE_CHECK_OUT}: ${e.message}`);
    }
  }
  console.log(line);
}

function main() {
  let files: string[] = [];
  let projectDir = '';
  let projectOverride = '';
  let plan = '';
  let blockAt = 0.85;
  const rulesDirs: string[] = [];
  let workflow = '';
  let batch = false;
  let maxTimeSeconds: number | undefined;
  let changedFile = '';
  let since = '';

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
    } else if (arg === '--since') {
      since = argv[++i];
    } else if (arg === '--workflow') {
      // the layout decides the set: checks/<workflow>/rules and its parents', through workflow-check --list
      workflow = argv[++i];
    } else if (arg === '--files') {
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        files.push(argv[++i]);
      }
    }
  }

  // the spend log's caller: --batch is the per-edit Jev mod's path, every other run a rule leg
  process.env.JEV_CALLER ||= batch ? 'jev-edit' : 'rule-check';

  // The workflow names the set; nothing else can (membership is the directory). No default: a call
  // that names no workflow would score whichever set a default picked, and pass for the wrong reason.
  if (!workflow) {
    console.error('rule-check: name the rule set with --workflow <wf> (the rules under checks/<wf>/rules and its parents\')');
    process.exit(1);
  }
  let dirs: string[];
  try {
    dirs = workflowRuleDirs(workflow);
  } catch (e: any) {
    console.error(e.message);
    process.exit(1);
  }
  if (dirs.length === 0) {
    const scope = `nothing in scope (workflow ${workflow} has no rules under checks/)`;
    console.error(`rule-check: 0 rule(s) examined — ${scope}`);
    emit({ verdicts: [], unavailable: [], scope });
    process.exit(0);
  }
  rulesDirs.push(...dirs);

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
  if (since) {
    if (!projectDir) { console.error('rule-check: --since scopes --project-dir; name it'); process.exit(1); }
    const ok = spawnSync('git', ['-C', projectDir, 'cat-file', '-e', `${since}^{tree}`]);
    if (ok.status !== 0) { console.error(`rule-check: --since ${since} is not a tree in ${projectDir}'s repo`); process.exit(1); }
  }
  if (projectDir) {
    try {
      files = files.concat(changedFiles(projectDir, since || undefined));
      changed = changedRanges(projectDir, since || undefined);
    } catch (e) {
      console.error("Failed to list files from git:", e);
      process.exit(1);
    }
  }

  // Zero files is an empty scope, said so: a bare `{"verdicts":[]}` reads exactly like every rule MET.
  if (files.length === 0) {
    const scope = `nothing in scope (no file ${projectDir ? `changed under ${projectDir}` : 'named'})`;
    console.error(`rule-check: 0 rule(s) examined — ${scope}`);
    emit({ verdicts: [], unavailable: [], scope });
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

  emit({ verdicts, unavailable });

  if (unavailable.length > 0) {
    process.exit(1);
  } else if (verdicts.some(v => v.verdict === 'VIOLATED')) {
    process.exit(2);
  } else {
    process.exit(0);
  }
}

if (import.meta.main) main();
