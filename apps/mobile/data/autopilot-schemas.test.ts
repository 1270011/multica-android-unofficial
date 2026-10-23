import { describe, expect, it, vi } from "vitest";

import {
  AutopilotDetailSchema,
  AutopilotListSchema,
  AutopilotRunSchema,
  AutopilotSchema,
  autopilotRunStatusOf,
  type MobileAutopilotTrigger,
} from "./autopilot-schemas";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), log: vi.fn(), error: vi.fn() } }));

const base = { id: "ap-1", title: "T", status: "active", execution_mode: "create_issue" };

describe("AutopilotSchema", () => {
  it("unknown status, mode and trigger kinds degrade to unknown and keep the raw text", () => {
    const a = AutopilotSchema.parse({
      ...base,
      status: "sleeping",
      execution_mode: "dry_run",
      assignee_type: "team",
      trigger_kinds: ["schedule", "github", 7, "api"],
    });
    expect(a).toMatchObject({
      status: "unknown",
      raw_status: "sleeping",
      execution_mode: "unknown",
      assignee_type: "unknown",
      trigger_kinds: ["schedule", "unknown", "api"],
      raw_trigger_kinds: ["schedule", "github", "api"],
    });
  });

  it("older servers: no assignee_type → agent, no derived list fields → defaults", () => {
    const a = AutopilotSchema.parse({ ...base, pause_reason: "" });
    expect(a).toMatchObject({
      assignee_type: "agent",
      trigger_kinds: [],
      raw_trigger_kinds: [],
      next_run_at: null,
      last_run_status: null,
      pause_reason: null,
      subscribers: [],
    });
    expect(a.can_write).toBeUndefined();
  });

  it("a missing status is unknown, never active", () => {
    const { status: _s, ...noStatus } = base;
    expect(AutopilotSchema.parse(noStatus)).toMatchObject({ status: "unknown", raw_status: "" });
  });

  it("keeps the system pause reason and additive fields", () => {
    const a = AutopilotSchema.parse({ ...base, status: "paused", pause_reason: "runtime_offline", extra: 1 });
    expect(a).toMatchObject({ status: "paused", pause_reason: "runtime_offline", extra: 1 });
  });

  it("list without autopilots array fails (→ endpoint fallback)", () => {
    expect(AutopilotListSchema.safeParse({ total: 1 }).success).toBe(false);
  });
});

describe("AutopilotRunSchema", () => {
  it.each(["issue_created", "running", "completed", "failed", "skipped"] as const)(
    "recognizes %s",
    (status) => {
      expect(AutopilotRunSchema.parse({ id: "r", status, source: "schedule" }).status).toBe(status);
    },
  );

  it("skipped is its own status, not success or failure", () => {
    expect(autopilotRunStatusOf("skipped")).toBe("skipped");
  });

  it("unknown or missing status/source → unknown with raw text, never success", () => {
    expect(AutopilotRunSchema.parse({ id: "r", status: "queued", source: "slack" })).toMatchObject({
      status: "unknown",
      raw_status: "queued",
      source: "unknown",
      raw_source: "slack",
    });
    const bare = AutopilotRunSchema.parse({ id: "r" });
    expect(bare).toMatchObject({ status: "unknown", raw_status: "", trigger_payload: null, result: null });
    expect(bare.reason_code).toBeUndefined();
  });
});

describe("AutopilotDetailSchema", () => {
  it("drops webhook token, path and URL from triggers", () => {
    const d = AutopilotDetailSchema.parse({
      autopilot: base,
      triggers: [
        {
          id: "t-1",
          kind: "webhook",
          webhook_token: "secret",
          webhook_path: "/api/webhooks/autopilots/secret",
          webhook_url: "https://x/api/webhooks/autopilots/secret",
        },
        { id: "t-2", kind: "email" },
        { kind: "api" },
      ],
    });
    expect(d.triggers.map((t) => t.id)).toEqual(["t-1", "t-2"]);
    const t = d.triggers[0] as MobileAutopilotTrigger & Record<string, unknown>;
    expect(t.kind).toBe("webhook");
    expect(JSON.stringify(d)).not.toContain("secret");
    expect(d.triggers[1]).toMatchObject({ kind: "unknown", raw_kind: "email" });
    expect(d.collaborators).toEqual([]);
  });

  it("a detail without a usable autopilot fails (→ null fallback)", () => {
    expect(AutopilotDetailSchema.safeParse({ autopilot: { title: "x" }, triggers: [] }).success).toBe(false);
  });
});
