/**
 * "+ Wakeup". formSheet route, opened from the
 * Wakeups section head:
 *
 *   /[workspace]/issue/[id]/wakeup-create
 *
 * Two steps:
 * 1 "Wann?" – groups Time (`at` presets + date/time dialogs, `every`/`cron`
 *   presets with end date and time zone), Collaboration (someone replies),
 *   Runs and sub-issues (a run ends, sub-issues done), Linked (field changes
 *   to a value, PR, other issue) and Advanced (custom events). Status, assignee and issue
 *   search open the app's existing picker bodies in place of the step.
 * 2 "Wen und was?" – agent, instruction, mode, cap, deadline, on_timeout.
 *
 * The body comes from lib/wakeup-draft.ts. Errors show inline at the field
 * and are announced; "Anlegen" waits for the server and keeps the input on
 * failure. A done/cancelled issue cannot get new rules (also via deep link).
 * All choices are vertical rows that wrap, so 200 % font only grows them.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, ScrollView, TextInput, View, findNodeHandle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { Ionicons } from "@/components/ui/ionicons";
import { MOBILE_PLACEHOLDER_COLOR } from "@/components/ui/input-tokens";
import { AssigneePickerBody } from "@/components/issue/pickers/assignee-picker-body";
import { IssueSearchPickerBody } from "@/components/issue/pickers/issue-search-picker-body";
import { StatusPickerBody } from "@/components/issue/pickers/status-picker-body";
import { useCreateIssueWakeup } from "@/data/mutations/wakeups";
import { agentListOptions } from "@/data/queries/agents";
import { issueChildrenOptions, issueDetailOptions } from "@/data/queries/issues";
import { labelListOptions } from "@/data/queries/labels";
import { memberListOptions } from "@/data/queries/members";
import { propertyListOptions } from "@/data/queries/properties";
import { squadListOptions } from "@/data/queries/squads";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useIssueStatuses } from "@/lib/use-issue-statuses";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { showWakeupClosedHint, wakeupEventText } from "@/lib/wakeup-text";
import {
  WAKEUP_AT_PRESETS,
  WAKEUP_CONDITION_GROUPS,
  WAKEUP_ERROR_FIELD,
  WAKEUP_EVENT_TYPES,
  WAKEUP_FIELDS,
  WAKEUP_MAX_FIRES,
  WAKEUP_OTHER_STATES,
  WAKEUP_PR_EVENTS,
  WAKEUP_RECURRENCES,
  WAKEUP_WAIT_DAYS,
  buildWakeupInput,
  deviceTimeZone,
  emptyWakeupDraft,
  isEventCondition,
  localDate,
  repeats,
  stepOneError,
  timeZoneChoices,
  toggleWakeupEvent,
  wakeableAgents,
  wakeupEventGroups,
  wakeupCreateErrorKind,
  type WakeupCreateCondition,
  type WakeupCreateDraft,
  type WakeupDraftError,
} from "@/lib/wakeup-draft";

const CONDITION_ICON: Record<WakeupCreateCondition, React.ComponentProps<typeof Ionicons>["name"]> = {
  at: "time-outline",
  recurring: "refresh-outline",
  reply: "chatbubble-outline",
  run_end: "hardware-chip-outline",
  children: "git-branch-outline",
  field: "radio-button-on-outline",
  pull_request: "git-pull-request-outline",
  other_issue: "link-outline",
  custom: "flash-outline",
};

/** A picker body shown in place of step 1 (status, assignee, issue search). */
type SubPicker = "status" | "assignee" | "issue";

type Field = (typeof WAKEUP_ERROR_FIELD)[WakeupDraftError];

