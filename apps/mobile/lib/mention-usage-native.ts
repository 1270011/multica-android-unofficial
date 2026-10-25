/**
 * Native store of the mention frequency (./mention-usage.ts):
 * a plain MMKV instance `mention-usage`. Not encrypted: it holds only
 * counts per person/agent/squad id, no content. Kept next to the timeline
 * cache outside the backed-up files (Android noBackupFilesDir, iOS caches),
 * so a restored device starts without the old account's history.
 * Imported once by the root layout.
 */
import { Platform } from "react-native";
import { createMMKV } from "react-native-mmkv";
import { Paths } from "expo-file-system";
import { cacheDirectoryFor } from "@/data/timeline-cache/paths";
import { registerMentionUsageStore } from "./mention-usage";

function directory(): string {
  const base = Platform.OS === "android" ? Paths.document.uri : Paths.cache.uri;
  return cacheDirectoryFor(Platform.OS, base).replace(/timeline-cache$/, "mention-usage");
}

try {
  registerMentionUsageStore(createMMKV({ id: "mention-usage", path: directory() }));
} catch {
  // No store: nothing is counted, the @-list stays alphabetical.
}
