# Runtime Benchmark Spike — Plan

## Question

Is `dist/flashtrace.mjs` running under a JIT-less engine (LLRT, QuickJS-ng) fast enough in
**absolute wall-clock** terms to ship as our self-contained binary — or does the binary
channel need a Rust rewrite?

Node/V8 is the baseline, not a competitor: the npm channel keeps Node regardless.

## Artifact under test

`dist/flashtrace.mjs` (esbuild ESM bundle, `pnpm build`, 32 KB). `src/` is never modified;
shims live in a separate esbuild wrapper config under `benchmark/` (`build.mjs`) that
re-bundles the dist artifact with `alias`/`inject`.

### Measured runtime API surface of the bundle

Inventoried by grepping `dist/flashtrace.mjs` for `node:` imports and unbound globals:

| Module | APIs used |
|---|---|
| `node:fs` | `realpathSync`, `readFileSync`, `existsSync`, `promises.readdir({withFileTypes})`, `promises.stat`, `promises.readFile(f,'utf8')` |
| `node:path` | `extname`, `join`, `resolve`, `relative` |
| `node:process` | `argv`, `cwd()`, `exit()`, `env.NO_COLOR`, `stdout.isTTY`, `platform` (also referenced as *unbound global* `process` in the file-collection code) |
| `node:url` | `fileURLToPath`, `pathToFileURL` |
| `node:child_process` | `execFileSync` (git ls-files; any throw falls back to a pure-JS directory walk) |
| globals | `console.log`, `console.error`, `URL` (only `new URL('../package.json', import.meta.url)`), `import.meta.url`, `JSON`, `RegExp` |

Regex construction uses `new RegExp` with alternation, capture groups, `matchAll`, sticky
`lastIndex` use — but **no** lookbehind, named groups, unicode property escapes, or `d`
flag. QuickJS-ng regex-feature risk is therefore low; correctness is still gated by
byte-diffing outputs (below).

Feasibility landmines found in the inventory (all handled by shims, see SHIM-GAPS.md):

1. `--version` reads `../package.json` relative to `import.meta.url` — a self-contained
   binary has no meaningful `import.meta.url` (QuickJS-ng standalone reports
   `file://<evalScript>`).
2. `runAsCli()` compares `realpathSync(argv[1])` with `fileURLToPath(import.meta.url)` —
   the CLI does not even start unless the runtime's argv semantics cooperate.
3. `import { execFileSync } from 'node:child_process'` is a *named* ESM import: a runtime
   whose `child_process` lacks that export fails module instantiation outright (LLRT).

## Matrix

### Runtimes (pinned in RESULTS.md / results/environment.txt)

