#!/usr/bin/env bash
# Release guard for the debug-only token sign-in.
#
#   scripts/check-release-bundle.sh [--expect-debug] <app.apk|index.android.bundle>
#
# Default: fails when the JS bundle still contains a marker of the debug
# token login (apps/mobile/README.md, "Debug build"). build-release.sh runs
# this on every signed APK.
# --expect-debug: the opposite check for debug APKs — fails when a marker
# is MISSING. CI runs it on its debug APK so the marker list is proven to
# still match the real bundle (a renamed string would otherwise make the
# release check pass vacuously).
set -euo pipefail

MARKERS=("debug-token.txt" "token_login.file_loaded" "token_login.entry")
EXPECT_DEBUG=0
if [ "${1:-}" = "--expect-debug" ]; then EXPECT_DEBUG=1; shift; fi
INPUT="${1:?usage: check-release-bundle.sh [--expect-debug] <apk|bundle>}"
[ -r "$INPUT" ] || { echo "not readable: $INPUT" >&2; exit 2; }

BUNDLE="$INPUT"
TMP=""
cleanup() { if [ -n "$TMP" ]; then rm -f "$TMP"; fi; }
trap cleanup EXIT
case "$INPUT" in
  *.apk)
    TMP="$(mktemp)"
    python3 - "$INPUT" "$TMP" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as apk, open(sys.argv[2], "wb") as out:
    out.write(apk.read("assets/index.android.bundle"))
PY
    BUNDLE="$TMP"
    ;;
esac

status=0
for marker in "${MARKERS[@]}"; do
  count="$(grep -c -a -F -- "$marker" "$BUNDLE" || true)"
  if [ "$EXPECT_DEBUG" = 1 ]; then
    if [ "$count" = 0 ]; then echo "missing in debug bundle: $marker" >&2; status=1; fi
  else
    if [ "$count" != 0 ]; then echo "debug-only marker in release bundle: $marker" >&2; status=1; fi
  fi
done
if [ "$status" = 0 ]; then
  if [ "$EXPECT_DEBUG" = 1 ]; then echo "debug bundle: all markers present"; else echo "release bundle: no debug token login"; fi
fi
exit "$status"
