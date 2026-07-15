/*
 * Globals injected into the QuickJS-ng build via esbuild `inject`.
 *
 *  - URL: minimal file:-URL class; flashtrace only does
 *    `new URL('../package.json', import.meta.url)` and hands the result to
 *    readFileSync (which reads .href). In standalone mode import.meta.url is
 *    the useless 'file://<evalScript>', so resolution substitutes the
 *    compile-time bundle location (__QJS_VIRTUAL_BASE__, set by build.mjs).
 *  - console.error: missing in qjs 0.15.1 (only console.log exists); patched
 *    to write to stderr. Side effect runs before the bundle because esbuild
 *    places inject files first.
 */

import * as std from 'qjs:std';
import { QJS_STANDALONE_URL } from './node-url.mjs';
import processShim from './node-process.mjs';

// files.mjs reads the bare global `process.platform` (no import); esbuild
// substitutes unbound `process` references with this export
export { processShim as process };

// eslint-disable-next-line no-undef -- replaced at build time by esbuild define
const VIRTUAL_BASE = typeof __QJS_VIRTUAL_BASE__ === 'string' ? __QJS_VIRTUAL_BASE__ : null;

class ShimURL {
  constructor(input, base) {
    if (input.includes('://')) {
      this.href = input;
      return;
    }
    let baseHref = typeof base === 'string' ? base : base?.href;
    if (baseHref === QJS_STANDALONE_URL && VIRTUAL_BASE) baseHref = VIRTUAL_BASE;
    if (!baseHref?.startsWith('file://'))
      throw new Error(`URL shim supports only file: bases, got ${baseHref}`);
    const basePath = baseHref.slice('file://'.length);
    const dir = basePath.slice(0, basePath.lastIndexOf('/'));
    const segs = [];
    for (const s of (dir + '/' + input).split('/')) {
      if (s === '' || s === '.') continue;
      if (s === '..') segs.pop();
      else segs.push(s);
    }
    this.href = 'file:///' + segs.join('/');
  }
  toString() {
    return this.href;
  }
}

if (typeof console.error !== 'function') {
  console.error = (...args) => {
    std.err.puts(args.map((a) => (a instanceof Error ? `${a}\n${a.stack ?? ''}` : String(a))).join(' ') + '\n');
    std.err.flush();
  };
}

export { ShimURL as URL };
