/**
 * "Wakeups" section of the issue detail, read-only.
 * Sits below the properties/sub-issues and above the activity.
 *
 * - Collapsed when empty, loading, without active rules or during a
 *   deep-link landing; the head shows the count once known. Once open it
 *   stays open when the last rule is switched off.
 * - Each rule is ONE focus target with a composed TalkBack label
 *   (lib/wakeup-text.ts `wakeupRowA11yLabel`).
 * - Ended rules (timed out / fired once) sit under "Show ended (n)";
 *   active rules come first by next due time (`splitWakeups`).
 * - Loading, empty and error are told apart via the query status, not the
 *   list alone (`wakeupSectionState`), because the data layer reads an
 *   unreadable body as `[]`.
 * - W3: switch, "⋯" menu, long-press and TalkBack actions per
 *   row (components/issue/use-wakeup-menu.ts, rules lib/wakeup-actions.ts).
 *   The row text, the switch and "⋯" are three focus targets. Without
 *   rights (`can_manage === false` or a 403) only "view runs" remains.
 * - W4: "+ Wakeup" next to the head opens the create sheet
 *   (issue/[id]/wakeup-create). Disabled on a done/cancelled issue, with
 *   the closed hint shown under the head.
 * - W6: "Läufe ansehen" opens `issue/[id]/wakeups/[wakeupId]`.
 * - S1: the system rule "Unteraufgaben fertig" (`child_done`)
 *   sits under the rules (components/issue/system-wakeup-row.tsx); hidden on
 *   a done/cancelled issue like on the web. An active one opens the section.
 */
import { useCallback, useMemo, useState } from "react";
import { router } from "expo-router";
import { Pressable, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { IconButton } from "@/components/ui/icon-button";
import { useWakeupMenu } from "@/components/issue/use-wakeup-menu";
import { Ionicons } from "@/components/ui/ionicons";
import { SystemWakeupRow } from "@/components/issue/system-wakeup-row";
import { issueSystemWakeupsOptions, issueWakeupsOptions } from "@/data/queries/wakeups";
import type { MobileIssueWakeup } from "@/data/wakeup-schemas";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActorLookup } from "@/data/use-actor-name";
import { useIssueStatuses } from "@/lib/use-issue-statuses";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { knownSystemWakeups } from "@/lib/system-wakeup";
import {
  WAKEUP_ICON_NAME,
  showWakeupClosedHint,
  splitWakeups,
  wakeupIcon,
  wakeupMetaText,
  wakeupPausedText,
  wakeupRowA11yLabel,
  wakeupSectionAutoOpen,
  wakeupSectionState,
  wakeupTriggerText,
  type WakeupNames,
} from "@/lib/wakeup-text";
import {
  canManageWakeup,
  instructionLines,
  wakeupActions,
  wakeupSwitchState,
} from "@/lib/wakeup-actions";

interface Props {
  issueId: string;
  /** Issue status; a done/closed one shows the "no new wakeups" hint. */
  status: string;
  /** Reports the section's y inside its parent, for the header chip jump. */
  onLayout?: (e: LayoutChangeEvent) => void;
  /** False keeps the section collapsed until tapped (deep-link landing). */
  defaultOpen?: boolean;
  /** Opened from the workspace overview: start open, also with only
   *  paused or switched-off rules. */
  expand?: boolean;
}

