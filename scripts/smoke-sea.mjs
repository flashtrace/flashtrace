/**
 * Smoke test for a SEA binary produced by scripts/build-sea.mjs: runs it
 * against tiny fixture projects and asserts output and exit codes (0 clean,
 * 1 defects, 2 usage error). Takes the binary path as argument, defaulting
 * to the one in dist-sea/ for the current platform and package.json version.
 */

import assert from 'node:assert/strict';
import { promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const binary =
  process.argv[2] ??
  path.join(
    root,
    'dist-sea',
    `flashtrace-v${version}-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`,
  );

async function withProject(files, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flashtrace-sea-'));
  try {
    for (const [name, lines] of Object.entries(files)) {
      await fs.writeFile(path.join(dir, name), lines.join('\n') + '\n');
    }
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function check(name, cwd, args, expect) {
  const res = spawnSync(binary, args, { cwd, encoding: 'utf8' });
  assert.equal(res.error, undefined, `${name}: ${res.error}`);
  assert.equal(res.status, expect.status, `${name}: stdout=${res.stdout} stderr=${res.stderr}`);
  expect.verify(res);
  console.log(`ok - ${name}`);
}

await withProject(
  {
    'spec.md': ['# Login', '`req:login#1`', '', 'Needs: impl:login#1'],
    'login.ts': ['// [impl:login#1]'],
  },
  (dir) =>
    check('clean project exits 0', dir, [], {
      status: 0,
      verify: (res) => {
        assert.ok(res.stdout.trim().endsWith('ok'), res.stdout);
        assert.ok(!res.stdout.includes('not ok'), res.stdout);
      },
    }),
);

await withProject(
  { 'spec.md': ['`req:login#1`', '', 'Needs: impl:missing#1'] },
  (dir) =>
    check('defective project exits 1', dir, [], {
      status: 1,
      verify: (res) => {
        assert.match(res.stdout, /uncovered: needs impl:missing#1/);
        assert.ok(res.stdout.trim().endsWith('not ok'), res.stdout);
      },
    }),
);

await withProject({}, (dir) => {
  check('unknown option exits 2', dir, ['--frobnicate'], {
    status: 2,
    verify: (res) => assert.match(res.stderr, /unknown option/),
  });
  check('--version prints the baked version', dir, ['--version'], {
    status: 0,
    verify: (res) => assert.equal(res.stdout.trim(), version),
  });
});

console.log(`smoke test passed: ${binary}`);
