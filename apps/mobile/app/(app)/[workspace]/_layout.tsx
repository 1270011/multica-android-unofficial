import { useEffect } from "react";
import type { ComponentProps } from "react";
import { Platform } from "react-native";
import { Redirect, Stack, router, useLocalSearchParams } from "expo-router";
import { HeaderBackButton, HeaderTitle } from "@react-navigation/elements";
import { HEADER_MAX_FONT_SCALE } from "@/lib/header-scale";
import { useQuery } from "@tanstack/react-query";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useWorkspaceStore } from "@/data/workspace-store";
import { RealtimeProvider } from "@/data/realtime/realtime-provider";
import { useInboxRealtime } from "@/data/realtime/use-inbox-realtime";
import { useIssuesRealtime } from "@/data/realtime/use-issues-realtime";
import { useMyIssuesRealtime } from "@/data/realtime/use-my-issues-realtime";
import { usePropertiesRealtime } from "@/data/realtime/use-properties-realtime";
import { useChatSessionsRealtime } from "@/data/realtime/use-chat-sessions-realtime";
import { useInvitationsRealtime } from "@/data/realtime/use-invitations-realtime";
import { useProjectsRealtime } from "@/data/realtime/use-projects-realtime";
import { usePinsRealtime } from "@/data/realtime/use-pins-realtime";
import { usePresenceRealtime } from "@/data/realtime/use-presence-realtime";
import { useWorkspacePresencePrefetch } from "@/lib/use-workspace-presence-prefetch";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { useNewIssueDraftResetOnWorkspaceChange } from "@/data/stores/new-issue-draft-store";
import { useNewProjectDraftResetOnWorkspaceChange } from "@/data/stores/new-project-draft-store";
import { useChatSessionPickerResetOnWorkspaceChange } from "@/data/stores/chat-session-picker-store";
import { useT } from "@/lib/i18n";
import { useNotifyBridge } from "@/lib/notify/use-notify-bridge";
import { showToast } from "@/lib/toast";
import { modalPresentation } from "@/lib/modal-presentation";
import { perfMark } from "@/lib/perf-mark";

/**
 * Shared Stack.Screen options for every iOS formSheet-presented sheet route.
 *
 * Why these specific values:
 *   - `presentation: "formSheet"` instantiates iOS
 *     UISheetPresentationController — native grabber, stacked-card backdrop,
 *     drag-to-dismiss spring physics, detents.
 *   - `sheetAllowedDetents: [0.6, 0.95]` — explicit numeric detents. The
 *     ergonomic `"fitToContents"` is broken on iOS 26 + Expo 55
 *     (expo/expo#42904 padding inconsistency, expo/expo#42965 zero-size).
 *     Predictable two-snap presentation across every picker-row sheet >
 *     shrink-wrap; this is the right default for sheets that sit next to
 *     other sheets in the same chip row (issue / project AttributeRow) so
 *     the user gets the same gesture regardless of which chip they tap.
 *     Isolated sheets that have no neighbour to be consistent with (e.g.
 *     the workspace `menu` sheet) override this with `"fitToContents"`
 *     to avoid the large blank area below their content.
 *   - `sheetGrabberVisible: true` — surfaces the iOS native drag handle
 *     so users discover the gesture.
 *   - `contentStyle.height: "100%"` — safety net against the same
 *     zero-size class of bugs above; ensures the sheet body fills the
 *     allotted detent.
 *   - `headerShown: false` — every sheet body draws its own header (title
 *     + optional right action). The native Stack header would double up.
 */
/** Full-screen modal routes; Android uses a card (lib/modal-presentation.ts). */
const MODAL_PRESENTATION = modalPresentation(Platform.OS);

const SHEET_OPTIONS: ComponentProps<typeof Stack.Screen>["options"] = {
  presentation: "formSheet",
  sheetGrabberVisible: true,
  sheetAllowedDetents: [0.6, 0.95],
  sheetCornerRadius: 20,
  contentStyle: { flex: 1 },
  headerShown: false,
};

