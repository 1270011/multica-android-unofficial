import { describe, expect, it } from "vitest";
import {
  CF_CLIENT_ID_HEADER,
  CF_CLIENT_SECRET_HEADER,
  cfAccessHeaders,
  headersForUrl,
  isServerUrl,
  looksLikeAccessBlock,
  normalizeServerUrl,
  serverLabel,
  validateServerConfig,
  withStoredSecret,
  wsUrlFor,
  type ServerConfig,
} from "./server-config";

const CF: ServerConfig = {
  mode: "cloudflare",
  baseUrl: "https://agent.example.test",
  cfClientId: "id.access",
  cfClientSecret: "secret-value",
};

const DIRECT: ServerConfig = {
  mode: "direct",
  baseUrl: "https://192.0.2.10",
  cfClientId: "",
  cfClientSecret: "",
};

describe("normalizeServerUrl", () => {
  it("adds https:// when the scheme is missing", () => {
    expect(normalizeServerUrl("agent.example.test")).toBe("https://agent.example.test");
  });

  it("keeps an explicit port and strips trailing slashes, query and hash", () => {
    expect(normalizeServerUrl("https://192.0.2.10:8443/?x=1#y")).toBe(
      "https://192.0.2.10:8443",
    );
    expect(normalizeServerUrl("http://host/api///")).toBe("http://host/api");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeServerUrl("  https://host  ")).toBe("https://host");
  });

  it("rejects empty, non-http and garbage input", () => {
    expect(normalizeServerUrl("")).toBeNull();
    expect(normalizeServerUrl("   ")).toBeNull();
    expect(normalizeServerUrl("ftp://host")).toBeNull();
    expect(normalizeServerUrl("https://")).toBeNull();
    expect(normalizeServerUrl("not a url")).toBeNull();
  });
});

describe("validateServerConfig", () => {
  it("accepts a complete Cloudflare config and trims fields", () => {
    const result = validateServerConfig({
      mode: "cloudflare",
      baseUrl: " agent.example.test/ ",
      cfClientId: " id ",
      cfClientSecret: " secret ",
    });
    expect(result).toEqual({
      ok: true,
      config: {
        mode: "cloudflare",
        baseUrl: "https://agent.example.test",
        cfClientId: "id",
        cfClientSecret: "secret",
      },
    });
  });

  it("requires both token halves in Cloudflare mode", () => {
    expect(
      validateServerConfig({ mode: "cloudflare", baseUrl: "https://h", cfClientId: "", cfClientSecret: "s" }),
    ).toEqual({ ok: false, error: "cf_client_id_missing" });
    expect(
      validateServerConfig({ mode: "cloudflare", baseUrl: "https://h", cfClientId: "i", cfClientSecret: " " }),
    ).toEqual({ ok: false, error: "cf_client_secret_missing" });
  });

  it("ignores token fields in direct mode and clears them", () => {
    expect(
      validateServerConfig({ mode: "direct", baseUrl: "192.0.2.10", cfClientId: "x", cfClientSecret: "y" }),
    ).toEqual({ ok: true, config: DIRECT });
  });

  it("reports missing, wrong-scheme and invalid URLs separately", () => {
    expect(validateServerConfig({ mode: "direct", baseUrl: "", cfClientId: "", cfClientSecret: "" })).toEqual({
      ok: false,
      error: "url_missing",
    });
    expect(
      validateServerConfig({ mode: "direct", baseUrl: "ftp://host", cfClientId: "", cfClientSecret: "" }),
    ).toEqual({ ok: false, error: "url_scheme" });
    expect(
      validateServerConfig({ mode: "direct", baseUrl: "https://", cfClientId: "", cfClientSecret: "" }),
    ).toEqual({ ok: false, error: "url_invalid" });
  });
});

describe("cfAccessHeaders", () => {
  it("emits both Access headers in Cloudflare mode", () => {
    expect(cfAccessHeaders(CF)).toEqual({
      [CF_CLIENT_ID_HEADER]: "id.access",
      [CF_CLIENT_SECRET_HEADER]: "secret-value",
    });
  });

  it("emits nothing in direct mode, for a missing config, or an incomplete token", () => {
    expect(cfAccessHeaders(DIRECT)).toEqual({});
    expect(cfAccessHeaders(null)).toEqual({});
    expect(cfAccessHeaders({ ...CF, cfClientSecret: "" })).toEqual({});
  });
});

