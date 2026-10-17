#!/usr/bin/env bash
# Self-test for prebuild-stamp.sh on a throwaway copy of the inputs.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT
mkdir -p "$DIR/scripts" "$DIR/plugins"
cp scripts/prebuild-stamp.sh "$DIR/scripts/"
echo 'blockedPermissions: ["A", "B"]' > "$DIR/app.config.ts"
echo '{}' > "$DIR/package.json"
echo 'plugin' > "$DIR/plugins/p.js"
S() { bash "$DIR/scripts/prebuild-stamp.sh" "$@"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

if S check; then fail "missing android/ counted as fresh"; fi
S write
S check || fail "fresh stamp counted as stale"
echo 'blockedPermissions: ["A"]' > "$DIR/app.config.ts"
if S check; then fail "changed app.config.ts not detected"; fi
S write
echo 'plugin 2' > "$DIR/plugins/p.js"
if S check; then fail "changed plugin not detected"; fi
echo "prebuild-stamp: ok"
