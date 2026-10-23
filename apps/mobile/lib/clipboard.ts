/**
 * Drop-in for the parts of `expo-clipboard` the app uses, loaded on first
 * call (lib/lazy-module.ts). The functions are async, so a failed late load
 * rejects like a native error instead of throwing in the caller's handler.
 * Use as `import * as Clipboard from "@/lib/clipboard"`.
 */
import type * as ExpoClipboard from "expo-clipboard";
import { lazyModule } from "./lazy-module";

const load = lazyModule(
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  () => require("expo-clipboard") as typeof ExpoClipboard,
);

export async function getStringAsync(): Promise<string> {
  return load().getStringAsync();
}

export async function setStringAsync(text: string): Promise<boolean> {
  return load().setStringAsync(text);
}
