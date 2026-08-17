/*
 * End-to-end suite: runs the built CLI over the example projects under
 * examples/ and compares full stdout byte-for-byte against the snapshot
 * files in test/e2e-expect/. Each example is copied to a fresh temp directory first,
 * so the run is isolated from this repository's git metadata and file
 * collection uses the deterministic walk + sort path.
 *
 * Snapshots are generated from the actual CLI output, never written by hand:
 *   FLASHTRACE_UPDATE_SNAPSHOTS=1 pnpm test
 * then review the diff before committing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../dist/flashtrace.mjs', import.meta.url));
const EXAMPLES = fileURLToPath(new URL('../examples', import.meta.url));
const SNAPSHOTS = fileURLToPath(new URL('./e2e-expect', import.meta.url));

const UPDATE = process.env.FLASHTRACE_UPDATE_SNAPSHOTS === '1';

// one CLI run per row: example directory, arguments, expected exit code; the
// snapshot file is <example>.<variant>.txt
const CASES = [
  { example: 'basic', variant: 'default', args: [], status: 0 },
  { example: 'basic', variant: 'verbose', args: ['-v'], status: 0 },
  { example: 'basic', variant: 'json', args: ['--json'], status: 0 },
  { example: 'shortforms', variant: 'default', args: [], status: 0 },
  { example: 'shortforms', variant: 'verbose', args: ['-v'], status: 0 },
  { example: 'shortforms', variant: 'json', args: ['--json'], status: 0 },
  { example: 'multiplicity', variant: 'default', args: [], status: 0 },
  { example: 'multiplicity', variant: 'verbose', args: ['-v'], status: 0 },
  { example: 'multiplicity', variant: 'json', args: ['--json'], status: 0 },
  { example: 'revisions-and-forwarding', variant: 'default', args: [], status: 0 },
  { example: 'revisions-and-forwarding', variant: 'verbose', args: ['-v'], status: 0 },
  { example: 'revisions-and-forwarding', variant: 'json', args: ['--json'], status: 0 },
  { example: 'polyglot-web', variant: 'default', args: [], status: 0 },
  { example: 'polyglot-web', variant: 'verbose', args: ['-v'], status: 0 },
  { example: 'polyglot-web', variant: 'tags', args: ['--tags', 'web,data'], status: 0 },
  { example: 'polyglot-web', variant: 'json', args: ['--json'], status: 0 },
  { example: 'hyperglot', variant: 'default', args: [], status: 0 },
  { example: 'hyperglot', variant: 'verbose', args: ['-v'], status: 0 },
  { example: 'hyperglot', variant: 'json', args: ['--json'], status: 0 },
  { example: 'diagnostics', variant: 'default', args: [], status: 1 },
  { example: 'diagnostics', variant: 'verbose', args: ['-v'], status: 1 },
  { example: 'diagnostics', variant: 'json', args: ['--json'], status: 1 },
];

async function runInTempCopy(example, args) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flashtrace-e2e-'));
  try {
    await fs.cp(path.join(EXAMPLES, example), dir, { recursive: true });
    return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8' });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// Windows runs print backslash paths (e.g. tests\store.test.ts); normalize so
// both platforms assert against the same snapshot files. The JSON report's
// `flashtrace` version is provenance only and bumps every release, so pin it to
// a placeholder rather than re-snapshot on each bump. Anchored to the line
// start at top-level indentation: only the document's own field sits there -
// nested fields sit deeper, and text inside a JSON string cannot open a line
// with an unescaped quote - so snapshot content can never be rewritten.
const normalize = (s) =>
  s.replaceAll('\\', '/').replace(/^(  "flashtrace": ")[^"]*"/m, '$1<version>"');

function firstDifference(expected, actual) {
  const e = expected.split('\n');
  const a = actual.split('\n');
  for (let i = 0; i < Math.max(e.length, a.length); i++) {
    if (e[i] !== a[i]) {
      return [
        `first difference at line ${i + 1}:`,
        `  expected: ${e[i] === undefined ? '<end of snapshot>' : JSON.stringify(e[i])}`,
        `  actual:   ${a[i] === undefined ? '<end of output>' : JSON.stringify(a[i])}`,
      ].join('\n');
    }
  }
  return 'outputs are equal';
}

for (const { example, variant, args, status } of CASES) {
  test(`e2e: ${example} (${variant})`, async () => {
    const res = await runInTempCopy(example, args);
    assert.equal(res.stderr, '', `unexpected stderr: ${res.stderr}`);
    assert.equal(res.status, status, `exit code mismatch, stdout:\n${res.stdout}`);

    const actual = normalize(res.stdout);
    const file = path.join(SNAPSHOTS, `${example}.${variant}.txt`);
    if (UPDATE) await fs.writeFile(file, actual);
    const expected = await fs.readFile(file, 'utf8');
    assert.equal(
      actual,
      expected,
      `output does not match snapshot ${path.basename(file)}\n${firstDifference(expected, actual)}`,
    );
  });
}
