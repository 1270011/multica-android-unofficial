/**
 * One-time card at the top of the Inbox (docs/UX.md §8.8 step 1–5): asks
 * whether to notify when the operator is needed. Never at app start as a
 * system dialog; the dialog only follows "Aktivieren". "Später" hides the
 * card for 7 days, the second "Später" for good. Android only, and only
 * while push is off.
 */
import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { notifyAvailable, rbNotify } from "@/lib/notify/native";
import { enablePush } from "@/lib/notify/enable";
import {
  afterDecision,
  afterLater,
  parseCardState,
  shouldShowCard,
  type CardState,
} from "@/lib/notify/push-logic";
import { showToast } from "@/lib/toast";
import { useT } from "@/lib/i18n";

const CARD_KEY = "rb_notify_card";

export function PushPermissionCard() {
  const { t } = useT("settings");
  const [state, setState] = useState<CardState | null>(null);

  useEffect(() => {
    if (!notifyAvailable || Platform.OS !== "android") return;
    void SecureStore.getItemAsync(CARD_KEY).then((raw) => setState(parseCardState(raw)));
  }, []);

  if (!state) return null;
  const visible = shouldShowCard(state, {
    available: notifyAvailable && Platform.OS === "android",
    enabled: rbNotify.getSettings().enabled,
    now: Date.now(),
  });
  if (!visible) return null;

  const save = (next: CardState) => {
    setState(next);
    void SecureStore.setItemAsync(CARD_KEY, JSON.stringify(next));
  };

  const onEnable = async () => {
    const outcome = await enablePush();
    save(afterDecision(state));
    if (outcome === "granted") showToast({ key: "settings:push.enabled_toast" });
  };

  return (
    <View
      className="mx-4 mt-3 mb-1 rounded-lg border border-border bg-card p-4 gap-3"
      accessibilityRole="summary"
    >
      <Text className="text-base font-semibold text-foreground">{t("push.card_title")}</Text>
      <Text className="text-sm text-muted-foreground">{t("push.card_body")}</Text>
      <View className="flex-row gap-3 justify-end">
        <Button variant="ghost" onPress={() => save(afterLater(state, Date.now()))}>
          <Text>{t("push.card_later")}</Text>
        </Button>
        <Button onPress={() => void onEnable()}>
          <Text>{t("push.card_enable")}</Text>
        </Button>
      </View>
    </View>
  );
}
