/*
 * LLRT wrapper stub for `node:child_process`.
 *
 * LLRT has no execFileSync; worse, a named import of a missing binding makes
 * the whole module graph fail to instantiate, so the unmodified bundle would
 * not even load. This stub always throws, which flashtrace's collectFiles()
 * treats as "git unavailable" and answers with its pure-JS directory walk.
 * Feasibility note for SHIM-GAPS.md, not a perf shim.
 */

export function execFileSync() {
  throw new Error('execFileSync unavailable under LLRT (benchmark stub)');
}

export default { execFileSync };
