// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { IssueProperty } from "@multica/core/types";
import {
  formatPropertyValue,
  isPropertyReadOnly,
  memberRef,
  parseScalarInput,
  selectedMemberIds,
  toggleActor,
  toggleOption,
  visibleProperties,
  createSerialQueue,
  createToggleChain,
  toggleMirror,
} from "./issue-properties";

const prop = (over: Partial<IssueProperty>): IssueProperty =>
  ({
    id: "p",
    workspace_id: "ws",
    name: "P",
    type: "text",
    config: {},
    position: 0,
    archived: false,
    created_at: "",
    updated_at: "",
    ...over,
  }) as IssueProperty;
const ctx = { yes: "Yes", no: "No", memberName: (id: string) => (id === "u1" ? "Ana" : undefined) };
const options = [
  { id: "o1", name: "Red", color: "#f00" },
  { id: "o2", name: "Blue", color: "#00f" },
];

describe("visibleProperties", () => {
  it("orders by position, hides archived ones without a value", () => {
    const list = [
      prop({ id: "b", position: 2 }),
      prop({ id: "a", position: 1 }),
      prop({ id: "old", position: 0, archived: true }),
      prop({ id: "kept", position: 3, archived: true }),
    ];
    expect(visibleProperties(list, { kept: "x" }).map((p) => p.id)).toEqual(["a", "b", "kept"]);
  });
});

describe("isPropertyReadOnly", () => {
  it("archived, unknown type, and an unknown single actor ref are read-only", () => {
    expect(isPropertyReadOnly(prop({ archived: true }), undefined)).toBe(true);
    expect(isPropertyReadOnly(prop({ type: "formula" }), undefined)).toBe(true);
    expect(isPropertyReadOnly(prop({ type: "actor" }), "team:x")).toBe(true);
    expect(isPropertyReadOnly(prop({ type: "multi_actor" }), ["team:x"])).toBe(false);
    expect(isPropertyReadOnly(prop({ type: "actor" }), "member:u1")).toBe(false);
  });
});

describe("formatPropertyValue per type", () => {
  it("text, url, number, date", () => {
    expect(formatPropertyValue(prop({}), "hello", ctx)).toBe("hello");
    expect(formatPropertyValue(prop({ type: "url" }), "https://x.test", ctx)).toBe("https://x.test");
    expect(formatPropertyValue(prop({ type: "number" }), 3.5, ctx)).toBe("3.5");
    expect(formatPropertyValue(prop({ type: "date" }), "2026-10-16", ctx)).toBe("2026-10-16");
  });
  it("select and multi_select show option names, unknown ids raw", () => {
    expect(formatPropertyValue(prop({ type: "select", config: { options } }), "o2", ctx)).toBe("Blue");
    expect(formatPropertyValue(prop({ type: "multi_select", config: { options } }), ["o1", "zz"], ctx)).toBe("Red, zz");
  });
  it("checkbox yes / no", () => {
    expect(formatPropertyValue(prop({ type: "checkbox" }), true, ctx)).toBe("Yes");
    expect(formatPropertyValue(prop({ type: "checkbox" }), false, ctx)).toBe("No");
  });
  it("actor names, unknown members shortened", () => {
    expect(formatPropertyValue(prop({ type: "actor" }), "member:u1", ctx)).toBe("Ana");
    expect(formatPropertyValue(prop({ type: "multi_actor" }), ["member:u1", "member:abcdefghij"], ctx)).toBe(
      "Ana, abcdefgh",
    );
  });
  it("empty values are null", () => {
    expect(formatPropertyValue(prop({}), undefined, ctx)).toBeNull();
    expect(formatPropertyValue(prop({ type: "multi_select" }), [], ctx)).toBeNull();
  });
});

