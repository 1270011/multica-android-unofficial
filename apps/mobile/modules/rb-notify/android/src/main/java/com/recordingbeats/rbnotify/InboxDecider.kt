package com.recordingbeats.rbnotify

/**
 * What to do with one inbox entry the service received (live `inbox:new` or
 * the reconcile after a (re)connect). Pure, unit-tested.
 *
 *  - Already seen (by item id) → nothing, whatever the source.
 *  - Ping rule says no → remember as seen, nothing shown.
 *  - Issue whose chat is open in the foreground → seen, nothing shown (§8.4).
 *  - Reconciled entries older than 24 h → only counted in the summary
 *    (docs/TECHNIK.md §1.3: no flood after a long silence).
 *  - Otherwise → notify in the rule's channel.
 */
object InboxDecider {
  const val CATCH_UP_MAX_AGE_MS = 24L * 60 * 60 * 1000

  sealed class Action {
    object Ignore : Action()
    data class Notify(val channel: String, val category: String) : Action()
    object SummaryOnly : Action()
  }

  fun decide(
    entry: InboxEntry,
    alreadySeen: Boolean,
    settings: PingRule.Settings,
    localMinutes: Int?,
    nowMs: Long,
    fromReconcile: Boolean,
    foregroundIssueId: String?,
  ): Action {
    if (alreadySeen) return Action.Ignore
    val result = PingRule.evaluate(entry.pingItem(), settings, localMinutes)
    if (!result.ping || result.channel == null || result.category == null) return Action.Ignore
    if (entry.issueId != null && entry.issueId == foregroundIssueId) return Action.Ignore
    val created = entry.createdAtMs
    if (fromReconcile && created != null && nowMs - created > CATCH_UP_MAX_AGE_MS) {
      return Action.SummaryOnly
    }
    return Action.Notify(result.channel, result.category)
  }

  /** Higher wins when several reasons land on one issue notification (UX §8.4). */
  fun rank(channel: String): Int = when (channel) {
    Channels.BLOCKED -> 4
    Channels.MENTIONS -> 3
    Channels.APPROVALS -> 2
    Channels.ASSIGNMENTS -> 1
    else -> 0
  }
}
