import { describe, expect, it } from "vitest";
import { MIN_TOUCH_TARGET, touchTargetOverlay } from "./touch-target";

// Reply-chip ✕: 16 dp glyph, chip padding px-3 / py-1.5.
const glyph = { glyphSize: 16, glyphTop: 6, glyphRight: 12 };

describe("touchTargetOverlay", () => {
  it("lays a 48 dp box centred over a 16 dp glyph", () => {
    const s = touchTargetOverlay(glyph);
    expect(s.position).toBe("absolute");
    expect(s.width).toBe(MIN_TOUCH_TARGET);
    expect(s.height).toBe(MIN_TOUCH_TARGET);
    expect(s.top).toBe(6 - 16);
    // Horizontal centre of the box == centre of the glyph (12 + 8 dp).
    expect(s.right + s.width / 2).toBe(20);
  });

  it("caps the reach above the glyph and still covers it", () => {
    const s = touchTargetOverlay({ ...glyph, maxReachUp: 14 });
    expect(s.height).toBe(48);
    expect(s.top).toBe(-8);
    // Glyph (6..22) lies inside the box (-8..40).
    expect(s.top).toBeLessThanOrEqual(6);
    expect(s.top + s.height).toBeGreaterThanOrEqual(22);
  });

  it("never shrinks a glyph larger than the target", () => {
    const s = touchTargetOverlay({ glyphSize: 56, glyphTop: 0, glyphRight: 0 });
    expect(s.width).toBe(56);
    expect(s.top).toBe(0);
    expect(s.right).toBe(0);
  });
});
