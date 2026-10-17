import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn() }));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));

import * as Clipboard from "expo-clipboard";
import { clearClipboard, parseClearPref } from "./clipboard-clear-pref";

describe("clipboard clear preference", () => {
  beforeEach(() => vi.mocked(Clipboard.setStringAsync).mockReset());

  it("defaults to on and is only off when explicitly stored as off", () => {
    expect(parseClearPref(null)).toBe(true);
    expect(parseClearPref("1")).toBe(true);
    expect(parseClearPref("garbage")).toBe(true);
    expect(parseClearPref("0")).toBe(false);
  });

  it("clears with an empty string and swallows clipboard errors", async () => {
    vi.mocked(Clipboard.setStringAsync).mockResolvedValueOnce(true);
    await clearClipboard();
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith("");
    vi.mocked(Clipboard.setStringAsync).mockRejectedValueOnce(new Error("denied"));
    await expect(clearClipboard()).resolves.toBeUndefined();
  });
});
