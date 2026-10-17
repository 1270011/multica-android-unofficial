#!/usr/bin/env bash
# Fail the build when a native fix from patches/ is missing in node_modules
#. pnpm applies patches/react-native-screens@4.23.0.patch
# (backports of react-native-screens #4413, Android start crash in
# MountingCoordinator::pullTransaction, and #4834, NPE in
# ScreensModule.setupFabric during teardown) only with the lockfile; an install
# without it, or a version bump that drops the patch, must not ship.
#
#   scripts/check-native-patches.sh [<react-native-screens dir>]
#   scripts/check-native-patches.sh --apk <apk>...
#
# Without an argument the package is resolved from apps/mobile. With --apk
# it checks what was really built: every librnscreens.so in the APK must
# export both #4413 methods (a stale Gradle autolinking cache once built the
# unpatched copy although node_modules was patched). The
# Kotlin part (#4834, setupFabric) is compiled from the same autolinked
# package directory as the .so and ships in the same patch, so a patched
# .so also vouches for it.
set -euo pipefail

if [ "${1:-}" = "--apk" ]; then
  # Before any cd: relative APK paths are the caller's.
  shift
  [ $# -gt 0 ] || { echo "check-native-patches: --apk needs an APK" >&2; exit 2; }
  python3 - "$@" <<'PY'
import sys, zipfile

# Exported, non-inline methods of the patched listener; they stay in
# .dynsym, so stripped release libraries keep them too.
SYMBOLS = (
    b"_ZN24RNSScreenRemovalListener11setListener",
    b"_ZN24RNSScreenRemovalListener13clearListener",
)
bad = False
for apk in sys.argv[1:]:
    try:
        z = zipfile.ZipFile(apk)
    except (OSError, zipfile.BadZipFile) as err:
        print(f"check-native-patches: cannot read {apk}: {err}", file=sys.stderr)
        bad = True
        continue
    with z:
        libs = [n for n in z.namelist() if n.endswith("/librnscreens.so")]
        if not libs:
            print(f"check-native-patches: {apk} has no librnscreens.so", file=sys.stderr)
            bad = True
        for name in libs:
            data = z.read(name)
            missing = [s.decode() for s in SYMBOLS if s not in data]
            if missing:
                print(
                    f"check-native-patches: {apk}:{name} built without the #4413 patch "
                    f"(missing {', '.join(missing)})",
                    file=sys.stderr,
                )
                bad = True
            else:
                print(f"check-native-patches: {name} patched")
sys.exit(1 if bad else 0)
PY
  exit $?
fi

cd "$(dirname "$0")/.."

PATCHED_VERSION="4.23.0"
DIR="${1:-}"
if [ -z "$DIR" ]; then
  DIR="$(node -p 'require("path").dirname(require.resolve("react-native-screens/package.json"))')"
fi

VERSION="$(node -p 'require(process.argv[1]).version' "$DIR/package.json")"
if [ "$VERSION" != "$PATCHED_VERSION" ]; then
  echo "check-native-patches: react-native-screens is $VERSION, the patch is for $PATCHED_VERSION." >&2
  echo "  Keep the #4413 fix (built in from 4.28.0) and update this check and patches/." >&2
  exit 1
fi
if ! grep -q "setListener" "$DIR/cpp/RNSScreenRemovalListener.h" \
  || ! grep -q "removalListener()" "$DIR/android/src/main/cpp/NativeProxy.cpp" \
  || ! grep -q "as? FabricUIManager" "$DIR/android/src/main/java/com/swmansion/rnscreens/ScreensModule.kt"; then
  echo "check-native-patches: react-native-screens $VERSION without the #4413/#4834 patch ($DIR)." >&2
  echo "  Run pnpm install --frozen-lockfile from the repository root." >&2
  exit 1
fi
echo "check-native-patches: react-native-screens $VERSION patched"
