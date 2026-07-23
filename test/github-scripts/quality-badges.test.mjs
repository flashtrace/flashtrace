import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  coverageColorFor,
  toPosixPath,
  relativeToSourceDir,
  readLineCoverage,
  assertEverySourceFileMeasured,
  countTestCases,
  writeBadge,
} from '../../.github/scripts/quality-badges.mjs';

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
  assert.equal(toPosixPath('src\\sub\\file.mjs'), 'src/sub/file.mjs');
  assert.equal(toPosixPath('src/sub/file.mjs'), 'src/sub/file.mjs');
});

test('relativeToSourceDir strips the source prefix and rejects outsiders', () => {
  assert.equal(relativeToSourceDir('src/analyze.mjs', 'src'), 'analyze.mjs');
  assert.equal(relativeToSourceDir('src/nested/deep.mjs', 'src'), 'nested/deep.mjs');
  assert.equal(relativeToSourceDir('test/analyze.test.mjs', 'src'), null);
  // A sibling that merely starts with the same letters is not inside src/.
  assert.equal(relativeToSourceDir('sources/a.mjs', 'src'), null);
});

test('readLineCoverage weights each file by its size, not by its percentage', () => {
  // 1/1 in one file and 0/99 in another averages to 50% but is 1% by lines.
  const lcov = writeTemp('cov.info', 'SF:src/a.mjs\nLF:1\nLH:1\nSF:src/b.mjs\nLF:99\nLH:0\n');
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
    writeFileSync(full, 'export const x = 1;\n');
  }
  // lcov spells each SF: with the same base the guard is handed, exactly as the
  // real report does - Node writes both relative to the run's working directory.
  const lcov = join(root, 'lcov.info');
  writeFileSync(lcov, measuredFiles.map((f) => `SF:${join(sourceDir, f)}\nLF:1\nLH:1`).join('\n') + '\n');
  return { lcov, sourceDir };
}

test('assertEverySourceFileMeasured passes when every source file was measured', () => {
  const { lcov, sourceDir } = sourceTreeAndReport(
    ['a.mjs', 'nested/b.mjs'],
    ['a.mjs', 'nested/b.mjs'],
  );
  assert.doesNotThrow(() => assertEverySourceFileMeasured(lcov, sourceDir));
});

test('assertEverySourceFileMeasured throws and names the file no test loaded', () => {
  const { lcov, sourceDir } = sourceTreeAndReport(['a.mjs', 'orphan.mjs'], ['a.mjs']);
  assert.throws(() => assertEverySourceFileMeasured(lcov, sourceDir), /orphan\.mjs/);
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
