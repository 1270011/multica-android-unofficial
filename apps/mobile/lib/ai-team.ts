/**
 * "AI Team" navigation: the More group with Agents, Autopilots and Runtimes, the
 * Autopilots | Wakeups segment and the server feature gate. Pure functions,
 * the screens and the More popover read these.
 */
import { SELECTOR_FONT_SCALE } from "@/lib/board";
import { COMPACT_MAX_DP } from "@/lib/breakpoints";

// --- Autopilots page segment (`/<ws>/autopilots?tab=wakeups`) ---

export type AutopilotsTab = "autopilots" | "wakeups";

export const AUTOPILOTS_TABS: readonly AutopilotsTab[] = ["autopilots", "wakeups"];
export const DEFAULT_AUTOPILOTS_TAB: AutopilotsTab = "autopilots";

/** Segment from the `tab` query; anything unknown opens the default. */
export function autopilotsTabFromParam(value: string | string[] | undefined): AutopilotsTab {
  const v = Array.isArray(value) ? value[0] : value;
  return v && (AUTOPILOTS_TABS as readonly string[]).includes(v)
    ? (v as AutopilotsTab)
    : DEFAULT_AUTOPILOTS_TAB;
}

/** Link to the Autopilots page; the default segment needs no query. */
export function autopilotsHref(slug: string, tab: AutopilotsTab = DEFAULT_AUTOPILOTS_TAB): string {
  return tab === DEFAULT_AUTOPILOTS_TAB ? `/${slug}/autopilots` : `/${slug}/autopilots?tab=${tab}`;
}

/**
 * At 200 % font the pills no longer fit side by side; from the same scale
 * as the board's column selector they become one dropdown.
 */
export function segmentsAsDropdown(fontScale: number): boolean {
  return fontScale >= SELECTOR_FONT_SCALE;
}

// --- Feature gate (§0.2: server reports the function as missing) ---

export type FeatureState = "available" | "missing" | "unknown";

/**
 * Only a 404/501 from the server means "this server has no such feature".
 * While loading, offline or on other errors the entry stays visible, so a
 * flaky network never hides navigation.
 */
export function featureState(probe: {
  isSuccess: boolean;
  error: unknown;
}): FeatureState {
  if (probe.isSuccess) return "available";
  const status = (probe.error as { status?: unknown } | null | undefined)?.status;
  if (status === 404 || status === 501) return "missing";
  return "unknown";
}

// --- More menu group ---

export type AiTeamEntryKey = "agents" | "autopilots" | "runtimes";

export interface AiTeamEntry {
  key: AiTeamEntryKey;
  /** Path under /:slug/ — final href is `/${slug}${path}`. */
  path: string;
}

const AI_TEAM_ENTRIES: readonly AiTeamEntry[] = [
  { key: "agents", path: "/more/agents" },
  { key: "autopilots", path: "/autopilots" },
  { key: "runtimes", path: "/runtimes" },
];

/** Entries of the "AI Team" group; features the server lacks are left out. */
export function aiTeamEntries(gates: {
  autopilots: FeatureState;
  runtimes: FeatureState;
}): AiTeamEntry[] {
  return AI_TEAM_ENTRIES.filter((e) => e.key === "agents" || gates[e.key] !== "missing");
}

// --- Tablet master-detail frame ---

/** Width of the list pane next to the detail. */
export const MASTER_PANE_DP = 360;

export interface MasterDetailLayout {
  split: boolean;
  listWidth: number | null;
}

/** From 600 dp list left (360 dp) and detail right; below that a stack. */
export function masterDetailLayout(widthDp: number): MasterDetailLayout {
  return widthDp >= COMPACT_MAX_DP
    ? { split: true, listWidth: MASTER_PANE_DP }
    : { split: false, listWidth: null };
}
