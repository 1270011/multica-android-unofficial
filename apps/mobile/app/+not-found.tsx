import { useEffect } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useWorkspaceStore } from "@/data/workspace-store";
import { showToast } from "@/lib/toast";
import { UNMATCHED_LINK_TOAST, unmatchedLinkTarget } from "@/lib/unmatched-link";

/** Link without a route → Inbox with "Invalid link" (lib/unmatched-link.ts). */
export default function NotFound() {
  const slug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  useEffect(() => {
    showToast({ key: UNMATCHED_LINK_TOAST });
    router.replace(unmatchedLinkTarget(slug));
  }, [slug]);
  return <View className="flex-1 bg-background" />;
}
