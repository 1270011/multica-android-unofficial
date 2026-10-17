/**
 * Route shell for the debug-only token sign-in. The screen module is
 * required inside a block guarded by the inlined build-time variable, so
 * Metro drops the block — and with it the module and its expo-file-system
 * dependency — from release bundles. See lib/debug-token-login.ts.
 */
import { Redirect } from "expo-router";

export default function TokenLoginRoute() {
  if (process.env.EXPO_PUBLIC_DEBUG_TOKEN_LOGIN === "1") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TokenLoginScreen } = require("@/components/auth/token-login-screen") as
      typeof import("@/components/auth/token-login-screen");
    return <TokenLoginScreen />;
  }
  return <Redirect href="/login" />;
}
