// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { modalPresentation } from "./modal-presentation";

describe("modalPresentation (J3b, header in the status bar)", () => {
  it("Android uses a card from the bottom, which gets the status bar inset", () => {
    expect(modalPresentation("android")).toEqual({ presentation: "card", animation: "slide_from_bottom" });
  });
  it("iOS keeps the native modal", () => {
    expect(modalPresentation("ios")).toEqual({ presentation: "modal" });
  });
  it("no workspace route sets presentation: \"modal\" directly any more", () => {
    const layout = readFileSync(join(__dirname, "../app/(app)/[workspace]/_layout.tsx"), "utf8");
    expect(layout).not.toMatch(/presentation:\s*"modal"/);
    expect(layout.match(/\.\.\.MODAL_PRESENTATION/g)?.length).toBe(5);
  });
});
