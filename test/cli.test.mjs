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

test('--version prints the package.json version and exits 0', async () => {
  const { version } = JSON.parse(
    await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  await withProject({}, (dir) => {
    for (const flag of ['--version', '-V']) {
      const res = runCli(dir, [flag]);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(res.stdout.trim(), version);
    }
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

test('-v lists clean items with needs and wanted-by edges; default omits them', async () => {
  const files = {
    'spec.md': ['# Login', '`req:login#1`', '', 'Needs: impl:login#1'],
    'login.ts': ['// [impl:login#1]'],
  };
  await withProject(files, (dir) => {
    const dflt = runCli(dir);
    assert.equal(dflt.status, 0);
    assert.ok(!dflt.stdout.includes('req:login#1'));

    const res = runCli(dir, ['-v']);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /✔ req:login#1 "Login"\s+spec\.md:2\s+\[deep-covered\]/);
    assert.match(res.stdout, /needs impl:login#1\s+✔ login\.ts:1/);
    assert.match(res.stdout, /wanted by req:login#1\s+spec\.md:2/);
    assert.ok(res.stdout.trim().endsWith('ok'));
  });
});

test('-v resolves a wildcard need and shows the matched revision', async () => {
  const files = {
    'spec.md': ['`req:login#1`', '', 'Needs: impl:login#2.x'],
    'login.ts': ['// [impl:login#2.4]'],
  };
  await withProject(files, (dir) => {
    const res = runCli(dir, ['--verbose']);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /needs impl:login#2\.x \(→ impl:login#2\.4\)\s+✔ login\.ts:1/);
  });
});

test('-v renders a forwarding source as an arrow edge to its target', async () => {
  const files = {
    'spec.md': ['`req:login#1`', '', '`[req:login#1 --> dsn:auth#2]`', '', '`dsn:auth#2`'],
  };
  await withProject(files, (dir) => {
    const res = runCli(dir, ['-v']);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /✔ req:login#1\s+spec\.md:1\s+\[deep-covered\]/);
    assert.match(res.stdout, /→ dsn:auth#2\s+✔ spec\.md:5/);
  });
});

test('-v marks an item with a defective downstream chain as shallow-covered', async () => {
  const files = {
    'spec.md': ['`req:a#1`', '', 'Needs: req:b#1', '', '`req:b#1`', '', 'Needs: impl:missing#1'],
  };
  await withProject(files, (dir) => {
    const res = runCli(dir, ['-v']);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /~ req:a#1\s+spec\.md:1\s+\[shallow-covered\]/);
    assert.match(res.stdout, /needs req:b#1\s+✔ spec\.md:5/);
    assert.match(res.stdout, /✘ req:b#1\s+spec\.md:5\s+\[defective\]/);
  });
});

test('-v marks a forwarding to a nonexistent target as missing', async () => {
  await withProject(
    { 'spec.md': ['`req:a#1`', '', '`[req:a#1 --> dsn:gone#1]`'] },
    (dir) => {
      const res = runCli(dir, ['-v']);
      assert.equal(res.status, 1);
      assert.match(res.stdout, /✘ req:a#1\s+spec\.md:1\s+\[defective\]/);
      assert.match(res.stdout, /→ dsn:gone#1\s+✘ missing/);
      assert.match(res.stdout, /uncovered: forwards to dsn:gone#1/);
    },
  );
});

test('-v still renders parse problems', async () => {
  await withProject(
    { 'orphan.ts': ['// [>>utest:a#1]'] },
    (dir) => {
      const res = runCli(dir, ['-v']);
      assert.equal(res.status, 1);
      assert.match(res.stdout, /⚠ .*no preceding item tag/);
      assert.match(res.stdout, /problems\s+1\b/);
    },
  );
});

test('-v groups items by file then line, with a blank line between files', async () => {
  const files = {
    'a.md': ['`req:one#1`', '', '', '', '`req:two#1`'],
    'b.md': ['`req:three#1`'],
  };
  await withProject(files, (dir) => {
    const res = runCli(dir, ['-v']);
    assert.equal(res.status, 0);
    const one = res.stdout.indexOf('req:one#1');
    const two = res.stdout.indexOf('req:two#1');
    const three = res.stdout.indexOf('req:three#1');
    assert.ok(one >= 0 && one < two && two < three, res.stdout);
    assert.match(res.stdout, /req:two#1\s+a\.md:5\s+\[deep-covered\]\n\n✔ req:three#1/);
  });
});

test('-v lists every revision a wildcard need resolves to', async () => {
  const files = {
    'spec.md': ['`req:login#1`', '', 'Needs: impl:login#2.x'],
    'login.ts': ['// [impl:login#2.4]', '// [impl:login#2.5]'],
  };
  await withProject(files, (dir) => {
    const res = runCli(dir, ['-v']);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /needs impl:login#2\.x \(→ impl:login#2\.4\)\s+✔ login\.ts:1/);
    assert.match(res.stdout, /needs impl:login#2\.x \(→ impl:login#2\.5\)\s+✔ login\.ts:2/);
  });
});

test('-v keeps defect details and the exit code of a defective run', async () => {
  await withProject(
    { 'spec.md': ['`req:login#1`', '', 'Needs: impl:missing#1'] },
    (dir) => {
      const res = runCli(dir, ['-v']);
      assert.equal(res.status, 1);
      assert.match(res.stdout, /✘ req:login#1\s+spec\.md:1\s+\[defective\]/);
      assert.match(res.stdout, /needs impl:missing#1\s+✘ missing/);
      assert.match(res.stdout, /uncovered: needs impl:missing#1/);
      assert.ok(res.stdout.trim().endsWith('not ok'));
    },
  );
});

// Returns a path that reaches SCRIPT through a link, as pnpm bins do. File
// symlinks need elevation on Windows, so fall back to a directory junction.
async function linkToScript(linkDir) {
  const link = path.join(linkDir, 'flashtrace-link.mjs');
  try {
    await fs.symlink(SCRIPT, link, 'file');
    return link;
  } catch (err) {
    if (err.code !== 'EPERM') throw err;
    const junction = path.join(linkDir, 'dist-link');
    await fs.symlink(path.dirname(SCRIPT), junction, 'junction');
    return path.join(junction, path.basename(SCRIPT));
  }
}

test('CLI runs when invoked through a symlink (pnpm-style bin)', async () => {
  const linkDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flashtrace-link-'));
  try {
    const link = await linkToScript(linkDir);
    await withProject({ 'spec.md': ['`req:login#1`'] }, (dir) => {
      const res = spawnSync(process.execPath, [link], { cwd: dir, encoding: 'utf8' });
      assert.equal(res.status, 0, res.stderr);
      assert.ok(res.stdout.trim().endsWith('ok'), `expected report output, got: ${JSON.stringify(res.stdout)}`);
    });
  } finally {
    await fs.rm(linkDir, { recursive: true, force: true });
  }
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
