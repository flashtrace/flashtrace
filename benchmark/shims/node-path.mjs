/*
 * Minimal POSIX `node:path` shim for QuickJS-ng.
 *
 * Only the functions the flashtrace bundle actually calls are implemented:
 * extname, join, resolve, relative (plus normalize as their shared helper).
 * Semantics are modeled on Node's posix implementation; benchmark/shims/selftest
 * compares this module against real `node:path` under Node.
 *
 * Pure JS on purpose — no qjs:* imports — so it is directly testable under Node.
 */

// cwd is injected by the node-process shim (or by the Node selftest) so this
// module stays free of qjs:* imports and free of import cycles.
let cwdFn = () => '/';
export function __setCwd(fn) {
  cwdFn = fn;
}

function normalizeSegments(parts, allowAboveRoot) {
  const out = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (allowAboveRoot) out.push('..');
    } else {
      out.push(p);
    }
  }
  return out;
}

export function normalize(path) {
  if (path.length === 0) return '.';
  const isAbs = path.startsWith('/');
  const trailingSlash = path.endsWith('/');
  const segs = normalizeSegments(path.split('/'), !isAbs);
  let res = segs.join('/');
  if (res.length === 0 && !isAbs) res = '.';
  if (res.length > 0 && trailingSlash) res += '/';
  return isAbs ? '/' + res : res;
}

export function join(...args) {
  const parts = args.filter((a) => a.length > 0);
  if (parts.length === 0) return '.';
  return normalize(parts.join('/'));
}

export function resolve(...args) {
  let resolved = '';
  let isAbs = false;
  for (let i = args.length - 1; i >= -1 && !isAbs; i--) {
    const path = i >= 0 ? args[i] : cwdFn();
    if (path.length === 0) continue;
    resolved = resolved.length === 0 ? path : path + '/' + resolved;
    isAbs = path.startsWith('/');
  }
  const segs = normalizeSegments(resolved.split('/'), !isAbs);
  const res = segs.join('/');
  if (isAbs) return '/' + res;
  return res.length > 0 ? res : '.';
}

export function relative(from, to) {
  if (from === to) return '';
  const f = resolve(from);
  const t = resolve(to);
  if (f === t) return '';
  const fp = f.split('/').filter(Boolean);
  const tp = t.split('/').filter(Boolean);
  let i = 0;
  while (i < fp.length && i < tp.length && fp[i] === tp[i]) i++;
  const up = fp.slice(i).map(() => '..');
  return [...up, ...tp.slice(i)].join('/');
}

export function extname(path) {
  const slash = path.lastIndexOf('/');
  const base = slash === -1 ? path : path.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  // Node: no dot, or the dot is the first character of the basename -> ''
  if (dot <= 0) return '';
  return base.slice(dot);
}

export function basename(path) {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

export function dirname(path) {
  const slash = path.lastIndexOf('/');
  if (slash === -1) return '.';
  if (slash === 0) return '/';
  return path.slice(0, slash);
}

export const sep = '/';

export default { normalize, join, resolve, relative, extname, basename, dirname, sep };
