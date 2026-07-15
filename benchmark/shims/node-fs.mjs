/*
 * Minimal `node:fs` shim for QuickJS-ng, backed by qjs:os / qjs:std.
 *
 * Only what the flashtrace bundle touches:
 *   realpathSync, readFileSync, existsSync,
 *   promises.readdir({withFileTypes}), promises.stat, promises.readFile
 *
 * Known distortions (see SHIM-GAPS.md):
 *  - promises.* are synchronous calls wrapped in async functions; flashtrace
 *    awaits them sequentially anyway, so behavior is equivalent.
 *  - readdir({withFileTypes}) needs one extra lstat() per directory entry:
 *    qjs:os exposes no d_type. Node gets the type for free from the kernel.
 *  - text decoding relies on std.loadFile's UTF-8 handling.
 */

import * as os from 'qjs:os';
import * as std from 'qjs:std';
import { fileURLToPath } from './node-url.mjs';
import { join } from './node-path.mjs';

// fs functions accept file URLs (flashtrace passes a URL for package.json)
function toPath(p) {
  if (typeof p === 'string') return p;
  if (p && typeof p.href === 'string') return fileURLToPath(p.href);
  throw new TypeError(`unsupported path argument: ${p}`);
}

function fsError(syscall, path, errno) {
  const e = new Error(`${syscall} failed on ${path} (errno ${errno})`);
  e.code = errno === os.ENOENT ? 'ENOENT' : `E${errno}`;
  e.errno = -errno;
  e.path = path;
  return e;
}

export function realpathSync(p) {
  p = toPath(p);
  const [str, err] = os.realpath(p);
  if (err !== 0) throw fsError('realpath', p, err);
  return str;
}

export function readFileSync(p, encoding) {
  p = toPath(p);
  if (encoding !== 'utf8' && encoding !== 'utf-8')
    throw new Error(`shim readFileSync supports only utf8, got ${encoding}`);
  const text = std.loadFile(p);
  if (text === null) throw fsError('open', p, os.ENOENT ?? 2);
  return text;
}

export function existsSync(p) {
  const [, err] = os.stat(toPath(p));
  return err === 0;
}

const S_IFMT = os.S_IFMT;
const S_IFDIR = os.S_IFDIR;
const S_IFREG = os.S_IFREG;

function statsOf(mode) {
  return {
    isFile: () => (mode & S_IFMT) === S_IFREG,
    isDirectory: () => (mode & S_IFMT) === S_IFDIR,
    isSymbolicLink: () => (mode & S_IFMT) === os.S_IFLNK,
  };
}

// Node dirents are built from d_type (lstat semantics): a symlink is reported
// as a symlink, never as the file/dir it points to. Match that with lstat.
function dirent(dir, name) {
  const [st, err] = os.lstat(join(dir, name));
  const mode = err === 0 ? st.mode : 0;
  return { name, parentPath: dir, ...statsOf(mode) };
}

export const promises = {
  async readdir(dir, opts) {
    dir = toPath(dir);
    const [names, err] = os.readdir(dir);
    if (err !== 0) throw fsError('readdir', dir, err);
    const plain = names.filter((n) => n !== '.' && n !== '..');
    if (!opts || !opts.withFileTypes) return plain;
    return plain.map((n) => dirent(dir, n));
  },

  async stat(p) {
    p = toPath(p);
    const [st, err] = os.stat(p);
    if (err !== 0) throw fsError('stat', p, err);
    return statsOf(st.mode);
  },

  async readFile(p, encoding) {
    return readFileSync(p, encoding);
  },
};

export default { realpathSync, readFileSync, existsSync, promises };
