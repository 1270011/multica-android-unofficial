/**
 * Settings › View › Hide issues:
 * switch (default off), pattern field prefilled with `^AUTO: `, ignore-case
 * switch, red error for unusable patterns and a live preview "Matches x of
 * y loaded issues". Rules and validation: lib/title-filter.ts; view model:
 * lib/title-filter-screen.ts. Lists and board use the filter from P8 on.
 * W7: "Also mute push notifications" (default off) silences the app's own
 * push for matching issues; lib/notify/title-mute.ts.
 *
 * Everything stays disabled until the workspace's stored values are loaded
 *: a write replaces the whole stored value.
 * Typing saves 400 ms after the last key (also when leaving the screen
 * earlier); until then the last saved pattern stays in force.
 */
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { Text } from "@/components/ui/text";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { TextField } from "@/components/ui/text-field";
import { useT } from "@/lib/i18n";
import { READING_WIDTH_STYLE } from "@/components/ui/reading-width";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  useTitleFilterSettings,
  useViewPrefsHydrated,
  useViewPrefsHydration,
  useViewPrefsStore,
} from "@/data/stores/view-prefs-store";
import { useLoadedIssueTitles } from "@/data/queries/loaded-issue-titles";
import { checkTitlePattern, TITLE_FILTER_MAX_PATTERN } from "@/lib/title-filter";
import {
  TITLE_FILTER_SAVE_DEBOUNCE_MS,
  titleFilterErrorText,
  titleFilterScreenView,
} from "@/lib/title-filter-screen";

export default function TitleFilterSettingsScreen() {
  const { t } = useT("settings");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  useViewPrefsHydration(wsId);
  const hydrated = useViewPrefsHydrated(wsId);
  const settings = useTitleFilterSettings(wsId);
  const setTitleFilter = useViewPrefsStore((s) => s.setTitleFilter);
  const loadedTitles = useLoadedIssueTitles(wsId);

  // Text being typed; null = shows the saved pattern.
  const [draft, setDraft] = useState<string | null>(null);
  // Re-render after the timed test run marked a pattern as too slow.
  const [, setCheckTick] = useState(0);

  const pending = useRef<{ wsId: string; pattern: string } | null>(null);
  const savePending = () => {
    const p = pending.current;
    pending.current = null;
    if (p) setTitleFilter(p.wsId, { pattern: p.pattern });
  };

  useEffect(() => {
    if (draft === null || !wsId || draft === settings.pattern) {
      pending.current = null;
      return;
    }
    pending.current = { wsId, pattern: draft };
    const timer = setTimeout(savePending, TITLE_FILTER_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, wsId, settings.pattern]);

  // Leaving the screen within 400 ms still saves the last input.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => savePending, []);

  // Timed test run over the loaded issues for every saved pattern/flag.
  useEffect(() => {
    if (!hydrated || settings.pattern === "") return;
    const check = checkTitlePattern(settings.pattern, settings.ignoreCase, loadedTitles);
    if (!check.ok && check.error.kind === "too_slow") setCheckTick((n) => n + 1);
  }, [hydrated, settings.pattern, settings.ignoreCase, loadedTitles]);

  const view = titleFilterScreenView({ hydrated, settings, loadedTitles });
  const errorText = view.error
    ? (() => {
        const e = titleFilterErrorText(view.error);
        return t(e.key, e.params);
      })()
    : null;
  const disabled = view.locked || !wsId;
  const value = draft ?? settings.pattern;

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 py-4 gap-6"
      contentContainerStyle={READING_WIDTH_STYLE}
      keyboardShouldPersistTaps="handled"
    >
      <View className="rounded-md border border-border bg-card overflow-hidden">
        <View className="flex-row items-center px-4 py-3 gap-3">
          <Text className="flex-1 text-base font-medium text-foreground">
            {t("title_filter.enabled")}
          </Text>
          <Switch
            testID="title-filter-enabled"
            checked={settings.enabled}
            disabled={disabled}
            onCheckedChange={(checked) => wsId && setTitleFilter(wsId, { enabled: checked })}
            accessibilityLabel={t("title_filter.enabled")}
          />
        </View>
        <Separator />
        <View className="px-4 py-3 gap-2">
          <Text className="text-sm font-medium text-foreground">
            {t("title_filter.pattern")}
          </Text>
          <TextField
            testID="title-filter-pattern"
            value={value}
            onChangeText={setDraft}
            editable={!disabled}
            invalid={view.error !== null}
            maxLength={TITLE_FILTER_MAX_PATTERN}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            style={{ fontFamily: "monospace" }}
            accessibilityLabel={t("title_filter.pattern")}
            accessibilityHint={errorText ?? t("title_filter.pattern_help")}
          />
          {errorText ? (
            <Text
              testID="title-filter-error"
              className="text-xs text-destructive"
              accessibilityLiveRegion="polite"
            >
              {errorText}
            </Text>
          ) : (
            <Text className="text-xs text-muted-foreground">
              {t("title_filter.pattern_help")}
            </Text>
          )}
          {view.preview || view.previewEmpty ? (
            <Text
              testID="title-filter-preview"
              className="text-xs text-muted-foreground"
              accessibilityLiveRegion="polite"
            >
              {view.preview
                ? t("title_filter.preview", {
                    hidden: view.preview.hidden,
                    total: view.preview.total,
                  })
                : t("title_filter.preview_empty")}
            </Text>
          ) : null}
        </View>
        <Separator />
        <View className="flex-row items-center px-4 py-3 gap-3">
          <Text className="flex-1 text-base font-medium text-foreground">
            {t("title_filter.ignore_case")}
          </Text>
          <Switch
            testID="title-filter-ignore-case"
            checked={settings.ignoreCase}
            disabled={disabled}
            onCheckedChange={(checked) => {
              if (!wsId) return;
              savePending();
              setTitleFilter(wsId, { ignoreCase: checked });
            }}
            accessibilityLabel={t("title_filter.ignore_case")}
          />
        </View>
        <Separator />
        <View className="px-4 py-3 gap-1">
          <View className="flex-row items-center gap-3">
            <Text
              className={`flex-1 text-base font-medium ${
                view.muteAvailable ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {t("title_filter.mute_push")}
            </Text>
            <Switch
              testID="title-filter-mute-push"
              checked={settings.mutePush}
              disabled={disabled || !view.muteAvailable}
              onCheckedChange={(checked) => {
                if (!wsId) return;
                savePending();
                setTitleFilter(wsId, { mutePush: checked });
              }}
              accessibilityLabel={t("title_filter.mute_push")}
              accessibilityHint={t("title_filter.mute_push_help")}
            />
          </View>
          <Text className="text-xs text-muted-foreground">
            {view.muteAvailable
              ? t("title_filter.mute_push_help")
              : t("title_filter.mute_push_unavailable")}
          </Text>
        </View>
      </View>
      <Text className="text-sm text-muted-foreground px-1">
        {t("title_filter.scope")}
      </Text>
    </ScrollView>
  );
}
