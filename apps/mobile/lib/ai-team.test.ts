// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// lib/breakpoints imports react-native for its hook; only the constants are used.
vi.mock("react-native", () => ({ useWindowDimensions: () => ({ width: 0, height: 0 }) }));
import navDe from "@/locales/de/navigation.json";
import navEn from "@/locales/en/navigation.json";
import navZh from "@/locales/zh-Hans/navigation.json";
import {
  aiTeamEntries,
  autopilotsHref,
  autopilotsTabFromParam,
  featureState,
  masterDetailLayout,
  MASTER_PANE_DP,
  segmentsAsDropdown,
} from "./ai-team";

describe("autopilotsTabFromParam (deep link ?tab=)", () => {
  it("opens the Wakeups segment from ?tab=wakeups", () => {
    expect(autopilotsTabFromParam("wakeups")).toBe("wakeups");
    expect(autopilotsTabFromParam(["wakeups", "autopilots"])).toBe("wakeups");
  });
  it("falls back to Autopilots for missing or unknown values", () => {
    for (const v of [undefined, "", "Wakeups", "runs", []]) {
      expect(autopilotsTabFromParam(v as string | string[] | undefined)).toBe("autopilots");
    }
    expect(autopilotsTabFromParam("autopilots")).toBe("autopilots");
  });
  it("builds links that parse back to the same segment", () => {
    expect(autopilotsHref("rb")).toBe("/rb/autopilots");
    expect(autopilotsHref("rb", "wakeups")).toBe("/rb/autopilots?tab=wakeups");
    const query = new URL(`multica://x${autopilotsHref("rb", "wakeups")}`).searchParams.get("tab");
    expect(autopilotsTabFromParam(query ?? undefined)).toBe("wakeups");
  });
});

describe("segmentsAsDropdown (200 % font)", () => {
  it("keeps pills at normal and slightly larger font", () => {
    expect(segmentsAsDropdown(1)).toBe(false);
    expect(segmentsAsDropdown(1.3)).toBe(false);
  });
  it("switches to a dropdown at large font", () => {
    expect(segmentsAsDropdown(1.5)).toBe(true);
    expect(segmentsAsDropdown(2)).toBe(true);
  });
});

describe("featureState (feature gate)", () => {
  it("is available once the probe succeeded", () => {
    expect(featureState({ isSuccess: true, error: null })).toBe("available");
  });
  it("is missing only on 404 and 501", () => {
    expect(featureState({ isSuccess: false, error: { status: 404 } })).toBe("missing");
    expect(featureState({ isSuccess: false, error: { status: 501 } })).toBe("missing");
  });
  it("stays unknown while loading, offline or on other errors", () => {
    expect(featureState({ isSuccess: false, error: null })).toBe("unknown");
    expect(featureState({ isSuccess: false, error: new Error("network") })).toBe("unknown");
    for (const status of [0, 401, 403, 500, 503]) {
      expect(featureState({ isSuccess: false, error: { status } })).toBe("unknown");
    }
  });
});

describe("aiTeamEntries (More → AI Team)", () => {
  const keys = (g: Parameters<typeof aiTeamEntries>[0]) => aiTeamEntries(g).map((e) => e.key);
  it("lists Agents, Autopilots and Runtimes in this order", () => {
    expect(aiTeamEntries({ autopilots: "available", runtimes: "available" })).toEqual([
      { key: "agents", path: "/more/agents" },
      { key: "autopilots", path: "/autopilots" },
      { key: "runtimes", path: "/runtimes" },
    ]);
  });
  it("keeps entries while the gate is unknown", () => {
    expect(keys({ autopilots: "unknown", runtimes: "unknown" })).toEqual(["agents", "autopilots", "runtimes"]);
  });
  it("hides an entry the server answers with 404", () => {
    expect(keys({ autopilots: "missing", runtimes: "available" })).toEqual(["agents", "runtimes"]);
    expect(keys({ autopilots: "available", runtimes: "missing" })).toEqual(["agents", "autopilots"]);
    expect(keys({ autopilots: "missing", runtimes: "missing" })).toEqual(["agents"]);
  });
});

describe("masterDetailLayout (tablet)", () => {
  it("stacks below 600 dp", () => {
    expect(masterDetailLayout(360)).toEqual({ split: false, listWidth: null });
    expect(masterDetailLayout(599)).toEqual({ split: false, listWidth: null });
  });
  it("splits from 600 dp with a 360 dp list", () => {
    expect(masterDetailLayout(600)).toEqual({ split: true, listWidth: MASTER_PANE_DP });
    expect(masterDetailLayout(1280).listWidth).toBe(360);
  });
});

describe("AI Team strings", () => {
  const MENU = ["ai_team", "agents", "autopilots", "runtimes"];
  const ROUTES = ["autopilots", "runtimes"];
  const PAGE = [
    "segment_label",
    "segment_hint",
    "tab_autopilots",
    "tab_wakeups",
    "autopilots_title",
    "autopilots_placeholder",
    "wakeups_title",
    "wakeups_placeholder",
    "runtimes_title",
    "runtimes_placeholder",
    "feature_missing",
    "detail_empty_title",
    "detail_empty_body",
  ];
  for (const [lang, file] of Object.entries({ de: navDe, en: navEn, "zh-Hans": navZh })) {
    it(`${lang} has every key`, () => {
      const f = file as unknown as Record<string, Record<string, string>>;
      for (const k of MENU) expect(f.more_menu?.[k], `${lang}:more_menu.${k}`).toBeTruthy();
      for (const k of ROUTES) expect(f.routes?.[k], `${lang}:routes.${k}`).toBeTruthy();
      for (const k of PAGE) expect(f.ai_team?.[k], `${lang}:ai_team.${k}`).toBeTruthy();
    });
  }
});
