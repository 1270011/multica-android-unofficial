/**
 * SecureStore persistence for remembered filters (inbox F1, issue lists F2).
 *
 * SecureStore cannot enumerate keys, so every filter key written is also
 * recorded in one index entry. Logout uses the index to remove every stored
 * filter, also for workspaces not loaded in this session — otherwise the
 * next user on the same device would inherit them.
 *
 * All writes run through one promise chain, so the index never loses an
 * entry to two concurrent read-modify-writes, and a logout clear always runs
 * after the writes queued before it.
 */
import * as SecureStore from "expo-secure-store";

export const FILTER_INDEX_KEY = "rb.filter_index";

let chain: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  chain = chain.then(task).catch(() => {
    // Remembering is best effort; the in-memory filter still applies.
  });
  return chain;
}

async function readIndex(): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(FILTER_INDEX_KEY);
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value)
      ? value.filter((k): k is string => typeof k === "string")
      : [];
  } catch {
    return [];
  }
}

/** Store `value` under `key`, or delete the key when `value` is null. */
export function saveFilter(key: string, value: string | null): Promise<void> {
  return enqueue(async () => {
    if (value === null) {
      await SecureStore.deleteItemAsync(key);
      return;
    }
    await SecureStore.setItemAsync(key, value);
    const index = await readIndex();
    if (!index.includes(key)) {
      await SecureStore.setItemAsync(
        FILTER_INDEX_KEY,
        JSON.stringify([...index, key]),
      );
    }
  });
}

/** Remove every remembered filter on this device (logout). */
export function clearAllFilterStorage(): Promise<void> {
  return enqueue(async () => {
    const index = await readIndex();
    await Promise.all(
      index.map((key) => SecureStore.deleteItemAsync(key).catch(() => {})),
    );
    await SecureStore.deleteItemAsync(FILTER_INDEX_KEY);
  });
}
