/**
 * Expo config plugin for the operator-notification module.
 *
 * The module's own AndroidManifest brings permissions, the service and the
 * receivers (merged by Gradle). What has to change in the app manifest is
 * the Auto Backup configuration: expo-secure-store points
 * `fullBackupContent` / `dataExtractionRules` at its own XML files, which do
 * not know the notification prefs. This plugin points both attributes at the
 * module's rule files, which keep the SecureStore exclusion and add ours.
 * Order-independent: expo-secure-store leaves foreign rules in place.
 *
 * `applyBackupRules` is exported for lib/rb-notify-plugin.test.ts.
 */
const { withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

const BACKUP = "@xml/rb_notify_backup_rules";
const EXTRACTION = "@xml/rb_notify_data_extraction_rules";

function applyBackupRules(manifest) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  app.$["android:fullBackupContent"] = BACKUP;
  app.$["android:dataExtractionRules"] = EXTRACTION;
  return manifest;
}

function withRbNotify(config) {
  return withAndroidManifest(config, (c) => {
    c.modResults = applyBackupRules(c.modResults);
    return c;
  });
}

module.exports = withRbNotify;
module.exports.applyBackupRules = applyBackupRules;
module.exports.BACKUP = BACKUP;
module.exports.EXTRACTION = EXTRACTION;
