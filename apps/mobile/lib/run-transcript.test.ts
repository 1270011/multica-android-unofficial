// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { TaskMessagePayload } from "@multica/core/types";
import { MAX_OUTPUT, buildTranscript, canRetryRun, isRunLive, rerunErrorKey } from "./run-transcript";

const msg = (seq: number, over: Partial<TaskMessagePayload>): TaskMessagePayload =>
  ({ task_id: "t", issue_id: "i", seq, type: "text", ...over }) as TaskMessagePayload;

describe("buildTranscript", () => {
  it("orders by seq, merges text chunks, keeps the last duplicate", () => {
    const blocks = buildTranscript([
      msg(3, { content: "world" }),
      msg(1, { content: "Hel" }),
      msg(2, { content: "lo " }),
      msg(2, { content: "lo, " }),
    ]);
    expect(blocks).toEqual([{ kind: "text", text: "Hello, world" }]);
  });

  it("tool use shows the meaningful input, results are cut", () => {
    const long = "x".repeat(MAX_OUTPUT + 10);
    const blocks = buildTranscript([
      msg(1, { type: "thinking", content: "plan" }),
      msg(2, { type: "tool_use", tool: "Bash", input: { command: "ls   -la", timeout: 5 } }),
      msg(3, { type: "tool_result", tool: "Bash", output: long }),
      msg(4, { type: "tool_use", tool: "Other", input: { a: 1 } }),
      msg(5, { type: "error", content: "boom" }),
    ]);
    expect(blocks[0]).toEqual({ kind: "thinking", text: "plan" });
    expect(blocks[1]).toEqual({ kind: "tool", tool: "Bash", input: "ls -la" });
    expect(blocks[2]).toMatchObject({ kind: "result", truncated: true });
    expect((blocks[2] as { output: string }).output.length).toBe(MAX_OUTPUT + 1);
    expect(blocks[3]).toEqual({ kind: "tool", tool: "Other", input: '{"a":1}' });
    expect(blocks[4]).toEqual({ kind: "error", text: "boom" });
  });

  it("text after a tool starts a new paragraph", () => {
    const blocks = buildTranscript([
      msg(1, { content: "a" }),
      msg(2, { type: "tool_use", tool: "T" }),
      msg(3, { content: "b" }),
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(["text", "tool", "text"]);
  });
});

describe("redaction in the transcript", () => {
  it("masks secrets in text, thinking, tool input, output and errors", () => {
    const secret = "ghp_" + "a".repeat(36);
    const blocks = buildTranscript([
      msg(1, { content: `token ${secret.slice(0, 20)}` }),
      msg(2, { content: `${secret.slice(20)} done` }), // split across chunks
      msg(3, { type: "thinking", content: `use ${secret}` }),
      msg(4, { type: "tool_use", tool: "Bash", input: { command: "export TOKEN=abc123 && run" } }),
      msg(5, { type: "tool_use", tool: "Http", input: { headers: { Authorization: "Bearer xyz.123" } } }),
      msg(6, { type: "tool_result", tool: "Bash", output: `AWS AKIAABCDEFGHIJKLMNOP ${"y".repeat(MAX_OUTPUT)}` }),
      msg(7, { type: "error", content: "failed: postgres://u:pw@h/db" }),
    ]);
    const all = JSON.stringify(blocks);
    expect(all).not.toContain(secret);
    expect(all).not.toContain("abc123");
    expect(all).not.toContain("xyz.123");
    expect(all).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(all).not.toContain(":pw@");
    expect(blocks[0]).toEqual({ kind: "text", text: "token [REDACTED GITHUB TOKEN] done" });
  });
});

describe("re-run rules (web parity)", () => {
  it("only failed or cancelled runs", () => {
    expect(canRetryRun({ status: "failed" })).toBe(true);
    expect(canRetryRun({ status: "cancelled" })).toBe(true);
    expect(canRetryRun({ status: "completed" })).toBe(false);
    expect(canRetryRun({ status: "running" })).toBe(false);
  });
  it("explains blocked and triage re-runs separately", () => {
    expect(rerunErrorKey({ body: { reason_code: "invocation_not_allowed" } })).toBe("runs.retry_blocked");
    expect(rerunErrorKey({ status: 403, body: { reason_code: "issue_in_triage" } })).toBe("runs.retry_triage");
    expect(rerunErrorKey({ status: 400, body: { code: "issue_in_triage", error: "x" } })).toBe("runs.retry_triage");
    expect(rerunErrorKey(new Error("network"))).toBe("runs.retry_failed");
    expect(rerunErrorKey(null)).toBe("runs.retry_failed");
  });
  it("live runs poll", () => {
    expect(isRunLive({ status: "running" })).toBe(true);
    expect(isRunLive({ status: "completed" })).toBe(false);
  });
});
