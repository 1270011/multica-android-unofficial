/**
 * Mobile-owned fetch wrapper. Mirrors the surface area of
 * packages/core/api/client.ts that mobile actually uses, but lives in
 * apps/mobile/ so we control retry/timeout/error handling independently.
 *
 * Types are imported via `import type` from @multica/core/types — zero
 * runtime coupling. Zod schemas + fallbacks are imported from
 * @multica/core/api/schemas (pure data, on the mobile sharing whitelist).
 *
 * Design checklist (apps/mobile/CLAUDE.md "Lessons → ApiClient capability list"):
 *   1. Zod parseWithFallback for endpoints with schemas (drift defense)
 *   2. onUnauthorized callback on 401 (auto sign-out, avoids retry loops)
 *   3. X-Request-ID per request + structured logger (debug + tracing)
 *   4. Bearer auth + X-Workspace-Slug — NOT cookie auth (no CSRF, no credentials)
 */
import type {
  Invitation,
  Agent,
  AgentTask,
  Attachment,
  ChatMessage,
  ChatPendingTask,
  ChatSession,
  Comment,
  CreateIssueRequest,
  CreateLabelRequest,
  CreateProjectRequest,
  CreateProjectResourceRequest,
  InboxItem,
  InboxWorkspaceUnread,
  Issue,
  IssueDuplicates,
  IssuePropertiesResponse,
  IssuePropertyValue,
  IssueLabelsResponse,
  Label,
  IssueReaction,
  ListIssuesParams,
  ListIssuesResponse,
  ListLabelsResponse,
  ListProjectResourcesResponse,
  ListProjectsResponse,
  ListPropertiesResponse,
  MemberWithUser,
  MoveIssueRequest,
  PinnedItem,
  PinnedItemType,
  Project,
  ProjectResource,
  Reaction,
  ReorderPinsRequest,
  RuntimeDevice,
  SearchIssuesResponse,
  SearchProjectsResponse,
  ListIssueStatusesResponse,
  SendChatMessageResponse,
  Squad,
  SquadMember,
  SquadMemberStatusListResponse,
  NotificationPreferenceResponse,
  NotificationPreferences,
  TaskMessagePayload,
  TimelineEntry,
  PrioritizeQueuedChatTaskResponse,
  UpdateIssueRequest,
  UpdateMeRequest,
  UpdateProjectRequest,
  User,
  Workspace,
  WorkspaceSubscriptionSummary,
} from "@multica/core/types";
import {
  AppConfigSchema,
  EMPTY_APP_CONFIG,
  EMPTY_REFRESH_SESSION_RESPONSE,
  RefreshSessionResponseSchema,
  EMPTY_LIST_ISSUE_STATUSES_RESPONSE,
  EMPTY_LIST_ISSUES_RESPONSE,
  EMPTY_TIMELINE_ENTRIES,
  IssueSchema,
  ListIssuesResponseSchema,
  ListIssueStatusesResponseSchema,
  TimelineEntriesSchema,
  WorkspaceSubscriptionSummarySchema,
  ChildIssuesResponseSchema,
  EMPTY_ISSUE_PROPERTIES_RESPONSE,
  EMPTY_ISSUE_VIEW_PREFERENCE,
  EMPTY_LIST_PROPERTIES_RESPONSE,
  EMPTY_PRIORITIZE_QUEUED_CHAT_TASK_RESPONSE,
  EMPTY_SQUAD_MEMBER_STATUS_LIST,
  IssueDuplicatesResponseSchema,
  IssuePropertiesResponseSchema,
  IssueViewListSchema,
  IssueViewPreferenceSchema,
  IssueViewSchema,
  ListPropertiesResponseSchema,
  PrioritizeQueuedChatTaskResponseSchema,
  SquadMemberStatusListResponseSchema,
} from "@multica/core/api/schemas";
import type {
  AppConfigResponse,
  CreateIssueViewRequest,
  IssueView,
  IssueViewPreference,
  RefreshSessionResponse,
} from "@multica/core/api/schemas";
// Issue subscription toggle in the issue chat menu.
import { RuntimeHourlyActivityListSchema, SubscribersListSchema } from "@multica/core/api/schemas";
import type { IssueSubscriber, RuntimeHourlyActivity } from "@multica/core/types";
import {
  ActiveTasksResponseSchema,
  AgentListSchema,
  AgentSchema,
  BatchDeleteIssuesResponseSchema,
  BatchUpdateIssuesResponseSchema,
  AgentTaskListSchema,
  AttachmentListSchema,
  AttachmentSchema,
  ChatMessageListSchema,
  CommentSchema,
  ChatPendingTaskSchema,
  ChatSessionListSchema,
  ChatSessionSchema,
  EMPTY_ACTIVE_TASKS_RESPONSE,
  EMPTY_AGENT_LIST,
  EMPTY_AGENT_TASK_LIST,
  EMPTY_ATTACHMENT_LIST,
  EMPTY_CHAT_MESSAGE_LIST,
  EMPTY_CHAT_PENDING_TASK,
  EMPTY_CHAT_SESSION_LIST,
  EMPTY_COMMENT,
  EMPTY_INBOX_LIST,
  EMPTY_INBOX_UNREAD_SUMMARY,
  EMPTY_ISSUE_FALLBACK,
  EMPTY_LIST_LABELS_RESPONSE,
  EMPTY_LIST_PROJECT_RESOURCES_RESPONSE,
  EMPTY_LIST_PROJECTS_RESPONSE,
  EMPTY_MEMBER_LIST,
  EMPTY_NOTIFICATION_PREFERENCES,
  EMPTY_PIN_LIST,
  EMPTY_PROJECT,
  EMPTY_RUNTIME_LIST,
  EMPTY_SEARCH_ISSUES_RESPONSE,
  EMPTY_SEARCH_PROJECTS_RESPONSE,
  EMPTY_SQUAD_LIST,
  EMPTY_SQUAD_MEMBER_LIST,
  EMPTY_USER,
  EMPTY_WORKSPACE_LIST,
  InboxListSchema,
  InboxUnreadSummarySchema,
  NotificationPreferenceResponseSchema,
  ListLabelsResponseSchema,
  ListProjectResourcesResponseSchema,
  ListProjectsResponseSchema,
  MemberListSchema,
  PinListSchema,
  PinnedItemSchema,
  ProjectSchema,
  RuntimeListSchema,
  SearchIssuesResponseSchema,
  SearchProjectsResponseSchema,
  SendChatMessageResponseSchema,
  SquadListSchema,
  SquadMemberListSchema,
  SquadSchema,
  TaskMessageListSchema,
  EMPTY_TASK_MESSAGE_LIST,
  UserSchema,
  WorkspaceListSchema,
  InvitationListSchema,
  EMPTY_INVITATION_LIST,
} from "./schemas";
import type { IssueWakeupInput, SystemWakeup } from "@multica/core/types";
import {
  DEFAULT_WORKSPACE_WAKEUP_FILTERS,
  EMPTY_ISSUE_WAKEUP_LIST,
  EMPTY_ISSUE_WAKEUP_SUMMARY_LIST,
  EMPTY_PAUSED_WAKEUP_LIST,
  EMPTY_SYSTEM_WAKEUP_LIST,
  EMPTY_WAKEUP_RUN_LIST,
  EMPTY_WORKSPACE_WAKEUP_PAGE,
  IssueWakeupListSchema,
  IssueWakeupResultSchema,
  IssueWakeupSummaryListSchema,
  PausedWakeupListSchema,
  SystemWakeupListSchema,
  WakeupRunListSchema,
  WorkspaceWakeupPageSchema,
} from "./wakeup-schemas";
import type {
  MobileIssueWakeup,
  MobileIssueWakeupSummaryRow,
  MobilePausedWakeup,
  MobileSystemWakeup,
  MobileWorkspaceWakeupPage,
  WakeupRun,
  WorkspaceWakeupFilters,
} from "./wakeup-schemas";
import type { ZodType } from "zod";
import { getCurrentSlug } from "./workspace-store";
import { parseArrayInChunks, parseWithFallback } from "@/lib/parse-response";
import { createRequestId } from "@/lib/request-id";
import {
  AUTOPILOT_RUNS_PAGE_SIZE,
  AutopilotDetailSchema,
  AutopilotListSchema,
  AutopilotResultSchema,
  AutopilotRunListSchema,
  AutopilotRunResultSchema,
  EMPTY_AUTOPILOT_LIST,
  EMPTY_AUTOPILOT_RUN_LIST,
} from "./autopilot-schemas";
import type {
  AutopilotSettableStatus,
  MobileAutopilot,
  MobileAutopilotDetail,
  MobileAutopilotList,
  MobileAutopilotRun,
  MobileAutopilotRunList,
} from "./autopilot-schemas";
import { buildCommentUpdateBody } from "./revision";

import { getCfAccessHeaders, getServerBaseUrl } from "./server-config-store";
import { looksLikeAccessBlock } from "@/lib/server-config";
import { CLIENT_OS } from "@/lib/client-os";
import { logger } from "@/lib/logger";

/**
 * Base URL comes from the user's server setup (data/server-config-store.ts),
 * not from a build-time env var: the same APK talks to
 * `https://multica.example.com` through Cloudflare Access or to the
 * server's LAN address over VPN, whichever the user picked.
 *
 * Callers never reach here unconfigured — app/index.tsx routes to the setup
 * screen first — but a request fired before that would otherwise build a
 * `nullundefined/api/...` URL, so fail loudly instead.
 */
function requireBaseUrl(): string {
  const base = getServerBaseUrl();
  if (!base) {
    throw new ApiError("Server not configured", 0);
  }
  return base;
}

export interface LoginResponse {
  token: string;
  user: User;
}

/** Mobile file payload for `uploadFile`. RN doesn't have a browser `File`
 *  object; the fetch `FormData` polyfill accepts `{ uri, name, type }`
 *  directly and streams from disk. expo-image-picker / expo-document-picker
 *  return assets that map straight onto this shape. */
export interface FileAsset {
  uri: string;
  name: string;
  type: string;
}

/** Web mirrors this from `packages/core/constants/upload.ts`. Mobile keeps
 *  its own copy per the `mirror, don't import` rule in apps/mobile/CLAUDE.md. */
