import { describe, expect, it } from "vitest";
import type { Agent, AgentTask, RuntimeDevice } from "@multica/core/types";
import { RuntimeListSchema } from "@/data/schemas";
import {
  buildRuntimeMachineGroups,
  filterRuntimeMachineGroups,
  partitionLongOffline,
  runtimeProblemSummary,
  runtimeQueue,
} from "./runtime-machines";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function rt(id: string, overrides: Partial<RuntimeDevice> = {}): RuntimeDevice {
  return {
    id,
    daemon_id: null,
    name: id,
    custom_name: null,
    runtime_mode: "local",
    provider: "claude",
    status: "online",
    last_seen_at: ago(0),
    device_info: "",
    owner_id: "u-admin",
    profile_id: null,
    ...overrides,
  } as RuntimeDevice;
}

const agent = (id: string, runtime_id: string, archived_at: string | null = null) =>
  ({ id, runtime_id, archived_at, max_concurrent_tasks: 6 }) as Agent;

const task = (agent_id: string, status: string, ageMs = 0) =>
  ({ id: `${agent_id}-${status}-${ageMs}`, agent_id, runtime_id: "", status, created_at: ago(ageMs) }) as AgentTask;

const build = (runtimes: RuntimeDevice[], agents: Agent[] = [], snapshot: AgentTask[] = []) =>
  buildRuntimeMachineGroups({ runtimes, agents, snapshot, now: NOW });

describe("buildRuntimeMachineGroups — grouping by machine", () => {
  it("groups runtimes of one daemon into one machine, providers sorted", () => {
    const groups = build([
      rt("r-codex", { daemon_id: "d-a", provider: "codex", name: "Codex (build-host-1)" }),
      rt("r-claude", { daemon_id: "d-a", provider: "claude", name: "Claude (build-host-1)" }),
      rt("r-b", { daemon_id: "d-b", name: "Claude (build-host-2)" }),
    ]);
    expect(groups).toHaveLength(2);
    const box = groups.find((g) => g.id === "local:d-a")!;
    expect(box.title).toBe("build-host-1");
    expect(box.runtimes.map((r) => r.runtime.id)).toEqual(["r-claude", "r-codex"]);
    expect(box.runtimes.map((r) => r.label)).toEqual(["Claude", "Codex"]);
  });

  it("without daemon id falls back to device name, then to the runtime itself", () => {
    const groups = build([
      rt("a", { device_info: "box-a · Linux" }),
      rt("b", { device_info: "box-a · Linux", provider: "codex" }),
      rt("c"),
    ]);
    expect(groups.map((g) => g.id).sort()).toEqual(["local:device:box-a", "local:runtime:c"]);
  });

  it("a machine-wide custom_name becomes the title; a one-off rename stays on its row", () => {
    const [shared] = build([
      rt("a", { daemon_id: "d", custom_name: "Devbox" }),
      rt("b", { daemon_id: "d", custom_name: "Devbox", provider: "codex" }),
    ]);
    expect(shared!.title).toBe("Devbox");
    const [mixed] = build([
      rt("a", { daemon_id: "d", name: "Claude (host)", custom_name: "Spezial" }),
      rt("b", { daemon_id: "d", name: "Codex (host)", provider: "codex" }),
    ]);
    expect(mixed!.title).toBe("host");
    expect(mixed!.runtimes.map((r) => r.label)).toEqual(["Spezial", "Codex"]);
  });

  it("counts agents and running/waiting tasks per runtime via the agent binding", () => {
    const [g] = build(
      [rt("r1", { daemon_id: "d" })],
      [agent("pm", "r1"), agent("tl", "r1"), agent("old", "r1", "2026-10-01T00:00:00Z")],
      [
        task("pm", "running"),
        task("pm", "queued"),
        task("tl", "waiting_local_directory"),
        task("tl", "completed"),
        task("old", "queued"),
        task("ghost", "queued"),
      ],
    );
    expect(g!.runtimes[0]).toMatchObject({ agentCount: 2, runningCount: 1, queuedCount: 2, hasProblem: false });
    expect(g).toMatchObject({ runningCount: 1, queuedCount: 2 });
  });

  it("machine health: online if any runtime is online, else the worst bucket", () => {
    const [mixed] = build([
      rt("a", { daemon_id: "d" }),
      rt("b", { daemon_id: "d", status: "offline", last_seen_at: ago(DAY), provider: "codex" }),
    ]);
    expect(mixed!.health).toBe("online");
    const [down] = build([
      rt("a", { daemon_id: "d", status: "offline", last_seen_at: ago(MIN) }),
      rt("b", { daemon_id: "d", status: "offline", last_seen_at: ago(7 * DAY), provider: "codex" }),
    ]);
    expect(down!.health).toBe("long_offline");
    expect(down!.lastSeenAt).toBe(ago(MIN));
  });

  it("health boundaries: < 5 min instabil, 5 min offline, > 6 days long offline", () => {
    const groups = build([
      rt("a", { status: "offline", last_seen_at: ago(5 * MIN - 1) }),
      rt("b", { status: "offline", last_seen_at: ago(5 * MIN) }),
      rt("c", { status: "offline", last_seen_at: ago(6 * DAY) }),
      rt("d", { status: "offline", last_seen_at: ago(6 * DAY + 1) }),
    ]);
    const byId = Object.fromEntries(groups.map((g) => [g.runtimes[0]!.runtime.id, g.health]));
    expect(byId).toEqual({ a: "recently_lost", b: "offline", c: "offline", d: "long_offline" });
  });

  it("sorts problem machines first, then online, then offline, alphabetical inside", () => {
    const groups = build(
      [
        rt("off-b", { name: "Claude (b-off)", status: "offline", last_seen_at: ago(DAY) }),
        rt("on-z", { name: "Claude (z-on)" }),
        rt("off-a", { name: "Claude (a-off)", status: "offline", last_seen_at: ago(DAY) }),
        rt("on-c", { name: "Claude (c-on)" }),
        rt("prob", { name: "Claude (y-problem)", status: "offline", last_seen_at: ago(2 * 60 * MIN) }),
      ],
      [agent("pm", "prob")],
      [task("pm", "queued")],
    );
    expect(groups.map((g) => g.title)).toEqual(["y-problem", "c-on", "z-on", "a-off", "b-off"]);
    expect(groups[0]!.hasProblem).toBe(true);
  });

  it("survives malformed rows after schema parsing", () => {
    const parsed = RuntimeListSchema.parse([
      { id: "x", status: "zombie", last_seen_at: "garbage", custom_name: 42, profile_id: {} },
      { id: "y", status: "online" },
    ]);
    const groups = build(parsed, [agent("pm", "x")], [task("pm", "weird" as never)]);
    expect(groups).toHaveLength(2);
    const x = groups.flatMap((g) => g.runtimes).find((r) => r.runtime.id === "x")!;
    expect(x.health).toBe("offline");
    expect(x.isCustomProfile).toBe(false);
  });
});

