/**
 * Run transcript of one agent task for the Runs sheet:
 * `GET /api/tasks/{id}/messages` reduced to readable blocks, like web's
 * execution log. Pure, unit-tested.
 *
 * - ordered by `seq` (duplicates by seq dropped, the last one wins)
 * - consecutive `text` chunks merge into one paragraph
 * - `thinking` stays its own (collapsed in the UI) block
 * - `tool_use` shows the tool name and a one-line input summary
 * - `tool_result` output is cut at MAX_OUTPUT characters
 * - `error` is shown as an error block
 * - every shown string (text, thinking, tool input, output, error) goes
 *   through redactSecrets first, before any cut, like web's
 *   build-timeline.ts
 */
import type { AgentTask, TaskMessagePayload } from "@multica/core/types";
import { redactSecrets } from "./redact-secrets";

export const MAX_OUTPUT = 2000;
export const MAX_INPUT_SUMMARY = 160;

export type TranscriptBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; tool: string; input: string }
  | { kind: "result"; tool: string; output: string; truncated: boolean }
  | { kind: "error"; text: string };

function inputSummary(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  const preferred = ["command", "path", "file_path", "pattern", "query", "url", "description"];
  for (const key of preferred) {
    const v = input[key];
    if (typeof v === "string" && v.trim()) {
      return clip(redactSecrets(v.trim()).replace(/\s+/g, " "), MAX_INPUT_SUMMARY);
    }
  }
  let raw = "";
  try {
    raw = JSON.stringify(input);
  } catch {
    raw = "";
  }
  return raw === "{}" ? "" : clip(redactSecrets(raw), MAX_INPUT_SUMMARY);
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function buildTranscript(messages: readonly TaskMessagePayload[]): TranscriptBlock[] {
  const bySeq = new Map<number, TaskMessagePayload>();
  for (const m of messages) bySeq.set(m.seq, m);
  const ordered = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  const blocks: TranscriptBlock[] = [];
  for (const m of ordered) {
    const last = blocks[blocks.length - 1];
    switch (m.type) {
      case "text": {
        // Raw here; redacted after merging, so a secret split across two
        // streamed chunks is still caught.
        const text = m.content ?? "";
        if (!text) break;
        if (last?.kind === "text") last.text += text;
        else blocks.push({ kind: "text", text });
        break;
      }
      case "thinking":
        if (m.content) blocks.push({ kind: "thinking", text: redactSecrets(m.content) });
        break;
      case "tool_use":
        blocks.push({ kind: "tool", tool: m.tool ?? "tool", input: inputSummary(m.input) });
        break;
      case "tool_result": {
        const output = redactSecrets(m.output ?? m.content ?? "");
        blocks.push({
          kind: "result",
          tool: m.tool ?? "",
          output: clip(output, MAX_OUTPUT),
          truncated: output.length > MAX_OUTPUT,
        });
        break;
      }
      case "error":
        blocks.push({ kind: "error", text: redactSecrets(m.content ?? m.output ?? "") });
        break;
    }
  }
  for (const block of blocks) {
    if (block.kind === "text") block.text = redactSecrets(block.text);
  }
  return blocks;
}

/** Web's canRetryRun: only terminal-but-not-success runs can be re-run. */
export function canRetryRun(task: Pick<AgentTask, "status">): boolean {
  return task.status === "failed" || task.status === "cancelled";
}

/**
 * i18n key (issues namespace) for a failed re-run. `invocation_not_allowed`
 * as in web's RetryRunButton; `issue_in_triage` arrives as 403
 * `reason_code` or as 400 `code` (handler/issue_triage_guard.go).
 */
export function rerunErrorKey(err: unknown): string {
  const body = (err as { body?: unknown } | null)?.body;
  const fields = body && typeof body === "object" ? (body as { reason_code?: unknown; code?: unknown }) : {};
  const code = typeof fields.reason_code === "string" ? fields.reason_code : fields.code;
  if (code === "invocation_not_allowed") return "runs.retry_blocked";
  if (code === "issue_in_triage") return "runs.retry_triage";
  return "runs.retry_failed";
}

/** Runs still producing messages: the transcript polls while open. */
export function isRunLive(task: Pick<AgentTask, "status">): boolean {
  return task.status === "queued" || task.status === "dispatched" || task.status === "running";
}
