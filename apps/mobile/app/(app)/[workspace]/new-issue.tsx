/**
 * New issue creation modal — manual only.
 *
 * Layout follows Apple Reminders / Linear iOS / Things 3: one vertical
 * scrolling form (title → description → property chips), no sticky bottom
 * toolbar. Property chips are part of the form, not pinned above keyboard.
 * MentionSuggestionBar floats above keyboard only when the user is mid-@.
 *
 * No markdown toolbar / upload buttons in v1: mobile users creating an
 * issue rarely format markdown, and attachment upload is deferred to a
 * later release (see plan-issue-majestic-rabin.md "skip uploads").
 *
 * Mention pipeline shares `useMentionInput` with `issue/[id]/new-comment.tsx`
 * — both surfaces produce canonical `[@name](mention://type/id)` markdown
 * recognised by util.ParseMentions on the server.
 */
import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { SubmitIssueButton } from "@/components/issue/submit-issue-button";
import { CreateFormAttributeRow } from "@/components/issue/create-form-attribute-row";
import { MentionSuggestionBar } from "@/components/issue/mention-suggestion-bar";
import { DescriptionField } from "@/components/issue/description-field";
import { MOBILE_PLACEHOLDER_COLOR } from "@/components/ui/input-tokens";
import { useCreateIssue } from "@/data/mutations/issues";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { useMentionInput } from "@/lib/use-mention-input";
import { parseAssigneeParam } from "@/lib/agent-actions";
import { useT } from "@/lib/i18n";
import { READING_WIDTH_STYLE } from "@/components/ui/reading-width";

export default function NewIssueModal() {
  const { t } = useT("issues");
  // `?assignee=agent:<id>` from the agent detail's "New issue".
  const params = useLocalSearchParams<{ assignee?: string }>();
  const [presetAssignee] = useState(() => parseAssigneeParam(params.assignee));
  const [title, setTitle] = useState("");
  const description = useMentionInput();
  // Attribute chips (status / priority / assignee / due date / project)
  // live in `useNewIssueDraftStore` so the new-issue-picker/* formSheet
  // routes can read and write the same values without a parent-child
  // React relationship. The store is reset on mount + on unmount so
  // re-opening the new-issue modal starts clean. A preset assignee is
  // applied in the same write as the mount reset (`start`), never before it.
  const status = useNewIssueDraftStore((s) => s.status);
  const priority = useNewIssueDraftStore((s) => s.priority);
  const assignee = useNewIssueDraftStore((s) => s.assignee);
  const dueDate = useNewIssueDraftStore((s) => s.dueDate);
  const project = useNewIssueDraftStore((s) => s.project);
  const resetDraft = useNewIssueDraftStore((s) => s.reset);
  const startDraft = useNewIssueDraftStore((s) => s.start);

  useEffect(() => {
    startDraft(presetAssignee ? { assignee: presetAssignee } : undefined);
    return () => {
      resetDraft();
    };
  }, [startDraft, resetDraft, presetAssignee]);

  const createIssue = useCreateIssue();
  const isSubmitting = createIssue.isPending;

  const canSubmit = !isSubmitting && title.trim().length > 0;

  const onSubmit = useCallback(async () => {
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) return;
    const finalDescription = description.serialize().trim();
    try {
      await createIssue.mutateAsync({
        title: trimmedTitle,
        description: finalDescription || undefined,
        status,
        priority,
        ...(assignee
          ? { assignee_type: assignee.type, assignee_id: assignee.id }
          : {}),
        ...(dueDate ? { due_date: dueDate } : {}),
        ...(project ? { project_id: project.id } : {}),
      });
      router.back();
    } catch (err) {
      Alert.alert(
        t("errors.create_failed"),
        err instanceof Error ? err.message : t("common:states.error"),
      );
    }
  }, [
    title,
    description,
    status,
    priority,
    assignee,
    dueDate,
    project,
    createIssue,
    t,
  ]);

  const headerRight = useCallback(
    () => (
      <SubmitIssueButton
        disabled={!canSubmit}
        loading={isSubmitting}
        onPress={onSubmit}
      />
    ),
    [canSubmit, isSubmitting, onSubmit],
  );

  return (
    <>
      <Stack.Screen options={{ headerRight }} />
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
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={t("new.title_placeholder")}
              placeholderTextColor={MOBILE_PLACEHOLDER_COLOR}
              className="text-2xl font-semibold text-foreground py-2"
              autoFocus
              returnKeyType="next"
              editable={!isSubmitting}
            />
            <DescriptionField
              description={description}
              disabled={isSubmitting}
            />
            <CreateFormAttributeRow />
          </ScrollView>

          {/* Mention suggestions float above the keyboard only when the user
              types `@`. Self-hides via `if (!visible) return null` so it
              doesn't take space at rest. */}
          <MentionSuggestionBar {...description.suggestionBar} />
        </KeyboardAvoidingView>
      </View>
    </>
  );
}