describe("headersForUrl / isServerUrl", () => {
  it("only attaches the token to same-origin URLs", () => {
    expect(headersForUrl("https://agent.example.test/api/attachments/1/download", CF)).toEqual(
      cfAccessHeaders(CF),
    );
    expect(headersForUrl("https://cdn.example.test/a.png", CF)).toEqual({});
    expect(headersForUrl("https://agent.example.test:444/x", CF)).toEqual({});
    expect(headersForUrl("http://agent.example.test/x", CF)).toEqual({});
  });

  it("never attaches headers in direct mode", () => {
    expect(headersForUrl("https://192.0.2.10/api/x", DIRECT)).toEqual({});
  });

  it("treats relative and malformed URLs as foreign", () => {
    expect(isServerUrl("/api/x", CF.baseUrl)).toBe(false);
    expect(isServerUrl("mc://file/1", CF.baseUrl)).toBe(false);
  });
});

describe("wsUrlFor / serverLabel", () => {
  it("derives the realtime URL from the base URL", () => {
    expect(wsUrlFor("https://agent.example.test")).toBe("wss://agent.example.test/ws");
    expect(wsUrlFor("http://10.0.0.1:8080/prefix")).toBe("ws://10.0.0.1:8080/prefix/ws");
  });

  it("labels the server without the scheme", () => {
    expect(serverLabel(CF)).toBe("agent.example.test");
    expect(serverLabel(null)).toBe("");
  });
});

describe("looksLikeAccessBlock", () => {
  const requestUrl = "https://agent.example.test/api/me";

  it("recognises the followed redirect to the Access login page", () => {
    expect(
      looksLikeAccessBlock({
        status: 200,
        url: "https://team.cloudflareaccess.com/cdn-cgi/access/login/agent.example.test?kid=1",
        contentType: "text/html; charset=utf-8",
        requestUrl,
      }),
    ).toBe(true);
  });

  it("recognises an un-followed 302/403 that serves HTML", () => {
    expect(looksLikeAccessBlock({ status: 302, url: requestUrl, contentType: "text/html", requestUrl })).toBe(true);
    expect(looksLikeAccessBlock({ status: 403, url: null, contentType: "text/html", requestUrl })).toBe(true);
  });

  it("recognises a cross-origin landing even without the Access hostname", () => {
    expect(
      looksLikeAccessBlock({ status: 200, url: "https://elsewhere.test/login", contentType: "text/html", requestUrl }),
    ).toBe(true);
  });

  it("recognises the login page by its body or by a Cloudflare-served HTML page when the URL is not exposed", () => {
    expect(
      looksLikeAccessBlock({
        status: 200,
        url: requestUrl,
        contentType: "text/html; charset=UTF-8",
        bodyStart: "<!DOCTYPE html> <html><head><title>Sign in ・ Cloudflare Access</title>",
        requestUrl,
      }),
    ).toBe(true);
    expect(
      looksLikeAccessBlock({
        status: 200,
        url: "",
        contentType: "text/html; charset=UTF-8",
        server: "cloudflare",
        requestUrl,
      }),
    ).toBe(true);
    // Plain HTML from a non-Cloudflare host (e.g. a wrong LAN address) is not an Access block.
    expect(
      looksLikeAccessBlock({
        status: 200,
        url: requestUrl,
        contentType: "text/html",
        server: "nginx",
        bodyStart: "<html><body>It works</body></html>",
        requestUrl,
      }),
    ).toBe(false);
  });

  it("leaves genuine Multica answers alone", () => {
    expect(looksLikeAccessBlock({ status: 200, url: requestUrl, contentType: "application/json", requestUrl })).toBe(false);
    expect(looksLikeAccessBlock({ status: 401, url: requestUrl, contentType: "application/json", requestUrl })).toBe(false);
    expect(looksLikeAccessBlock({ status: 404, url: requestUrl, contentType: "text/html", requestUrl })).toBe(false);
    expect(looksLikeAccessBlock({ status: 500, url: "", contentType: null, requestUrl })).toBe(false);
  });
});

describe("withStoredSecret (S3: stored secret is never prefilled)", () => {
  const draft = { mode: "cloudflare" as const, baseUrl: CF.baseUrl, cfClientId: CF.cfClientId, cfClientSecret: "" };

  it("fills an empty draft secret from the stored config while kept", () => {
    const merged = withStoredSecret(draft, CF, true);
    expect(merged.cfClientSecret).toBe("secret-value");
    expect(validateServerConfig(merged).ok).toBe(true);
  });

  it("does not fill once the user chose to replace it", () => {
    expect(withStoredSecret(draft, CF, false).cfClientSecret).toBe("");
    expect(validateServerConfig(withStoredSecret(draft, CF, false))).toEqual({
      ok: false,
      error: "cf_client_secret_missing",
    });
  });

  it("never overrides a newly typed secret or fills across modes", () => {
    expect(withStoredSecret({ ...draft, cfClientSecret: "new" }, CF, true).cfClientSecret).toBe("new");
    expect(withStoredSecret(draft, DIRECT, true).cfClientSecret).toBe("");
    expect(withStoredSecret({ ...draft, mode: "direct" }, CF, true).cfClientSecret).toBe("");
    expect(withStoredSecret(draft, null, true).cfClientSecret).toBe("");
  });
});
