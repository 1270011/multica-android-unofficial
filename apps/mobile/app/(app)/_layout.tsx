import { ActivityIndicator, View } from "react-native";
import { Stack, Redirect } from "expo-router";
import { useAuthStore } from "@/data/auth-store";

/**
 * Auth-required layout. Redirects to /login when no user is loaded.
 *
 * Waits while the session is still being restored: a cold start straight
 * into a deep link (tapping a notification after a reboot) reaches this
 * layout before `user` is loaded, and redirecting then would land on the
 * login although the session is valid. Same rule
 * as app/index.tsx.
 *
 * Workspace membership is enforced one level deeper at [workspace]/_layout —
 * not here — because select-workspace.tsx itself is auth-required but
 * workspace-less.
 */
export default function AppLayout() {
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  if (!user && isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