export default function WakeupCreateRoute() {
  const { id: issueId } = useLocalSearchParams<{ id: string }>();
  const { t } = useT("issues");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: issue } = useQuery(issueDetailOptions(wsId, issueId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: squads = [] } = useQuery(squadListOptions(wsId));
  const { data: labels = [] } = useQuery(labelListOptions(wsId));
  const { data: propertyList } = useQuery(propertyListOptions(wsId));
  const { data: children = [] } = useQuery(issueChildrenOptions(wsId, issueId));
  const { categoryOf, labelOf } = useIssueStatuses();
  const create = useCreateIssueWakeup(issueId);
  const { colorScheme } = useColorScheme();
  const closed = !!issue && showWakeupClosedHint(categoryOf(issue.status));

  const assigneeAgent = issue?.assignee_type === "agent" ? (issue.assignee_id ?? "") : "";
  const [draft, setDraft] = useState<WakeupCreateDraft>(() => emptyWakeupDraft(assigneeAgent));
  // The issue may load after the sheet opened: preselect its agent once.
  useEffect(() => {
    if (assigneeAgent) setDraft((d) => (d.agentId ? d : { ...d, agentId: assigneeAgent }));
  }, [assigneeAgent]);
  const [step, setStep] = useState<1 | 2>(1);
  const [subPicker, setSubPicker] = useState<SubPicker | null>(null);
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const [error, setError] = useState<WakeupDraftError | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const fieldRefs = useRef<Partial<Record<Field, View | null>>>({});
  const scrollRef = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();
  const contentRef = useRef<View>(null);

  const wakeable = useMemo(() => wakeableAgents(agents), [agents]);
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? "";
  const properties = useMemo(() => (propertyList?.properties ?? []).filter((p) => !p.archived), [propertyList]);
  const property = properties.find((p) => p.id === draft.fieldTarget);
  // Stages this issue's sub-issues use (web StageChoice).
  const stages = useMemo(
    () => [...new Set(children.map((c) => c.stage).filter((s): s is number => typeof s === "number"))].sort((a, b) => a - b),
    [children],
  );
  const assigneeName = (a: NonNullable<WakeupCreateDraft["assignee"]>) =>
    a.type === "member"
      ? (members.find((m) => m.user_id === a.id)?.name ?? "")
      : a.type === "agent"
        ? agentName(a.id)
        : (squads.find((q) => q.id === a.id)?.name ?? "");

  const update = (patch: Partial<WakeupCreateDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
    setServerError(null);
  };

  const showError = (e: WakeupDraftError) => {
    setError(e);
    const node = fieldRefs.current[WAKEUP_ERROR_FIELD[e]];
    const handle = node ? findNodeHandle(node) : null;
    if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
    // Bring the field with the error into view (it may sit below a long list).
    if (node && contentRef.current) {
      node.measureLayout(
        contentRef.current,
        (_x, y) => scrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true }),
        () => {},
      );
    }
    AccessibilityInfo.announceForAccessibility(t(`wakeups.create.errors.${e}`));
  };

  const next = () => {
    const e = stepOneError(draft);
    if (e) return showError(e);
    setStep(2);
  };

  const submit = async () => {
    if (create.isPending || closed) return;
    const result = buildWakeupInput(draft);
    if ("error" in result) {
      if (WAKEUP_ERROR_FIELD[result.error] !== "agent" && stepOneError(draft)) setStep(1);
      return showError(result.error);
    }
    setServerError(null);
    try {
      await create.mutateAsync(result.input);
      showToast(t("wakeups.create.created", { agent: agentName(draft.agentId) || t("wakeups.agent_subject") }));
      router.back();
    } catch (err) {
      const kind = wakeupCreateErrorKind(err);
      const text = t(`wakeups.create.server.${kind}`);
      setServerError(text);
      AccessibilityInfo.announceForAccessibility(text);
    }
  };

  const pickDateTime = () => {
    if (Platform.OS !== "android") return;
    const start = draft.atCustom ? new Date(draft.atCustom) : new Date(Date.now() + 60 * 60_000);
    DateTimePickerAndroid.open({
      value: start,
      mode: "date",
      minimumDate: new Date(),
      onChange: (event: DateTimePickerEvent, day?: Date) => {
        if (event.type !== "set" || !day) return;
        DateTimePickerAndroid.open({
          value: start,
          mode: "time",
          onChange: (ev: DateTimePickerEvent, time?: Date) => {
            if (ev.type !== "set" || !time) return;
            const at = new Date(day);
            at.setHours(time.getHours(), time.getMinutes(), 0, 0);
            update({ atPreset: "custom", atCustom: at.toISOString() });
          },
        });
      },
    });
  };

  const pickDate = (value: string, onPick: (date: string) => void) => {
    if (Platform.OS !== "android") return;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    DateTimePickerAndroid.open({
      value: /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : tomorrow,
      mode: "date",
      minimumDate: tomorrow,
      onChange: (event: DateTimePickerEvent, day?: Date) => {
        if (event.type === "set" && day) onPick(localDate(day));
      },
    });
  };

  const errorText = (field: Field) =>
    error && WAKEUP_ERROR_FIELD[error] === field ? (
      <Text className="text-xs text-destructive" accessibilityLiveRegion="polite" testID={`wakeup-create-error-${field}`}>
        {t(`wakeups.create.errors.${error}`)}
      </Text>
    ) : null;

  if (closed) {
    return (
      <View className="flex-1 px-4 pt-4 gap-3" testID="wakeup-create-closed">
        <Text accessibilityRole="header" className="text-base font-semibold text-foreground">
          {t("wakeups.create.title")}
        </Text>
        <Text className="text-sm text-muted-foreground">{t("wakeups.create.closed")}</Text>
      </View>
    );
  }

  if (subPicker) {
    const close = () => setSubPicker(null);
    return (
      <View className="flex-1" testID={`wakeup-create-picker-${subPicker}`}>
        {subPicker === "status" ? (
          <StatusPickerBody
            value={draft.fieldTarget}
            onChange={(fieldTarget) => {
              update({ fieldTarget });
              close();
            }}
          />
        ) : subPicker === "assignee" ? (
          <>
            <Text className="px-4 pt-4 pb-2 text-base font-semibold text-foreground" accessibilityRole="header">
              {t("wakeups.create.choose_assignee")}
            </Text>
            <View className="px-4 pb-2">
              <TextInput
                value={assigneeQuery}
                onChangeText={setAssigneeQuery}
                placeholder={t("picker.search_people")}
                placeholderTextColor={MOBILE_PLACEHOLDER_COLOR}
                accessibilityLabel={t("picker.search_people")}
                autoCapitalize="none"
                autoCorrect={false}
                style={{ fontSize: 14, includeFontPadding: false }}
                className="rounded-md px-3 min-h-12 text-foreground bg-secondary/50"
                testID="wakeup-create-assignee-search"
              />
            </View>
            <AssigneePickerBody
              value={draft.assignee}
              query={assigneeQuery}
              onChange={(next) => {
                update({ assignee: next });
                close();
              }}
            />
          </>
        ) : (
          <IssueSearchPickerBody
            testID="wakeup-create-issue-picker"
            title={t("wakeups.create.choose_issue")}
            placeholder={t("picker.search_issues")}
            includeClosed
            filter={(results) => results.filter((r) => r.id !== issueId)}
            onPick={(picked) => {
              update({ otherIssue: { id: picked.id, identifier: picked.identifier, title: picked.title } });
              close();
            }}
          />
        )}
        <View className="flex-row justify-end border-t border-border px-4 py-2">
          <FooterButton label={t("wakeups.create.back")} onPress={close} testID="wakeup-create-picker-back" />
        </View>
      </View>
    );
  }

  const deviceZone = deviceTimeZone();
  const customLabel =
    draft.atPreset === "custom" && draft.atCustom
      ? new Date(draft.atCustom).toLocaleString()
      : t("wakeups.create.at.custom");

  return (
    <View className="flex-1">
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerClassName="px-4 pt-4 pb-6"
        keyboardShouldPersistTaps="handled"
        testID="wakeup-create-sheet"
      >
        <View ref={contentRef} className="gap-3" collapsable={false}>
          <View className="gap-0.5">
            <Text accessibilityRole="header" className="text-base font-semibold text-foreground">
              {t("wakeups.create.title")}
            </Text>
            <Text className="text-xs text-muted-foreground" testID="wakeup-create-step">
              {t("wakeups.create.step", { step, count: 2 })} · {t(step === 1 ? "wakeups.create.step1" : "wakeups.create.step2")}
            </Text>
          </View>

          {subPicker ? null : step === 1 ? (
            <>
              <View ref={(r) => { fieldRefs.current.condition = r; }} accessible={false} collapsable={false}>
                {errorText("condition")}
              </View>
              {WAKEUP_CONDITION_GROUPS.map(({ group, conditions }) => (
                <View key={group} className="gap-1">
                  <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium" accessibilityRole="header">
                    {t(`wakeups.create.groups.${group}`)}
                  </Text>
                  {conditions.map((c) => (
                    <View key={c} className="gap-1">
                      <Choice
                        selected={draft.condition === c}
                        onPress={() => update({ condition: c })}
                        label={t(`wakeups.create.cond.${c}`)}
                        hint={t(`wakeups.create.cond.${c}_hint`, { count: WAKEUP_EVENT_TYPES.length })}
                        icon={CONDITION_ICON[c]}
                        testID={`wakeup-create-cond-${c}`}
                      />
                      {draft.condition === c ? (
                        <View className="ml-6 gap-1 border-l border-border pl-3">
                          {c === "at" ? (
                            <>
                              {WAKEUP_AT_PRESETS.map((p) => (
                                <Choice
                                  key={p}
                                  selected={draft.atPreset === p && (p !== "custom" || !!draft.atCustom)}
                                  onPress={() => (p === "custom" ? pickDateTime() : update({ atPreset: p }))}
                                  label={p === "custom" ? customLabel : t(`wakeups.create.at.${p}`)}
                                  testID={`wakeup-create-at-${p}`}
                                />
                              ))}
                              <Text className="text-xs text-muted-foreground">
                                {t("wakeups.create.device_time", { timezone: deviceZone })}
                              </Text>
                              <View ref={(r) => { fieldRefs.current.time = r; }} collapsable={false}>
                                {errorText("time")}
                              </View>
                            </>
                          ) : null}
                          {c === "recurring" ? (
                            <>
                              {WAKEUP_RECURRENCES.map((r) => (
                                <Choice
                                  key={r}
                                  selected={draft.recurrence === r}
                                  onPress={() => update({ recurrence: r })}
                                  label={t(`wakeups.create.recurrence.${r}`)}
                                  testID={`wakeup-create-recurrence-${r}`}
                                />
                              ))}
                              <View ref={(r) => { fieldRefs.current.until = r; }} collapsable={false}>
                                <Choice
                                  onPress={() => pickDate(draft.until, (until) => update({ until }))}
                                  label={t("wakeups.create.until", { date: draft.until })}
                                  icon="calendar-outline"
                                  testID="wakeup-create-until"
                                />
                              </View>
                              {errorText("until")}
                              <ZonePicker
                                value={draft.timezone}
                                device={deviceZone}
                                onChange={(timezone) => update({ timezone })}
                              />
                            </>
                          ) : null}
                          {c === "reply" ? (
                            <>
                              <Choice
                                selected={!draft.replyActor}
                                onPress={() => update({ replyActor: null })}
                                label={t("wakeups.create.anyone")}
                                testID="wakeup-create-reply-anyone"
                              />
                              <Text className="text-xs text-muted-foreground mt-1">{t("wakeups.create.members")}</Text>
                              {members.map((m) => (
                                <Choice
                                  key={m.user_id}
                                  selected={draft.replyActor?.type === "member" && draft.replyActor.id === m.user_id}
                                  onPress={() => update({ replyActor: { type: "member", id: m.user_id } })}
                                  label={m.name || m.email}
                                  testID={`wakeup-create-reply-member-${m.user_id}`}
                                />
                              ))}
                              <Text className="text-xs text-muted-foreground mt-1">{t("wakeups.create.agents")}</Text>
                              {agents.filter((a) => !a.archived_at).map((a) => (
                                <Choice
                                  key={a.id}
                                  selected={draft.replyActor?.type === "agent" && draft.replyActor.id === a.id}
                                  onPress={() => update({ replyActor: { type: "agent", id: a.id } })}
                                  label={a.name}
                                  testID={`wakeup-create-reply-agent-${a.id}`}
                                />
                              ))}
                            </>
                          ) : null}
                          {c === "run_end" ? (
                            <>
                              <Choice
                                selected={!draft.runAgentId}
                                onPress={() => update({ runAgentId: "" })}
                                label={t("wakeups.create.any_agent")}
                                testID="wakeup-create-run-any"
                              />
                              {agents.filter((a) => !a.archived_at).map((a) => (
                                <Choice
                                  key={a.id}
                                  selected={draft.runAgentId === a.id}
                                  onPress={() => update({ runAgentId: a.id })}
                                  label={a.name}
                                  testID={`wakeup-create-run-agent-${a.id}`}
                                />
                              ))}
                            </>
                          ) : null}
                          {c === "children" ? (
                            <>
                              <Choice
                                selected={draft.stage === null}
                                onPress={() => update({ stage: null })}
                                label={t("wakeups.create.children_all")}
                                testID="wakeup-create-stage-all"
                              />
                              {stages.map((stage) => (
                                <Choice
                                  key={stage}
                                  selected={draft.stage === stage}
                                  onPress={() => update({ stage })}
                                  label={t("wakeups.create.children_stage", { stage })}
                                  testID={`wakeup-create-stage-${stage}`}
                                />
                              ))}
                            </>
                          ) : null}
                          {c === "field" ? (
                            <>
                              <View className="flex-row flex-wrap gap-1">
                                {WAKEUP_FIELDS.map((field) => (
                                  <Pill
                                    key={field}
                                    selected={draft.field === field}
                                    onPress={() =>
                                      update({ field, fieldTarget: "", fieldValue: "", propertyType: "", assignee: null })
                                    }
                                    label={t(`wakeups.create.field.${field}`)}
                                    testID={`wakeup-create-field-${field}`}
                                  />
                                ))}
                              </View>
                              {draft.field === "status" ? (
                                <Choice
                                  onPress={() => setSubPicker("status")}
                                  label={draft.fieldTarget ? labelOf(draft.fieldTarget) : t("wakeups.create.choose_status")}
                                  hint={draft.fieldTarget ? t("wakeups.create.tap_to_change") : undefined}
                                  icon="ellipse-outline"
                                  testID="wakeup-create-field-status-pick"
                                />
                              ) : null}
                              {draft.field === "assignee" ? (
                                <Choice
                                  onPress={() => {
                                    setAssigneeQuery("");
                                    setSubPicker("assignee");
                                  }}
                                  label={
                                    draft.assignee
                                      ? assigneeName(draft.assignee) || t("wakeups.create.choose_assignee")
                                      : t("wakeups.create.choose_assignee")
                                  }
                                  hint={draft.assignee ? t("wakeups.create.tap_to_change") : undefined}
                                  icon="person-outline"
                                  testID="wakeup-create-field-assignee-pick"
                                />
                              ) : null}
                              {draft.field === "label"
                                ? labels.length === 0
                                  ? <Text className="text-sm text-muted-foreground">{t("wakeups.create.no_labels")}</Text>
                                  : labels.map((l) => (
                                      <Choice
                                        key={l.id}
                                        selected={draft.fieldTarget === l.id}
                                        onPress={() => update({ fieldTarget: l.id })}
                                        label={l.name}
                                        testID={`wakeup-create-label-${l.id}`}
                                      />
                                    ))
                                : null}
                              {draft.field === "property" ? (
                                properties.length === 0 ? (
                                  <Text className="text-sm text-muted-foreground">{t("wakeups.create.no_properties")}</Text>
                                ) : (
                                  <>
                                    {properties.map((p) => (
                                      <Choice
                                        key={p.id}
                                        selected={draft.fieldTarget === p.id}
                                        onPress={() => update({ fieldTarget: p.id, propertyType: p.type, fieldValue: "" })}
                                        label={p.name}
                                        testID={`wakeup-create-property-${p.id}`}
                                      />
                                    ))}
                                    {property ? (
                                      <View className="ml-3 gap-1">
                                        <Text className="text-xs text-muted-foreground">
                                          {t("wakeups.create.property_value", { property: property.name })}
                                        </Text>
                                        {property.type === "select" || property.type === "multi_select" ? (
                                          (property.config.options ?? []).map((o) => (
                                            <Choice
                                              key={o.id}
                                              selected={draft.fieldValue === o.id}
                                              onPress={() => update({ fieldValue: o.id })}
                                              label={o.name}
                                              testID={`wakeup-create-property-option-${o.id}`}
                                            />
                                          ))
                                        ) : property.type === "checkbox" ? (
                                          (["true", "false"] as const).map((v) => (
                                            <Choice
                                              key={v}
                                              selected={draft.fieldValue === v}
                                              onPress={() => update({ fieldValue: v })}
                                              label={t(v === "true" ? "wakeups.create.checked" : "wakeups.create.unchecked")}
                                              testID={`wakeup-create-property-${v}`}
                                            />
                                          ))
                                        ) : (
                                          <TextField
                                            value={draft.fieldValue}
                                            onChangeText={(fieldValue) => update({ fieldValue })}
                                            placeholder={t("wakeups.create.property_value", { property: property.name })}
                                            accessibilityLabel={t("wakeups.create.property_value", { property: property.name })}
                                            keyboardType={property.type === "number" ? "numeric" : "default"}
                                            invalid={error === "missing_value"}
                                            testID="wakeup-create-property-value"
                                          />
                                        )}
                                      </View>
                                    ) : null}
                                  </>
                                )
                              ) : null}
                            </>
                          ) : null}
                          {c === "pull_request"
                            ? WAKEUP_PR_EVENTS.map((ev) => (
                                <Choice
                                  key={ev}
                                  selected={draft.prEvent === ev}
                                  onPress={() => update({ prEvent: ev })}
                                  label={t(`wakeups.create.pr.${ev}`)}
                                  testID={`wakeup-create-pr-${ev}`}
                                />
                              ))
                            : null}
                          {c === "other_issue" ? (
                            <>
                              <Choice
                                onPress={() => setSubPicker("issue")}
                                label={
                                  draft.otherIssue
                                    ? `${draft.otherIssue.identifier}${draft.otherIssue.title ? ` ${draft.otherIssue.title}` : ""}`
                                    : t("wakeups.create.choose_issue")
                                }
                                hint={draft.otherIssue ? t("wakeups.create.tap_to_change") : undefined}
                                icon="search-outline"
                                testID="wakeup-create-other-pick"
                              />
                              <Text className="text-xs text-muted-foreground mt-1">{t("wakeups.create.other_when")}</Text>
                              {WAKEUP_OTHER_STATES.map((state) => (
                                <Choice
                                  key={state}
                                  selected={draft.otherState === state}
                                  onPress={() => update({ otherState: state })}
                                  label={t(`wakeups.create.other.${state}`)}
                                  testID={`wakeup-create-other-${state}`}
                                />
                              ))}
                            </>
                          ) : null}
                          {c === "custom" ? (
                            <>
                              <Text className="text-xs text-muted-foreground" accessibilityLiveRegion="polite">
                                {t("wakeups.create.events_selected", { count: draft.events.length })}
                              </Text>
                              {wakeupEventGroups().map(({ group: eg, events }) => (
                                <View key={eg} className="gap-1">
                                  <Text className="text-xs font-medium text-muted-foreground mt-1" accessibilityRole="header">
                                    {t(`wakeups.create.event_groups.${eg}`)}
                                  </Text>
                                  {events.map((event) => (
                                    <Check
                                      key={event}
                                      checked={draft.events.includes(event)}
                                      onPress={() => update({ events: toggleWakeupEvent(draft.events, event) })}
                                      label={wakeupEventText(event)}
                                      testID={`wakeup-create-event-${event}`}
                                    />
                                  ))}
                                </View>
                              ))}
                            </>
                          ) : null}
                          <View ref={(r) => { fieldRefs.current.value = r; }} collapsable={false}>
                            {errorText("value")}
                          </View>
                        </View>
                      ) : null}
                    </View>
                  ))}
                </View>
              ))}
            </>
          ) : (
            <>
              <View className="gap-1" ref={(r) => { fieldRefs.current.agent = r; }} collapsable={false}>
                <Text className="text-sm font-medium text-foreground">{t("wakeups.create.wake")}</Text>
                {errorText("agent")}
                {wakeable.length === 0 ? (
                  <Text className="text-sm text-muted-foreground">{t("wakeups.create.no_agents")}</Text>
                ) : (
                  wakeable.map((a) => (
                    <Choice
                      key={a.id}
                      selected={draft.agentId === a.id}
                      onPress={() => update({ agentId: a.id })}
                      label={a.name}
                      hint={a.id === assigneeAgent ? t("wakeups.create.assignee") : undefined}
                      testID={`wakeup-create-agent-${a.id}`}
                    />
                  ))
                )}
              </View>

              <View className="gap-1" ref={(r) => { fieldRefs.current.instruction = r; }} collapsable={false}>
                <Text className="text-sm font-medium text-foreground">{t("wakeups.create.instruction")}</Text>
                <TextField
                  value={draft.instruction}
                  onChangeText={(instruction) => update({ instruction })}
                  placeholder={t("wakeups.create.instruction_placeholder")}
                  accessibilityLabel={t("wakeups.create.instruction")}
                  multiline
                  style={{ textAlignVertical: "top", minHeight: 96, paddingVertical: 8 }}
                  invalid={!!error && WAKEUP_ERROR_FIELD[error] === "instruction"}
                  editable={!create.isPending}
                  testID="wakeup-create-instruction"
                />
                {errorText("instruction")}
              </View>

              {isEventCondition(draft.condition) ? (
                <View className="gap-1">
                  <Text className="text-sm font-medium text-foreground">{t("wakeups.create.repeat")}</Text>
                  {(["once", "continuous"] as const).map((mode) => (
                    <Choice
                      key={mode}
                      selected={draft.mode === mode}
                      onPress={() => update({ mode, maxFires: mode === "continuous" ? (draft.maxFires ?? 20) : null })}
                      label={t(`wakeups.create.mode.${mode}`)}
                      testID={`wakeup-create-mode-${mode}`}
                    />
                  ))}
                </View>
              ) : null}

              {repeats(draft) ? (
                <View className="gap-1">
                  <Text className="text-sm font-medium text-foreground">{t("wakeups.create.max_fires")}</Text>
                  <View className="flex-row flex-wrap gap-1">
                    {draft.condition === "recurring" ? (
                      <Pill
                        selected={draft.maxFires === null}
                        onPress={() => update({ maxFires: null })}
                        label={t("wakeups.create.unlimited")}
                        testID="wakeup-create-max-none"
                      />
                    ) : null}
                    {WAKEUP_MAX_FIRES.map((n) => (
                      <Pill
                        key={n}
                        selected={draft.maxFires === n}
                        onPress={() => update({ maxFires: n })}
                        label={t("wakeups.create.times", { count: n })}
                        testID={`wakeup-create-max-${n}`}
                      />
                    ))}
                  </View>
                </View>
              ) : null}

              {isEventCondition(draft.condition) ? (
                <>
                  <View className="gap-1" ref={(r) => { fieldRefs.current.wait = r; }} collapsable={false}>
                    <Text className="text-sm font-medium text-foreground">{t("wakeups.create.wait")}</Text>
                    <View className="flex-row flex-wrap gap-1">
                      <Pill
                        selected={draft.wait.kind === "none"}
                        onPress={() => update({ wait: { kind: "none" } })}
                        label={t("wakeups.create.no_deadline")}
                        testID="wakeup-create-wait-none"
                      />
                      {WAKEUP_WAIT_DAYS.map((days) => (
                        <Pill
                          key={days}
                          selected={draft.wait.kind === "days" && draft.wait.days === days}
                          onPress={() => update({ wait: { kind: "days", days } })}
                          label={t("wakeups.create.days", { count: days })}
                          testID={`wakeup-create-wait-${days}`}
                        />
                      ))}
                      <Pill
                        selected={draft.wait.kind === "date"}
                        onPress={() =>
                          pickDate(draft.wait.kind === "date" ? draft.wait.date : "", (date) =>
                            update({ wait: { kind: "date", date } }),
                          )
                        }
                        label={draft.wait.kind === "date" ? draft.wait.date : t("wakeups.create.date")}
                        testID="wakeup-create-wait-date"
                      />
                    </View>
                    {errorText("wait")}
                  </View>
                  {draft.wait.kind !== "none" ? (
                    <View className="gap-1">
                      <Text className="text-sm font-medium text-foreground">{t("wakeups.create.then")}</Text>
                      <Choice
                        selected={draft.onTimeout === "wake"}
                        onPress={() => update({ onTimeout: "wake" })}
                        label={t("wakeups.create.timeout_wake", {
                          agent: agentName(draft.agentId) || t("wakeups.create.the_agent"),
                        })}
                        testID="wakeup-create-timeout-wake"
                      />
                      <Choice
                        selected={draft.onTimeout === "end"}
                        onPress={() => update({ onTimeout: "end" })}
                        label={t("wakeups.create.timeout_end")}
                        testID="wakeup-create-timeout-end"
                      />
                    </View>
                  ) : null}
                </>
              ) : null}

              <View className="flex-row items-start gap-1.5">
                <Ionicons name="information-circle-outline" size={14} color={THEME[colorScheme].mutedForeground} style={{ marginTop: 2 }} />
                <Text className="flex-1 text-xs text-muted-foreground">{t("wakeups.create.on_behalf")}</Text>
              </View>
            </>
          )}

          {serverError ? (
            <Text className="text-sm text-destructive" accessibilityLiveRegion="assertive" testID="wakeup-create-server-error">
              {serverError}
            </Text>
          ) : null}
        </View>
      </ScrollView>

      {/* Bottom inset: at 200 % font the sheet reaches the gesture bar,
          which covered "Cancel". */}
      <View
        className="flex-row flex-wrap items-center justify-end gap-2 border-t border-border px-4 pt-2"
        style={{ paddingBottom: 8 + insets.bottom }}
      >
        <FooterButton
          label={t(step === 1 ? "wakeups.create.cancel" : "wakeups.create.back")}
          onPress={() => (step === 1 ? router.back() : setStep(1))}
          disabled={create.isPending}
          testID="wakeup-create-secondary"
        />
        <FooterButton
          primary
          label={
            step === 1
              ? t("wakeups.create.next")
              : t(create.isPending ? "wakeups.create.submitting" : "wakeups.create.submit")
          }
          onPress={step === 1 ? next : submit}
          disabled={create.isPending}
          busy={create.isPending}
          testID={step === 1 ? "wakeup-create-next" : "wakeup-create-submit"}
        />
      </View>
    </View>
  );
}

