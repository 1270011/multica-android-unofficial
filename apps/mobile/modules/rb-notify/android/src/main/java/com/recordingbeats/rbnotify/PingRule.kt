package com.recordingbeats.rbnotify

/**
 * Ping rule. Pure function of the
 * inbox entry, the device settings and the local time; the binding test
 * vectors live in docs/technik/ping-rule-vectors.json and run in
 * PingRuleVectorsTest.
 */
object PingRule {
  const val BLOCKED = "blocked"
  const val MENTIONS = "mentions"
  const val APPROVALS = "approvals"
  const val FAILED_RUNS = "failed_runs"
  const val ASSIGNMENTS = "assignments"

  val CATEGORIES = listOf(BLOCKED, MENTIONS, APPROVALS, FAILED_RUNS, ASSIGNMENTS)

  data class Item(
    val type: String,
    val severity: String,
    val detailsTo: String?,
    val read: Boolean,
    val archived: Boolean,
  )

  data class Settings(
    val enabled: Boolean = true,
    val disabledCategories: Set<String> = emptySet(),
    /** Minutes after midnight; both null = no quiet hours. */
    val quietStart: Int? = null,
    val quietEnd: Int? = null,
  )

  data class Result(val ping: Boolean, val category: String?, val channel: String?) {
    companion object {
      val NONE = Result(false, null, null)
    }
  }

  fun categoryOf(type: String, detailsTo: String?): String? = when (type) {
    "mentioned" -> MENTIONS
    "task_failed" -> FAILED_RUNS
    "issue_assigned" -> ASSIGNMENTS
    "agent_blocked" -> BLOCKED
    "review_requested" -> APPROVALS
    "status_changed" -> when (detailsTo) {
      "blocked" -> BLOCKED
      "in_review" -> APPROVALS
      else -> null
    }
    else -> null
  }

  fun channelOf(category: String): String = when (category) {
    BLOCKED, FAILED_RUNS -> Channels.BLOCKED
    MENTIONS -> Channels.MENTIONS
    APPROVALS -> Channels.APPROVALS
    ASSIGNMENTS -> Channels.ASSIGNMENTS
    else -> Channels.BLOCKED
  }

  /** Start inclusive, end exclusive, may wrap past midnight. */
  fun inQuietHours(start: Int?, end: Int?, now: Int?): Boolean {
    if (start == null || end == null || now == null) return false
    return if (start <= end) now >= start && now < end else now >= start || now < end
  }

  fun evaluate(item: Item, settings: Settings, localMinutes: Int?): Result {
    if (item.read || item.archived) return Result.NONE
    if (!settings.enabled) return Result.NONE
    val category = categoryOf(item.type, item.detailsTo) ?: return Result.NONE
    if (category in settings.disabledCategories) return Result.NONE
    val channel = if (inQuietHours(settings.quietStart, settings.quietEnd, localMinutes)) {
      Channels.QUIET
    } else {
      channelOf(category)
    }
    return Result(true, category, channel)
  }

  /** "HH:MM" → minutes after midnight, null when malformed. */
  fun parseHhMm(value: String?): Int? {
    if (value == null) return null
    val parts = value.split(":")
    if (parts.size != 2) return null
    val h = parts[0].toIntOrNull() ?: return null
    val m = parts[1].toIntOrNull() ?: return null
    if (h !in 0..23 || m !in 0..59) return null
    return h * 60 + m
  }
}

/** Channel ids. Changing an id orphans the user's channel settings. */
object Channels {
  const val BLOCKED = "operator_blocked"
  const val MENTIONS = "operator_mentions"
  const val APPROVALS = "operator_approvals"
  const val ASSIGNMENTS = "operator_assignments"
  const val QUIET = "operator_quiet"
  const val CONNECTION = "operator_connection"
}