export function WakeupsSection({ issueId, status, onLayout, defaultOpen = true, expand = false }: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useT("issues");
  const { colorScheme } = useColorScheme();
  const query = useQuery(issueWakeupsOptions(wsId, issueId));
  const state = wakeupSectionState(query);
  const rules = useMemo(() => query.data ?? [], [query.data]);
  const { current, ended } = useMemo(() => splitWakeups(rules), [rules]);
  const systemQuery = useQuery(issueSystemWakeupsOptions(wsId, issueId));
  const systemRules = useMemo(() => knownSystemWakeups(systemQuery.data ?? []), [systemQuery.data]);
  // The section sits in the timeline header, so anything that grows it after
  // mount pushes the deep-link landing target out of view (an issue
  // can have dozens of rules). Collapsed while empty,
  // while loading, with only switched-off rules, and always while a
  // deep-link landing is pending (`defaultOpen` false). Active rules or an
  // error start open.
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const hasActive = useMemo(
    () => current.some((w) => w.enabled) || systemRules.some((r) => r.enabled && r.total > 0),
    [current, systemRules],
  );
  // Once open by itself it stays open: switching off the last
  // active rule must not fold the row away.
  const [latched, setLatched] = useState(false);
  const autoOpen = wakeupSectionAutoOpen(latched, { expand, defaultOpen, state, hasActive });
  if (autoOpen && !latched) setLatched(true);
  const open = openOverride ?? autoOpen;
  const [showEnded, setShowEnded] = useState(false);
  // No "(0)" while the count is not known yet (loading or failed).
  const heading =
    state === "loading" || state === "error"
      ? t("wakeups.title")
      : t("wakeups.section_count", { count: rules.length });

  const { getName } = useActorLookup();
  const { labelOf, categoryOf } = useIssueStatuses();
  const category = categoryOf(status);
  const closed = showWakeupClosedHint(category);
  const names = useMemo<WakeupNames>(
    () => ({ status: labelOf, actor: (type, id) => getName(type as never, id) ?? undefined }),
    [labelOf, getName],
  );
  // Rules the server answered 403 for: their actions vanish.
  const [forbidden, setForbidden] = useState<ReadonlySet<string>>(() => new Set());
  const onForbidden = useCallback(
    (id: string) => setForbidden((prev) => (prev.has(id) ? prev : new Set(prev).add(id))),
    [],
  );
  const menu = useWakeupMenu({ issueId, onForbidden });
  const rowProps = { names, closed, menu, forbidden };

  return (
    <View
      className="border-t border-border pt-3 pb-2"
      testID="issue-wakeups-section"
      collapsable={false}
      onLayout={onLayout}
    >
      <View className="flex-row items-center pr-2">
        <Pressable
          onPress={() => setOpenOverride(!open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${heading}. ${t(
            open ? "wakeups.collapse_a11y" : "wakeups.expand_a11y",
          )}`}
          className="flex-1 pl-4 pr-2 min-h-[48px] flex-row items-center justify-between active:opacity-60"
          testID="issue-wakeups-head"
        >
          <Text className="flex-1 text-xs uppercase tracking-wider text-muted-foreground font-medium">
            {heading}
          </Text>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={THEME[colorScheme].mutedForeground} />
        </Pressable>
        <Pressable
          onPress={() => {
            if (!wsSlug || closed) return;
            router.push({
              pathname: "/[workspace]/issue/[id]/wakeup-create",
              params: { workspace: wsSlug, id: issueId },
            });
          }}
          disabled={closed}
          accessibilityRole="button"
          accessibilityState={{ disabled: closed }}
          accessibilityLabel={closed ? `${t("wakeups.create.open")}. ${t("wakeups.closed_hint")}` : t("wakeups.create.open")}
          className={cn("min-h-[48px] min-w-[48px] flex-row items-center gap-1 px-2 active:opacity-60", closed && "opacity-40")}
          testID="issue-wakeups-add"
        >
          <Ionicons name="add" size={18} color={THEME[colorScheme].primary} />
          <Text className="text-sm text-primary font-medium">{t("wakeups.create.button")}</Text>
        </Pressable>
      </View>
      {closed && !(open && state === "empty") ? (
        <Text className="px-4 pb-1 text-xs text-muted-foreground" testID="issue-wakeups-closed-hint">
          {t("wakeups.closed_hint")}
        </Text>
      ) : null}

      {!open ? null : state === "loading" ? (
        <View
          className="px-4 gap-2"
          accessibilityLiveRegion="polite"
          accessibilityLabel={t("wakeups.loading")}
          accessible
          testID="issue-wakeups-loading"
        >
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </View>
      ) : state === "error" ? (
        <View className="mx-4 p-3 rounded-md border border-border gap-2" testID="issue-wakeups-error">
          <Text className="text-sm text-destructive">{t("wakeups.error")}</Text>
          <Button variant="outline" onPress={() => query.refetch()}>
            <Text>{t("common:actions.retry")}</Text>
          </Button>
        </View>
      ) : state === "empty" ? (
        <View className="px-4 pb-1 gap-1" testID="issue-wakeups-empty">
          <Text className="text-sm text-muted-foreground">{t("wakeups.empty")}</Text>
          {closed ? <Text className="text-xs text-muted-foreground">{t("wakeups.closed_hint")}</Text> : null}
        </View>
      ) : (
        <View>
          {query.isError ? (
            <Text className="mx-4 mb-2 text-xs text-destructive" testID="issue-wakeups-error-banner">
              {t("wakeups.error_banner")}
            </Text>
          ) : null}
          {current.map((w) => (
            <WakeupRow key={w.id} wakeup={w} {...rowProps} />
          ))}
          {ended.length > 0 ? (
            <Pressable
              onPress={() => setShowEnded((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: showEnded }}
              className="px-4 min-h-[48px] justify-center active:opacity-60"
              testID="issue-wakeups-show-ended"
            >
              <Text className="text-sm text-primary">
                {showEnded ? t("wakeups.hide_ended") : t("wakeups.show_ended", { count: ended.length })}
              </Text>
            </Pressable>
          ) : null}
          {showEnded ? ended.map((w) => <WakeupRow key={w.id} wakeup={w} {...rowProps} ended />) : null}
        </View>
      )}
      {open && !closed && (state === "ready" || state === "empty")
        ? systemRules.map((r) => <SystemWakeupRow key={r.rule} issueId={issueId} rule={r} />)
        : null}
    </View>
  );
}

function WakeupRow({
  wakeup: w,
  names,
  closed,
  menu,
  forbidden,
  ended = false,
}: {
  wakeup: MobileIssueWakeup;
  names: WakeupNames;
  closed: boolean;
  menu: ReturnType<typeof useWakeupMenu>;
  forbidden: ReadonlySet<string>;
  ended?: boolean;
}) {
  const { t } = useT("issues");
  const { colorScheme } = useColorScheme();
  const { fontScale } = useWindowDimensions();
  const theme = THEME[colorScheme];
  const paused = wakeupPausedText(w);
  const meta = wakeupMetaText(w);
  const canManage = canManageWakeup(w, forbidden.has(w.id));
  const actions = wakeupActions(w, { closed, canManage });
  const switchState = wakeupSwitchState(w, { closed, canManage });
  const agent = w.agent_name || t("wakeups.agent_subject");
  const deleting = menu.deletingId === w.id;
  const stateText = paused
    ? t("wakeups.state_paused")
    : t(w.enabled ? "wakeups.state_on" : "wakeups.state_off");
  return (
    <View
      className={cn("px-4 py-2 gap-1 border-t border-border/60", (ended || deleting) && "opacity-60")}
      testID={`issue-wakeup-row-${w.id}`}
    >
      {paused ? (
        <View className="flex-row items-center gap-2 rounded-md bg-secondary px-2 py-1.5" testID="issue-wakeup-paused">
          <Ionicons name="pause-circle-outline" size={16} color={theme.mutedForeground} />
          <Text className="flex-1 text-sm text-foreground">{paused}</Text>
          {actions.includes("resume") ? (
            <Button
              variant="outline"
              size="sm"
              className="min-h-[48px]"
              disabled={menu.pending}
              onPress={() => menu.run(w, "resume")}
              accessibilityLabel={t("wakeups.resume_a11y", { agent })}
              testID={`issue-wakeup-resume-${w.id}`}
            >
              <Text>{t("wakeups.actions.resume")}</Text>
            </Button>
          ) : null}
        </View>
      ) : null}
      <View className="flex-row items-start gap-1">
        <Pressable
          accessible
          accessibilityLabel={wakeupRowA11yLabel(w, names)}
          accessibilityState={{ busy: deleting }}
          accessibilityActions={menu.accessibilityActionsFor(actions)}
          onAccessibilityAction={(e) => {
            const action = actions.find((a) => a === e.nativeEvent.actionName);
            if (action) menu.run(w, action);
          }}
          onLongPress={actions.length > 0 ? () => menu.open(w, actions) : undefined}
          className="flex-1 gap-1 py-1"
          testID={`issue-wakeup-body-${w.id}`}
        >
          <View className="flex-row items-start gap-2">
            <Ionicons
              name={WAKEUP_ICON_NAME[wakeupIcon(w)]}
              size={16}
              color={theme.foreground}
              style={{ marginTop: 2 }}
            />
            <Text className="flex-1 text-sm text-foreground font-medium">
              {wakeupTriggerText(w, names)} · {t("wakeups.wakes", { agent })}
            </Text>
            {switchState === "hidden" ? (
              <Text className="text-xs text-muted-foreground">{stateText}</Text>
            ) : null}
          </View>
          {w.instruction.trim() ? (
            <Text className="ml-6 text-sm text-foreground italic" numberOfLines={instructionLines(fontScale)}>
              {w.instruction.trim()}
            </Text>
          ) : null}
          {meta ? <Text className="ml-6 text-xs text-muted-foreground">{meta}</Text> : null}
          {w.last_error ? (
            <Text className="ml-6 text-xs text-destructive" numberOfLines={3}>
              {w.last_error}
            </Text>
          ) : null}
          {forbidden.has(w.id) ? (
            <Text className="ml-6 text-xs text-muted-foreground" testID={`issue-wakeup-no-rights-${w.id}`}>
              {t("wakeups.no_rights")}
            </Text>
          ) : null}
        </Pressable>
        {switchState !== "hidden" ? (
          <View className="min-h-[48px] min-w-[48px] items-center justify-center">
            <Switch
              checked={switchState === "on"}
              disabled={switchState === "off_locked" || menu.pending}
              onCheckedChange={(on) => menu.run(w, on ? "enable" : "disable")}
              accessibilityLabel={t("wakeups.toggle_a11y", { agent })}
              hitSlop={14}
              testID={`issue-wakeup-switch-${w.id}`}
            />
          </View>
        ) : null}
        {actions.length > 0 ? (
          <IconButton
            name="ellipsis-horizontal"
            iconSize={18}
            onPress={() => menu.open(w, actions)}
            accessibilityLabel={t("wakeups.menu_a11y", { agent })}
            testID={`issue-wakeup-menu-${w.id}`}
          />
        ) : null}
      </View>
    </View>
  );
}
