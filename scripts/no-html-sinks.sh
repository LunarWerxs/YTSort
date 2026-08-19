#!/usr/bin/env bash
# YouTube enforces Trusted Types. Any assignment to a raw-HTML sink throws
# "TypeError: ... requires 'TrustedHTML' assignment" at runtime, and because our
# click handlers build their UI before appending it, the throw happens BEFORE
# anything reaches the screen. The user sees a button that does nothing at all:
# no panel, no error, no clue.
#
# That is not hypothetical. It is issue #1: v4.6 set `closeButton.innerHTML` one
# line into the Settings panel, which silently killed Settings AND the Dry Run
# preview for every user on every browser for six months.
#
# So: build nodes with textContent / createElement. Never with HTML strings.
set -euo pipefail
cd "$(dirname "$0")/.."

SINKS='\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write'
status=0
files=$(find extension bookmarklet -name '*.js' -type f | sort)
[ -n "$files" ] || { echo "FAIL: found no shipped .js to scan - did a path move?"; exit 1; }

for f in $files; do
  if hits=$(grep -nE "$SINKS" "$f"); then
    echo "FAIL: $f writes raw HTML, which Trusted Types blocks on YouTube:"
    echo "$hits" | sed 's/^/    /'
    status=1
  fi
done

if [ "$status" -ne 0 ]; then
  echo
  echo "Use textContent or createElement instead. See issue #1 for what this looks like in the wild."
  exit 1
fi
echo "ok: no Trusted-Types-blocked HTML sinks in $(echo "$files" | wc -l | tr -d ' ') shipped file(s)"