const MAX_FILE_SIZE = 100 * 1024 * 1024;

/** Hard ceiling for every HTTP request. Mobile-specific because iOS may
 *  suspend a backgrounded network task without ever resolving/rejecting
 *  the JS-side fetch promise (facebook/react-native#35384). Without this
 *  timeout, a refetch fired after returning to foreground can leave the
 *  query stuck in `isRefetching` state forever (visible as the
 *  pull-to-refresh spinner never going away). 30s is generous for any
 *  reasonable Multica payload size on cellular. */
const FETCH_TIMEOUT_MS = 30_000;

/** One list entry of a `GET /api/issues` parameter. */
/** `ListIssuesParams` keys the server knows under another name. */
const LIST_PARAM_NAMES: Record<string, string> = {
  sort_by: "sort",
  sort_direction: "direction",
};

function listParamValue(v: unknown): string {
  if (v && typeof v === "object" && "type" in v && "id" in v) {
    return `${String((v as { type: unknown }).type)}:${String((v as { id: unknown }).id)}`;
  }
  return String(v);
}

export class ApiError extends Error {
  readonly status: number;
  readonly body?: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Cloudflare Access answered instead of Multica — the service token is
 * missing, wrong or revoked. Kept as its own class so screens can show
 * "check your service token" rather than a generic failure, and so the
 * 401 sign-out hook is NOT triggered (the Multica session may be fine).
 */
export class AccessBlockedError extends ApiError {
  constructor(status: number) {
    super("Cloudflare Access blocked the request", status);
    this.name = "AccessBlockedError";
  }
}

/**
 * Inspect a fetch Response for an Access interception. RN follows the 302
 * to the Access login page, so a "successful" 200 whose final URL is on
 * cloudflareaccess.com is the usual symptom.
 */
async function accessBlockFrom(
  res: Response,
  requestUrl: string,
): Promise<AccessBlockedError | null> {
  const contentType = res.headers?.get?.("content-type") ?? null;
  let bodyStart: string | null = null;
  if (contentType && /text\/html/i.test(contentType)) {
    // Multica never answers an API call with HTML; peek at the page so the
    // Access login page is recognised even when RN hides the redirect.
    try {
      bodyStart = (await res.clone().text()).slice(0, 2048);
    } catch {
      bodyStart = null;
    }
  }
  const blocked = looksLikeAccessBlock({
    status: res.status,
    url: res.url,
    contentType,
    server: res.headers?.get?.("server") ?? null,
    bodyStart,
    requestUrl,
  });
  return blocked ? new AccessBlockedError(res.status) : null;
}

export interface ApiClientOptions {
  /** Called once when the server returns 401. The platform layer wires this
   *  to clear the token + navigate to /login so a stale token doesn't keep
   *  every subsequent request looping on 401. */
  onUnauthorized?: () => void;
}

class ApiClient {
  private token: string | null = null;
  private options: ApiClientOptions = {};

  setToken(token: string | null) {
    this.token = token;
  }

  /** The bearer token in use, or null when signed out. Session renewal reads
   *  it to confirm the session it started from is still the live one, and the
   *  WS client reads it so a reconnect uses the current credential. */
  getToken(): string | null {
    return this.token;
  }

  setOptions(options: ApiClientOptions) {
    this.options = { ...this.options, ...options };
  }

