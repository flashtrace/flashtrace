// Turns the reports written by `pnpm run test:coverage` into shields.io
// endpoint documents, one per metric. The CI workflow publishes them to the
// `badges` branch, where README.md's Quality Summary reads them from.
//
// Usage: node .github/scripts/quality-badges.mjs <lcov-file> <junit-file> <source-dir> <output-dir>

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA_VERSION = 1;

// Ratings mirror the bands SonarCloud uses for its own coverage badge, so the
// Quality Summary keeps one consistent colour vocabulary across its badges.
// Anything below the last band is red.
const COVERAGE_COLORS = [
  { atLeast: 90, color: 'brightgreen' },
  { atLeast: 80, color: 'green' },
  { atLeast: 70, color: 'yellowgreen' },
  { atLeast: 60, color: 'yellow' },
  { atLeast: 50, color: 'orange' },
];

function coverageColorFor(percent) {
  return COVERAGE_COLORS.find((band) => percent >= band.atLeast)?.color ?? 'red';
}

// lcov spells paths the way Node saw them - relative to the working directory,
// on Windows with backslashes. Comparing them to a directory listing needs one
// spelling.
function toPosixPath(value) {
  return value.replaceAll('\\', '/');
}

// The path a record carries, restated relative to the source directory, or
// null for a record from outside it.
function relativeToSourceDir(path, sourceDir) {
  const prefix = `${toPosixPath(sourceDir)}/`;
  if (path.startsWith(prefix)) return path.slice(prefix.length);

  const nested = path.lastIndexOf(`/${prefix}`);
  return nested === -1 ? null : path.slice(nested + prefix.length + 1);
}

// lcov records one `LF:` (lines found) and one `LH:` (lines hit) per source
// file. Line coverage for the project is the ratio of the summed pair, which
// weights each file by its size instead of averaging percentages.
function readLineCoverage(lcovPath) {
  const lcov = readFileSync(lcovPath, 'utf8');
  let linesFound = 0;
  let linesHit = 0;

  for (const line of lcov.split(/\r?\n/)) {
    if (line.startsWith('LF:')) linesFound += Number(line.slice(3));
    else if (line.startsWith('LH:')) linesHit += Number(line.slice(3));
  }

  if (linesFound === 0) {
    throw new Error(`No line-coverage records found in ${lcovPath}.`);
  }
  return (linesHit / linesFound) * 100;
}

// V8 instruments only the modules a test actually loaded, and no flag widens
// that - `--test-coverage-include` filters what was loaded, it does not pull in
// what was not. A source file that no test reaches therefore leaves no record
// at all: it drops out of the ratio entirely and raises the percentage instead
// of lowering it. Holding the report against the directory listing turns that
// blind spot into a failed run.
function assertEverySourceFileMeasured(lcovPath, sourceDir) {
  const measured = new Set();

  for (const line of readFileSync(lcovPath, 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('SF:')) continue;
    const relative = relativeToSourceDir(toPosixPath(line.slice(3)), sourceDir);
    if (relative !== null) measured.add(relative);
  }

  const unmeasured = readdirSync(sourceDir, { recursive: true })
    .map(toPosixPath)
    .filter((entry) => entry.endsWith('.mjs'))
    .filter((entry) => !measured.has(entry));

  if (unmeasured.length > 0) {
    throw new Error(
      `No coverage was measured for ${unmeasured.join(', ')}. `
      + `Every file under ${sourceDir}/ has to be reachable from the test suite, `
      + 'or the coverage badge overstates the project.',
    );
  }
}

// The JUnit reporter emits one <testcase> element per test, subtests included.
function countTestCases(junitPath) {
  const junit = readFileSync(junitPath, 'utf8');
  const count = junit.match(/<testcase\b/g)?.length ?? 0;

  if (count === 0) {
    throw new Error(`No test cases found in ${junitPath}.`);
  }
  return count;
}

function writeBadge(outputDir, name, badge) {
  const file = join(outputDir, `${name}.json`);
  writeFileSync(file, `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...badge }, null, 2)}\n`);
  return file;
}

const [lcovPath, junitPath, sourceDir, outputDir] = process.argv.slice(2);
if (!lcovPath || !junitPath || !sourceDir || !outputDir) {
  console.error(
    'Usage: node .github/scripts/quality-badges.mjs <lcov-file> <junit-file> <source-dir> <output-dir>',
  );
  process.exit(2);
}

assertEverySourceFileMeasured(lcovPath, sourceDir);

const coverage = readLineCoverage(lcovPath);
const testCount = countTestCases(junitPath);

mkdirSync(outputDir, { recursive: true });

writeBadge(outputDir, 'coverage', {
  label: 'coverage',
  message: `${coverage.toFixed(1)}%`,
  color: coverageColorFor(coverage),
});

writeBadge(outputDir, 'tests', {
  label: 'tests',
  message: String(testCount),
  color: 'blue',
});

console.log(`coverage ${coverage.toFixed(1)}%, ${testCount} tests -> ${outputDir}`);
