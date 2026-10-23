/**
 * Mobile zod schemas + fallbacks for issue wakeups.
 *
 * Shapes follow packages/core/types/issue-wakeup.ts (upstream v0.6.1) and
 * the server handlers in server/internal/handler/issue_wakeup.go and
 * issue_system_wakeup.go. They are NOT the core schemas from
 * packages/core/api/schemas.ts on purpose: core declares `kind` as a closed
 * enum, so one rule with a kind from a newer server fails the whole list.
 * Mobile follows the root rule "Enum drift downgrades, not crashes":
 *
 * - `kind` and `paused_reason` read an unknown value as "unknown" instead of
 *   failing (core maps an unknown pause reason to null/"rate", which would
 *   show a paused rule as active, or invent a reason).
 * - An unknown `condition` shape reads as "no condition" (same as core).
 * - Lists are validated row by row: a malformed row is dropped and counted,
 *   the rest of the list survives (same idea as InboxListSchema).
 * - Every object is `.loose()` so additive server fields pass through.
 */
import { z } from "zod";
import type {
  IssueWakeup,
  IssueWakeupSummaryRow,
  PausedWakeup,
  SystemWakeup,
  WakeupCondition,
  WakeupRun,
  WakeupScope,
  WakeupSource,
  WorkspaceWakeup,
  WorkspaceWakeupFilters,
  WorkspaceWakeupPage,
} from "@multica/core/types";
import { AgentTaskSchema } from "./schemas";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types: core types with the two open enums widened by "unknown".
// ---------------------------------------------------------------------------

export type WakeupKind = IssueWakeup["kind"] | "unknown";
export type WakeupPausedReasonValue = NonNullable<IssueWakeup["paused_reason"]> | "unknown";

type Widened<T> = Omit<T, "kind" | "paused_reason"> & {
  kind: WakeupKind;
  paused_reason?: WakeupPausedReasonValue | null;
};

export type MobileIssueWakeup = Widened<IssueWakeup>;
export type MobileIssueWakeupSummaryRow = Omit<IssueWakeupSummaryRow, "kind"> & {
  kind: WakeupKind;
};
export type MobilePausedWakeup = Omit<PausedWakeup, "paused_reason"> & {
  paused_reason: WakeupPausedReasonValue;
};
export type MobileSystemWakeup = Omit<SystemWakeup, "paused_reason" | "blocked"> & {
  paused_reason: WakeupPausedReasonValue | null;
  /** Open string: a newer server may add reasons; the UI shows a neutral hint. */
  blocked: SystemWakeup["blocked"] | (string & {});
};
export type MobileWorkspaceWakeup = Widened<WorkspaceWakeup>;
export type MobileWorkspaceWakeupPage = Omit<WorkspaceWakeupPage, "items"> & {
  items: MobileWorkspaceWakeup[];
};
export type { WakeupRun, WakeupScope, WakeupSource, WorkspaceWakeupFilters };

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const KIND = z.enum(["event", "at", "every", "cron"]);
const PAUSED_REASON = z.enum(["max_fires", "loop", "rate"]);

/** Any value outside the known set (newer server, wrong type, absent). */
const kindSchema = z.unknown().transform((v): WakeupKind => {
  const parsed = KIND.safeParse(v);
  return parsed.success ? parsed.data : "unknown";
});

const pausedReasonSchema = z.unknown().transform((v): WakeupPausedReasonValue => {
  const parsed = PAUSED_REASON.safeParse(v);
  return parsed.success ? parsed.data : "unknown";
});

/**
 * null, absent or "" (Go zero value) = not paused. Any other value means the
 * platform paused the rule, even when this build does not know the reason.
 */
const optionalPausedReason = z
  .unknown()
  .transform((v): WakeupPausedReasonValue | null =>
    v === null || v === undefined || v === "" ? null : pausedReasonSchema.parse(v),
  );

export const WakeupConditionSchema: z.ZodType<WakeupCondition> = z.union([
  z.object({ type: z.literal("issue_field"), field: z.literal("status"), value: z.string() }),
  z.object({
    type: z.literal("issue_field"),
    field: z.literal("assignee"),
    assignee_type: z.enum(["member", "agent", "squad"]),
    assignee_id: z.string(),
  }),
  z.object({ type: z.literal("issue_field"), field: z.literal("label"), label_id: z.string() }),
  z.object({
    type: z.literal("issue_field"),
    field: z.literal("property"),
    property_id: z.string(),
    value: z.unknown(),
  }),
  z.object({ type: z.literal("children_done"), stage: z.number().int().nullish() }),
  z.object({ type: z.literal("pull_request"), event: z.enum(["checks_finished", "merged"]) }),
  z.object({
    type: z.literal("other_issue"),
    issue_id: z.string(),
    state: z.enum(["done", "ended", "in_review"]),
    identifier: z.string().optional(),
  }),
]) as z.ZodType<WakeupCondition>;

