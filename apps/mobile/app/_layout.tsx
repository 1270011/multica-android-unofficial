import "../global.css";

import { useEffect, useRef } from "react";
import { AppState, View, type AppStateStatus } from "react-native";
import { Stack, router, useGlobalSearchParams, usePathname, type Href } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@react-navigation/native";
import { PortalHost } from "@rn-primitives/portal";
import { api } from "@/data/api";
import { maybeRenewSession } from "@/data/session-renewal";
import { queryClient } from "@/data/query-client";
// Registers the encrypted timeline cache and its persister.
import "@/data/timeline-cache/native";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useServerConfigStore } from "@/data/server-config-store";
import { SessionActivityBoundary } from "@/components/auth/session-activity-boundary";
import { ActionSheetHost } from "@/components/ui/action-sheet-host";
import { ConnectivityBanner } from "@/components/ui/connectivity-banner";
import { ToastHost } from "@/components/ui/toast-host";
import { startNetworkMonitor } from "@/lib/network-status";
import { consumeRestoredRoute, openRestoredRoute, rememberRoute, restorablePath } from "@/lib/route-restore";
import { LightboxProvider, prewarmHighlighter } from "@/lib/markdown";
import { NAV_THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { MobileI18nProvider } from "@/lib/i18n";
import { perfMark } from "@/lib/perf-mark";

// Kick off Shiki highlighter init at module load — fires once per process,
// finishes before the user navigates to any screen with a code block. If
// init fails (engine unavailable) the highlighter falls back to plain
// text; nothing here is allowed to throw.
prewarmHighlighter();

function AuthInitializer({ children }: { children: React.ReactNode }) {
  const initialize = useAuthStore((s) => s.initialize);
  // Idempotent guard: 401 on multiple in-flight requests would otherwise
  // logout/navigate repeatedly during the same session-expire moment.
  const signingOutRef = useRef(false);

  useEffect(() => {
    // Wire 401 handling onto the shared ApiClient singleton. Must be set
    // before any request fires — initialize() below kicks off the first
    // getMe() call, so do this synchronously first.
    api.setOptions({
      onUnauthorized: () => {
        if (signingOutRef.current) return;
        signingOutRef.current = true;
        void (async () => {
          await useAuthStore.getState().logout();
          await useWorkspaceStore.getState().clear();
          // logout() also clears the query cache (data/session-end.ts).
          router.replace("/login");
          // Reset on next tick so a fresh session can hit 401 again later
          // without being silently swallowed.
          setTimeout(() => {
            signingOutRef.current = false;
          }, 0);
        })();
      },
    });
    // Launch check for the sliding session (MUL-7436). Runs after the token
    // is restored and the identity probe has settled, so it never races the
    // first getMe(); a no-op when there is no session to extend.
    //
    // The server connection (base URL, Cloudflare Access token) is read
    // from SecureStore first: the identity probe needs it to build its URL.
    void useServerConfigStore
      .getState()
      .load()
      .then(() => initialize())
      .then(() => maybeRenewSession());
  }, [initialize]);

  // Foreground transitions are one of the two "someone is using this" signals;
  // SessionActivityBoundary below supplies the other, so an app that stays
  // foregrounded for longer than the check interval still renews. Deliberately
  // not a timer: a backgrounded or untouched app must not keep the session of
  // someone who stopped using it alive.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (status: AppStateStatus) => {
      if (status === "active") maybeRenewSession();
    });
    return () => sub.remove();
  }, []);

  return <>{children}</>;
}

export default function RootLayout() {
  perfMark("render:root");
  const { colorScheme, isDarkColorScheme } = useColorScheme();
  // NetInfo → offline banner / refresh guard.
  useEffect(() => startNetworkMonitor(), []);
  // Keep the current route on disk so an Activity recreation (font-size
  // change) can come back to it — see lib/route-restore.ts.
  const pathname = usePathname();
  // Segment queries such as `?tab=wakeups` come back too.
  const { tab } = useGlobalSearchParams<{ tab?: string }>();
  useEffect(() => rememberRoute(restorablePath(pathname, { tab })), [pathname, tab]);
  // Bridgeless RN keeps the JS context alive across the recreation and only
  // restarts the surface: the React tree remounts on the initial route but
  // app/index.tsx is not revisited, so the marker is consumed here when the
  // session is already hydrated. A real cold start (user not loaded yet)
  // leaves it to index.tsx.
  useEffect(() => {
    const user = useAuthStore.getState().user;
    const slug = useWorkspaceStore.getState().currentWorkspaceSlug;
    if (!user || !slug) return;
    const restored = consumeRestoredRoute();
    // Inbox tab first, then the restored screen on top (lib/route-restore):
    // Back goes to the tab, not out of the app.
    const timer = setTimeout(
      () =>
        openRestoredRoute(
          {
            replace: (href) => router.replace(href as Href),
            push: (href) => router.push(href as Href),
          },
          restored,
          slug,
        ),
      120,
    );
    return () => clearTimeout(timer);
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <MobileI18nProvider>
        <SafeAreaProvider>
          <KeyboardProvider>
            <QueryClientProvider client={queryClient}>
              <ThemeProvider value={NAV_THEME[colorScheme]}>
                <AuthInitializer>
                  <SessionActivityBoundary>
                    <LightboxProvider>
                      <StatusBar style={isDarkColorScheme ? "light" : "dark"} />
                      <View style={{ flex: 1 }}>
                        {/* The nested SafeAreaProvider measures the area
                            above the offline bar, so tab bars and composers
                            sit flush on it instead of insetting twice; the
                            bar itself owns the bottom inset while visible.
                            Bottom, not top: native stack headers pad for the
                            status bar on their own and would leave a gap
                            under a top bar. */}
                        <SafeAreaProvider style={{ flex: 1 }}>
                          <Stack screenOptions={{ headerShown: false }}>
                            <Stack.Screen name="index" />
                            <Stack.Screen name="(auth)" />
                            <Stack.Screen name="(app)" />
                          </Stack>
                        </SafeAreaProvider>
                        <ConnectivityBanner />
                      </View>
                      <PortalHost />
                      {/* Android bottom sheet for showActionSheet(); renders nothing on iOS. */}
                      <ActionSheetHost />
                      <ToastHost />
                    </LightboxProvider>
                  </SessionActivityBoundary>
                </AuthInitializer>
              </ThemeProvider>
            </QueryClientProvider>
          </KeyboardProvider>
        </SafeAreaProvider>
      </MobileI18nProvider>
    </GestureHandlerRootView>
  );
}
