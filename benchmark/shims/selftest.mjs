/*
 * Shim self-test, run under Node:
 *   node benchmark/shims/selftest.mjs
 *
 * Compares the pure-JS shims (node-path, node-url) against the real Node
 * implementations over a case battery. The qjs:os-backed shims (fs, process,
 * child_process) are validated end-to-end instead, by byte-diffing flashtrace
 * output across runtimes (see run.sh).
 */

import * as realPath from 'node:path';
import { fileURLToPath as realFtp, pathToFileURL as realPtf } from 'node:url';
import * as shimPath from './node-path.mjs';
import { fileURLToPath, pathToFileURL } from './node-url.mjs';

shimPath.__setCwd(() => process.cwd());

let fails = 0;
const check = (what, got, want) => {
  if (got !== want) {
    console.error(`FAIL ${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    fails++;
  }
};

const paths = [
  '.', '..', '/', '', 'a', 'a/b', 'a/b/', '/a/b/c', './a/../b', 'a//b///c',
  '/a/../..', '../x/y', 'src/main.mjs', 'a/.hidden', '.hidden', 'file.',
  'file.tar.gz', '/abs/file.md', 'dir.d/file', 'noext', 'a/b/../../..',
];

for (const p of paths) {
  check(`extname(${p})`, shimPath.extname(p), realPath.extname(p));
  check(`normalize(${p})`, shimPath.normalize(p), realPath.normalize(p));
  check(`resolve(${p})`, shimPath.resolve(p), realPath.resolve(p));
  check(`dirname(${p})`, shimPath.dirname(p), realPath.dirname(p));
  check(`basename(${p})`, shimPath.basename(p), realPath.basename(p));
  for (const q of ['x', '/x/y', '..', 'x/../y', '']) {
    check(`join(${p},${q})`, shimPath.join(p, q), realPath.join(p, q));
    check(`resolve(${p},${q})`, shimPath.resolve(p, q), realPath.resolve(p, q));
  }
}

for (const [from, to] of [
  ['/a/b', '/a/b/c'], ['/a/b/c', '/a/b'], ['/a/b', '/a/b'], ['/', '/x'],
  ['/a/b/c', '/a/x/y'], ['.', 'src/main.mjs'], ['src', 'docs/index.md'],
]) {
  check(`relative(${from},${to})`, shimPath.relative(from, to), realPath.relative(from, to));
}

for (const p of ['/plain/path/file.mjs', '/with space/f.md', '/pct%25/f', '/q?a#b']) {
  check(`pathToFileURL(${p})`, pathToFileURL(p).href, realPtf(p).href);
}
for (const u of ['file:///plain/path/file.mjs', 'file:///with%20space/f.md']) {
  check(`fileURLToPath(${u})`, fileURLToPath(u), realFtp(u));
}

if (fails) {
  console.error(`${fails} failures`);
  process.exit(1);
}
console.log('shim selftest: all checks passed');
