/*
 * Benchmark wrapper builds. `src/` is never touched: the input is the shipped
 * artifact `dist/flashtrace.mjs`, re-bundled with runtime shims aliased in.
 *
 *   node benchmark/build.mjs
 *
 * Outputs (git-ignored):
 *   benchmark/out/dist/flashtrace.qjs.mjs   QuickJS-ng variant (full shim set)
 *   benchmark/out/dist/flashtrace.llrt.mjs  LLRT variant (child_process stub only)
 *   benchmark/out/package.json              copied so `--version`'s
 *                                           `new URL('../package.json', import.meta.url)` resolves
 */

import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const outDir = join(here, 'out', 'dist');
mkdirSync(outDir, { recursive: true });

const bundle = join(repo, 'dist', 'flashtrace.mjs');
const qjsOut = join(outDir, 'flashtrace.qjs.mjs');

await build({
  entryPoints: [bundle],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  outfile: qjsOut,
  alias: {
    'node:fs': join(here, 'shims', 'node-fs.mjs'),
    'node:path': join(here, 'shims', 'node-path.mjs'),
    'node:process': join(here, 'shims', 'node-process.mjs'),
    'node:url': join(here, 'shims', 'node-url.mjs'),
    'node:child_process': join(here, 'shims', 'node-child_process.mjs'),
  },
  inject: [join(here, 'shims', 'globals.mjs')],
  external: ['qjs:os', 'qjs:std'],
  define: {
    // standalone executables lose import.meta.url; bake in the bundle location
    __QJS_VIRTUAL_BASE__: JSON.stringify(pathToFileURL(qjsOut).href),
  },
  logLevel: 'info',
});

await build({
  entryPoints: [bundle],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  outfile: join(outDir, 'flashtrace.llrt.mjs'),
  alias: {
    'node:child_process': join(here, 'shims', 'llrt-child_process.mjs'),
  },
  logLevel: 'info',
});

copyFileSync(join(repo, 'package.json'), join(here, 'out', 'package.json'));
console.log('wrote', join(here, 'out'));
