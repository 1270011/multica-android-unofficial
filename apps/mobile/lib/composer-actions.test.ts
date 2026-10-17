import { describe, expect, it } from "vitest";
import de from "../locales/de/chat.json";
import en from "../locales/en/chat.json";
import zh from "../locales/zh-Hans/chat.json";
import { composerActions, type ComposerActionInput } from "./composer-actions";

const base: ComposerActionInput = {
  isRunning: false,
  allowSubmitWhileRunning: false,
  stopAvailable: true,
  hasContent: false,
  uploading: false,
  submitting: false,
  disabled: false,
};
const s = (o: Partial<ComposerActionInput>) => composerActions({ ...base, ...o });

describe("composerActions", () => {
  it("running + text with queue support: Send is active and queues, Stop next to it", () => {
    expect(s({ isRunning: true, allowSubmitWhileRunning: true, hasContent: true })).toEqual({
      showStop: true,
      showSend: true,
      canSend: true,
      queues: true,
    });
  });

  it("running without text: Stop plus a disabled Send", () => {
    expect(s({ isRunning: true, allowSubmitWhileRunning: true })).toMatchObject({
      showStop: true,
      showSend: true,
      canSend: false,
    });
  });

  it("older server without queue support stays stop-only (web parity)", () => {
    expect(s({ isRunning: true, allowSubmitWhileRunning: false, hasContent: true })).toEqual({
      showStop: true,
      showSend: false,
      canSend: false,
      queues: false,
    });
    // No Stop for a still-queued head: the disabled Send keeps the slot.
    expect(s({ isRunning: true, stopAvailable: false, hasContent: true })).toMatchObject({
      showStop: false,
      showSend: true,
      canSend: false,
    });
  });

  it("idle: plain Send, enabled only with content and nothing in flight", () => {
    expect(s({ hasContent: true })).toEqual({ showStop: false, showSend: true, canSend: true, queues: false });
    expect(s({ hasContent: false }).canSend).toBe(false);
    expect(s({ hasContent: true, uploading: true }).canSend).toBe(false);
    expect(s({ hasContent: true, submitting: true }).canSend).toBe(false);
    expect(s({ hasContent: true, disabled: true }).canSend).toBe(false);
  });

  it("an upload or a running submit blocks queueing too", () => {
    expect(s({ isRunning: true, allowSubmitWhileRunning: true, hasContent: true, uploading: true }).canSend).toBe(false);
  });
});

describe("composer queue strings", () => {
  for (const [lang, file] of Object.entries({ de, en, "zh-Hans": zh })) {
    it(`${lang} has send_queued and working_queue`, () => {
      const c = (file as unknown as { composer: Record<string, string> }).composer;
      expect(c.send_queued).toBeTypeOf("string");
      expect(c.working_queue).toBeTypeOf("string");
      // Fits one line next to Stop on a 384 dp phone (768 px).
      expect([...(c.working_queue as string)].length).toBeLessThanOrEqual(32);
    });
  }
});
