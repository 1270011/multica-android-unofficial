import { describe, expect, it } from "vitest";
import {
  webCommentUrl,
  webIssueUrl,
  webProjectUrl,
  webSettingsUrl,
} from "./web-links";

const BASE = "https://multica.example.com/";

describe("web links", () => {
  it("builds issue links from the configured server origin", () => {
    expect(webIssueUrl(BASE, "acme", "MUL-83")).toBe(
      "https://multica.example.com/acme/issue/MUL-83",
    );
  });

  it("returns null when the server is not configured or data is missing", () => {
    expect(webIssueUrl(null, "ws", "X-1")).toBeNull();
    expect(webIssueUrl(BASE, null, "X-1")).toBeNull();
    expect(webIssueUrl(BASE, "ws", undefined)).toBeNull();
  });

  it("anchors comment links to the comment id", () => {
    expect(webCommentUrl(BASE, "ws", "X-1", "c1")).toBe(
      "https://multica.example.com/ws/issue/X-1#comment-c1",
    );
    expect(webCommentUrl(BASE, "ws", "X-1", null)).toBeNull();
  });

  it("builds project and settings links", () => {
    expect(webProjectUrl("https://h", "ws", "p1")).toBe("https://h/ws/projects/p1");
    expect(webSettingsUrl("https://h", "ws", "billing")).toBe(
      "https://h/ws/settings?tab=billing",
    );
  });
});
