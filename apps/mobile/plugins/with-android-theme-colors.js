/**
 * Expo config plugin: brand accent for system dialogs.
 *
 * The Android date dialog (`DateTimePickerAndroid`) and other AppCompat
 * dialogs take their header / selection colour from the activity theme's
 * `colorAccent`, which Expo's template leaves at AppCompat's default teal.
 * This writes the app's brand blue (THEME.light.brand, hsl(225 71% 58%))
 * into `res/values/colors.xml` and points `AppTheme` at it. Light/dark is
 * still handled by the DayNight parent theme, so the dialog follows the
 * app's colour scheme as far as Android allows.
 */
const { AndroidConfig, withAndroidColors, withAndroidStyles } = require("expo/config-plugins");

const BRAND_ACCENT = "#486ee0";

function withAndroidThemeColors(config) {
  config = withAndroidColors(config, (c) => {
    c.modResults = AndroidConfig.Colors.assignColorValue(c.modResults, {
      name: "colorAccent",
      value: BRAND_ACCENT,
    });
    return c;
  });
  config = withAndroidStyles(config, (c) => {
    c.modResults = AndroidConfig.Styles.assignStylesValue(c.modResults, {
      add: true,
      name: "colorAccent",
      value: "@color/colorAccent",
      parent: AndroidConfig.Styles.getAppThemeGroup(),
    });
    return c;
  });
  return config;
}

module.exports = withAndroidThemeColors;
module.exports.BRAND_ACCENT = BRAND_ACCENT;
