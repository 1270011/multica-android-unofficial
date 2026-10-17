import type { ExpoConfig, ConfigContext } from "expo/config";

/**
 * Dynamic Expo config — replaces app.json so we can read APP_ENV at runtime
 * and switch bundleIdentifier / display name for dev / staging / production.
 *
 * APP_ENV is set by package.json scripts:
 *   - dev          → APP_ENV unset (treated as "development")
 *   - dev:staging  → APP_ENV=staging
 *   - dev:prod     → APP_ENV=production (rare; usually only for EAS build)
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const env = process.env.APP_ENV ?? "development";
  const isProd = env === "production";
  const isStaging = env === "staging";

  return {
    ...config,
    name: isProd
      ? "Multica"
      : isStaging
        ? "Multica (Staging)"
        : "Multica (Dev)",
    slug: "multica-mobile",
    // Android build: versionName tracks the upstream Multica version the
    // app is built against plus a release suffix. Release builds set
    // ANDROID_VERSION_NAME (e.g. "0.6.1-rb3") and ANDROID_VERSION_CODE;
    // Android refuses to update an
    // installed app to a lower or equal versionCode. Without the variables
    // (dev builds) the upstream version is used.
    version: process.env.ANDROID_VERSION_NAME || "0.6.1",
    // Portrait and landscape. MainActivity keeps
    // orientation|screenSize in configChanges, so turning the phone does not
    // recreate it; layouts react through lib/breakpoints.ts.
    orientation: "default",
    userInterfaceStyle: "automatic",
    scheme: "multica",
    // 1024x1024 full-bleed, no-alpha source that belongs to mobile alone. Do
    // not point this back at the desktop icon (apps/desktop/build/icon.png):
    // that one is padded for macOS, and iOS would mask it a second time, which
    // is the white ring from #6995. Expo prebuild generates every required iOS
    // icon size from this single PNG.
    icon: "./assets/icon.png",
    ios: {
      // All orientations on iPhone and iPad (top-level `orientation`).
      supportsTablet: true,
      // Pins DEVELOPMENT_TEAM on every prebuild. Leaving it unset is the normal
      // path — `expo run:ios` then resolves a signing identity from the Keychain
      // itself, which is right when the Apple ID owns exactly one team. With
      // several (a personal team plus an employer's) it takes the *first*
      // identity found whenever the terminal is non-interactive, writes that
      // choice into the generated ios/, and never clears it again: prebuild only
      // writes DEVELOPMENT_TEAM when a value is present, so a project pinned to
      // the wrong team stays wrong until ios/ is deleted. Setting this re-applies
      // the intended team on every `scripts/ios-run.sh` run, which also repairs
      // an already-mispinned checkout.
      appleTeamId: process.env.EXPO_APPLE_TEAM_ID,
      // Per-variant bundle id overrides exist for one reason: an Apple ID
      // can only sign bundle prefixes it owns, so contributors not on the
      // Multica Apple Developer team (and external users self-building a
      // personal copy against production) need to swap to a reverse-domain
      // they control. Each variant has its own `_<VARIANT>` suffix and is
      // only read inside that variant's branch — a generic
      // `EXPO_BUNDLE_IDENTIFIER` would leak across variants (Expo CLI
      // auto-loads `.env.<mode>.local` regardless of APP_ENV) and collapse
      // dev / staging / prod onto a single id.
      bundleIdentifier: isProd
        ? (process.env.EXPO_BUNDLE_IDENTIFIER_PROD ?? "ai.multica.mobile")
        : isStaging
          ? "ai.multica.mobile.staging"
          : (process.env.EXPO_BUNDLE_IDENTIFIER_DEV ?? "ai.multica.mobile.dev"),
    },
    android: {
      // One package id for every variant: the Android build ships a
      // single sideloaded APK, so there is no dev/staging/prod side-by-side
      // install to keep apart (that is what the iOS suffixes above do).
      package: "com.recordingbeats.multica",
      versionCode: Number.parseInt(process.env.ANDROID_VERSION_CODE ?? "1", 10),
      adaptiveIcon: {
        foregroundImage: "./assets/icon.png",
        backgroundColor: "#ffffff",
      },
      // Keep the keyboard pushing content up on Android — the screens use
      // KeyboardAvoidingView without a behaviour on Android and rely on the
      // window resizing instead (react-native-keyboard-controller handles
      // the composer cases).
      softwareKeyboardLayoutMode: "resize",
      // No camera / storage permissions: expo-image-picker uses the system
      // Photo Picker, documents go through the system document picker.
      blockedPermissions: [
        "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        // expo-screen-capture (FLAG_SECURE on the secret screens,
        // S6) declares READ_MEDIA_IMAGES for its screenshot listener, which
        // we do not use. DETECT_SCREEN_CAPTURE must stay: the module
        // registers its observer when it loads, and without the (install-
        // time, no-prompt) permission Android 14+ throws at app start.
        "android.permission.READ_MEDIA_IMAGES",
        // From the Expo template, not used (security review N6, S-2).
        "android.permission.SYSTEM_ALERT_WINDOW",
      ],
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      "@react-native-community/datetimepicker",
      "react-native-enriched-markdown",
      [
        "expo-image-picker",
        {
          // iOS NSPhotoLibraryUsageDescription. Without this string in
          // Info.plist, calling launchImageLibraryAsync hard-crashes on
          // iOS 14+. Camera + microphone are disabled — we only ever read
          // from the existing photo library.
          photosPermission:
            "Allow Multica to access your photos to attach images to issues and comments.",
          cameraPermission: false,
          microphonePermission: false,
        },
      ],
      [
        "expo-build-properties",
        {
          ios: {
            buildReactNativeFromSource: true,
          },
        },
      ],
      // Android: trust user-installed CAs (Local / VPN mode against a
      // self-hosted server with a private CA) and sign release builds from Gradle
      // properties supplied by scripts/build-release.sh.
      "./plugins/with-android-network-security",
      "./plugins/with-release-signing",
      "./plugins/with-bundled-debug-js",
      "./plugins/with-fbjni-pin",
      // Return to the open route after Android recreates the
      // activity (font-size / display-size change, M4) and give system
      // dialogs the brand accent (N1).
      "./plugins/with-android-restore-route",
      "./plugins/with-android-theme-colors",
      // Operator notifications (modules/rb-notify) — backup rules
      // that exclude the notification state (T3).
      "./plugins/with-rb-notify",
      // Removes expo-clipboard's exported ClipboardFileProvider (N5, S-2).
      "./plugins/with-android-manifest-hardening",
    ],
    extra: { APP_ENV: env },
  };
};
