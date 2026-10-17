#!/usr/bin/env bash
# Self-test for check-native-patches.sh with synthetic package dirs.
set -euo pipefail
cd "$(dirname "$0")"
DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT

make_pkg() { # <dir> <version> <patched 0|1|a1only>
  mkdir -p "$1/cpp" "$1/android/src/main/cpp" "$1/android/src/main/java/com/swmansion/rnscreens"
  printf '{"version":"%s"}\n' "$2" > "$1/package.json"
  echo "getUIManager(reactContext, UIManagerType.FABRIC) as FabricUIManager" \
    > "$1/android/src/main/java/com/swmansion/rnscreens/ScreensModule.kt"
  if [ "$3" = 1 ] || [ "$3" = a1only ]; then
    echo "uint64_t setListener(std::function<void(int)> &&f);" > "$1/cpp/RNSScreenRemovalListener.h"
    echo "coordinator->setMountingOverrideDelegate(removalListener());" > "$1/android/src/main/cpp/NativeProxy.cpp"
  fi
  if [ "$3" = 1 ]; then
    echo "getUIManager(reactContext, UIManagerType.FABRIC) as? FabricUIManager ?: return" \
      > "$1/android/src/main/java/com/swmansion/rnscreens/ScreensModule.kt"
  elif [ "$3" = 0 ]; then
    echo "std::function<void(int)> listenerFunction_;" > "$1/cpp/RNSScreenRemovalListener.h"
    echo "coordinator->setMountingOverrideDelegate(screenRemovalListener_);" > "$1/android/src/main/cpp/NativeProxy.cpp"
  fi
}
make_pkg "$DIR/patched" 4.23.0 1
make_pkg "$DIR/unpatched" 4.23.0 0
make_pkg "$DIR/other" 4.24.0 1
make_pkg "$DIR/a1only" 4.23.0 a1only

fail() { echo "FAIL: $*" >&2; exit 1; }
./check-native-patches.sh "$DIR/patched" >/dev/null || fail "patched package rejected"
if ./check-native-patches.sh "$DIR/unpatched" >/dev/null 2>&1; then fail "unpatched package accepted"; fi
if ./check-native-patches.sh "$DIR/other" >/dev/null 2>&1; then fail "other version accepted"; fi
if ./check-native-patches.sh "$DIR/a1only" >/dev/null 2>&1; then fail "package without the A2 setupFabric fix accepted"; fi
./check-native-patches.sh >/dev/null || fail "installed react-native-screens is not patched"

# --apk: what Gradle really packaged.
python3 - "$DIR" <<'PY'
import sys, zipfile
d = sys.argv[1]
def apk(name, libs):
    with zipfile.ZipFile(f"{d}/{name}.apk", "w") as z:
        for abi, body in libs.items():
            z.writestr(f"lib/{abi}/librnscreens.so", body)
SET = b"_ZN24RNSScreenRemovalListener11setListenerEONSt6__ndk18functionIFviEEE"
CLEAR = b"_ZN24RNSScreenRemovalListener13clearListenerEm"
apk("good", {"x86_64": b"\x7fELF.." + SET + b".." + CLEAR, "arm64-v8a": CLEAR + SET})
apk("stale", {"x86_64": SET + CLEAR, "arm64-v8a": b"\x7fELF...listenerFunction_..."})
# A bare "setListener" elsewhere is not enough.
apk("loose", {"x86_64": b"..setListener..clearListener.."})
apk("half", {"x86_64": SET})
with zipfile.ZipFile(f"{d}/none.apk", "w") as z:
    z.writestr("lib/x86_64/libother.so", b"x")
PY
./check-native-patches.sh --apk "$DIR/good.apk" >/dev/null || fail "patched apk rejected"
if ./check-native-patches.sh --apk "$DIR/stale.apk" >/dev/null 2>&1; then fail "apk with an unpatched ABI accepted"; fi
if ./check-native-patches.sh --apk "$DIR/none.apk" >/dev/null 2>&1; then fail "apk without librnscreens accepted"; fi
if ./check-native-patches.sh --apk "$DIR/loose.apk" >/dev/null 2>&1; then fail "apk with only loose strings accepted"; fi
if ./check-native-patches.sh --apk "$DIR/half.apk" >/dev/null 2>&1; then fail "apk with only setListener accepted"; fi
out="$(./check-native-patches.sh --apk "$DIR/missing.apk" 2>&1)" && fail "missing apk accepted"
case "$out" in *Traceback*) fail "missing apk gives a traceback";; esac
# Relative paths are the caller's, not the script directory's.
( cd "$DIR" && "$OLDPWD/check-native-patches.sh" --apk good.apk >/dev/null ) || fail "relative apk path not resolved from the caller"
echo "check-native-patches: ok"
