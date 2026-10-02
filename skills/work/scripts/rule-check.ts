#!/usr/bin/env bun
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join, basename, dirname } from 'path';
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

// Every rule's {state, proposition, criteria, ...} from the rules directory's extractor; throws on failure.
export function collectEvidence(opts: { files: string[]; plan?: string; root?: string; rulesDir?: string }): Record<string, any> {
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
  const evidenceRes = spawnSync('python3', [evidenceScript, ...argsList], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
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

  if (projectDir) {
    try {
      files = files.concat(changedFiles(projectDir));
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
    result = checkRules({ files, plan: plan || undefined, root: projectDir || undefined, rulesDir, projectName, blockAt });
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
