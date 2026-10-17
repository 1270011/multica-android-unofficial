// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MAX_REDACT_INPUT, redactSecrets } from "./redact-secrets";

// One case per pattern of web's redact.ts (13): AWS key, AWS secret, PEM
// (below), GitHub classic + fine-grained, Google, GitLab, API key, Slack,
// JWT, Bearer, connection string, KEY=value.
describe("redactSecrets (copy of web redact.ts)", () => {
  it.each([
    ["AKIAABCDEFGHIJKLMNOP", "[REDACTED AWS KEY]"],
    ["aws_secret_access_key=" + "A1b2C3d4/".repeat(4) + "E5f6", "[REDACTED AWS SECRET]"],
    ["key AIza" + "x".repeat(35) + " end", "[REDACTED GOOGLE API KEY]"],
    ["ghp_" + "a".repeat(36), "[REDACTED GITHUB TOKEN]"],
    ["github_pat_" + "b".repeat(30), "[REDACTED GITHUB TOKEN]"],
    ["glpat-" + "c".repeat(20), "[REDACTED GITLAB TOKEN]"],
    ["sk-" + "d".repeat(30), "[REDACTED API KEY]"],
    ["xoxb-1234567890-abc", "[REDACTED SLACK TOKEN]"],
    ["eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.c2lnbmF0dXJlLXg", "[REDACTED JWT]"],
    ["Authorization: Bearer abc.def-ghi", "Bearer [REDACTED]"],
    ["postgres://user:pw@db:5432/x", "[REDACTED CONNECTION STRING]@"],
    ["export TOKEN=s3cr3t", "[REDACTED CREDENTIAL]"],
    ["DB_PASSWORD: hunter2", "[REDACTED CREDENTIAL]"],
  ])("masks %s", (input, marker) => {
    const out = redactSecrets(input);
    expect(out).toContain(marker);
  });

  it("masks PEM private keys across lines", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----";
    expect(redactSecrets(`key:\n${pem}\nend`)).toBe("key:\n[REDACTED PRIVATE KEY]\nend");
  });

  it("leaves ordinary text alone", () => {
    expect(redactSecrets("ran tests, 42 passed")).toBe("ran tests, 42 passed");
  });
});

// Security review M2: shapes web and server still miss.
describe("redactSecrets, mobile additions (M2)", () => {
  const mul = "mul_" + "a1B2".repeat(10);
  const mat = "mat_" + "Z9y8".repeat(10);
  it.each([
    [`token ${mul} here`, "[REDACTED MULTICA TOKEN]", mul],
    [`MULTICA_TOKEN ${mat}`, "[REDACTED MULTICA TOKEN]", mat],
    [`{"token": "${mul}"}`, "[REDACTED", mul],
    ['{"access_token":"abc123def456"}', '"access_token":"[REDACTED]"', "abc123def456"],
    ['{"api_key": "k-42-secret"}', '"api_key": "[REDACTED]"', "k-42-secret"],
    ['{"client_secret": "s3cr3t value"}', '"client_secret": "[REDACTED]"', "s3cr3t value"],
    ["Authorization: token 0123456789abcdef", "Authorization: [REDACTED]", "0123456789abcdef"],
    ["authorization=Basic dXNlcjpwdw==", "authorization=[REDACTED]", "dXNlcjpwdw=="],
    ["git clone https://bot:hunter2@git.example.org/r.git", "https://[REDACTED]@git.example.org", "hunter2"],
  ])("masks %s", (input, marker, secret) => {
    const out = redactSecrets(input);
    expect(out).toContain(marker);
    expect(out).not.toContain(secret);
  });

  it("masks a PEM key whose END line was cut off", () => {
    const cut = "start\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAA\nAAAAbm9uZQ";
    expect(redactSecrets(cut)).toBe("start\n[REDACTED PRIVATE KEY]");
  });

  it("keeps a complete PEM block and the text after it", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nMII\n-----END PRIVATE KEY-----";
    expect(redactSecrets(`${pem}\nafter`)).toBe("[REDACTED PRIVATE KEY]\nafter");
  });

  it("leaves look-alikes alone", () => {
    for (const text of [
      '{"max_tokens": 1000}',
      "see https://example.org/a:b@c",
      "mul_ short",
      "matrix_123",
      "Authorization header missing",
    ]) {
      expect(redactSecrets(text)).toBe(text);
    }
  });
});

// Security review M3: a prepared 80 KB output must not freeze the JS thread.
describe("redactSecrets stays fast on large input (M3)", () => {
  it("cuts the input to MAX_REDACT_INPUT before matching", () => {
    expect(redactSecrets("x".repeat(MAX_REDACT_INPUT + 500))).toHaveLength(MAX_REDACT_INPUT);
  });
  it("an 80 KB JWT-shaped worst case finishes quickly", () => {
    const evil = ("ey" + "a".repeat(30) + ".").repeat(2600); // ~84 KB of almost-JWTs
    const started = performance.now();
    redactSecrets(evil);
    expect(performance.now() - started).toBeLessThan(250);
  });
});

