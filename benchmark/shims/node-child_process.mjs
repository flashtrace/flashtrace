/*
 * Minimal `node:child_process` shim for QuickJS-ng: execFileSync only, and only
 * the shape flashtrace uses:
 *   execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] })
 *
 * Implemented with os.pipe + blocking os.exec. On any failure it throws, which
 * flashtrace treats as "not a git repo / git missing" and falls back to its own
 * directory walk — so this shim is a feasibility aid, not a hot path.
 *
 * Set FLASHTRACE_BENCH_NO_EXEC=1 to force the throw (and thus the walk
 * fallback) without touching the corpus; the benchmark uses corpora outside any
 * git work tree, where every runtime takes the walk path anyway.
 */

import * as os from 'qjs:os';
import * as std from 'qjs:std';

export function execFileSync(file, args = [], options = {}) {
  if (std.getenv('FLASHTRACE_BENCH_NO_EXEC')) throw new Error('exec disabled for benchmark');
  // spawn non-blocking and drain the pipe BEFORE waiting: a blocking exec
  // would deadlock as soon as the child's output exceeds the pipe buffer
  const [rfd, wfd] = os.pipe();
  const devnull = os.open('/dev/null', os.O_RDWR);
  let pid;
  try {
    pid = os.exec([file, ...args], {
      block: false,
      usePath: false,
      stdin: devnull, // flashtrace passes stdio ['ignore','pipe','ignore']
      stdout: wfd,
      stderr: devnull,
    });
  } finally {
    os.close(wfd);
    if (devnull >= 0) os.close(devnull);
  }
  if (pid < 0) {
    os.close(rfd);
    throw new Error(`failed to spawn ${file} (errno ${-pid})`);
  }
  let out = '';
  const f = std.fdopen(rfd, 'r');
  try {
    out = f.readAsString();
  } finally {
    f.close();
  }
  const [, wstatus] = os.waitpid(pid, 0);
  const status = (wstatus & 0x7f) === 0 ? (wstatus >> 8) & 0xff : null;
  if (status !== 0) {
    const e = new Error(`${file} exited with status ${status}`);
    e.status = status;
    throw e;
  }
  return out;
}

export default { execFileSync };
