/**
 * Loads a module on first use instead of at bundle start.
 *
 * Expo Router evaluates every route file at startup, and Expo modules call
 * `requireNativeModule` as soon as their JS entry is evaluated. Modules that
 * are only needed inside a tap handler (haptics, clipboard) therefore cost
 * JNI work on the JS thread during the cold start. Wrapping the `require` in
 * a loader defers that until the first call; Metro only runs a module's
 * factory when `require` is actually called.
 */
export function lazyModule<T>(load: () => T): () => T {
  let mod: T | undefined;
  let loaded = false;
  return () => {
    if (!loaded) {
      mod = load();
      loaded = true;
    }
    return mod as T;
  };
}
