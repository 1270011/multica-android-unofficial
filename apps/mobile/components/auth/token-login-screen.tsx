/**
 * Debug-only token sign-in (see lib/debug-token-login.ts for the gating and
 * the proof that this module is absent from release bundles).
 *
 * Two ways to supply the token, neither of which logs or displays it:
 *   1. Type it into the masked field, or tap "Paste" (no keyboard; trimmed,
 *      a leading "Bearer " dropped, clipboard cleared afterwards when the
 *      switch is on).
 *   2. "Load from file": reads `debug-token.txt` from the app's private
 *      documents directory, which a tester fills with adb
 *      (`adb shell run-as <applicationId> …`).
 */
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { usePreventScreenCapture } from "expo-screen-capture";
import { File, Paths } from "expo-file-system";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { MulticaLogo } from "@/components/brand/multica-logo";
import { useAuthStore } from "@/data/auth-store";
import { useServerConfigStore } from "@/data/server-config-store";
import { tokenLoginErrorKey } from "@/lib/auth-error";
import { useT } from "@/lib/i18n";
import { serverLabel } from "@/lib/server-config";
import {
  DEBUG_TOKEN_FILE_NAME,
  looksLikeToken,
  tokenFromFileText,
} from "@/lib/debug-token-login";
import { interpretPaste } from "@/lib/paste-parse";
import { clearClipboard, useClearClipboardPref } from "@/lib/clipboard-clear-pref";

// Own key (see server-setup): the two secret screens replace each other.
const SCREEN_CAPTURE_KEY = "token-login";

export function TokenLoginScreen() {
  // FLAG_SECURE while mounted.
  usePreventScreenCapture(SCREEN_CAPTURE_KEY);
  const { t } = useT("auth");
  const [clearAfterPaste, setClearAfterPaste] = useClearClipboardPref();
  const loginWithToken = useAuthStore((s) => s.loginWithToken);
  const server = useServerConfigStore((s) => s.config);
  const [token, setTokenValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (value: string) => {
    if (!looksLikeToken(value)) {
      setError(t("token_login.invalid"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await loginWithToken(value);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/");
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // Never the server message (it could echo the token), only a key.
      setError(t(tokenLoginErrorKey(err)));
    } finally {
      setSubmitting(false);
    }
  };

  const loadFromFile = () => {
    try {
      const file = new File(Paths.document, DEBUG_TOKEN_FILE_NAME);
      const value = file.exists ? tokenFromFileText(file.textSync()) : null;
      if (!value) {
        setError(t("token_login.file_missing", { name: DEBUG_TOKEN_FILE_NAME }));
        return;
      }
      setNotice(t("token_login.file_loaded"));
      setTokenValue(value);
      void submit(value);
    } catch {
      setError(t("token_login.file_missing", { name: DEBUG_TOKEN_FILE_NAME }));
    }
  };

  const pasteFromClipboard = async () => {
    let raw = "";
    try {
      raw = await Clipboard.getStringAsync();
    } catch {
      raw = "";
    }
    const result = interpretPaste(raw, "token");
    if (result.kind === "secret_rejected" || result.kind === "block") {
      // A Cloudflare secret is not a login token; never keep it around.
      await clearClipboard();
      setNotice(null);
      setError(t("server.paste_not_token"));
      return;
    }
    if (result.kind !== "value") {
      setNotice(null);
      setError(t("server.paste_empty"));
      return;
    }
    setTokenValue(result.value);
    setError(null);
    setNotice(t("server.paste_ok", { count: result.value.length }));
    if (clearAfterPaste) await clearClipboard();
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="flex-1 justify-center px-6 gap-6">
          <View className="items-center gap-3">
            <MulticaLogo size={32} />
            <View className="gap-1 items-center">
              <Text className="text-2xl font-semibold text-foreground">
                {t("token_login.title")}
              </Text>
              <Text className="text-sm text-muted-foreground text-center">
                {t("token_login.subtitle")}
              </Text>
            </View>
          </View>

          <View className="gap-3">
            <TextField
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              contextMenuHidden
              autoComplete="off"
              importantForAutofill="no"
              textContentType="none"
              spellCheck={false}
              placeholder={t("token_login.placeholder")}
              value={token}
              onChangeText={(v) => {
                setTokenValue(v);
                setError(null);
              }}
              onSubmitEditing={() => void submit(token)}
              returnKeyType="go"
              editable={!submitting}
              invalid={!!error}
              accessibilityLabel={t("token_login.placeholder")}
            />
            {error ? (
              <Text className="text-sm text-destructive">{error}</Text>
            ) : notice ? (
              <Text className="text-sm text-muted-foreground">{notice}</Text>
            ) : null}
            <View className="flex-row gap-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={submitting}
                onPress={() => void pasteFromClipboard()}
                testID="token-paste"
              >
                <Text>{t("token_login.paste")}</Text>
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                disabled={submitting}
                onPress={loadFromFile}
              >
                <Text>{t("token_login.load_file")}</Text>
              </Button>
            </View>
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
              disabled={submitting}
              accessibilityLabel={t("server.clear_clipboard")}
              hitSlop={14}
            />
          </View>

          <Button
            size="lg"
            disabled={submitting || !token.trim()}
            onPress={() => void submit(token)}
          >
            <Text>{submitting ? t("token_login.signing_in") : t("token_login.sign_in")}</Text>
          </Button>

          <View className="items-center gap-1">
            <Text className="text-xs text-muted-foreground text-center" numberOfLines={1}>
              {t("server.current", { server: serverLabel(server) })}
            </Text>
            <Pressable
              onPress={() => router.back()}
              disabled={submitting}
              hitSlop={12}
              accessibilityRole="button"
              className="min-h-12 justify-center"
            >
              <Text className="text-sm text-primary">{t("token_login.back")}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
