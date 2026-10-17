/**
 * Guards docs/technik/ping-rule-vectors.json — the binding spec of the
 * notification ping rule. The production rule lives in
 * the native notification service (Kotlin) and must run every vector; this
 * test keeps the file well-formed and self-consistent by evaluating it against
 * a reference implementation of the documented rule. Change both together.
 */
import { describe, expect, it } from "vitest";
import vectorsFile from "../../../docs/technik/ping-rule-vectors.json";

type Category = "blocked" | "mentions" | "approvals" | "failed_runs" | "assignments";

interface Item {
  type: string;
  severity: string;
  details: Record<string, string> | null;
  read: boolean;
  archived: boolean;
}

interface Settings {
  enabled?: boolean;
  disabledCategories?: string[];
  quietHours?: { start: string; end: string };
}

interface Expect {
  ping: boolean;
  category: string | null;
  channel: string | null;
}

interface Vector {
  id: string;
  item: Item;
  settings?: Settings;
  localTime?: string;
  expect: Expect;
}

const CATEGORY_CHANNEL: Record<Category, string> = {
  blocked: "operator_blocked",
  mentions: "operator_mentions",
  approvals: "operator_approvals",
  failed_runs: "operator_blocked",
  assignments: "operator_assignments",
};

function categoryOf(item: Item): Category | null {
  switch (item.type) {
    case "mentioned":
      return "mentions";
    case "task_failed":
      return "failed_runs";
    case "issue_assigned":
      return "assignments";
    case "agent_blocked":
      return "blocked";
    case "review_requested":
      return "approvals";
    case "status_changed":
      if (item.details?.to === "blocked") return "blocked";
      if (item.details?.to === "in_review") return "approvals";
      return null;
    default:
      return null;
  }
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function inQuietHours(quiet: Settings["quietHours"], localTime: string | undefined): boolean {
  if (!quiet || !localTime) return false;
  const now = minutes(localTime);
  const start = minutes(quiet.start);
  const end = minutes(quiet.end);
  return start <= end ? now >= start && now < end : now >= start || now < end;
}

function referenceRule(v: Vector): Expect {
  const none: Expect = { ping: false, category: null, channel: null };
  if (v.item.read || v.item.archived) return none;
  if (v.settings?.enabled === false) return none;
  const category = categoryOf(v.item);
  if (!category) return none;
  if (v.settings?.disabledCategories?.includes(category)) return none;
  const channel = inQuietHours(v.settings?.quietHours, v.localTime)
    ? "operator_quiet"
    : CATEGORY_CHANNEL[category];
  return { ping: true, category, channel };
}

const file = vectorsFile as unknown as {
  version: number;
  categories: string[];
  channels: string[];
  vectors: Vector[];
};

describe("ping-rule vectors (docs/technik/ping-rule-vectors.json)", () => {
  it("has unique ids and only known categories/channels", () => {
    const ids = file.vectors.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(file.categories.sort()).toEqual(Object.keys(CATEGORY_CHANNEL).sort());
    for (const v of file.vectors) {
      if (v.expect.ping) {
        expect(file.categories).toContain(v.expect.category);
        expect(file.channels).toContain(v.expect.channel);
      } else {
        expect(v.expect.category).toBeNull();
        expect(v.expect.channel).toBeNull();
      }
      for (const c of v.settings?.disabledCategories ?? []) {
        expect(file.categories).toContain(c);
      }
    }
  });

  it("covers every category and the quiet channel", () => {
    const pinged = file.vectors.filter((v) => v.expect.ping);
    for (const c of file.categories) {
      expect(pinged.some((v) => v.expect.category === c)).toBe(true);
    }
    expect(pinged.some((v) => v.expect.channel === "operator_quiet")).toBe(true);
    expect(file.vectors.some((v) => !v.expect.ping)).toBe(true);
  });

  it.each(file.vectors.map((v): [string, Vector] => [v.id, v]))("%s", (_id: string, v: Vector) => {
    expect(referenceRule(v)).toEqual(v.expect);
  });
});
