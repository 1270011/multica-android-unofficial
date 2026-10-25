// @vitest-environment node
/**
 * @-sheet selection bar + "Done (n)". Layout and
 * TalkBack need a device (Maestro flow `mention-multi-select`); these pin
 * the texts, the strings in every language and the wiring in the body.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import de from "../locales/de/issues.json";
import en from "../locales/en/issues.json";
import zh from "../locales/zh-Hans/issues.json";
import {
  compensateScrollForBar,
  MENTION_SHEET_DETENTS,
  mentionChipLabel,
  mentionDoneLabel,
  mentionKeyboardSpacer,
  mentionSearchInBody,
  mentionSpokenName,
  mentionToggleAnnouncement,
  shouldClearQueryAfterToggle,
} from "./mention-picker-selection";

const KEYS = [
  "selected_count",
  "done_count",
  "done",
  "done_a11y",
  "remove_chip_a11y",
  "added_a11y",
  "removed_a11y",
  // Placeholders of the search field (header on iOS, body on Android).
  "search_people_issues",
  "reference_issue",
];

/** Minimal i18next stand-in: looks up `picker.*` in a locale file and
 *  fills `{{var}}` placeholders. */
function makeT(file: unknown) {
  const picker = (file as { picker: Record<string, string> }).picker;
  return (key: string, opts: Record<string, unknown> = {}) => {
    const raw = picker[key.replace(/^picker\./, "")];
    if (raw === undefined) throw new Error(`missing ${key}`);
    return raw.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(opts[k]));
  };
}

describe("mention picker selection strings", () => {
  for (const [lang, file] of Object.entries({ de, en, "zh-Hans": zh })) {
    it(`${lang} has every key with its placeholders`, () => {
      const picker = (file as { picker: Record<string, string> }).picker;
      for (const key of KEYS) {
        expect(picker[key], `${lang}:picker.${key}`).toBeTypeOf("string");
        // Same placeholders as English, so no language drops the count.
        const vars = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort();
        expect(vars(picker[key]), `${lang}:picker.${key}`).toEqual(
          vars((en as { picker: Record<string, string> }).picker[key]),
        );
      }
    });
  }
});

describe("mention picker selection texts", () => {
  const tDe = makeT(de);
  const tEn = makeT(en);

  it("chip label matches the composer chip row", () => {
    expect(mentionChipLabel({ type: "agent", name: "ux-designer" })).toBe(
      "@ux-designer",
    );
    expect(mentionChipLabel({ type: "all", name: "all" })).toBe("@all");
    expect(mentionChipLabel({ type: "issue", name: "MUL-126" })).toBe(
      "MUL-126",
    );
  });

  it("spoken name has no @", () => {
    expect(mentionSpokenName({ type: "member", name: "admin" })).toBe("admin");
  });

  it("announces add and remove with the new count (A3.6)", () => {
    const m = { type: "agent" as const, name: "ux-designer" };
    expect(mentionToggleAnnouncement(tDe, m, true, 2)).toBe(
      "ux-designer hinzugefügt, 2 gewählt",
    );
    expect(mentionToggleAnnouncement(tDe, m, false, 1)).toBe(
      "ux-designer entfernt, 1 gewählt",
    );
    expect(mentionToggleAnnouncement(tEn, m, true, 3)).toBe(
      "ux-designer added, 3 selected",
    );
  });

  it("Done shows the count only when something is selected (A3.4)", () => {
    expect(mentionDoneLabel(tDe, 0)).toBe("Fertig");
    expect(mentionDoneLabel(tDe, 2)).toBe("Fertig (2)");
    expect(mentionDoneLabel(tEn, 1)).toBe("Done (1)");
  });
});

