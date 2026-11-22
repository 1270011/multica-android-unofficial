/**
 * Open a file attachment in the system viewer/browser.
 *
 * `download_url` is the auth-gated `/api/attachments/{id}/download` path on
 * servers without a CloudFront signer (self-hosted proxy/presign storage).
 * The system browser has neither the app's bearer token nor a session
 * cookie, so opening that path directly returns 401 "missing authorization".
 *
 * Instead, ask the authenticated `GET /api/attachments/{id}` endpoint for a
 * fresh credential-free URL (a short-lived capability link or a presigned
 * storage URL) and open that — the exchange the server provides for native
 * downloads on token-auth clients (MUL-5292). If the request fails (other
 * workspace, network), fall back to the URL we already have, which is still
 * correct on CloudFront deployments.
 */
import { Linking } from "react-native";
import { api } from "@/data/api";
import { resolveAttachmentUrl } from "@/lib/attachment-url";
import { logger } from "@/lib/logger";

export async function openAttachment(
  attachmentId: string | null | undefined,
  fallbackUrl: string | null | undefined,
): Promise<void> {
  let target: string | null = null;
  if (attachmentId) {
    try {
      const meta = await api.getAttachmentDownloadUrls(attachmentId);
      target = resolveAttachmentUrl(
        meta.attachment_download_url || meta.download_url,
      );
    } catch (err) {
      logger.warn("[attachment] signed download URL unavailable, using fallback", {
        attachmentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  target ??= resolveAttachmentUrl(fallbackUrl);
  if (!target) return;
  await Linking.openURL(target).catch(() => {
    // Silent: same policy as markdown link presses.
  });
}
