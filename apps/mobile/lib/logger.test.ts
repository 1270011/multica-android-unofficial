import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_LOG_STRING, REDACTED, TRUNCATED, logger, redact, redactString, MAX_LOG_ITEMS } from "./logger";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl";

describe("redact", () => {
  it("masks values under secret-looking keys at any depth", () => {
    expect(
      redact({
        token: "abc",
        nested: { cfClientSecret: "s", "CF-Access-Client-Id": "i", Authorization: "Bearer x" },
        received: { token: "t" },
        list: [{ password: "p", ok: 1 }],
        status: 200,
      }),
    ).toEqual({
      token: REDACTED,
      nested: { cfClientSecret: REDACTED, "CF-Access-Client-Id": REDACTED, Authorization: REDACTED },
      received: REDACTED,
      list: [{ password: REDACTED, ok: 1 }],
      status: 200,
    });
  });

  it("masks credentials inside strings and error messages", () => {
    expect(redactString(`refresh ok ${JWT}`)).toBe(`refresh ok ${REDACTED}`);
    expect(redactString("Authorization: Bearer mul_1234567890abcdef")).toBe(
      `Authorization: ${REDACTED}`,
    );
    expect(redactString("wss://h/ws?token=abc&x=1")).toBe(`wss://h/ws?token=${REDACTED}&x=1`);
    expect(redactString(`CF-Access-Client-Secret: ${"f".repeat(64)}`)).toBe(
      `CF-Access-Client-Secret: ${REDACTED}`,
    );
    expect(redact(new Error(`bad ${JWT}`))).toEqual({ name: "Error", message: `bad ${REDACTED}` });
  });

  it("masks the review's gap cases (S2): JSON, env, Basic auth, CF id keys", () => {
    const secret = "f".repeat(64);
    const out = (text: string) => {
      const r = redactString(text);
      expect(r).not.toContain(secret);
      expect(r).not.toContain("abc123.access");
      return r;
    };
    expect(out(`{"CF-Access-Client-Secret":"${secret}"}`)).toBe(
      `{"CF-Access-Client-Secret":"${REDACTED}"}`,
    );
    expect(out(`{\\"CF-Access-Client-Secret\\":\\"${secret}\\"}`)).toContain(REDACTED);
    expect(out(`CF_ACCESS_CLIENT_SECRET=${secret}`)).toBe(`CF_ACCESS_CLIENT_SECRET=${REDACTED}`);
    expect(out(`CF_ACCESS_CLIENT_ID=abc123.access`)).toBe(`CF_ACCESS_CLIENT_ID=${REDACTED}`);
    expect(out(`cf-access-client-id: 'abc123.access'`)).toBe(`cf-access-client-id: '${REDACTED}'`);
    expect(out(`{"client_secret": "${secret}", "ok": 1}`)).toBe(
      `{"client_secret": "${REDACTED}", "ok": 1}`,
    );
    const basic = "dXNlcjpwYXNzd29yZA==";
    expect(redactString(`Authorization: Basic ${basic}`)).toBe(`Authorization: ${REDACTED}`);
    expect(redactString(`{"authorization":"Basic ${basic}"}`)).not.toContain(basic);
    expect(
      redact({ CF_ACCESS_CLIENT_ID: "abc123.access", cfClientId: "abc123.access", cf_access_x: 1 }),
    ).toEqual({ CF_ACCESS_CLIENT_ID: REDACTED, cfClientId: REDACTED, cf_access_x: REDACTED });
  });

  it("stays fast on hostile input (review: ReDoS) and cuts long strings", () => {
    for (const input of ["a".repeat(50_000), "token".repeat(10_000), "x-token-".repeat(6_250), `${"secret".repeat(8_000)}: `]) {
      const start = performance.now();
      const out = redactString(input);
      // Generous for a loaded CI runner; the old ReDoS took seconds.
      expect(performance.now() - start, input.slice(0, 12)).toBeLessThan(250);
      expect(out.length).toBeLessThanOrEqual(MAX_LOG_STRING + TRUNCATED.length);
    }
    expect(redactString("b".repeat(MAX_LOG_STRING + 1)).endsWith(TRUNCATED)).toBe(true);
    expect(redactString("short")).toBe("short");
  });

  it("does not mask ordinary text that only mentions tokens or authorization", () => {
    for (const text of [
      "Refreshing tokens: 3 pending",
      "max_tokens=1000",
      "secret: none configured",
      "Authorization: failed for user x",
      "password: required",
    ]) {
      expect(redactString(text)).toBe(text);
    }
  });

  it("still masks credential-looking bare values and any quoted value", () => {
    expect(redactString("access_token=abcdefghijklmnop1234")).toBe(`access_token=${REDACTED}`);
    expect(redactString(`{"password":"p"}`)).toBe(`{"password":"${REDACTED}"}`);
    expect(redactString("Authorization: Token abc")).toBe(`Authorization: ${REDACTED}`);
    expect(redactString("Authorization: Digest abc")).toBe(`Authorization: ${REDACTED}`);
    expect(redactString("Authorization: dXNlcjpwYXNzd29yZA==")).toBe(`Authorization: ${REDACTED}`);
    expect(redactString("wss://h/ws?token=abc&x=1")).toBe(`wss://h/ws?token=${REDACTED}&x=1`);
  });

  it("leaves ordinary log text alone", () => {
    expect(redactString("GET /api/issues 200 in 12ms")).toBe("GET /api/issues 200 in 12ms");
    expect(redactString("token expired, refreshing")).toBe("token expired, refreshing");
  });

  it("survives cycles", () => {
    const a: Record<string, unknown> = { x: 1 };
    a.self = a;
    expect(redact(a)).toEqual({ x: 1, self: "[circular]" });
  });
});

