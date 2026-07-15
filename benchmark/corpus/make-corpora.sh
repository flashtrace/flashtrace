#!/usr/bin/env bash
# Build the S/M/L benchmark corpora under $CORPUS_ROOT.
#
#   benchmark/corpus/make-corpora.sh [CORPUS_ROOT]
#
#   S  copy of flashtrace's own working tree (src/docs/test + top-level md),
#      pinned by the repo HEAD SHA recorded in $CORPUS_ROOT/PINS.txt
#   M  synthetic polyglot tree,  3 000 files (gen-corpus.mjs, seed 1002)
#   L  synthetic polyglot tree, 60 000 files (gen-corpus.mjs, seed 1003)
#
# M and L were planned as pinned clones of real repositories; the spike
# environment cannot clone external GitHub repos, so gen-corpus.mjs generates
# equivalent trees deterministically (see PLAN.md, "Corpora"). The corpora are
# deliberately NOT git repositories and must live outside any git work tree so
# that every runtime takes the same directory-walk path in collectFiles().
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
CORPUS_ROOT="${1:-${CORPUS_ROOT:-/tmp/flashtrace-bench-corpora}}"

mkdir -p "$CORPUS_ROOT"
if git -C "$CORPUS_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  echo "error: $CORPUS_ROOT is inside a git work tree; corpora must live outside one" >&2
  exit 1
fi

echo "corpus root: $CORPUS_ROOT"

# S - flashtrace itself
rm -rf "$CORPUS_ROOT/S"
mkdir -p "$CORPUS_ROOT/S"
cp -r "$REPO/src" "$REPO/docs" "$REPO/test" "$CORPUS_ROOT/S/"
cp "$REPO/README.md" "$REPO/CONTRIBUTING.md" "$CORPUS_ROOT/S/"

# M / L - synthetic polyglot trees
node "$HERE/gen-corpus.mjs" "$CORPUS_ROOT/M" --files 3000 --seed 1002
node "$HERE/gen-corpus.mjs" "$CORPUS_ROOT/L" --files 60000 --seed 1003

{
  echo "generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "S: flashtrace working tree at $(git -C "$REPO" rev-parse HEAD)"
  echo "M: gen-corpus.mjs --files 3000 --seed 1002"
  echo "L: gen-corpus.mjs --files 60000 --seed 1003"
  for c in S M L; do
    echo "$c: $(find "$CORPUS_ROOT/$c" -type f | wc -l) files, $(du -sh "$CORPUS_ROOT/$c" | cut -f1)"
  done
} | tee "$CORPUS_ROOT/PINS.txt"
