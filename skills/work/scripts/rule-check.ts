#!/usr/bin/env bun
import { spawnSync } from 'child_process';
import { join, basename, dirname } from 'path';
import { decisionsCall } from '../../../hooks/work-hold.ts';

let files: string[] = [];
let projectDir = '';
let projectOverride = '';
let plan = '';
let blockAt = 0.85;
let rulesDir = join(__dirname, '../../../constraints/jev');

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
    const diffRes = spawnSync('git', ['-C', projectDir, 'diff', '--name-only', 'HEAD'], { encoding: 'utf8' });
    if (diffRes.error) throw diffRes.error;
    const diff = (diffRes.stdout || '').trim();
    
    const untrackedRes = spawnSync('git', ['-C', projectDir, 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' });
    if (untrackedRes.error) throw untrackedRes.error;
    const untracked = (untrackedRes.stdout || '').trim();
    
    const allFiles = [...diff.split('\n'), ...untracked.split('\n')].filter(Boolean);
    files = files.concat(allFiles.map(f => join(projectDir, f)));
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

const argsList = ['--files', ...files];
if (plan) {
  argsList.push('--plan', plan);
}
if (projectDir) {
  argsList.push('--root', projectDir);
}

const evidenceRes = spawnSync('python3', [join(rulesDir, 'evidence.py'), ...argsList], { encoding: 'utf8' });
if (evidenceRes.status !== 0) {
  console.error("evidence.py failed:", evidenceRes.stderr);
  process.exit(1);
}

let evidenceData;
try {
  evidenceData = JSON.parse(evidenceRes.stdout);
} catch (e) {
  console.error("evidence.py returned invalid JSON:", evidenceRes.stdout);
  process.exit(1);
}

interface Verdict {
  rule: string;
  p: number;
  verdict: string;
}
interface Unavailable {
  rule: string;
  reason: string;
}

const verdicts: Verdict[] = [];
const unavailable: Unavailable[] = [];

for (const [ruleName, data] of Object.entries(evidenceData)) {
  const { state, proposition, criteria, subject } = data as any;
  
  let filePaths: string[] = [];
  if (state && state.files && Array.isArray(state.files)) {
    filePaths = state.files.map((f: any) => f.path).filter(Boolean);
  }
  
  const preamble = `You are auditing ${subject || 'one data-science deliverable'} against a written RULE.\nPROJECT: ${projectName}\nEVIDENCE: ${filePaths.join(', ')}\nThe state is a JSON object. Named fields carry what the extractor found; \`searches\` records every pattern looked for, every file covered, and an EMPTY match list where nothing matched -- an absence is a fact, not a gap.\n\n`;
  
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
  
  let p: number | undefined;
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
    
    p = ans.answers.q0.probabilities.VIOLATED;
    if (p === undefined || p === null) {
      finalError = 'missing VIOLATED probability';
      continue;
    }
    
    // Success
    finalError = "";
    break;
  }
  
  if (finalError) {
    unavailable.push({ rule: ruleName, reason: finalError });
    continue;
  }
  
  const verdict = p! >= blockAt ? 'VIOLATED' : 'MET';
  verdicts.push({ rule: ruleName, p: p!, verdict });
}

verdicts.sort((a, b) => b.p - a.p);

console.log(JSON.stringify({ verdicts, unavailable }));

if (unavailable.length > 0) {
  process.exit(1);
} else if (verdicts.some(v => v.p >= blockAt)) {
  process.exit(2);
} else {
  process.exit(0);
}
