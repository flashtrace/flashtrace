# Shim Gaps — Node APIs missing per runtime and how the benchmark covers them

Scope rule: shims are the *minimum* needed to run `dist/flashtrace.mjs` correctly; every
one is a potential perf distortion and is logged here. "Can't run" (feasibility) is kept
separate from "runs slowly" (performance).

## QuickJS-ng v0.15.1 (`qjs`, and standalone binaries via `qjs -c`)

QuickJS-ng provides **no Node compatibility layer at all** — every `node:*` module is
missing and is shimmed on top of its `qjs:os` / `qjs:std` modules
(`shims/node-{fs,path,process,url,child_process}.mjs` + injected `shims/globals.mjs`,
wired by `build.mjs` via esbuild `alias`/`inject`).

| Node API | Gap | Shim coverage | Perf distortion? |
|---|---|---|---|
| `fs.promises.readdir({withFileTypes})` | no async fs; `os.readdir` returns bare names incl. `.`/`..`, no d_type | sync `os.readdir` in an async wrapper; one **extra `os.lstat` per directory entry** to build Node-faithful dirents (lstat semantics: symlinks are reported as symlinks, matching Node) | **Yes, against qjs**: Node gets entry types from the kernel dirent for free; the shim pays one extra syscall per entry. Walk-heavy corpora slightly overstate qjs cost. |
| `fs.promises.stat`, `fs.promises.readFile` | no async fs | sync `os.stat` / `std.loadFile` in async wrappers | Negligible: flashtrace awaits sequentially (`for … await`), so Node gains no I/O overlap either. |
| `fs.readFileSync(URL, 'utf8')` | `std.loadFile` only takes paths; no URL support | shim accepts `{href}` objects and converts via `fileURLToPath` | No. UTF-8 decoding is delegated to `std.loadFile`; corpora are valid UTF-8 (invalid-byte handling may differ from Node — not exercised). |
| `fs.realpathSync`, `fs.existsSync` | missing | `os.realpath`, `os.stat` | No. |
| `path.{extname,join,resolve,relative}` | missing | pure-JS POSIX reimplementation, verified against real `node:path` by `shims/selftest.mjs` | Runs on the measured engine — i.e. it *adds* JS work that Node does in C++. Small (a few calls per file), but favors Node. |
| `process` (module **and** unbound global) | missing | synthesized from `scriptArgs`, `os.getcwd`, `std.getenviron`, `std.exit`, `os.isatty` | No. |
| `process.argv` self-detection (`runAsCli()`) | interpreter: `scriptArgs[0]` = script path; standalone: `scriptArgs` = user args only and `import.meta.url` = `file://<evalScript>` | argv[1] is synthesized as `fileURLToPath(import.meta.url)` — the shim is bundled *into* the artifact, so this matches what `runAsCli()` compares against, **deliberately forcing CLI-mode detection to succeed**; `pathToFileURL` round-trips the `<evalScript>` sentinel for the standalone fallback path | Behavioral shim, not perf. Without it the standalone binary would silently do nothing (feasibility gap, now closed). A shipping binary should detect CLI-mode explicitly instead. |
| `new URL('../package.json', import.meta.url)` (`--version`) | no `URL` global | minimal file:-URL class injected; in standalone mode the useless `file://<evalScript>` base is substituted with the compile-time bundle location (`__QJS_VIRTUAL_BASE__` esbuild define) | No. **Feasibility note**: the standalone binary still reads `package.json` from the build tree at runtime — a real shipped binary must embed the version string (small `src/` change, out of spike scope). |
| `console.error` | **missing** in qjs 0.15.1 (only `console.log` exists) | patched onto `console` from the injected globals module (writes to stderr via `std.err`) | No (error path only). |
| `child_process.execFileSync` | missing entirely | implemented with `os.pipe` + non-blocking `os.exec` + drain-then-`waitpid` (blocking exec would deadlock beyond the 64 KiB pipe buffer) | Not on the timed path (corpora are non-git → walk fallback everywhere). Verified byte-identical on flashtrace's real git work tree. |
| Regex features | none needed: bundle uses no lookbehind / named groups / `\p{}` / `d` flag | n/a — correctness gated by byte-diff anyway | ES-compliance risk retired by byte-identical output on all corpora. |

Overall shim-distortion direction: every distortion listed above makes **qjs look worse,
not better** (extra lstat per dirent, JS path functions vs Node's native ones). A PASS
under these shims is therefore conservative.

## LLRT (latest release) — **not executed in this environment**

LLRT is distributed exclusively as GitHub release assets; this sandbox's network policy
blocks github.com downloads (npm/crates/pypi mirrors carry no official LLRT CLI), so the
column is pending. What is already known from the API inventory and prepared:

| Node API | Expected gap | Coverage |
|---|---|---|
| `child_process.execFileSync` | LLRT implements `spawn` but not the sync exec family. Because the bundle does a *named* import, a missing export fails module instantiation — the unmodified bundle likely won't even load (**feasibility gap**). | `out/dist/flashtrace.llrt.mjs` build aliases `node:child_process` to a stub whose `execFileSync` throws → flashtrace's documented walk fallback. |
| `fs`/`fs/promises`, `path`, `process`, `url` | expected present (LLRT ships a Node-compat layer); `readdir({withFileTypes})`, `realpathSync`, `pathToFileURL` need verification | run `benchmark/tools/get-llrt.sh`, then `LLRT=… benchmark/run.sh`; the correctness gate will catch any semantic gap before timing. |

## Node.js v22 (baseline)

No gaps; runs `dist/flashtrace.mjs` unmodified. The qjs/llrt variants are re-bundles of
that same artifact — byte-diffed outputs (see `results/correctness.txt`) are the proof
that the shims didn't change behavior.
