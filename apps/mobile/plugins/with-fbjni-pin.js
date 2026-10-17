/**
 * Expo config plugin: pin com.facebook.fbjni:fbjni to the version React
 * Native ships with.
 *
 * `react-native-shiki-engine` declares `implementation "com.facebook.fbjni:fbjni:+"`,
 * so Gradle's conflict resolution upgrades fbjni to the newest release
 * (0.8.1 at the time of writing). That artifact is built against a newer
 * libc++ than the NDK React Native 0.83 prescribes (27.1); the packaged
 * libc++_shared.so then lacks `__cxa_init_primary_exception` and the app
 * dies on start with `SoLoaderDSONotFoundError: couldn't find DSO to load:
 * libfbjni.so` (dlopen: cannot locate symbol). Forcing the version that
 * react-android / hermes-android request keeps all native libs on one
 * libc++.
 *
 * Re-check `FBJNI_VERSION` on every React Native upgrade: it must match
 * the fbjni version in the react-android POM of the new RN release.
 */
const { withAppBuildGradle } = require("expo/config-plugins");

const FBJNI_VERSION = "0.7.0";
const MARKER = "// rb-fbjni-pin";

const BLOCK = `
${MARKER}: react-native-shiki-engine requests fbjni:+; pin to the version
// React Native ${FBJNI_VERSION === "0.7.0" ? "0.83" : "?"} ships, see plugins/with-fbjni-pin.js.
configurations.all {
    resolutionStrategy.force "com.facebook.fbjni:fbjni:${FBJNI_VERSION}"
}
`;

function withFbjniPin(config) {
  return withAppBuildGradle(config, (c) => {
    if (!c.modResults.contents.includes(MARKER)) {
      c.modResults.contents += BLOCK;
    }
    return c;
  });
}

module.exports = withFbjniPin;
