/** In-memory KvStore for the timeline cache tests. */
import type { KvStore } from "./core";

export class MemoryKv implements KvStore {
  map = new Map<string, string>();
  getString(key: string) {
    return this.map.get(key);
  }
  set(key: string, value: string) {
    this.map.set(key, value);
  }
  remove(key: string) {
    return this.map.delete(key);
  }
  getAllKeys() {
    return [...this.map.keys()];
  }
  clearAll() {
    this.map.clear();
  }
}
