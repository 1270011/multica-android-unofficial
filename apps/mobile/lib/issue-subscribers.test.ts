// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { IssueSubscriber } from "@multica/core/types";
import { subscriberRows } from "./issue-subscribers";

const sub = (user_type: "member" | "agent", user_id: string): IssueSubscriber =>
  ({ issue_id: "i", user_type, user_id, reason: "manual", created_at: "" }) as IssueSubscriber;
const names: Record<string, string> = { me: "Zoe", a: "Ana", b: "Ben", bot: "Agent X" };

describe("subscriberRows", () => {
  it("me first, then members, then agents, by name", () => {
    const rows = subscriberRows([sub("agent", "bot"), sub("member", "b"), sub("member", "me"), sub("member", "a")], "me", (_t, id) => names[id] ?? id);
    expect(rows.map((r) => r.name)).toEqual(["Zoe", "Ana", "Ben", "Agent X"]);
    expect(rows[0]?.isMe).toBe(true);
  });
});
