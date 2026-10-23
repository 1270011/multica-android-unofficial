/**
 * "Mir zugewiesen" coupling with the server group:
 * switching the category on while `assignments` is muted sends a PATCH that
 * turns the group back on.
 */
import { describe, expect, it, vi } from "vitest";
import { deriveNotificationPreferencePatch } from "@multica/core/notification-preferences/patch";
import { COUPLED_CATEGORIES, applyCategoryToggle, toggleCategory } from "./push-logic";
import { DEFAULT_SETTINGS, NOTIFY_CATEGORIES } from "./native";

const off = { ...DEFAULT_SETTINGS, disabledCategories: ["assignments" as const] };

describe("assignments coupling", () => {
  it("lists Mir zugewiesen first", () => {
    expect(NOTIFY_CATEGORIES).toEqual(["assignments", "mentions", "blocked", "approvals", "failed_runs"]);
    expect(COUPLED_CATEGORIES).toEqual(["assignments"]);
  });

  it("switch on with muted group → PATCH {assignments: all}", () => {
    const update = vi.fn();
    const patchServer = vi.fn();
    const prefs = { assignments: "muted" as const, comments: "muted" as const };
    applyCategoryToggle({ settings: off, category: "assignments", on: true, serverPrefs: prefs }, { update, patchServer });
    expect(update).toHaveBeenCalledWith({ ...off, disabledCategories: [] });
    expect(patchServer).toHaveBeenCalledTimes(1);
    const sent = patchServer.mock.calls[0]![0];
    // Other muted groups stay muted; the wire patch only touches assignments.
    expect(sent).toEqual({ comments: "muted" });
    expect(deriveNotificationPreferencePatch(prefs, sent)).toEqual({ assignments: "all" });
  });

  it("no PATCH when the group is on, when switching off, or for other categories", () => {
    for (const [category, on, prefs] of [
      ["assignments", true, {}],
      ["assignments", true, undefined],
      ["assignments", false, { assignments: "muted" }],
      ["mentions", true, { mentions: "muted" }],
    ] as const) {
      const patchServer = vi.fn();
      const update = vi.fn();
      applyCategoryToggle({ settings: off, category, on, serverPrefs: prefs }, { update, patchServer });
      expect(update).toHaveBeenCalledTimes(1);
      expect(patchServer).not.toHaveBeenCalled();
    }
  });

  it("switching off only touches the device", () => {
    const r = toggleCategory(DEFAULT_SETTINGS, "assignments", false, { assignments: "muted" });
    expect(r.settings.disabledCategories).toEqual(["assignments"]);
    expect(r.serverPrefs).toBeNull();
  });
});
