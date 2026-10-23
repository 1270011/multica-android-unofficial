package com.recordingbeats.rbnotify

/**
 * Pure display rules for several workspaces (test report with two workspaces). JVM-tested in
 * NotifyDisplayTest; Notifier and the service only apply them.
 */
object NotifyDisplay {
  /**
   * Headline of an assignment:
   * "Dir zugewiesen: MUL-12 Title", without key "Dir zugewiesen: Title".
   * [template] carries `{title}`; the key goes in front of the title.
   */
  fun assignedTitle(template: String, key: String?, title: String): String {
    val full = if (key.isNullOrBlank()) title else "${key.trim()} $title"
    return template.replace("{title}", full).trim()
  }

  /** Line of an assignment: "<Name> hat dir das Issue zugewiesen." or the unknown-name text. */
  fun assignedLine(withName: String, unknown: String, name: String?): String =
    if (name.isNullOrBlank()) unknown else withName.replace("{name}", name.trim())

  /**
   * Workspace name to show with an issue notification: only when more than
   * one workspace is switched on, else null.
   */
  fun workspaceLabel(workspaces: List<Workspace>, slug: String): String? {
    val enabled = workspaces.filter { it.enabled }
    if (enabled.size <= 1) return null
    return workspaces.firstOrNull { it.slug == slug }?.name?.takeIf { it.isNotBlank() }
  }

  /**
   * Conversation title of the MessagingStyle notification. Android does not
   * show `subText` for messaging notifications (seen on API 36), so with
   * several workspaces the name also goes into the title: "Title · Workspace".
   */
  fun conversationTitle(issueTitle: String, workspaceLabel: String?): String =
    if (workspaceLabel.isNullOrEmpty()) issueTitle else "$issueTitle · $workspaceLabel"

  /**
   * Title Android shows for an issue notification: with MessagingStyle the
   * conversation title replaces the content title. An assignment
   * shows its headline ("Dir zugewiesen: MUL-12 Title"), every other
   * category keeps the issue title.
   */
  fun visibleTitle(category: String?, headline: String, issueTitle: String, workspaceLabel: String?): String =
    conversationTitle(if (category == PingRule.ASSIGNMENTS) headline else issueTitle, workspaceLabel)

  /**
   * Lines an issue notification shows:
   * an assignment shows only its own event, not earlier assignments (or
   * comments) of the same issue as a history; every other category keeps
   * the MessagingStyle history. The state keeps all lines, so "Mark as
   * read" still covers every entry. [currentItemId] is the entry just
   * notified; when it is not among the lines the newest line stands.
   */
  fun visibleLines(category: String?, lines: List<NotifyLine>, currentItemId: String?): List<NotifyLine> {
    if (category != PingRule.ASSIGNMENTS) return lines
    val current = lines.lastOrNull { it.itemId == currentItemId } ?: lines.lastOrNull()
    return listOfNotNull(current)
  }

  /** "Connected · n workspaces" counts only switched-on workspaces. */
  fun connectedCount(socketConnected: Boolean, workspaces: List<Workspace>): Int =
    if (socketConnected) workspaces.count { it.enabled } else 0

  /**
   * Workspace the summary notification opens: the one of the newest entry.
   * Without per-issue entries (catch-up only) the first
   * switched-on workspace; null = no workspace known (launch the app).
   */
  fun summarySlug(issues: Collection<NotifyIssue>, workspaces: List<Workspace>): String? {
    val newest = issues.maxByOrNull { issue -> issue.lines.maxOfOrNull { it.at } ?: Long.MIN_VALUE }
    return newest?.workspaceSlug ?: workspaces.firstOrNull { it.enabled }?.slug
  }

  /**
   * The summary counts only issue notifications that are still on screen
   *After a tap on the summary or
   * swiping single notifications away, the next ping must not count them.
   *
   * Returns the tracked issue ids to forget: not among the shown
   * notification tags (`activeTags`) and either already seen in the active
   * list since their last post (`seen`, so a removal by the system counts at
   * once) or not posted within [graceMs]. Android registers a posted
   * notification asynchronously, so one posted a moment ago and never seen
   * may be missing from the active list yet. `postedAt` is null for issues
   * restored from disk without a post in this process.
   */
  fun goneIssues(
    postedAt: Map<String, Long?>,
    activeTags: Set<String>,
    now: Long,
    graceMs: Long = VISIBLE_GRACE_MS,
    seen: Set<String> = emptySet(),
  ): Set<String> =
    postedAt.filter { (id, at) ->
      id !in activeTags && (id in seen || at == null || now - at > graceMs)
    }.keys

  /** What to do with the group summary after a change (release test). */
  enum class SummaryPlan { POST, CANCEL, NONE }

  /**
   * Cancelling a group summary makes Android cancel every child of the group
   * too (REASON_GROUP_SUMMARY_CANCELED): the ping posted a moment before was
   * gone after 7 ms (release test R1). So the summary is cancelled only when
   * no child is visible. With one child left a summary that is already shown
   * is updated instead; a new one is only posted from two children on, or
   * for the catch-up count when [force] is set.
   */
  fun summaryPlan(visibleChildren: Int, catchUp: Int, force: Boolean, summaryShown: Boolean): SummaryPlan = when {
    visibleChildren >= 2 -> SummaryPlan.POST
    force && catchUp > 0 -> SummaryPlan.POST
    visibleChildren == 1 -> if (summaryShown) SummaryPlan.POST else SummaryPlan.NONE
    summaryShown -> SummaryPlan.CANCEL
    else -> SummaryPlan.NONE
  }

  /**
   * Whether the catch-up count (older entries counted only in the summary)
   * still stands: only while the summary is shown or was just posted.
   */
  fun keepCatchUp(summaryActive: Boolean, summaryPostedAt: Long?, now: Long, graceMs: Long = VISIBLE_GRACE_MS): Boolean =
    summaryActive || (summaryPostedAt != null && now - summaryPostedAt <= graceMs)

  /**
   * Summary title: the main number counts only
   * issue notifications on screen; catch-up entries (older than 24 h, no
   * notification of their own) are named apart, e.g. "1 issue needs you ·
   * 1 older". [string] returns the localized template ({count}) or fallback.
   */
  fun summaryTitle(visible: Int, older: Int, string: (key: String, fallback: String) -> String): String {
    fun fill(key: String, fallback: String, n: Int) = string(key, fallback).replace("{count}", n.toString())
    val main = when {
      visible == 1 -> fill("summary_title_single", "1 issue needs you", 1)
      visible > 1 -> fill("summary_title", "{count} issues need you", visible)
      older == 1 -> return fill("summary_older_only_single", "1 older issue needs you", 1)
      else -> return fill("summary_older_only", "{count} older issues need you", older)
    }
    return if (older > 0) "$main · ${fill("summary_older", "{count} older", older)}" else main
  }

  /**
   * A swipe reaches the app through the delete intent stamped with the post
   * time (the swiped issue leaves the count at once). It is stale when
   * the issue was posted again after that stamp; null = no longer tracked.
   */
  fun dismissApplies(postedAt: Long?, intentStamp: Long): Boolean =
    postedAt == null || postedAt <= intentStamp

  const val VISIBLE_GRACE_MS = 5_000L
}