describe("partition, banner, filter, queue", () => {
  const runtimes = [
    rt("on", { daemon_id: "d-on", name: "Claude (on)", owner_id: "u-me" }),
    rt("gone", { daemon_id: "d-gone", name: "Claude (gone)", status: "offline", last_seen_at: ago(10 * DAY) }),
    rt("gone-busy", {
      daemon_id: "d-gb",
      name: "Claude (gone-busy)",
      status: "offline",
      last_seen_at: ago(10 * DAY),
      profile_id: "prof-1",
    }),
  ];
  const agents = [agent("pm", "gone-busy"), agent("tl", "on")];
  const snapshot = [task("pm", "queued", 5 * MIN), task("pm", "deferred", 9 * MIN), task("pm", "running")];
  const groups = build(runtimes, agents, snapshot);

  it("collapses long-offline machines unless something waits on them", () => {
    const { visible, longOffline } = partitionLongOffline(groups);
    expect(visible.map((g) => g.title)).toEqual(["gone-busy", "on"]);
    expect(longOffline.map((g) => g.title)).toEqual(["gone"]);
  });

  it("problem banner counts affected runtimes and points to the first one", () => {
    expect(runtimeProblemSummary(groups)).toEqual({ runtimeCount: 1, taskCount: 2, firstRuntimeId: "gone-busy" });
    expect(runtimeProblemSummary(build([rt("ok")]))).toBeNull();
  });

  it("filters Meine by owner and searches title / provider", () => {
    expect(filterRuntimeMachineGroups(groups, { scope: "mine", userId: "u-me", query: "" }).map((g) => g.title)).toEqual(["on"]);
    expect(filterRuntimeMachineGroups(groups, { scope: "mine", userId: null, query: "" })).toEqual([]);
    expect(filterRuntimeMachineGroups(groups, { scope: "all", userId: null, query: "BUSY" }).map((g) => g.title)).toEqual(["gone-busy"]);
  });

  it("marks custom-profile runtimes", () => {
    expect(groups[0]!.runtimes[0]!.isCustomProfile).toBe(true);
  });

  it("queue lists waiting tasks oldest first, no deferred/running/terminal", () => {
    expect(runtimeQueue("gone-busy", agents, snapshot).map((t) => t.status)).toEqual(["queued"]);
    expect(runtimeQueue("on", agents, snapshot)).toEqual([]);
  });

  it("row counter and queue list count the same tasks for every status", () => {
    const statuses = [
      "queued",
      "dispatched",
      "waiting_local_directory",
      "deferred",
      "running",
      "completed",
      "failed",
      "cancelled",
    ];
    const mixed = statuses.flatMap((s, i) => [task("pm", s, i * MIN), task("tl", s, i * MIN)]);
    const archived = [...agents, agent("old", "on", ago(DAY))];
    const all = [...mixed, task("old", "queued")];
    for (const g of build(runtimes, archived, all)) {
      for (const r of g.runtimes) {
        expect(r.queuedCount).toBe(runtimeQueue(r.runtime.id, archived, all).length);
      }
    }
    expect(groups.find((g) => g.title === "gone-busy")!.queuedCount).toBe(1);
  });
});