| Runtime | How obtained | Status |
|---|---|---|
| Node.js v22 LTS (baseline) | preinstalled | measured |
| QuickJS-ng v0.15.1 `qjs` (interpreter) | `tools/build-quickjs.sh` (pinned tag, source build) | measured |
| QuickJS-ng v0.15.1 standalone binary | `qjs -c bundle -o bin` (ng's successor to classic `qjsc` executables; `qjsc` itself now emits C) — compile step timed as its own cell | measured |
| LLRT (latest release) | `tools/get-llrt.sh` | **pending** — LLRT ships only as GitHub release assets and this sandbox's network policy blocks github.com downloads; harness is LLRT-ready (`out/dist/flashtrace.llrt.mjs` + stub shim), run from CI/workstation |

### Corpora (`corpus/make-corpora.sh`, pins in `$CORPUS_ROOT/PINS.txt`)

| Corpus | Contents | Size |
|---|---|---|
| S | flashtrace's own working tree (`src/ docs/ test/` + top-level .md), pinned by repo HEAD SHA | ~30 files |
| M | synthetic polyglot tree, `gen-corpus.mjs --files 3000 --seed 1002` | 3k files |
| L | synthetic polyglot tree, `gen-corpus.mjs --files 60000 --seed 1003` | 60k files — the case that can fail the gate |

Deviation from the original plan: M and L were meant to be pinned clones of real
repositories. The spike environment cannot clone external GitHub repos, so
`corpus/gen-corpus.mjs` generates deterministic (seeded-PRNG, byte-reproducible)
polyglot trees instead — 19 languages across the comment-grammar families flashtrace
supports, seeded with real matching work: markdown specs defining `req:` items whose
`Needs:` reference `impl:`/`utest:` IDs, code files carrying item/need tags, near-miss
bracket noise the tag regex must scan and reject, plus a fixed 25 deliberately uncovered
needs so every corpus yields a small, stable defect report. When GitHub access is
available, re-running the matrix on a real mid-size repo and a real monorepo (pinned by
SHA, seeded by the same script) is a cheap follow-up; the synthetic trees are, if
anything, *harder* on the scanner (high tag/comment density).

Corpora are **not** git repositories and live outside any git work tree, so every runtime
takes the identical pure-JS directory-walk path in `collectFiles()` (the `git ls-files`
fast path shells out to git, whose cost is runtime-independent; the walk is the honest
worst case for engine comparison). The `execFileSync` git path is still validated for
feasibility: the qjs shim implements it and produces byte-identical output on the real
flashtrace git work tree.

## Metrics per (runtime × corpus) — `run.sh`

- **Startup probe**: `flashtrace --version` wall time (hyperfine, corpus-independent).
- **Full run**: wall time, warm FS cache (`--warmup 2`) and cold (`--prepare 'sync; echo 3
  > /proc/sys/vm/drop_caches'`) reported separately; p50/p95 over ≥ 10 runs
  (`RUNS` env, default 10). Raw per-run times exported to `results/raw-times.csv`.
- **Compile step** for the standalone binary: timed as its own hyperfine cell.
- **Peak RSS**: `tools/peakrss.py` (getrusage of children), one run per cell.
- **Artifact size**: bytes on disk for every artifact incl. the runtime itself
  (`results/rss-size.csv`).
- **Correctness gate before any timing**: stdout byte-diff + exit-code match vs the Node
  baseline per corpus (`results/correctness.txt`). A mismatching runtime is disqualified
  from timing — a fast wrong answer disqualifies the runtime. Additionally
  `shims/selftest.mjs` diffs the pure-JS path/url shims against real Node implementations.

Timing tool: hyperfine 1.20.0; `-i` because flashtrace exits 1 when it (intentionally)
finds defects.

## Environment

Linux x64 first (CI-representative); results below are from the spike container (see
`results/environment.txt` for exact CPU/kernel). macOS arm64: if time permits, not done.
Windows: untested for LLRT — flagged as follow-up, not a spike blocker.

## Decision gate (provisional — needs human sign-off)

- Record the Node baseline for corpus L.
- **PASS** for a binary-channel runtime iff corpus-L p95 ≤ **2 s absolute** AND ≤ **10×
  Node**. Thresholds are provisional; surface them for sign-off before acting on the
  verdict.
- Verdict format: PASS → recommend the QuickJS-ng route; FAIL → recommend the Rust
  rewrite for the binary channel. State which runtime, which numbers, largest caveat.

## Reproduce

```sh
pnpm install && pnpm build
benchmark/tools/build-quickjs.sh          # pinned QuickJS-ng v0.15.1
cargo install hyperfine                   # or any hyperfine >= 1.16
benchmark/corpus/make-corpora.sh          # S/M/L under /tmp/flashtrace-bench-corpora
benchmark/tools/get-llrt.sh               # optional (needs GitHub access)
node benchmark/shims/selftest.mjs         # shim sanity
[LLRT=benchmark/out/llrt/llrt] benchmark/run.sh
```

One command per matrix cell is preserved inside `run.sh` (hyperfine command names are
`corpus|phase|runtime`); every cell can be re-run in isolation by copying the printed
command line.

## Out of scope

Maven/Gradle/NuGet packaging; Windows CI; optimizing flashtrace itself; the Rust port.
