/**
 * Pending workspace invitations with Accept / Decline, shown
 * in the workspace switcher sheet and on the workspace selection after
 * sign-in. Web parity: packages/views/layout/app-sidebar.tsx ("Pending
 * invitations" with Join / Decline).
 *
 * Phone adaptations:
 * - Accept offers the switch in a native Alert ("Switch now" / "Later")
 *   instead of navigating right away; the caller decides how to switch.
 * - Decline asks first: it is final and the buttons sit close together.
 *
 * Renders nothing while there are no open invitations, so callers can
 * mount it unconditionally.
 */
import { useMemo } from "react";
import { Alert, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { Invitation, Workspace } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { WorkspaceAvatar } from "@/components/workspace/workspace-avatar";
import { myInvitationsOptions } from "@/data/queries/invitations";
import {
  useAcceptInvitation,
  useDeclineInvitation,
} from "@/data/mutations/invitations";
import {
  invitationErrorKind,
  inviterLabel,
  openInvitations,
} from "@/lib/invitations";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function InvitationList({
  onSwitch,
  className,
}: {
  /** Switch into the joined workspace (sheet: close + replace; selection: select). */
  onSwitch: (workspace: Workspace) => void;
  className?: string;
}) {
  const { t } = useT("workspace");
  const { data } = useQuery(myInvitationsOptions());
  const invitations = useMemo(() => openInvitations(data ?? []), [data]);
  const accept = useAcceptInvitation();
  const decline = useDeclineInvitation();

  if (invitations.length === 0) return null;

  const nameOf = (inv: Invitation) =>
    inv.workspace_name?.trim() || t("invitations.workspace_fallback");

  // Message by cause (review #27): gone (404/410), not processed (other
  // HTTP errors), or no connection.
  const showFailure = (err: unknown) => {
    const kind = invitationErrorKind(err);
    Alert.alert(t(`invitations.failed_${kind}_title`), t(`invitations.failed_${kind}_message`));
  };

  const onAccept = (inv: Invitation) => {
    accept.mutate(inv, {
      onSuccess: (workspace) => {
        if (!workspace) {
          Alert.alert(t("invitations.joined_title", { name: nameOf(inv) }), t("invitations.joined_pending"));
          return;
        }
        Alert.alert(
          t("invitations.joined_title", { name: workspace.name }),
          t("invitations.joined_message"),
          [
            { text: t("invitations.later"), style: "cancel" },
            { text: t("invitations.switch_now"), onPress: () => onSwitch(workspace) },
          ],
        );
      },
      onError: (err) => showFailure(err),
    });
  };

  const onDecline = (inv: Invitation) => {
    Alert.alert(
      t("invitations.decline_title", { name: nameOf(inv) }),
      t("invitations.decline_message"),
      [
        { text: t("common:actions.cancel"), style: "cancel" },
        {
          text: t("invitations.decline"),
          style: "destructive",
          onPress: () =>
            decline.mutate(inv, {
              onError: (err) => showFailure(err),
            }),
        },
      ],
    );
  };

  const busy = accept.isPending || decline.isPending;

  return (
    <View className={cn("gap-1", className)}>
      <Text
        accessibilityRole="header"
        className="px-4 pt-2 pb-1 text-xs uppercase tracking-wider text-muted-foreground font-medium"
      >
        {t("invitations.title")}
      </Text>
      {invitations.map((inv) => {
        const name = nameOf(inv);
        const inviter = inviterLabel(inv);
        const role = t(`invitations.role.${inv.role}`);
        const detail = inviter
          ? t("invitations.detail", { inviter, role })
          : t("invitations.detail_no_inviter", { role });
        return (
          <View key={inv.id} className="px-4 py-2.5 gap-2">
            <View
              className="flex-row items-center gap-3"
              accessible
              accessibilityLabel={`${t("invitations.a11y", { name })}, ${detail}`}
            >
              <WorkspaceAvatar name={name} avatarUrl={null} size={24} />
              <View className="flex-1">
                <Text className="text-sm font-medium text-foreground" numberOfLines={2}>
                  {name}
                </Text>
                <Text className="text-xs text-muted-foreground" numberOfLines={2}>
                  {detail}
                </Text>
              </View>
            </View>
            <View className="flex-row flex-wrap gap-2 pl-9">
              <Button
                size="sm"
                disabled={busy}
                onPress={() => onAccept(inv)}
                accessibilityLabel={t("invitations.accept_a11y", { name })}
                className="min-h-11"
              >
                <Text>{t("invitations.accept")}</Text>
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onPress={() => onDecline(inv)}
                accessibilityLabel={t("invitations.decline_a11y", { name })}
                className="min-h-11"
              >
                <Text>{t("invitations.decline")}</Text>
              </Button>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Count for the hint dot on the workspace card (More popover). */
export function useOpenInvitationCount(): number {
  const { data } = useQuery(myInvitationsOptions());
  return useMemo(() => openInvitations(data ?? []).length, [data]);
}
