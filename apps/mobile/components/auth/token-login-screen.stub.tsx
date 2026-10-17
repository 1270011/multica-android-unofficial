/**
 * Inert replacement for token-login-screen.tsx in builds without
 * EXPO_PUBLIC_DEBUG_TOKEN_LOGIN=1 (see metro.config.js). Keeps the route
 * module compiling while guaranteeing no token UI, file access or
 * expo-file-system code ends up in release bundles.
 */
import { Redirect } from "expo-router";

export function TokenLoginScreen() {
  return <Redirect href="/login" />;
}
