/*
 * Minimal `node:process` shim for QuickJS-ng.
 *
 * argv is synthesized Node-style: [execPath, scriptPath, ...userArgs].
 *  - interpreter mode: scriptArgs = [scriptPath, ...userArgs]
 *  - standalone mode (qjs -c):  scriptArgs = [...userArgs] and
 *    import.meta.url === 'file://<evalScript>'
 * argv[1] is always fileURLToPath(import.meta.url) — since the shim is bundled
 * INTO the flashtrace bundle, this import.meta.url is identical to the one the
 * bundle's runAsCli() sees, which deliberately forces CLI-mode detection to
 * succeed in both modes. Logged as a shim distortion in SHIM-GAPS.md.
 */

import * as os from 'qjs:os';
import * as std from 'qjs:std';
import { fileURLToPath, QJS_STANDALONE_URL } from './node-url.mjs';
import { __setCwd } from './node-path.mjs';

const STANDALONE = import.meta.url === QJS_STANDALONE_URL;
const userArgs = STANDALONE ? scriptArgs.slice() : scriptArgs.slice(1);

function cwd() {
  const [dir, err] = os.getcwd();
  if (err !== 0) throw new Error(`getcwd failed (errno ${err})`);
  return dir;
}
__setCwd(cwd);

const process = {
  argv: ['qjs', fileURLToPath(import.meta.url), ...userArgs],
  platform: os.platform,
  env: std.getenviron(),
  cwd,
  exit: (code) => std.exit(code ?? 0),
  stdout: { isTTY: !!os.isatty(1) },
  stderr: { isTTY: !!os.isatty(2) },
};

export default process;
