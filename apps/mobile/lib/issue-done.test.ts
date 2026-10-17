// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { markIssueDoneInOrder } from "@/lib/issue-done";

describe("markIssueDoneInOrder (review #12: Done in order)", () => {
  it("archives only after the status write succeeded", async () => {
    const order: string[] = [];
    let finish!: () => void;
    const setDone = () =>
      new Promise<void>((resolve) => {
        order.push("status");
        finish = resolve;
      });
    const archive = vi.fn(() => order.push("archive"));

    const run = markIssueDoneInOrder(setDone, archive, "inbox-1");
    await Promise.resolve();
    expect(archive).not.toHaveBeenCalled();
    finish();
    await expect(run).resolves.toBe(true);
    expect(order).toEqual(["status", "archive"]);
    expect(archive).toHaveBeenCalledWith("inbox-1");
  });

  it("does not archive when the status write fails", async () => {
    const archive = vi.fn();
    await expect(markIssueDoneInOrder(() => Promise.reject(new Error("409")), archive, "inbox-1")).resolves.toBe(false);
    expect(archive).not.toHaveBeenCalled();
  });

  it("only sets the status without an inbox entry", async () => {
    const archive = vi.fn();
    await expect(markIssueDoneInOrder(() => Promise.resolve(), archive, undefined)).resolves.toBe(true);
    expect(archive).not.toHaveBeenCalled();
  });
});
