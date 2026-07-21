// Turns the reports written by `pnpm run test:coverage` into shields.io
// endpoint documents, one per metric. The CI workflow publishes them to the
// `badges` branch, where README.md's Quality Summary reads them from.
//
// Usage: node .github/scripts/quality-badges.mjs <lcov-file> <junit-file> <output-dir>

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA_VERSION = 1;

// Ratings mirror the bands SonarCloud uses for its own coverage badge, so the
// Quality Summary keeps one consistent colour vocabulary across its badges.
const COVERAGE_COLORS = [
  { atLeast: 90, color: 'brightgreen' },
  { atLeast: 80, color: 'green' },
  { atLeast: 70, color: 'yellowgreen' },
  { atLeast: 60, color: 'yellow' },
  { atLeast: 50, color: 'orange' },
  { atLeast: 0, color: 'red' },
];

function coverageColorFor(percent) {
  return COVERAGE_COLORS.find((band) => percent >= band.atLeast).color;
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

const [lcovPath, junitPath, outputDir] = process.argv.slice(2);
if (!lcovPath || !junitPath || !outputDir) {
  console.error('Usage: node .github/scripts/quality-badges.mjs <lcov-file> <junit-file> <output-dir>');
  process.exit(2);
}

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
