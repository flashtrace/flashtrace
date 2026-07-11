import { readFileSync } from 'node:fs';

// The version lives only in package.json: the release workflow bumps it there
// after dist/ is built, so it must be read at runtime rather than baked into
// the bundle (which would also let esbuild inline it). Both src/version.mjs
// and dist/flashtrace.mjs sit one level below the package root.
//
// This module must stay out of src/cli.mjs: SEA binaries carry no package.json
// (and no import.meta.url), so src/sea-entry.mjs passes runCli() a baked-in
// version instead of this reader.
export function packageVersion() {
  const pkg = new URL('../package.json', import.meta.url);
  return JSON.parse(readFileSync(pkg, 'utf8')).version;
}
