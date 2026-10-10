import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  coverageColorFor,
  toPosixPath,
  relativeToSourceDir,
  readLineCoverage,
  assertEverySourceFileMeasured,
  countTestCases,
  writeBadge,
} from './quality-badges.mjs';

// One scratch directory for every case that needs real files; removed at the end.
const workDir = mkdtempSync(join(tmpdir(), 'quality-badges-'));
after(() => rmSync(workDir, { recursive: true, force: true }));

let uniqueCounter = 0;
function writeTemp(name, contents) {
  const path = join(workDir, `${uniqueCounter += 1}-${name}`);
  writeFileSync(path, contents);
  return path;
}

test('coverageColorFor lands on the boundary of each SonarCloud band', () => {
  assert.equal(coverageColorFor(100), 'brightgreen');
  assert.equal(coverageColorFor(90), 'brightgreen');
  assert.equal(coverageColorFor(89.9), 'green');
  assert.equal(coverageColorFor(80), 'green');
  assert.equal(coverageColorFor(70), 'yellowgreen');
  assert.equal(coverageColorFor(60), 'yellow');
  assert.equal(coverageColorFor(50), 'orange');
  assert.equal(coverageColorFor(49.9), 'red');
  assert.equal(coverageColorFor(0), 'red');
});

test('toPosixPath rewrites Windows separators and leaves posix ones alone', () => {
  assert.equal(toPosixPath('src\\sub\\file.rs'), 'src/sub/file.rs');
  assert.equal(toPosixPath('src/sub/file.rs'), 'src/sub/file.rs');
});

test('relativeToSourceDir strips the source prefix and rejects outsiders', () => {
  assert.equal(relativeToSourceDir('src/analyze.rs', 'src'), 'analyze.rs');
  assert.equal(relativeToSourceDir('src/nested/deep.rs', 'src'), 'nested/deep.rs');
  assert.equal(relativeToSourceDir('tests/cli.rs', 'src'), null);
  // A sibling that merely starts with the same letters is not inside src/.
  assert.equal(relativeToSourceDir('sources/a.rs', 'src'), null);
  // absolute records (cargo-llvm-cov) anchor on the source directory
  assert.equal(relativeToSourceDir('C:\\repo\\src\\ids.rs', 'src'), 'ids.rs');
  assert.equal(relativeToSourceDir('/home/runner/repo/src/nested/deep.rs', 'src'), 'nested/deep.rs');
});

test('readLineCoverage weights each file by its size, not by its percentage', () => {
  // 1/1 in one file and 0/99 in another averages to 50% but is 1% by lines.
  const lcov = writeTemp('cov.info', 'SF:src/a.rs\nLF:1\nLH:1\nSF:src/b.rs\nLF:99\nLH:0\n');
  assert.equal(readLineCoverage(lcov), 1);
});

test('readLineCoverage throws when the report carries no line records', () => {
  const empty = writeTemp('empty.info', 'TN:\nend_of_record\n');
  assert.throws(() => readLineCoverage(empty), /No line-coverage records/);
});

test('countTestCases counts every testcase element', () => {
  const junit = writeTemp(
    'junit.xml',
    '<testsuites><testcase name="one"/><testcase name="two" time="0.1"/></testsuites>',
  );
  assert.equal(countTestCases(junit), 2);
});

test('countTestCases throws on a report with no test cases', () => {
  const junit = writeTemp('empty.xml', '<testsuites></testsuites>');
  assert.throws(() => countTestCases(junit), /No test cases/);
});

// Lays down a source tree and an lcov that mentions the given measured files,
// then returns both paths for the guard to compare.
function sourceTreeAndReport(sourceFiles, measuredFiles) {
  const root = mkdtempSync(join(workDir, 'tree-'));
  const sourceDir = join(root, 'src');
  for (const relative of sourceFiles) {
    const full = join(sourceDir, relative);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, 'pub fn x() {}\n');
  }
  // Each SF: is absolute, as cargo-llvm-cov writes it, and ends in the source
  // directory the guard is handed, which is what relativeToSourceDir anchors on.
  const lcov = join(root, 'lcov.info');
  writeFileSync(lcov, measuredFiles.map((f) => `SF:${join(sourceDir, f)}\nLF:1\nLH:1`).join('\n') + '\n');
  return { lcov, sourceDir };
}

