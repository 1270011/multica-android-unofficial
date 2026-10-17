/**
 * Expo config plugin: drop exported components the app does not use.
 *
 * expo-clipboard declares `expo.modules.clipboard.ClipboardFileProvider`
 * with `android:exported="true"` so other apps can read images the app put
 * on the clipboard. Multica only copies and pastes text (setStringAsync /
 * getStringAsync), so the provider is unused attack surface. A
 * `tools:node="remove"` entry in the app manifest removes it at merge time.
 *
 * SYSTEM_ALERT_WINDOW from the Expo template is removed through
 * `android.blockedPermissions` in app.config.ts, not here.
 */
const { withAndroidManifest } = require("expo/config-plugins");

const CLIPBOARD_PROVIDER = "expo.modules.clipboard.ClipboardFileProvider";

/** Pure manifest edit (tested in lib/manifest-hardening-plugin.test.ts). */
function removeClipboardProvider(androidManifest) {
  const manifest = androidManifest.manifest;
  manifest.$ = manifest.$ ?? {};
  manifest.$["xmlns:tools"] = manifest.$["xmlns:tools"] ?? "http://schemas.android.com/tools";
  const app = manifest.application?.[0];
  if (!app) return androidManifest;
  const providers = (app.provider ?? []).filter((p) => p.$?.["android:name"] !== CLIPBOARD_PROVIDER);
  providers.push({
    $: {
      "android:name": CLIPBOARD_PROVIDER,
      // The library entry carries authorities; tools:node="remove" matches by name.
      "tools:node": "remove",
    },
  });
  app.provider = providers;
  return androidManifest;
}

function withAndroidManifestHardening(config) {
  return withAndroidManifest(config, (c) => {
    c.modResults = removeClipboardProvider(c.modResults);
    return c;
  });
}

module.exports = withAndroidManifestHardening;
module.exports.removeClipboardProvider = removeClipboardProvider;
module.exports.CLIPBOARD_PROVIDER = CLIPBOARD_PROVIDER;
