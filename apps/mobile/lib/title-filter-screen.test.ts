import { beforeEach, describe, expect, it } from "vitest";
import { resetTitleFilterCachesForTest } from "./title-filter";
import { titleFilterErrorText, titleFilterScreenView } from "./title-filter-screen";
import { DEFAULT_TITLE_FILTER } from "./view-prefs";

beforeEach(() => resetTitleFilterCachesForTest());

describe("titleFilterScreenView", () => {
  it("locks switches and field until the workspace is hydrated", () => {
    const stored = { enabled: true, pattern: "^TEST", ignoreCase: false, mutePush: false };
    expect(
      titleFilterScreenView({ hydrated: false, settings: DEFAULT_TITLE_FILTER, loadedTitles: ["AUTO: a"] }),
    ).toEqual({ locked: true, error: null, preview: null, previewEmpty: false, muteAvailable: false });
    // Even an invalid stored pattern shows nothing before hydration.
    expect(
      titleFilterScreenView({ hydrated: false, settings: { ...stored, pattern: "(" }, loadedTitles: [] }).locked,
    ).toBe(true);
    expect(titleFilterScreenView({ hydrated: true, settings: stored, loadedTitles: [] }).locked).toBe(false);
  });

  it("shows the default ^AUTO: preview on a fresh install (A5.1)", () => {
    const view = titleFilterScreenView({
      hydrated: true,
      settings: DEFAULT_TITLE_FILTER,
      loadedTitles: ["AUTO: a", "Feature", "AUTO: b"],
    });
    expect(view).toEqual({
      locked: false,
      error: null,
      preview: { hidden: 2, total: 3 },
      previewEmpty: false,
      muteAvailable: false,
    });
  });

  it("says no issues are loaded yet", () => {
    const view = titleFilterScreenView({ hydrated: true, settings: DEFAULT_TITLE_FILTER, loadedTitles: [] });
    expect(view.preview).toBeNull();
    expect(view.previewEmpty).toBe(true);
  });

  it("shows the field error also with the switch off, no preview (A5.4/A5.5)", () => {
    const invalid = titleFilterScreenView({
      hydrated: true,
      settings: { enabled: false, pattern: "(", ignoreCase: false, mutePush: false },
      loadedTitles: ["AUTO: a"],
    });
    expect(invalid.error?.kind).toBe("invalid");
    expect(invalid.preview).toBeNull();
    expect(invalid.previewEmpty).toBe(false);
    const complex = titleFilterScreenView({
      hydrated: true,
      settings: { enabled: true, pattern: "(a+)+$", ignoreCase: false, mutePush: false },
      loadedTitles: ["AUTO: a"],
    });
    expect(complex.error).toEqual({ kind: "too_complex" });
  });

  it("shows nothing for an empty pattern", () => {
    expect(
      titleFilterScreenView({ hydrated: true, settings: { ...DEFAULT_TITLE_FILTER, pattern: "" }, loadedTitles: ["a"] }),
    ).toEqual({ locked: false, error: null, preview: null, previewEmpty: false, muteAvailable: false });
  });
});

describe("titleFilterErrorText", () => {
  it("maps every error to a settings key", () => {
    expect(titleFilterErrorText({ kind: "invalid", message: "Unterminated group" })).toEqual({
      key: "title_filter.invalid",
      params: { message: "Unterminated group" },
    });
    expect(titleFilterErrorText({ kind: "too_long" }).key).toBe("title_filter.too_long");
    expect(titleFilterErrorText({ kind: "too_complex" }).key).toBe("title_filter.too_complex");
    expect(titleFilterErrorText({ kind: "too_slow" }).key).toBe("title_filter.too_slow");
  });
});

describe("push mute switch (W7)", () => {
  it("is usable only with the filter on and a valid pattern", () => {
    const base = { ...DEFAULT_TITLE_FILTER, mutePush: true };
    const view = (over: Partial<typeof base>, hydrated = true) =>
      titleFilterScreenView({ hydrated, settings: { ...base, ...over }, loadedTitles: [] }).muteAvailable;
    expect(view({ enabled: true })).toBe(true);
    expect(view({ enabled: false })).toBe(false);
    expect(view({ enabled: true, pattern: "(" })).toBe(false);
    expect(view({ enabled: true, pattern: "" })).toBe(false);
    expect(view({ enabled: true }, false)).toBe(false);
  });
});