describe("mention picker search clear + position hold (W3-P3)", () => {
  it("clears the search only after an add with search text (A3.1)", () => {
    expect(shouldClearQueryAfterToggle("ux", true)).toBe(true);
    expect(shouldClearQueryAfterToggle("ux", false)).toBe(false);
    expect(shouldClearQueryAfterToggle("", true)).toBe(false);
    expect(shouldClearQueryAfterToggle("   ", true)).toBe(false);
  });

  it("scrolls by the bar height so the tapped row stays put (A3.2)", () => {
    // Bar appears at the list end: list moves down by 48, scroll follows.
    expect(compensateScrollForBar(1200, 0, 48)).toBe(1248);
    // Last chip removed: bar gone, scroll back by its height.
    expect(compensateScrollForBar(1248, 48, 0)).toBe(1200);
    expect(compensateScrollForBar(20, 48, 0)).toBe(0);
    // Taller bar at large font scale.
    expect(compensateScrollForBar(500, 0, 96)).toBe(596);
  });

  it("compensates at the top too, the first pick (F5)", () => {
    // First pick without search text, list at the top: scroll by the bar
    // so the tapped row stays under the finger.
    expect(compensateScrollForBar(0, 0, 48)).toBe(48);
    expect(compensateScrollForBar(0, 0, 41)).toBe(41);
    // Overscroll (negative offset) counts as the top.
    expect(compensateScrollForBar(-3, 0, 48)).toBe(48);
  });

  it("does nothing when nothing would move", () => {
    expect(compensateScrollForBar(800, 48, 48)).toBeNull();
    // Bar gone while already at the top: nothing to scroll back.
    expect(compensateScrollForBar(0, 48, 0)).toBeNull();
  });
});

