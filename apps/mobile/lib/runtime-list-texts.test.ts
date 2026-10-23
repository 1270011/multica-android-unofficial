// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import type { Agent, AgentTask, RuntimeDevice } from "@multica/core/types";
import { i18n } from "./i18n/singleton";
import { buildRuntimeMachineGroups, runtimeProblemSummary } from "./runtime-machines";
import {
  runtimeHealthText,
  runtimeProblemBannerText,
  runtimeRowA11yLabel,
  runtimeRowText,
} from "./runtime-list-texts";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const MIN = 60_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const rt = (id: string, o: Partial<RuntimeDevice> = {}) =>
  ({
    id,
    daemon_id: `d-${id}`,
    name: `claude (${id})`,
    custom_name: null,
    runtime_mode: "local",
    provider: "claude",
    status: "online",
    last_seen_at: ago(0),
    device_info: "",
    owner_id: "u",
    profile_id: null,
    ...o,
  }) as RuntimeDevice;
const agent = (id: string, runtime_id: string) =>
  ({ id, runtime_id, archived_at: null, max_concurrent_tasks: 6 }) as Agent;
const task = (agent_id: string, status: string, n: number) =>
  ({ id: `${agent_id}-${status}-${n}`, agent_id, runtime_id: "", status, created_at: ago(n * MIN) }) as AgentTask;

const runtimes = [
  rt("devbox-a"),
  rt("devbox-b", { status: "offline", last_seen_at: ago(2 * 60 * MIN) }),
  rt("flaky", { status: "offline", last_seen_at: ago(2 * MIN), profile_id: "p" }),
];
const agents = [
  ...["a", "b", "c", "d", "e"].map((x) => agent(x, "devbox-a")),
  agent("f", "devbox-b"),
  agent("g", "devbox-b"),
];
const snapshot = [
  task("a", "running", 1),
  task("b", "running", 2),
  task("f", "queued", 1),
  task("f", "dispatched", 2),
  task("g", "waiting_local_directory", 3),
  task("g", "deferred", 4),
  task("g", "completed", 5),
];
const groups = buildRuntimeMachineGroups({ runtimes, agents, snapshot, now: NOW });
const row = (id: string) => groups.flatMap((g) => g.runtimes).find((r) => r.runtime.id === id)!;

describe("runtime list texts (UX §3.2)", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("German row lines and TalkBack labels as in the spec", async () => {
    await i18n.changeLanguage("de");
    expect(runtimeRowText(row("devbox-a"), NOW)).toBe("claude · 5 Agents · 2 laufen");
    expect(runtimeRowText(row("devbox-b"), NOW)).toBe("claude · 2 Agents · 3 warten · zuletzt vor 2 Std.");
    expect(runtimeRowText(row("flaky"), NOW)).toBe("claude · 0 Agents · Verbindung gerade verloren");
    expect(runtimeRowA11yLabel(row("devbox-a"), "devbox-a", NOW)).toBe(
      "Runtime claude auf devbox-a, online, 5 Agents, 2 laufen.",
    );
    expect(runtimeRowA11yLabel(row("devbox-b"), "devbox-b", NOW)).toBe(
      "Runtime claude auf devbox-b, offline seit 2 Stunden, 2 Agents, 3 Aufgaben warten.",
    );
    expect(runtimeRowA11yLabel(row("flaky"), "flaky", NOW)).toBe(
      "Runtime claude auf flaky, instabil, Verbindung gerade verloren, 0 Agents, Eigene.",
    );
    expect(runtimeHealthText("recently_lost")).toBe("Instabil");
    expect(runtimeHealthText("long_offline")).toBe("Lange offline");
  });

  it("banner names offline runtimes and their waiting tasks; same count as the row", async () => {
    await i18n.changeLanguage("de");
    const summary = runtimeProblemSummary(groups)!;
    expect(summary.firstRuntimeId).toBe("devbox-b");
    expect(runtimeProblemBannerText(summary)).toBe("1 Runtime offline mit 3 wartenden Aufgaben");
    expect(summary.taskCount).toBe(row("devbox-b").queuedCount);
    expect(runtimeProblemBannerText({ runtimeCount: 2, taskCount: 1 })).toBe(
      "2 Runtimes offline mit 1 wartenden Aufgabe",
    );
  });

  it("English plural forms", async () => {
    await i18n.changeLanguage("en");
    expect(runtimeRowText(row("devbox-b"), NOW)).toBe("claude · 2 agents · 3 waiting · last seen 2h ago");
    expect(runtimeProblemBannerText({ runtimeCount: 1, taskCount: 3 })).toBe("1 runtime offline with 3 waiting tasks");
  });
});
