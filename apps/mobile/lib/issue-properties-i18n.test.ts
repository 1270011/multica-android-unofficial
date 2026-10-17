import { describe, expect, it } from "vitest";
import de from "../locales/de/issues.json";
import en from "../locales/en/issues.json";
import zh from "../locales/zh-Hans/issues.json";

const KEYS = [
  "yes", "no", "not_set", "read_only", "no_options", "invalid_number", "invalid_url", "invalid_length",
  "placeholder_text", "placeholder_number", "placeholder_url", "row_a11y",
];

describe("property strings", () => {
  for (const [lang, file] of Object.entries({ de, en, "zh-Hans": zh })) {
    it(`${lang} has every key`, () => {
      const section = (file as unknown as { properties?: Record<string, unknown> }).properties ?? {};
      for (const key of KEYS) expect(section[key], `${lang}:properties.${key}`).toBeTypeOf("string");
    });
  }
});
