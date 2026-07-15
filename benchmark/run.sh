#!/usr/bin/env bash
# Full benchmark matrix: one command reproduces every cell.
#
#   benchmark/run.sh [CORPUS_ROOT]
#
# Prerequisites:
#   pnpm install && pnpm build                    (bundle under test)
#   benchmark/tools/build-quickjs.sh              (qjs + standalone support)
#   benchmark/corpus/make-corpora.sh              (S/M/L corpora)
#   cargo install hyperfine                       (timing)
#   benchmark/tools/get-llrt.sh                   (optional LLRT column)
#
# Env knobs:
#   QJS   path to qjs           (default benchmark/out/quickjs/build/qjs)
#   LLRT  path to llrt binary   (optional; cell skipped when absent)
#   RUNS  timed runs per cell   (default 10)
#   RUNS_S/RUNS_M/RUNS_L  per-corpus override of RUNS (a JIT-less run on L
#         takes minutes; the spike used RUNS_L=3 - see RESULTS.md)
#   COLD  1/0 force-enable/disable cold-cache runs (default: auto-detect
#         whether /proc/sys/vm/drop_caches is writable)
#
# Outputs into benchmark/results/:
#   <corpus>-{warm,cold}.json  hyperfine exports (raw run times)
#   startup.json, compile.json
#   raw-times.csv, summary.csv (via tools/summarize.mjs)
#   correctness.txt, rss-size.csv, environment.txt
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
CORPUS_ROOT="${1:-${CORPUS_ROOT:-/tmp/flashtrace-bench-corpora}}"
QJS="${QJS:-$HERE/out/quickjs/build/qjs}"
LLRT="${LLRT:-}"
RUNS="${RUNS:-10}"
RESULTS="$HERE/results"
mkdir -p "$RESULTS"

NODE_BUNDLE="$REPO/dist/flashtrace.mjs"
QJS_BUNDLE="$HERE/out/dist/flashtrace.qjs.mjs"
LLRT_BUNDLE="$HERE/out/dist/flashtrace.llrt.mjs"
QJS_BIN="$HERE/out/flashtrace-qjs-bin"

[ -f "$NODE_BUNDLE" ] || { echo "missing $NODE_BUNDLE - run pnpm build" >&2; exit 1; }
[ -x "$QJS" ] || { echo "missing qjs at $QJS - run benchmark/tools/build-quickjs.sh" >&2; exit 1; }
[ -d "$CORPUS_ROOT/S" ] || { echo "missing corpora - run benchmark/corpus/make-corpora.sh" >&2; exit 1; }

echo "== building shimmed bundles"
node "$HERE/build.mjs" >/dev/null

echo "== compiling standalone binary (timed)"
hyperfine --warmup 1 --runs "$RUNS" --export-json "$RESULTS/compile.json" \
  --command-name "-|compile|qjs-bin" \
  "'$QJS' -c '$QJS_BUNDLE' -o '$QJS_BIN'"

# runtime table: name -> command prefix (invoked as: <cmd> <arg...>)
declare -A CMD=(
  [node]="node '$NODE_BUNDLE'"
  [qjs]="'$QJS' '$QJS_BUNDLE'"
  [qjs-bin]="'$QJS_BIN'"
)
RUNTIMES=(node qjs qjs-bin)
if [ -n "$LLRT" ] && [ -x "$LLRT" ]; then
  CMD[llrt]="'$LLRT' '$LLRT_BUNDLE'"
  RUNTIMES+=(llrt)
else
  echo "note: LLRT not available; skipping llrt column (set LLRT=/path/to/llrt)"
fi

# cold-cache support
if [ "${COLD:-auto}" = auto ]; then
  if sync && echo 3 > /proc/sys/vm/drop_caches 2>/dev/null; then COLD=1; else COLD=0; fi
fi
[ "$COLD" = 1 ] || echo "note: cold-cache runs disabled (drop_caches not writable)"

