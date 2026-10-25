/**
 * Shared message composer used by both the issue-comment thread and the
 * chat tab. Two visual states:
 *
 *   collapsed → pill button (configurable label / icon). Minimal vertical
 *               footprint so the list above gets the full screen.
 *   expanded  → optional reply chip → chip row (@ + image + file) →
 *               plain TextInput → toolbar (`@ 📷 📎 ──── [➤ or Stop]`).
 *
 * Mentions / images / files all live in the chip row OUTSIDE the text
 * input. The input itself is a plain RN `<TextInput multiline>` — no
 * controlled selection, no inline overlays. On submit the composer
 * prepends mention markdown links to the typed text and attaches
 * `attachmentIds`. Server-side mention regex
 * (`server/internal/util/mention.go:16`) parses them as if they were
 * inline.
 *
 * Mention picker is a formSheet route, pushed via `mentionPickerPath`.
 * That route writes selections into `useMentionDraftStore`; this composer
 * reads from the same store.
 *
 * Why a shared component:
 *   - Comment and chat composers want byte-identical UI / interaction.
 *   - Chat-specific differences are slim: controlled draft text (parent
 *     owns the value for cross-session persistence), Stop button during
 *     agent execution. Both addressed via optional props.
 *
 * What this component does NOT own:
 *   - The submit action — `onSubmit` is the caller's escape hatch (it
 *     wires `useCreateComment` on the comment side, the chat send burst
 *     on the chat side).
 *   - Reply target lifecycle — comment passes in `replyTarget` +
 *     `onClearReplyTarget` from its store; chat doesn't.
 *   - Stop visual / animation — chat passes a `renderStop()` slot when
 *     `isSending` is true.
 *
 * Cleanup: mention draft store cleared on unmount so navigating away
 * from comment-A's draft doesn't leak `@张三` into comment-B's composer.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Alert,
  Keyboard,
  Pressable,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@/components/ui/ionicons";
import { router, type Href } from "expo-router";
import * as Haptics from "@/lib/haptics";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { api, MAX_FILE_SIZE } from "@/data/api";
import { useMentionDraftStore } from "@/data/stores/mention-draft-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { stripMarkdown } from "@/lib/strip-markdown";
import { touchTargetOverlay } from "@/lib/touch-target";
import { THEME } from "@/lib/theme";
import { continuousCorners } from "@/lib/radius";
import { Text } from "@/components/ui/text";
import { IconButton } from "@/components/ui/icon-button";
import {
  ComposerAttachmentRow,
  type ComposerAttachmentItem,
  type MentionChip,
} from "@/components/issue/composer-attachment-row";
import { useT } from "@/lib/i18n";
import { composerActions } from "@/lib/composer-actions";
import { composeMessageContent } from "@/lib/compose-message-content";

export interface MessageComposerReplyTarget {
  actorName: string;
  preview: string;
}

interface Props {
  /** Submit callback. Composer awaits this; on rejection it restores text,
   *  attachments, and mentions so the user can retry without losing
   *  context. Resolved promise → text + chips cleared, composer collapses
   *  back to pill. */
  onSubmit: (args: {
    content: string;
    attachmentIds: string[];
    mentions: MentionChip[];
  }) => Promise<void>;

  /** Push target for the `@` button. The picker route reads /
   *  writes `useMentionDraftStore` directly. */
  mentionPickerPath: Href;

  /** Attachment upload context — forwarded to `api.uploadFile`. Comment
   *  passes `issueId`; chat omits both (uploads are session-scoped via
   *  the message id assigned by the server post-send). */
  uploadContext?: { issueId?: string; commentId?: string };

  placeholder?: string;
  pillLabel?: string;
  pillIcon?: keyof typeof Ionicons.glyphMap;

  /** Optional controlled-text mode. When `value` + `onChangeText` are
   *  both provided, the parent owns the draft (chat: persists to its
   *  draft store across sessions). When omitted, composer manages its
   *  own internal text state (comment). */
  value?: string;
  onChangeText?: (next: string) => void;
  /** Optional controlled attachments, same idea as `value`: the parent keeps
   *  them across remounts (comment drafts). `updateAttachments` gets a
   *  functional update, so an upload finishing after a remount still lands
   *  on the current list. */
  attachments?: ComposerAttachmentItem[];
  updateAttachments?: (
    update: (prev: ComposerAttachmentItem[]) => ComposerAttachmentItem[],
  ) => void;

  /** Optional reply chip (comment only). */
  replyTarget?: MessageComposerReplyTarget | null;
  onClearReplyTarget?: () => void;

  /** Optional "Editing comment" chip. The parent
   *  pre-fills `value` with the comment's markdown and routes the submit to
   *  the edit mutation while this is set. */
  editTarget?: { preview: string } | null;
  onCancelEdit?: () => void;

  /** Optional row above the input while composing, e.g. the comment
   *  trigger chips "Starts: X". Hidden when collapsed. */
  accessory?: ReactNode;
  /** Optional row shown collapsed and expanded, below the reply chip, e.g.
   *  the "Reply to <agent>" suggestion. */
  suggestion?: ReactNode;

  /** Composer enters "auto-expanded + focused" mode when this changes to
   *  a truthy stable key. Comment uses it to react to long-press → reply
   *  flow. Chat doesn't pass it. */
  expandTrigger?: string | null;

  /** When `isSending` is true AND `renderStop` is provided, the trailing
   *  send button is replaced by whatever `renderStop` returns. Chat uses
   *  this to show a Stop affordance while the agent is running. */
  isSending?: boolean;
  renderStop?: () => ReactNode;
  /** While `isSending`, still allow sending: the message joins the run's
   *  queue (server `supports_queue`). Send and Stop then sit side by side
   **/
  allowSubmitWhileRunning?: boolean;

  /** Hard-disable. Used when chat has no usable agent. The pill shows
   *  `disabledReason` instead of `pillLabel`, and the pill is
   *  non-interactive (cannot expand). */
  disabled?: boolean;
  disabledReason?: string;

  /** When true the composer renders flush at the bottom of its parent
   *  WITHOUT the KeyboardStickyView keyboard-aware lift + safe-area
   *  inset. Chat's parent owns its own KeyboardAvoidingView and
   *  bottom-inset handling (chat.tsx), so the composer must not also
   *  apply them. Comment's parent does NOT handle keyboard, so the
   *  composer keeps the default `true`. */
  manageKeyboard?: boolean;
}