describe("parseScalarInput", () => {
  it("trims text, clears on empty, numbers with comma, rejects non-numbers", () => {
    expect(parseScalarInput("text", "  hi ")).toEqual({ kind: "set", value: "hi" });
    expect(parseScalarInput("url", "   ")).toEqual({ kind: "clear" });
    expect(parseScalarInput("number", "3,5")).toEqual({ kind: "set", value: 3.5 });
    expect(parseScalarInput("number", "abc")).toEqual({ kind: "invalid", reason: "number" });
  });
  it("urls need http(s) and a host; text is capped", () => {
    expect(parseScalarInput("url", "https://x.test/a")).toEqual({ kind: "set", value: "https://x.test/a" });
    expect(parseScalarInput("url", "x.test")).toEqual({ kind: "invalid", reason: "url" });
    expect(parseScalarInput("url", "javascript:alert(1)")).toEqual({ kind: "invalid", reason: "url" });
    expect(parseScalarInput("url", "http://localhost:3000")).toEqual({ kind: "set", value: "http://localhost:3000" });
    expect(parseScalarInput("text", "a".repeat(2001))).toEqual({ kind: "invalid", reason: "length" });
  });
  it("url rule is the server's, not stricter", () => {
    // Go url.Parse: scheme http(s) and a non-empty host — no dot needed.
    expect(parseScalarInput("url", "http://intranet/")).toEqual({ kind: "set", value: "http://intranet/" });
    expect(parseScalarInput("url", "HTTPS://wiki")).toEqual({ kind: "set", value: "HTTPS://wiki" });
    expect(parseScalarInput("url", "http://user@host:8080/p?q#f")).toEqual({
      kind: "set",
      value: "http://user@host:8080/p?q#f",
    });
    expect(parseScalarInput("url", "http://10.0.0.5")).toEqual({ kind: "set", value: "http://10.0.0.5" });
    expect(parseScalarInput("url", "http:///path")).toEqual({ kind: "invalid", reason: "url" });
    expect(parseScalarInput("url", "http://user@/x")).toEqual({ kind: "invalid", reason: "url" });
    expect(parseScalarInput("url", "ftp://host")).toEqual({ kind: "invalid", reason: "url" });
    expect(parseScalarInput("url", "http://a b")).toEqual({ kind: "invalid", reason: "url" });
  });
  it("a space in the path is fine, as on the server; control characters are not", () => {
    expect(parseScalarInput("url", "http://wiki/Team Seite")).toEqual({ kind: "set", value: "http://wiki/Team Seite" });
    expect(parseScalarInput("url", "http://h/a?q=x y#f g")).toEqual({ kind: "set", value: "http://h/a?q=x y#f g" });
    expect(parseScalarInput("url", "http://us er@host/")).toEqual({ kind: "invalid", reason: "url" });
    expect(parseScalarInput("url", "http://h/a\tb")).toEqual({ kind: "invalid", reason: "url" });
  });
  it("limits match the server: url 2048 bytes, text 2000 characters", () => {
    const url = "http://h/" + "a".repeat(2048 - 9);
    expect(parseScalarInput("url", url)).toEqual({ kind: "set", value: url });
    expect(parseScalarInput("url", url + "a")).toEqual({ kind: "invalid", reason: "length" });
    // 2000 emoji are 2000 characters (server counts runes), not 4000.
    const emoji = "😀".repeat(2000);
    expect(parseScalarInput("text", emoji)).toEqual({ kind: "set", value: emoji });
  });
});

describe("toggleOption / toggleActor", () => {
  it("multi_select toggles and clears when empty", () => {
    expect(toggleOption(["o1"], "o2")).toEqual(["o1", "o2"]);
    expect(toggleOption(["o1"], "o1")).toBeUndefined();
    expect(toggleOption(undefined, "o1")).toEqual(["o1"]);
  });
  it("multi_actor keeps unknown refs, caps at 20, clears when empty", () => {
    expect(toggleActor(["team:x"], "u1")).toEqual(["team:x", "member:u1"]);
    expect(toggleActor(["member:u1"], "u1")).toBeUndefined();
    const full = Array.from({ length: 20 }, (_, i) => memberRef(`u${i + 10}`));
    expect(toggleActor(full, "u1")).toEqual(full);
    expect(selectedMemberIds(["member:u1", "team:x"])).toEqual(["u1"]);
  });
});

describe("rapid toggles", () => {
  it("writes run one after another in call order, also after a failure", async () => {
    const queue = createSerialQueue();
    const log: string[] = [];
    let release!: () => void;
    const first = queue(
      () => new Promise<void>((resolve) => {
        log.push("start a");
        release = () => { log.push("end a"); resolve(); };
      }),
    );
    const second = queue(async () => { log.push("b"); throw new Error("409"); });
    const third = queue(async () => { log.push("c"); });
    await Promise.resolve();
    expect(log).toEqual(["start a"]); // b waits for a
    release();
    await first;
    await expect(second).rejects.toThrow("409");
    await third;
    expect(log).toEqual(["start a", "end a", "b", "c"]);
  });
  it("the local selection wins while own writes are pending", () => {
    // A then B toggled; the response for A alone arrives first.
    expect(toggleMirror(["a", "b"], ["a"], 1)).toEqual(["a", "b"]);
    expect(toggleOption(toggleMirror(["a", "b"], ["a"], 1), "c")).toEqual(["a", "b", "c"]);
  });
  it("with nothing pending the cache wins (also after a rollback)", () => {
    expect(toggleMirror(["a", "b"], ["a"], 0)).toEqual(["a"]);
    expect(toggleMirror<string[] | undefined>(["a"], undefined, 0)).toBeUndefined();
  });
});

describe("createToggleChain (two taps in one render)", () => {
  it("the second tap builds on the first, not on the rendered value", () => {
    const chain = createToggleChain<string[] | undefined>(["a"]);
    expect(chain.apply((prev) => toggleOption(prev, "b"))).toEqual(["a", "b"]);
    // No render in between: the rendered value is still ["a"].
    expect(chain.apply((prev) => toggleOption(prev, "c"))).toEqual(["a", "b", "c"]);
  });
  it("a render hands the chain the rendered value again", () => {
    const chain = createToggleChain<string[] | undefined>(["a"]);
    chain.apply((prev) => toggleOption(prev, "b"));
    chain.sync(["x"]); // e.g. the cache after a rollback
    expect(chain.apply((prev) => toggleOption(prev, "y"))).toEqual(["x", "y"]);
  });
});
