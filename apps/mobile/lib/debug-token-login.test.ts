import { describe, expect, it } from "vitest";
import { looksLikeToken, tokenFromFileText } from "./debug-token-login";

describe("debug token login helpers", () => {
  it("reads the first non-empty trimmed line of the token file", () => {
    expect(tokenFromFileText("\n  \n  mtk_abcdefghijklmnop  \nsecond\n")).toBe(
      "mtk_abcdefghijklmnop",
    );
    expect(tokenFromFileText("")).toBeNull();
    expect(tokenFromFileText(null)).toBeNull();
    expect(tokenFromFileText("   \n\n")).toBeNull();
  });

  it("rejects obviously wrong token input", () => {
    expect(looksLikeToken("short")).toBe(false);
    expect(looksLikeToken("has white space inside here")).toBe(false);
    expect(looksLikeToken("mtk_0123456789abcdef0123")).toBe(true);
    expect(looksLikeToken("  mtk_0123456789abcdef0123\n")).toBe(true);
  });
});