/**
 * Cold-start deep-link anchor. Expo Router otherwise treats whatever
 * route resolves the URL as the root of the stack — if the user opens a
 * notification that targets `issue/[id]/picker/status` directly, they
 * land on the formSheet with NO parent under it, no way to go back to
 * the tabs. `anchor: "(tabs)"` tells the router to mount the tab UI as
 * the implicit underlying screen so back/swipe-dismiss returns the user
 * to a sensible base state.
 */
export const unstable_settings = { anchor: "(tabs)" } as const;

/**
 * Mounts every per-feature realtime subscription. Lives inside
 * RealtimeProvider so the WSClient context is available, and stays alive
 * for the whole workspace session — the inbox unread count must keep
 * refreshing even while the user is on an issue page or settings, not
 * just when the inbox tab is foregrounded.
 *
 * Add new realtime feature hooks here as they land (issue, chat, etc).
 */
function RealtimeSubscriptions() {
  useInboxRealtime();
  useIssuesRealtime();
  useMyIssuesRealtime();
  usePropertiesRealtime();
  useChatSessionsRealtime();
  useInvitationsRealtime();
  useProjectsRealtime();
  usePinsRealtime();
  // Presence: warm the three queries up front so avatars don't flash a
  // dotless first render, and listen for daemon/agent/task events to keep
  // the runtime + snapshot caches fresh. See use-presence-realtime.ts for
  // the deliberately-skipped high-frequency events.
  useWorkspacePresencePrefetch();
  usePresenceRealtime();
  // Strings, workspaces, actor names and foreground (re)start
  // for the native notification service.
  useNotifyBridge();
  return null;
}

/**
 * A route (usually a deep link) names a workspace the
 * account does not belong to: stay in the current workspace and say so,
 * without echoing the foreign slug. Without a current workspace fall back to
 * the workspace selection as before.
 */
function UnknownWorkspace({ slug }: { slug: string | undefined }) {
  // A stale persisted slug (membership lost) is the same as the route's:
  // going "back" to it would loop, so that case goes to the selection.
  const stored = useWorkspaceStore.getState().currentWorkspaceSlug;
  const current = stored && stored !== slug ? stored : null;
  useEffect(() => {
    if (current) showToast({ key: "issues:chat.no_workspace_access" });
  }, [current]);
  return <Redirect href={current ? `/${current}/inbox` : "/select-workspace"} />;
}

/**
 * Workspace context layout. Reads the slug from the URL (the route is the
 * source of truth — see apps/mobile/CLAUDE.md "Behavioral parity"), validates
 * membership against the workspaces list, then syncs id+slug into the
 * Zustand store so ApiClient.fetch can read the slug synchronously when
 * injecting the X-Workspace-Slug header.
 *
 * If the slug doesn't match any workspace the user belongs to, redirect to
 * /select-workspace (covers stale persisted slugs after the user lost
 * membership, deep links to wrong slugs, etc.).
 */
