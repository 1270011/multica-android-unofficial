import { describe, expect, it } from "vitest";
import authDe from "../locales/de/auth.json";
import authEn from "../locales/en/auth.json";
import authZh from "../locales/zh-Hans/auth.json";
import issuesDe from "../locales/de/issues.json";
import issuesEn from "../locales/en/issues.json";
import issuesZh from "../locales/zh-Hans/issues.json";
import { tokenLoginErrorKey } from "./auth-error";

const named = (name: string, message = "x") => Object.assign(new Error(message), { name });

// a Cloudflare Access block is not
// "the server rejected this token".
describe("tokenLoginErrorKey", () => {
  it("names a Cloudflare Access block", () => {
    expect(tokenLoginErrorKey(named("AccessBlockedError", "Cloudflare Access blocked the request"))).toBe(
      "server.access_blocked",
    );
  });
  it("treats the client timeout (ApiError status 0, data/api.ts) as network", () => {
    const timeout = Object.assign(new Error("Request timed out after 15000ms"), { name: "ApiError", status: 0 });
    expect(tokenLoginErrorKey(timeout)).toBe("verify.network");
  });
  it("names a network problem", () => {
    expect(tokenLoginErrorKey(new TypeError("Network request failed"))).toBe("verify.network");
    expect(tokenLoginErrorKey(named("TimeoutError", "Request timeout"))).toBe("verify.network");
  });
  it("stays generic for a rejected token and anything else", () => {
    expect(tokenLoginErrorKey(named("ApiError", "unauthorized: token abc"))).toBe("token_login.failed");
    // An ApiError whose text happens to mention the network is still a server answer.
    expect(tokenLoginErrorKey(named("ApiError", "network policy"))).toBe("token_login.failed");
    expect(tokenLoginErrorKey("boom")).toBe("token_login.failed");
  });
});

describe("J1 strings", () => {
  for (const [lang, auth, issues] of [
    ["de", authDe, issuesDe],
    ["en", authEn, issuesEn],
    ["zh-Hans", authZh, issuesZh],
  ] as const) {
    it(`${lang} has the new keys`, () => {
      const a = auth as unknown as { verify: Record<string, string>; server: Record<string, string> };
      const i = issues as unknown as { picker: Record<string, string> };
      for (const k of ["paste", "paste_a11y", "paste_none"]) expect(a.verify[k], `${lang}:verify.${k}`).toBeTypeOf("string");
      expect(a.server.access_blocked).toBeTypeOf("string");
      expect(a.server.secret_paste_hint).toBeTypeOf("string");
      expect(i.picker.no_labels_hint).toBeTypeOf("string");
    });
  }
});
