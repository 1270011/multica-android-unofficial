import { defineConfig } from "vitest/config";
import path from "node:path";

// Mobile vitest is intentionally minimal — Node environment only, scoped to
// pure-function helpers in `lib/` and headless data-layer logic in `data/`
// (query-key + cache-patch functions that take a QueryClient but touch no
// DOM / RN native modules). We don't ship jsdom or RN test renderers here
// because the app runs on Hermes / native shims and any DOM-shaped runner
// would be a lie. Tests that need RN component rendering would need a
// separate jest+react-native-testing-library track; for now we keep this
// lane for helpers, serializers, and cache updaters only. Data-layer tests
// must mock `@/data/api` so the native fetch chain never loads.
//
// Co-located test files (foo.ts + foo.test.ts) match how the rest of the
// monorepo organises vitest suites.
export default defineConfig({
  // React Native global; lib/debug-token-login.ts reads it at module load.
  define: { __DEV__: "true" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["lib/**/*.test.ts", "data/**/*.test.ts"],
    passWithNoTests: true,
    // Used by `vitest run --coverage`:
    // every lib/ and data/ file counts, also those no test imports yet.
    coverage: {
      provider: "v8",
      include: ["lib/**/*.{ts,tsx}", "data/**/*.{ts,tsx}"],
      exclude: ["**/*.test.ts"],
      reporter: ["json-summary", "text-summary"],
      reportsDirectory: "reports/coverage/unit",
      reportOnFailure: true,
    },
  },
});
