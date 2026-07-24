#!/usr/bin/env node
'use strict';

/*
 * npm launcher for the flashtrace native binary: resolves the platform
 * package matching this machine (installed through optionalDependencies) and
 * hands the process over to it. No downloads, no install scripts - if the
 * binary is not here, the fix is a reinstall, and this launcher only says so.
 */

const { spawnSync } = require('node:child_process');

const platformPackage = `@flashtrace/${process.platform}-${process.arch}`;
const binaryName = process.platform === 'win32' ? 'flashtrace.exe' : 'flashtrace';

let binary;
try {
  binary = require.resolve(`${platformPackage}/bin/${binaryName}`);
} catch {
  console.error(
    [
      `flashtrace: no prebuilt binary for ${process.platform}-${process.arch}.`,
      '',
      `The package ${platformPackage} should have been installed as an`,
      'optional dependency of flashtrace. If your install ran with',
      '--omit=optional (or --no-optional), reinstall without it. If no such',
      'package exists, this platform has no prebuilt binary; the supported',
      'targets are listed at https://github.com/flashtrace/flashtrace/releases',
    ].join('\n'),
  );
  process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) {
  console.error(`flashtrace: failed to run ${binary}: ${result.error.message}`);
  process.exit(1);
}
// a null status means the binary died on a signal; 1 keeps the failure visible
process.exit(result.status === null ? 1 : result.status);
