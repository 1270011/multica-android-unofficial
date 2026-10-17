#!/usr/bin/env bash
# Decide whether android/ is stale for `expo prebuild`.
#
#   scripts/prebuild-stamp.sh check   exit 0 = android/ matches the config,
#                                     exit 1 = missing or built from another config
#   scripts/prebuild-stamp.sh write   record the current config in android/
#
# Without --clean, prebuild only adds to an existing android/: an entry
# removed from app.config.ts (e.g. a blockedPermissions line) stays in the
# old AndroidManifest.xml. android-build.sh wipes
# android/ whenever the config hash changed.
set -euo pipefail
cd "$(dirname "$0")/.."
STAMP="android/.rb-prebuild-config"

config_hash() {
  # Everything prebuild reads to generate android/.
  find app.config.ts package.json plugins -type f 2>/dev/null | LC_ALL=C sort |
    xargs sha256sum | sha256sum | cut -d' ' -f1
}

case "${1:-}" in
  check) [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$(config_hash)" ] ;;
  write) mkdir -p android && config_hash > "$STAMP" ;;
  *) echo "usage: $0 check|write" >&2; exit 2 ;;
esac
