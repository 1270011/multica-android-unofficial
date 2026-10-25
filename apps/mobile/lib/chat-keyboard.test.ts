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
import { chatKeyboardInset } from "./chat-keyboard";

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

describe("chat keyboard handling", () => {
  it("the chat tab uses keyboard-controller's KeyboardAvoidingView with padding", () => {
    const src = read("components/chat/chat-screen.tsx");
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
  it.each([
    "app/(app)/[workspace]/new-issue.tsx",
    "app/(app)/[workspace]/issue/[id]/edit.tsx",
  ])("%s lifts the @-suggestion bar above the keyboard", (path) => {
    const src = read(path);
    expect(src).toContain("<MentionSuggestionBar");
    expect(src).toMatch(/import \{ KeyboardAvoidingView \} from "react-native-keyboard-controller";/);
    expect(src).toMatch(/<KeyboardAvoidingView behavior="padding"/);
    const rnImport = /import \{([^}]*)\} from "react-native";/.exec(src)?.[1] ?? "";
    expect(rnImport).not.toContain("KeyboardAvoidingView");
  });
  it("the empty chat scrolls instead of spilling over the header when the keyboard shrinks it", () => {
    const src = read("components/chat/chat-empty-state.tsx");
    expect(src).toMatch(/<ScrollView[\s\S]*contentContainerStyle=\{\{ flexGrow: 1 \}\}/);
    expect(src).toContain('keyboardShouldPersistTaps="handled"');
  });
});

describe("chatKeyboardInset", () => {
  it("is the keyboard minus the safe-area inset the sticky composer keeps", () => {
    expect(chatKeyboardInset(true, 900, 48)).toBe(852);
  });
  it("is 0 while the keyboard is hidden or has no height yet", () => {
    expect(chatKeyboardInset(false, 900, 48)).toBe(0);
    expect(chatKeyboardInset(true, 0, 48)).toBe(0);
  });
  it("never goes negative", () => {
    expect(chatKeyboardInset(true, 30, 48)).toBe(0);
  });
  it("the issue chat list makes room for the keyboard", () => {
    const src = read("components/issue-chat/issue-chat-list.tsx");
    expect(src).toMatch(/useKeyboardState/);
    expect(src).toMatch(/paddingBottom: keyboardInset/);
  });
});
