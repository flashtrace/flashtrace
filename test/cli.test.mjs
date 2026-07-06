import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findGit } from '../src/files.mjs';

const SCRIPT = fileURLToPath(new URL('../dist/flashtrace.mjs', import.meta.url));

function runCli(cwd, args = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
}

async function withProject(files, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flashtrace-test-'));
  try {
    for (const [name, lines] of Object.entries(files)) {
      await fs.writeFile(path.join(dir, name), lines.join('\n') + '\n');
    }
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('clean project: exit 0 and final "ok"', async () => {
  await withProject(
    {
      'spec.md': ['# Login', '`req:login#1`', '', 'Needs: impl:login#1'],
      'login.ts': ['// [impl:login#1]'],
    },
    (dir) => {
      const res = runCli(dir);
      assert.equal(res.status, 0);
      assert.ok(res.stdout.trim().endsWith('ok'));
      assert.ok(!res.stdout.includes('not ok'));
    },
  );
});

test('defective project: exit 1, defect listed, final "not ok"', async () => {
  await withProject(
    { 'spec.md': ['`req:login#1`', '', 'Needs: impl:missing#1'] },
    (dir) => {
      const res = runCli(dir);
      assert.equal(res.status, 1);
      assert.match(res.stdout, /uncovered: needs impl:missing#1/);
      assert.ok(res.stdout.trim().endsWith('not ok'));
    },
  );
});

test('parse problems alone make the run fail', async () => {
  await withProject(
    { 'orphan.ts': ['// [>>utest:a#1]'] },
    (dir) => {
      const res = runCli(dir);
      assert.equal(res.status, 1);
      assert.match(res.stdout, /no preceding item tag/);
    },
  );
});

test('unknown option: exit 2 with message on stderr', async () => {
  await withProject({}, (dir) => {
    const res = runCli(dir, ['--frobnicate']);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /unknown option/);
  });
});

test('non-existent input path: exit 2', async () => {
  await withProject({}, (dir) => {
    const res = runCli(dir, ['does-not-exist']);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /does not exist/);
  });
});

test('--tags filters markdown items; "_" re-admits untagged ones', async () => {
  const files = {
    'spec.md': [
      '# A',
      '`req:a#1`',
      '',
      'Tags: Auth',
      '',
      '# B',
      '`req:b#1`',
    ],
  };
  await withProject(files, (dir) => {
    const tagged = runCli(dir, ['-t', 'Auth']);
    assert.equal(tagged.status, 0);
    assert.match(tagged.stdout, /items\s+1\b/);

    const withUntagged = runCli(dir, ['-t', 'Auth,_']);
    assert.equal(withUntagged.status, 0);
    assert.match(withUntagged.stdout, /items\s+2\b/);
  });
});

test('git-ignored files are excluded from the scan', async (t) => {
  const git = findGit();
  if (!git || spawnSync(git, ['--version']).status !== 0) {
    t.skip('git not available in a fixed install location');
    return;
  }
  await withProject(
    {
      '.gitignore': ['ignored.md'],
      'tracked.md': ['`req:good#1`'],
      'ignored.md': ['`req:bad#1`', '', 'Needs: impl:missing#1'],
    },
    (dir) => {
      assert.equal(spawnSync(git, ['init', '-q'], { cwd: dir }).status, 0);
      const res = runCli(dir);
      assert.equal(res.status, 0, res.stdout);
      assert.ok(!res.stdout.includes('req:bad#1'));
    },
  );
});
