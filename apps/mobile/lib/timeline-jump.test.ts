// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  NEAR_TOP_RATIO,
  RETURN_WITHIN_SCREENS,
  computeJumpVisibility,
  jumpFollowShouldPin,
} from "./timeline-jump";

const VIEWPORT = 800;

describe("computeJumpVisibility", () => {
  it("pins the upstream thresholds this behavior depends on", () => {
    expect(RETURN_WITHIN_SCREENS).toBe(0.5);
    expect(NEAR_TOP_RATIO).toBe(0.2);
  });

  it("never shows on a timeline that fits the viewport", () => {
    expect(computeJumpVisibility(false, { offset: 0, contentH: VIEWPORT, viewportH: VIEWPORT }, false)).toEqual({
      away: false,
      visible: false,
    });
    // Content taller than the viewport but within the one-screen threshold.
    expect(computeJumpVisibility(false, { offset: 0, contentH: 1500, viewportH: VIEWPORT }, false)).toEqual({
      away: false,
      visible: false,
    });
  });

  it("shows right away on a fresh open at the top of a long thread", () => {
    // The bottom is more than a screen away and the reader is at the top.
    expect(computeJumpVisibility(false, { offset: 0, contentH: 4000, viewportH: VIEWPORT }, false)).toEqual({
      away: true,
      visible: true,
    });
    // Same while the tail is still unrendered (estimated content height),
    // even though the computed distance would be small.
    expect(computeJumpVisibility(false, { offset: 0, contentH: 900, viewportH: VIEWPORT }, true)).toEqual({
      away: true,
      visible: true,
    });
  });

  it("keeps the button until the reader is back within half a screen (hysteresis)", () => {
    // Just over one screen below the bottom: becomes away from a clean state.
    expect(computeJumpVisibility(false, { offset: 0, contentH: 1601, viewportH: VIEWPORT }, false).away).toBe(true);
    // Already away and still 600px from the bottom: stays away.
    expect(computeJumpVisibility(true, { offset: 600, contentH: 2000, viewportH: VIEWPORT }, false)).toEqual({
      away: true,
      visible: false,
    });
    // Back within half a screen: clears.
    expect(computeJumpVisibility(true, { offset: 1700, contentH: 2000, viewportH: VIEWPORT }, false)).toEqual({
      away: false,
      visible: false,
    });
  });

  it("hides once the reader has scrolled past the near-top band", () => {
    // offset exactly at 20% of the page: still visible.
    expect(computeJumpVisibility(false, { offset: 1000, contentH: 5000, viewportH: VIEWPORT }, false)).toEqual({
      away: true,
      visible: true,
    });
    // One px past the band: hidden even though the bottom is far away.
    expect(computeJumpVisibility(false, { offset: 1001, contentH: 5000, viewportH: VIEWPORT }, false)).toEqual({
      away: true,
      visible: false,
    });
  });

  it("stays hidden while metrics have not been measured yet", () => {
    expect(computeJumpVisibility(false, { offset: 0, contentH: 0, viewportH: 0 }, true)).toEqual({
      away: false,
      visible: false,
    });
  });

  it("stays hidden when the content has not loaded", () => {
    expect(computeJumpVisibility(false, { offset: 0, contentH: 0, viewportH: VIEWPORT }, false)).toEqual({
      away: false,
      visible: false,
    });
  });
});

describe("jumpFollowShouldPin", () => {
  it("does not pin while the jump travel is still moving", () => {
    const metrics = { offset: 100, contentH: 5000, viewportH: VIEWPORT };
    expect(jumpFollowShouldPin(metrics, 10_000, 10_050)).toBe(false);
  });

  it("pins once settled and short of the bottom", () => {
    const metrics = { offset: 100, contentH: 5000, viewportH: VIEWPORT };
    expect(jumpFollowShouldPin(metrics, 10_000, 10_130)).toBe(true);
  });

  it("does not pin when the bottom is already reached", () => {
    const metrics = { offset: 1000, contentH: 1804, viewportH: VIEWPORT };
    expect(jumpFollowShouldPin(metrics, 10_000, 10_130)).toBe(false);
  });

  it("does not pin before the viewport is measured", () => {
    const metrics = { offset: 0, contentH: 5000, viewportH: 0 };
    expect(jumpFollowShouldPin(metrics, 0, 100_000)).toBe(false);
  });
});
