/**
 * Expo config plugin: release signing from Gradle properties.
 *
 * The generated `android/app/build.gradle` signs *release* builds with the
 * debug keystore. This plugin adds a `release` signing config that is used
 * whenever the build is given these Gradle properties (via `-P` or
 * `~/.gradle/gradle.properties`, never committed):
 *
 *   RB_RELEASE_STORE_FILE      absolute path to the .jks / .keystore
 *   RB_RELEASE_STORE_PASSWORD
 *   RB_RELEASE_KEY_ALIAS
 *   RB_RELEASE_KEY_PASSWORD
 *
 * Without them the template behaviour (debug signing) is unchanged, so CI
 * debug builds and local `assembleRelease` smoke tests keep working.
 * `scripts/build-release.sh` is the only caller that sets them.
 */
const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER = "// rb-release-signing";

const SIGNING_BLOCK = `    signingConfigs {
        ${MARKER}
        release {
            if (project.hasProperty('RB_RELEASE_STORE_FILE')) {
                storeFile file(RB_RELEASE_STORE_FILE)
                storePassword RB_RELEASE_STORE_PASSWORD
                keyAlias RB_RELEASE_KEY_ALIAS
                keyPassword RB_RELEASE_KEY_PASSWORD
            }
        }
`;

function patch(contents) {
  // `expo prebuild` without --clean re-runs mods on the existing file, so
  // both steps must be idempotent: add the signing config once, and wire
  // the release buildType only if it still points at the debug key.
  let out = contents;
  if (!out.includes(MARKER)) {
    if (!out.includes("    signingConfigs {\n")) {
      throw new Error("with-release-signing: signingConfigs block not found in app/build.gradle");
    }
    out = out.replace("    signingConfigs {\n", SIGNING_BLOCK);
  }
  // Only the release buildType's line; the debug buildType keeps its own.
  // Search inside `buildTypes { ... }` — the signingConfigs block above
  // also contains a `release {` and must not be matched.
  const buildTypesIdx = out.indexOf("    buildTypes {");
  if (buildTypesIdx < 0) {
    throw new Error("with-release-signing: buildTypes block not found in app/build.gradle");
  }
  const releaseTypeIdx = out.indexOf("        release {", buildTypesIdx);
  if (releaseTypeIdx < 0) {
    throw new Error("with-release-signing: release buildType not found in app/build.gradle");
  }
  const before = out.slice(0, releaseTypeIdx);
  const after = out
    .slice(releaseTypeIdx)
    .replace(
      /signingConfig signingConfigs\.debug(?=\n)/,
      "signingConfig project.hasProperty('RB_RELEASE_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
    );
  out = before + after;
  return out;
}

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (c) => {
    if (c.modResults.language !== "groovy") {
      throw new Error("with-release-signing: only Groovy build.gradle is supported");
    }
    c.modResults.contents = patch(c.modResults.contents);
    return c;
  });
}

module.exports = withReleaseSigning;