echo "== correctness gate (byte-diff vs node, per corpus)"
: > "$RESULTS/correctness.txt"
declare -A OK
for rt in "${RUNTIMES[@]}"; do OK[$rt]=1; done
for corpus in S M L; do
  dir="$CORPUS_ROOT/$corpus"
  set +e
  ( cd "$dir" && eval "${CMD[node]} ." > /tmp/bench-ref.out 2>/dev/null )
  refExit=$?
  set -e
  for rt in "${RUNTIMES[@]}"; do
    [ "$rt" = node ] && continue
    set +e
    ( cd "$dir" && eval "${CMD[$rt]} ." > /tmp/bench-cand.out 2>/dev/null )
    candExit=$?
    set -e
    if cmp -s /tmp/bench-ref.out /tmp/bench-cand.out && [ "$candExit" = "$refExit" ]; then
      echo "$corpus $rt: OK (byte-identical, exit $candExit)" | tee -a "$RESULTS/correctness.txt"
    else
      echo "$corpus $rt: MISMATCH (exit $candExit vs $refExit) - DISQUALIFIED from timing" | tee -a "$RESULTS/correctness.txt"
      OK[$rt]=0
    fi
  done
done

hf_cells() { # $1 phase, $2 corpus, $3 arg; echoes -n/-c pairs for qualified runtimes
  for rt in "${RUNTIMES[@]}"; do
    [ "${OK[$rt]}" = 1 ] || continue
    printf -- "--command-name\n%s|%s|%s\n%s %s\n" "$2" "$1" "$rt" "${CMD[$rt]}" "$3"
  done
}

echo "== startup probe (--version)"
mapfile -t cells < <(hf_cells startup - --version)
hyperfine --warmup 3 --runs "$RUNS" --export-json "$RESULTS/startup.json" "${cells[@]}"

for corpus in S M L; do
  dir="$CORPUS_ROOT/$corpus"
  runsVar="RUNS_$corpus"
  runs="${!runsVar:-$RUNS}"
  echo "== corpus $corpus: warm full runs ($runs runs/cell)"
  mapfile -t cells < <(hf_cells full-warm "$corpus" .)
  ( cd "$dir" && hyperfine -i --warmup 1 --runs "$runs" --export-json "$RESULTS/$corpus-warm.json" "${cells[@]}" )
  if [ "$COLD" = 1 ]; then
    echo "== corpus $corpus: cold full runs ($runs runs/cell)"
    mapfile -t cold_cells < <(hf_cells full-cold "$corpus" .)
    ( cd "$dir" && hyperfine -i --runs "$runs" \
        --prepare 'sync; echo 3 > /proc/sys/vm/drop_caches' \
        --export-json "$RESULTS/$corpus-cold.json" "${cold_cells[@]}" )
  fi
done

echo "== peak RSS + artifact sizes"
{
  echo "corpus,runtime,peak_rss_kib"
  for corpus in S M L; do
    for rt in "${RUNTIMES[@]}"; do
      [ "${OK[$rt]}" = 1 ] || continue
      rss=$(cd "$CORPUS_ROOT/$corpus" && eval "python3 '$HERE/tools/peakrss.py' ${CMD[$rt]} .")
      echo "$corpus,$rt,$rss"
    done
  done
  echo
  echo "artifact,bytes"
  echo "dist/flashtrace.mjs,$(stat -c%s "$NODE_BUNDLE")"
  echo "qjs interpreter,$(stat -c%s "$QJS")"
  echo "shimmed bundle (qjs),$(stat -c%s "$QJS_BUNDLE")"
  echo "standalone qjs binary,$(stat -c%s "$QJS_BIN")"
  echo "node executable,$(stat -c%s "$(command -v node)")"
  [ -n "$LLRT" ] && [ -x "$LLRT" ] && echo "llrt executable,$(stat -c%s "$LLRT")"
} > "$RESULTS/rss-size.csv"

echo "== environment"
{
  echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "repo: $(git -C "$REPO" rev-parse HEAD)"
  echo "node: $(node --version)"
  echo "qjs: $("$QJS" --version)"
  [ -n "$LLRT" ] && [ -x "$LLRT" ] && echo "llrt: $("$LLRT" --version 2>&1 | head -1)"
  echo "hyperfine: $(hyperfine --version)"
  echo "esbuild: $(node -e 'console.log(require("esbuild/package.json").version)' 2>/dev/null || echo n/a)"
  echo "cc: $(cc --version | head -1)"
  echo "kernel: $(uname -sr), arch: $(uname -m)"
  echo "cpu: $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2- | xargs), $(nproc) cores"
  echo "runs per cell: $RUNS, cold runs: $COLD"
  cat "$CORPUS_ROOT/PINS.txt"
} > "$RESULTS/environment.txt"

echo "== summary"
node "$HERE/tools/summarize.mjs" "$RESULTS"
