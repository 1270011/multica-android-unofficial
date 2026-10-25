/**
 * Link handling shared by `Markdown` and the table full view.
 * Moved out of markdown.tsx unchanged.
 */
import { useCallback } from "react";
import { Linking } from "react-native";
import { router } from "expo-router";
import { useWorkspaceStore } from "@/data/workspace-store";

export function useMarkdownLinkPress(): (e: { url: string }) => void {
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  return useCallback(
    ({ url }: { url: string }) => {
      // `mention://` is an internal scheme — never hand it to the system.
      // No app is registered for it, so `Linking.openURL("mention://...")`
      // would surface iOS's "Cannot open URL" prompt or silently fail
      // (depending on iOS version). Handle every shape inline and ALWAYS
      // return without falling through to Linking.
      //
      //   mention://issue/<uuid>   → navigate to that issue detail
      //   mention://project/<uuid> → navigate to that project detail
      //   mention://member/<uuid>  → no-op (no member profile screen yet)
      //   mention://agent/<uuid>   → no-op (no agent profile screen yet)
      //   mention://squad/<uuid>   → no-op (no squad profile screen yet)
      //   mention://all/all        → no-op (semantic only — "everyone")
      //   anything malformed       → no-op
      if (url.startsWith("mention://")) {
        const rest = url.slice("mention://".length);
        const slash = rest.indexOf("/");
        if (slash < 0) return;
        const type = rest.slice(0, slash);
        const id = rest.slice(slash + 1);
        if (id && wsSlug) {
          // Route segments are singular on mobile (`/issue/`, `/project/`)
          // while the mention type and web's route are the same word — keep
          // the mapping explicit so a new type can't silently no-op.
          if (type === "issue") router.push(`/${wsSlug}/issue/${id}`);
          else if (type === "project") router.push(`/${wsSlug}/project/${id}`);
        }
        return;
      }
      // Everything else — http(s), mailto, tel, app-scheme deep links —
      // hand off to the system. Linking.openURL throws if no app handles
      // the URL; the catch keeps a stray tap from crashing the screen.
      Linking.openURL(url).catch(() => {
        // Silent: failing loudly is worse than a no-op tap.
      });
    },
    [wsSlug],
  );
}
