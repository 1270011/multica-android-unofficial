import { describe, expect, it } from "vitest";
import de from "../locales/de/issues.json";
import en from "../locales/en/issues.json";
import zh from "../locales/zh-Hans/issues.json";

const KEYS = [
  "mode_list", "mode_board", "empty_column", "prev_column", "next_column", "due", "overdue",
  "truncated_hint", "hidden_hint", "empty", "change_status", "move_next", "move_prev", "moved_to", "undo",
];

describe("board strings", () => {
  for (const [lang, file] of Object.entries({ de, en, "zh-Hans": zh })) {
    it(`${lang} has every board key`, () => {
      const board = (file as unknown as { board?: Record<string, unknown> }).board ?? {};
      for (const key of KEYS) expect(board[key], `${lang}:board.${key}`).toBeTypeOf("string");
    });
  }
});
