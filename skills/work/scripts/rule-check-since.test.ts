// rule-check --since: a run's rule scope is what THIS run changed, not the tree's pre-existing WIP.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'fs';
import { join } from 'path';
import { useTmp } from '../../../tests/helpers/tmp.ts';
import { changedFiles, changedRanges } from './rule-check.ts';

const mkTmp = useTmp();
const HERE = import.meta.dir;
const SNAPSHOT = join(HERE, 'tree-snapshot.sh');
const CHECKS = join(HERE, 'work-checks.sh');

const GIT = ['-c', 'user.email=t@t', '-c', 'user.name=t'];
const git = (d: string, ...a: string[]) => {
  const r = spawnSync('git', ['-C', d, ...GIT, ...a], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const snapshot = (d: string) => spawnSync('bash', [SNAPSHOT, d], { encoding: 'utf8' });
const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** A repo with a committed file, then WIP: a tracked line edit and an untracked file, both predating the "run". */
function wipRepo() {
  const d = realpathSync(mkTmp('rule-since-'));
  git(d, 'init', '-q');
  writeFileSync(join(d, 'a.py'), 'ok = 1\nmid = 2\nend = 3\n');
  writeFileSync(join(d, '.gitignore'), 'ignored.log\n');
  git(d, 'add', '.');
  git(d, 'commit', '-qm', 'base');
  writeFileSync(join(d, 'a.py'), 'ok = 1\nWIP_VIOLATION = 2\nend = 3\n');
  writeFileSync(join(d, 'wip_new.py'), 'WIP_UNTRACKED = 1\n');
  writeFileSync(join(d, 'ignored.log'), 'noise\n');
  return d;
}

describe('tree-snapshot.sh', () => {
  test('leaves git status, the real index and the files byte-identical, and honours .gitignore', () => {
    const d = wipRepo();
    const before = { status: git(d, 'status', '--porcelain=v2', '--ignored'), index: sha256(join(d, '.git', 'index')), a: sha256(join(d, 'a.py')) };
    const stashBefore = git(d, 'stash', 'list');
    const r = snapshot(d);
    expect(r.status).toBe(0);
    const tree = r.stdout.trim();
    expect(tree).toMatch(/^[0-9a-f]{40,64}$/);
    expect(git(d, 'status', '--porcelain=v2', '--ignored')).toBe(before.status);
    expect(sha256(join(d, '.git', 'index'))).toBe(before.index);
    expect(sha256(join(d, 'a.py'))).toBe(before.a);
    expect(git(d, 'stash', 'list')).toBe(stashBefore);
    const names = git(d, 'ls-tree', '-r', '--name-only', tree).split('\n');
    expect(names).toContain('wip_new.py');
    expect(names).not.toContain('ignored.log');
    expect(git(d, 'show', `${tree}:a.py`)).toContain('WIP_VIOLATION');
  });

  test('a repo with no commit, and a non-repo', () => {
    const empty = mkTmp('rule-since-empty-');
    git(empty, 'init', '-q');
    writeFileSync(join(empty, 'x.py'), 'x = 1\n');
    expect(snapshot(empty).stdout.trim()).toMatch(/^[0-9a-f]{40,64}$/);
    const none = mkTmp('rule-since-norepo-');
    const r = snapshot(none);
    expect([r.status, r.stdout.trim()]).toEqual([0, '']);
  });
});

describe('changedFiles / changedRanges --since', () => {
  test('with the dispatch snapshot only the run\'s own lines and files are in scope; without it the WIP is too', () => {
    const d = wipRepo();
    const snap = snapshot(d).stdout.trim();
    // the run: one compliant line appended, one new file
    writeFileSync(join(d, 'a.py'), 'ok = 1\nWIP_VIOLATION = 2\nend = 3\nrun_line = 4\n');
    writeFileSync(join(d, 'run_new.py'), 'run_new = 1\n');

    // no --since: unchanged behaviour, the whole tree's WIP is scored
    expect(changedFiles(d).sort()).toEqual([join(d, 'a.py'), join(d, 'run_new.py'), join(d, 'wip_new.py')]);
    const old = changedRanges(d)!;
    expect(old[join(d, 'a.py')]).toEqual([[2, 2], [4, 4]]);          // line 2 is the WIP violation
    expect(old[join(d, 'wip_new.py')]).toBeDefined();

    // --since: only what the run wrote
    expect(changedFiles(d, snap).sort()).toEqual([join(d, 'a.py'), join(d, 'run_new.py')]);
    const scoped = changedRanges(d, snap)!;
    expect(scoped[join(d, 'a.py')]).toEqual([[4, 4]]);               // the WIP line 2 is out of scope
    expect(scoped[join(d, 'run_new.py')]).toEqual([[1, 1]]);
    expect(scoped[join(d, 'wip_new.py')]).toBeUndefined();
  });

  test('a run that changes nothing has an empty scope even over a dirty tree', () => {
    const d = wipRepo();
    const snap = snapshot(d).stdout.trim();
    expect(changedFiles(d, snap)).toEqual([]);
    expect(changedRanges(d, snap)).toEqual({});
  });

  test('a file the run deletes is not listed', () => {
    const d = wipRepo();
    const snap = snapshot(d).stdout.trim();
    spawnSync('rm', [join(d, 'wip_new.py')]);
    expect(changedFiles(d, snap)).toEqual([]);
  });
});

describe('rule-check.ts CLI --since', () => {
  const run = (args: string[]) => spawnSync('bun', ['run', join(HERE, 'rule-check.ts'), '--workflow', 'ds', ...args], { encoding: 'utf8' });

  test('a run that changed nothing since the snapshot is "nothing in scope", WIP notwithstanding', () => {
    const d = wipRepo();
    const snap = snapshot(d).stdout.trim();
    const r = run(['--project-dir', d, '--since', snap]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.trim().split('\n').pop()!).scope).toMatch(/^nothing in scope/);
  });

  test('an unknown tree is refused, not read as no scope', () => {
    const d = wipRepo();
    const r = run(['--project-dir', d, '--since', '0'.repeat(40)]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--since');
  });
});

describe('work-checks.sh appends --since from args.runBaseline', () => {
  const BASE = 'a'.repeat(40);
  function checks(args: any, cmd: string) {
    const dir = mkTmp('rule-since-checks-');
    const a = join(dir, 'args.json'), raw = join(dir, 'raw.json'), out = join(dir, 'checks.json');
    writeFileSync(a, JSON.stringify(args));
    writeFileSync(raw, JSON.stringify({ stage: 'agents', agents: {}, checkPlan: { red: [], acceptance: [], mechanical: [], rules: [{ name: 'rules', cmd }] } }));
    const r = spawnSync('bash', [CHECKS, a, raw, out], { encoding: 'utf8', env: { ...process.env, WORK_CHECK_TIMEOUT: '30' } });
    expect(r.status).toBe(0);
    return JSON.parse(readFileSync(out, 'utf8')).rules[0];
  }
  const echo = (word: string) => `f() { echo "{\\"cmdline\\":\\"$*\\"}"; }; f ${word}`;

  test('rule-check.ts and workflow-check commands get it; other commands and an explicit --since do not', () => {
    const dir = mkTmp('rule-since-proj-');
    const args = { projectDir: dir, tasks: [], runBaseline: BASE };
    expect(JSON.parse(checks(args, echo('rule-check.ts --project-dir x')).stdout).cmdline).toBe(`rule-check.ts --project-dir x --since ${BASE}`);
    expect(JSON.parse(checks(args, echo('workflow-check dev --rules-only')).stdout).cmdline).toBe(`workflow-check dev --rules-only --since ${BASE}`);
    expect(JSON.parse(checks(args, echo('other-linter')).stdout).cmdline).toBe('other-linter');
    expect(JSON.parse(checks(args, echo('rule-check.ts --since beef')).stdout).cmdline).toBe('rule-check.ts --since beef');
  });

  test('no runBaseline, or one that is not a hex sha, leaves the command as written', () => {
    const dir = mkTmp('rule-since-proj-');
    expect(JSON.parse(checks({ projectDir: dir, tasks: [] }, echo('rule-check.ts')).stdout).cmdline).toBe('rule-check.ts');
    expect(JSON.parse(checks({ projectDir: dir, tasks: [], runBaseline: 'x; rm -rf /' }, echo('rule-check.ts')).stdout).cmdline).toBe('rule-check.ts');
  });
});
