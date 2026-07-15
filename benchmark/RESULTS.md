# Runtime Benchmark Spike — Results

Measured 2026-07-15 on the spike container (Linux 6.18.5 x86_64, Intel Xeon @ 2.80 GHz,
4 cores, 15 GiB RAM). Raw per-run data: `results/raw-times.csv`; aggregates:
`results/summary.csv`; full pins: `results/environment.txt`.

## Pinned versions

| Component | Version |
|---|---|
| Node.js (baseline) | v22.22.2 (LTS) |
| QuickJS-ng | v0.15.1, source build (`tools/build-quickjs.sh`), gcc 13.3.0 `-DCMAKE_BUILD_TYPE=Release` |
| QuickJS-ng standalone | `qjs -c` self-contained executable of the shimmed bundle |
| LLRT | **not measured** — distributed only via GitHub release assets, blocked by this sandbox's network policy (see SHIM-GAPS.md); harness is ready (`LLRT=… run.sh`) |
| hyperfine | 1.20.0 |
| esbuild (wrapper build) | 0.28.1 |
| flashtrace | v0.7.2, `dist/flashtrace.mjs` from commit `cf9cdfe` (S-corpus content = `src/ docs/ test/` + top-level .md at that commit) |
| Corpora | S: 26 files / 200 KB · M: 3 000 files / 23 MB (seed 1002) · L: 60 000 files / 447 MB (seed 1003) |

Run counts: 10 per cell (S, M, startup, compile); **3 per cell on L** (deviation from the
≥10-run protocol: one JIT-less L run costs ~5 min; the workload is CPU-bound and
deterministic — observed L spread is < 1 % across runs, see raw CSV — rerun with
`RUNS_L=10` in CI for the record).

## Correctness gate (prerequisite for timing)

Output **byte-identical** to Node and exit codes equal for every (runtime × corpus) cell
— including the standalone binary and, separately, the `git ls-files` path on a real git
work tree. `results/correctness.txt`. No runtime was disqualified. The regex-feature risk
flagged in the plan (lookbehind/named groups/`d` flag) did not materialize: the bundle
uses none of them, and matching results are identical.

## Startup probe (`flashtrace --version`)

| runtime | p50 | p95 | vs node |
|---|---|---|---|
| node | 69.8 ms | 80.1 ms | 1× |
| qjs | 5.2 ms | 5.9 ms | **13× faster** |
| qjs standalone | 2.5 ms | 2.7 ms | **28× faster** |

Compile step for the standalone binary (`qjs -c`): 8.5 ms p50 — negligible; it can run in
every release build.

## Full runs — wall clock, p50/p95

### Corpus S (26 files)

| runtime | warm p50 | warm p95 | cold p50 | cold p95 |
|---|---|---|---|---|
| node | 114.8 ms | 123.5 ms | 245.6 ms | 280.9 ms |
| qjs | 170.0 ms | 175.3 ms | 201.6 ms | 246.3 ms |
| qjs standalone | 167.5 ms | 190.5 ms | **186.0 ms** | 202.2 ms |

QuickJS-ng *wins* cold runs at this size — engine startup outweighs its per-file deficit
below roughly a dozen files (warm) / any small repo (cold).

### Corpus M (3 000 files)

| runtime | warm p50 | warm p95 | cold p50 | cold p95 |
|---|---|---|---|---|
| node | 2.32 s | 2.44 s | 2.87 s | 3.24 s |
| qjs | 13.90 s | 14.41 s | 14.91 s | 15.20 s |
| qjs standalone | 14.01 s | 14.59 s | 14.73 s | 15.69 s |

### Corpus L (60 000 files) — the gate corpus

| runtime | warm p50 | warm p95 | cold p50 | cold p95 | warm p95 vs node |
|---|---|---|---|---|---|
| **node (baseline)** | 40.47 s | 40.96 s | 53.09 s | 53.89 s | 1× |
| qjs | 286.08 s | 286.23 s | 298.34 s | 298.69 s | 6.99× |
| qjs standalone | 279.54 s | 280.78 s | 300.54 s | 305.12 s | 6.86× |

The workload is CPU-bound on every runtime (user ≈ wall, sys ≪ 1); the cold-cache
penalty is the same ~12 s of I/O for everyone. Bytecode precompilation (standalone) buys
nothing at scale — parsing the 33 KB bundle was never the cost.

## Peak RSS and artifact size

| corpus | node | qjs | qjs standalone |
|---|---|---|---|
| S | 60.2 MiB | 10.0 MiB | 9.9 MiB |
| M | 67.5 MiB | 9.9 MiB | 9.9 MiB |
| L | 181.0 MiB | 83.9 MiB | 83.7 MiB |

| artifact | size |
|---|---|
| `dist/flashtrace.mjs` (npm channel payload) | 33 KB |
| shimmed bundle (qjs) | 41 KB |
| **standalone QuickJS-ng executable** | **1.41 MB** |
| qjs interpreter | 1.37 MB |
| node executable (for comparison) | 124.7 MB |

## Decision gate

> Gate (provisional, needs human sign-off): binary-channel runtime passes if corpus-L
> p95 ≤ **2 s absolute** AND ≤ **10× Node**.

| arm | best JIT-less result | verdict |
|---|---|---|
| corpus-L p95 ≤ 2 s absolute | 280.78 s (qjs standalone, warm) | **FAIL** (140× over) |
| corpus-L p95 ≤ 10× Node | 6.86× | PASS |

**Verdict: FAIL as written → per the agreed format, the Rust rewrite is the
recommendation for the binary channel.** Runtime: QuickJS-ng v0.15.1 standalone;
numbers: L warm p95 280.78 s vs Node 40.96 s (6.86×), against a 2 s absolute bar.

**But the absolute arm needs sign-off before acting on that verdict, because it is
unsatisfiable by construction at this corpus scale**: the Node baseline itself needs
~41 s on corpus L — 20× over the 2 s bar. No runtime choice can pass a bar the baseline
misses; at 60 k files the bottleneck is flashtrace's single-threaded scan (~0.7 ms/file
under V8, ~4.7 ms/file under QuickJS), not the engine swap. Two coherent readings for the
human decision:

1. **"≤ 2 s at monorepo scale" is a real product requirement.** Then the JS tracer
   misses it on *every* engine, including the npm/Node channel, and the fix is a faster
   tracer (Rust rewrite — which would then arguably serve both channels), not a runtime
   choice. The gate's FAIL stands, with this wider scope.
2. **The requirement is "binary channel must not be pathologically slower than Node"**
   (the 10× arm). Then QuickJS-ng **passes everywhere**: byte-identical output, 6.9–7.1×
   on M/L, *faster than Node* on small/cold corpora, 13–28× faster startup, 2–6× lower
   peak RSS, and a 1.4 MB self-contained artifact vs Node's 125 MB. Ship the QuickJS-ng
   standalone route.

Largest caveat: the LLRT column is unmeasured (GitHub-blocked sandbox), and LLRT's
feasibility is already doubtful without a wrapper (named `execFileSync` import fails
instantiation, see SHIM-GAPS.md). Second caveat: M/L corpora are synthetic (network
policy) — deterministic and tag-dense (conservative for the scanner), but re-running on a
real pinned monorepo is a cheap follow-up once network allows. Third: L cells used 3 runs
(spread < 1 %).

Follow-ups (not spike blockers): LLRT column from CI, macOS arm64 pass, Windows (LLRT
untested there), real-repo corpora, `RUNS_L=10` re-run for the record.
