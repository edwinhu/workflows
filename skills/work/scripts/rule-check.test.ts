import { expect, test } from "bun:test";
import { $ } from "bun";
import { join, basename } from "path";
import { spawnSync } from "child_process";
import * as fs from "fs";

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

  const projectDir = fs.mkdtempSync(join(require('os').tmpdir(), 'rule-check-test-projdir-'));
  try {
    const git = (...a: string[]) => spawnSync('git', a, { cwd: projectDir });
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

  const tmpDir = fs.mkdtempSync(join(require('os').tmpdir(), 'rule-check-test-'));
  fs.mkdirSync(join(tmpDir, 'data'));
  fs.mkdirSync(join(tmpDir, 'data', 'output'));
  fs.writeFileSync(join(tmpDir, 'data', 'output', 'x.csv'), 'a,b,c\n1,2,3');
  
  spawnSync('git', ['init'], { cwd: tmpDir });
  spawnSync('git', ['add', '.'], { cwd: tmpDir });
  spawnSync('git', ['commit', '-m', 'init'], { cwd: tmpDir, env: { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com' } });
  fs.appendFileSync(join(tmpDir, 'data', 'output', 'x.csv'), '4,5,6');

  const res = await runRuleCheck(['--project-dir', tmpDir], server.port);
  server.stop(true);
  
  expect(res.exitCode).toBe(0);
  expect(capturedBody).toStartWith('You are auditing one data-science deliverable');
  expect(capturedBody).toContain('PROJECT: ' + basename(tmpDir));
  expect(capturedBody).toContain('EVIDENCE: data/output/x.csv');
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

  const tmpDir = fs.mkdtempSync(join(require('os').tmpdir(), 'rule-check-test-huge-'));
  const hugeString = '# spec curve ' + 'x'.repeat(250) + '\n';
  for (let i = 0; i < 300; i++) {
    fs.writeFileSync(join(tmpDir, 'huge' + i + '.py'), hugeString.repeat(50));
  }
  
  spawnSync('git', ['init'], { cwd: tmpDir });
  spawnSync('git', ['add', '.'], { cwd: tmpDir });
  spawnSync('git', ['commit', '-m', 'init'], { cwd: tmpDir, env: { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com' } });
  for (let i = 0; i < 300; i++) {
    fs.appendFileSync(join(tmpDir, 'huge' + i + '.py'), '\n# extra');
  }

  const res = await runRuleCheck(['--project-dir', tmpDir], server.port);
  server.stop(true);

  expect(capturedBody.length).toBeGreaterThan(60000);
  expect(capturedBody.length).toBeLessThan(60100);
  expect(capturedBody.endsWith('...[STATE TRUNCATED]...')).toBeTrue();
});