  private async fetch<T>(
    path: string,
    init: RequestInit & { signal?: AbortSignal } = {},
  ): Promise<T> {
    const rid = createRequestId();
    const start = Date.now();
    const method = init.method ?? "GET";

    const baseUrl = requireBaseUrl();
    const requestUrl = `${baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Client-Platform": "mobile",
      "X-Client-OS": CLIENT_OS,
      "X-Client-Version": "0.1.0",
      "X-Request-ID": rid,
      // Cloudflare Access service token (empty object in direct mode).
      ...getCfAccessHeaders(),
      ...((init.headers as Record<string, string>) ?? {}),
    };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    // Backend middleware (server/internal/middleware/workspace.go) resolves
    // slug → ws UUID and gates membership. Mirrors packages/core/api/client.ts.
    const slug = getCurrentSlug();
    if (slug && !headers["X-Workspace-Slug"]) {
      headers["X-Workspace-Slug"] = slug;
    }

    // Timeout + caller-signal forwarding.
    //
    // Hermes does NOT support AbortSignal.timeout() or AbortSignal.any() —
    // see facebook/react-native#42042 and livekit#4014. So we manually
    // compose a single controller that aborts on:
    //   (a) caller-side signal (TQ cancelling a stale/inactive query, etc),
    //   (b) 30s timeout (defends against iOS suspending the network task
    //       silently during background — fetch() then never resolves;
    //       facebook/react-native#35384). Without this, a refetch
    //       triggered by WS reconnect can leave the FlatList pull-to-refresh
    //       spinner stuck on the screen indefinitely.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(new Error(`request timed out after ${FETCH_TIMEOUT_MS}ms`));
    }, FETCH_TIMEOUT_MS);
    const callerSignal = init.signal;
    const onCallerAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort(callerSignal.reason);
      else callerSignal.addEventListener("abort", onCallerAbort);
    }

    logger.log(`[api] → ${method} ${path}`, { rid });

    let res: Response;
    try {
      res = await fetch(requestUrl, {
        ...init,
        signal: controller.signal,
        headers,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener("abort", onCallerAbort);
      // Re-throw with a clearer message if this was our own timeout abort.
      if (
        err instanceof Error &&
        err.name === "AbortError" &&
        !callerSignal?.aborted
      ) {
        const duration = Date.now() - start;
        logger.warn(`[api] ← TIMEOUT ${path}`, {
          rid,
          duration: `${duration}ms`,
        });
        throw new ApiError(
          `Request timed out after ${FETCH_TIMEOUT_MS}ms`,
          0,
          undefined,
        );
      }
      throw err;
    }
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", onCallerAbort);
    const duration = Date.now() - start;

    // Checked before `res.ok`: a followed Access redirect is a 200.
    const accessBlock = await accessBlockFrom(res, requestUrl);
    if (accessBlock) {
      logger.warn(`[api] ← ACCESS BLOCKED ${path}`, {
        rid,
        status: res.status,
        duration: `${duration}ms`,
      });
      throw accessBlock;
    }

    if (!res.ok) {
      // 401 sign-out hook: invoke once, let the platform layer (auth-store)
      // clear the token + navigate. Subsequent requests in flight will also
      // 401 and re-enter here, so the callback must be idempotent.
      if (res.status === 401) {
        this.options.onUnauthorized?.();
      }

      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }
      const message =
        (body && typeof body === "object" && "message" in body
          ? String((body as { message: unknown }).message)
          : null) ?? `${res.status} ${res.statusText}`;

      const level = res.status === 404 ? "warn" : "error";
      logger[level](`[api] ← ${res.status} ${path}`, {
        rid,
        duration: `${duration}ms`,
        error: message,
      });

      throw new ApiError(message, res.status, body);
    }

    logger.log(`[api] ← ${res.status} ${path}`, {
      rid,
      duration: `${duration}ms`,
    });

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /**
   * Read-side helper: GET + zod parse + fallback in one call. Collapses
   * the boilerplate that every list/detail endpoint repeats:
   *
   *   const raw = await this.fetch<unknown>(path, { signal: opts?.signal });
   *   return parseWithFallback(raw, Schema, FALLBACK, { endpoint: "name" });
   *
   * Always uses GET (no method arg) — write endpoints that need parsing
   * still go through `this.fetch` + `parseWithFallback` directly because
   * they carry a body and care about method semantics. Use
   * `fetchValidatedWith` for those (PATCH / PUT / POST).
   *
   * The `endpoint` label defaults to the request path — override only when
   * the path has dynamic segments and you want stable telemetry labels.
   */
  private async fetchValidated<T>(
    path: string,
    schema: ZodType,
    fallback: T,
    opts?: { signal?: AbortSignal; endpoint?: string },
  ): Promise<T> {
    const raw = await this.fetch<unknown>(path, { signal: opts?.signal });
    return parseWithFallback(raw, schema, fallback, {
      endpoint: opts?.endpoint ?? path,
    });
  }

  /** Same as fetchValidated but supports any HTTP method + body. Used by
   *  PATCH/PUT/POST endpoints whose response we still want to validate
   *  (e.g. updateMe returns User, updateNotificationPreferences returns
   *  NotificationPreferenceResponse). */
  private async fetchValidatedWith<T>(
    path: string,
    schema: ZodType,
    fallback: T,
    init: RequestInit,
    opts?: { signal?: AbortSignal; endpoint?: string },
  ): Promise<T> {
    // `opts.signal` wins if both are passed, but absent opts.signal does
    // NOT clear init.signal — important because forgetting `?? init.signal`
    // would silently strip a caller's abort signal when they used the
    // RequestInit shape but no opts.
    const raw = await this.fetch<unknown>(path, {
      ...init,
      signal: opts?.signal ?? init.signal ?? undefined,
    });
    return parseWithFallback(raw, schema, fallback, {
      endpoint: opts?.endpoint ?? `${init.method ?? "GET"} ${path}`,
    });
  }

  // --- Auth ---
  async sendCode(email: string): Promise<void> {
    await this.fetch<void>("/auth/send-code", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  async verifyCode(email: string, code: string): Promise<LoginResponse> {
    return this.fetch<LoginResponse>("/auth/verify-code", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    });
  }

  /**
   * Ask the server to extend this session if it has entered its renewal
   * window (MUL-7436). The server owns that decision — the app never reads
   * `exp`, so a device with a skewed clock behaves exactly like one without.
   */
  async refreshSession(): Promise<RefreshSessionResponse> {
    return this.fetchValidatedWith(
      "/api/auth/refresh",
      RefreshSessionResponseSchema,
      EMPTY_REFRESH_SESSION_RESPONSE,
      { method: "POST" },
      { endpoint: "refreshSession" },
    );
  }

  async getMe(opts?: { signal?: AbortSignal }): Promise<User> {
    return this.fetchValidated(
      "/api/me",
      UserSchema,
      EMPTY_USER,
      { ...opts, endpoint: "getMe" },
    );
  }

  async getConfig(opts?: { signal?: AbortSignal }): Promise<AppConfigResponse> {
    return this.fetchValidated<AppConfigResponse>(
      "/api/config",
      AppConfigSchema,
      EMPTY_APP_CONFIG,
      { ...opts, endpoint: "getConfig" },
    );
  }

  async getWorkspaceSubscriptionSummary(opts?: {
    signal?: AbortSignal;
  }): Promise<WorkspaceSubscriptionSummary | null> {
    return this.fetchValidated<WorkspaceSubscriptionSummary | null>(
      "/api/cloud-subscriptions/summary",
      WorkspaceSubscriptionSummarySchema,
      null,
      { ...opts, endpoint: "getWorkspaceSubscriptionSummary" },
    );
  }

  // PATCH /api/me — name, avatar_url, language. Server returns the updated
  // user; we parse so a partial drift doesn't bleed into the auth store.
  async updateMe(data: UpdateMeRequest): Promise<User> {
    return this.fetchValidatedWith(
      "/api/me",
      UserSchema,
      EMPTY_USER,
      { method: "PATCH", body: JSON.stringify(data) },
      { endpoint: "updateMe" },
    );
  }

  // --- Notification preferences ---
  async getNotificationPreferences(
    opts?: { signal?: AbortSignal },
  ): Promise<NotificationPreferenceResponse> {
    return this.fetchValidated(
      "/api/notification-preferences",
      NotificationPreferenceResponseSchema,
      EMPTY_NOTIFICATION_PREFERENCES,
      { ...opts, endpoint: "getNotificationPreferences" },
    );
  }

  async updateNotificationPreferences(
    preferences: NotificationPreferences,
    workspaceSlug?: string,
  ): Promise<NotificationPreferenceResponse> {
    return this.fetchValidatedWith(
      "/api/notification-preferences",
      NotificationPreferenceResponseSchema,
      EMPTY_NOTIFICATION_PREFERENCES,
      {
        method: "PATCH",
        headers: workspaceSlug
          ? { "X-Workspace-Slug": workspaceSlug }
          : undefined,
        body: JSON.stringify({ preferences }),
      },
      { endpoint: "updateNotificationPreferences" },
    );
  }

  // --- Workspaces ---
  async listWorkspaces(opts?: {
    signal?: AbortSignal;
  }): Promise<Workspace[]> {
    const raw = await this.fetch<unknown>("/api/workspaces", {
      signal: opts?.signal,
    });
    return parseWithFallback(raw, WorkspaceListSchema, EMPTY_WORKSPACE_LIST, {
      endpoint: "listWorkspaces",
    });
  }

  // --- Invitations ---
  // Pending invitations of the signed-in user, across workspaces. Accept
  // joins the workspace (returns the new member row, unused here) and
  // declines are final; both 4xx when the invite was concluded elsewhere.
  async listMyInvitations(opts?: { signal?: AbortSignal }): Promise<Invitation[]> {
    const raw = await this.fetch<unknown>("/api/invitations", {
      signal: opts?.signal,
    });
    return parseWithFallback(raw, InvitationListSchema, EMPTY_INVITATION_LIST, {
      endpoint: "GET /api/invitations",
    });
  }

  async acceptInvitation(id: string): Promise<void> {
    await this.fetch<unknown>(`/api/invitations/${id}/accept`, { method: "POST" });
  }

  async declineInvitation(id: string): Promise<void> {
    await this.fetch<unknown>(`/api/invitations/${id}/decline`, { method: "POST" });
  }

  // --- Inbox ---
  async listInbox(opts?: { signal?: AbortSignal }): Promise<InboxItem[]> {
    const raw = await this.fetch<unknown>("/api/inbox", {
      signal: opts?.signal,
    });
    return parseWithFallback(raw, InboxListSchema, EMPTY_INBOX_LIST, {
      endpoint: "listInbox",
    });
  }

  /**
   * Cross-workspace unread inbox counts, one entry per workspace with unread
   * items. Backs the inbox tab badge — see lib/unread-counts.ts for why the
   * badge reads this instead of counting `listInbox()` locally.
   */
  async getInboxUnreadSummary(opts?: {
    signal?: AbortSignal;
  }): Promise<InboxWorkspaceUnread[]> {
    const raw = await this.fetch<unknown>("/api/inbox/unread-summary", {
      signal: opts?.signal,
    });
    return parseWithFallback(
      raw,
      InboxUnreadSummarySchema,
      EMPTY_INBOX_UNREAD_SUMMARY,
      { endpoint: "getInboxUnreadSummary" },
    );
  }

  async markInboxRead(id: string): Promise<InboxItem> {
    return this.fetch<InboxItem>(`/api/inbox/${id}/read`, { method: "POST" });
  }

  async markInboxUnread(id: string): Promise<InboxItem> {
    return this.fetch<InboxItem>(`/api/inbox/${id}/unread`, { method: "POST" });
  }

  // Issue subscribers — mirrors packages/core/api/client.ts. The issue chat
  // menu offers "notifications for this issue on/off" for the signed-in
  // member only, so the target body stays empty (server: current user).
  async listIssueSubscribers(
    issueId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<IssueSubscriber[]> {
    const raw = await this.fetch<unknown>(`/api/issues/${issueId}/subscribers`, {
      signal: opts?.signal,
    });
    return parseWithFallback(raw, SubscribersListSchema, [], {
      endpoint: "listIssueSubscribers",
    }) as IssueSubscriber[];
  }

  async subscribeToIssue(issueId: string): Promise<void> {
    await this.fetch(`/api/issues/${issueId}/subscribe`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  async unsubscribeFromIssue(issueId: string): Promise<void> {
    await this.fetch(`/api/issues/${issueId}/unsubscribe`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  /** Archived notifications backing the inbox "Archived" view. Same row
   *  shape as `listInbox`; web pages this endpoint, mobile reads the capped
   *  flat list (`GET /api/inbox/archived`, packages/core/api/client.ts). */
  async listArchivedInbox(opts?: { signal?: AbortSignal }): Promise<InboxItem[]> {
    const raw = await this.fetch<unknown>("/api/inbox/archived", {
      signal: opts?.signal,
    });
    return parseWithFallback(raw, InboxListSchema, EMPTY_INBOX_LIST, {
      endpoint: "listArchivedInbox",
    });
  }

  async unarchiveInbox(id: string): Promise<InboxItem> {
    return this.fetch<InboxItem>(`/api/inbox/${id}/unarchive`, { method: "POST" });
  }

  // Archive endpoints — write surface. Match web's surface in
  // packages/core/api/client.ts:981-1003. No parseWithFallback (mirrors
  // markInboxRead above and the project write endpoints): a malformed
  // archive response should surface naturally so the optimistic patch
  // rolls back.
  async archiveInbox(id: string): Promise<InboxItem> {
    return this.fetch<InboxItem>(`/api/inbox/${id}/archive`, { method: "POST" });
  }

  async markAllInboxRead(): Promise<{ count: number }> {
    return this.fetch<{ count: number }>("/api/inbox/mark-all-read", {
      method: "POST",
    });
  }

  async archiveAllInbox(): Promise<{ count: number }> {
    return this.fetch<{ count: number }>("/api/inbox/archive-all", {
      method: "POST",
    });
  }

  async archiveAllReadInbox(): Promise<{ count: number }> {
    return this.fetch<{ count: number }>("/api/inbox/archive-all-read", {
      method: "POST",
    });
  }

  async archiveCompletedInbox(): Promise<{ count: number }> {
    return this.fetch<{ count: number }>("/api/inbox/archive-completed", {
      method: "POST",
    });
  }

  // --- Members & Agents (for actor name/avatar lookup) ---
  async listMembers(
    workspaceId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<MemberWithUser[]> {
    const raw = await this.fetch<unknown>(
      `/api/workspaces/${workspaceId}/members`,
      { signal: opts?.signal },
    );
    return parseWithFallback(raw, MemberListSchema, EMPTY_MEMBER_LIST, {
      endpoint: "listMembers",
    });
  }

  /** `workspaceSlug` reads another workspace than the current one (the
   *  notification service needs the agent names of every
   *  workspace); default is the current workspace. */
  async listAgents(opts?: { signal?: AbortSignal; workspaceSlug?: string }): Promise<Agent[]> {
    const raw = await this.fetch<unknown>("/api/agents", {
      signal: opts?.signal,
      headers: opts?.workspaceSlug ? { "X-Workspace-Slug": opts.workspaceSlug } : undefined,
    });
    return parseWithFallback(raw, AgentListSchema, EMPTY_AGENT_LIST, {
      endpoint: "listAgents",
    });
  }

  // Feature probe for the "AI Team" menu: resolves when the
  // server serves the list, throws the ApiError otherwise (404/501 = the
  // server lacks the feature, see lib/ai-team.ts featureState). The body is
  // not parsed; the screens of A2 use their own validated list call.
  async probeAutopilots(opts?: { signal?: AbortSignal }): Promise<true> {
    await this.fetch<unknown>("/api/autopilots?limit=1", { signal: opts?.signal });
    return true;
  }

  // Workspace runtimes — feeds the presence dot's availability dimension
  // (runtime.status + last_seen_at). Backend route registered in
  // server/cmd/server/router.go:514 (GET /api/runtimes).
  async listRuntimes(opts?: { signal?: AbortSignal }): Promise<RuntimeDevice[]> {
    const raw = await this.fetch<unknown>("/api/runtimes", {
      signal: opts?.signal,
    });
    return parseWithFallback(raw, RuntimeListSchema, EMPTY_RUNTIME_LIST, {
      endpoint: "listRuntimes",
    });
  }

  // Hour-of-day task activity of one runtime: `[{hour,
  // count}]`, bucketed by the server in `tz` (viewer's IANA zone, like web).
  // A malformed body degrades to "no activity" instead of an error.
  async getRuntimeActivity(
    runtimeId: string,
    opts?: { tz?: string; signal?: AbortSignal },
  ): Promise<RuntimeHourlyActivity[]> {
    const search = new URLSearchParams();
    if (opts?.tz) search.set("tz", opts.tz);
    const qs = search.toString();
    const raw = await this.fetch<unknown>(
      `/api/runtimes/${encodeURIComponent(runtimeId)}/activity${qs ? `?${qs}` : ""}`,
      { signal: opts?.signal },
    );
    return parseWithFallback<RuntimeHourlyActivity[]>(raw, RuntimeHourlyActivityListSchema, [], {
      endpoint: "getRuntimeActivity",
    });
  }

  // Workspace-wide active agent tasks + each agent's most recent terminal —
  // feeds the workload dimension of presence (currently unused in the mobile
  // dot; reserved for the P1 long-press peek sheet). Listed here now so the
  // realtime invalidation path can be wired in one PR. Backend route at
  // server/cmd/server/router.go:539 (GET /api/agent-task-snapshot).
  async listAgentTaskSnapshot(
    opts?: { signal?: AbortSignal },
  ): Promise<AgentTask[]> {
    const raw = await this.fetch<unknown>("/api/agent-task-snapshot", {
      signal: opts?.signal,
    });
    return parseWithFallback(raw, AgentTaskListSchema, EMPTY_AGENT_TASK_LIST, {
      endpoint: "listAgentTaskSnapshot",
    });
  }

  async listSquads(opts?: { signal?: AbortSignal }): Promise<Squad[]> {
    const raw = await this.fetch<unknown>("/api/squads", {
      signal: opts?.signal,
    });
    return parseWithFallback(raw, SquadListSchema, EMPTY_SQUAD_LIST, {
      endpoint: "listSquads",
    });
  }

  // Read-only agent/squad detail (UX §6 H). `null` = drifted body; the
  // screen shows its not-found state instead of a half-empty record.
  async getAgent(id: string, opts?: { signal?: AbortSignal }): Promise<Agent | null> {
    return this.fetchValidated<Agent | null>(
      `/api/agents/${id}`,
      AgentSchema.nullable(),
      null,
      { signal: opts?.signal, endpoint: "GET /api/agents/:id" },
    );
  }

  /** Latest runs of one agent, newest first (GET /api/agents/:id/tasks,
   *  plain array; paging via the `X-Agent-Tasks-Next-Cursor` header is not
   *  needed for the read-only detail). */
  async listAgentTasks(
    id: string,
    opts?: { signal?: AbortSignal; limit?: number },
  ): Promise<AgentTask[]> {
    return this.fetchValidated(
      `/api/agents/${id}/tasks?limit=${opts?.limit ?? 20}`,
      AgentTaskListSchema,
      EMPTY_AGENT_TASK_LIST,
      { signal: opts?.signal, endpoint: "GET /api/agents/:id/tasks" },
    );
  }

  async getSquad(id: string, opts?: { signal?: AbortSignal }): Promise<Squad | null> {
    return this.fetchValidated<Squad | null>(
      `/api/squads/${id}`,
      SquadSchema.nullable(),
      null,
      { signal: opts?.signal, endpoint: "GET /api/squads/:id" },
    );
  }

  async listSquadMembers(
    squadId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<SquadMember[]> {
    return this.fetchValidated(
      `/api/squads/${squadId}/members`,
      SquadMemberListSchema,
      EMPTY_SQUAD_MEMBER_LIST,
      { signal: opts?.signal, endpoint: "GET /api/squads/:id/members" },
    );
  }

  // Server-derived working/idle/offline per member (handler/squad.go).
  async getSquadMemberStatus(
    squadId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<SquadMemberStatusListResponse> {
    return this.fetchValidated(
      `/api/squads/${squadId}/members/status`,
      SquadMemberStatusListResponseSchema,
      EMPTY_SQUAD_MEMBER_STATUS_LIST as SquadMemberStatusListResponse,
      { signal: opts?.signal, endpoint: "GET /api/squads/:id/members/status" },
    );
  }

  // --- Issues ---
  async listIssues(
    params: ListIssuesParams = {},
    opts?: { signal?: AbortSignal },
  ): Promise<ListIssuesResponse> {
    const search = new URLSearchParams();
    for (const [key, v] of Object.entries(params)) {
      if (v == null) continue;
      // The server reads the sort as `sort`/`direction` (handler ListIssues),
      // like web's client.ts; `sort_by` would be ignored.
      const k = LIST_PARAM_NAMES[key] ?? key;
      if (Array.isArray(v)) {
        // Backend parses comma-separated lists (server/internal/handler/issue.go
        // uses strings.Split on a single query value). Match web's serialization
        // in packages/core/api/client.ts:407 — repeated keys would silently
        // collapse to the first value only.
        // Actor refs (`assignee_filters`, `creator_filters`) go as `type:id`
        // like web; String() would send "[object Object]" → 400.
        if (v.length > 0) search.set(k, v.map(listParamValue).join(","));
      } else {
        search.set(k, String(v));
      }
    }
    const qs = search.toString();
    const raw = await this.fetch<unknown>(
      `/api/issues${qs ? `?${qs}` : ""}`,
      { signal: opts?.signal },
    );
    return parseWithFallback(raw, ListIssuesResponseSchema, EMPTY_LIST_ISSUES_RESPONSE, {
      endpoint: "GET /api/issues",
    });
  }

  /** Workspace-wide issue search. Backend `GET /api/issues/search` with
   *  workspace resolved by the `X-Workspace-Slug` middleware (same as
   *  `listIssues`). Caller passes its own `AbortController.signal` so the
   *  search modal can cancel an in-flight request when the user types
   *  again — see app/(app)/[workspace]/search.tsx. */
  async searchIssues(
    params: { q: string; limit?: number; include_closed?: boolean; offset?: number },
    opts?: { signal?: AbortSignal },
  ): Promise<SearchIssuesResponse> {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v == null) continue;
      search.set(k, String(v));
    }
    const raw = await this.fetch<unknown>(
      `/api/issues/search?${search.toString()}`,
      { signal: opts?.signal },
    );
    return parseWithFallback(raw, SearchIssuesResponseSchema, EMPTY_SEARCH_ISSUES_RESPONSE, {
      endpoint: "GET /api/issues/search",
    });
  }

  async getIssue(
    id: string,
    opts?: { signal?: AbortSignal },
  ): Promise<Issue> {
    return this.fetchValidated(
      `/api/issues/${id}`,
      IssueSchema,
      EMPTY_ISSUE_FALLBACK,
      { ...opts, endpoint: "getIssue" },
    );
  }

  /** Sub-issues of an issue (`GET /api/issues/:id/children`) — mirrors
   *  core `listChildIssues`; reused for the detail "Sub-issues" section. */
  async listChildIssues(
    id: string,
    opts?: { signal?: AbortSignal },
  ): Promise<Issue[]> {
    const raw = await this.fetch<unknown>(`/api/issues/${id}/children`, {
      signal: opts?.signal,
    });
    const parsed = parseWithFallback(
      raw,
      ChildIssuesResponseSchema,
      { issues: [] as Issue[] },
      { endpoint: "listChildIssues" },
    );
    return parsed.issues;
  }

  // Write endpoint — mirrors POST /api/issues
  // (server/cmd/server/router.go:320, server/internal/handler/issue.go
  // CreateIssue). Mobile sends only the fields the form fills in; backend
  // applies its own defaults for anything omitted.
  async createIssue(body: CreateIssueRequest): Promise<Issue> {
    return this.fetch<Issue>("/api/issues", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // Timeline returns the full ASC entry list in one shot — server-side
  // pagination was dropped in #2322 (p99 ~30 entries per issue, cursors
  // were pure overhead and split reply threads at page boundaries).
  // Call WITHOUT pagination params: the legacy `limit/before/after/around`
  // path returns the old wrapped shape for back-compat, which mobile must
  // NOT trigger. See server/internal/handler/activity.go:60-69.
  async listTimeline(
    issueId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<TimelineEntry[]> {
    // Entry by entry in short blocks instead of one array parse:
    // a long timeline no longer freezes the JS thread while it validates.
    const raw = await this.fetch<unknown>(`/api/issues/${issueId}/timeline`, {
      signal: opts?.signal,
    });
    return parseArrayInChunks<TimelineEntry>(
      raw,
      TimelineEntriesSchema.element,
      EMPTY_TIMELINE_ENTRIES,
      { endpoint: "GET /api/issues/:id/timeline", signal: opts?.signal },
    );
  }

  // GET /api/issues/:id/attachments — list of file attachments hooked to
  // the issue (or its comments). Mobile uses this to resolve `mc://file/<id>`
  // markdown image URIs to their `download_url` HTTPS endpoint; without it,
  // iOS image loader doesn't understand the mc: scheme and renders broken.
  async listAttachments(
    issueId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<Attachment[]> {
    return this.fetchValidated(
      `/api/issues/${issueId}/attachments`,
      AttachmentListSchema,
      EMPTY_ATTACHMENT_LIST,
      { ...opts, endpoint: "GET /api/issues/:id/attachments" },
    );
  }

  // Active tasks for an issue (status in queued/dispatched/running). Returns
  // the inner `tasks` array directly — handler wraps it in `{ tasks: [] }`
  // (server/internal/handler/daemon.go:1866) so the response object survives
  // future field additions without breaking the cache shape.
  async listActiveTasksForIssue(
    issueId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<AgentTask[]> {
    const parsed = await this.fetchValidated(
      `/api/issues/${issueId}/active-task`,
      ActiveTasksResponseSchema,
      EMPTY_ACTIVE_TASKS_RESPONSE,
      { ...opts, endpoint: "GET /api/issues/:id/active-task" },
    );
    return parsed.tasks;
  }

  // All tasks (any status) for an issue — drives the "Runs" history section.
  // Path is `/task-runs` (server/cmd/server/router.go:353), NOT `/tasks` —
  // the latter doesn't exist on this scope.
  async listTasksByIssue(
    issueId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<AgentTask[]> {
    return this.fetchValidated(
      `/api/issues/${issueId}/task-runs`,
      AgentTaskListSchema,
      EMPTY_AGENT_TASK_LIST,
      { ...opts, endpoint: "GET /api/issues/:id/task-runs" },
    );
  }

  async createComment(
    issueId: string,
    content: string,
    opts?: { parentId?: string; type?: string; attachmentIds?: string[] },
  ): Promise<Comment> {
    // Body shape mirrors backend `CreateCommentRequest`
    // (server/internal/handler/comment.go:165). `parent_id` is sent only
    // when present so top-level comments don't carry an explicit null.
    // `type` defaults to "comment" matching web client.ts:686.
    return this.fetchValidatedWith(
      `/api/issues/${issueId}/comments`,
      CommentSchema,
      EMPTY_COMMENT,
      {
        method: "POST",
        body: JSON.stringify({
          content,
          type: opts?.type ?? "comment",
          ...(opts?.parentId ? { parent_id: opts.parentId } : {}),
          ...(opts?.attachmentIds ? { attachment_ids: opts.attachmentIds } : {}),
        }),
      },
      { endpoint: "createComment" },
    );
  }

  // PUT /api/comments/:id — content edit (+ optional attachment swap).
  async updateComment(
    commentId: string,
    content: string,
    attachmentIds?: string[],
    contentBase?: string,
  ): Promise<Comment> {
    return this.fetchValidatedWith(
      `/api/comments/${commentId}`,
      CommentSchema,
      EMPTY_COMMENT,
      {
        method: "PUT",
        body: JSON.stringify(
          buildCommentUpdateBody(content, attachmentIds, contentBase),
        ),
      },
      { endpoint: "updateComment" },
    );
  }

  // DELETE /api/comments/:id — 204 No Content on success; this.fetch
  // already short-circuits 204 → undefined. `keepReplies` calls the route
  // only servers that keep a deleted comment's replies expose (#8296): if the
  // request reaches an older server it fails instead of deleting the replies
  // too. Pass it only when the server declared
  // `comment_delete_keep_replies_supported`. Mirrors packages/core/api/client.ts.
  async deleteComment(
    commentId: string,
    opts: { keepReplies?: boolean } = {},
  ): Promise<void> {
    const path = opts.keepReplies === true
      ? `/api/comments/${commentId}/keep-replies`
      : `/api/comments/${commentId}`;
    await this.fetch<void>(path, { method: "DELETE" });
  }

  // POST /api/comments/:id/resolve — marks the thread root resolved; only
  // meaningful for root comments. Backend mirrors web semantics.
  async resolveComment(commentId: string): Promise<Comment> {
    return this.fetchValidatedWith(
      `/api/comments/${commentId}/resolve`,
      CommentSchema,
      EMPTY_COMMENT,
      { method: "POST" },
      { endpoint: "resolveComment" },
    );
  }

  // DELETE /api/comments/:id/resolve — un-resolves the thread.
  async unresolveComment(commentId: string): Promise<Comment> {
    return this.fetchValidatedWith(
      `/api/comments/${commentId}/resolve`,
      CommentSchema,
      EMPTY_COMMENT,
      { method: "DELETE" },
      { endpoint: "unresolveComment" },
    );
  }

  // --- Reactions ---
  // Comment reactions: POST/DELETE /api/comments/{id}/reactions
  // Issue reactions:   POST/DELETE /api/issues/{id}/reactions
  // Mirror surface from packages/core/api/client.ts:541-573.
  async addReaction(commentId: string, emoji: string): Promise<Reaction> {
    return this.fetch<Reaction>(`/api/comments/${commentId}/reactions`, {
      method: "POST",
      body: JSON.stringify({ emoji }),
    });
  }

  async removeReaction(commentId: string, emoji: string): Promise<void> {
    await this.fetch<void>(`/api/comments/${commentId}/reactions`, {
      method: "DELETE",
      body: JSON.stringify({ emoji }),
    });
  }

  async addIssueReaction(
    issueId: string,
    emoji: string,
  ): Promise<IssueReaction> {
    return this.fetch<IssueReaction>(`/api/issues/${issueId}/reactions`, {
      method: "POST",
      body: JSON.stringify({ emoji }),
    });
  }

  async removeIssueReaction(issueId: string, emoji: string): Promise<void> {
    await this.fetch<void>(`/api/issues/${issueId}/reactions`, {
      method: "DELETE",
      body: JSON.stringify({ emoji }),
    });
  }

  // --- Issue update ---
  // Write endpoint — the mutation surface handles errors via rollback, so
  // we let bad responses surface naturally (no parseWithFallback).
  // Method is PUT to match backend router (server/cmd/server/router.go:327)
  // and web client (packages/core/api/client.ts:465).
  async updateIssue(id: string, body: UpdateIssueRequest): Promise<Issue> {
    return this.fetch<Issue>(`/api/issues/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  // Backend returns 204 No Content on success
  // (server/internal/handler/issue.go DeleteIssue). this.fetch already
  // short-circuits 204 → undefined (api.ts:270), so no body parsing needed.
  async deleteIssue(id: string): Promise<void> {
    await this.fetch<void>(`/api/issues/${id}`, { method: "DELETE" });
  }

  // Board status change / reorder (`POST /api/issues/{id}/move`). The server
  // owns the position; the client only names its neighbours. Same contract
  // as updateIssue: a write whose response the mutation adopts as-is.
  async moveIssue(id: string, body: MoveIssueRequest): Promise<Issue> {
    return this.fetch<Issue>(`/api/issues/${id}/move`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // Both sides of the duplicate relation. Marking goes through updateIssue
  // with `duplicate_of_issue_id` (server sets status cancelled); there is no
  // unmark endpoint in v0.6.1 — a status change away from cancelled clears it.
  async listIssueDuplicates(
    id: string,
    opts?: { signal?: AbortSignal },
  ): Promise<IssueDuplicates> {
    return this.fetchValidated<IssueDuplicates>(
      `/api/issues/${id}/duplicates`,
      IssueDuplicatesResponseSchema,
      { duplicate_of: null, duplicates: [] },
      { signal: opts?.signal, endpoint: "GET /api/issues/:id/duplicates" },
    );
  }

  async batchUpdateIssues(
    issueIds: string[],
    updates: UpdateIssueRequest,
  ): Promise<{ updated: number }> {
    return this.fetchValidatedWith(
      "/api/issues/batch-update",
      BatchUpdateIssuesResponseSchema,
      { updated: 0 },
      { method: "POST", body: JSON.stringify({ issue_ids: issueIds, updates }) },
    );
  }

  async batchDeleteIssues(issueIds: string[]): Promise<{ deleted: number }> {
    return this.fetchValidatedWith(
      "/api/issues/batch-delete",
      BatchDeleteIssuesResponseSchema,
      { deleted: 0 },
      { method: "POST", body: JSON.stringify({ issue_ids: issueIds }) },
    );
  }

  // --- Custom issue properties ---
  // A server without custom properties 404s the catalog; treat that as an
  // empty catalog (same as web) so the property UI simply does not render.
  async listProperties(opts?: {
    includeArchived?: boolean;
    signal?: AbortSignal;
  }): Promise<ListPropertiesResponse> {
    const suffix = opts?.includeArchived ? "?include_archived=true" : "";
    try {
      return await this.fetchValidated(
        `/api/properties${suffix}`,
        ListPropertiesResponseSchema,
        EMPTY_LIST_PROPERTIES_RESPONSE,
        { signal: opts?.signal, endpoint: "GET /api/properties" },
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return EMPTY_LIST_PROPERTIES_RESPONSE;
      }
      throw err;
    }
  }

  async setIssueProperty(
    issueId: string,
    propertyId: string,
    value: IssuePropertyValue,
  ): Promise<IssuePropertiesResponse> {
    return this.fetchValidatedWith(
      `/api/issues/${issueId}/properties/${propertyId}`,
      IssuePropertiesResponseSchema,
      EMPTY_ISSUE_PROPERTIES_RESPONSE,
      { method: "PUT", body: JSON.stringify({ value }) },
      { endpoint: "PUT /api/issues/:id/properties/:propertyId" },
    );
  }

  async unsetIssueProperty(
    issueId: string,
    propertyId: string,
  ): Promise<IssuePropertiesResponse> {
    return this.fetchValidatedWith(
      `/api/issues/${issueId}/properties/${propertyId}`,
      IssuePropertiesResponseSchema,
      EMPTY_ISSUE_PROPERTIES_RESPONSE,
      { method: "DELETE" },
      { endpoint: "DELETE /api/issues/:id/properties/:propertyId" },
    );
  }

  // --- Saved issue views ---
  // A malformed list degrades to [] (only built-in views show); single-view
  // reads/writes degrade to null and the caller refetches the list.
  async listIssueViews(
    params: { scope_type: string; scope_id?: string | null },
    opts?: { signal?: AbortSignal },
  ): Promise<IssueView[]> {
    const qs = new URLSearchParams({ scope_type: params.scope_type });
    if (params.scope_id) qs.set("scope_id", params.scope_id);
    return this.fetchValidated<IssueView[]>(
      `/api/issue-views?${qs.toString()}`,
      IssueViewListSchema,
      [],
      { signal: opts?.signal, endpoint: "GET /api/issue-views" },
    );
  }

  async getIssueView(
    id: string,
    opts?: { signal?: AbortSignal },
  ): Promise<IssueView | null> {
    return this.fetchValidated<IssueView | null>(
      `/api/issue-views/${id}`,
      IssueViewSchema.nullable(),
      null,
      { signal: opts?.signal, endpoint: "GET /api/issue-views/:id" },
    );
  }

  async createIssueView(data: CreateIssueViewRequest): Promise<IssueView | null> {
    return this.fetchValidatedWith<IssueView | null>(
      "/api/issue-views",
      IssueViewSchema.nullable(),
      null,
      { method: "POST", body: JSON.stringify(data) },
    );
  }

  async updateIssueView(
    id: string,
    data: {
      name?: string;
      visibility?: "private" | "workspace";
      scope_variant?: string | null;
      query?: Record<string, unknown>;
      display?: Record<string, unknown>;
      expected_revision: number;
    },
  ): Promise<IssueView | null> {
    return this.fetchValidatedWith<IssueView | null>(
      `/api/issue-views/${id}`,
      IssueViewSchema.nullable(),
      null,
      { method: "PATCH", body: JSON.stringify(data) },
      { endpoint: "PATCH /api/issue-views/:id" },
    );
  }

  async deleteIssueView(id: string): Promise<void> {
    await this.fetch<void>(`/api/issue-views/${id}`, { method: "DELETE" });
  }

  async getIssueViewPreference(
    params: { scope_type: string; scope_id?: string | null },
    opts?: { signal?: AbortSignal },
  ): Promise<IssueViewPreference> {
    const qs = new URLSearchParams({ scope_type: params.scope_type });
    if (params.scope_id) qs.set("scope_id", params.scope_id);
    return this.fetchValidated(
      `/api/issue-view-preferences?${qs.toString()}`,
      IssueViewPreferenceSchema,
      EMPTY_ISSUE_VIEW_PREFERENCE,
      { signal: opts?.signal, endpoint: "GET /api/issue-view-preferences" },
    );
  }

  async putIssueViewPreference(data: {
    scope_type: string;
    scope_id?: string | null;
    prefs: { hidden: string[]; order: string[] };
  }): Promise<IssueViewPreference> {
    return this.fetchValidatedWith(
      "/api/issue-view-preferences",
      IssueViewPreferenceSchema,
      EMPTY_ISSUE_VIEW_PREFERENCE,
      { method: "PUT", body: JSON.stringify(data) },
    );
  }

  // --- Labels ---
  async listLabels(opts?: {
    signal?: AbortSignal;
  }): Promise<ListLabelsResponse> {
    const raw = await this.fetch<unknown>("/api/labels", {
      signal: opts?.signal,
    });
    return parseWithFallback(
      raw,
      ListLabelsResponseSchema,
      EMPTY_LIST_LABELS_RESPONSE,
      { endpoint: "GET /api/labels" },
    );
  }

  // Create a new label and return it. Response is consumed by the
  // create-and-attach flow in label picker, so raw `this.fetch<Label>` is
  // used — same convention as createProject (cache rollback on failure is
  // preferable to a parseWithFallback fallback that would mask server errors).
  async createLabel(body: CreateLabelRequest): Promise<Label> {
    return this.fetch<Label>("/api/labels", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async attachLabel(
    issueId: string,
    labelId: string,
  ): Promise<IssueLabelsResponse> {
    return this.fetch<IssueLabelsResponse>(
      `/api/issues/${issueId}/labels`,
      {
        method: "POST",
        body: JSON.stringify({ label_id: labelId }),
      },
    );
  }

  async detachLabel(
    issueId: string,
    labelId: string,
  ): Promise<IssueLabelsResponse> {
    return this.fetch<IssueLabelsResponse>(
      `/api/issues/${issueId}/labels/${labelId}`,
      { method: "DELETE" },
    );
  }

  // --- Issue status catalog (MUL-6243) ---
  /**
   * The workspace's issue statuses — the 7 built-ins plus any custom ones an
   * admin defined. Reads are open to every workspace member; the catalog
   * mutations are owner/admin only and live on web's settings screen, which is
   * why mobile ships the read alone.
   *
   * `include_archived` is on by design. Archiving retires a status from FUTURE
   * assignment but leaves the issues already on it, and those issues must keep
   * their real name, colour and category — dropping archived rows here would
   * degrade them to a raw key with a guessed category. Pickers filter them out
   * via `IssueStatusCatalog.activeStatuses` instead.
   */
  async listIssueStatuses(
    includeArchived = false,
    opts?: { signal?: AbortSignal },
  ): Promise<ListIssueStatusesResponse> {
    const query = includeArchived ? "?include_archived=true" : "";
    return this.fetchValidated(
      `/api/issue-statuses${query}`,
      ListIssueStatusesResponseSchema,
      EMPTY_LIST_ISSUE_STATUSES_RESPONSE,
      { ...opts, endpoint: "GET /api/issue-statuses" },
    );
  }

  // --- Projects ---
  async listProjects(opts?: {
    signal?: AbortSignal;
  }): Promise<ListProjectsResponse> {
    const raw = await this.fetch<unknown>("/api/projects", {
      signal: opts?.signal,
    });
    return parseWithFallback(
      raw,
      ListProjectsResponseSchema,
      EMPTY_LIST_PROJECTS_RESPONSE,
      { endpoint: "GET /api/projects" },
    );
  }

  /** Workspace-wide project search. See `searchIssues` for the signal
   *  contract. */
  async searchProjects(
    params: { q: string; limit?: number; include_closed?: boolean; offset?: number },
    opts?: { signal?: AbortSignal },
  ): Promise<SearchProjectsResponse> {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v == null) continue;
      search.set(k, String(v));
    }
    const raw = await this.fetch<unknown>(
      `/api/projects/search?${search.toString()}`,
      { signal: opts?.signal },
    );
    return parseWithFallback(
      raw,
      SearchProjectsResponseSchema,
      EMPTY_SEARCH_PROJECTS_RESPONSE,
      { endpoint: "GET /api/projects/search" },
    );
  }

  async getProject(
    id: string,
    opts?: { signal?: AbortSignal },
  ): Promise<Project> {
    const raw = await this.fetch<unknown>(`/api/projects/${id}`, {
      signal: opts?.signal,
    });
    // Drift-safe parse — UI checks `data.id === ""` to render the
    // "project not found / shape drifted" error state instead of a
    // half-populated detail page.
    return parseWithFallback(raw, ProjectSchema, EMPTY_PROJECT, {
      endpoint: "GET /api/projects/:id",
    });
  }

  // Write endpoints — no parseWithFallback (mirrors updateIssue:430). A
  // malformed write response surfaces as an error so the optimistic
  // patch rolls back; pretending the write succeeded with empty data
  // would silently desync caches.
  async createProject(body: CreateProjectRequest): Promise<Project> {
    return this.fetch<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async updateProject(
    id: string,
    body: UpdateProjectRequest,
  ): Promise<Project> {
    return this.fetch<Project>(`/api/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  async deleteProject(id: string): Promise<void> {
    await this.fetch<void>(`/api/projects/${id}`, { method: "DELETE" });
  }

  // --- Project resources ---
  async listProjectResources(
    projectId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<ListProjectResourcesResponse> {
    const raw = await this.fetch<unknown>(
      `/api/projects/${projectId}/resources`,
      { signal: opts?.signal },
    );
    return parseWithFallback(
      raw,
      ListProjectResourcesResponseSchema,
      EMPTY_LIST_PROJECT_RESOURCES_RESPONSE,
      { endpoint: "GET /api/projects/:id/resources" },
    );
  }

  async createProjectResource(
    projectId: string,
    body: CreateProjectResourceRequest,
  ): Promise<ProjectResource> {
    return this.fetch<ProjectResource>(
      `/api/projects/${projectId}/resources`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
  }

  async deleteProjectResource(
    projectId: string,
    resourceId: string,
  ): Promise<void> {
    await this.fetch<void>(
      `/api/projects/${projectId}/resources/${resourceId}`,
      { method: "DELETE" },
    );
  }

  // --- Chat ---
  // Mirrors the surface area of packages/core/api/client.ts chat methods,
  // including session management (rename/pin/archive, queue) for UX §6 G.

  /** Default: active sessions only. `status: "all"` adds archived ones —
   *  the server has no archived-only filter (handler/chat.go). */
  async listChatSessions(
    opts?: { signal?: AbortSignal; status?: "all" },
  ): Promise<ChatSession[]> {
    const query = opts?.status ? `?status=${opts.status}` : "";
    const raw = await this.fetch<unknown>(`/api/chat/sessions${query}`, {
      signal: opts?.signal,
    });
    return parseWithFallback(
      raw,
      ChatSessionListSchema,
      EMPTY_CHAT_SESSION_LIST,
      { endpoint: "GET /api/chat/sessions" },
    );
  }

  async createChatSession(
    data: { agent_id: string; title?: string },
  ): Promise<ChatSession> {
    // Strict parse — a malformed create response derails the optimistic
    // burst (we need the new session id to seed caches). Fallback would
    // be worse than the throw.
    const raw = await this.fetch<unknown>("/api/chat/sessions", {
      method: "POST",
      body: JSON.stringify(data),
    });
    const parsed = ChatSessionSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error("[api] ← shape mismatch POST /api/chat/sessions", {
        issues: parsed.error.issues,
      });
      throw new ApiError("Create chat session response invalid", 0, raw);
    }
    return parsed.data;
  }

  async deleteChatSession(id: string): Promise<void> {
    await this.fetch<void>(`/api/chat/sessions/${id}`, { method: "DELETE" });
  }

  async getChatSession(
    id: string,
    opts?: { signal?: AbortSignal },
  ): Promise<ChatSession | null> {
    return this.fetchValidated<ChatSession | null>(
      `/api/chat/sessions/${id}`,
      ChatSessionSchema.nullable(),
      null,
      { signal: opts?.signal, endpoint: "GET /api/chat/sessions/:id" },
    );
  }

  // Session writes adopt the returned row into the session list. A drifted
  // body yields null and the caller falls back to invalidating the list.
  async renameChatSession(id: string, title: string): Promise<ChatSession | null> {
    return this.fetchValidatedWith<ChatSession | null>(
      `/api/chat/sessions/${id}`,
      ChatSessionSchema.nullable(),
      null,
      { method: "PATCH", body: JSON.stringify({ title }) },
      { endpoint: "PATCH /api/chat/sessions/:id" },
    );
  }

  async setChatSessionPinned(id: string, pinned: boolean): Promise<ChatSession | null> {
    return this.fetchValidatedWith<ChatSession | null>(
      `/api/chat/sessions/${id}/pin`,
      ChatSessionSchema.nullable(),
      null,
      { method: "PATCH", body: JSON.stringify({ pinned }) },
      { endpoint: "PATCH /api/chat/sessions/:id/pin" },
    );
  }

  async setChatSessionArchived(
    id: string,
    archived: boolean,
  ): Promise<ChatSession | null> {
    return this.fetchValidatedWith<ChatSession | null>(
      `/api/chat/sessions/${id}/archive`,
      ChatSessionSchema.nullable(),
      null,
      { method: "PATCH", body: JSON.stringify({ archived }) },
      { endpoint: "PATCH /api/chat/sessions/:id/archive" },
    );
  }

  /** Move a queued task to the front of the session's queue. */
  async prioritizeQueuedChatTask(
    sessionId: string,
    taskId: string,
  ): Promise<PrioritizeQueuedChatTaskResponse> {
    return this.fetchValidatedWith(
      `/api/chat/sessions/${sessionId}/queued-tasks/${taskId}/prioritize`,
      PrioritizeQueuedChatTaskResponseSchema,
      EMPTY_PRIORITIZE_QUEUED_CHAT_TASK_RESPONSE,
      { method: "POST" },
      { endpoint: "POST /api/chat/sessions/:id/queued-tasks/:taskId/prioritize" },
    );
  }

  async clearQueuedChatTasks(sessionId: string): Promise<void> {
    await this.fetch<void>(`/api/chat/sessions/${sessionId}/queued-tasks`, {
      method: "DELETE",
    });
  }

  async listChatMessages(
    sessionId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<ChatMessage[]> {
    const raw = await this.fetch<unknown>(
      `/api/chat/sessions/${sessionId}/messages`,
      { signal: opts?.signal },
    );
    return parseWithFallback(
      raw,
      ChatMessageListSchema,
      EMPTY_CHAT_MESSAGE_LIST,
      { endpoint: "GET /api/chat/sessions/:id/messages" },
    );
  }

  async sendChatMessage(
    sessionId: string,
    content: string,
    opts?: { attachmentIds?: string[] },
  ): Promise<SendChatMessageResponse> {
    // Strict parse — we need task_id + created_at to anchor the optimistic
    // StatusPill. Fallback would silently break the elapsed-time timer.
    //
    // `attachment_ids` mirrors the comment / issue create payloads —
    // server-side `chat.go` back-fills `chat_message_id` on the listed
    // attachments after the message row is inserted (see
    // server/internal/handler/chat.go:410-456).
    const body: { content: string; attachment_ids?: string[] } = { content };
    if (opts?.attachmentIds && opts.attachmentIds.length > 0) {
      body.attachment_ids = opts.attachmentIds;
    }
    const raw = await this.fetch<unknown>(
      `/api/chat/sessions/${sessionId}/messages`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
    const parsed = SendChatMessageResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error("[api] ← shape mismatch POST /api/chat/sessions/:id/messages", {
        issues: parsed.error.issues,
      });
      throw new ApiError("Send message response invalid", 0, raw);
    }
    return parsed.data;
  }

  async getPendingChatTask(
    sessionId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<ChatPendingTask> {
    const raw = await this.fetch<unknown>(
      `/api/chat/sessions/${sessionId}/pending-task`,
      { signal: opts?.signal },
    );
    return parseWithFallback(
      raw,
      ChatPendingTaskSchema,
      EMPTY_CHAT_PENDING_TASK,
      { endpoint: "GET /api/chat/sessions/:id/pending-task" },
    );
  }

  async markChatSessionRead(sessionId: string): Promise<void> {
    await this.fetch<void>(
      `/api/chat/sessions/${sessionId}/read`,
      { method: "POST" },
    );
  }

  async cancelTaskById(taskId: string): Promise<void> {
    await this.fetch<void>(`/api/tasks/${taskId}/cancel`, { method: "POST" });
  }

  /** Re-run one past run of an issue (web's RetryRunButton): `task_id`
   *  targets that run's agent instead of the current assignee. The new task
   *  arrives through the task queries' refetch, so the body is unused. */
  async rerunIssue(issueId: string, taskId: string): Promise<void> {
    await this.fetch<void>(`/api/issues/${issueId}/rerun`, {
      method: "POST",
      body: JSON.stringify({ task_id: taskId }),
    });
  }

  /** Live execution timeline for a task — used by the chat screen to
   *  render the "thinking → tool_use → tool_result → final text" trace
   *  beneath an in-flight assistant bubble. `task:message` WS events
   *  append to the same cache key in real time (see
   *  use-chat-session-realtime.ts). */
  async listTaskMessages(
    taskId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<TaskMessagePayload[]> {
    return this.fetchValidated(
      `/api/tasks/${taskId}/messages`,
      TaskMessageListSchema,
      EMPTY_TASK_MESSAGE_LIST,
      { ...opts, endpoint: "GET /api/tasks/:id/messages" },
    );
  }

  // --- Issue wakeups ---
  //
  // Ported from packages/core/api/client.ts (v0.6.1); routes in
  // server/cmd/server/router.go. Schemas live in data/wakeup-schemas.ts and
  // degrade unknown `kind` / `paused_reason` values instead of failing.
  // Reads fall back to empty values; the writes that answer with the stored
  // rule (create, enable, disable) return `null` for an unusable body, the
  // 204 writes (instruction, trigger, delete) have no body to parse.
  // `checkin` is an agent action and has no client method.

  private wakeupPath(issueId: string, wakeupId?: string): string {
    const base = `/api/issues/${encodeURIComponent(issueId)}/wakeups`;
    return wakeupId ? `${base}/${encodeURIComponent(wakeupId)}` : base;
  }

  async listIssueWakeups(
    issueId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<MobileIssueWakeup[]> {
    return this.fetchValidated(
      this.wakeupPath(issueId),
      IssueWakeupListSchema,
      EMPTY_ISSUE_WAKEUP_LIST,
      { signal: opts?.signal, endpoint: "GET /api/issues/:id/wakeups" },
    );
  }

  async createIssueWakeup(
    issueId: string,
    input: IssueWakeupInput,
  ): Promise<MobileIssueWakeup | null> {
    return this.fetchValidatedWith<MobileIssueWakeup | null>(
      this.wakeupPath(issueId),
      IssueWakeupResultSchema,
      null,
      { method: "POST", body: JSON.stringify(input) },
      { endpoint: "POST /api/issues/:id/wakeups" },
    );
  }

  async disableIssueWakeup(
    issueId: string,
    wakeupId: string,
  ): Promise<MobileIssueWakeup | null> {
    return this.fetchValidatedWith<MobileIssueWakeup | null>(
      `${this.wakeupPath(issueId, wakeupId)}/disable`,
      IssueWakeupResultSchema,
      null,
      { method: "POST" },
      { endpoint: "POST /api/issues/:id/wakeups/:wid/disable" },
    );
  }

  /** `at` sets a new time when the old one has passed; `rearm` restarts a
   *  relative wait. `revision` guards against a concurrent edit (409). */
  async enableIssueWakeup(
    issueId: string,
    wakeupId: string,
    input: { revision: number; at?: string; rearm?: boolean },
  ): Promise<MobileIssueWakeup | null> {
    return this.fetchValidatedWith<MobileIssueWakeup | null>(
      `${this.wakeupPath(issueId, wakeupId)}/enable`,
      IssueWakeupResultSchema,
      null,
      { method: "POST", body: JSON.stringify(input) },
      { endpoint: "POST /api/issues/:id/wakeups/:wid/enable" },
    );
  }

  /** 409 when the rule changed meanwhile → caller reloads. */
  async editIssueWakeupInstruction(
    issueId: string,
    wakeupId: string,
    input: { instruction: string; expected_instruction: string; revision: number },
  ): Promise<void> {
    await this.fetch<void>(`${this.wakeupPath(issueId, wakeupId)}/instruction`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  async triggerIssueWakeup(issueId: string, wakeupId: string): Promise<void> {
    await this.fetch<void>(`${this.wakeupPath(issueId, wakeupId)}/trigger`, {
      method: "POST",
    });
  }

  async deleteIssueWakeup(issueId: string, wakeupId: string): Promise<void> {
    await this.fetch<void>(this.wakeupPath(issueId, wakeupId), { method: "DELETE" });
  }

  async listIssueWakeupRuns(
    issueId: string,
    wakeupId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<WakeupRun[]> {
    return this.fetchValidated(
      `${this.wakeupPath(issueId, wakeupId)}/runs`,
      WakeupRunListSchema,
      EMPTY_WAKEUP_RUN_LIST,
      { signal: opts?.signal, endpoint: "GET /api/issues/:id/wakeups/:wid/runs" },
    );
  }

  /** One row per active rule, for the issue header chip and list counters. */
  async listIssueWakeupSummaries(
    opts?: { signal?: AbortSignal },
  ): Promise<MobileIssueWakeupSummaryRow[]> {
    return this.fetchValidated(
      "/api/issue-wakeup-summaries",
      IssueWakeupSummaryListSchema,
      EMPTY_ISSUE_WAKEUP_SUMMARY_LIST,
      { signal: opts?.signal, endpoint: "GET /api/issue-wakeup-summaries" },
    );
  }

  /** Workspace overview (Autopilots → Wakeups). Missing filters use the
   *  defaults of the web page (scope "active", 50 per page). */
  async listWorkspaceWakeups(
    filters: Partial<WorkspaceWakeupFilters> = {},
    opts?: { signal?: AbortSignal },
  ): Promise<MobileWorkspaceWakeupPage> {
    const merged = { ...DEFAULT_WORKSPACE_WAKEUP_FILTERS, ...filters };
    const params = new URLSearchParams(
      Object.entries(merged).map(([key, value]) => [key, String(value)]),
    );
    return this.fetchValidated(
      `/api/issue-wakeups?${params}`,
      WorkspaceWakeupPageSchema,
      EMPTY_WORKSPACE_WAKEUP_PAGE,
      { signal: opts?.signal, endpoint: "GET /api/issue-wakeups" },
    );
  }

  async listPausedWakeups(opts?: { signal?: AbortSignal }): Promise<MobilePausedWakeup[]> {
    return this.fetchValidated(
      "/api/issue-wakeup-paused",
      PausedWakeupListSchema,
      EMPTY_PAUSED_WAKEUP_LIST,
      { signal: opts?.signal, endpoint: "GET /api/issue-wakeup-paused" },
    );
  }

  async listIssueSystemWakeups(
    issueId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<MobileSystemWakeup[]> {
    return this.fetchValidated(
      `/api/issues/${encodeURIComponent(issueId)}/system-wakeups`,
      SystemWakeupListSchema,
      EMPTY_SYSTEM_WAKEUP_LIST,
      { signal: opts?.signal, endpoint: "GET /api/issues/:id/system-wakeups" },
    );
  }

  /** Answers with the issue's full system rule list. */
  async updateIssueSystemWakeup(
    issueId: string,
    rule: SystemWakeup["rule"],
    input: { enabled?: boolean; instruction?: string },
  ): Promise<MobileSystemWakeup[]> {
    return this.fetchValidatedWith(
      `/api/issues/${encodeURIComponent(issueId)}/system-wakeups/${encodeURIComponent(rule)}`,
      SystemWakeupListSchema,
      EMPTY_SYSTEM_WAKEUP_LIST,
      { method: "PUT", body: JSON.stringify(input) },
      { endpoint: "PUT /api/issues/:id/system-wakeups/:rule" },
    );
  }

  // --- Pins ---
  //
  // Pin metadata only — title / status / icon for each row come from
  // `issueDetailOptions` / `projectDetailOptions` on the consumer side.
  // Endpoints mirror packages/core/api/client.ts:1551-1572.

  async listPins(opts?: { signal?: AbortSignal }): Promise<PinnedItem[]> {
    // include=view opts in to view pins; without it the server
    // withholds them, as from old builds that took any non-issue pin for a
    // project pin.
    return this.fetchValidated(
      "/api/pins?include=view",
      PinListSchema,
      EMPTY_PIN_LIST,
      { ...opts, endpoint: "listPins" },
    );
  }

  async createPin(data: {
    item_type: PinnedItemType;
    item_id: string;
  }): Promise<PinnedItem> {
    return this.fetchValidatedWith(
      "/api/pins",
      PinnedItemSchema,
      // Mirror EMPTY_PIN_LIST element shape — onSuccess uses the returned
      // pin's id/position so a stub with empty id is detectable downstream.
      {
        id: "",
        workspace_id: "",
        user_id: "",
        item_type: data.item_type,
        item_id: data.item_id,
        position: 0,
        created_at: "",
      },
      { method: "POST", body: JSON.stringify(data) },
      { endpoint: "createPin" },
    );
  }

  async deletePin(itemType: PinnedItemType, itemId: string): Promise<void> {
    await this.fetch<void>(`/api/pins/${itemType}/${itemId}`, {
      method: "DELETE",
    });
  }

  async reorderPins(data: ReorderPinsRequest): Promise<void> {
    await this.fetch<void>("/api/pins/reorder", {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  // --- Autopilots ---
  //
  // Ported from packages/core/api/client.ts (v0.6.1); routes in
  // server/cmd/server/router.go. Schemas live in data/autopilot-schemas.ts
  // and degrade unknown status / trigger kinds to "unknown" instead of
  // failing. Reads fall back to empty values or `null` (detail, run); the
  // writes that answer with a body (trigger, PATCH) return `null` for an
  // unusable one. Create/edit, triggers, deliveries and collaborators are
  // wave 2 and have no client method yet.

  private autopilotPath(id?: string): string {
    return id ? `/api/autopilots/${encodeURIComponent(id)}` : "/api/autopilots";
  }

  /** `status` filters on the server (`?status=active|paused|archived`). */
  async listAutopilots(
    params: { status?: string } = {},
    opts?: { signal?: AbortSignal },
  ): Promise<MobileAutopilotList> {
    const search = new URLSearchParams();
    if (params.status) search.set("status", params.status);
    const query = search.toString();
    return this.fetchValidated(
      query ? `${this.autopilotPath()}?${query}` : this.autopilotPath(),
      AutopilotListSchema,
      EMPTY_AUTOPILOT_LIST,
      { signal: opts?.signal, endpoint: "GET /api/autopilots" },
    );
  }

  /** `null` when the body has no usable autopilot (→ not-found state). */
  async getAutopilot(
    id: string,
    opts?: { signal?: AbortSignal },
  ): Promise<MobileAutopilotDetail | null> {
    return this.fetchValidated<MobileAutopilotDetail | null>(
      this.autopilotPath(id),
      AutopilotDetailSchema,
      null,
      { signal: opts?.signal, endpoint: "GET /api/autopilots/:id" },
    );
  }

  /**
   * "Run now". The answer is a run whose `status` the caller MUST branch on:
   * `skipped` (runtime offline) and `failed` are no success.
   * A quota rejection is a 429 ApiError. `null` = unusable body (neutral
   * toast, never success). Pass the same `idempotencyKey` to retry safely.
   */
  async triggerAutopilot(
    id: string,
    opts?: { idempotencyKey?: string },
  ): Promise<MobileAutopilotRun | null> {
    return this.fetchValidatedWith<MobileAutopilotRun | null>(
      `${this.autopilotPath(id)}/trigger`,
      AutopilotRunResultSchema,
      null,
      {
        method: "POST",
        headers: { "Idempotency-Key": opts?.idempotencyKey ?? `mobile-${createRequestId()}` },
      },
      { endpoint: "POST /api/autopilots/:id/trigger" },
    );
  }

  /** Pause or resume. Answers with the stored autopilot; `null` = unusable body. */
  async setAutopilotStatus(
    id: string,
    status: AutopilotSettableStatus,
  ): Promise<MobileAutopilot | null> {
    return this.fetchValidatedWith<MobileAutopilot | null>(
      this.autopilotPath(id),
      AutopilotResultSchema,
      null,
      { method: "PATCH", body: JSON.stringify({ status }) },
      { endpoint: "PATCH /api/autopilots/:id" },
    );
  }

  /** 204; earlier runs and created issues stay on the server. */
  async deleteAutopilot(id: string): Promise<void> {
    await this.fetch<void>(this.autopilotPath(id), { method: "DELETE" });
  }

  /** Newest first. The server caps `limit` at 100 and reports the page length as `total`. */
  async listAutopilotRuns(
    id: string,
    params: { limit?: number; offset?: number } = {},
    opts?: { signal?: AbortSignal },
  ): Promise<MobileAutopilotRunList> {
    const search = new URLSearchParams({
      limit: String(params.limit ?? AUTOPILOT_RUNS_PAGE_SIZE),
      offset: String(params.offset ?? 0),
    });
    return this.fetchValidated(
      `${this.autopilotPath(id)}/runs?${search}`,
      AutopilotRunListSchema,
      EMPTY_AUTOPILOT_RUN_LIST,
      { signal: opts?.signal, endpoint: "GET /api/autopilots/:id/runs" },
    );
  }

  /** Full run incl. `trigger_payload` / `result`; `null` = unusable body. */
  async getAutopilotRun(
    id: string,
    runId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<MobileAutopilotRun | null> {
    return this.fetchValidated<MobileAutopilotRun | null>(
      `${this.autopilotPath(id)}/runs/${encodeURIComponent(runId)}`,
      AutopilotRunResultSchema,
      null,
      { signal: opts?.signal, endpoint: "GET /api/autopilots/:id/runs/:runId" },
    );
  }

  // --- File Upload ---

  /**
   * Multipart-stream a file to `/api/upload-file`. Mirrors the web
   * implementation in `packages/core/api/client.ts:uploadFile` but with the
   * RN-shaped `FileAsset` instead of a browser `File`. The fetch FormData
   * polyfill recognises `{ uri, name, type }` and reads the file off disk.
   *
   * `opts.issueId` / `opts.commentId` link the attachment record. Pass
   * `issueId` when uploading from a comment composer / reply input; leave
   * both empty when uploading from a not-yet-created issue (the attachment
   * is hooked to the issue once it's created — same flow as web).
   *
   * Does NOT use `this.fetch` because:
   *   - FormData must not have a `Content-Type` header preset (the browser /
   *     RN fetch needs to set the multipart boundary itself).
   *   - `this.fetch` hard-codes `application/json`.
   *
   * So we re-implement the auth + slug + logging shell inline.
   */
  async uploadFile(
    asset: FileAsset,
    opts?: { issueId?: string; commentId?: string },
  ): Promise<Attachment> {
    const rid = createRequestId();
    const start = Date.now();
    const path = "/api/upload-file";

    const baseUrl = requireBaseUrl();
    const requestUrl = `${baseUrl}${path}`;
    const headers: Record<string, string> = {
      // No Content-Type — let fetch set the multipart boundary.
      "X-Client-Platform": "mobile",
      "X-Client-OS": CLIENT_OS,
      "X-Client-Version": "0.1.0",
      "X-Request-ID": rid,
      ...getCfAccessHeaders(),
    };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    const slug = getCurrentSlug();
    if (slug) headers["X-Workspace-Slug"] = slug;

    const formData = new FormData();
    // RN's FormData accepts `{ uri, name, type }` as the file value.
    // `as never` quiets TS (the global FormData type expects `Blob | string`).
    formData.append(
      "file",
      { uri: asset.uri, name: asset.name, type: asset.type } as never,
    );
    if (opts?.issueId) formData.append("issue_id", opts.issueId);
    if (opts?.commentId) formData.append("comment_id", opts.commentId);

    logger.log(`[api] → POST ${path}`, { rid, filename: asset.name });

    const res = await fetch(requestUrl, {
      method: "POST",
      headers,
      body: formData,
    });
    const duration = Date.now() - start;

    const accessBlock = await accessBlockFrom(res, requestUrl);
    if (accessBlock) {
      logger.warn(`[api] ← ACCESS BLOCKED ${path}`, { rid, status: res.status });
      throw accessBlock;
    }

    if (!res.ok) {
      if (res.status === 401) this.options.onUnauthorized?.();
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }
      const message =
        (body && typeof body === "object" && "message" in body
          ? String((body as { message: unknown }).message)
          : null) ?? `Upload failed: ${res.status}`;
      logger.error(`[api] ← ${res.status} ${path}`, {
        rid,
        duration: `${duration}ms`,
        error: message,
      });
      throw new ApiError(message, res.status, body);
    }

    logger.log(`[api] ← ${res.status} ${path}`, {
      rid,
      duration: `${duration}ms`,
    });

    // Strict validation: parseWithFallback's silent-fallback pattern doesn't
    // fit here — an attachment without a `url` would be inserted into the
    // user's text as `![](undefined)`. Throw on shape mismatch so the
    // caller's Alert path fires instead of letting a broken link land in
    // the editor.
    const json: unknown = await res.json();
    const parsed = AttachmentSchema.safeParse(json);
    if (!parsed.success) {
      logger.error(`[api] ← shape mismatch ${path}`, {
        rid,
        error: parsed.error.message,
      });
      throw new ApiError("Upload response invalid", res.status, json);
    }
    return parsed.data;
  }
}

export { MAX_FILE_SIZE };

export const api = new ApiClient();
