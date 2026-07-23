// Preflight for `pnpm run test:coverage`. It refuses to run on a Node that
// cannot scope the measurement, and creates the directory the reporters write
// into - they fail rather than create a missing one themselves.
//
// Usage: node .github/scripts/prepare-coverage.mjs

import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// `--test-coverage-include` landed in v22.5.0. An older Node accepts
// `--experimental-test-coverage` but not the scoping, so it would measure
// dist/ and test/ along with src/ and report a number the badge would then
// misstate. Failing here beats publishing a wrong percentage.
const MINIMUM_NODE = [22, 5, 0];

// Whether the running version, as an array of its numeric components, orders
// before the minimum. Compares component by component, so 22.4.9 loses to
// 22.5.0 on the second one; a longer or shorter running version simply runs
// out of components to differ on.
export function isOlderThan(running, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    if (running[index] !== minimum[index]) return running[index] < minimum[index];
  }
  return false;
}

function main() {
  const running = process.versions.node.split('.').map((part) => Number.parseInt(part, 10));

  if (isOlderThan(running, MINIMUM_NODE)) {
    console.error(
      `test:coverage needs Node ${MINIMUM_NODE.join('.')} or newer, but this is ${process.versions.node}.`,
    );
    console.error('Run `pnpm test` instead - it runs the same suite, only without measuring it.');
    process.exit(1);
  }

  mkdirSync('coverage', { recursive: true });
}

// Run the preflight only when invoked directly, so a test can import
// isOlderThan without creating a directory or reading this Node's version.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