describe("redact, security review N1", () => {
  it("masks api keys, credentials, JWT and OTP fields", () => {
    expect(
      redact({ api_key: "k", apiKey: "k", credential: "c", credentials: { u: 1 }, jwt: "j", otp: "123456", login_code: "1" }),
    ).toEqual({
      api_key: REDACTED,
      apiKey: REDACTED,
      credential: REDACTED,
      credentials: REDACTED,
      jwt: REDACTED,
      otp: REDACTED,
      login_code: REDACTED,
    });
  });
  it("keeps error codes readable, masks only a 6-digit code string", () => {
    expect(redact({ code: "ECONNREFUSED" })).toEqual({ code: "ECONNREFUSED" });
    expect(redact({ code: 401 })).toEqual({ code: 401 });
    expect(redact({ code: 1006 })).toEqual({ code: 1006 });
    expect(redact({ code: "123456" })).toEqual({ code: REDACTED });
  });
  it("logs at most MAX_LOG_ITEMS items and keys per level", () => {
    const list = Array.from({ length: 250 }, (_, i) => i);
    const out = redact(list) as unknown[];
    expect(out).toHaveLength(MAX_LOG_ITEMS + 1);
    expect(out[MAX_LOG_ITEMS]).toBe("[… 150 more]");
    const wide = Object.fromEntries(list.map((i) => [`k${i}`, i]));
    const obj = redact(wide) as Record<string, unknown>;
    expect(Object.keys(obj)).toHaveLength(MAX_LOG_ITEMS + 1);
    expect(obj["…"]).toBe("150 more keys");
  });
  it("an object referenced twice side by side is not circular", () => {
    const shared = { id: 1 };
    expect(redact({ a: shared, b: shared })).toEqual({ a: { id: 1 }, b: { id: 1 } });
    expect(redact([shared, shared])).toEqual([{ id: 1 }, { id: 1 }]);
  });
});

describe("logger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("redacts before writing to the console", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("[api] failed", { body: { access_token: JWT }, msg: `x ${JWT}` });
    const written = JSON.stringify(warn.mock.calls);
    expect(written).not.toContain(JWT);
    expect(written).toContain("[api] failed");
  });
});
