/**
 * Server setup — first-launch screen and Settings → "Server connection".
 *
 * Lets the user pick how the phone reaches Multica:
 *   - Cloudflare Access: public URL + service token (Client ID / Secret)
 *   - Local / VPN: the server's own address, no Cloudflare headers
 *
 * Everything is kept in expo-secure-store (data/server-config-store.ts);
 * the APK ships no server address or token. A "Test connection" button
 * probes `/health` with the draft values so a wrong token or a missing CA
 * certificate shows up before the user even reaches the login screen.
 *
 * Saving a different server or mode signs the current session out: the
 * bearer token belongs to the old origin.
 *
 * Secret handling:
 * every field has a "Paste" button that fills it without focusing it (no
 * keyboard), a Cloudflare header block fills both fields at once, the
 * clipboard is cleared afterwards (switchable, default on), the stored
 * secret is never prefilled, and FLAG_SECURE blocks screenshots while the
 * screen is open.
 *
 * Reached via `/server-setup` (index.tsx redirects here when nothing is
 * configured; Settings pushes it with `?from=settings`).
 */
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@/components/ui/ionicons";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { usePreventScreenCapture } from "expo-screen-capture";
import { Text } from "@/components/ui/text";
import { PasteField, type PasteFieldStatus } from "@/components/ui/paste-field";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { MulticaLogo } from "@/components/brand/multica-logo";
import { useAuthStore } from "@/data/auth-store";
import { api } from "@/data/api";
import { renewNotifySessionForConfig } from "@/lib/notify/session";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useServerConfigStore } from "@/data/server-config-store";
import {
  DEFAULT_CLOUDFLARE_URL,
  DEFAULT_DIRECT_URL,
  cfAccessHeaders,
  looksLikeAccessBlock,
  validateServerConfig,
  withStoredSecret,
  type ConnectionMode,
  type ServerConfig,
  type ServerConfigDraft,
} from "@/lib/server-config";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { containsCfSecret, interpretPaste, type FormatHint } from "@/lib/paste-parse";
import { clearClipboard, useClearClipboardPref } from "@/lib/clipboard-clear-pref";

const MODES: ConnectionMode[] = ["cloudflare", "direct"];
const TEST_TIMEOUT_MS = 10_000;

type PasteTarget = "url" | "cfClientId" | "cfClientSecret";

type TestResult =
  | { kind: "ok"; commit: string }
  | { kind: "access_blocked" }
  | { kind: "not_multica" }
  | { kind: "failed"; reason: string };

/** The stored secret is never put into the draft; see withStoredSecret. */
function draftFrom(config: ServerConfig | null): ServerConfigDraft {
  if (config) {
    return {
      mode: config.mode,
      baseUrl: config.baseUrl,
      cfClientId: config.cfClientId,
      cfClientSecret: "",
    };
  }
  return {
    mode: "cloudflare",
    baseUrl: DEFAULT_CLOUDFLARE_URL,
    cfClientId: "",
    cfClientSecret: "",
  };
}

/**
 * Probe `${baseUrl}/health` with the draft's headers. Kept here rather than
 * in ApiClient because it must use the *unsaved* values and must never
 * trigger the 401 sign-out hook.
 */
