import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { injectMarker, MARKER_FILE } = require("../plugins/with-android-restore-route.js") as {
  injectMarker: (contents: string) => string;
  MARKER_FILE: string;
};

const activity = `class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme);
    super.onCreate(null)
  }
}
`;

describe("injectMarker", () => {
  it("writes the marker file when Android recreates the activity", () => {
    const out = injectMarker(activity);
    expect(out).toContain(`"${MARKER_FILE}"`);
    expect(out.indexOf("savedInstanceState != null")).toBeLessThan(out.indexOf("super.onCreate(null)"));
    expect(out.indexOf("setTheme")).toBeLessThan(out.indexOf("savedInstanceState != null"));
  });

  it("is idempotent across repeated prebuilds (android/ is kept between builds)", () => {
    const once = injectMarker(activity);
    expect(injectMarker(once)).toBe(once);
    expect(once.match(/savedInstanceState != null/g)).toHaveLength(1);
  });

  it("fails loudly when the anchor is missing", () => {
    expect(() => injectMarker("class MainActivity {}")).toThrow(/super.onCreate/);
  });
});
