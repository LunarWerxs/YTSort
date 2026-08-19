#!/usr/bin/env bash
# The extension manifest and the userscript ship the same code, so a version
# skew means one of the two install channels is quietly serving a build that
# claims to be something it is not.
set -euo pipefail
cd "$(dirname "$0")/.."

us=$(grep -m1 -oE '@version[[:space:]]+[0-9][^[:space:]]*' extension/ytsort2.user.js | awk '{print $2}')
mf=$(grep -m1 -oE '"version"[[:space:]]*:[[:space:]]*"[^"]+"' extension/manifest.json | sed 's/.*"\([^"]*\)"$/\1/')
[ -n "$us" ] && [ -n "$mf" ] || { echo "FAIL: could not read both versions (userscript='$us' manifest='$mf')"; exit 1; }
if [ "$us" != "$mf" ]; then
  echo "FAIL: userscript @version is $us but extension/manifest.json is $mf"
  exit 1
fi
echo "ok: both channels are $us"
