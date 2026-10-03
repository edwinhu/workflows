import { expect, test } from "bun:test";
import { $ } from "bun";
import { join, basename } from "path";
import { spawnSync } from "child_process";
import * as fs from "fs";
import { useTmp } from "../../../tests/helpers/tmp.ts";

const mkTmp = useTmp();

const TEST_TOKEN = 'test-token-123';

async function runRuleCheck(args: string[], port: number) {
  return await $`bun run ${join(import.meta.dir, 'rule-check.ts')} ${args}`
    .env({
      ...process.env,
      WORK_HOLD_DECISIONS_URL: `http://localhost:${port}/`,
      WORK_HOLD_JUDGE_TOKEN: TEST_TOKEN
    })
    .nothrow()
    .quiet();
}

test('one Decisions call per rule', async () => {
  let requestCount = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      await req.text();
      requestCount++;
      return new Response(JSON.stringify({
        answers: { q0: { probabilities: { VIOLATED: 0.1 }, choice: 'MET' } }
      }));
    }
  });

  const res = await runRuleCheck(['--files', join(import.meta.dir, 'rule-check.ts')], server.port);
  server.stop(true);
  
  expect(res.exitCode).toBe(0);
  expect(requestCount).toBeGreaterThanOrEqual(1);
  
  const out = JSON.parse(res.stdout.toString());
  expect(out.verdicts.length).toBe(requestCount);
});

test('verdicts sorted by p descending', async () => {
  let requestCount = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      await req.text();
      requestCount++;
      const p = requestCount / 100;
      return new Response(JSON.stringify({
        answers: { q0: { probabilities: { VIOLATED: p }, choice: 'MET' } }
      }));
    }
  });

  const res = await runRuleCheck(['--files', join(import.meta.dir, 'rule-check.ts'), '--block-at', '0.99'], server.port);
  server.stop(true);

  expect(res.exitCode).toBe(0);
  const out = JSON.parse(res.stdout.toString());
  for (let i = 0; i < out.verdicts.length - 1; i++) {
    expect(out.verdicts[i].p).toBeGreaterThanOrEqual(out.verdicts[i+1].p);
  }
});

test('p at or above block-at exits 2', async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      await req.text();
      return new Response(JSON.stringify({
        answers: { q0: { probabilities: { VIOLATED: 0.9 }, choice: 'VIOLATED' } }
      }));
    }
  });

  const res = await runRuleCheck(['--files', join(import.meta.dir, 'rule-check.ts'), '--block-at', '0.85'], server.port);
  server.stop(true);

  expect(res.exitCode).toBe(2);
});

test('a VIOLATED verdict carries the file:line spans its rule declares (SPANS); a MET one carries none', async () => {
  const rules = mkTmp('rule-spans-');
  // X-SPAN lists two candidates under `items`; X-CTX also lists a line under `context`, which its
  // SPANS does not name, so it must not surface; X-NONE declares no SPANS at all.
  fs.writeFileSync(join(rules, 'X-SPAN.py'), [
    "PROPOSITION = 'p'", "CRITERIA = {'VIOLATED': 'v', 'SATISFIED': 's'}", "SPANS = ('items',)",
    "def evidence(files, plan_lines=None):",
    "    return {'items': [{'file': 'notes/18-insider.typ', 'line': 113}, {'file': 'notes/18-insider.typ', 'line': 207}]}", ''].join('\n'));
  fs.writeFileSync(join(rules, 'X-CTX.py'), [
    "PROPOSITION = 'p'", "CRITERIA = {'VIOLATED': 'v', 'SATISFIED': 's'}",
    "SPANS = (('pairs', 'notes_file', 'notes_line'),)",
    "def evidence(files, plan_lines=None):",
    "    return {'pairs': [{'notes_file': 'notes/18-insider.typ', 'notes_line': 40, 'deck_file': 'slides/06/18.typ', 'deck_line': 9}],",
    "            'context': [{'file': 'slides/06/18.typ', 'line': 9}]}", ''].join('\n'));
  fs.writeFileSync(join(rules, 'X-NONE.py'), [
    "PROPOSITION = 'p'", "CRITERIA = {'VIOLATED': 'v', 'SATISFIED': 's'}",
    "def evidence(files, plan_lines=None):",
    "    return {'items': [{'file': 'a.typ', 'line': 1}]}", ''].join('\n'));
  fs.writeFileSync(join(rules, 'X-MET.py'), [
    "PROPOSITION = 'p MET'", "CRITERIA = {'VIOLATED': 'v', 'SATISFIED': 's'}", "SPANS = ('items',)",
    "def evidence(files, plan_lines=None):",
    "    return {'items': [{'file': 'a.typ', 'line': 5}]}", ''].join('\n'));
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.text();
      const p = body.includes('p MET') ? 0.1 : 0.94;
      return new Response(JSON.stringify({ answers: { q0: { probabilities: { VIOLATED: p } } } }));
    }
  });
  const res = await runRuleCheck(['--files', join(import.meta.dir, 'rule-check.ts'), '--rules', rules], server.port);
  server.stop(true);

  expect(res.exitCode).toBe(2);
  const by = Object.fromEntries(JSON.parse(res.stdout.toString()).verdicts.map((v: any) => [v.rule, v]));
  expect(by['X-SPAN']).toEqual({ rule: 'X-SPAN', p: 0.94, verdict: 'VIOLATED', spans: ['notes/18-insider.typ:113', 'notes/18-insider.typ:207'] });
  expect(by['X-CTX'].spans).toEqual(['notes/18-insider.typ:40']);
  expect('spans' in by['X-NONE']).toBe(false);
  expect(by['X-MET']).toEqual({ rule: 'X-MET', p: 0.1, verdict: 'MET' });
});

