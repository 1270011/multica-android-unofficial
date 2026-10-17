// @vitest-environment node
/**
 * Chat composer above the keyboard. Under Android
 * edge-to-edge adjustResize does nothing, so React Native's
 * KeyboardAvoidingView without a behavior left the composer behind the
 * keyboard. Layout needs a device; these pin the source to the working
 * pattern: keyboard-controller views, never RN's KeyboardAvoidingView.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

describe("chat keyboard handling", () => {
  it("the chat tab uses keyboard-controller's KeyboardAvoidingView with padding", () => {
    const src = read("app/(app)/[workspace]/(tabs)/chat.tsx");
    expect(src).toMatch(/import \{ KeyboardAvoidingView \} from "react-native-keyboard-controller";/);
    expect(src).toMatch(/<KeyboardAvoidingView behavior="padding"/);
    const rnImport = /import \{([^}]*)\} from "react-native";/.exec(src)?.[1] ?? "";
    expect(rnImport).not.toContain("KeyboardAvoidingView");
  });
  it("comment composers (issue chat, detail) lift with KeyboardStickyView", () => {
    const src = read("components/composer/message-composer.tsx");
    expect(src).toContain('import { KeyboardStickyView } from "react-native-keyboard-controller";');
    expect(read("components/issue/inline-comment-composer.tsx")).not.toContain("manageKeyboard={false}");
  });
  it("the empty chat scrolls instead of spilling over the header when the keyboard shrinks it", () => {
    const src = read("components/chat/chat-empty-state.tsx");
    expect(src).toMatch(/<ScrollView[\s\S]*contentContainerStyle=\{\{ flexGrow: 1 \}\}/);
    expect(src).toContain('keyboardShouldPersistTaps="handled"');
  });
});
