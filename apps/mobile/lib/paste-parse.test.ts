import { describe, expect, it } from "vitest";
import {
  cleanPasted,
  formatHint,
  containsCfSecret,
  interpretPaste,
  parseCfHeaderBlock,
} from "./paste-parse";

const ID = "0a1b2c3d4e5f60718293a4b5c6d7e8f9.access";
const SECRET = "f".repeat(64);

describe("cleanPasted", () => {
  it("trims whitespace and newlines around a value", () => {
    expect(cleanPasted(`\n  ${ID}  \n`, "cfClientId")).toBe(ID);
  });

  it("drops a leading header name for the matching field only", () => {
    expect(cleanPasted(`CF-Access-Client-Id: ${ID}`, "cfClientId")).toBe(ID);
    expect(cleanPasted(`CF-Access-Client-Secret: ${SECRET}`, "cfClientSecret")).toBe(SECRET);
    expect(cleanPasted(`-H "CF-Access-Client-Secret: ${SECRET}"`, "cfClientSecret")).toBe(SECRET);
  });

  it("strips Bearer from tokens and spaces from login codes", () => {
    expect(cleanPasted("Bearer mul_abcdefgh12345678", "token")).toBe("mul_abcdefgh12345678");
    expect(cleanPasted(" 123 456 ", "code")).toBe("123456");
  });
});

describe("parseCfHeaderBlock", () => {
  it("reads the two dashboard lines", () => {
    expect(
      parseCfHeaderBlock(`CF-Access-Client-Id: ${ID}\nCF-Access-Client-Secret: ${SECRET}\n`),
    ).toEqual({ cfClientId: ID, cfClientSecret: SECRET });
  });

  it("reads a curl command and env-style lines", () => {
    expect(
      parseCfHeaderBlock(
        `curl -H "CF-Access-Client-Id: ${ID}" -H "CF-Access-Client-Secret: ${SECRET}" https://x`,
      ),
    ).toEqual({ cfClientId: ID, cfClientSecret: SECRET });
    expect(
      parseCfHeaderBlock(`CF_ACCESS_CLIENT_SECRET=${SECRET}\nCF_ACCESS_CLIENT_ID=${ID}`),
    ).toEqual({ cfClientId: ID, cfClientSecret: SECRET });
  });

  it("needs both values", () => {
    expect(parseCfHeaderBlock(`CF-Access-Client-Id: ${ID}`)).toBeNull();
    expect(parseCfHeaderBlock(SECRET)).toBeNull();
  });
});

describe("formatHint", () => {
  it("accepts dashboard-shaped values and warns otherwise", () => {
    expect(formatHint("cfClientId", ID)).toBe("ok");
    expect(formatHint("cfClientId", "abc")).toBe("client_id_format");
    expect(formatHint("cfClientSecret", SECRET)).toBe("ok");
    expect(formatHint("cfClientSecret", "short")).toBe("secret_format");
    expect(formatHint("url", "multica.example.com")).toBe("ok");
    expect(formatHint("url", "not a url")).toBe("url_format");
    expect(formatHint("cfClientId", "")).toBe("empty");
  });
});

describe("interpretPaste", () => {
  it("reports an empty clipboard", () => {
    expect(interpretPaste("", "cfClientSecret")).toEqual({ kind: "empty" });
    expect(interpretPaste(null, "url")).toEqual({ kind: "empty" });
    expect(interpretPaste("  \n", "cfClientId")).toEqual({ kind: "empty" });
  });

  it("prefers a header block on either Cloudflare field", () => {
    const block = `CF-Access-Client-Id: ${ID}\nCF-Access-Client-Secret: ${SECRET}`;
    for (const target of ["cfClientId", "cfClientSecret"] as const) {
      expect(interpretPaste(block, target)).toEqual({
        kind: "block",
        values: { cfClientId: ID, cfClientSecret: SECRET },
      });
    }
  });

  it("applies a header block pasted into the URL field instead of showing it there", () => {
    const r = interpretPaste(`CF-Access-Client-Id: ${ID}\nCF-Access-Client-Secret: ${SECRET}`, "url");
    expect(r).toEqual({ kind: "block", values: { cfClientId: ID, cfClientSecret: SECRET } });
  });

  it("takes a JSON header object as a block, in any field", () => {
    const json = `{"CF-Access-Client-Id":"${ID}","CF-Access-Client-Secret":"${SECRET}"}`;
    for (const target of ["url", "cfClientId", "cfClientSecret"] as const) {
      expect(interpretPaste(json, target)).toEqual({
        kind: "block",
        values: { cfClientId: ID, cfClientSecret: SECRET },
      });
    }
  });

  it("never puts a lone secret header into the URL or Client ID field", () => {
    for (const raw of [
      `CF-Access-Client-Secret: ${SECRET}`,
      `CF_ACCESS_CLIENT_SECRET=${SECRET}`,
      `-H "cf-access-client-secret: ${SECRET}"`,
      `{"CF-Access-Client-Secret":"${SECRET}"}`,
    ]) {
      expect(interpretPaste(raw, "url"), raw).toEqual({ kind: "secret_rejected" });
      expect(interpretPaste(raw, "cfClientId"), raw).toEqual({ kind: "secret_rejected" });
    }
    expect(interpretPaste(`CF-Access-Client-Secret: ${SECRET}`, "cfClientSecret")).toEqual({
      kind: "value",
      value: SECRET,
      hint: "ok",
    });
  });

  it("containsCfSecret matches every spelling, not the Client ID", () => {
    expect(containsCfSecret(`cf_access_client_secret=${SECRET}`)).toBe(true);
    expect(containsCfSecret("CFAccessClientSecret")).toBe(true);
    expect(containsCfSecret(`CF-Access-Client-Id: ${ID}`)).toBe(false);
    expect(containsCfSecret(null)).toBe(false);
  });

  it("returns a single value with a hint that never contains the value", () => {
    const r = interpretPaste(`  ${SECRET}x `, "cfClientSecret");
    expect(r).toEqual({ kind: "value", value: `${SECRET}x`, hint: "secret_format" });
    if (r.kind === "value") expect(r.hint).not.toContain(SECRET);
  });
});