describe("mention picker body wiring", () => {
  const read = (path: string) =>
    readFileSync(join(__dirname, "..", path), "utf8");
  const body = read("components/issue/pickers/mention-picker-body.tsx");
  const bar = read("components/issue/pickers/mention-picker-selection.tsx");

  it("renders the selection bar above and Done below the list", () => {
    const iBar = body.indexOf("<MentionSelectionBar");
    const iList = body.indexOf("<FlatList");
    const iDone = body.indexOf("<MentionDoneBar");
    expect(iBar).toBeGreaterThan(-1);
    expect(iBar).toBeLessThan(iList);
    expect(iList).toBeLessThan(iDone);
  });

  it("chip removal and row taps share the announcing toggle", () => {
    expect(body).toMatch(/onRemove=\{toggleAndAnnounce\}/);
    expect(body).toMatch(/if \(chip\) toggleAndAnnounce\(chip\);/);
    expect(body).toMatch(/announceForAccessibility/);
  });

  it("rows are checkboxes with checked state", () => {
    expect(body).toMatch(/accessibilityRole="checkbox"/);
    expect(body).toMatch(/checked: isSelected\(item\)/);
  });

  it("Done closes the sheet without clearing the selection", () => {
    expect(body).toMatch(/onDone=\{\(\) => router\.back\(\)\}/);
    expect(body).not.toMatch(/\bclear\(\)/);
    expect(bar).not.toMatch(/\bclear\(\)/);
  });

  it("search clear goes through the route's native ref (W3-P3)", () => {
    const route = read("app/(app)/[workspace]/mention-picker.tsx");
    const hook = read("lib/use-native-search-bar.ts");
    expect(route).toMatch(/onClearQuery=\{clearQuery\}/);
    expect(hook).toMatch(/ref: searchBarRef/);
    expect(hook).toMatch(/searchBarRef\.current\?\.clearText\(\);\s*setQuery\(""\);/);
    expect(body).toMatch(/shouldClearQueryAfterToggle\(query, added\)/);
  });

  it("rows do not depend on the selection, so picks never reorder", () => {
    const rowsMemo = body.slice(body.indexOf("const rows = useMemo"));
    const deps = rowsMemo.slice(0, rowsMemo.indexOf("const pick"));
    expect(deps).not.toMatch(/selected/);
  });

  it("chip capsule is no touch target of its own", () => {
    // An `active:` class turns the inner View into a NativeWind responder
    // that swallowed the chip tap on Android.
    const chips = bar.slice(bar.indexOf("selected.map"));
    expect(chips.slice(0, chips.indexOf("</ScrollView>"))).not.toMatch(
      /active:/,
    );
    expect(bar).toMatch(/\{\(\{ pressed \}\) =>/);
  });

  it("bar is absent with no selection and has 48 dp targets", () => {
    expect(bar).toMatch(/if \(selected\.length === 0\) return null;/);
    expect(bar).toMatch(/const TOUCH = 48;/);
  });
});

describe("focus back to the composer after the sheet (F1)", () => {
  const read = (path: string) =>
    readFileSync(join(__dirname, "..", path), "utf8");

  it("the route reports its close on unmount", () => {
    const route = read("app/(app)/[workspace]/mention-picker.tsx");
    expect(route).toMatch(
      /useEffect\(\s*\(\) => \(\) => useMentionDraftStore\.getState\(\)\.markPickerClosed\(\),\s*\[\],?\s*\)/,
    );
  });

  it("only the composer that opened the sheet refocuses its input", () => {
    const composer = read("components/composer/message-composer.tsx");
    const onAt = composer.slice(composer.indexOf("const onAtPress"));
    expect(onAt.slice(0, onAt.indexOf("router.push"))).toMatch(
      /pickerOpen\.current = true;/,
    );
    const effect = composer.slice(composer.indexOf("const pickerCloses"));
    const body = effect.slice(0, effect.indexOf("}, [pickerCloses]);"));
    expect(body).toMatch(/if \(!pickerOpen\.current\) return;/);
    expect(body).toMatch(/inputRef\.current\?\.focus\(\)/);
    expect(body).toMatch(/clearTimeout/);
  });
});

describe("mention picker on Android", () => {
  const read = (path: string) =>
    readFileSync(join(__dirname, "..", path), "utf8");
  const body = read("components/issue/pickers/mention-picker-body.tsx");
  const route = read("app/(app)/[workspace]/mention-picker.tsx");
  const layout = read("app/(app)/[workspace]/_layout.tsx");

  it("puts the search field into the body everywhere but iOS", () => {
    expect(mentionSearchInBody("android")).toBe(true);
    expect(mentionSearchInBody("ios")).toBe(false);
  });

  it("opens only at the tall detent", () => {
    expect(MENTION_SHEET_DETENTS).toEqual([0.95]);
    const screen = layout.slice(layout.indexOf('name="mention-picker"'));
    const opts = screen.slice(0, screen.indexOf("/>"));
    expect(opts).toMatch(/sheetAllowedDetents: MENTION_SHEET_DETENTS/);
  });

  it("lifts Done above the keyboard on Android only (A3.4)", () => {
    expect(mentionKeyboardSpacer("android", true, 812)).toBe(812);
    expect(mentionKeyboardSpacer("android", false, 812)).toBe(0);
    expect(mentionKeyboardSpacer("ios", true, 812)).toBe(0);
    expect(mentionKeyboardSpacer("android", true, -1)).toBe(0);
    // Nav bar strip is not covered twice.
    expect(mentionKeyboardSpacer("android", true, 812, 48)).toBe(764);
    expect(mentionKeyboardSpacer("android", true, 20, 48)).toBe(0);
    const tail = body.slice(body.indexOf("<MentionDoneBar"));
    expect(tail).toMatch(/height: keyboardSpacer/);
  });

  it("opening the sheet does not collapse the composer", () => {
    // The body search field takes focus; the composer's blur handler must
    // skip that one blur (else Done returned to a collapsed pill).
    const composer = read("components/composer/message-composer.tsx");
    const at = composer.slice(composer.indexOf("const onAtPress"));
    expect(at.slice(0, at.indexOf("router.push"))).toMatch(
      /blurForMentionPicker\.current = inputRef\.current\?\.isFocused\(\)/,
    );
    const blur = composer.slice(composer.indexOf("const onBlur"));
    expect(blur.slice(0, blur.indexOf("setTimeout"))).toMatch(
      /if \(blurForMentionPicker\.current\) \{\s*blurForMentionPicker\.current = false;\s*return;/,
    );
  });

  it("renders the body search field above the chip bar", () => {
    const iField = body.indexOf("{searchField}");
    expect(iField).toBeGreaterThan(-1);
    expect(iField).toBeLessThan(body.indexOf("<MentionSelectionBar"));
  });

  it("clears the body field through its ref, keeping focus (A3.1)", () => {
    expect(route).toMatch(/mentionSearchInBody\(Platform\.OS\)/);
    expect(route).toMatch(/inputRef\.current\?\.clear\(\);\s*setQuery\(""\);/);
    expect(route).toMatch(/testID="mention-picker-search"/);
    expect(route).toMatch(/searchField=\{/);
    // Uncontrolled: a `value` prop would fight the native clear().
    const field = route.slice(route.indexOf("<TextInput"));
    expect(field.slice(0, field.indexOf("/>"))).not.toMatch(/\bvalue=/);
  });
});