function makeLocalId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function MessageComposer({
  onSubmit,
  mentionPickerPath,
  uploadContext,
  placeholder,
  pillLabel,
  pillIcon = "chatbubble-ellipses-outline",
  value: controlledValue,
  onChangeText: controlledOnChange,
  attachments: controlledAttachments,
  updateAttachments: controlledUpdateAttachments,
  replyTarget = null,
  onClearReplyTarget,
  editTarget = null,
  onCancelEdit,
  accessory,
  suggestion,
  expandTrigger,
  isSending = false,
  renderStop,
  allowSubmitWhileRunning = false,
  disabled = false,
  disabledReason,
  manageKeyboard = true,
}: Props) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const { t } = useT("chat");
  const resolvedPlaceholder = placeholder ?? t("composer.default_placeholder");
  const resolvedPillLabel = pillLabel ?? t("composer.default_placeholder");
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const inputRef = useRef<TextInput>(null);
  const [expanded, setExpanded] = useState(false);
  const [internalText, setInternalText] = useState("");
  const [internalAttachments, setInternalAttachments] = useState<ComposerAttachmentItem[]>([]);
  const attachmentsControlled =
    controlledAttachments !== undefined && controlledUpdateAttachments !== undefined;
  const attachments = attachmentsControlled ? controlledAttachments : internalAttachments;
  const setAttachments = useCallback(
    (next: ComposerAttachmentItem[] | ((prev: ComposerAttachmentItem[]) => ComposerAttachmentItem[])) => {
      const update = typeof next === "function" ? next : () => next;
      if (attachmentsControlled) controlledUpdateAttachments(update);
      else setInternalAttachments(update);
    },
    [attachmentsControlled, controlledUpdateAttachments],
  );
  const [submitting, setSubmitting] = useState(false);

  // Hybrid controlled / uncontrolled pattern (React-canonical). Chat
  // passes `value`/`onChangeText` for cross-session draft persistence;
  // comment omits both and the composer manages local state.
  const isControlled =
    controlledValue !== undefined && controlledOnChange !== undefined;
  const text = isControlled ? controlledValue : internalText;
  const setText = useCallback(
    (next: string) => {
      if (isControlled) {
        controlledOnChange(next);
      } else {
        setInternalText(next);
      }
    },
    [isControlled, controlledOnChange],
  );

  const mentions = useMentionDraftStore((s) => s.mentions);
  const removeMention = useMentionDraftStore((s) => s.remove);
  const clearMentions = useMentionDraftStore((s) => s.clear);

  // Drop mention draft on composer unmount so navigating away doesn't
  // leak chips into the next composer's session.
  useEffect(() => {
    return () => {
      clearMentions();
    };
  }, [clearMentions]);

  // Auto-expand + focus when an `expandTrigger` changes. Comment uses
  // this to react to the long-press → reply flow setting a reply target.
  // A trigger already present at mount (a reply target kept in the draft)
  // doesn't pop the keyboard on return; the chip shows it.
  const triggerSeen = useRef<string | null>(expandTrigger ?? null);
  if (
    expandTrigger &&
    triggerSeen.current !== expandTrigger &&
    !disabled
  ) {
    triggerSeen.current = expandTrigger;
    setExpanded(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // A draft that arrives from outside — a chat example chip, a restored
  // per-session draft, a comment picked for editing — shows up at once
  // instead of hiding behind the collapsed pill.
  useEffect(() => {
    if (isControlled && controlledValue.trim().length > 0) setExpanded(true);
  }, [isControlled, controlledValue]);

  const hasInFlightUpload = attachments.some((a) => a.status === "uploading");
  const actions = composerActions({
    isRunning: isSending,
    allowSubmitWhileRunning,
    stopAvailable: !!renderStop,
    hasContent: text.trim().length > 0 || mentions.length > 0,
    uploading: hasInFlightUpload,
    submitting,
    disabled,
  });
  const canSend = actions.canSend;

  const expand = useCallback(() => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setExpanded(true);
    // The reply target stays: it's visible on the chip and only ✕ or a
    // send removes it (W1-2).
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [disabled]);

  const handleSubmit = useCallback(async () => {
    if (!canSend) return;
    const textSnap = text;
    const mentionsSnap = mentions;
    const attachmentsSnap = attachments;

    const content = composeMessageContent(textSnap, mentionsSnap);

    const activeIds = attachmentsSnap
      .filter((a) => a.status === "completed")
      .map((a) => a.id)
      .filter((id): id is string => !!id);

    // Optimistic clear: text + chips empty out immediately so the next
    // typing tick doesn't double-include them. Restored on rejection.
    setText("");
    setAttachments([]);
    clearMentions();
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    try {
      await onSubmit({
        content,
        attachmentIds: activeIds,
        mentions: mentionsSnap,
      });
      // Success → fully exit composing mode. Explicit triple-step
      // because a missing blur leaves the keyboard up; missing
      // Keyboard.dismiss races on iOS when focus is in-flight; missing
      // setExpanded(false) leaves the expanded card on screen.
      inputRef.current?.blur();
      Keyboard.dismiss();
      setExpanded(false);
    } catch {
      setText(textSnap);
      setAttachments(attachmentsSnap);
      mentionsSnap.forEach((m) =>
        useMentionDraftStore.getState().toggle(m),
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    canSend,
    text,
    mentions,
    attachments,
    setText,
    clearMentions,
    onSubmit,
    setAttachments,
  ]);

  /** Streams a picked asset to /api/upload-file, updating the matching
   *  thumbnail's status as it goes. Pulled out so retry can call it
   *  again without re-opening the picker. */
  const startUpload = useCallback(
    async (
      localId: string,
      asset: { uri: string; name: string; type: string },
    ) => {
      try {
        const result = await api.uploadFile(asset, uploadContext);
        setAttachments((prev) =>
          prev.map((it) =>
            it.localId === localId
              ? {
                  ...it,
                  status: "completed",
                  id: result.id,
                  url: result.url,
                  downloadUrl: result.download_url,
                }
              : it,
          ),
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t("common:states.error");
        setAttachments((prev) =>
          prev.map((it) =>
            it.localId === localId
              ? { ...it, status: "failed", error: message }
              : it,
          ),
        );
      }
    },
    [uploadContext, t, setAttachments],
  );

  const onImagePress = useCallback(async () => {
    const picker = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (picker.canceled) return;
    const picked = picker.assets[0];
    if (!picked) return;
    if (picked.fileSize != null && picked.fileSize > MAX_FILE_SIZE) {
      Alert.alert(
        t("composer.file_too_large_title"),
        t("composer.file_too_large_message"),
      );
      return;
    }
    const filename = picked.fileName ?? `image-${Date.now()}.jpg`;
    const mimeType = picked.mimeType ?? "image/jpeg";
    const localId = makeLocalId();
    setAttachments((prev) => [
      ...prev,
      {
        localId,
        localUri: picked.uri,
        filename,
        mimeType,
        status: "uploading",
      },
    ]);
    requestAnimationFrame(() => inputRef.current?.focus());
    await startUpload(localId, {
      uri: picked.uri,
      name: filename,
      type: mimeType,
    });
  }, [startUpload, t, setAttachments]);

  const onFilePress = useCallback(async () => {
    const picker = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: true,
    });
    if (picker.canceled) return;
    const picked = picker.assets[0];
    if (!picked) return;
    if (picked.size != null && picked.size > MAX_FILE_SIZE) {
      Alert.alert(
        t("composer.file_too_large_title"),
        t("composer.file_too_large_message"),
      );
      return;
    }
    const mimeType = picked.mimeType ?? "application/octet-stream";
    const localId = makeLocalId();
    setAttachments((prev) => [
      ...prev,
      {
        localId,
        localUri: picked.uri,
        filename: picked.name,
        mimeType,
        status: "uploading",
      },
    ]);
    requestAnimationFrame(() => inputRef.current?.focus());
    await startUpload(localId, {
      uri: picked.uri,
      name: picked.name,
      type: mimeType,
    });
  }, [startUpload, t, setAttachments]);

  const onRemoveAttachment = useCallback((localId: string) => {
    setAttachments((prev) => prev.filter((it) => it.localId !== localId));
  }, [setAttachments]);

  const onRetryAttachment = useCallback(
    (localId: string) => {
      const item = attachments.find((it) => it.localId === localId);
      if (!item) return;
      setAttachments((prev) =>
        prev.map((it) =>
          it.localId === localId
            ? { ...it, status: "uploading", error: undefined }
            : it,
        ),
      );
      void startUpload(localId, {
        uri: item.localUri,
        name: item.filename,
        type: item.mimeType,
      });
    },
    [attachments, startUpload, setAttachments],
  );

  // The @-sheet's own search field takes focus from the input (Android
  // shows it in the sheet body). That blur must not collapse the
  // composer: the user is in the middle of adding mentions to it.
  const blurForMentionPicker = useRef(false);
  // Set while this composer's @-sheet is open, so only the composer that
  // opened it takes the focus back (the chat tab stays mounted under the
  // agent chat route).
  const pickerOpen = useRef(false);
  const onAtPress = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    // Only a focused input blurs; otherwise the flag would eat a later,
    // real blur.
    blurForMentionPicker.current = inputRef.current?.isFocused() ?? false;
    pickerOpen.current = true;
    router.push(mentionPickerPath);
  }, [mentionPickerPath]);

  // Back from the sheet the input gets the focus again. The sheet's search
  // field had it, and the keyboard stayed up without a focused field, so
  // typed text went nowhere (F1). Retried once: while the sheet
  // is still sliding out its field can keep the focus for a moment.
  const pickerCloses = useMentionDraftStore((s) => s.pickerCloses);
  useEffect(() => {
    if (!pickerOpen.current) return;
    pickerOpen.current = false;
    blurForMentionPicker.current = false;
    const focusInput = () => {
      if (!inputRef.current?.isFocused()) inputRef.current?.focus();
    };
    const first = setTimeout(focusInput, 50);
    const retry = setTimeout(focusInput, 350);
    return () => {
      clearTimeout(first);
      clearTimeout(retry);
    };
  }, [pickerCloses]);

  /** Auto-collapse to pill when input loses focus AND nothing's worth
   *  keeping the composer expanded for. Deferred one tick so a toolbar
   *  IconButton tap (which briefly resigns first responder) doesn't
   *  trigger a collapse before its onPress runs. */
  const onBlur = useCallback(() => {
    if (blurForMentionPicker.current) {
      blurForMentionPicker.current = false;
      return;
    }
    setTimeout(() => {
      const empty =
        text.trim().length === 0 &&
        attachments.length === 0 &&
        mentions.length === 0;
      if (empty && !inputRef.current?.isFocused()) {
        // Collapse to the pill; a reply target stays on its chip above it.
        setExpanded(false);
        onCancelEdit?.();
      }
    }, 80);
  }, [text, attachments.length, mentions.length, onCancelEdit]);

  // "Replying to X" stays visible in both states, collapsed too, so a
  // kept reply target is never hidden behind the pill.
  // The chip row is one text-xs line (16 dp line height, grows with the
  // font scale); the ✕ glyph is centred in it.
  const replyRowShift = (Math.max(16, 16 * fontScale) - 16) / 2;
  const replyChip =
    replyTarget && !editTarget ? (
      <View className="px-3 py-1.5 rounded-md bg-secondary/60 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Ionicons
            name="return-up-back"
            size={14}
            color={theme.mutedForeground}
          />
          <Text
            className="flex-1 text-xs font-medium text-muted-foreground"
            numberOfLines={1}
          >
            {t("composer.replying_to", { name: replyTarget.actorName })}
          </Text>
          <Ionicons
            name="close-circle"
            size={16}
            color={theme.mutedForeground}
          />
        </View>
        {replyTarget.preview ? (
          <Text
            className="text-xs text-muted-foreground pl-5"
            numberOfLines={2}
          >
            {stripMarkdown(replyTarget.preview)}
          </Text>
        ) : null}
        {/* The ✕ target: a transparent 48 dp box over the 16 dp glyph,
            last child so the preview line can't take its touches, with
            real bounds for TalkBack (hitSlop alone reports 16 dp). It may
            reach 14 dp up (py-1.5 + the composer's pt-2) before the
            composer edge clips it. */}
        <Pressable
          onPress={onClearReplyTarget}
          style={touchTargetOverlay({
            glyphSize: 16,
            glyphTop: 6 + replyRowShift,
            glyphRight: 12,
            maxReachUp: 14 + replyRowShift,
          })}
          testID="cancel-reply"
          accessibilityRole="button"
          accessibilityLabel={t("composer.cancel_reply")}
        />
      </View>
    ) : null;

  const pillContent = (
    <View
      className="border-t border-border bg-background px-3 pt-2 gap-2"
      style={{ paddingBottom: (manageKeyboard ? insets.bottom : 0) + 8 }}
    >
      {replyChip}
      {suggestion}
      <Pressable
        onPress={expand}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={pillLabel}
        accessibilityState={{ disabled }}
        className="flex-row items-center gap-2 h-11 px-4 rounded-full bg-secondary active:opacity-80"
      >
        <Ionicons
          name={pillIcon}
          size={18}
          color={theme.mutedForeground}
        />
        <Text className="text-base text-muted-foreground">
          {disabled && disabledReason ? disabledReason : resolvedPillLabel}
        </Text>
      </Pressable>
    </View>
  );

  const expandedContent = (
    <View
      className="bg-background px-3 pt-2 gap-2"
      style={{ paddingBottom: (manageKeyboard ? insets.bottom : 0) + 4 }}
    >
      {editTarget && (
        <View className="px-3 py-1.5 rounded-md bg-secondary/60 gap-0.5">
          <View className="flex-row items-center gap-2">
            <Ionicons
              name="pencil-outline"
              size={14}
              color={theme.mutedForeground}
            />
            <Text
              className="flex-1 text-xs font-medium text-muted-foreground"
              numberOfLines={1}
            >
              {t("issues:comments.editing")}
            </Text>
            <Pressable
              onPress={onCancelEdit}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("issues:comments.cancel_edit")}
            >
              <Ionicons
                name="close-circle"
                size={16}
                color={theme.mutedForeground}
              />
            </Pressable>
          </View>
          {editTarget.preview ? (
            <Text
              className="text-xs text-muted-foreground pl-5"
              numberOfLines={2}
            >
              {stripMarkdown(editTarget.preview)}
            </Text>
          ) : null}
        </View>
      )}

      {replyChip}
      {suggestion}

      {accessory}

      <View
        className="rounded-2xl border border-border bg-secondary"
        style={continuousCorners}
      >
        {(mentions.length > 0 || attachments.length > 0) ? (
          <View className="px-2">
            <ComposerAttachmentRow
              mentions={mentions}
              attachments={attachments}
              onRemoveMention={removeMention}
              onRemoveAttachment={onRemoveAttachment}
              onRetryAttachment={onRetryAttachment}
            />
          </View>
        ) : null}

        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          onBlur={onBlur}
          placeholder={resolvedPlaceholder}
          placeholderTextColor={theme.mutedForeground}
          multiline
          editable={!disabled}
          className="px-4 pt-3 pb-1 text-base text-foreground"
          style={{ minHeight: 28, maxHeight: 140, textAlignVertical: "top" }}
        />

        <View className="flex-row items-center px-2 pb-2 pt-1">
          {/* @ leads the toolbar — highest-signal attachment (only one
           *  that drives notifications) and cross-resource (people +
           *  issues), pride-of-place left. */}
          <IconButton
            name="at"
            iconSize={20}
            color={mentions.length > 0 ? theme.primary : undefined}
            onPress={onAtPress}
            accessibilityLabel={t("composer.mention")}
            className="h-8 w-8"
          />
          <IconButton
            name="image-outline"
            iconSize={20}
            onPress={onImagePress}
            accessibilityLabel={t("composer.upload_image")}
            className="h-8 w-8"
          />
          <IconButton
            name="attach-outline"
            iconSize={20}
            onPress={onFilePress}
            accessibilityLabel={t("composer.upload_file")}
            className="h-8 w-8"
          />
          <View className="flex-1" />
          {actions.showStop && renderStop ? renderStop() : null}
          {actions.showSend ? (
            <IconButton
              name="arrow-up"
              iconSize={18}
              color={theme.primaryForeground}
              variant="default"
              onPress={handleSubmit}
              disabled={!canSend}
              hitSlop={12}
              className={actions.showStop ? "ml-2 h-8 w-8 rounded-full" : "h-8 w-8 rounded-full"}
              accessibilityLabel={actions.queues ? t("composer.send_queued") : t("composer.send")}
              accessibilityState={{ disabled: !canSend }}
              testID="composer-send"
            />
          ) : null}
        </View>
      </View>
    </View>
  );

  const body = expanded ? expandedContent : pillContent;

  // When the parent owns keyboard handling (chat.tsx wraps in
  // KeyboardAvoidingView + SafeAreaView), skip the KeyboardStickyView —
  // double-stacking causes the composer to jump twice on keyboard show.
  if (!manageKeyboard) return body;

  return (
    <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
      {body}
    </KeyboardStickyView>
  );
}
