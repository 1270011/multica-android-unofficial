package com.recordingbeats.rbnotify

import org.json.JSONArray
import org.json.JSONObject

/** The fields of an inbox item the service needs (subset of InboxItem). */
data class InboxEntry(
  val id: String,
  val workspaceId: String?,
  val issueId: String?,
  val type: String,
  val severity: String,
  val title: String,
  val body: String?,
  val read: Boolean,
  val archived: Boolean,
  val createdAtMs: Long?,
  val detailsTo: String?,
  val commentId: String?,
  val actorId: String?,
) {
  fun pingItem() = PingRule.Item(type, severity, detailsTo, read, archived)

  companion object {
    fun fromJson(o: JSONObject): InboxEntry? {
      val id = o.optString("id", "")
      if (id.isEmpty()) return null
      val details = o.optJSONObject("details")
      return InboxEntry(
        id = id,
        workspaceId = o.optNullableString("workspace_id"),
        issueId = o.optNullableString("issue_id"),
        type = o.optString("type", ""),
        severity = o.optString("severity", "info"),
        title = o.optString("title", ""),
        body = o.optNullableString("body"),
        read = o.optBoolean("read", false),
        archived = o.optBoolean("archived", false),
        createdAtMs = parseIsoMs(o.optNullableString("created_at")),
        detailsTo = details?.optNullableString("to"),
        commentId = details?.optNullableString("comment_id"),
        actorId = o.optNullableString("actor_id"),
      )
    }

    fun listFromJson(text: String): List<InboxEntry> {
      val arr = try {
        JSONArray(text)
      } catch (_: Exception) {
        return emptyList()
      }
      val out = ArrayList<InboxEntry>(arr.length())
      for (i in 0 until arr.length()) {
        arr.optJSONObject(i)?.let { fromJson(it) }?.let { out.add(it) }
      }
      return out
    }

    /** ISO-8601 UTC ("2026-10-16T08:00:00Z", optional fraction/offset) → epoch ms. */
    fun parseIsoMs(value: String?): Long? {
      // java.time needs API 26; minSdk is 24.
      val m = ISO.matchEntire(value ?: return null) ?: return null
      val g = m.groupValues
      val cal = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC"))
      cal.clear()
      cal.set(g[1].toInt(), g[2].toInt() - 1, g[3].toInt(), g[4].toInt(), g[5].toInt(), g[6].toInt())
      val fraction = g[7].takeIf { it.isNotEmpty() }?.padEnd(3, '0')?.take(3)?.toInt() ?: 0
      var ms = cal.timeInMillis + fraction
      val zone = g[8]
      if (zone.isNotEmpty() && zone != "Z" && zone != "z") {
        val sign = if (zone[0] == '-') -1 else 1
        val hh = zone.substring(1, 3).toInt()
        val mm = zone.takeLast(2).toInt()
        ms -= sign * (hh * 3_600_000L + mm * 60_000L)
      }
      return ms
    }

    private val ISO = Regex(
      """(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|z|[+-]\d{2}:?\d{2})?""",
    )
  }
}

internal fun JSONObject.optNullableString(key: String): String? {
  if (!has(key) || isNull(key)) return null
  val v = opt(key) ?: return null
  return v.toString()
}

/** One WebSocket frame, reduced to what the service reacts to. */
sealed class WsFrame {
  object AuthAck : WsFrame()
  data class AuthError(val message: String) : WsFrame()
  data class InboxNew(val entry: InboxEntry) : WsFrame()
  data class InboxGone(val itemId: String) : WsFrame()
  /** inbox:batch-read / batch-archived: no ids, reconcile against the list. */
  object InboxBatch : WsFrame()
  object Other : WsFrame()

  companion object {
    fun parse(text: String): WsFrame {
      val o = try {
        JSONObject(text)
      } catch (_: Exception) {
        return Other
      }
      if (o.has("error") && !o.has("type")) return AuthError(o.optString("error"))
      val payload = o.optJSONObject("payload")
      return when (o.optString("type")) {
        "auth_ack" -> AuthAck
        "inbox:new" -> payload?.optJSONObject("item")?.let { InboxEntry.fromJson(it) }
          ?.let { InboxNew(it) } ?: Other
        "inbox:read", "inbox:archived" -> payload?.optNullableString("item_id")
          ?.let { InboxGone(it) } ?: Other
        "inbox:batch-read", "inbox:batch-archived" -> InboxBatch
        else -> Other
      }
    }
  }
}