test('an empty reply marks the rule unavailable and exits 1', async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      await req.text();
      return new Response("");
    }
  });

  const res = await runRuleCheck(['--files', join(import.meta.dir, 'rule-check.ts')], server.port);
  server.stop(true);

  expect(res.exitCode).toBe(1);
  const out = JSON.parse(res.stdout.toString());
  expect(out.unavailable.length).toBeGreaterThan(0);
  expect(out.unavailable[0].reason).toContain('empty');
});

test('a 4xx reply marks the rule unavailable and exits 1', async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      await req.text();
      return new Response(JSON.stringify({ error: "bad" }), { status: 400 });
    }
  });

  const res = await runRuleCheck(['--files', join(import.meta.dir, 'rule-check.ts')], server.port);
  server.stop(true);

  expect(res.exitCode).toBe(1);
  const out = JSON.parse(res.stdout.toString());
  expect(out.unavailable.length).toBeGreaterThan(0);
});

test('project-dir mode reads changed and untracked files', async () => {
  let capturedBody = '';
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.json();
      if ((body.state || '').length > capturedBody.length) capturedBody = body.state || '';
      return new Response(JSON.stringify({
        answers: { q0: { probabilities: { VIOLATED: 0.1 }, choice: 'MET' } }
      }));
    }
  });

  const projectDir = mkTmp('rule-check-test-projdir-');
  try {
    const git = (...a: string[]) => spawnSync('git', a, { timeout: 120_000, cwd: projectDir });
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    fs.writeFileSync(join(projectDir, 'tracked_mod.py'), 'x = 1\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    fs.appendFileSync(join(projectDir, 'tracked_mod.py'), 'y = 2\n');
    fs.writeFileSync(join(projectDir, 'untracked_new.py'), 'z = 3\n');

    const res = await runRuleCheck(['--project-dir', projectDir], server.port);

    expect(res.exitCode).toBe(0);
    const out = JSON.parse(res.stdout.toString());
    expect(out.verdicts.length).toBeGreaterThan(0);
    expect(capturedBody).toContain('tracked_mod.py');
    expect(capturedBody).toContain('untracked_new.py');
  } finally {
    server.stop(true);
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});


test('the state carries the C8 preamble and project-relative paths', async () => {
  let capturedBody = '';
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.json();
      if ((body.state || '').length > capturedBody.length) capturedBody = body.state || '';
      return new Response(JSON.stringify({
        answers: { q0: { probabilities: { VIOLATED: 0.1 }, choice: 'MET' } }
      }));
    }
  });

  const tmpDir = mkTmp('rule-check-test-');
  fs.mkdirSync(join(tmpDir, 'data'));
  fs.mkdirSync(join(tmpDir, 'data', 'output'));
  // a Python file: the ds rules list only the files they read (rule-check.ts counts those as covered)
  fs.writeFileSync(join(tmpDir, 'data', 'output', 'x.py'), 'a = 1\n');
  
  spawnSync('git', ['init'], { timeout: 120_000, cwd: tmpDir });
  spawnSync('git', ['add', '.'], { timeout: 120_000, cwd: tmpDir });
  spawnSync('git', ['commit', '-m', 'init'], { timeout: 120_000, cwd: tmpDir, env: { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com' } });
  fs.appendFileSync(join(tmpDir, 'data', 'output', 'x.py'), 'b = 2\n');

  const res = await runRuleCheck(['--project-dir', tmpDir], server.port);
  server.stop(true);
  
  expect(res.exitCode).toBe(0);
  expect(capturedBody).toStartWith('You are auditing one data-science deliverable');
  expect(capturedBody).toContain('PROJECT: ' + basename(tmpDir));
  expect(capturedBody).toContain('EVIDENCE: data/output/x.py');
});

test('a transient failure is retried once', async () => {
  let requestCount = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      await req.text();
      requestCount++;
      if (requestCount % 2 === 1) {
        return new Response(JSON.stringify({ error: "bad" }), { status: 500 });
      }
      return new Response(JSON.stringify({
        answers: { q0: { probabilities: { VIOLATED: 0.1 }, choice: 'MET' } }
      }));
    }
  });

  const res = await runRuleCheck(['--files', join(import.meta.dir, 'rule-check.ts')], server.port);
  server.stop(true);

  expect(res.exitCode).toBe(0);
  const out = JSON.parse(res.stdout.toString());
  expect(out.verdicts.length).toBeGreaterThan(0);
});

