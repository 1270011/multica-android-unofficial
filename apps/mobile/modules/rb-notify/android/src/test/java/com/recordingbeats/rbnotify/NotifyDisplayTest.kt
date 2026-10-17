package com.recordingbeats.rbnotify

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NotifyDisplayTest {
  private val reco = Workspace("w1", "recordingbeats", "Recordingbeats", true)
  private val test = Workspace("w2", "test", "Test", true)

  private fun issue(slug: String, vararg at: Long) = NotifyIssue(
    slug, "i-$slug-${at.firstOrNull()}", "T", Channels.BLOCKED,
    at.mapIndexed { i, t -> NotifyLine("l$i", "x", "a", t) }.toMutableList(), null,
  )

  @Test
  fun workspaceLabelOnlyWithSeveralEnabled() {
    assertEquals("Test", NotifyDisplay.workspaceLabel(listOf(reco, test), "test"))
    // One switched off: back to a single workspace, no label (§8.4).
    assertNull(NotifyDisplay.workspaceLabel(listOf(reco, test.copy(enabled = false)), "recordingbeats"))
    assertNull(NotifyDisplay.workspaceLabel(listOf(reco), "recordingbeats"))
    assertNull(NotifyDisplay.workspaceLabel(listOf(reco, test), "unknown"))
  }

  @Test
  fun conversationTitleCarriesTheWorkspace() {
    assertEquals("Fix login · Test", NotifyDisplay.conversationTitle("Fix login", "Test"))
    assertEquals("Fix login", NotifyDisplay.conversationTitle("Fix login", null))
  }

  @Test
  fun connectedCountCountsOnlyEnabled() {
    // Report: "Workspaces · 1 of 2" still said "Connected · 2 workspaces".
    assertEquals(1, NotifyDisplay.connectedCount(true, listOf(reco, test.copy(enabled = false))))
    assertEquals(2, NotifyDisplay.connectedCount(true, listOf(reco, test)))
    assertEquals(0, NotifyDisplay.connectedCount(false, listOf(reco, test)))
  }

  @Test
  fun summaryOpensTheWorkspaceOfTheNewestEntry() {
    val issues = listOf(issue("recordingbeats", 100L, 300L), issue("test", 200L))
    assertEquals("recordingbeats", NotifyDisplay.summarySlug(issues, listOf(reco, test)))
    assertEquals("test", NotifyDisplay.summarySlug(listOf(issue("recordingbeats", 100L), issue("test", 500L)), listOf(reco, test)))
    // Catch-up only: first switched-on workspace.
    assertEquals("test", NotifyDisplay.summarySlug(emptyList(), listOf(reco.copy(enabled = false), test)))
    assertNull(NotifyDisplay.summarySlug(emptyList(), emptyList()))
  }

  @Test
  fun summaryCountsOnlyVisibleIssues() {
    // Test report: after tapping the summary and swiping the
    // single notifications away, the next ping still counted all of them.
    val now = 100_000L
    val tracked = mapOf<String, Long?>("a" to 10_000L, "b" to 20_000L, "c" to 30_000L)
    // a and b swiped away, c still shown → forget a and b.
    assertEquals(setOf("a", "b"), NotifyDisplay.goneIssues(tracked, setOf("c"), now))
    // Everything still shown → nothing forgotten.
    assertEquals(emptySet<String>(), NotifyDisplay.goneIssues(tracked, setOf("a", "b", "c"), now))
    // Summary tap cleared the shade → all forgotten, the next ping counts from 0.
    assertEquals(setOf("a", "b", "c"), NotifyDisplay.goneIssues(tracked, emptySet(), now))
  }

  @Test
  fun justPostedIssueIsKeptUntilAndroidListsIt() {
    // Android registers a notification asynchronously; one posted a moment
    // ago may be missing from the active list and must not be dropped.
    val now = 100_000L
    val tracked = mapOf<String, Long?>("new" to now - 1_000L, "old" to now - 60_000L)
    assertEquals(setOf("old"), NotifyDisplay.goneIssues(tracked, emptySet(), now))
    assertEquals(
      setOf("new", "old"),
      NotifyDisplay.goneIssues(tracked, emptySet(), now + NotifyDisplay.VISIBLE_GRACE_MS),
    )
  }

  @Test
  fun restoredIssueWithoutPostCountsOnlyWhileShown() {
    // After a process restart the state comes from disk (no post time):
    // still shown → kept, gone from the shade → forgotten.
    val tracked = mapOf<String, Long?>("r" to null)
    assertEquals(emptySet<String>(), NotifyDisplay.goneIssues(tracked, setOf("r"), 5L))
    assertEquals(setOf("r"), NotifyDisplay.goneIssues(tracked, emptySet(), 5L))
  }

  @Test
  fun catchUpCountEndsWithTheSummary() {
    assertTrue(NotifyDisplay.keepCatchUp(summaryActive = true, summaryPostedAt = null, now = 100_000L))
    // Summary tapped or swiped away → old catch-up entries no longer count.
    assertFalse(NotifyDisplay.keepCatchUp(summaryActive = false, summaryPostedAt = 10_000L, now = 100_000L))
    assertFalse(NotifyDisplay.keepCatchUp(summaryActive = false, summaryPostedAt = null, now = 100_000L))
    // Just posted, not listed yet → kept.
    assertTrue(NotifyDisplay.keepCatchUp(summaryActive = false, summaryPostedAt = 99_000L, now = 100_000L))
  }

  @Test
  fun summaryIsNeverCancelledWhileAChildIsVisible() {
    val plan = NotifyDisplay::summaryPlan
    // R1: one child left and the summary shown → update, never cancel.
    assertEquals(NotifyDisplay.SummaryPlan.POST, plan(1, 0, false, true))
    // One child, no summary yet → nothing (Android shows the child alone).
    assertEquals(NotifyDisplay.SummaryPlan.NONE, plan(1, 0, false, false))
    assertEquals(NotifyDisplay.SummaryPlan.POST, plan(2, 0, false, false))
    // No child left: cancelling is safe now.
    assertEquals(NotifyDisplay.SummaryPlan.CANCEL, plan(0, 0, false, true))
    assertEquals(NotifyDisplay.SummaryPlan.NONE, plan(0, 0, false, false))
    // Catch-up only (older entries counted in the summary).
    assertEquals(NotifyDisplay.SummaryPlan.POST, plan(0, 3, true, false))
  }

  @Test
  fun issueSeenActiveAndThenGoneIsForgottenAtOnce() {
    // R1 follow-up: Android removed a child by itself; the next ping said
    // "2 issues need you" although one notification was visible.
    val now = 100_000L
    val tracked = mapOf<String, Long?>("a" to now - 1_000L, "b" to now - 1_000L)
    // Both inside the grace time; "a" was already seen in the active list.
    assertEquals(setOf("a"), NotifyDisplay.goneIssues(tracked, emptySet(), now, seen = setOf("a")))
    assertEquals(emptySet<String>(), NotifyDisplay.goneIssues(tracked, setOf("a", "b"), now, seen = setOf("a")))
  }

  /**
   * Notification shade with Android's group rule: cancelling the summary
   * cancels every child of the group (REASON_GROUP_SUMMARY_CANCELED).
   */
  private class Shade {
    val children = linkedSetOf<String>()
    var summary = false
    fun post(id: String) { children.add(id) }
    fun swipe(id: String) { children.remove(id) }
    fun postSummary() { summary = true }
    fun cancelSummary() {
      summary = false
      children.clear()
    }
  }

  /** The order Notifier.notifyEntry uses: prune, post the child, then the summary. */
  private fun ping(shade: Shade, tracked: MutableMap<String, Long?>, seen: MutableSet<String>, id: String, now: Long): Int {
    seen.addAll(shade.children.filter { it in tracked })
    NotifyDisplay.goneIssues(tracked, shade.children, now, seen = seen).forEach { tracked.remove(it); seen.remove(it) }
    tracked[id] = now
    seen.remove(id)
    shade.post(id)
    when (NotifyDisplay.summaryPlan(tracked.size, 0, false, shade.summary)) {
      NotifyDisplay.SummaryPlan.POST -> shade.postSummary()
      NotifyDisplay.SummaryPlan.CANCEL -> shade.cancelSummary()
      NotifyDisplay.SummaryPlan.NONE -> Unit
    }
    return tracked.size
  }

  @Test
  fun newPingStaysVisibleAfterAnotherWasSwipedAway() {
    // Release test R1: two pings, swipe one, a new ping to the other issue.
    val shade = Shade()
    val tracked = linkedMapOf<String, Long?>()
    val seen = mutableSetOf<String>()
    ping(shade, tracked, seen, "MUL-88", 10_000L)
    assertEquals(2, ping(shade, tracked, seen, "MUL-126", 20_000L))
    assertTrue(shade.summary)
    // The delayed reconcile after each post sees both in the active list.
    seen.addAll(shade.children.filter { it in tracked })
    shade.swipe("MUL-126")
    // Before the fix the summary was cancelled here and took MUL-88 along.
    assertEquals(1, ping(shade, tracked, seen, "MUL-88", 21_000L))
    assertEquals(setOf("MUL-88"), shade.children)
    // The next ping counts the visible ones only (was "2 issues need you").
    assertEquals(2, ping(shade, tracked, seen, "MUL-126", 22_000L))
    assertEquals(setOf("MUL-88", "MUL-126"), shade.children)
  }

  private val english: (String, String) -> String = { _, fallback -> fallback }

  @Test
  fun summaryTitleNamesCatchUpApart() {
    // Release test R2: "3 issues need you" with two visible notifications;
    // the third was a catch-up entry nobody could see.
    val title = NotifyDisplay.summaryTitle(visible = 2, older = 1, string = english)
    assertEquals("2 issues need you · 1 older", title)
    assertNotEquals("3 issues need you", title)
    assertEquals("1 issue needs you · 2 older", NotifyDisplay.summaryTitle(1, 2, english))
    // Without catch-up the title is unchanged.
    assertEquals("2 issues need you", NotifyDisplay.summaryTitle(2, 0, english))
    assertEquals("1 issue needs you", NotifyDisplay.summaryTitle(1, 0, english))
    // Catch-up only: no visible issue is claimed.
    assertEquals("1 older issue needs you", NotifyDisplay.summaryTitle(0, 1, english))
    assertEquals("3 older issues need you", NotifyDisplay.summaryTitle(0, 3, english))
  }

  @Test
  fun summaryTitleUsesTheLocalizedTemplates() {
    val de = mapOf(
      "summary_title" to "{count} Issues brauchen dich",
      "summary_title_single" to "1 Issue braucht dich",
      "summary_older" to "{count} ältere",
      "summary_older_only" to "{count} ältere Issues brauchen dich",
      "summary_older_only_single" to "1 älteres Issue braucht dich",
    )
    val t: (String, String) -> String = { key, fallback -> de[key] ?: fallback }
    assertEquals("1 Issue braucht dich · 1 ältere", NotifyDisplay.summaryTitle(1, 1, t))
    assertEquals("2 ältere Issues brauchen dich", NotifyDisplay.summaryTitle(0, 2, t))
  }

  @Test
  fun swipedIssueLeavesTheCountAtOnce() {
    // Release test R2: MUL-126 swiped, then a ping to MUL-88 → the summary
    // said "2 issues need you" with one visible notification.
    val shade = Shade()
    val tracked = linkedMapOf<String, Long?>()
    val seen = mutableSetOf<String>()
    val catchUp = 1
    ping(shade, tracked, seen, "MUL-88", 10_000L)
    ping(shade, tracked, seen, "MUL-126", 20_000L)
    assertEquals("2 issues need you · 1 older", NotifyDisplay.summaryTitle(tracked.size, catchUp, english))
    // Swipe: the delete intent carries the post time of the swiped version.
    shade.swipe("MUL-126")
    assertTrue(NotifyDisplay.dismissApplies(tracked["MUL-126"], 20_000L))
    tracked.remove("MUL-126")
    // Before the next ping, and without counting the swiped one.
    assertEquals(shade.children.size, tracked.size)
    val title = NotifyDisplay.summaryTitle(tracked.size, catchUp, english)
    assertEquals("1 issue needs you · 1 older", title)
    assertNotEquals("2 issues need you", title)
    // R1 stays fixed: updating the summary keeps the visible child.
    assertEquals(NotifyDisplay.SummaryPlan.POST, NotifyDisplay.summaryPlan(tracked.size, catchUp, false, shade.summary))
    assertEquals(1, ping(shade, tracked, seen, "MUL-88", 21_000L))
    assertEquals(setOf("MUL-88"), shade.children)
    assertEquals("1 issue needs you · 1 older", NotifyDisplay.summaryTitle(tracked.size, catchUp, english))
  }

  @Test
  fun staleSwipeDoesNotDropAReposted() {
    // The swipe of an older version arrives after the issue was posted again.
    assertFalse(NotifyDisplay.dismissApplies(postedAt = 22_000L, intentStamp = 21_000L))
    assertTrue(NotifyDisplay.dismissApplies(postedAt = 21_000L, intentStamp = 21_000L))
    assertTrue(NotifyDisplay.dismissApplies(postedAt = null, intentStamp = 21_000L))
  }
}
