/**
 * Mobile zod schemas + fallbacks for autopilots.
 *
 * Shapes follow packages/core/types/autopilot.ts (upstream v0.6.1) and the
 * server handlers in server/internal/handler/autopilot.go. Core keeps the
 * open enums as plain `z.string()`; mobile normalizes them instead, so the
 * screens can switch exhaustively and still show the raw text for a
 * value from a newer server:
 *
 * - `status`, `execution_mode`, `assignee_type`, run `status` / `source` and
 *   trigger `kind` read an unknown value as "unknown"; the server's value
 *   stays in the matching `raw_*` field.
 * - Run status `skipped` (runtime offline at dispatch, MUL-1899) is its own
 *   value, never folded into success or failure.
 * - `trigger_kinds` is normalized entry by entry, `raw_trigger_kinds` keeps
 *   the server strings in the same order.
 * - Lists are validated row by row: a malformed row is dropped and counted,
 *   the rest of the list survives (same idea as wakeup-schemas.ts).
 * - Trigger webhook token/path/URL are dropped on purpose: W1 never shows
 *   them, so they are not kept in the query cache.
 * - Every object is `.loose()` so additive server fields pass through.
 */
import { z } from "zod";
import type {
  Autopilot,
  AutopilotAssigneeType,
  AutopilotCollaborator,
  AutopilotExecutionMode,
  AutopilotRun,
  AutopilotRunSource,
  AutopilotRunStatus,
  AutopilotStatus,
  AutopilotTrigger,
  AutopilotTriggerKind,
} from "@multica/core/types";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types: core types with the open enums widened by "unknown".
// ---------------------------------------------------------------------------

export type AutopilotStatusValue = AutopilotStatus | "unknown";
export type AutopilotExecutionModeValue = AutopilotExecutionMode | "unknown";
export type AutopilotAssigneeTypeValue = AutopilotAssigneeType | "unknown";
export type AutopilotTriggerKindValue = AutopilotTriggerKind | "unknown";
export type AutopilotRunStatusValue = AutopilotRunStatus | "unknown";
export type AutopilotRunSourceValue = AutopilotRunSource | "unknown";

/** Statuses a client may set via PATCH (pause / resume). */
export type AutopilotSettableStatus = Extract<AutopilotStatus, "active" | "paused">;

export type MobileAutopilot = Omit<
  Autopilot,
  "status" | "execution_mode" | "assignee_type" | "trigger_kinds" | "last_run_status"
> & {
  status: AutopilotStatusValue;
  raw_status: string;
  execution_mode: AutopilotExecutionModeValue;
  assignee_type: AutopilotAssigneeTypeValue;
  /** List endpoint only; [] elsewhere and on older servers. */
  trigger_kinds: AutopilotTriggerKindValue[];
  raw_trigger_kinds: string[];
  /** Open string (run status taxonomy); classify with `autopilotRunStatusOf`. */
  last_run_status: string | null;
};

export type MobileAutopilotTrigger = Omit<
  AutopilotTrigger,
  "kind" | "webhook_token" | "webhook_path" | "webhook_url"
> & {
  kind: AutopilotTriggerKindValue;
  raw_kind: string;
};

export type MobileAutopilotRun = Omit<AutopilotRun, "status" | "source"> & {
  status: AutopilotRunStatusValue;
  raw_status: string;
  source: AutopilotRunSourceValue;
  raw_source: string;
};

export interface MobileAutopilotList {
  autopilots: MobileAutopilot[];
  total: number;
}

export interface MobileAutopilotDetail {
  autopilot: MobileAutopilot;
  triggers: MobileAutopilotTrigger[];
  collaborators: AutopilotCollaborator[];
}

