import { describe, expect, it } from "vitest";
import { combinedListState, listState } from "./list-state";

describe("listState", () => {
  it("is offline when the first fetch is paused without data (not empty)", () => {
    expect(listState({ data: undefined, error: null, fetchStatus: "paused" })).toBe("offline");
  });

  it("is loading while the first fetch runs", () => {
    expect(listState({ data: undefined, error: null, fetchStatus: "fetching" })).toBe("loading");
  });

  it("is loading for an idle query without data (disabled, no workspace yet)", () => {
    expect(listState({ data: undefined, error: null, fetchStatus: "idle" })).toBe("loading");
  });

  it("is an error when the fetch failed without data", () => {
    expect(listState({ data: undefined, error: new Error("500"), fetchStatus: "idle" })).toBe("error");
  });

  it("is ready with data, also when it is an empty list", () => {
    expect(listState({ data: { autopilots: [] }, error: null, fetchStatus: "idle" })).toBe("ready");
    expect(listState({ data: [], error: null, fetchStatus: "paused" })).toBe("ready");
  });

  it("keeps cached data visible when a refresh fails or pauses", () => {
    expect(listState({ data: [1], error: new Error("x"), fetchStatus: "idle" })).toBe("ready");
  });
});

// The further lists that used to show "empty" offline.
describe("offline lists", () => {
  const paused = { data: undefined, error: null, fetchStatus: "paused" as const };
  const loaded = <T,>(data: T) => ({ data, error: null, fetchStatus: "idle" as const });

  it("project issues: paused without data is offline, an empty page is ready", () => {
    expect(listState(paused)).toBe("offline");
    expect(listState(loaded([]))).toBe("ready");
  });

  it("pins: paused without data is offline, also for a pin row's detail", () => {
    expect(listState(paused)).toBe("offline");
    expect(listState({ data: { id: "" }, error: null, fetchStatus: "paused" })).toBe("ready");
  });

  it("views sheet: offline as soon as one of own/shared lists is paused", () => {
    expect(combinedListState([paused])).toBe("offline");
    expect(combinedListState([loaded([]), paused])).toBe("offline");
    expect(
      combinedListState([{ data: undefined, error: new Error("500"), fetchStatus: "idle" }, paused]),
    ).toBe("offline");
  });

  it("views sheet: error, then loading, ready only with every list", () => {
    const failed = { data: undefined, error: new Error("500"), fetchStatus: "idle" as const };
    const loading = { data: undefined, error: null, fetchStatus: "fetching" as const };
    expect(combinedListState([loaded([]), failed])).toBe("error");
    expect(combinedListState([failed, loading])).toBe("error");
    expect(combinedListState([loaded([]), loading])).toBe("loading");
    expect(combinedListState([loaded([]), loaded([])])).toBe("ready");
  });
});
