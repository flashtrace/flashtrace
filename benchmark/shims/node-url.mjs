/*
 * Minimal `node:url` shim for QuickJS-ng: fileURLToPath / pathToFileURL.
 *
 * Only file: URLs on POSIX are supported. The special base
 * `file://<evalScript>` is what QuickJS-ng standalone executables report as
 * import.meta.url; pathToFileURL round-trips it so the bundle's
 * runAsCli() self-detection (`import.meta.url === pathToFileURL(argv[1]).href`)
 * holds in standalone mode. See SHIM-GAPS.md.
 */

import { resolve } from './node-path.mjs';

// QuickJS-ng standalone executables report this as import.meta.url.
export const QJS_STANDALONE_URL = 'file://<evalScript>';
export const QJS_STANDALONE_PATH = '<evalScript>';

// keep in sync with what pathToFileURL must escape; only chars that are
// special in URLs and legal in POSIX paths
function encodePath(p) {
  return p.replace(/%/g, '%25').replace(/\?/g, '%3F').replace(/#/g, '%23').replace(/\n/g, '%0A');
}

export function fileURLToPath(url) {
  const href = typeof url === 'string' ? url : url.href;
  if (href === QJS_STANDALONE_URL) return QJS_STANDALONE_PATH;
  if (!href.startsWith('file://')) throw new Error(`fileURLToPath: not a file URL: ${href}`);
  return decodeURIComponent(href.slice('file://'.length));
}

export function pathToFileURL(path) {
  if (path === QJS_STANDALONE_PATH) return { href: QJS_STANDALONE_URL };
  return { href: 'file://' + encodePath(resolve(path)) };
}

export default { fileURLToPath, pathToFileURL };
