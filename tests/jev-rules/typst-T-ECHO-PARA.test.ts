import { afterAll, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { collectEvidence } from '../../skills/work/scripts/rule-check.ts';
import { caseInput } from '../../skills/work/scripts/rule-calibrate.ts';

// typst/T-ECHO-PARA, extractor only (no Jev): the minimal twins must differ in what it extracts, and the
// state must stay under rule-check's 60000-char cap. Scaffolded by the jev-rules skill.
const ROOT = join(import.meta.dir, '../..');
const ID = 'T-ECHO-PARA';
const DIR = existsSync(join(ROOT, 'constraints/jev/typst', `${ID}.py`)) ? 'constraints/jev/typst' : 'constraints/jev/typst/uncalibrated';
const temps: string[] = [];
afterAll(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

function stateOf(twin: 'vio' | 'sat') {
  const input = caseInput('files', join(ROOT, 'tests/fixtures/jev/typst', ID, twin), temps);
  const ev = collectEvidence({ ...input, rulesDir: join(ROOT, DIR) });
  expect(ev[ID]).toBeDefined();
  return JSON.stringify(ev[ID].state);
}

test(`${ID}: the extractor separates the violating twin from the compliant twin`, () => {
  const vio = stateOf('vio');
  const sat = stateOf('sat');
  expect(vio.length).toBeLessThan(60000);
  expect(sat.length).toBeLessThan(60000);
  expect(vio).not.toBe(sat);
});

test(`${ID}: both twins list the one low-overlap pair; only the first line differs`, () => {
  const [v, s] = (['vio', 'sat'] as const).map(t => JSON.parse(stateOf(t)).slides_subtitle_and_first_body_line);
  expect(v).toHaveLength(1);
  expect(s).toHaveLength(1);
  expect(v[0].subtitle).toBe(s[0].subtitle);
  expect(v[0].first_body_line.text).not.toBe(s[0].first_body_line.text);
});
