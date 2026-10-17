/**
 * Editor sheet for one custom property value. The body
 * follows the property type like web's custom-property-picker.tsx:
 *
 *   select / checkbox / actor   pick one row → write, close
 *   multi_select / multi_actor  toggle rows, stays open (write per toggle)
 *   text / number / url         input + Done (empty = clear)
 *   date                        native picker + Done
 *
 * Writes go through useIssuePropertyMutation: optimistic merge, rollback
 * with a toast, only answers with `issue_revision` replace the bag (#13).
 * Read-only properties (archived, unknown type, unknown actor) only offer
 * Clear, so a stale value can still be removed.
 */
import { useMemo, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, TextInput, View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { IssueProperty, IssuePropertyValue } from "@multica/core/types";
import { MAX_ISSUE_PROPERTY_ACTOR_VALUES } from "@multica/core/types";
import { Ionicons } from "@/components/ui/ionicons";
import { Text } from "@/components/ui/text";
import { MOBILE_PLACEHOLDER_COLOR } from "@/components/ui/input-tokens";
import { DateHeader } from "@/components/issue/pickers/issue-date-picker-route";
import {
  DueDatePickerBody,
  type DueDatePickerBodyHandle,
} from "@/components/issue/pickers/due-date-picker-body";
import { issueDetailOptions } from "@/data/queries/issues";
import { propertyListOptions } from "@/data/queries/properties";
import { memberListOptions } from "@/data/queries/members";
import { useIssuePropertyMutation } from "@/data/mutations/issue-properties";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  isPropertyReadOnly,
  memberRef,
  parseScalarInput,
  selectedMemberIds,
  toggleActor,
  toggleOption,
  createSerialQueue,
  createToggleChain,
  toggleMirror,
} from "@/lib/issue-properties";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";

