#!/usr/bin/env bash
# Download an LLRT release binary (linux x64) into $DEST (default:
# benchmark/out/llrt/llrt). LLRT is distributed exclusively through GitHub
# release assets; there is no npm/crates/pypi channel for the CLI binary.
#
#   LLRT_TAG=v0.6.1-beta benchmark/tools/get-llrt.sh [DEST]
#
# NOTE: the spike's sandbox blocks github.com (including release assets), so
# this script could not be exercised there and the LLRT matrix column is
# pending. Run this from CI or a workstation with GitHub access.
set -euo pipefail

LLRT_TAG="${LLRT_TAG:-latest}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$HERE/out/llrt/llrt}"
mkdir -p "$(dirname "$DEST")"

if [ "$LLRT_TAG" = latest ]; then
  URL="https://github.com/awslabs/llrt/releases/latest/download/llrt-linux-x64.zip"
else
  URL="https://github.com/awslabs/llrt/releases/download/$LLRT_TAG/llrt-linux-x64.zip"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL -o "$TMP/llrt.zip" "$URL"
unzip -o -q "$TMP/llrt.zip" -d "$TMP"
install -m 0755 "$TMP/llrt" "$DEST"
echo "installed: $DEST ($("$DEST" --version 2>&1 | head -1))"
