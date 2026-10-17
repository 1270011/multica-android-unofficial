package com.recordingbeats.rbnotify

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Review #14 Fix 2, point 8: notification state survives a process restart. */
class NotifyStateTest {
  @Test
  fun roundTripsIssuesLinesAndSummaryCount() {
    val issue = NotifyIssue(
      "rb", "i-1", "Title", Channels.MENTIONS,
      mutableListOf(NotifyLine("item-1", "Hi", "Ana", 1000L), NotifyLine("item-2", "Again", "Ben", 2000L)),
      "c-1",
    )
    val other = NotifyIssue("rb", "i-2", "T2", Channels.QUIET, mutableListOf(NotifyLine("item-3", "x", "y", 3L)), null)
    val back = NotifyStateCodec.decode(NotifyStateCodec.encode(listOf(issue, other), 4))
    assertEquals(listOf(issue, other), back.issues)
    assertEquals(4, back.catchUpCount)
    assertNull(back.issues[1].commentId)
  }

  @Test
  fun damagedOrEmptyFilesGiveAnEmptyState() {
    for (text in listOf(null, "", "not json", """{"issues":"nope"}""")) {
      val s = NotifyStateCodec.decode(text)
      assertTrue(s.issues.isEmpty())
      assertEquals(0, s.catchUpCount)
    }
  }

  @Test
  fun skipsBrokenRowsAndIssuesWithoutLines() {
    val text = """{"issues":[{"ws":"rb","issue":"","lines":[]},
      {"ws":"rb","issue":"i-1","lines":[]},
      {"ws":"rb","issue":"i-2","lines":[{"item":""},{"item":"ok","text":"t","sender":"s","at":5}]}],
      "catchUp":-3}"""
    val s = NotifyStateCodec.decode(text)
    assertEquals(listOf("i-2"), s.issues.map { it.issueId })
    assertEquals(listOf("ok"), s.issues[0].lines.map { it.itemId })
    assertEquals(0, s.catchUpCount)
  }
}
