// @vitest-environment node
import { QueryClient } from "@tanstack/react-query";
import type { PinnedItem } from "@multica/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/data/api";
import { pinKeys } from "@/data/queries/pins";
import { useCreatePin } from "./pins";

const state = vi.hoisted(() => ({ qc: undefined as unknown as QueryClient }));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => state.qc,
    // Keep the real mutation lifecycle, substituting only React hook wiring.
    useMutation: (
      options: ConstructorParameters<typeof actual.MutationObserver>[1],
    ) => {
      const observer = new actual.MutationObserver(state.qc, options);
      return { mutateAsync: (variables: unknown) => observer.mutate(variables) };
    },
  };
});

vi.mock("@/data/api", () => ({
  api: { createPin: vi.fn(), listPins: vi.fn() },
}));
vi.mock("@/data/workspace-store", () => ({
  useWorkspaceStore: (selector: (s: { currentWorkspaceId: string }) => unknown) =>
    selector({ currentWorkspaceId: "ws-1" }),
}));
vi.mock("@/data/auth-store", () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: "u-1" } }),
}));

const key = pinKeys.list("ws-1", "u-1");

describe("useCreatePin", () => {
  beforeEach(() => {
    state.qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    state.qc.setQueryData<PinnedItem[]>(key, []);
    vi.mocked(api.createPin).mockReset();
  });
  afterEach(() => state.qc.clear());

  it("409 (already pinned) keeps the pin in the cache", async () => {
    vi.mocked(api.createPin).mockRejectedValue(Object.assign(new Error("x"), { status: 409 }));
    await expect(
      useCreatePin().mutateAsync({ item_type: "view", item_id: "v-1" }),
    ).rejects.toThrow();
    const pins = state.qc.getQueryData<PinnedItem[]>(key) ?? [];
    expect(pins.map((p) => [p.item_type, p.item_id])).toEqual([["view", "v-1"]]);
  });

  it("other errors roll the optimistic pin back", async () => {
    vi.mocked(api.createPin).mockRejectedValue(Object.assign(new Error("x"), { status: 500 }));
    await expect(
      useCreatePin().mutateAsync({ item_type: "view", item_id: "v-1" }),
    ).rejects.toThrow();
    expect(state.qc.getQueryData<PinnedItem[]>(key)).toEqual([]);
  });
});
