// Metro bundler configuration for the mobile app inside the multica monorepo.
// Watches the entire monorepo so type-only imports from packages/core/types/*
// resolve, looks up node_modules from both project and monorepo root, and
// enables symlinks so Metro can follow pnpm's symlinked layout to transitive
// deps. Hierarchical lookup is left enabled (default) — pnpm needs it.

const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];
config.resolver.unstable_enableSymlinks = true;

// --- Android: debug-only token sign-in (lib/debug-token-login.ts) ---
// Two independent guards so the screen can never leak into a release bundle:
//  1. The screen module resolves to an inert stub unless the debug build
//     variable is set. Resolution is not shared between modes (different
//     files), so a Metro transform cache populated by a debug build cannot
//     hand the real module to a release build.
//  2. A mode-specific cacheVersion keeps transformed modules (where
//     `process.env.EXPO_PUBLIC_DEBUG_TOKEN_LOGIN` is inlined) apart as well.
const tokenLoginEnabled = process.env.EXPO_PUBLIC_DEBUG_TOKEN_LOGIN === "1";
const verboseLogs = process.env.EXPO_PUBLIC_VERBOSE_LOGS === "1";
config.cacheVersion = `${config.cacheVersion ?? "1"}-token-login-${tokenLoginEnabled ? "on" : "off"}-verbose-${verboseLogs ? "on" : "off"}`;
const TOKEN_LOGIN_SCREEN = path.resolve(projectRoot, "components/auth/token-login-screen.tsx");
const TOKEN_LOGIN_STUB = path.resolve(projectRoot, "components/auth/token-login-screen.stub.tsx");
const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolved = upstreamResolveRequest
    ? upstreamResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
  if (
    !tokenLoginEnabled &&
    resolved?.type === "sourceFile" &&
    resolved.filePath === TOKEN_LOGIN_SCREEN
  ) {
    return { type: "sourceFile", filePath: TOKEN_LOGIN_STUB };
  }
  return resolved;
};

module.exports = withNativeWind(config, { input: "./global.css", inlineRem: 16 });
