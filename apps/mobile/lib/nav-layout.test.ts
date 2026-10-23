// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// breakpoints.ts imports useWindowDimensions; keep React Native out.
vi.mock("react-native", () => ({ useWindowDimensions: vi.fn() }));

import { NAV_RAIL_MIN_DP } from "./breakpoints";
import { moreMenuPlacement, NAV_RAIL_WIDTH, navModeFor, TAB_BAR_HEIGHT } from "./nav-layout";

describe("navModeFor", () => {
  it("keeps the bottom tabs on phones", () => {
    expect(navModeFor(360)).toBe("tabs");
    expect(navModeFor(599.9)).toBe("tabs");
  });

  it("switches to the rail from 600 dp", () => {
    expect(NAV_RAIL_MIN_DP).toBe(600);
    expect(navModeFor(600)).toBe("rail");
    expect(navModeFor(800)).toBe("rail");
    expect(navModeFor(1280)).toBe("rail");
  });
});

describe("moreMenuPlacement", () => {
  const insets = { top: 24, bottom: 16, left: 0 };

  it("opens above the More tab in tab mode", () => {
    expect(moreMenuPlacement("tabs", insets)).toEqual({
      anchor: { position: "absolute", right: 0, bottom: 16, width: "25%", height: TAB_BAR_HEIGHT },
      side: "top",
      align: "end",
    });
  });

  it("opens beside the rail in rail mode, inside the safe area", () => {
    expect(moreMenuPlacement("rail", { ...insets, left: 32 })).toEqual({
      anchor: { position: "absolute", left: NAV_RAIL_WIDTH + 32, top: 24, width: 1, height: 1 },
      side: "bottom",
      align: "start",
    });
  });
});
