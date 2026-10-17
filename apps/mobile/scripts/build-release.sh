#!/usr/bin/env bash
# Build and sign the release APK. Local only — never in CI, the signing key
# must not be readable there.
#
#   scripts/build-release.sh [--version-code N] [--out <dir>] [--clean] [--abi-suffix]
#
# Reads the signing material from RB_SIGNING_ENV (required), a file only
# the builder can read, with:
#
#   RB_RELEASE_STORE_FILE=/path/to/release.jks
#   RB_RELEASE_STORE_PASSWORD=...
#   RB_RELEASE_KEY_ALIAS=<alias>
#   RB_RELEASE_KEY_PASSWORD=...
#
# The values are passed to Gradle through a temporary gradle.properties in a
# private GRADLE_USER_HOME overlay (not on the command line, so they do not
# show up in `ps` or shell history). The APK is verified with apksigner and
# copied to <out>/multica-recordingbeats-<versionName>.apk next to a .sha256.
#
# Environment: ANDROID_VERSION_NAME / ANDROID_VERSION_CODE (see app.config.ts),
# RB_ARCHS (ABIs, default arm64-v8a,armeabi-v7a), RB_OUT_DIR (default
# build/release-apk). --clean removes the generated android/ directory first
# (clean prebuild); --abi-suffix appends "-<archs>" to the file name (used for
# the x86_64 emulator variant so it never gets mistaken for the phone APK).
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION_CODE="${ANDROID_VERSION_CODE:-}"
OUT_DIR="${RB_OUT_DIR:-$PWD/build/release-apk}"
BUILD_ARGS=()
ABI_SUFFIX=0
while [ $# -gt 0 ]; do
  case "$1" in
    --version-code) VERSION_CODE="$2"; shift ;;
    --out) OUT_DIR="$2"; shift ;;
    --clean) BUILD_ARGS+=(--clean) ;;
    --abi-suffix) ABI_SUFFIX=1 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

SIGNING_ENV="${RB_SIGNING_ENV:-}"
if [ -z "$SIGNING_ENV" ] || [ ! -r "$SIGNING_ENV" ]; then
  echo "signing env not readable: $SIGNING_ENV" >&2
  exit 1
fi

: "${ANDROID_HOME:?set ANDROID_HOME to the Android SDK}"
: "${JAVA_HOME:?set JAVA_HOME to a JDK 17}"
export PATH="$JAVA_HOME/bin:$PATH"
BASE_GRADLE_HOME="${GRADLE_USER_HOME:-$HOME/.gradle}"

# Private Gradle home overlay: the real cache stays shared via
# `org.gradle.caching`-independent symlinks, only gradle.properties differs.
PRIVATE_HOME="$(mktemp -d)"
cleanup() { rm -rf "$PRIVATE_HOME"; }
trap cleanup EXIT
chmod 700 "$PRIVATE_HOME"
mkdir -p "$BASE_GRADLE_HOME"
for entry in caches wrapper native daemon jdks; do
  mkdir -p "$BASE_GRADLE_HOME/$entry"
  ln -s "$BASE_GRADLE_HOME/$entry" "$PRIVATE_HOME/$entry"
done
(
  umask 077
  set -a
  # shellcheck disable=SC1090
  . "$SIGNING_ENV"
  set +a
  : "${RB_RELEASE_STORE_FILE:?}" "${RB_RELEASE_STORE_PASSWORD:?}" "${RB_RELEASE_KEY_ALIAS:?}" "${RB_RELEASE_KEY_PASSWORD:?}"
  [ -r "$RB_RELEASE_STORE_FILE" ] || { echo "keystore not readable: $RB_RELEASE_STORE_FILE" >&2; exit 1; }
  {
    echo "RB_RELEASE_STORE_FILE=$RB_RELEASE_STORE_FILE"
    echo "RB_RELEASE_STORE_PASSWORD=$RB_RELEASE_STORE_PASSWORD"
    echo "RB_RELEASE_KEY_ALIAS=$RB_RELEASE_KEY_ALIAS"
    echo "RB_RELEASE_KEY_PASSWORD=$RB_RELEASE_KEY_PASSWORD"
  } > "$PRIVATE_HOME/gradle.properties"
)

export GRADLE_USER_HOME="$PRIVATE_HOME"
if [ -n "$VERSION_CODE" ]; then export ANDROID_VERSION_CODE="$VERSION_CODE"; fi

# Fail closed if a debug-only switch leaks in from the caller's environment.
for var in EXPO_PUBLIC_DEBUG_TOKEN_LOGIN EXPO_PUBLIC_VERBOSE_LOGS; do
  if [ -n "${!var:-}" ]; then
    echo "$var is set; refusing to build a release APK" >&2
    exit 1
  fi
done

scripts/android-build.sh release "${BUILD_ARGS[@]}"

APK="android/app/build/outputs/apk/release/app-release.apk"
BUILD_TOOLS="$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)"
echo "==> release guard (no debug token login in the bundle)"
scripts/check-release-bundle.sh "$APK"

echo "==> apksigner verify"
"$BUILD_TOOLS/apksigner" verify --print-certs "$APK" | sed -n '1,6p'

BADGING="$("$BUILD_TOOLS/aapt2" dump badging "$APK")"
VERSION_NAME="$(sed -n "s/.*versionName='\([^']*\)'.*/\1/p" <<<"$BADGING" | head -1)"
ARCHS_ACTUAL="$(sed -n "s/^native-code: //p" <<<"$BADGING" | tr -d "'" | tr ' ' ',')"
NAME="multica-recordingbeats-${VERSION_NAME}"
[ "$ABI_SUFFIX" = 1 ] && NAME="${NAME}-${ARCHS_ACTUAL}"
NAME="${NAME}.apk"
mkdir -p "$OUT_DIR"
cp "$APK" "$OUT_DIR/$NAME"
( cd "$OUT_DIR" && sha256sum "$NAME" | tee "$NAME.sha256" )
echo "==> $OUT_DIR/$NAME"
