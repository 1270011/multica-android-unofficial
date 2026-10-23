import { useState } from "react";
import { Pressable, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Haptics from "@/lib/haptics";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { Button } from "@/components/ui/button";
import { MulticaLogo } from "@/components/brand/multica-logo";
import { useAuthStore } from "@/data/auth-store";
import { useServerConfigStore } from "@/data/server-config-store";
import { i18n, useT } from "@/lib/i18n";
import { mapAuthError } from "@/lib/auth-error";
import { serverLabel } from "@/lib/server-config";

export default function Login() {
  const { t } = useT("auth");
  const sendCode = useAuthStore((s) => s.sendCode);
  const server = useServerConfigStore((s) => s.config);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    void Haptics.selectionAsync();
    setSubmitting(true);
    setError(null);
    try {
      await sendCode(trimmed);
      router.push({ pathname: "/verify", params: { email: trimmed } });
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(mapAuthError(err, t("login.send_failed"), (key) => i18n.t(`auth:${key}`)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      {/* Keyboard-aware scroll so "Change server" and the developer entry
          stay reachable while the keyboard is up. The email
          field auto-focuses and the keyboard covered the links; with
          edge-to-edge on Android 15+ the window no longer resizes for the
          IME, so the inset is applied here via react-native-keyboard-
          controller instead of relying on `adjustResize`. */}
      <KeyboardAwareScrollView
        className="flex-1"
        contentContainerClassName="flex-grow justify-center px-6 py-6 gap-6"
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
          <View className="items-center gap-3">
            <MulticaLogo size={32} />
            <View className="gap-1 items-center">
              <Text className="text-2xl font-semibold text-foreground">
                {t("login.title")}
              </Text>
              <Text className="text-sm text-muted-foreground text-center">
                {t("login.subtitle")}
              </Text>
            </View>
          </View>

          <View className="gap-3">
            <TextField
              autoCapitalize="none"
              autoComplete="email"
              autoFocus
              keyboardType="email-address"
              placeholder={t("login.email_placeholder")}
              value={email}
              onChangeText={setEmail}
              onSubmitEditing={onSubmit}
              returnKeyType="send"
              editable={!submitting}
              invalid={!!error}
            />
            {error ? (
              <Text className="text-sm text-destructive">{error}</Text>
            ) : null}
          </View>

          <Button
            size="lg"
            disabled={submitting || !email.trim()}
            onPress={onSubmit}
          >
            <Text>{submitting ? t("login.sending") : t("login.send_code")}</Text>
          </Button>

          {/* Which server this phone talks to, with a way back to the setup
              screen (mode / URL / Cloudflare service token). */}
          <View className="items-center gap-1">
            <Text className="text-xs text-muted-foreground text-center" numberOfLines={1}>
              {t("server.current", { server: serverLabel(server) })}
            </Text>
            <Pressable
              onPress={() => router.push("/server-setup")}
              disabled={submitting}
              hitSlop={12}
              accessibilityRole="button"
              className="min-h-12 justify-center"
            >
              <Text className="text-sm text-primary">{t("server.change")}</Text>
            </Pressable>
            {process.env.EXPO_PUBLIC_DEBUG_TOKEN_LOGIN === "1" ? (
              // Debug builds only — inlined + folded away in release
              // (lib/debug-token-login.ts explains why the env read is spelled
              // out here instead of importing the constant).
              <Pressable
                onPress={() => router.push("/token-login")}
                disabled={submitting}
                hitSlop={12}
                accessibilityRole="button"
                className="min-h-12 justify-center"
              >
                <Text className="text-sm text-muted-foreground">
                  {t("token_login.entry")}
                </Text>
              </Pressable>
            ) : null}
          </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}