test('an oversized state is truncated at 60000 chars', async () => {
  let capturedBody = '';
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.json();
      if ((body.state || '').length > capturedBody.length) capturedBody = body.state || '';
      return new Response(JSON.stringify({
        answers: { q0: { probabilities: { VIOLATED: 0.1 }, choice: 'MET' } }
      }));
    }
  });

  const tmpDir = mkTmp('rule-check-test-huge-');
  const hugeString = '# spec curve ' + 'x'.repeat(250) + '\n';
  // every rule lists every file uncapped, so 300 long paths outgrow 60000 chars in any extractor
  const name = (i: number) => 'huge' + i + '_' + 'x'.repeat(200) + '.py';
  for (let i = 0; i < 300; i++) {
    fs.writeFileSync(join(tmpDir, name(i)), hugeString.repeat(50));
  }
  
  spawnSync('git', ['init'], { timeout: 120_000, cwd: tmpDir });
  spawnSync('git', ['add', '.'], { timeout: 120_000, cwd: tmpDir });
  spawnSync('git', ['commit', '-m', 'init'], { timeout: 120_000, cwd: tmpDir, env: { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com' } });
  for (let i = 0; i < 300; i++) {
    fs.appendFileSync(join(tmpDir, name(i)), '\n# extra');
  }

  const res = await runRuleCheck(['--project-dir', tmpDir], server.port);
  server.stop(true);

  expect(capturedBody.length).toBeGreaterThan(60000);
  expect(capturedBody.length).toBeLessThan(60100);
  expect(capturedBody.endsWith('...[STATE TRUNCATED]...')).toBeTrue();
});

// ---- DQ4/DQ6 diff scope: only transforms on lines the round added or changed --------------------

import { changedRanges } from './rule-check.ts';

const LEGACY = [
  'import polars as pl',
  '',
  'def build(raw, ref):',
  '    kept = raw.filter(pl.col("x") > 0)',
  '    joined = kept.join(ref, on="id", how="inner")',
  '    out = joined.unique()',
  '    return out',
  '',
].join('\n');

function repo(prefix: string) {
  const d = fs.mkdtempSync(join(require('os').tmpdir(), prefix));
  const git = (...a: string[]) => spawnSync('git', ['-C', d, ...a], { timeout: 120_000, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  return { d, git };
}

// Every rule's state, keyed by rule, from one stubbed rule-check run.
async function statesOf(args: string[]) {
  const states: Record<string, any> = {};
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.json();
      const rule = /\(rule (\S+)\)/.exec(body.questions.q0.instructions)![1];
      states[rule] = JSON.parse(body.state.slice(body.state.indexOf('\n{')));
      return Response.json({ answers: { q0: { probabilities: { VIOLATED: 0.1 } } } });
    }
  });
  const res = await runRuleCheck(args, server.port);
  server.stop(true);
  expect(res.exitCode).toBe(0);
  return states;
}

