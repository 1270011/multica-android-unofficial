/**
 * Expo config plugin: mark Activity recreation so JS can restore the route.
 *
 * A system font-size or display-size change makes Android recreate
 * MainActivity; React Native restarts its JS context and the app came back
 * on the Inbox with the open issue gone. Keeping the
 * Activity alive via `android:configChanges="fontScale|density"` was tried
 * first, but React Native 0.83 then paints text at the new size without
 * re-measuring it (clipped chips and titles — Fabric's relayout keys on
 * `DisplayMetrics.scaledDensity`, which no longer carries the font scale
 * since Android 14, and a forced `requestLayout()` did not help either).
 *
 * So the Activity is allowed to restart and the navigation state is carried
 * over instead: on a recreation Android hands `onCreate` a non-null
 * `savedInstanceState`; the injected code writes a marker file into
 * `filesDir`, and `lib/route-restore.ts` consumes it on the next JS start
 * and jumps back to the route it keeps saving while the app runs.
 *
 * `injectMarker` is exported for the unit test
 * (lib/android-restore-route-plugin.test.ts).
 */
const { withMainActivity } = require("expo/config-plugins");

const MARKER_FILE = "restore-route-marker";
const BEGIN = "// restore-route: activity recreated → restore route";
const END = "// restore-route: end";

const KOTLIN = `    ${BEGIN} (plugins/with-android-restore-route.js)
    if (savedInstanceState != null) {
      try { java.io.File(filesDir, "${MARKER_FILE}").writeText("1") } catch (_: Exception) {}
    }
    ${END}
`;

/** Inserts (or refreshes) the marker block right before `super.onCreate`. */
function injectMarker(contents) {
  const begin = contents.indexOf(BEGIN);
  if (begin >= 0) {
    const endIdx = contents.indexOf(END, begin);
    if (endIdx < 0) throw new Error("MainActivity.kt: restore-route block without end marker");
    const lineStart = contents.lastIndexOf("\n", begin) + 1;
    const lineEnd = contents.indexOf("\n", endIdx) + 1;
    contents = contents.slice(0, lineStart) + contents.slice(lineEnd);
  }
  const anchor = contents.search(/^[ \t]*super\.onCreate\(/m);
  if (anchor < 0) throw new Error("MainActivity.kt: super.onCreate(...) not found");
  return contents.slice(0, anchor) + KOTLIN + contents.slice(anchor);
}

function withAndroidRestoreRoute(config) {
  return withMainActivity(config, (c) => {
    if (c.modResults.language !== "kt") {
      throw new Error("with-android-restore-route expects a Kotlin MainActivity");
    }
    c.modResults.contents = injectMarker(c.modResults.contents);
    return c;
  });
}

module.exports = withAndroidRestoreRoute;
module.exports.injectMarker = injectMarker;
module.exports.MARKER_FILE = MARKER_FILE;