/** One selectable row (radio) that wraps its text; ≥ 48 dp. */
function Choice({
  label,
  hint,
  icon,
  selected,
  onPress,
  testID,
}: {
  label: string;
  hint?: string;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  selected?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={selected === undefined ? "button" : "radio"}
      accessibilityState={selected === undefined ? undefined : { checked: selected }}
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      className={cn(
        "min-h-[48px] flex-row items-center gap-3 rounded-md px-3 py-2 active:bg-secondary",
        selected && "bg-secondary",
      )}
      testID={testID}
    >
      {icon ? <Ionicons name={icon} size={18} color={theme.mutedForeground} /> : null}
      <View className="flex-1 gap-0.5">
        <Text className="text-base text-foreground">{label}</Text>
        {hint ? <Text className="text-xs text-muted-foreground">{hint}</Text> : null}
      </View>
      {selected ? <Ionicons name="checkmark" size={18} color={theme.primary} /> : null}
    </Pressable>
  );
}

/** One row of a multi-choice list (checkbox) that wraps its text; ≥ 48 dp. */
function Check({ label, checked, onPress, testID }: { label: string; checked: boolean; onPress: () => void; testID?: string }) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      className={cn("min-h-[48px] flex-row items-center gap-3 rounded-md px-3 py-2 active:bg-secondary", checked && "bg-secondary")}
      testID={testID}
    >
      <Ionicons name={checked ? "checkbox" : "square-outline"} size={20} color={checked ? theme.primary : theme.mutedForeground} />
      <Text className="flex-1 text-base text-foreground">{label}</Text>
    </Pressable>
  );
}

