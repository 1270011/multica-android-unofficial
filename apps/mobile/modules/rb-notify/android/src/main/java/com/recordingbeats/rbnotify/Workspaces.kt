package com.recordingbeats.rbnotify

/** A workspace of the account as handed over by JS (id, slug, switch). */
data class Workspace(val id: String, val slug: String, val name: String, val enabled: Boolean)

/**
 * One WebSocket for all workspaces:
 * the server sends `inbox:*` to every connection of the user, whatever
 * workspace it was opened with. Entries are therefore matched to their
 * workspace by `item.workspace_id`, never by the connection.
 */
object WorkspaceRouting {
  /** The enabled workspace an entry belongs to; null drops the entry. */
  fun forEntry(workspaceId: String?, workspaces: List<Workspace>): Workspace? {
    if (workspaceId.isNullOrEmpty()) return null
    return workspaces.firstOrNull { it.enabled && it.id == workspaceId }
  }

  /**
   * Workspace to open the socket with: any workspace of the account works,
   * enabled ones first. `lost` holds slugs the server refused ("not a
   * member"), so a lost membership moves the socket to another workspace.
   */
  fun connectVia(workspaces: List<Workspace>, lost: Set<String> = emptySet()): Workspace? =
    workspaces.firstOrNull { it.enabled && it.slug !in lost }
      ?: workspaces.firstOrNull { it.slug !in lost }
}

/** How a failed WebSocket auth is handled. */
enum class AuthFailure {
  /** The server rejected the token: delete the session copy. */
  Rejected,
  /** Not a member of the workspace the socket was opened with. */
  WorkspaceLost,
  /**
   * HTTP 403 on the upgrade. The server only answers 403 for cookie auth,
   * which the service does not use, so it comes from Cloudflare Access
   * (e.g. an expired service token): reconnect with backoff and tell the
   * user, never drop workspaces or the session.
   */
  Refused,
  /** Network, timeout, protocol: reconnect with backoff, keep the session. */
  Transient;

  companion object {
    /** `{"error": …}` text frames of server/internal/realtime/hub.go. */
    fun fromMessage(message: String): AuthFailure = when {
      message == "invalid token" || message == "invalid claims" || message == "account disabled" -> Rejected
      message.contains("not a member") -> WorkspaceLost
      else -> Transient
    }

    /** HTTP status of a refused upgrade; null = no response (network). */
    fun fromHttp(code: Int?): AuthFailure = when (code) {
      401 -> Rejected
      // 403 or a redirect (we never follow one): Cloudflare Access, e.g.
      // an expired service token sent to the Access login page.
      403, in 300..399 -> Refused
      404 -> WorkspaceLost // "workspace not found"
      else -> Transient
    }
  }
}
