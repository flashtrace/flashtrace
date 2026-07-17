import { test } from 'node:test';
import assert from 'node:assert/strict';

import { report } from '../src/report.mjs';

// No parse or analysis check emits warning problems yet, so the warning
// behavior is exercised with directly constructed problem objects.
function runReport(problems) {
  const lines = [];
  const originalLog = console.log;
  console.log = (text) => lines.push(text);
  try {
    const clean = report([], problems, process.cwd());
    return { clean, output: lines.join('\n') };
  } finally {
    console.log = originalLog;
  }
}

const warning = { severity: 'warning', file: 'a.ts', line: 3, message: 'suspicious usage' };
const error = { severity: 'error', file: 'b.ts', line: 7, message: 'unprocessable input' };

test('warning problems alone leave the run clean (exit 0)', () => {
  const { clean, output } = runReport([warning]);
  assert.equal(clean, true);
  assert.match(output, /⚠ suspicious usage\s+a\.ts:3/);
  assert.match(output, /warnings\s+1\b/);
  assert.ok(!output.includes('errors'), output);
  assert.ok(output.trim().endsWith('ok'));
  assert.ok(!output.includes('not ok'), output);
});

test('an error problem makes the run un-clean (exit 1)', () => {
  const { clean, output } = runReport([error]);
  assert.equal(clean, false);
  assert.match(output, /‼ unprocessable input\s+b\.ts:7/);
  assert.match(output, /errors\s+1\b/);
  assert.ok(!output.includes('warnings'), output);
  assert.ok(output.trim().endsWith('not ok'));
});

test('errors and warnings are rendered distinctly and counted separately', () => {
  const { clean, output } = runReport([warning, error]);
  assert.equal(clean, false);
  assert.match(output, /⚠ suspicious usage\s+a\.ts:3/);
  assert.match(output, /‼ unprocessable input\s+b\.ts:7/);
  assert.match(output, /errors\s+1\b/);
  assert.match(output, /warnings\s+1\b/);
  assert.ok(output.trim().endsWith('not ok'));
});

test('no problems: the summary shows neither an errors nor a warnings count', () => {
  const { clean, output } = runReport([]);
  assert.equal(clean, true);
  assert.ok(!output.includes('errors'), output);
  assert.ok(!output.includes('warnings'), output);
  assert.ok(output.trim().endsWith('ok'));
});
