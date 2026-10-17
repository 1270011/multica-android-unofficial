import { describe, expect, it } from "vitest";
import de from "../locales/de/issues.json";
import en from "../locales/en/issues.json";
import zh from "../locales/zh-Hans/issues.json";

const RUNS = [
  "open_transcript", "back_to_list", "retry", "retrying", "retry_started", "retry_failed",
  "retry_blocked", "retry_triage", "retry_confirm_title", "retry_confirm_message", "retry_confirm_action",
  "load_retry", "transcript_empty", "transcript_failed", "thinking", "no_output", "output_truncated",
];
const REASONS = ["creator", "assignee", "commenter", "mentioned", "manual", "autopilot", "delegated"];

describe("E2 strings", () => {
  for (const [lang, file] of Object.entries({ de, en, "zh-Hans": zh })) {
    it(`${lang} has runs, subscribers and every reason`, () => {
      const f = file as unknown as {
        runs: Record<string, unknown>;
        subscribers: Record<string, unknown> & { reason: Record<string, unknown> };
      };
      for (const k of RUNS) expect(f.runs[k], `${lang}:runs.${k}`).toBeTypeOf("string");
      for (const k of ["title_other", "menu_other", "empty", "you"]) {
        expect(f.subscribers[k], `${lang}:subscribers.${k}`).toBeTypeOf("string");
      }
      for (const r of REASONS) expect(f.subscribers.reason[r], `${lang}:reason.${r}`).toBeTypeOf("string");
    });
  }
});