const nullableString = z.string().nullable().catch(null).default(null);
const optionalNullableString = z.string().nullish().catch(null);
const nullableNumber = z.number().nullable().catch(null).default(null);

/**
 * Fields shared by an issue's rule and a workspace overview row. `id` and
 * `issue_id` stay required: a row without them cannot be keyed or acted on.
 */
const wakeupFields = {
  id: z.string(),
  issue_id: z.string(),
  agent_id: z.string().nullish().transform((v) => v ?? ""),
  agent_name: z.string().catch("").default(""),
  kind: kindSchema,
  mode: z.enum(["once", "continuous"]).catch("once").default("once"),
  event_types: z.array(z.string()).catch([]).default([]),
  filter_agent_id: nullableString,
  filter_task_id: nullableString,
  filter_actor_type: z.enum(["member", "agent"]).nullish().catch(null),
  filter_actor_id: optionalNullableString,
  filter_actor_name: optionalNullableString,
  interval_seconds: nullableNumber,
  cron_expression: nullableString,
  timezone: z.string().catch("").default(""),
  next_fire_at: nullableString,
  enabled: z.boolean().catch(false).default(false),
  revision: z.number().int().positive().nullish().catch(undefined).transform((v) => v ?? undefined),
  disabled_at: nullableString,
  last_task_id: nullableString,
  last_error: nullableString,
  filter_agent_name: optionalNullableString,
  last_task_status: optionalNullableString,
  expires_at: optionalNullableString,
  expiry_seconds: z.number().nullish().catch(null),
  on_timeout: z.enum(["wake", "end"]).nullish().catch(null),
  timed_out_at: optionalNullableString,
  created_by_agent: z.boolean().optional().catch(undefined),
  created_by_name: optionalNullableString,
  source_agent_id: optionalNullableString,
  source_agent_name: optionalNullableString,
  // An unknown condition shape from a newer server reads as "no condition".
  condition: WakeupConditionSchema.nullish().catch(null).transform((v) => v ?? null),
  max_fires: z.number().int().nullish().catch(null),
  fire_count: z.number().int().nonnegative().optional().catch(undefined),
  paused_reason: optionalPausedReason,
};

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
    if (dropped > 0) logger.warn(`[wakeups] dropped ${dropped} malformed ${label} row(s)`);
    return items;
  });
}

// ---------------------------------------------------------------------------
// Issue wakeups: GET /api/issues/{id}/wakeups, POST create/enable/disable
// ---------------------------------------------------------------------------

export const IssueWakeupSchema = z
  .object({ ...wakeupFields, instruction: z.string().catch("").default("") })
  .loose() as unknown as z.ZodType<MobileIssueWakeup>;

export const IssueWakeupListSchema = rowsOf(IssueWakeupSchema, "issue wakeup");
export const EMPTY_ISSUE_WAKEUP_LIST: MobileIssueWakeup[] = [];

/** Write endpoints answer with the stored rule; `null` = unusable body. */
export const IssueWakeupResultSchema = IssueWakeupSchema.nullable();

// ---------------------------------------------------------------------------
// Runs: GET /api/issues/{id}/wakeups/{wid}/runs
// ---------------------------------------------------------------------------

export const WakeupRunSchema = z
  .object({
    id: z.string(),
    // Open string: run status follows the task status taxonomy.
    status: z.string().catch("").default(""),
    created_at: z.string().catch("").default(""),
    started_at: nullableString,
    completed_at: nullableString,
    checkin_note: z.string().catch("").default(""),
    triggers: z.array(z.string()).catch([]).default([]),
    commented: z.boolean().catch(false).default(false),
  })
  .loose() as unknown as z.ZodType<WakeupRun>;

export const WakeupRunListSchema = rowsOf(WakeupRunSchema, "wakeup run");
export const EMPTY_WAKEUP_RUN_LIST: WakeupRun[] = [];

// ---------------------------------------------------------------------------
// System wakeups on an issue: GET / PUT /api/issues/{id}/system-wakeups
// ---------------------------------------------------------------------------

export const SystemWakeupSchema = z
  .object({
    id: z.string().catch("").default(""),
    revision: z.number().int().nonnegative().catch(0).default(0),
    // Open string: a newer server may add rules; the UI shows only known ones.
    rule: z.string() as unknown as z.ZodType<SystemWakeup["rule"]>,
    enabled: z.boolean().catch(false).default(false),
    instruction: z.string().catch("").default(""),
    default_instruction: z.string().catch("").default(""),
    customized: z.boolean().catch(false).default(false),
    paused_reason: optionalPausedReason,
    staged: z.boolean().catch(false).default(false),
    stage: z.number().int().nullable().catch(null).default(null),
    total: z.number().int().nonnegative().catch(0).default(0),
    remaining: z.number().int().nonnegative().catch(0).default(0),
    waiting: z.array(z.string()).catch([]).default([]),
    target: z
      .object({ type: z.enum(["agent", "squad", "member"]), id: z.string(), name: z.string() })
      .nullable()
      .catch(null)
      .default(null),
    blocked: z.string().catch("").default(""),
    workspace_default: z.boolean().catch(true).default(true),
  })
  .loose() as unknown as z.ZodType<MobileSystemWakeup>;

