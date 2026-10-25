/**
 * Layout of the composer's chip row (mention and attachment chips above
 * the input) with 48 dp ✕ targets (F4).
 *
 * The ✕ glyph stays 16 dp inside its 28 dp capsule; a transparent 48 dp
 * box is laid over it (`touchTargetOverlay`). The chips sit in
 * a horizontal ScrollView, which clips its children, so the row gets
 * enough vertical padding to hold the whole box.
 */
import {
  MIN_TOUCH_TARGET,
  touchTargetOverlay,
  type TouchTargetOverlayStyle,
} from "@/lib/touch-target";

/** Capsule height (dp), the former `h-7`. */
export const CHIP_HEIGHT = 28;
/** ✕ glyph box (dp), `h-4 w-4`. */
export const CHIP_GLYPH = 16;
/** Capsule padding right of the glyph (dp), `px-2`. */
export const CHIP_PAD_X = 8;
/** Vertical padding of the row so a 48 dp box around the chip fits. */
export const CHIP_ROW_PAD_Y = (MIN_TOUCH_TARGET - CHIP_HEIGHT) / 2;

/** The ✕ box, absolutely placed in the capsule (its last child). */
export function chipRemoveTarget(): TouchTargetOverlayStyle {
  return touchTargetOverlay({
    glyphSize: CHIP_GLYPH,
    glyphTop: (CHIP_HEIGHT - CHIP_GLYPH) / 2,
    glyphRight: CHIP_PAD_X,
    maxReachUp: CHIP_ROW_PAD_Y + (CHIP_HEIGHT - CHIP_GLYPH) / 2,
  });
}
