/**
 * Edit issue title / description. Modal presentation, configured in
 * `[workspace]/_layout.tsx`. Save runs the optimistic `useUpdateIssue`
 * mutation; modal dismisses on success.
 *
 * Mirrors `project/[id]/edit.tsx` so users get the same gesture on both
 * record types (cancel/save in header, dirty Alert on dismiss-while-dirty).
 *
 * Description uses `useMentionInput` + `<DescriptionField>` so the @-mention
 * pipeline matches `new-issue.tsx`. v1 note: existing mentions in the
 * server-side description render as raw markdown text while editing because
 * there's no markdown-to-marker deserializer yet — `serialize()` still
 * produces a valid round-trip since unparsed `[@name](mention://...)` literals
 * pass through unchanged. New @-mentions added during the edit get serialized
 * normally via the marker pipeline.
 *
 * Properties (status / priority / assignee / labels / project / due_date)
 * are NOT edited here — they have dedicated chip pickers on the detail page.
 * This screen only owns the two free-text fields.
 *
 * Conflict protection: the screen keeps the title/description
 * it started from as the baseline. Before saving it re-reads the issue; if
 * someone else changed a field the user also changed, a dialog offers
 * "Reload" (take theirs, discard mine for that field) or "Keep mine"
 * (re-base on the server copy and overwrite). A 409 from the server's own
 * `title_base` check opens the same dialog. See data/issue-edit.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { stripChannelMediaMarkers } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { DescriptionField } from "@/components/issue/description-field";
import { MentionSuggestionBar } from "@/components/issue/mention-suggestion-bar";
import { MOBILE_PLACEHOLDER_COLOR } from "@/components/ui/input-tokens";
import { issueDetailOptions } from "@/data/queries/issues";
import { useUpdateIssue } from "@/data/mutations/issues";
import { api } from "@/data/api";
import {
  buildIssueTextUpdate,
  detectTextConflict,
  hasConflict,
  isRevisionConflict,
  resolveConflict,
  type IssueText,
  type TextConflict,
} from "@/data/issue-edit";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useT } from "@/lib/i18n";
import { useMentionInput } from "@/lib/use-mention-input";
import { HEADER_MAX_FONT_SCALE, MODAL_CLOSE_TITLE_GAP_DP } from "@/lib/header-scale";
import { READING_WIDTH_STYLE } from "@/components/ui/reading-width";

export default function EditIssue() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useT("issues");
  const detail = useQuery(issueDetailOptions(wsId, id));
  const update = useUpdateIssue(id);

  const [title, setTitle] = useState("");
  const [initialTitle, setInitialTitle] = useState("");
  const [initialDescription, setInitialDescription] = useState("");
  const description = useMentionInput();
  const [seeded, setSeeded] = useState(false);
  // `useMentionInput` returns `setText` from `useState`, which is a stable
  // identity across renders. Pulling it out of the hook return lets us list
  // it explicitly in the seeding effect's dep array without the whole
  // `description` object (which changes every render) re-triggering the
  // seed and overwriting in-progress edits.
  const setDescriptionText = description.setText;

  useEffect(() => {
    if (!detail.data || seeded) return;
    setTitle(detail.data.title);
    setInitialTitle(detail.data.title);
    const initial = detail.data.description ?? "";
    setDescriptionText(stripChannelMediaMarkers(initial));
    setInitialDescription(initial);
    setSeeded(true);
  }, [detail.data, seeded, setDescriptionText]);

  const currentDescription = description.serialize();

  const dirty = useMemo(() => {
    if (!detail.data || !seeded) return false;
    return (
      title.trim() !== initialTitle ||
      currentDescription.trim() !==
        stripChannelMediaMarkers(initialDescription).trim()
    );
  }, [detail.data, seeded, title, initialTitle, currentDescription, initialDescription]);

  const [checking, setChecking] = useState(false);
  // Guards against a second tap while the pre-save read is in flight.
  const savingRef = useRef(false);
  const busy = update.isPending || checking;

  const canSave =
    seeded && title.trim().length > 0 && dirty && !busy;

  const onCancel = useCallback(() => {
    if (!dirty) {
      router.back();
      return;
    }
    Alert.alert(
      t("form.discard_title"),
      t("form.discard_message_issue"),
      [
        { text: t("form.keep_editing"), style: "cancel" },
        {
          text: t("common:actions.discard"),
          style: "destructive",
          onPress: () => router.back(),
        },
      ],
    );
  }, [dirty, t]);

  const base: IssueText = useMemo(
    () => ({ title: initialTitle, description: initialDescription }),
    [initialTitle, initialDescription],
  );

  // Put a resolved draft/base pair into the form (data/issue-edit.ts
  // resolveConflict decides field by field what the form shows).
  const applyResolved = useCallback(
    (next: { draft: IssueText; base: IssueText }, shownDescription: string) => {
      setTitle(next.draft.title);
      if (next.draft.description !== shownDescription) {
        setDescriptionText(next.draft.description);
      }
      setInitialTitle(next.base.title);
      setInitialDescription(next.base.description);
    },
    [setDescriptionText],
  );

  const write = useCallback(
    (draft: IssueText, againstBase: IssueText) => {
      // An empty description string clears it on the server, which is what
      // the user wants after wiping the field.
      const patch = buildIssueTextUpdate(draft, againstBase);
      if (Object.keys(patch).length === 0) {
        router.back();
        return;
      }
      update.mutate(patch, {
        onSuccess: () => router.back(),
        onError: async (err) => {
          if (isRevisionConflict(err)) {
            const fresh = await api.getIssue(id).catch(() => null);
            if (fresh && fresh.id) {
              const found = detectTextConflict(againstBase, draft, fresh);
              // The server only checks the title, so a 409 is a title conflict.
              showConflict(againstBase, draft, fresh, hasConflict(found) ? found : { ...found, title: true });
              return;
            }
          }
          Alert.alert(
            t("form.save_failed"),
            err instanceof Error ? err.message : t("common:states.error"),
          );
        },
      });
    },
    // showConflict is declared below and only reads stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [update, id, t],
  );

  const showConflict = (
    atBase: IssueText,
    draft: IssueText,
    server: { title: string; description: string | null },
    conflict: TextConflict,
  ) => {
    const fields = [
      conflict.title ? t("common:fields.title") : null,
      conflict.description ? t("common:fields.description") : null,
    ].filter(Boolean).join(", ");
    const resolve = (choice: "reload" | "keep_mine") =>
      resolveConflict(atBase, draft, server, conflict, choice);
    Alert.alert(
      t("edit.conflict_title"),
      t("edit.conflict_message", { fields }),
      [
        { text: t("form.keep_editing"), style: "cancel" },
        {
          text: t("edit.conflict_reload"),
          onPress: () => applyResolved(resolve("reload"), draft.description),
        },
        {
          text: t("edit.conflict_keep_mine"),
          style: "destructive",
          onPress: () => {
            const next = resolve("keep_mine");
            applyResolved(next, draft.description);
            write(next.draft, next.base);
          },
        },
      ],
    );
  };

  const onSave = useCallback(async () => {
    if (!canSave || savingRef.current) return;
    savingRef.current = true;
    setChecking(true);
    const draft = { title, description: currentDescription };
    try {
      // Re-read the issue: the server keeps descriptions last-write-wins, so
      // only a client-side comparison protects them (data/issue-edit.ts).
      const fresh = await api.getIssue(id).catch(() => null);
      if (fresh && fresh.id) {
        const conflict = detectTextConflict(base, draft, fresh);
        if (hasConflict(conflict)) {
          showConflict(base, draft, fresh, conflict);
          return;
        }
      }
      write(draft, base);
    } finally {
      savingRef.current = false;
      setChecking(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSave, id, title, currentDescription, base, write]);

  const headerLeft = useCallback(
    () => (
      <Pressable
        onPress={onCancel}
        accessibilityRole="button"
        // Gap to the Android title, like the modal ✕.
        style={{ marginRight: MODAL_CLOSE_TITLE_GAP_DP }}
        className="px-1 py-1"
      >
      <Text className="text-base text-brand" maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}>{t("common:actions.cancel")}</Text>
      </Pressable>
    ),
    [onCancel, t],
  );

  const headerRight = useCallback(
    () => (
      <Pressable
        onPress={onSave}
        disabled={!canSave}
        className={canSave ? "px-1 py-1" : "px-1 py-1 opacity-40"}
      >
        <Text className="text-base text-brand font-semibold" maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}>
          {busy ? t("edit.saving") : t("edit.save")}
        </Text>
      </Pressable>
    ),
    [canSave, onSave, busy, t],
  );

  return (
    <>
      <Stack.Screen options={{ headerLeft, headerRight }} />
      {/* RN's KeyboardAvoidingView had no behavior on Android, and under
          edge-to-edge (targetSdk 36) adjustResize does nothing: the
          @-suggestion bar sat behind the keyboard. The
          keyboard-controller one with "padding" lifts it on both
          platforms, like chat-screen.tsx. */}
      <View className="flex-1 bg-background">
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <ScrollView
            className="flex-1"
            contentContainerClassName="px-4 pt-4 pb-6 gap-4"
            contentContainerStyle={READING_WIDTH_STYLE}
            keyboardShouldPersistTaps="handled"
          >
            {!detail.data ? (
              <Text className="text-sm text-muted-foreground">
                {t("common:states.loading")}
              </Text>
            ) : (
              <>
                <Field label={t("common:fields.title")}>
                  <TextInput
                    value={title}
                    onChangeText={setTitle}
                    placeholder={t("new.title_placeholder")}
                    placeholderTextColor={MOBILE_PLACEHOLDER_COLOR}
                    className="text-base text-foreground bg-secondary/50 rounded-md px-3 py-2"
                    returnKeyType="next"
                    editable={!busy}
                  />
                </Field>

                <Field label={t("common:fields.description")}>
                  <DescriptionField
                    description={description}
                    disabled={busy}
                  />
                </Field>
              </>
            )}
          </ScrollView>
          {/* Mention suggestion bar floats above the keyboard while the user
              is mid-@. Outside the ScrollView so it doesn't scroll with the
              form body. */}
          <MentionSuggestionBar {...description.suggestionBar} />
        </KeyboardAvoidingView>
      </View>
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </Text>
      {children}
    </View>
  );
}
