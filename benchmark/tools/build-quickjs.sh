#!/usr/bin/env bash
# Fetch and build QuickJS-ng (qjs interpreter + standalone compile support),
# pinned to a release tag, into $DEST (default: benchmark/out/quickjs).
#
#   benchmark/tools/build-quickjs.sh [DEST]
#
# The normal route is `git clone --branch $QJS_TAG` — use it when your network
# allows github.com. The fallback below fetches the pinned file set over
# raw.githubusercontent.com (works behind proxies that block github.com but
# allow raw.*), which is how the spike environment acquired it.
#
# Requires: curl, cmake, ninja or make, a C compiler.
set -euo pipefail

QJS_TAG="${QJS_TAG:-v0.15.1}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$HERE/out/quickjs}"
SRC="$DEST/src"
RAW="https://raw.githubusercontent.com/quickjs-ng/quickjs/refs/tags/$QJS_TAG"

if [ -x "$DEST/build/qjs" ]; then
  echo "qjs already built: $DEST/build/qjs ($("$DEST/build/qjs" --version))"
  exit 0
fi

mkdir -p "$SRC/gen"
cd "$SRC"

if git clone --depth 1 --branch "$QJS_TAG" https://github.com/quickjs-ng/quickjs.git . 2>/dev/null; then
  echo "cloned quickjs-ng $QJS_TAG"
else
  echo "git clone unavailable; fetching pinned file set from raw.githubusercontent.com"
  # complete file set needed to configure + build qjs/qjsc at v0.15.1 (the
  # while-loop below fetches any #include that a future tag might add)
  FILES="CMakeLists.txt quickjs.c quickjs.h quickjs-libc.c quickjs-libc.h
    quickjs-atom.h quickjs-opcode.h quickjs-c-atomics.h cutils.h dtoa.c dtoa.h
    libregexp.c libregexp.h libregexp-opcode.h libunicode.c libunicode.h
    libunicode-table.h list.h builtin-array-fromasync.h qjs.c qjsc.c
    gen/repl.c gen/standalone.c gen/function_source.c
    run-test262.c api-test.c lre-test.c unicode_gen.c unicode_gen_def.h"
  for f in $FILES; do
    curl -fsS --create-dirs -o "$f" "$RAW/$f" || { echo "fetch failed: $f" >&2; exit 1; }
  done
  # chase transitively-included headers not in the static list
  for _ in 1 2 3; do
    missing=0
    for f in $(grep -hoE '#include "[^"]+"' ./*.c ./*.h gen/*.c 2>/dev/null | sed 's/#include "//;s/"//' | sort -u); do
      if [ ! -f "$f" ]; then
        curl -fsS --create-dirs -o "$f" "$RAW/$f" && missing=1 || { echo "fetch failed: $f" >&2; exit 1; }
      fi
    done
    [ "$missing" = 0 ] && break
  done
fi

GEN=Ninja; command -v ninja >/dev/null || GEN="Unix Makefiles"
cmake -B "$DEST/build" -G "$GEN" -DCMAKE_BUILD_TYPE=Release "$SRC" >/dev/null
cmake --build "$DEST/build" --target qjs_exe qjsc >/dev/null
echo "built: $DEST/build/qjs ($("$DEST/build/qjs" --version)), $DEST/build/qjsc"
