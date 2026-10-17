/**
 * Debug-only "sign in with an access token".
 *
 * Testers sign in with a personal access token instead of
 * the e-mail code. The gate is the build-time variable
 * `EXPO_PUBLIC_DEBUG_TOKEN_LOGIN`, which only `scripts/android-build.sh
 * debug` sets. Expo's Babel preset inlines `process.env.EXPO_PUBLIC_*` as a
 * literal in EVERY module that reads it, and Metro folds the resulting
 * `if ("1" === "1")` / `if (undefined === "1")` before collecting
 * dependencies — so each gate must spell out the `process.env` comparison
 * itself (an imported constant is a runtime value and would not fold).
 * In release bundles the guarded blocks, the screen module and its
 * expo-file-system usage are therefore absent, not merely disabled.
 *
 * `__DEV__` is deliberately not part of the gate: the Android debug
 * APK bundles its JS with dev=false (plugins/with-bundled-debug-js.js), so
 * `__DEV__` is false there too.
 *
 * metro.config.js adds two more guards: the screen module resolves to
 * components/auth/token-login-screen.stub.tsx when the variable is unset,
 * and the Metro cacheVersion differs per mode, so a transform cache filled
 * by a debug build can never feed a release build (this was observed:
 * without them the folded-away module still reached the release bundle
 * through the shared cache).
 *
 * Proof lives in docs/ANDROID.md ("Debug-Token-Login"): the marker strings
 * (`debug-token.txt`, the screen title) are grepped out of the release
 * bundle and must be absent.
 *
 * The token is never logged, never echoed into an alert and never written
 * anywhere except the same SecureStore slot the e-mail login uses.
 */
export const DEBUG_TOKEN_LOGIN_ENABLED: boolean =
  process.env.EXPO_PUBLIC_DEBUG_TOKEN_LOGIN === "1";

/** File name (in the app's private documents directory) a tester can push
 *  the token into with `adb` so it never has to be typed or pasted. */
export const DEBUG_TOKEN_FILE_NAME = "debug-token.txt";

/** First non-empty line of the file, whitespace trimmed; null when empty. */
export function tokenFromFileText(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/** Cheap sanity check before hitting the server: PATs are opaque strings
 *  but never contain whitespace or control characters. */
export function looksLikeToken(value: string): boolean {
  const v = value.trim();
  return v.length >= 16 && !/[\s\u0000-\u001f]/.test(v);
}