export default function IssuePropertyPickerRoute() {
  const { id, propertyId } = useLocalSearchParams<{ id: string; propertyId: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  const { data: propertyList } = useQuery(propertyListOptions(wsId, true));
  const properties = propertyList?.properties ?? [];
  const mutation = useIssuePropertyMutation(id);
  const property = properties.find((p) => p.id === propertyId);
  if (!property) return <View className="flex-1" />;
  const value = issue?.properties?.[property.id];
  const write = (next: IssuePropertyValue | undefined) =>
    mutation.mutate({ propertyId: property.id, value: next });
  const writeAsync = (next: IssuePropertyValue | undefined) =>
    mutation.mutateAsync({ propertyId: property.id, value: next });
  return <Editor property={property} value={value} write={write} writeAsync={writeAsync} />;
}

type WriteAsync = (next: IssuePropertyValue | undefined) => Promise<unknown>;

/**
 * Local mirror for toggle lists: rapid toggles build on each other,
 * their writes go out one after another, and only when none is pending
 * does the list follow the cache again (lib/issue-properties.ts).
 */
function useToggleMirror(value: IssuePropertyValue | undefined, writeAsync: WriteAsync) {
  const [local, setLocal] = useState<IssuePropertyValue | undefined>(value);
  const [pending, setPending] = useState(0);
  const queue = useRef(createSerialQueue()).current;
  const current = toggleMirror(local, value, pending);
  // Two taps before the next render build on each other.
  const chain = useRef(createToggleChain(current)).current;
  chain.sync(current);
  const apply = (update: (prev: IssuePropertyValue | undefined) => IssuePropertyValue | undefined) => {
    const next = chain.apply(update);
    setLocal(next);
    setPending((n) => n + 1);
    void queue(() => writeAsync(next))
      .catch(() => undefined) // the mutation rolls back and reports
      .finally(() => setPending((n) => n - 1));
  };
  return [current, apply] as const;
}

function Editor({
  property,
  value,
  write,
  writeAsync,
}: {
  property: IssueProperty;
  value: IssuePropertyValue | undefined;
  write: (next: IssuePropertyValue | undefined) => void;
  writeAsync: WriteAsync;
}) {
  const { t } = useT("issues");
  const close = () => router.back();
  const clearAndClose = () => {
    write(undefined);
    close();
  };

  if (isPropertyReadOnly(property, value)) {
    return (
      <View className="flex-1">
        <Header title={property.name} hasValue={value !== undefined} onClear={clearAndClose} />
        <Text className="px-4 pt-2 text-sm text-muted-foreground">{t("properties.read_only")}</Text>
      </View>
    );
  }

  switch (property.type) {
    case "select":
      return (
        <OptionList
          property={property}
          hasValue={value !== undefined}
          onClear={clearAndClose}
          rows={(property.config?.options ?? []).map((o) => ({ key: o.id, label: o.name, color: o.color }))}
          selected={(key) => value === key}
          onPick={(key) => {
            write(key);
            close();
          }}
        />
      );
    case "multi_select":
      return (
        <MultiSelect property={property} value={value} writeAsync={writeAsync} onClear={clearAndClose} />
      );
    case "checkbox":
      return (
        <OptionList
          property={property}
          hasValue={value !== undefined}
          onClear={clearAndClose}
          rows={[
            { key: "true", label: t("properties.yes") },
            { key: "false", label: t("properties.no") },
          ]}
          selected={(key) => String(value) === key}
          onPick={(key) => {
            write(key === "true");
            close();
          }}
        />
      );
    case "actor":
    case "multi_actor":
      return <ActorPicker property={property} value={value} write={write} writeAsync={writeAsync} onClear={clearAndClose} />;
    case "date":
      return <DateEditor property={property} value={value} write={write} onClear={clearAndClose} />;
    default:
      return <ScalarEditor property={property} value={value} write={write} onClear={clearAndClose} />;
  }
}

function Header({
  title,
  hasValue,
  onClear,
  onDone,
}: {
  title: string;
  hasValue: boolean;
  onClear: () => void;
  onDone?: () => void;
}) {
  const { t } = useT("issues");
  return (
    <View className="flex-row items-center justify-between gap-2 px-4 pt-4 pb-2">
      <Text className="flex-1 text-base font-semibold text-foreground">{title}</Text>
      {hasValue ? (
        <Pressable
          onPress={onClear}
          hitSlop={6}
          accessibilityRole="button"
          testID="property-clear"
          className="min-h-12 justify-center rounded-md px-2 active:bg-secondary"
        >
          <Text className="text-sm text-destructive">{t("picker.clear")}</Text>
        </Pressable>
      ) : null}
      {onDone ? (
        <Pressable
          onPress={onDone}
          hitSlop={6}
          accessibilityRole="button"
          testID="property-done"
          className="min-h-12 justify-center rounded-md px-2 active:bg-secondary"
        >
          <Text className="text-sm font-medium text-primary">{t("common:actions.done")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

interface Row {
  key: string;
  label: string;
  color?: string;
  disabled?: boolean;
}

function OptionList({
  property,
  hasValue,
  onClear,
  onDone,
  rows,
  selected,
  onPick,
  multiple = false,
}: {
  property: IssueProperty;
  hasValue: boolean;
  onClear: () => void;
  onDone?: () => void;
  rows: Row[];
  selected: (key: string) => boolean;
  onPick: (key: string) => void;
  multiple?: boolean;
}) {
  const { colorScheme } = useColorScheme();
  const { t } = useT("issues");
  return (
    <View className="flex-1">
      <Header title={property.name} hasValue={hasValue} onClear={onClear} onDone={onDone} />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        ListEmptyComponent={
          <Text className="px-4 py-6 text-sm text-muted-foreground">{t("properties.no_options")}</Text>
        }
        renderItem={({ item }) => {
          const on = selected(item.key);
          return (
            <Pressable
              onPress={() => onPick(item.key)}
              disabled={item.disabled}
              accessibilityRole={multiple ? "checkbox" : "radio"}
              accessibilityState={{ checked: on, disabled: item.disabled }}
              testID={`property-option-${item.key}`}
              className="min-h-12 flex-row items-center gap-3 px-4 py-2 active:bg-secondary"
              style={item.disabled ? { opacity: 0.4 } : undefined}
            >
              {item.color ? <View className="size-3 rounded-full" style={{ backgroundColor: item.color }} /> : null}
              <Text className="flex-1 text-base text-foreground">{item.label}</Text>
              {on ? <Ionicons name="checkmark" size={20} color={THEME[colorScheme].primary} /> : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function MultiSelect({
  property,
  value,
  writeAsync,
  onClear,
}: {
  property: IssueProperty;
  value: IssuePropertyValue | undefined;
  writeAsync: WriteAsync;
  onClear: () => void;
}) {
  // Toggles build on each other; a rollback resets the list once no write
  // is pending.
  const [current, apply] = useToggleMirror(value, writeAsync);
  return (
    <OptionList
      property={property}
      hasValue={current !== undefined}
      onClear={onClear}
      onDone={() => router.back()}
      multiple
      rows={(property.config?.options ?? []).map((o) => ({ key: o.id, label: o.name, color: o.color }))}
      selected={(key) => Array.isArray(current) && current.includes(key)}
      onPick={(key) => {
        apply((prev) => toggleOption(prev, key));
      }}
    />
  );
}

function ActorPicker({
  property,
  value,
  write,
  writeAsync,
  onClear,
}: {
  property: IssueProperty;
  value: IssuePropertyValue | undefined;
  write: (next: IssuePropertyValue | undefined) => void;
  writeAsync: WriteAsync;
  onClear: () => void;
}) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const multiple = property.type === "multi_actor";
  const [current, apply] = useToggleMirror(value, writeAsync);
  const chosen = selectedMemberIds(current);
  const full = multiple && Array.isArray(current) && current.length >= MAX_ISSUE_PROPERTY_ACTOR_VALUES;
  const rows = useMemo(
    () =>
      [...members]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((m) => ({ key: m.user_id, label: m.name, disabled: full && !chosen.includes(m.user_id) })),
    [members, full, chosen],
  );
  return (
    <OptionList
      property={property}
      hasValue={current !== undefined}
      onClear={onClear}
      onDone={multiple ? () => router.back() : undefined}
      multiple={multiple}
      rows={rows}
      selected={(key) => chosen.includes(key)}
      onPick={(userId) => {
        if (!multiple) {
          write(memberRef(userId));
          router.back();
          return;
        }
        apply((prev) => toggleActor(prev, userId));
      }}
    />
  );
}

function ScalarEditor({
  property,
  value,
  write,
  onClear,
}: {
  property: IssueProperty;
  value: IssuePropertyValue | undefined;
  write: (next: IssuePropertyValue | undefined) => void;
  onClear: () => void;
}) {
  const { t } = useT("issues");
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  const [invalid, setInvalid] = useState<"number" | "url" | "length" | null>(null);
  const submit = () => {
    const parsed = parseScalarInput(property.type, draft);
    if (parsed.kind === "invalid") {
      setInvalid(parsed.reason);
      return;
    }
    if (parsed.kind === "clear") {
      if (value !== undefined) write(undefined);
    } else if (parsed.value !== value) {
      write(parsed.value);
    }
    router.back();
  };
  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Header title={property.name} hasValue={value !== undefined} onClear={onClear} onDone={submit} />
      <View className="gap-2 px-4">
        <TextInput
          testID="property-input"
          value={draft}
          onChangeText={(text) => {
            setDraft(text);
            setInvalid(null);
          }}
          autoFocus
          multiline={property.type === "text"}
          keyboardType={property.type === "number" ? "decimal-pad" : property.type === "url" ? "url" : "default"}
          autoCapitalize={property.type === "text" ? "sentences" : "none"}
          autoCorrect={property.type === "text"}
          placeholder={t(`properties.placeholder_${property.type === "number" || property.type === "url" ? property.type : "text"}`)}
          placeholderTextColor={MOBILE_PLACEHOLDER_COLOR}
          onSubmitEditing={property.type === "text" ? undefined : submit}
          accessibilityLabel={property.name}
          style={{ fontSize: 16, includeFontPadding: false }}
          className="min-h-12 rounded-md bg-secondary/50 px-3 py-2 text-foreground"
        />
        {invalid ? (
          <Text className="text-sm text-destructive" accessibilityLiveRegion="polite">
            {t(`properties.invalid_${invalid}`)}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

function DateEditor({
  property,
  value,
  write,
  onClear,
}: {
  property: IssueProperty;
  value: IssuePropertyValue | undefined;
  write: (next: IssuePropertyValue | undefined) => void;
  onClear: () => void;
}) {
  const ref = useRef<DueDatePickerBodyHandle>(null);
  const day = typeof value === "string" ? value : null;
  return (
    <View className="flex-1">
      <DateHeader
        title={property.name}
        hasValue={!!day}
        onDone={() => {
          // The property stores the calendar day only.
          const iso = ref.current?.getIso()?.slice(0, 10);
          if (iso && iso !== day) write(iso);
          router.back();
        }}
        onClear={onClear}
      />
      <DueDatePickerBody ref={ref} value={day} />
    </View>
  );
}