function Pill({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      className={cn(
        "min-h-[48px] justify-center rounded-full border px-3 py-1 active:opacity-60",
        selected ? "border-primary bg-primary/10" : "border-border",
      )}
      testID={testID}
    >
      <Text className={cn("text-sm", selected ? "text-primary font-medium" : "text-foreground")}>{label}</Text>
    </Pressable>
  );
}

/** Time zone row: device zone by default, visible and changeable. */
function ZonePicker({ value, device, onChange }: { value: string; device: string; onChange: (zone: string) => void }) {
  const { t } = useT("issues");
  const [open, setOpen] = useState(false);
  return (
    <View className="gap-1">
      <Choice
        onPress={() => setOpen((v) => !v)}
        label={t("wakeups.create.timezone", { timezone: value })}
        hint={value === device ? t("wakeups.create.timezone_device") : undefined}
        icon="globe-outline"
        testID="wakeup-create-timezone"
      />
      {open
        ? timeZoneChoices(value, device).map((zone) => (
            <Choice
              key={zone}
              selected={zone === value}
              onPress={() => {
                onChange(zone);
                setOpen(false);
              }}
              label={zone}
              testID={`wakeup-create-zone-${zone}`}
            />
          ))
        : null}
    </View>
  );
}

function FooterButton({
  label,
  onPress,
  primary,
  disabled,
  busy,
  testID,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      className={cn(
        "min-h-[48px] justify-center rounded-md px-4 active:opacity-60",
        primary ? "bg-primary" : "",
        disabled && "opacity-50",
      )}
      testID={testID}
    >
      <Text className={cn("text-sm font-semibold", primary ? "text-primary-foreground" : "text-foreground")}>{label}</Text>
    </Pressable>
  );
}
