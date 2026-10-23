/**
 * Native backend of the timeline cache: MMKV with AES-256 in
 * noBackupFilesDir, key in expo-secure-store (C4, Keystore AES-GCM,
 * no user authentication — same as the token, T1), random bytes from
 * expo-crypto (SecureRandom). Imported once by the root layout.
 */
import { Platform } from "react-native";
import { createMMKV, type MMKV } from "react-native-mmkv";
import * as SecureStore from "expo-secure-store";
import { getRandomBytes } from "expo-crypto";
import { File, Paths } from "expo-file-system";
import { queryClient } from "@/data/query-client";
import { getServerBaseUrl } from "@/data/server-config-store";
import { cacheDirectoryFor } from "./paths";
import {
  encodeKeyBytes,
  registerTimelineCacheBackend,
  startTimelinePersister,
  type TimelineCacheBackend,
} from "./index";

const STORE_ID = "timeline-cache";
const KEY_NAME = "multica_timeline_cache_key";

function directory(): string {
  const base = Platform.OS === "android" ? Paths.document.uri : Paths.cache.uri;
  return cacheDirectoryFor(Platform.OS, base);
}

const nativeBackend: TimelineCacheBackend = {
  readKey: () => SecureStore.getItemAsync(KEY_NAME),
  writeKey: (key) => SecureStore.setItemAsync(KEY_NAME, key),
  deleteKey: () => SecureStore.deleteItemAsync(KEY_NAME),
  newKey: () => encodeKeyBytes(getRandomBytes(24)),
  openStore: (key) =>
    createMMKV({
      id: STORE_ID,
      path: directory(),
      encryptionKey: key,
      encryptionType: "AES-256",
    }),
  rekeyStore: (store, key) => (store as MMKV).encrypt(key, "AES-256"),
  serverOrigin: getServerBaseUrl,
  deleteFiles: () => {
    const dir = directory();
    for (const name of [STORE_ID, `${STORE_ID}.crc`]) {
      const file = new File(`file://${dir}/${name}`);
      if (file.exists) file.delete();
    }
  },
};

registerTimelineCacheBackend(nativeBackend);
startTimelinePersister(queryClient);
