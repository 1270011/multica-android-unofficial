#!/usr/bin/env bash
# Self-test for check-release-bundle.sh with synthetic bundles and APKs.
set -euo pipefail
cd "$(dirname "$0")"
DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT

printf 'abc\0token_login.entry\0debug-token.txt\0token_login.file_loaded\0' > "$DIR/debug.bundle"
printf 'abc\0token_login.title\0nothing here\0' > "$DIR/release.bundle"
python3 - "$DIR" <<'PY'
import sys, zipfile
d = sys.argv[1]
for name in ("debug", "release"):
    with zipfile.ZipFile(f"{d}/{name}.apk", "w") as z:
        z.write(f"{d}/{name}.bundle", "assets/index.android.bundle")
PY

fail() { echo "FAIL: $*" >&2; exit 1; }
./check-release-bundle.sh "$DIR/release.bundle" >/dev/null || fail "clean release bundle rejected"
./check-release-bundle.sh "$DIR/release.apk" >/dev/null || fail "clean release apk rejected"
if ./check-release-bundle.sh "$DIR/debug.apk" 2>/dev/null; then fail "debug apk accepted as release"; fi
./check-release-bundle.sh --expect-debug "$DIR/debug.apk" >/dev/null || fail "debug apk markers not found"
if ./check-release-bundle.sh --expect-debug "$DIR/release.bundle" 2>/dev/null; then fail "release bundle accepted as debug"; fi
echo "check-release-bundle: ok"
