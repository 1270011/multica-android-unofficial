// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  ActionSheetIOS: { showActionSheetWithOptions: vi.fn() },
}));

import {
  registerActionSheetPresenter,
  showActionSheet,
  type ActionSheetRequest,
} from "./action-sheet";

const menu = { options: ["Pin", "Edit …", "Cancel"], cancelButtonIndex: 2 };

/** Stand-in for one mounted `ActionSheetHost`: records what it was asked to show. */
function mountHost() {
  const shown: ActionSheetRequest[] = [];
  const unmount = registerActionSheetPresenter((request) => shown.push(request));
  return { shown, unmount };
}

describe("showActionSheet presenter registration", () => {
  it("reports cancel when no host is mounted", () => {
    const callback = vi.fn();
    showActionSheet(menu, callback);
    expect(callback).toHaveBeenCalledWith(2);
  });

  it("presents through the mounted host and stops after unmount", () => {
    const host = mountHost();
    const callback = vi.fn();
    showActionSheet(menu, callback);
    expect(host.shown).toHaveLength(1);
    expect(host.shown[0].options).toBe(menu);
    expect(callback).not.toHaveBeenCalled();

    host.unmount();
    showActionSheet(menu, callback);
    expect(host.shown).toHaveLength(1);
    expect(callback).toHaveBeenCalledWith(2);
  });

  it("re-registers after unmount and mount (activity recreated)", () => {
    const first = mountHost();
    first.unmount();
    const second = mountHost();
    showActionSheet(menu, vi.fn());
    expect(first.shown).toHaveLength(0);
    expect(second.shown).toHaveLength(1);
    second.unmount();
  });

  it("keeps the new host when the old one unmounts after it mounted", () => {
    const old = mountHost();
    const fresh = mountHost();
    old.unmount();
    showActionSheet(menu, vi.fn());
    expect(old.shown).toHaveLength(0);
    expect(fresh.shown).toHaveLength(1);
    fresh.unmount();
  });

  it("survives two recreations in a row and double unmount calls", () => {
    const a = mountHost();
    const b = mountHost();
    const c = mountHost();
    b.unmount();
    a.unmount();
    a.unmount();
    showActionSheet(menu, vi.fn());
    expect(c.shown).toHaveLength(1);
    c.unmount();
    // The last host gone: back to "dismissed".
    const callback = vi.fn();
    showActionSheet(menu, callback);
    expect(callback).toHaveBeenCalledWith(2);
  });

  it("falls back to the previous host when the newest unmounts first", () => {
    const a = mountHost();
    const b = mountHost();
    b.unmount();
    showActionSheet(menu, vi.fn());
    expect(a.shown).toHaveLength(1);
    a.unmount();
  });
});