export interface MobileAutopilotRunList {
  runs: MobileAutopilotRun[];
  /** The server reports the length of this page, not an overall count. */
  total: number;
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function openEnum<const T extends readonly [string, ...string[]]>(values: T) {
  const known = z.enum(values);
  return (v: unknown): T[number] | "unknown" => {
    const parsed = known.safeParse(v);
    return parsed.success ? parsed.data : "unknown";
  };
}

export const autopilotStatusOf = openEnum(["active", "paused", "archived"]);
export const autopilotExecutionModeOf = openEnum(["create_issue", "run_only"]);
export const autopilotTriggerKindOf = openEnum(["schedule", "webhook", "api"]);
export const autopilotRunStatusOf = openEnum([
  "issue_created",
  "running",
  "completed",
  "failed",
  "skipped",
]);
export const autopilotRunSourceOf = openEnum(["schedule", "manual", "webhook", "api"]);
const assigneeTypeOf = openEnum(["agent", "squad"]);

const nullableString = z.string().nullable().catch(null).default(null);
/** null, absent or "" (Go zero value) → null. */
const optionalText = z
  .unknown()
  .transform((v) => (typeof v === "string" && v !== "" ? v : null));

/**
 * Array whose rows are validated one by one. A non-array body fails the
 * whole schema (→ parseWithFallback returns the endpoint's fallback); a
 * malformed row is dropped and only counted in the log, never logged.
 */
function rowsOf<T>(row: z.ZodType<T>, label: string) {
  return z.array(z.unknown()).transform((rows) => {
    const items: T[] = [];
    let dropped = 0;
    for (const r of rows) {
      const parsed = row.safeParse(r);
      if (parsed.success) items.push(parsed.data);
      else dropped += 1;
    }
    if (dropped > 0) logger.warn(`[autopilots] dropped ${dropped} malformed ${label} row(s)`);
    return items;
  });
}

// ---------------------------------------------------------------------------
// Autopilot (list row, detail head, PATCH answer)
// ---------------------------------------------------------------------------

/** `id` stays required: a row without it cannot be keyed or acted on. */
export const AutopilotSchema = z
  .object({
    id: z.string(),
    workspace_id: z.string().catch("").default(""),
    title: z.string().catch("").default(""),
    description: nullableString,
    project_id: nullableString,
    // Older servers (pre-MUL-2429) omit assignee_type; "agent" is the default.
    assignee_type: z
      .unknown()
      .transform((v) => (v === undefined || v === null || v === "" ? "agent" : assigneeTypeOf(v))),
    assignee_id: z.string().catch("").default(""),
    status: z.unknown(),
    pause_reason: optionalText,
    execution_mode: z.unknown().transform(autopilotExecutionModeOf),
    issue_title_template: nullableString,
    created_by_type: z.string().catch("").default(""),
    created_by_id: z.string().catch("").default(""),
    last_run_at: nullableString,
    created_at: z.string().catch("").default(""),
    updated_at: z.string().catch("").default(""),
    trigger_kinds: z.array(z.unknown()).catch([]).default([]),
    next_run_at: nullableString,
    last_run_status: optionalText,
    subscribers: z.array(z.unknown()).catch([]).default([]),
    // undefined = unknown, the server decides (not "denied").
    can_write: z.boolean().optional().catch(undefined),
    can_manage_access: z.boolean().optional().catch(undefined),
  })
  .loose()
  .transform(({ status, trigger_kinds, ...rest }) => {
    const raw_trigger_kinds = trigger_kinds.filter((k): k is string => typeof k === "string");
    return {
      ...rest,
      status: autopilotStatusOf(status),
      raw_status: typeof status === "string" ? status : "",
      trigger_kinds: raw_trigger_kinds.map(autopilotTriggerKindOf),
      raw_trigger_kinds,
    };
  }) as unknown as z.ZodType<MobileAutopilot>;

/** PATCH answers with the stored autopilot; `null` = unusable body. */
export const AutopilotResultSchema = AutopilotSchema.nullable();

export const AutopilotListSchema = z
  .object({
    autopilots: rowsOf(AutopilotSchema, "autopilot"),
    total: z.number().int().nonnegative().catch(0).default(0),
  })
  .loose() as unknown as z.ZodType<MobileAutopilotList>;

export const EMPTY_AUTOPILOT_LIST: MobileAutopilotList = { autopilots: [], total: 0 };

// ---------------------------------------------------------------------------
// Detail: GET /api/autopilots/{id} → {autopilot, triggers, collaborators}
// ---------------------------------------------------------------------------

export const AutopilotTriggerSchema = z
  .object({
    id: z.string(),
    autopilot_id: z.string().catch("").default(""),
    kind: z.unknown(),
    enabled: z.boolean().catch(false).default(false),
    cron_expression: nullableString,
    timezone: nullableString,
    next_run_at: nullableString,
    label: nullableString,
    event_filters: z
      .array(z.object({ event: z.string(), actions: z.array(z.string()).optional() }).loose())
      .nullish()
      .catch(null),
    last_fired_at: nullableString,
    created_at: z.string().catch("").default(""),
    updated_at: z.string().catch("").default(""),
  })
  .loose()
  .transform(({ kind, ...rest }) => {
    // Secret-like (token in the path): never kept in the cache in W1.
    const { webhook_token: _t, webhook_path: _p, webhook_url: _u, ...safe } = rest as typeof rest & {
      webhook_token?: unknown;
      webhook_path?: unknown;
      webhook_url?: unknown;
    };
    return {
      ...safe,
      kind: autopilotTriggerKindOf(kind),
      raw_kind: typeof kind === "string" ? kind : "",
    };
  }) as unknown as z.ZodType<MobileAutopilotTrigger>;

const AutopilotCollaboratorSchema = z
  .object({
    user_type: z.literal("member").catch("member").default("member"),
    user_id: z.string(),
    granted_by: z.string().catch("").default(""),
    created_at: z.string().catch("").default(""),
  })
  .loose() as unknown as z.ZodType<AutopilotCollaborator>;

/** A detail without a usable `autopilot` is `null` (→ not-found state). */
export const AutopilotDetailSchema = z
  .object({
    autopilot: AutopilotSchema,
    triggers: rowsOf(AutopilotTriggerSchema, "autopilot trigger").catch([]).default([]),
    collaborators: rowsOf(AutopilotCollaboratorSchema, "autopilot collaborator")
      .catch([])
      .default([]),
  })
  .loose() as unknown as z.ZodType<MobileAutopilotDetail>;

// ---------------------------------------------------------------------------
// Runs: POST …/trigger, GET …/runs, GET …/runs/{runId}
// ---------------------------------------------------------------------------

/**
 * A run without a readable status is "unknown" (neutral), never success.
 * The list endpoint omits `trigger_payload` / `result`; they read as null.
 */
export const AutopilotRunSchema = z
  .object({
    id: z.string(),
    autopilot_id: z.string().catch("").default(""),
    trigger_id: nullableString,
    source: z.unknown(),
    status: z.unknown(),
    issue_id: nullableString,
    task_id: nullableString,
    triggered_at: z.string().catch("").default(""),
    completed_at: nullableString,
    failure_reason: nullableString,
    reason_code: z
      .unknown()
      .transform((v) => (typeof v === "string" && v !== "" ? v : undefined)),
    trigger_payload: z.unknown().transform((v) => v ?? null),
    result: z.unknown().transform((v) => v ?? null),
    created_at: z.string().catch("").default(""),
  })
  .loose()
  .transform(({ status, source, ...rest }) => ({
    ...rest,
    status: autopilotRunStatusOf(status),
    raw_status: typeof status === "string" ? status : "",
    source: autopilotRunSourceOf(source),
    raw_source: typeof source === "string" ? source : "",
  })) as unknown as z.ZodType<MobileAutopilotRun>;

/** Single-run answers (trigger, run detail); `null` = unusable body. */
export const AutopilotRunResultSchema = AutopilotRunSchema.nullable();

export const AutopilotRunListSchema = z
  .object({
    runs: rowsOf(AutopilotRunSchema, "autopilot run"),
    total: z.number().int().nonnegative().catch(0).default(0),
  })
  .loose() as unknown as z.ZodType<MobileAutopilotRunList>;

export const EMPTY_AUTOPILOT_RUN_LIST: MobileAutopilotRunList = { runs: [], total: 0 };

/** Page size of the runs list. */
export const AUTOPILOT_RUNS_PAGE_SIZE = 20;
