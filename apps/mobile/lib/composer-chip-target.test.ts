import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHIP_HEIGHT,
  CHIP_ROW_PAD_Y,
  chipRemoveTarget,
} from "@/lib/composer-chip-target";

describe("composer chip ✕ target (F4)", () => {
  it("is 48 dp and centred on the 16 dp glyph", () => {
    const box = chipRemoveTarget();
    expect(box.width).toBe(48);
    expect(box.height).toBe(48);
    // Glyph at top 6 / right 8 in the 28 dp capsule.
    expect(box.top).toBe(6 - 16);
    expect(box.right).toBe(8 - 16);
  });

  it("fits inside the row, so the ScrollView does not clip it", () => {
    const box = chipRemoveTarget();
    expect(-box.top).toBeLessThanOrEqual(CHIP_ROW_PAD_Y);
    expect(box.top + box.height - CHIP_HEIGHT).toBeLessThanOrEqual(
      CHIP_ROW_PAD_Y,
    );
    expect(CHIP_ROW_PAD_Y * 2 + CHIP_HEIGHT).toBe(48);
  });

  it("mention and file chips use it instead of hitSlop", () => {
    const row = readFileSync(
      join(__dirname, "..", "components/issue/composer-attachment-row.tsx"),
      "utf8",
    );
    expect(row.match(/style=\{chipRemoveTarget\(\)\}/g)).toHaveLength(2);
    expect(row).not.toMatch(/hitSlop=\{8\}/);
    expect(row).toMatch(/paddingVertical: CHIP_ROW_PAD_Y/);
  });
});