async function probeServer(config: ServerConfig): Promise<TestResult> {
  const url = `${config.baseUrl}/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", ...cfAccessHeaders(config) },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const reason =
      err instanceof Error && err.name === "AbortError"
        ? "timeout"
        : err instanceof Error
          ? err.message
          : String(err);
    return { kind: "failed", reason };
  }
  clearTimeout(timer);
  const contentType = res.headers.get("content-type");
  let bodyStart: string | null = null;
  if (contentType && /text\/html/i.test(contentType)) {
    try {
      bodyStart = (await res.clone().text()).slice(0, 2048);
    } catch {
      bodyStart = null;
    }
  }
  logger.log("[server-setup] probe", { status: res.status, url: res.url, contentType });
  if (
    looksLikeAccessBlock({
      status: res.status,
      url: res.url,
      contentType,
      server: res.headers.get("server"),
      bodyStart,
      requestUrl: url,
    })
  ) {
    return { kind: "access_blocked" };
  }
  if (!res.ok) return { kind: "failed", reason: `HTTP ${res.status}` };
  try {
    const body = (await res.json()) as { status?: unknown; commit?: unknown };
    if (body && body.status === "ok") {
      const commit = typeof body.commit === "string" ? body.commit.slice(0, 9) : "";
      return { kind: "ok", commit };
    }
    return { kind: "not_multica" };
  } catch {
    return { kind: "not_multica" };
  }
}

// Own key: with the shared 'default' key, router.replace between the two
// secret screens can drop FLAG_SECURE (old screen's unmount runs last).
const SCREEN_CAPTURE_KEY = "server-setup";

export default function ServerSetup() {
  // FLAG_SECURE while mounted: no screenshots, recordings or recents preview.
  usePreventScreenCapture(SCREEN_CAPTURE_KEY);
  const { t } = useT("auth");
  const { from } = useLocalSearchParams<{ from?: string }>();
  const fromSettings = from === "settings";
  const { colorScheme } = useColorScheme();
  const mutedFg = THEME[colorScheme].mutedForeground;

  const stored = useServerConfigStore((s) => s.config);
  const saveConfig = useServerConfigStore((s) => s.save);
  const clearConfig = useServerConfigStore((s) => s.clear);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const clearWorkspace = useWorkspaceStore((s) => s.clear);

  const [draft, setDraft] = useState<ServerConfigDraft>(() => draftFrom(stored));
  const [error, setError] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [keepStoredSecret, setKeepStoredSecret] = useState(true);
  const [pasteStatus, setPasteStatus] = useState<
    Partial<Record<PasteTarget, PasteFieldStatus>>
  >({});
  const [clearAfterPaste, setClearAfterPaste] = useClearClipboardPref();
  const [helpOpen, setHelpOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);

  // The store may finish loading after first render on a cold start.
  useEffect(() => {
    if (stored) {
      setDraft(draftFrom(stored));
      setKeepStoredSecret(true);
    }
  }, [stored]);

  const hasStoredSecret =
    stored?.mode === "cloudflare" && !!stored.cfClientSecret;
  const showStoredSecret =
    hasStoredSecret && keepStoredSecret && draft.cfClientSecret === "";

  const update = (patch: Partial<ServerConfigDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
    setTestResult(null);
  };

  const onModeChange = (mode: ConnectionMode) => {
    if (mode === draft.mode) return;
    // Swap the URL prefill when the user has not typed their own value.
    const untouched =
      draft.baseUrl === "" ||
      draft.baseUrl === DEFAULT_CLOUDFLARE_URL ||
      draft.baseUrl === DEFAULT_DIRECT_URL ||
      (stored !== null && stored.mode !== mode && draft.baseUrl === stored.baseUrl);
    update({
      mode,
      ...(untouched
        ? { baseUrl: mode === "cloudflare" ? DEFAULT_CLOUDFLARE_URL : DEFAULT_DIRECT_URL }
        : {}),
    });
  };

  const validated = useMemo(
    () => validateServerConfig(withStoredSecret(draft, stored, keepStoredSecret)),
    [draft, stored, keepStoredSecret],
  );

  const hintText = (hint: FormatHint, length: number): PasteFieldStatus =>
    hint === "ok"
      ? { tone: "ok", text: t("server.paste_ok", { count: length }) }
      : { tone: "warn", text: t(`server.paste_hint_${hint}`, { count: length }) };

  const onSecretChange = (cfClientSecret: string) => {
    if (cfClientSecret !== "") setKeepStoredSecret(false);
    update({ cfClientSecret });
    setPasteStatus((p) => ({ ...p, cfClientSecret: undefined }));
  };

  // Reads the clipboard on tap and writes straight into the draft; the field
  // is never focused, so the keyboard stays closed. Status texts carry only
  // lengths — never the value.
  const onPaste = async (target: PasteTarget) => {
    let raw = "";
    try {
      raw = await Clipboard.getStringAsync();
    } catch {
      raw = "";
    }
    applyText(target, raw, clearAfterPaste);
  };

  // Typing or the field's own context-menu paste: text naming the Client
  // Secret never stays in the (unmasked) URL / Client ID field.
  const onPlainFieldChange = (target: "url" | "cfClientId", text: string) => {
    if (containsCfSecret(text)) {
      applyText(target, text, clearAfterPaste);
      return;
    }
    update(target === "url" ? { baseUrl: text } : { cfClientId: text });
    setPasteStatus((p) => ({ ...p, [target]: undefined }));
  };

  const applyText = (target: PasteTarget, raw: string, clearPref: boolean) => {
    let result = interpretPaste(raw, target);
    // A Cloudflare block outside Cloudflare mode would fill hidden fields.
    if (result.kind === "block" && target === "url" && draft.mode !== "cloudflare") {
      result = { kind: "secret_rejected" };
    }
    // Secret header text is cleared whatever the switch says.
    if (containsCfSecret(raw) || (clearPref && (result.kind === "block" || target === "cfClientSecret"))) {
      void clearClipboard();
    }
    if (result.kind === "empty") {
      setPasteStatus((p) => ({ ...p, [target]: { tone: "warn", text: t("server.paste_empty") } }));
      return;
    }
    if (result.kind === "secret_rejected") {
      setPasteStatus((p) => ({
        ...p,
        [target]: { tone: "warn", text: t("server.paste_secret_rejected") },
      }));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    if (result.kind === "block") {
      const { cfClientId, cfClientSecret } = result.values;
      setKeepStoredSecret(false);
      update({ cfClientId, cfClientSecret });
      setPasteStatus((p) => ({
        ...p,
        url: target === "url" ? { tone: "ok", text: t("server.paste_block") } : p.url,
        cfClientId: { tone: "ok", text: t("server.paste_block") },
        cfClientSecret: hintText("ok", cfClientSecret.length),
      }));
    } else {
      if (target === "cfClientSecret") setKeepStoredSecret(false);
      update(
        (target === "url" ? { baseUrl: result.value } : { [target]: result.value }) as Partial<ServerConfigDraft>,
      );
      setPasteStatus((p) => ({ ...p, [target]: hintText(result.hint, result.value.length) }));
    }
    void Haptics.selectionAsync();
  };

  const showValidationError = (code: string) => {
    setError(t(`server.error_${code}`));
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  };

  const onTest = async () => {
    if (!validated.ok) return showValidationError(validated.error);
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const result = await probeServer(validated.config);
      setTestResult(result);
      void Haptics.notificationAsync(
        result.kind === "ok"
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Error,
      );
    } finally {
      setTesting(false);
    }
  };

  const signOutIfNeeded = async (next: ServerConfig) => {
    const changed =
      !stored || stored.baseUrl !== next.baseUrl || stored.mode !== next.mode;
    if (changed && user) {
      // logout() also clears caches and session stores.
      await clearWorkspace();
      await logout();
    }
  };

  const onSave = async () => {
    if (!validated.ok) return showValidationError(validated.error);
    setSaving(true);
    try {
      const previous = stored;
      await signOutIfNeeded(validated.config);
      await saveConfig(validated.config);
      // Same server, new CF credentials: no sign-out, but the notification
      // service needs the new headers.
      if (useAuthStore.getState().user) {
        renewNotifySessionForConfig(previous, validated.config, api.getToken());
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (fromSettings && useAuthStore.getState().user) {
        router.back();
      } else {
        router.replace("/");
      }
    } finally {
      setSaving(false);
    }
  };

  const onForget = () => {
    Alert.alert(t("server.forget_confirm_title"), t("server.forget_confirm_body"), [
      { text: t("common:actions.cancel"), style: "cancel" },
      {
        text: t("server.forget"),
        style: "destructive",
        onPress: async () => {
          await clearWorkspace();
          await logout();
          await clearConfig();
          setDraft(draftFrom(null));
          setKeepStoredSecret(false);
          setPasteStatus({});
          setTestResult(null);
          setError(null);
          if (fromSettings) router.replace("/server-setup");
        },
      },
    ]);
  };

  const testMessage = (() => {
    if (!testResult) return null;
    switch (testResult.kind) {
      case "ok":
        return { ok: true, text: t("server.test_ok", { commit: testResult.commit }) };
      case "access_blocked":
        return { ok: false, text: t("server.test_access_blocked") };
      case "not_multica":
        return { ok: false, text: t("server.test_not_multica") };
      case "failed":
        return { ok: false, text: t("server.test_failed", { reason: testResult.reason }) };
    }
  })();

  const busy = testing || saving;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-6 py-6 gap-6"
          keyboardShouldPersistTaps="handled"
        >
          <View className="flex-row items-center">
            {fromSettings ? (
              <Pressable
                onPress={() => router.back()}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={t("common:actions.cancel")}
                className="pr-3"
              >
                <Ionicons name="chevron-back" size={24} color={mutedFg} />
              </Pressable>
            ) : null}
            <View className="flex-1 items-center gap-3">
              <MulticaLogo size={32} />
              <View className="gap-1 items-center">
                <Text className="text-2xl font-semibold text-foreground">
                  {t("server.title")}
                </Text>
                <Text className="text-sm text-muted-foreground text-center">
                  {t("server.subtitle")}
                </Text>
              </View>
            </View>
            {fromSettings ? <View className="w-9" /> : null}
          </View>

          <Section title={t("server.mode_label")}>
            <RadioGroup
              value={draft.mode}
              onValueChange={(v) => onModeChange(v as ConnectionMode)}
              className="gap-0"
            >
              {MODES.map((mode, idx) => (
                <View key={mode}>
                  <Pressable
                    onPress={() => onModeChange(mode)}
                    disabled={busy}
                    className="flex-row items-start px-4 py-3.5 active:bg-secondary gap-3"
                  >
                    <View className="pt-0.5">
                      <RadioGroupItem value={mode} />
                    </View>
                    <View className="flex-1 gap-0.5">
                      <Text className="text-base font-medium text-foreground">
                        {t(`server.mode_${mode}`)}
                      </Text>
                      <Text className="text-xs text-muted-foreground">
                        {t(`server.mode_${mode}_hint`)}
                      </Text>
                    </View>
                  </Pressable>
                  {idx < MODES.length - 1 ? <Separator /> : null}
                </View>
              ))}
            </RadioGroup>
          </Section>

          <View className="gap-2">
            <FieldLabel>{t("server.url_label")}</FieldLabel>
            <PasteField
              testID="server-url"
              pasteText={t("server.paste")}
              pasteLabel={t("server.paste_label", { field: t("server.url_label") })}
              onPaste={() => void onPaste("url")}
              status={pasteStatus.url}
              disabled={busy}
              accessibilityLabel={t("server.url_label")}
              placeholder={t(`server.url_placeholder_${draft.mode}`)}
              value={draft.baseUrl}
              onChangeText={(text) => onPlainFieldChange("url", text)}
              keyboardType="url"
              invalid={!!error && !validated.ok && validated.error.startsWith("url")}
              returnKeyType="next"
            />
          </View>

          {draft.mode === "cloudflare" ? (
            <View className="gap-4">
              <View className="gap-2">
                <FieldLabel>{t("server.cf_client_id")}</FieldLabel>
                <PasteField
                  testID="cf-client-id"
                  pasteText={t("server.paste")}
                  pasteLabel={t("server.paste_label", { field: t("server.cf_client_id") })}
                  onPaste={() => void onPaste("cfClientId")}
                  status={pasteStatus.cfClientId}
                  disabled={busy}
                  accessibilityLabel={t("server.cf_client_id")}
                  placeholder="xxxxxxxx.access"
                  value={draft.cfClientId}
                  onChangeText={(text) => onPlainFieldChange("cfClientId", text)}
                  invalid={!!error && !validated.ok && validated.error === "cf_client_id_missing"}
                  returnKeyType="next"
                />
              </View>
              <View className="gap-2">
                <FieldLabel>{t("server.cf_client_secret")}</FieldLabel>
                <PasteField
                  testID="cf-client-secret"
                  secret
                  revealed={showSecret && !showStoredSecret}
                  onToggleReveal={showStoredSecret ? undefined : () => setShowSecret((v) => !v)}
                  revealLabel={t("server.cf_secret_show")}
                  pasteText={t("server.paste")}
                  pasteLabel={t("server.paste_label", { field: t("server.cf_client_secret") })}
                  onPaste={() => void onPaste("cfClientSecret")}
                  status={pasteStatus.cfClientSecret}
                  disabled={busy}
                  accessibilityLabel={t("server.cf_client_secret")}
                  placeholder={showStoredSecret ? t("server.cf_secret_saved") : undefined}
                  value={draft.cfClientSecret}
                  onChangeText={onSecretChange}
                  invalid={!!error && !validated.ok && validated.error === "cf_client_secret_missing"}
                  returnKeyType="done"
                />
                {/* Native paste (context menu / keyboard) bypasses the app, so
                    only the button can clear the clipboard. */}
                <Text className="text-xs text-muted-foreground leading-4">
                  {t("server.secret_paste_hint")}
                </Text>
              </View>

              <View className="flex-row items-center gap-3">
                <View className="flex-1 gap-0.5">
                  <Text className="text-sm text-foreground">{t("server.clear_clipboard")}</Text>
                  <Text className="text-xs text-muted-foreground leading-4">
                    {t("server.clear_clipboard_hint")}
                  </Text>
                </View>
                <Switch
                  checked={clearAfterPaste}
                  onCheckedChange={setClearAfterPaste}
                  disabled={busy}
                  accessibilityLabel={t("server.clear_clipboard")}
                  testID="clear-clipboard-switch"
                  hitSlop={14}
                />
              </View>

              <Pressable
                onPress={() => setHelpOpen((o) => !o)}
                className="flex-row items-center gap-2 py-1"
                accessibilityRole="button"
              >
                <Ionicons
                  name={helpOpen ? "chevron-down" : "chevron-forward"}
                  size={16}
                  color={mutedFg}
                />
                <Text className="text-sm text-primary">{t("server.cf_help_title")}</Text>
              </Pressable>
              {helpOpen ? (
                <View className="rounded-md border border-border bg-card px-4 py-3">
                  <Text className="text-sm text-foreground leading-5">
                    {t("server.cf_help_body")}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : (
            <View className="rounded-md border border-border bg-card px-4 py-3 gap-1">
              <Text className="text-sm font-medium text-foreground">
                {t("server.ca_hint_title")}
              </Text>
              <Text className="text-sm text-muted-foreground leading-5">
                {t("server.ca_hint_body")}
              </Text>
            </View>
          )}

          {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
          {testMessage ? (
            <View
              className={cn(
                "rounded-md px-4 py-3 border",
                testMessage.ok
                  ? "border-border bg-secondary/50"
                  : "border-destructive/60 bg-destructive/10",
              )}
            >
              <Text
                className={cn(
                  "text-sm",
                  testMessage.ok ? "text-foreground" : "text-destructive",
                )}
              >
                {testMessage.text}
              </Text>
            </View>
          ) : null}

          <View className="gap-3">
            <Button variant="outline" size="lg" disabled={busy} onPress={onTest}>
              <Text>{testing ? t("server.testing") : t("server.test")}</Text>
            </Button>
            <Button size="lg" disabled={busy} onPress={onSave}>
              <Text>{saving ? t("server.saving") : t("server.save")}</Text>
            </Button>
            {user ? (
              <Text className="text-xs text-muted-foreground text-center">
                {t("server.change_warning")}
              </Text>
            ) : null}
          </View>

          <Text className="text-xs text-muted-foreground text-center">
            {t("server.screenshot_blocked")}
          </Text>

          {stored ? (
            <View className="pt-2">
              <Button variant="ghost" disabled={busy} onPress={onForget}>
                <Text className="text-destructive">{t("server.forget")}</Text>
              </Button>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Text className="text-xs uppercase tracking-wider text-muted-foreground px-1">
      {children}
    </Text>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <FieldLabel>{title}</FieldLabel>
      <View className="rounded-md border border-border bg-card overflow-hidden">
        {children}
      </View>
    </View>
  );
}
