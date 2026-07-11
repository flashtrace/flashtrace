/**
 * flashtrace - entry point for Single Executable Application (SEA) builds.
 *
 * Bundled by scripts/build-sea.mjs to CommonJS (dist-sea/flashtrace.cjs), the
 * only format Node SEA accepts. It calls runCli() directly instead of going
 * through src/main.mjs: the argv/realpath CLI detection there is meaningless
 * inside a binary and its import.meta.url does not exist under CommonJS.
 *
 * FLASHTRACE_VERSION is replaced at bundle time (esbuild define). A binary
 * carries no package.json to read the version from, and SEA builds always run
 * after the release version bump, so the baked value is exact.
 */

import { runCli } from './cli.mjs';

runCli({ version: () => FLASHTRACE_VERSION });
