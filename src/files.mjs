/*
 * File collection (gitignore-aware): files ignored by git are excluded via
 * `git ls-files`; plain directory walk as fallback outside a git repository.
 */

import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { UsageError } from './errors.mjs';

export const MD_EXT = new Set(['.md', '.markdown']);
export const CODE_EXT = new Set(['.ts', '.js', '.mjs', '.sql', '.vue']);

// git is looked up in fixed, non-user-writable install locations only, never
// via PATH (writable PATH entries would allow binary planting).
const GIT_LOCATIONS = process.platform === 'win32'
  ? [
      String.raw`C:\Program Files\Git\cmd\git.exe`,
      String.raw`C:\Program Files (x86)\Git\cmd\git.exe`,
    ]
  : ['/usr/bin/git', '/bin/git'];

let gitBin; // undefined = not probed yet, null = not found

export function findGit() {
  if (gitBin === undefined) {
    gitBin = GIT_LOCATIONS.find((p) => existsSync(p)) ?? null;
  }
  return gitBin;
}

async function walk(dir, out) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

export async function collectFiles(dirs) {
  const files = new Set();
  for (const dir of dirs) {
    const abs = path.resolve(dir);
    const st = await fs.stat(abs).catch(() => null);
    if (!st) throw new UsageError(`input path does not exist: ${dir}`);
    if (st.isFile()) {
      files.add(abs);
      continue;
    }
    let list = null;
    const git = findGit();
    try {
      if (!git) throw new Error('git not found');
      const out = execFileSync(
        git,
        ['-C', abs, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
      list = out.split('\0').filter(Boolean).map((f) => path.join(abs, f));
    } catch {
      list = await walk(abs, []); // not a git repo (or git missing)
    }
    for (const f of list) files.add(f);
  }
  return [...files]
    .filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return MD_EXT.has(ext) || CODE_EXT.has(ext);
    })
    .sort();
}
