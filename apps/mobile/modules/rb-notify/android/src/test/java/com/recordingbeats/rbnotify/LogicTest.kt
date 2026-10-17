package com.recordingbeats.rbnotify

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BackoffTest {
  @Test
  fun growsAndCaps() {
    assertEquals(500L, Backoff.delayMs(0, 0.0))
    assertEquals(1000L, Backoff.delayMs(0, 1.0))
    assertEquals(4000L, Backoff.delayMs(2, 0.0) * 2)
    assertEquals(Backoff.CAP_MS, Backoff.delayMs(30, 1.0))
    assertTrue(Backoff.delayMs(30, 0.0) >= Backoff.CAP_MS / 2)
  }
}

class SeenIdsTest {
  @Test
  fun dedupesAndCaps() {
    val s = SeenIds(3)
    assertTrue(s.add("a"))
    assertFalse(s.add("a"))
    s.add("b"); s.add("c"); s.add("d")
    assertEquals(3, s.size())
    assertFalse(s.contains("a"))
    val round = SeenIds.parse(s.serialize(), 3)
    assertTrue(round.contains("d"))
    assertEquals(3, round.size())
  }
}

class PingRuleTest {
  @Test
  fun parsesTimes() {
    assertEquals(22 * 60, PingRule.parseHhMm("22:00"))
    assertNull(PingRule.parseHhMm("24:00"))
    assertNull(PingRule.parseHhMm("x"))
    assertNull(PingRule.parseHhMm(null))
  }
}

class InboxDeciderTest {
  private val now = 1_800_000_000_000L
  private fun entry(type: String = "mentioned", ageMs: Long = 0, issue: String = "i1") = InboxEntry(
    id = "e", workspaceId = "w", issueId = issue, type = type, severity = "info", title = "T",
    body = null, read = false, archived = false, createdAtMs = now - ageMs, detailsTo = null,
    commentId = null, actorId = null,
  )

  private fun decide(e: InboxEntry, seen: Boolean = false, reconcile: Boolean = false, fg: String? = null) =
    InboxDecider.decide(e, seen, PingRule.Settings(), 600, now, reconcile, fg)

  @Test
  fun notifiesNewPingableEntry() {
    assertEquals(InboxDecider.Action.Notify(Channels.MENTIONS, PingRule.MENTIONS), decide(entry()))
  }

  @Test
  fun ignoresSeenAndNonPing() {
    assertEquals(InboxDecider.Action.Ignore, decide(entry(), seen = true))
    assertEquals(InboxDecider.Action.Ignore, decide(entry(type = "new_comment")))
  }

  @Test
  fun foregroundChatSuppresses() {
    assertEquals(InboxDecider.Action.Ignore, decide(entry(), fg = "i1"))
    assertTrue(decide(entry(), fg = "other") is InboxDecider.Action.Notify)
  }

  @Test
  fun oldCatchUpGoesToSummaryOnly() {
    val old = entry(ageMs = InboxDecider.CATCH_UP_MAX_AGE_MS + 1)
    assertEquals(InboxDecider.Action.SummaryOnly, decide(old, reconcile = true))
    // Live events are shown whatever their timestamp says.
    assertTrue(decide(old, reconcile = false) is InboxDecider.Action.Notify)
  }

  @Test
  fun ranksChannels() {
    assertTrue(InboxDecider.rank(Channels.BLOCKED) > InboxDecider.rank(Channels.MENTIONS))
    assertTrue(InboxDecider.rank(Channels.MENTIONS) > InboxDecider.rank(Channels.APPROVALS))
    assertTrue(InboxDecider.rank(Channels.APPROVALS) > InboxDecider.rank(Channels.ASSIGNMENTS))
  }
}

class WsFrameTest {
  @Test
  fun parsesFrames() {
    assertEquals(WsFrame.AuthAck, WsFrame.parse("""{"type":"auth_ack"}"""))
    assertEquals(WsFrame.AuthError("invalid token"), WsFrame.parse("""{"error":"invalid token"}"""))
    val n = WsFrame.parse(
      """{"type":"inbox:new","payload":{"item":{"id":"x","type":"status_changed","severity":"info",
      "issue_id":"i","title":"T","body":null,"read":false,"archived":false,
      "created_at":"2026-10-16T08:00:00Z","details":{"from":"todo","to":"blocked","comment_id":"c"}}}}""",
    )
    assertTrue(n is WsFrame.InboxNew)
    val e = (n as WsFrame.InboxNew).entry
    assertEquals("blocked", e.detailsTo)
    assertEquals("c", e.commentId)
    assertNull(e.body)
    assertEquals(WsFrame.InboxGone("x"), WsFrame.parse("""{"type":"inbox:read","payload":{"item_id":"x"}}"""))
    assertEquals(WsFrame.InboxBatch, WsFrame.parse("""{"type":"inbox:batch-archived","payload":{"count":3}}"""))
    assertEquals(WsFrame.Other, WsFrame.parse("""{"type":"issue:updated","payload":{}}"""))
    assertEquals(WsFrame.Other, WsFrame.parse("not json"))
  }

  @Test
  fun parsesIsoTimestamps() {
    assertEquals(0L, InboxEntry.parseIsoMs("1970-01-01T00:00:00Z"))
    assertEquals(1500L, InboxEntry.parseIsoMs("1970-01-01T00:00:01.5Z"))
    assertEquals(-3_600_000L, InboxEntry.parseIsoMs("1970-01-01T00:00:00+01:00"))
    assertNull(InboxEntry.parseIsoMs("yesterday"))
  }

  @Test
  fun numericDetailValuesBecomeStrings() {
    val e = InboxEntry.listFromJson("""[{"id":"a","type":"children_done","details":{"total":1}}]""")
    assertEquals(1, e.size)
    assertNull(e[0].detailsTo)
  }
}

class CredentialsJsonTest {
  @Test
  fun roundTripsAndChecksHost() {
    val c = Credentials("https://multica.example:8443", "tok", "id.access", "sec")
    val back = Credentials.fromJson(c.toJson())
    assertEquals(c, back)
    assertEquals("multica.example", c.host())
    assertNull(Credentials.fromJson("""{"baseUrl":"","token":"x"}"""))
  }
}
