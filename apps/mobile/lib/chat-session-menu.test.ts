import { describe, expect, it } from "vitest";
import de from "../locales/de/chat.json";
import en from "../locales/en/chat.json";
import zh from "../locales/zh-Hans/chat.json";
import type { ChatSession } from "@multica/core/types";
import {
  CHAT_SESSION_TITLE_MAX,
  chatSessionActions,
  checkChatSessionTitle,
  needsArchivedLookup,
  resolveActiveSession,
  deleteChatSessionFlow,
} from "./chat-session-menu";

const s = (id: string, status: "active" | "archived" = "active") =>
  ({ id, status, title: id }) as ChatSession;

// Review #23 blocker: an archived open chat must resolve, so the composer is
// read-only and ⋮ offers Restore.
describe("resolveActiveSession", () => {
  const active = [s("a")];
  it("finds the open chat in the active list first", () => {
    expect(resolveActiveSession("a", active, [s("a", "archived")], null)?.status).toBe("active");
  });
  it("falls back to the Archive cache, then to a single-session read", () => {
    expect(resolveActiveSession("x", active, [s("x", "archived")], null)?.status).toBe("archived");
    expect(resolveActiveSession("y", active, undefined, s("y", "archived"))?.status).toBe("archived");
  });
  it("ignores a single read for another id and returns null without id", () => {
    expect(resolveActiveSession("y", active, [], s("z", "archived"))).toBeNull();
    expect(resolveActiveSession(null, active, [], null)).toBeNull();
  });
  it("needs the archived lookup only for an open chat outside the active list", () => {
    expect(needsArchivedLookup("a", active)).toBe(false);
    expect(needsArchivedLookup("x", active)).toBe(true);
    expect(needsArchivedLookup(null, active)).toBe(false);
  });
});

describe("chatSessionActions", () => {
  it("offers rename, pin, archive, delete for an active session", () => {
    expect(chatSessionActions({ status: "active", pinned: false })).toEqual(["rename", "pin", "archive", "delete"]);
    expect(chatSessionActions({ status: "active", pinned: true })).toEqual(["rename", "unpin", "archive", "delete"]);
  });

  it("offers restore, rename, delete (no pin) for an archived session", () => {
    expect(chatSessionActions({ status: "archived", pinned: true })).toEqual(["restore", "rename", "delete"]);
  });
});

describe("checkChatSessionTitle", () => {
  it("trims and accepts a changed title", () => {
    expect(checkChatSessionTitle("  Release plan ", "Old")).toEqual({ ok: true, title: "Release plan" });
  });

  it("rejects empty, unchanged and too long titles like the server", () => {
    expect(checkChatSessionTitle("   ", "Old")).toEqual({ ok: false, reason: "empty" });
    expect(checkChatSessionTitle(" Old ", "Old")).toEqual({ ok: false, reason: "unchanged" });
    expect(checkChatSessionTitle("x".repeat(CHAT_SESSION_TITLE_MAX), "Old").ok).toBe(true);
    expect(checkChatSessionTitle("x".repeat(CHAT_SESSION_TITLE_MAX + 1), "Old")).toEqual({ ok: false, reason: "too_long" });
  });

  it("counts characters, not UTF-16 units (server counts runes)", () => {
    expect(checkChatSessionTitle("😀".repeat(CHAT_SESSION_TITLE_MAX), "Old").ok).toBe(true);
  });
});

describe("chat session strings", () => {
  const ACTIONS = ["rename", "pin", "unpin", "archive", "restore", "delete"];
  for (const [lang, file] of Object.entries({ de, en, "zh-Hans": zh })) {
    it(`${lang} has every menu and rename key`, () => {
      const f = file as unknown as {
        sessions: Record<string, unknown> & { actions: Record<string, string> };
        rename: Record<string, string>;
        alerts: Record<string, string>;
      };
      for (const k of ["delete_failed_title", "delete_failed_message"]) {
        expect(f.alerts[k], `${lang}:alerts.${k}`).toBeTypeOf("string");
      }
      for (const a of ACTIONS) expect(f.sessions.actions[a], `${lang}:${a}`).toBeTypeOf("string");
      for (const k of ["tab_active", "tab_archived", "archived_empty", "loading", "pinned", "unread", "long_press_hint", "long_press_hint_archived"]) {
        expect(f.sessions[k], `${lang}:sessions.${k}`).toBeTypeOf("string");
      }
      for (const k of ["title", "label", "save", "too_long"]) expect(f.rename[k], `${lang}:rename.${k}`).toBeTypeOf("string");
    });
  }
});

describe("deleteChatSessionFlow (leave only after the server, J3b)", () => {
  it("leaves the open chat after the server deleted it", async () => {
    const log: string[] = [];
    let resolve!: () => void;
    const done = deleteChatSessionFlow({
      remove: () => new Promise<void>((r) => { log.push("request"); resolve = r; }),
      isOpen: () => true,
      leave: () => log.push("leave"),
      onFailed: () => log.push("failed"),
    });
    await Promise.resolve();
    expect(log).toEqual(["request"]); // still in the chat while waiting
    resolve();
    await expect(done).resolves.toBe(true);
    expect(log).toEqual(["request", "leave"]);
  });
  it("stays in the chat and reports when the delete fails", async () => {
    const log: string[] = [];
    await expect(
      deleteChatSessionFlow({
        remove: async () => { throw new Error("500"); },
        isOpen: () => true,
        leave: () => log.push("leave"),
        onFailed: () => log.push("failed"),
      }),
    ).resolves.toBe(false);
    expect(log).toEqual(["failed"]);
  });
  it("does not leave a chat the user already switched away from", async () => {
    const log: string[] = [];
    await deleteChatSessionFlow({
      remove: async () => {},
      isOpen: () => false,
      leave: () => log.push("leave"),
      onFailed: () => log.push("failed"),
    });
    expect(log).toEqual([]);
  });
});
