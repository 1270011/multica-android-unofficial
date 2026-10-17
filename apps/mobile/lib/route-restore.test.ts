import { describe, expect, it, vi } from "vitest";

vi.mock("expo-file-system", () => ({ File: class {}, Paths: { document: "/doc" } }));

import { openRestoredRoute, resolveRestorePath, restoreTarget } from "./route-restore";

describe("resolveRestorePath", () => {
  it("restores workspace routes", () => {
    expect(resolveRestorePath("/acme/issue/abc")).toBe("/acme/issue/abc");
    expect(resolveRestorePath("/acme/more/settings")).toBe("/acme/more/settings");
  });
  it("leaves auth, setup and root routes to their own redirects", () => {
    for (const p of ["/", "/login", "/verify", "/server-setup", "/token-login", "/select-workspace", null, undefined, ""]) {
      expect(resolveRestorePath(p)).toBeNull();
    }
  });
});

describe("restore navigation (M4 back stack)", () => {
  it("restores only routes of the current workspace", () => {
    expect(restoreTarget("/rb/issue/abc", "rb")).toBe("/rb/issue/abc");
    expect(restoreTarget("/other/issue/abc", "rb")).toBeNull();
    expect(restoreTarget("/rbx/issue/abc", "rb")).toBeNull();
    expect(restoreTarget(null, "rb")).toBeNull();
    expect(restoreTarget("/rb/issue/abc", null)).toBeNull();
  });

  const nav = () => {
    const calls: string[] = [];
    const pending: (() => void)[] = [];
    return {
      calls,
      pending,
      nav: { replace: (h: string) => calls.push(`replace ${h}`), push: (h: string) => calls.push(`push ${h}`) },
      schedule: (run: () => void) => pending.push(run),
    };
  };

  it("builds the back stack explicitly: Inbox tab, then the restored screen", () => {
    const n = nav();
    expect(openRestoredRoute(n.nav, "/rb/issue/abc", "rb", n.schedule)).toBe(true);
    expect(n.calls).toEqual(["replace /rb/inbox"]);
    n.pending.forEach((run) => run());
    expect(n.calls).toEqual(["replace /rb/inbox", "push /rb/issue/abc"]);
  });

  it("a restored tab root needs no extra screen", () => {
    for (const tab of ["/rb/inbox", "/rb/my-issues", "/rb/more"]) {
      const n = nav();
      openRestoredRoute(n.nav, tab, "rb", n.schedule);
      expect(n.calls).toEqual([`replace ${tab}`]);
      expect(n.pending).toHaveLength(0);
    }
    const deep = nav();
    openRestoredRoute(deep.nav, "/rb/more/settings", "rb", deep.schedule);
    deep.pending.forEach((run) => run());
    expect(deep.calls).toEqual(["replace /rb/inbox", "push /rb/more/settings"]);
  });

  it("does nothing without a matching route", () => {
    const n = nav();
    expect(openRestoredRoute(n.nav, "/other/issue/abc", "rb", n.schedule)).toBe(false);
    expect(openRestoredRoute(n.nav, null, "rb", n.schedule)).toBe(false);
    expect(n.calls).toEqual([]);
  });
});