test('changedRanges: -U0 hunks of tracked files, a deletion as a half-line point, untracked = all lines', () => {
  const { d, git } = repo('rule-check-ranges-');
  try {
    fs.writeFileSync(join(d, 'a.py'), Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join('\n') + '\n');
    fs.writeFileSync(join(d, 'same.py'), 'x = 1\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    const now = Array.from({ length: 10 }, (_, i) => `l${i + 1}`);
    now[4] = 'l5 changed';            // line 5 changed
    now.splice(7, 0, 'inserted');     // new line 8
    now.splice(9, 1);                 // old line 9 deleted: new lines 9 and 10 are l8 and l10
    fs.writeFileSync(join(d, 'a.py'), now.join('\n') + '\n');
    fs.writeFileSync(join(d, 'new.py'), 'a = 1\nb = 2\nc = 3\n');
    const r = changedRanges(d)!;
    const real = fs.realpathSync(d);
    expect(r[join(real, 'a.py')]).toEqual([[5, 5], [8, 8], [9.5, 9.5]]);
    expect(r[join(real, 'new.py')]).toEqual([[1, 4]]);
    expect(r[join(real, 'same.py')]).toBeUndefined();
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('changedRanges is null outside a git repo', () => {
  const d = mkTmp('rule-check-norepo-');
  try {
    expect(changedRanges(d)).toBeNull();
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('project-dir: DQ4/DQ6 consider only the changed transform and every transform of an untracked file', async () => {
  const { d, git } = repo('rule-check-dq-scope-');
  try {
    fs.writeFileSync(join(d, 'legacy.py'), LEGACY);
    git('add', '.');
    git('commit', '-qm', 'base');
    // one new transform in the legacy file; the three legacy transforms stay untouched
    fs.writeFileSync(join(d, 'legacy.py'), LEGACY.replace('    return out\n', '    out = out.drop_nulls()\n    return out\n'));
    fs.writeFileSync(join(d, 'fresh.py'), 'import polars as pl\n\ndef f(a, b):\n    c = a.filter(pl.col("y") > 1)\n    e = c.join(b, on="id")\n    return e\n');
    const s = await statesOf(['--project-dir', d]);
    for (const rule of ['DQ4', 'DQ6']) {
      const sites = s[rule].transform_sites.map((x: any) => `${x.file}:${x.line}`).sort();
      expect(sites).toEqual(['fresh.py:4', 'fresh.py:5', 'legacy.py:7']);
      expect(s[rule].n_transforms_considered).toBe(3);
      expect(s[rule].n_transforms_skipped_unchanged).toBe(3);
    }
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('a statement is in scope when a changed line falls inside its span, not next to it', async () => {
  const { d, git } = repo('rule-check-dq-span-');
  const multi = 'import polars as pl\n\ndef g(a, b):\n    c = a.join(\n        b,\n        on="id")\n    d = c.unique()\n    return d\n';
  try {
    fs.writeFileSync(join(d, 'm.py'), multi);
    git('add', '.');
    git('commit', '-qm', 'base');
    // line 5 sits inside the 3-line join at 4-6; the unique() at 7 is untouched
    fs.writeFileSync(join(d, 'm.py'), multi.replace('        b,\n', '        b.lazy().collect(),\n'));
    const s = await statesOf(['--project-dir', d]);
    expect(s.DQ4.transform_sites.map((x: any) => x.line)).toEqual([4]);
    expect(s.DQ4.n_transforms_skipped_unchanged).toBe(1);
    // deleting the line between the join and unique() touches neither statement's span
    fs.writeFileSync(join(d, 'm.py'), multi.replace('    d = c.unique()\n', '    d = c.unique()\n    pass\n'));
    git('commit', '-qam', 'pad');
    fs.writeFileSync(join(d, 'm.py'), multi);
    const s2 = await statesOf(['--project-dir', d]);
    expect(s2.DQ4.transform_sites).toEqual([]);
    expect(s2.DQ4.n_transforms_considered).toBe(0);
    expect(s2.DQ4.n_transforms_skipped_unchanged).toBe(2);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('no diff info (--files outside a repo): DQ4/DQ6 see every transform and carry no scope fields', async () => {
  const d = mkTmp('rule-check-dq-nodiff-');
  try {
    fs.writeFileSync(join(d, 'legacy.py'), LEGACY);
    const s = await statesOf(['--files', join(d, 'legacy.py')]);
    for (const rule of ['DQ4', 'DQ6']) {
      expect(s[rule].transform_sites.map((x: any) => x.line).sort()).toEqual([4, 5, 6]);
      expect(s[rule]).not.toHaveProperty('n_transforms_considered');
      expect(s[rule]).not.toHaveProperty('n_transforms_skipped_unchanged');
    }
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('the other ds rules see the same state with or without diff info', async () => {
  const { d, git } = repo('rule-check-dq-others-');
  try {
    fs.writeFileSync(join(d, 'legacy.py'), LEGACY);
    git('add', '.');
    git('commit', '-qm', 'base');
    fs.writeFileSync(join(d, 'legacy.py'), LEGACY + 'z = 1\n');
    const scoped = await statesOf(['--project-dir', d]);
    const plain = await statesOf(['--files', join(d, 'legacy.py')]);
    for (const rule of Object.keys(plain).filter(r => r !== 'DQ4' && r !== 'DQ6')) {
      expect(scoped[rule]).toEqual(plain[rule]);
    }
    expect(Object.keys(plain).length).toBeGreaterThan(2);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

// --batch: the per-edit Jev mod's path (hooks/jev/mod.ts). One Decisions call per run, one question
// per WIRED rule of the set, the rule's one-line statement in each verdict.
async function runBatch(args: string[], port: number, stdin?: string) {
  const p = Bun.spawn(['bun', 'run', join(import.meta.dir, 'rule-check.ts'), '--batch', ...args], {
    env: { ...process.env, WORK_HOLD_DECISIONS_URL: `http://localhost:${port}/`, WORK_HOLD_JUDGE_TOKEN: TEST_TOKEN },
    stdin: stdin === undefined ? 'ignore' : new TextEncoder().encode(stdin),
    stdout: 'pipe', stderr: 'pipe',
  });
  const [stdout, exitCode] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  return { stdout, exitCode };
}

const WRITING_DIR = join(import.meta.dir, '../../../constraints/jev/writing');

test('--batch: ONE Decisions call carrying every wired writing rule, none of uncalibrated/', async () => {
  const d = mkTmp('rule-check-batch-');
  try {
    const md = join(d, 'note.md');
    fs.writeFileSync(md, 'It may perhaps possibly be the case that the rate rose.\n');
    const bodies: any[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.json();
        bodies.push(body);
        const answers = Object.fromEntries(Object.keys(body.questions).map((k, i) => [k, { probabilities: { VIOLATED: i === 0 ? 0.2 : 0.93 } }]));
        return Response.json({ answers });
      }
    });
    const res = await runBatch(['--rules', WRITING_DIR, '--files', md], server.port);
    server.stop(true);

    expect(bodies.length).toBe(1);
    const rules = Object.values(bodies[0].questions).map((q: any) => /\(rule (\S+)\)/.exec(q.instructions)![1]).sort();
    const wired = fs.readdirSync(WRITING_DIR).filter(f => /^[^_].*\.py$/.test(f) && f !== 'evidence.py').map(f => f.slice(0, -3)).sort();
    expect(rules).toEqual(wired);
    for (const u of fs.readdirSync(join(WRITING_DIR, 'uncalibrated'))) {
      expect(bodies[0].state).not.toContain(`RULE ${u.replace(/\.py$/, '')} STATE`);
      expect(rules).not.toContain(u.replace(/\.py$/, ''));
    }
    for (const r of rules) expect(bodies[0].state).toContain(`=== RULE ${r} STATE ===`);
    expect(res.exitCode).toBe(2);
    const out = JSON.parse(res.stdout);
    const hedge = out.verdicts.find((v: any) => v.rule === 'W-HEDGE');
    expect(hedge.statement).toBe('The prose hedges more than its evidence warrants');
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('--batch: a failed call makes every rule unavailable after ONE attempt, exit 1', async () => {
  let n = 0;
  const server = Bun.serve({ port: 0, async fetch(req) { await req.text(); n++; return new Response(''); } });
  const res = await runBatch(['--rules', WRITING_DIR, '--files', join(import.meta.dir, '../SKILL.md')], server.port);
  server.stop(true);
  expect(n).toBe(1);
  expect(res.exitCode).toBe(1);
  const out = JSON.parse(res.stdout);
  expect(out.verdicts).toEqual([]);
  expect(out.unavailable.length).toBe(3);
});

test('--batch --changed-lines -: the changed map comes on stdin and scopes DQ4/DQ6', async () => {
  const { d, git } = repo('rule-check-batch-stdin-');
  try {
    fs.writeFileSync(join(d, 'legacy.py'), LEGACY);
    git('add', '.');
    git('commit', '-qm', 'base');
    let state = '';
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.json();
        state = body.state;
        return Response.json({ answers: Object.fromEntries(Object.keys(body.questions).map(k => [k, { probabilities: { VIOLATED: 0.1 } }])) });
      }
    });
    const file = join(d, 'legacy.py');
    const res = await runBatch(['--files', file, '--changed-lines', '-'], server.port, JSON.stringify({ [file]: [[5, 5]] }));
    server.stop(true);
    expect(res.exitCode).toBe(0);
    const section = state.slice(state.indexOf('=== RULE DQ4 STATE ===')).split('\n=== RULE ')[0];
    const dq4 = JSON.parse(section.slice(section.indexOf('\n') + 1));
    expect(dq4.transform_sites.map((x: any) => x.line)).toEqual([5]);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});