test('assertEverySourceFileMeasured passes when every source file was measured', () => {
  const { lcov, sourceDir } = sourceTreeAndReport(
    ['a.rs', 'nested/b.rs'],
    ['a.rs', 'nested/b.rs'],
  );
  assert.doesNotThrow(() => assertEverySourceFileMeasured(lcov, sourceDir, '.rs'));
});

test('assertEverySourceFileMeasured skips exempt files', () => {
  const { lcov, sourceDir } = sourceTreeAndReport(['a.rs', 'lib.rs'], ['a.rs']);
  assert.doesNotThrow(() => assertEverySourceFileMeasured(lcov, sourceDir, '.rs', ['lib.rs']));
  // exempting one file does not cover another
  assert.throws(() => assertEverySourceFileMeasured(lcov, sourceDir, '.rs', ['a.rs']), /lib\.rs/);
});

test('assertEverySourceFileMeasured rejects an exemption that names no source file', () => {
  const { lcov, sourceDir } = sourceTreeAndReport(['a.rs', 'lib.rs'], ['a.rs']);
  assert.throws(
    () => assertEverySourceFileMeasured(lcov, sourceDir, '.rs', ['lib.rs', 'gone.rs']),
    /Exempt gone\.rs names no \.rs file/,
  );
  // a file outside the measured extension is no source file either
  writeFileSync(join(sourceDir, 'notes.txt'), 'x\n');
  assert.throws(
    () => assertEverySourceFileMeasured(lcov, sourceDir, '.rs', ['lib.rs', 'notes.txt']),
    /Exempt notes\.txt/,
  );
});

test('assertEverySourceFileMeasured ignores unmeasured files of another extension', () => {
  const { lcov, sourceDir } = sourceTreeAndReport(['a.rs', 'notes.md', 'nested/data.json'], ['a.rs']);
  assert.doesNotThrow(() => assertEverySourceFileMeasured(lcov, sourceDir, '.rs'));
});

test('assertEverySourceFileMeasured throws and names the file no test loaded', () => {
  const { lcov, sourceDir } = sourceTreeAndReport(['a.rs', 'orphan.rs'], ['a.rs']);
  assert.throws(() => assertEverySourceFileMeasured(lcov, sourceDir, '.rs'), /orphan\.rs/);
});

test('writeBadge writes an endpoint document with the schema version and a trailing newline', () => {
  const outputDir = mkdtempSync(join(workDir, 'out-'));
  const file = writeBadge(outputDir, 'coverage', { label: 'coverage', message: '84.2%', color: 'green' });
  const raw = readFileSync(file, 'utf8');
  assert.ok(raw.endsWith('}\n'));
  assert.deepEqual(JSON.parse(raw), {
    schemaVersion: 1,
    label: 'coverage',
    message: '84.2%',
    color: 'green',
  });
});

// The command line, run as CI runs it: main() fires only for a direct call.
const script = fileURLToPath(new URL('./quality-badges.mjs', import.meta.url));
function runCli(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

test('the CLI rejects a call without the source extension', () => {
  const result = runCli(['lcov.info', 'junit.xml', 'src', 'badges']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: .*<source-extension> \[--exempt <file> \.\.\.\]/);
});

test('the CLI rejects an extra argument that is not --exempt', () => {
  const result = runCli(['lcov.info', 'junit.xml', 'src', 'badges', '.rs', 'lib.rs']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
});

test('the CLI rejects --exempt without a file', () => {
  const result = runCli(['lcov.info', 'junit.xml', 'src', 'badges', '.rs', '--exempt']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
});

test('the CLI passes every --exempt file to the completeness gate and writes both badges', () => {
  const { lcov, sourceDir } = sourceTreeAndReport(['a.rs', 'lib.rs', 'mod.rs'], ['a.rs']);
  const junit = writeTemp('junit.xml', '<testsuites><testcase name="one"/></testsuites>');
  const outputDir = join(workDir, `${uniqueCounter += 1}-badges`);

  const exemptBoth = runCli([lcov, junit, sourceDir, outputDir, '.rs', '--exempt', 'lib.rs', 'mod.rs']);
  assert.equal(exemptBoth.status, 0, exemptBoth.stderr);
  assert.deepEqual(readdirSync(outputDir).sort(), ['coverage.json', 'tests.json']);

  // only the files after --exempt are exempt
  const exemptOne = runCli([lcov, junit, sourceDir, outputDir, '.rs', '--exempt', 'lib.rs']);
  assert.equal(exemptOne.status, 1);
  assert.match(exemptOne.stderr, /No coverage was measured for mod\.rs/);
});