export default function WorkspaceLayout() {
  perfMark("render:ws");
  const { workspace: slug } = useLocalSearchParams<{ workspace: string }>();
  const { t } = useT("navigation");
  const { data: workspaces, isLoading } = useQuery(workspaceListOptions());
  const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace);

  const matched = workspaces?.find((w) => w.slug === slug);

  useEffect(() => {
    if (matched) {
      setCurrentWorkspace(matched.id, matched.slug);
    }
  }, [matched, setCurrentWorkspace]);

  // Wipe cross-route Zustand draft stores whenever the active workspace
  // changes — a draft picked under workspace A (assignee id, draft
  // session id, etc.) is invalid in workspace B and must not leak.
  useNewIssueDraftResetOnWorkspaceChange(matched?.id ?? null);
  useNewProjectDraftResetOnWorkspaceChange(matched?.id ?? null);
  useChatSessionPickerResetOnWorkspaceChange(matched?.id ?? null);

  // Wait for the workspaces list before deciding membership — otherwise a
  // valid deep link would briefly redirect away on cold start.
  if (isLoading) return null;

  if (!matched) return <UnknownWorkspace slug={slug} />;

  // Tabs hide their own header; pushed screens (issue/[id]) get a native
  // iOS Stack header with the standard back button + swipe-to-dismiss.
  // Android: the native toolbar's back arrow is described by AppCompat's
  // system-locale string ("Navigate up"), which ignores the in-app language.
  // Render our own back button there so the label follows i18n.
  // iOS keeps the native back button and its system label.
  // Android stack headers: the title scales only up to HEADER_MAX_FONT_SCALE,
  // so it stays inside the bar at 200 %. Screens
  // with their own headerTitle (chat) override this. Not on iOS.
  const headerTitle = ({ children, tintColor }: { children: string; tintColor?: string }) => (
    <HeaderTitle tintColor={tintColor} numberOfLines={1} maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}>
      {children}
    </HeaderTitle>
  );
  const localizedBack: ComponentProps<typeof Stack>["screenOptions"] =
    Platform.OS === "android"
      ? {
          headerTitle,
          headerBackVisible: false,
          headerLeft: ({ canGoBack, tintColor }) =>
            canGoBack ? (
              <HeaderBackButton
                tintColor={tintColor}
                displayMode="minimal"
                accessibilityLabel={t("back")}
                onPress={() => router.back()}
                // The elements button is ~24 dp; pad it to a 48 dp target.
                style={{ marginLeft: -8, minWidth: 48, minHeight: 48, justifyContent: "center" }}
              />
            ) : null,
        }
      : // iOS keeps its native (already capped) navigation-bar title.
        undefined;

  return (
    <RealtimeProvider>
      <RealtimeSubscriptions />
      <Stack screenOptions={localizedBack}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="issue/[id]"
          options={{
            title: t("navigation:routes.issue"),
            headerBackTitle: t("back"),
          }}
        />
        {/* Issue chat. Header title is set by
            the screen (identifier + title, tap → detail). */}
        <Stack.Screen
          name="issue/[id]/chat"
          options={{
            title: t("navigation:routes.issue_chat"),
            headerBackTitle: t("back"),
          }}
        />
        <Stack.Screen
          name="project/[id]"
          options={{
            title: t("navigation:routes.project"),
            headerBackTitle: t("back"),
          }}
        />
        <Stack.Screen
          name="project/[id]/edit"
          options={{
            title: t("navigation:routes.edit_project"),
            ...MODAL_PRESENTATION,
            headerLeft: () => <ModalCloseButton />,
          }}
        />
        <Stack.Screen
          name="issue/[id]/edit"
          options={{
            title: t("navigation:routes.edit_issue"),
            ...MODAL_PRESENTATION,
            headerLeft: () => <ModalCloseButton />,
          }}
        />
        <Stack.Screen
          name="project/new"
          options={{
            title: t("navigation:routes.new_project"),
            ...MODAL_PRESENTATION,
            headerLeft: () => <ModalCloseButton />,
          }}
        />
        <Stack.Screen name="inbox/[id]" options={SHEET_OPTIONS} />
        {/* Issue-detail formSheet pickers. All share the same sheet config:
            explicit numeric detents to dodge expo/expo#42904+#42965 (the
            `fitToContents` zero-size / padding bugs on iOS 26 + Expo 55),
            iOS native grabber, and contentStyle.height=100% as a safety
            net against the same zero-size class of bugs. */}
        {/* Status change from a board card. */}
        <Stack.Screen
          name="issue/[id]/picker/board-status"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="issue/[id]/picker/status"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="issue/[id]/picker/priority"
          options={SHEET_OPTIONS}
        />
        {/* Experiment: assignee uses iOS-native nav header + UISearchController
            instead of the body-rendered header pattern in SHEET_OPTIONS.
            Eliminates the #3634 overlap class of bugs and the focus-loss
            footgun of a custom TextInput inside ListHeaderComponent. The
            route file wires `headerSearchBarOptions` via setOptions. If this
            proves out, propagate to label / project / other search pickers
            and update CLAUDE.md Lesson 6 with a carve-out. */}
        <Stack.Screen
          name="issue/[id]/picker/assignee"
          options={{
            ...SHEET_OPTIONS,
            headerShown: true,
            title: t("navigation:routes.assignee"),
          }}
        />
        <Stack.Screen
          name="issue/[id]/picker/label"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="mention-picker"
          options={{
            ...SHEET_OPTIONS,
            headerShown: true,
            title: t("navigation:routes.mention"),
          }}
        />
        <Stack.Screen
          name="issue/[id]/picker/project"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="issue/[id]/picker/due-date"
          options={SHEET_OPTIONS}
        />
        {/* Editor for one custom property value. */}
        <Stack.Screen
          name="issue/[id]/picker/property"
          options={SHEET_OPTIONS}
        />
        {/* Start date, stage, parent, duplicate. */}
        <Stack.Screen
          name="issue/[id]/picker/start-date"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="issue/[id]/picker/stage"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="issue/[id]/picker/parent"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="issue/[id]/picker/duplicate"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen name="issue/[id]/runs" options={SHEET_OPTIONS} />
        {/* Wakeup instruction edit and new time. */}
        <Stack.Screen name="issue/[id]/wakeup-instruction" options={SHEET_OPTIONS} />
        <Stack.Screen name="issue/[id]/wakeup-reschedule" options={SHEET_OPTIONS} />
        {/* System wakeup "Unteraufgaben fertig". */}
        <Stack.Screen name="issue/[id]/system-wakeup" options={SHEET_OPTIONS} />
        {/* "+ Wakeup", two steps, nearly full height. */}
        <Stack.Screen
          name="issue/[id]/wakeup-create"
          options={{ ...SHEET_OPTIONS, sheetAllowedDetents: [0.95] }}
        />
        {/* Runs of one wakeup; the screen sets the title. */}
        <Stack.Screen
          name="issue/[id]/wakeups/[wakeupId]"
          options={{
            title: t("navigation:routes.wakeup_runs"),
            headerBackTitle: t("back"),
          }}
        />
        {/* Who is subscribed (read-only). */}
        <Stack.Screen name="issue/[id]/subscribers" options={SHEET_OPTIONS} />
        {/* Full emoji picker for a comment reaction. Pushed from the "+"
            button inside the comment long-press tapback row — see
            components/issue/comment-context-menu.tsx. */}
        <Stack.Screen
          name="issue/[id]/comment/[commentId]/emoji-picker"
          options={SHEET_OPTIONS}
        />
        {/* Project-detail formSheet pickers. */}
        <Stack.Screen
          name="project/[id]/picker/status"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="project/[id]/picker/priority"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="project/[id]/picker/lead"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="project/[id]/add-resource"
          options={SHEET_OPTIONS}
        />
        {/* New-issue draft formSheet pickers — stacked on top of the
            new-issue.tsx Stack.Screen (which is itself a `modal`).
            Expo Router 55 / RN Screens 4 support a formSheet pushed on top
            of a modal in the same Stack. */}
        <Stack.Screen
          name="new-issue-picker/status"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="new-issue-picker/priority"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="new-issue-picker/assignee"
          options={{
            ...SHEET_OPTIONS,
            headerShown: true,
            title: t("navigation:routes.assignee"),
          }}
        />
        <Stack.Screen
          name="new-issue-picker/project"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="new-issue-picker/due-date"
          options={SHEET_OPTIONS}
        />
        {/* New-project draft formSheet pickers — same pattern as
            new-issue-picker/*. Stacked on top of `project/new` (a modal). */}
        <Stack.Screen
          name="new-project-picker/status"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="new-project-picker/priority"
          options={SHEET_OPTIONS}
        />
        {/* Batch pickers of the issue-list selection. */}
        <Stack.Screen name="batch-picker/status" options={SHEET_OPTIONS} />
        <Stack.Screen name="batch-picker/priority" options={SHEET_OPTIONS} />
        <Stack.Screen
          name="batch-picker/assignee"
          options={{
            ...SHEET_OPTIONS,
            headerShown: true,
            title: t("navigation:routes.assignee"),
          }}
        />
        {/* Shared filter sheet for My Issues and the workspace Issues page —
            chooses the right view-store via `?scope=my|all` URL param. */}
        <Stack.Screen name="issues-filter" options={SHEET_OPTIONS} />
        {/* Saved views of My Issues. */}
        <Stack.Screen name="issue-views" options={SHEET_OPTIONS} />
        {/* Save the current filters as a view. */}
        <Stack.Screen name="issue-view-create" options={SHEET_OPTIONS} />
        {/* Rename, share or delete a view. */}
        <Stack.Screen name="issue-view-edit" options={SHEET_OPTIONS} />
        {/* Inbox filter sheet (status, priority, from). */}
        <Stack.Screen name="inbox-filter" options={SHEET_OPTIONS} />
        {/* Chat session-switch sheet. */}
        <Stack.Screen name="chat-sessions" options={SHEET_OPTIONS} />
        {/* Rename a chat session; Android has no Alert.prompt. */}
        <Stack.Screen name="chat-session-rename" options={SHEET_OPTIONS} />
        {/* Workspace switcher — reached from the More popover's collapsed
            WorkspaceCard. Two-step (pick → iOS Alert confirm → switch). */}
        <Stack.Screen name="switch-workspace" options={SHEET_OPTIONS} />
        {/* Redirect to My Issues → All, no own header. */}
        <Stack.Screen name="more/issues" options={{ headerShown: false }} />
        <Stack.Screen
          name="more/projects"
            options={{
              title: t("navigation:routes.projects"),
              headerBackTitle: t("back"),
            }}
        />
        <Stack.Screen
          name="more/agents"
            options={{
              title: t("navigation:routes.agents"),
              headerBackTitle: t("back"),
            }}
        />
        {/* "AI Team" pages from the More menu. */}
        <Stack.Screen
          name="autopilots/index"
            options={{
              title: t("navigation:routes.autopilots"),
              headerBackTitle: t("back"),
            }}
        />
        {/* Phone detail; the screen sets the title. */}
        <Stack.Screen
          name="autopilots/[id]"
            options={{
              title: t("navigation:routes.autopilot"),
              headerBackTitle: t("back"),
            }}
        />
        {/* Runs list (the screen sets the title) and run sheet. */}
        <Stack.Screen
          name="autopilots/[id]/runs"
            options={{
              title: t("navigation:routes.autopilot_runs"),
              headerBackTitle: t("back"),
            }}
        />
        <Stack.Screen name="autopilots/[id]/runs/[runId]" options={SHEET_OPTIONS} />
        <Stack.Screen
          name="runtimes/index"
            options={{
              title: t("navigation:routes.runtimes"),
              headerBackTitle: t("back"),
            }}
        />
        <Stack.Screen
          name="runtimes/[id]"
            options={{
              title: t("navigation:routes.runtimes"),
              headerBackTitle: t("back"),
            }}
        />
        {/* Read-only agent and squad detail; the screens set
            their title from the record. */}
        <Stack.Screen
          name="agent/[id]"
            options={{
              title: t("navigation:routes.agents"),
              headerBackTitle: t("back"),
            }}
        />
        <Stack.Screen
          name="squad/[id]"
            options={{
              title: t("navigation:routes.agents"),
              headerBackTitle: t("back"),
            }}
        />
        <Stack.Screen
          name="more/pins"
            options={{
              title: t("navigation:routes.pinned"),
              headerBackTitle: t("back"),
            }}
        />
        <Stack.Screen
          name="more/settings"
            options={{
              title: t("navigation:routes.settings"),
              headerBackTitle: t("back"),
            }}
        />
        <Stack.Screen
          name="more/settings/profile"
            options={{
              title: t("navigation:routes.profile"),
              headerBackTitle: t("navigation:routes.settings"),
            }}
        />
        <Stack.Screen
          name="more/settings/notifications"
            options={{
              title: t("navigation:routes.notifications"),
              headerBackTitle: t("navigation:routes.settings"),
            }}
        />
        <Stack.Screen
          name="new-issue"
          options={{
            title: t("navigation:routes.new_issue"),
            ...MODAL_PRESENTATION,
            headerLeft: () => <ModalCloseButton />,
          }}
        />
        <Stack.Screen
          name="search"
          options={{
            title: t("navigation:routes.search"),
            ...MODAL_PRESENTATION,
            headerLeft: () => <ModalCloseButton />,
          }}
        />
      </Stack>
    </RealtimeProvider>
  );
}
