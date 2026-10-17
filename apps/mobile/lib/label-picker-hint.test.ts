import { describe, expect, it } from "vitest";
import de from "../locales/de/issues.json";
import en from "../locales/en/issues.json";
import zh from "../locales/zh-Hans/issues.json";
import { labelPickerHasSearch, labelPickerHintKey } from "./label-picker-hint";

// Smoke F-2 on #33: Android's label sheet has no search field.
describe("labelPickerHintKey", () => {
  it("points at the search field only where it exists (iOS, empty query)", () => {
    expect(labelPickerHintKey(true, "")).toBe("picker.no_labels_hint");
    expect(labelPickerHintKey(true, "  ")).toBe("picker.no_labels_hint");
  });
  it("names the web settings on Android and for a search without matches", () => {
    expect(labelPickerHintKey(false, "")).toBe("picker.no_labels_hint_web");
    expect(labelPickerHintKey(true, "bug")).toBe("picker.no_labels_hint_web");
  });
  it("knows which platform shows the search bar", () => {
    expect(labelPickerHasSearch("ios")).toBe(true);
    expect(labelPickerHasSearch("android")).toBe(false);
  });
  for (const [lang, file] of Object.entries({ de, en, "zh-Hans": zh })) {
    it(`${lang} has both hints`, () => {
      const p = (file as unknown as { picker: Record<string, string> }).picker;
      expect(p.no_labels_hint).toBeTypeOf("string");
      expect(p.no_labels_hint_web).toBeTypeOf("string");
    });
  }
});
