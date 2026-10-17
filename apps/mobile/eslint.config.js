// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // App code logs only through lib/logger.ts, which redacts secrets and
    // drops verbose output from release bundles.
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "data/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    ignores: ["**/*.test.ts", "lib/logger.ts"],
    rules: {
      "no-console": "error",
    },
  },
]);
