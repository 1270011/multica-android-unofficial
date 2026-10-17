package com.recordingbeats.rbnotify

import org.json.JSONArray
import org.json.JSONObject

/** One line of an issue notification (an inbox entry). */
data class NotifyLine(val itemId: String, val text: String, val sender: String, val at: Long)

/** What one issue notification shows; kept on disk across process restarts. */
data class NotifyIssue(
  val workspaceSlug: String,
  val issueId: String,
  var title: String,
  var channel: String,
  val lines: MutableList<NotifyLine>,
  var commentId: String?,
)

/**
 * Notification state on disk (point 8): after a process
 * restart "Mark as read" still knows the issue's entries and a reconcile
 * can remove notifications of entries read elsewhere. The file lives in
 * noBackupFilesDir (no backup) and is deleted on logout. Contains
 * notification texts only, never credentials.
 */
object NotifyStateCodec {
  data class State(val issues: List<NotifyIssue>, val catchUpCount: Int)

  fun encode(issues: Collection<NotifyIssue>, catchUpCount: Int): String {
    val arr = JSONArray()
    for (s in issues) {
      val lines = JSONArray()
      s.lines.forEach {
        lines.put(JSONObject().put("item", it.itemId).put("text", it.text).put("sender", it.sender).put("at", it.at))
      }
      arr.put(
        JSONObject()
          .put("ws", s.workspaceSlug)
          .put("issue", s.issueId)
          .put("title", s.title)
          .put("channel", s.channel)
          .put("comment", s.commentId ?: JSONObject.NULL)
          .put("lines", lines),
      )
    }
    return JSONObject().put("v", 1).put("issues", arr).put("catchUp", catchUpCount).toString()
  }

  /** Tolerant: a damaged file yields an empty state, broken rows are skipped. */
  fun decode(text: String?): State {
    if (text.isNullOrBlank()) return State(emptyList(), 0)
    val o = try {
      JSONObject(text)
    } catch (_: Exception) {
      return State(emptyList(), 0)
    }
    val arr = o.optJSONArray("issues") ?: JSONArray()
    val issues = (0 until arr.length()).mapNotNull { i ->
      val s = arr.optJSONObject(i) ?: return@mapNotNull null
      val issueId = s.optString("issue")
      val ws = s.optString("ws")
      if (issueId.isEmpty() || ws.isEmpty()) return@mapNotNull null
      val la = s.optJSONArray("lines") ?: JSONArray()
      val lines = (0 until la.length()).mapNotNull { j ->
        val l = la.optJSONObject(j) ?: return@mapNotNull null
        val item = l.optString("item")
        if (item.isEmpty()) null else NotifyLine(item, l.optString("text"), l.optString("sender"), l.optLong("at"))
      }.toMutableList()
      if (lines.isEmpty()) return@mapNotNull null
      NotifyIssue(
        ws,
        issueId,
        s.optString("title"),
        s.optString("channel", Channels.QUIET),
        lines,
        if (s.isNull("comment")) null else s.optString("comment").ifEmpty { null },
      )
    }
    return State(issues, o.optInt("catchUp", 0).coerceAtLeast(0))
  }
}
