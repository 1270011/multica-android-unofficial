import { describe, expect, it, vi } from "vitest";
import type { Invitation, Workspace } from "@multica/core/types";
import de from "../locales/de/workspace.json";
import en from "../locales/en/workspace.json";
import zh from "../locales/zh-Hans/workspace.json";
import {
  acceptAndResolve,
  invitationErrorKind,
  inviterLabel,
  joinedWorkspace,
  openInvitations,
  isAlreadyMember,
} from "./invitations";
import { InvitationListSchema } from "@/data/schemas";

vi.mock("@/data/api", () => ({ api: {} }));

const NOW = Date.parse("2026-10-16T04:00:00Z");
const inv = (o: Partial<Invitation>): Invitation => ({
  id: "i1",
  workspace_id: "ws-1",
  inviter_id: "u1",
  invitee_email: "me@example.com",
  invitee_user_id: null,
  role: "member",
  status: "pending",
  created_at: "2026-10-15T00:00:00Z",
  updated_at: "2026-10-15T00:00:00Z",
  expires_at: "2026-10-22T00:00:00Z",
  ...o,
});

describe("openInvitations", () => {
  it("keeps pending, unexpired invitations, newest first", () => {
    const list = openInvitations(
      [
        inv({ id: "old", created_at: "2026-10-10T00:00:00Z" }),
        inv({ id: "new", created_at: "2026-10-16T00:00:00Z" }),
        inv({ id: "expired", expires_at: "2026-10-16T03:59:00Z" }),
        inv({ id: "accepted", status: "accepted" }),
        inv({ id: "declined", status: "declined" }),
      ],
      NOW,
    );
    expect(list.map((i) => i.id)).toEqual(["new", "old"]);
  });

  it("does not drop a row with an unreadable expiry (server already filters)", () => {
    expect(openInvitations([inv({ expires_at: "" })], NOW)).toHaveLength(1);
  });
});

describe("joinedWorkspace / inviterLabel", () => {
  const ws = [{ id: "ws-1", slug: "reco", name: "Reco" }] as Workspace[];
  it("finds the joined workspace once it is in the list", () => {
    expect(joinedWorkspace(ws, { workspace_id: "ws-1" })?.slug).toBe("reco");
    expect(joinedWorkspace(ws, { workspace_id: "ws-2" })).toBeNull();
  });
  it("prefers the inviter name, then e-mail", () => {
    expect(inviterLabel({ inviter_name: " Alice ", inviter_email: "a@x" })).toBe("Alice");
    expect(inviterLabel({ inviter_name: "", inviter_email: "a@x" })).toBe("a@x");
    expect(inviterLabel({})).toBeNull();
  });
});

// Review #27: a successful accept must never be reported as a failure.
describe("acceptAndResolve", () => {
  const ws = [{ id: "ws-1", slug: "reco", name: "Reco" }] as Workspace[];
  it("returns the joined workspace", async () => {
    await expect(acceptAndResolve(inv({}), async () => {}, async () => ws)).resolves.toMatchObject({ slug: "reco" });
  });
  it("returns null (not an error) when only the list read fails", async () => {
    await expect(
      acceptAndResolve(inv({}), async () => {}, async () => {
        throw new Error("offline");
      }),
    ).resolves.toBeNull();
  });
  it("fails when the accept itself fails, without reading the list", async () => {
    let read = false;
    await expect(
      acceptAndResolve(
        inv({}),
        async () => {
          throw Object.assign(new Error("gone"), { status: 410 });
        },
        async () => {
          read = true;
          return ws;
        },
      ),
    ).rejects.toThrow("gone");
    expect(read).toBe(false);
  });
});

describe("acceptAndResolve with 409 already a member (J3a)", () => {
  it("counts as joined and resolves the workspace", async () => {
    const ws = [{ id: "ws-1", slug: "reco", name: "Reco" }] as Workspace[];
    await expect(
      acceptAndResolve(
        inv({}),
        async () => {
          throw Object.assign(new Error("409"), {
            status: 409,
            body: { error: "you are already a member of this workspace" },
          });
        },
        async () => ws,
      ),
    ).resolves.toEqual(ws[0]);
  });
});

describe("invitationErrorKind", () => {
  it("sorts failures by cause", () => {
    expect(invitationErrorKind({ status: 404 })).toBe("gone");
    expect(invitationErrorKind({ status: 410 })).toBe("gone");
    expect(invitationErrorKind({ status: 400 })).toBe("invalid");
    expect(invitationErrorKind({ status: 500 })).toBe("invalid");
    expect(invitationErrorKind(new TypeError("Network request failed"))).toBe("network");
  });
  it("400 \"invitation is not pending\" means no longer available (J3a)", () => {
    expect(invitationErrorKind({ status: 400, body: { error: "invitation is not pending" } })).toBe("gone");
    expect(invitationErrorKind({ status: 400, body: { error: "invalid invitation id" } })).toBe("invalid");
  });
  it("409 \"already a member\" is recognised only with its text", () => {
    expect(isAlreadyMember({ status: 409, body: { error: "you are already a member of this workspace" } })).toBe(true);
    expect(isAlreadyMember({ status: 409, body: { error: "conflict" } })).toBe(false);
    expect(isAlreadyMember({ status: 400, body: { error: "already a member" } })).toBe(false);
  });
});

describe("InvitationListSchema", () => {
  it("parses the server row and drops broken rows instead of the list", () => {
    const parsed = InvitationListSchema.parse([
      { ...inv({}), workspace_name: "Reco", inviter_name: "Alice", extra: 1 },
      { id: "no-workspace" },
      { ...inv({ id: "odd" }), role: "superuser", status: "weird" },
    ]);
    expect(parsed.map((i) => i.id)).toEqual(["i1", "odd"]);
    expect(parsed[0].workspace_name).toBe("Reco");
    // Unknown enum values degrade safely: no elevated role, never "pending".
    expect(parsed[1]).toMatchObject({ role: "member", status: "expired" });
  });
});

describe("invitation strings", () => {
  const KEYS = ["title", "workspace_fallback", "detail", "detail_no_inviter", "a11y", "accept", "decline", "accept_a11y", "decline_a11y", "joined_title", "joined_message", "joined_pending", "switch_now", "later", "decline_title", "decline_message", "failed_gone_title", "failed_gone_message", "failed_invalid_title", "failed_invalid_message", "failed_network_title", "failed_network_message", "pending_count_other"];
  for (const [lang, file] of Object.entries({ de, en, "zh-Hans": zh })) {
    it(`${lang} has every invitation key`, () => {
      const f = (file as unknown as { invitations: Record<string, unknown> & { role: Record<string, string> } }).invitations;
      for (const k of KEYS) expect(f[k], `${lang}:${k}`).toBeTypeOf("string");
      for (const r of ["owner", "admin", "member"]) expect(f.role[r]).toBeTypeOf("string");
    });
  }
});
