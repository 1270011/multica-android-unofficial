import { describe, expect, it, vi } from "vitest";

vi.mock("@/data/api", () => ({ api: {} }));

import { buildActorMap } from "./actors";
import { inboxViewFromParam } from "@/lib/inbox-view-param";

// report 1: a ping from the other workspace showed "Multica".
describe("buildActorMap", () => {
  it("knows members and agents of every workspace", () => {
    const map = buildActorMap([
      { members: [{ user_id: "u1", name: "Admin" }], agents: [{ id: "a1", name: "planner" }] },
      { members: [{ user_id: "u2", name: "Tester" }], agents: [{ id: "a2", name: "reviewer" }] },
    ]);
    expect(map).toEqual({ u1: "Admin", a1: "planner", u2: "Tester", a2: "reviewer" });
  });

  it("keeps the first name (open workspace first) and skips gaps", () => {
    const map = buildActorMap([
      { members: [{ user_id: "u1", name: "Name here" }], agents: [] },
      undefined,
      { members: [{ user_id: "u1", name: "Name there" }, { user_id: "", name: "x" }], agents: [{ id: "a9", name: "" }] },
    ]);
    expect(map).toEqual({ u1: "Name here" });
  });
});

// Report 4: the summary opens the Inbox, segment "Unread".
describe("inboxViewFromParam", () => {
  it("takes known segments only", () => {
    expect(inboxViewFromParam("unread")).toBe("unread");
    expect(inboxViewFromParam(["archived"])).toBe("archived");
    expect(inboxViewFromParam("bogus")).toBeNull();
    expect(inboxViewFromParam(undefined)).toBeNull();
  });
});
