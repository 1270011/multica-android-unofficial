import { describe, expect, it } from "vitest";
import { dateTimeFormat, dateTimeFormatCacheSize } from "./date-format";

// The option sets the call sites use (chat time/day, inbox reset time, time-ago).
const OPTION_SETS: Intl.DateTimeFormatOptions[] = [
  { timeStyle: "short" },
  { dateStyle: "medium" },
  { dateStyle: "medium", timeStyle: "short" },
  { month: "short", day: "numeric" },
];
const LOCALES = ["de", "en", "en-US", undefined];
const DATES = [
  new Date("2026-10-18T05:31:01Z"),
  new Date("2026-01-01T00:00:00Z"),
  new Date("2025-12-31T23:59:59Z"),
  new Date(2026, 1, 28, 13, 7),
];

describe("dateTimeFormat", () => {
  it("formats exactly like a freshly built Intl.DateTimeFormat", () => {
    for (const locale of LOCALES)
      for (const options of OPTION_SETS)
        for (const d of DATES)
          expect(dateTimeFormat(locale, options).format(d)).toBe(
            new Intl.DateTimeFormat(locale, options).format(d),
          );
  });

  it("matches toLocaleDateString for the time-ago fallback", () => {
    const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    for (const locale of LOCALES)
      for (const d of DATES)
        expect(dateTimeFormat(locale, options).format(d)).toBe(d.toLocaleDateString(locale, options));
  });

  it("builds one formatter per locale + options and reuses it", () => {
    const a = dateTimeFormat("de", { timeStyle: "short" });
    const size = dateTimeFormatCacheSize();
    for (let i = 0; i < 100; i++) {
      expect(dateTimeFormat("de", { timeStyle: "short" })).toBe(a);
    }
    expect(dateTimeFormatCacheSize()).toBe(size);
    expect(dateTimeFormat("en", { timeStyle: "short" })).not.toBe(a);
    expect(dateTimeFormat("de", { dateStyle: "medium" })).not.toBe(a);
  });

  it("keeps throwing for invalid locales and caches nothing for them", () => {
    const size = dateTimeFormatCacheSize();
    expect(() => dateTimeFormat("not a locale!", { timeStyle: "short" })).toThrow(RangeError);
    expect(dateTimeFormatCacheSize()).toBe(size);
  });
});