export const SystemWakeupListSchema = rowsOf(SystemWakeupSchema, "system wakeup");
export const EMPTY_SYSTEM_WAKEUP_LIST: MobileSystemWakeup[] = [];

// ---------------------------------------------------------------------------
// Header chip: GET /api/issue-wakeup-summaries
// ---------------------------------------------------------------------------

export const IssueWakeupSummaryRowSchema = z
  .object({
    id: wakeupFields.id,
    issue_id: wakeupFields.issue_id,
    agent_id: wakeupFields.agent_id,
    agent_name: wakeupFields.agent_name,
    kind: wakeupFields.kind,
    mode: wakeupFields.mode,
    event_types: wakeupFields.event_types,
    filter_task_id: wakeupFields.filter_task_id,
    filter_agent_name: wakeupFields.filter_agent_name,
    filter_actor_type: wakeupFields.filter_actor_type,
    filter_actor_id: wakeupFields.filter_actor_id,
    filter_actor_name: wakeupFields.filter_actor_name,
    interval_seconds: wakeupFields.interval_seconds,
    cron_expression: wakeupFields.cron_expression,
    timezone: wakeupFields.timezone,
    next_fire_at: wakeupFields.next_fire_at,
    condition: wakeupFields.condition,
    active_count: z.number().int().nonnegative().catch(0).default(0),
    event_count: z.number().int().nonnegative().catch(0).default(0),
  })
  .loose() as unknown as z.ZodType<MobileIssueWakeupSummaryRow>;

export const IssueWakeupSummaryListSchema = rowsOf(IssueWakeupSummaryRowSchema, "wakeup summary");
export const EMPTY_ISSUE_WAKEUP_SUMMARY_LIST: MobileIssueWakeupSummaryRow[] = [];

// ---------------------------------------------------------------------------
// Paused by the platform: GET /api/issue-wakeup-paused
// ---------------------------------------------------------------------------

export const PausedWakeupSchema = z
  .object({
    issue_id: z.string(),
    id: z.string(),
    agent_id: z.string().catch("").default(""),
    // Present on every row of this endpoint; an unknown reason stays "paused".
    paused_reason: pausedReasonSchema,
  })
  .loose() as unknown as z.ZodType<MobilePausedWakeup>;

export const PausedWakeupListSchema = rowsOf(PausedWakeupSchema, "paused wakeup");
export const EMPTY_PAUSED_WAKEUP_LIST: MobilePausedWakeup[] = [];

// ---------------------------------------------------------------------------
// Workspace overview: GET /api/issue-wakeups?scope=&kind=&…
// ---------------------------------------------------------------------------

const count = z.number().int().nonnegative().catch(0).default(0);

export const WorkspaceWakeupSchema = z
  .object({
    ...wakeupFields,
    issue_title: z.string().catch("").default(""),
    issue_identifier: z.string().catch("").default(""),
    issue_closed: z.boolean().catch(false).default(false),
    // Unknown permission reads as "no": actions are hidden, never offered.
    can_manage: z.boolean().catch(false).default(false),
    active_runs: count,
    task: AgentTaskSchema.nullable().catch(null).default(null),
    source: z.enum(["member", "agent", "system"]).catch("member").default("member"),
    runs_7d: count,
    rule: z.string().nullish().catch(null) as unknown as z.ZodType<SystemWakeup["rule"] | null | undefined>,
    system_stage: z.number().int().nullish().catch(null),
    system_remaining: z.number().int().nullish().catch(null),
    target_type: optionalNullableString,
  })
  .loose() as unknown as z.ZodType<MobileWorkspaceWakeup>;

export const WorkspaceWakeupPageSchema = z
  .object({
    items: rowsOf(WorkspaceWakeupSchema, "workspace wakeup").catch([]).default([]),
    total: count,
    counts: z
      .object({ active: count, all: count, paused: count, disabled: count, ended: count })
      .loose()
      .catch({ active: 0, all: 0, paused: 0, disabled: 0, ended: 0 })
      .default({ active: 0, all: 0, paused: 0, disabled: 0, ended: 0 }),
    agents: rowsOf(z.object({ id: z.string(), name: z.string().catch("") }).loose(), "wakeup agent")
      .catch([])
      .default([]),
  })
  .loose() as unknown as z.ZodType<MobileWorkspaceWakeupPage>;

export const EMPTY_WORKSPACE_WAKEUP_PAGE: MobileWorkspaceWakeupPage = {
  items: [],
  total: 0,
  counts: { active: 0, all: 0, paused: 0, disabled: 0, ended: 0 },
  agents: [],
};

export const DEFAULT_WORKSPACE_WAKEUP_FILTERS: WorkspaceWakeupFilters = {
  scope: "active",
  kind: "all",
  source: "",
  search: "",
  agent_id: "",
  offset: 0,
  limit: 50,
};
