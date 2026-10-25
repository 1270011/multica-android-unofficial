import { describe, expect, it } from "vitest";
import de from "../locales/de/settings.json";
import en from "../locales/en/settings.json";
import zh from "../locales/zh-Hans/settings.json";
import deNav from "../locales/de/navigation.json";
import enNav from "../locales/en/navigation.json";
import zhNav from "../locales/zh-Hans/navigation.json";
import {
  DEFAULT_MENTION_SORT,
  DEFAULT_TITLE_FILTER,
  EMPTY_HIDDEN_ACTORS,
  hiddenActorCount,
  hiddenActorsStorageKey,
  isActorHidden,
  isDefaultTitleFilter,
  parseMentionSort,
  parseStoredHiddenActors,
  parseStoredTitleFilter,
  pruneHiddenActors,
  serializeHiddenActors,
  serializeTitleFilter,
  setActorHidden,
  titleFilterStorageKey,
  titleFilterSummary,
} from "./view-prefs";

describe("hidden actors", () => {
  it("round-trips and drops junk", () => {
    const hidden = { members: ["u1"], agents: ["a1", "a2"] };
    expect(parseStoredHiddenActors(serializeHiddenActors(hidden))).toEqual(hidden);
    expect(
      parseStoredHiddenActors(JSON.stringify({ members: ["u1", 3, "", "u1"], agents: "x" })),
    ).toEqual({ members: ["u1"], agents: [] });
    for (const raw of [null, "", "{", "[]", "42", JSON.stringify({ members: [] })]) {
      expect(parseStoredHiddenActors(raw)).toBe(EMPTY_HIDDEN_ACTORS);
    }
  });

  it("toggles without duplicates and keeps identity on a no-op", () => {
    const a = setActorHidden(EMPTY_HIDDEN_ACTORS, "agents", "a1", true);
    expect(a).toEqual({ members: [], agents: ["a1"] });
    expect(setActorHidden(a, "agents", "a1", true)).toBe(a);
    expect(isActorHidden(a, "agents", "a1")).toBe(true);
    expect(isActorHidden(a, "members", "a1")).toBe(false);
    expect(hiddenActorCount(setActorHidden(a, "members", "u1", true))).toBe(2);
    expect(setActorHidden(a, "agents", "a1", false)).toEqual({ members: [], agents: [] });
    expect(EMPTY_HIDDEN_ACTORS.agents).toEqual([]); // the shared fallback stays empty
  });

  it("prunes deleted actors", () => {
    const hidden = { members: ["u1", "gone"], agents: ["a1"] };
    expect(pruneHiddenActors(hidden, { members: ["u1"], agents: ["a1"] })).toEqual({
      members: ["u1"],
      agents: ["a1"],
    });
    expect(pruneHiddenActors(hidden, { members: ["u1", "gone"], agents: ["a1"] })).toBe(hidden);
    expect(pruneHiddenActors(hidden, { members: [], agents: [] })).toBe(EMPTY_HIDDEN_ACTORS);
  });
});

describe("title filter settings", () => {
  it("defaults to off with ^AUTO: ", () => {
    expect(DEFAULT_TITLE_FILTER).toEqual({
      enabled: false,
      pattern: "^AUTO: ",
      ignoreCase: false,
      mutePush: false,
    });
    expect(parseStoredTitleFilter(null)).toBe(DEFAULT_TITLE_FILTER);
    expect(parseStoredTitleFilter("nope")).toBe(DEFAULT_TITLE_FILTER);
    expect(isDefaultTitleFilter(parseStoredTitleFilter(null))).toBe(true);
    expect(isDefaultTitleFilter({ ...DEFAULT_TITLE_FILTER, mutePush: true })).toBe(false);
  });

  it("round-trips and fills missing fields", () => {
    const s = { enabled: true, pattern: "^WIP", ignoreCase: true, mutePush: true };
    expect(parseStoredTitleFilter(serializeTitleFilter(s))).toEqual(s);
    expect(parseStoredTitleFilter(JSON.stringify({ enabled: "yes", pattern: 5 }))).toEqual(
      DEFAULT_TITLE_FILTER,
    );
    expect(parseStoredTitleFilter(JSON.stringify({ enabled: true, pattern: "" }))).toEqual({
      enabled: true,
      pattern: "",
      ignoreCase: false,
      mutePush: false,
    });
  });

  it("summarises off / on / invalid for the Settings row", () => {
    expect(titleFilterSummary(DEFAULT_TITLE_FILTER)).toBe("off");
    expect(titleFilterSummary({ ...DEFAULT_TITLE_FILTER, enabled: true })).toBe("on");
    expect(titleFilterSummary({ enabled: true, pattern: "", ignoreCase: false, mutePush: false })).toBe("off");
    expect(titleFilterSummary({ enabled: true, pattern: "(", ignoreCase: false, mutePush: false })).toBe("invalid");
    expect(titleFilterSummary({ enabled: false, pattern: "(", ignoreCase: false, mutePush: false })).toBe("off");
  });
});

describe("mention sort mode", () => {
  it("defaults to frequency", () => {
    expect(DEFAULT_MENTION_SORT).toBe("frequency");
    expect(parseMentionSort(null)).toBe("frequency");
    expect(parseMentionSort("bogus")).toBe("frequency");
    expect(parseMentionSort("name")).toBe("name");
  });
});

describe("storage keys", () => {
  it("are per workspace and SecureStore-safe", () => {
    expect(hiddenActorsStorageKey("5e7a91c0-4b2d")).toBe("rb.hidden_actors.5e7a91c0-4b2d");
    expect(titleFilterStorageKey("5e7a91c0-4b2d")).toBe("rb.issue_title_filter.5e7a91c0-4b2d");
    expect(hiddenActorsStorageKey("a/b c")).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(titleFilterStorageKey("a/b c")).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe("Settings › View strings", () => {
  const VIEW = [
    "title", "hidden_actors", "hidden_actors_count_other", "hidden_actors_none",
    "hidden_issues", "hidden_issues_off", "hidden_issues_on", "hidden_issues_invalid",
  ];
  for (const [lang, file, nav] of [
    ["en", en, enNav],
    ["de", de, deNav],
    ["zh-Hans", zh, zhNav],
  ] as const) {
    it(`${lang} has the section, subpage texts and route titles`, () => {
      const f = file as unknown as Record<string, Record<string, unknown>>;
      for (const k of VIEW) expect(f.view?.[k], `${lang}:view.${k}`).toBeTypeOf("string");
      expect(f.hidden_actors?.intro).toBeTypeOf("string");
      expect(f.title_filter?.scope).toBeTypeOf("string");
      expect(f.view?.hidden_issues_on).toContain("{{pattern}}");
      const routes = (nav as unknown as { routes: Record<string, unknown> }).routes;
      expect(routes.hidden_actors).toBeTypeOf("string");
      expect(routes.title_filter).toBeTypeOf("string");
    });
  }
});
