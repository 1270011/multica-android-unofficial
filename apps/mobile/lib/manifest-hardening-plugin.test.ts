// @vitest-environment node
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
type Manifest = {
  manifest: {
    $: Record<string, string>;
    application: { $: Record<string, string>; provider?: { $: Record<string, string> }[] }[];
  };
};
const { removeClipboardProvider, CLIPBOARD_PROVIDER } = require("../plugins/with-android-manifest-hardening.js") as {
  removeClipboardProvider: (m: Manifest) => Manifest;
  CLIPBOARD_PROVIDER: string;
};

describe("with-android-manifest-hardening (security review N5)", () => {
  const base = (): Manifest => ({
    manifest: {
      $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
      application: [{ $: { "android:name": ".MainApplication" }, provider: [{ $: { "android:name": "other.Provider" } }] }],
    },
  });

  it("adds a tools:node=remove entry for expo-clipboard's provider", () => {
    const out = removeClipboardProvider(base());
    expect(out.manifest.$["xmlns:tools"]).toBe("http://schemas.android.com/tools");
    const entry = out.manifest.application[0]!.provider!.find((p) => p.$["android:name"] === CLIPBOARD_PROVIDER);
    expect(entry?.$["tools:node"]).toBe("remove");
    expect(out.manifest.application[0]!.provider!.some((p) => p.$["android:name"] === "other.Provider")).toBe(true);
  });

  it("is idempotent across prebuilds (no duplicate entries)", () => {
    const out = removeClipboardProvider(removeClipboardProvider(base()));
    expect(out.manifest.application[0]!.provider!.filter((p) => p.$["android:name"] === CLIPBOARD_PROVIDER)).toHaveLength(1);
  });

  it("app.config blocks SYSTEM_ALERT_WINDOW and loads the plugin (N6)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const cfg = readFileSync(join(__dirname, "../app.config.ts"), "utf8");
    expect(cfg).toContain('"android.permission.SYSTEM_ALERT_WINDOW"');
    expect(cfg).toContain('"./plugins/with-android-manifest-hardening"');
  });
});
