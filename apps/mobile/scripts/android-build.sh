#!/usr/bin/env bash
# Build the Android APK (debug by default).
#
#   scripts/android-build.sh [debug|release] [--archs <list>] [--clean]
#
# Runs `expo prebuild --platform android` (re-applies the config plugins:
# package id, network security config, release signing hook) and then the
# matching Gradle task. Release builds are signed with the debug key unless
# the RB_RELEASE_* Gradle properties are present — use
# scripts/build-release.sh for a properly signed APK.
#
# Environment (all optional):
#   ANDROID_HOME / JAVA_HOME      SDK + JDK 17 (required)
#   GRADLE_USER_HOME              Gradle cache (default: ~/.gradle)
#   ANDROID_VERSION_CODE          versionCode baked into the APK (default 1)
#   APP_ENV                       Expo variant, default "production"
#   RB_ARCHS                      comma list of ABIs; default depends on the
#                                 build type (debug: x86_64 for the emulator,
#                                 release: arm64-v8a,armeabi-v7a for phones)
set -euo pipefail

cd "$(dirname "$0")/.."

BUILD_TYPE="debug"
CLEAN=0
ARCHS="${RB_ARCHS:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    debug|release) BUILD_TYPE="$1" ;;
    --archs) ARCHS="$2"; shift ;;
    --clean) CLEAN=1 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

: "${ANDROID_HOME:?set ANDROID_HOME to the Android SDK}"
: "${JAVA_HOME:?set JAVA_HOME to a JDK 17}"
export ANDROID_HOME JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"
export APP_ENV="${APP_ENV:-production}"
export EXPO_NO_TELEMETRY=1
export CI="${CI:-1}"

if [ -z "$ARCHS" ]; then
  if [ "$BUILD_TYPE" = "release" ]; then ARCHS="arm64-v8a,armeabi-v7a"; else ARCHS="x86_64"; fi
fi

# Native fixes from patches/ must be in node_modules; this
# covers CI, and scripts/build-release.sh.
scripts/check-native-patches.sh

# Prebuild never removes what an old config put into android/ (e.g. a
# dropped blockedPermissions entry), so start clean when the config changed.
if [ "$CLEAN" = 1 ] || ! scripts/prebuild-stamp.sh check; then
  echo "==> android/ missing or built from another config: clean prebuild"
  rm -rf android
fi

echo "==> expo prebuild (android, APP_ENV=$APP_ENV, versionCode=${ANDROID_VERSION_CODE:-1})"
pnpm exec expo prebuild --platform android --no-install
scripts/prebuild-stamp.sh write

GRADLE_TASK="assembleDebug"
[ "$BUILD_TYPE" = "release" ] && GRADLE_TASK="assembleRelease"

# Debug-only tester sign-in with an access token (lib/debug-token-login.ts).
# Only debug bundles get the flag; release bundles never see it, and __DEV__
# is false there anyway — both gates are folded at bundle time.
# Verbose app logs (lib/logger.ts: debug/info/log) likewise only in debug
# APKs; release bundles keep just redacted warnings and errors.
if [ "$BUILD_TYPE" = "debug" ]; then
  export EXPO_PUBLIC_DEBUG_TOKEN_LOGIN=1
  export EXPO_PUBLIC_VERBOSE_LOGS=1
else
  unset EXPO_PUBLIC_DEBUG_TOKEN_LOGIN EXPO_PUBLIC_VERBOSE_LOGS
fi

# The React Native settings plugin regenerates autolinking.json only when
# apps/mobile/{package.json,yarn.lock,package-lock.json} change. Our
# pnpm-lock.yaml and patchedDependencies live in the repo root, so after a
# new patch a reused android/ kept building the old, unpatched pnpm copy
# of a library. Regenerating costs seconds.
rm -rf android/build/generated/autolinking

echo "==> gradle $GRADLE_TASK (archs: $ARCHS)"
(
  cd android
  ./gradlew "$GRADLE_TASK" \
    --no-daemon \
    -PreactNativeArchitectures="$ARCHS" \
    "$@"
)

APK_DIR="android/app/build/outputs/apk/$BUILD_TYPE"
ls -la "$APK_DIR"/*.apk
# The source check above cannot see what Gradle actually compiled.
scripts/check-native-patches.sh --apk "$APK_DIR"/*.apk
