import { describe, expect, it } from "vitest";
import de from "../locales/de/issues.json";
import en from "../locales/en/issues.json";
import zh from "../locales/zh-Hans/issues.json";

// Keys read by the screens (start date, stage, parent, duplicate,
// edit conflict) must exist in every shipped language.
const KEYS: [string, string][] = [
  ["fields", "start_date"],
  ["fields", "stage"],
  ["fields", "parent"],
  ["menu", "set_parent"],
  ["menu", "change_parent"],
  ["menu", "remove_parent"],
  ["menu", "mark_duplicate"],
  ["picker", "search_issues"],
  ["picker", "type_to_search"],
  ["duplicate", "of"],
  ["duplicate", "confirm_title"],
  ["duplicate", "confirm_message"],
  ["duplicate", "confirm_action"],
  ["edit", "conflict_title"],
  ["edit", "conflict_message"],
  ["edit", "conflict_reload"],
  ["edit", "conflict_keep_mine"],
  ["errors", "duplicate_target_is_duplicate"],
  ["errors", "issue_has_duplicates"],
  ["errors", "circular_parent"],
];

describe("issue field strings", () => {
  for (const [lang, file] of Object.entries({ de, en, "zh-Hans": zh })) {
    it(`${lang} has every key`, () => {
      const data = file as unknown as Record<string, Record<string, unknown>>;
      for (const [section, key] of KEYS) {
        expect(data[section]?.[key], `${lang}:${section}.${key}`).toBeTypeOf("string");
      }
    });
  }
});
