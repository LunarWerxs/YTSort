#!/usr/bin/env bash
# extension/yt.js is a legacy MIRROR of extension/ytsort2.user.js.
#
# Why it exists: v4.6 and earlier shipped as extension/yt.js and baked that path
# into their @updateURL. The v5 rebuild renamed the file, so every one of those
# installs has been polling a 404 ever since and can never receive another
# update. Restoring the path lets them update themselves into the current build.
#
# The path is therefore a PERMANENT PUBLIC API. Do not rename or delete it.
#
# The mirror differs from the canonical script by exactly two lines, its own
# @downloadURL and @updateURL, which must keep pointing at yt.js so the rescued
# lineage keeps updating from the path it actually polls.
#
#   scripts/legacy-mirror.sh          verify the mirror is in sync (exit 1 if not)
#   scripts/legacy-mirror.sh --write  regenerate it after editing the canonical script
#
# One implementation for both, so the check can never disagree with the generator.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=extension/ytsort2.user.js
MIRROR=extension/yt.js
CANON_URL='https://raw.githubusercontent.com/LunarWerxs/YTSort/main/extension/ytsort2.user.js'
LEGACY_URL='https://raw.githubusercontent.com/LunarWerxs/YTSort/main/extension/yt.js'

[ -f "$SRC" ] || { echo "missing $SRC"; exit 1; }

expected=$(mktemp)
trap 'rm -f "$expected"' EXIT
sed -e "s|\(@downloadURL  *\)$CANON_URL|\1$LEGACY_URL|" \
    -e "s|\(@updateURL  *\)$CANON_URL|\1$LEGACY_URL|" \
    "$SRC" > "$expected"

# The substitution must actually have fired twice; a silent no-op would publish
# a mirror that sends its users back to the canonical URL and re-strands them.
n=$(grep -c "$LEGACY_URL" "$expected" || true)
if [ "$n" -ne 2 ]; then
  echo "FAIL: expected 2 rewritten metadata URLs in the mirror, found $n."
  echo "      Did the @downloadURL/@updateURL lines in $SRC change shape?"
  exit 1
fi

if [ "${1:-}" = "--write" ]; then
  cp "$expected" "$MIRROR"
  echo "wrote $MIRROR"
  exit 0
fi

[ -f "$MIRROR" ] || { echo "FAIL: $MIRROR is missing. It is the update path for every pre-v5 install; run scripts/legacy-mirror.sh --write."; exit 1; }

if ! diff -u "$MIRROR" "$expected" > /dev/null; then
  echo "FAIL: $MIRROR has drifted from $SRC."
  echo "      Every pre-v5 user updates through the mirror, so a stale one ships them stale code."
  echo "      Fix with: scripts/legacy-mirror.sh --write"
  echo
  diff -u "$MIRROR" "$expected" | head -40
  exit 1
fi
echo "ok: $MIRROR is in sync with $SRC (differs only in its 2 metadata URLs)"
