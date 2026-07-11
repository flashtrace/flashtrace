/*
 * Repository state for the HTML report header: a deterministic description
 * of the tree the report was generated from - a release tag or the latest
 * commit, plus a fingerprint of any uncommitted changes. Deterministic for
 * the same working-tree state, so it dates the report without a timestamp.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { findGit } from './files.mjs';

export function repoState(anchorDir) {
  const git = findGit();
  if (!git) return { kind: 'no-git' };
  const run = (args) =>
    execFileSync(git, ['-C', anchorDir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

  let toplevel;
  try {
    toplevel = run(['rev-parse', '--show-toplevel']).trim();
  } catch {
    return { kind: 'none' }; // not inside a git repository
  }

  // git sorts the porcelain entries, and diff output is stable for the same
  // tree state, so the fingerprint is deterministic
  const status = run(['status', '--porcelain', '-z']);
  const state = { repo: path.basename(toplevel), dirty: status.length > 0 };
  if (state.dirty) {
    let diff = '';
    try {
      diff = run(['diff', 'HEAD']);
    } catch {
      // a repository without commits has no HEAD to diff against
    }
    state.fingerprint = createHash('sha256').update(status).update(diff).digest('hex').slice(0, 7);
  }

  try {
    return { kind: 'release', tag: run(['describe', '--exact-match', '--tags', 'HEAD']).trim(), ...state };
  } catch {
    // no tag points exactly at HEAD
  }
  try {
    const [shortSha, subject] = run(['log', '-1', '--format=%h%x00%s']).trim().split('\0');
    return { kind: 'commit', shortSha, subject, ...state };
  } catch {
    return { kind: 'none' }; // a repository without commits has no state to show
  }
}
