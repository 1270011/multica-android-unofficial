/**
 * Expo config plugin: ship the JS bundle inside *debug* APKs too.
 *
 * React Native's Gradle plugin skips bundling for "debuggable variants" and
 * expects a Metro dev server on the developer's machine. The CI debug APK is
 * meant to be installed on a phone without Metro, so we clear
 * `debuggableVariants` — the debug build then bundles (dev-mode) JS and
 * assets like a release build while keeping the dev menu and debuggable flag.
 *
 * Local development with Metro still works: `expo start` + "Reload" loads
 * from the dev server when one is reachable.
 */
const { withAppBuildGradle } = require("expo/config-plugins");

const NEEDLE = '    // debuggableVariants = ["liteDebug", "prodDebug"]\n';
const REPLACEMENT =
  '    // rb: bundle JS into debug builds so the CI APK runs without Metro.\n' +
  "    debuggableVariants = []\n";

function withBundledDebugJs(config) {
  return withAppBuildGradle(config, (c) => {
    const contents = c.modResults.contents;
    if (contents.includes("debuggableVariants = []")) return c;
    if (!contents.includes(NEEDLE)) {
      throw new Error("with-bundled-debug-js: debuggableVariants comment not found in app/build.gradle");
    }
    c.modResults.contents = contents.replace(NEEDLE, REPLACEMENT);
    return c;
  });
}

module.exports = withBundledDebugJs;
