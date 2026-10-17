import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect, router, type Href } from "expo-router";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useServerConfigStore } from "@/data/server-config-store";
import { consumeRestoredRoute, openRestoredRoute, restoreTarget } from "@/lib/route-restore";

/**
 * Entry redirect. AuthInitializer (in _layout.tsx) finishes server-config
 * loading, auth + slug hydration before this renders meaningfully — until
 * then, isLoading is true.
 *
 *   no server config   → /server-setup
 *   no user            → /login
 *   user, no slug      → /select-workspace
 *   user, slug         → /[slug]/inbox, or the route that was open when
 *                        Android recreated the activity (lib/route-restore.ts)
 */
export default function Index() {
  // Read once per JS start; the marker is cleared by the read.
  const [restored] = useState(() => consumeRestoredRoute());
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const slug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const serverLoaded = useServerConfigStore((s) => s.isLoaded);
  const server = useServerConfigStore((s) => s.config);

  if (!serverLoaded || isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (!server) return <Redirect href="/server-setup" />;
  if (!user) return <Redirect href="/login" />;
  if (!slug) return <Redirect href="/select-workspace" />;
  const target = restoreTarget(restored, slug);
  if (target) return <RestoreRoute target={target} slug={slug} />;
  return <Redirect href={`/${slug}/inbox`} />;
}

/** Inbox tab, then the restored screen (lib/route-restore.ts). */
function RestoreRoute({ target, slug }: { target: string; slug: string }) {
  useEffect(() => {
    openRestoredRoute(
      { replace: (href) => router.replace(href as Href), push: (href) => router.push(href as Href) },
      target,
      slug,
    );
  }, [target, slug]);
  return <View className="flex-1 bg-background" />;
}
