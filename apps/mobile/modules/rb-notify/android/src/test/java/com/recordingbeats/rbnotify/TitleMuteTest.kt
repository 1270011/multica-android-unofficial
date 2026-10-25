package com.recordingbeats.rbnotify

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TitleMuteTest {
  private val auto = TitleMuteConfig("^AUTO: ", ignoreCase = false)

  private fun matcher() = TitleMute.Matcher()

  @Test
  fun mutesOnlyMatchingTitles() {
    val m = matcher()
    assertTrue(TitleMute.shouldMute(auto, "AUTO: W7", null, m))
    assertFalse(TitleMute.shouldMute(auto, "W7", null, m))
    assertFalse(TitleMute.shouldMute(auto, "auto: lower case", null, m))
  }

  @Test
  fun noConfigNeverMutes() {
    assertFalse(TitleMute.shouldMute(null, "AUTO: x", null, matcher()))
  }

  @Test
  fun emptyTitleFallsBackToCachedTitle() {
    val m = matcher()
    assertTrue(TitleMute.shouldMute(auto, "", "AUTO: cached", m))
    assertFalse(TitleMute.shouldMute(auto, "  ", "Normal", m))
    // Entry title wins over the cache.
    assertFalse(TitleMute.shouldMute(auto, "Renamed", "AUTO: old", m))
  }

  @Test
  fun unknownTitleNeverMutes() {
    assertFalse(TitleMute.shouldMute(auto, "", null, matcher()))
    assertNull(TitleMute.titleFor("", ""))
  }

  @Test
  fun ignoreCaseFoldsUmlauts() {
    val m = matcher()
    val cfg = TitleMuteConfig("^über", ignoreCase = true)
    assertTrue(TitleMute.shouldMute(cfg, "ÜBER alles", null, m))
    assertFalse(TitleMute.shouldMute(TitleMuteConfig("^über", false), "ÜBER alles", null, m))
  }

  @Test
  fun alternationLikeTheSettingsHelp() {
    val cfg = TitleMuteConfig("^AUTO: |^TEST", ignoreCase = false)
    val m = matcher()
    assertTrue(TitleMute.shouldMute(cfg, "TESTOBJEKT 1", null, m))
    assertTrue(TitleMute.shouldMute(cfg, "AUTO: x", null, m))
    assertFalse(TitleMute.shouldMute(cfg, "Mein TEST", null, m))
  }

  @Test
  fun invalidPatternNeverMutes() {
    val m = matcher()
    assertNull(m.matches(TitleMuteConfig("(", false), "("))
    assertFalse(TitleMute.shouldMute(TitleMuteConfig("(", false), "(", null, m))
  }

  @Test
  fun tooLongPatternNeverMutes() {
    val cfg = TitleMuteConfig("a".repeat(TitleMute.MAX_PATTERN + 1), false)
    assertNull(matcher().matches(cfg, "a".repeat(300)))
  }

  @Test
  fun titleIsCutTo300Characters() {
    val cfg = TitleMuteConfig("END$", false)
    val m = matcher()
    assertFalse(TitleMute.shouldMute(cfg, "x".repeat(300) + "END", null, m))
    assertTrue(TitleMute.shouldMute(cfg, "x".repeat(297) + "END", null, m))
  }

  @Test
  fun timeoutNeverMutesAndStaysOff() {
    // Fake clock: +1 ms per check (every 256 reads), so the 10 ms budget runs out.
    var now = 0L
    val m = TitleMute.Matcher(budgetMs = 10, clock = { now += 1; now })
    // Cubic backtracking that the nested-repetition check lets through.
    val cfg = TitleMuteConfig(".*.*.*b", false)
    val title = "a".repeat(300)
    assertNull(m.matches(cfg, title))
    assertFalse(TitleMute.shouldMute(cfg, title, null, m))
    // Marked slow: also a fast, matching title is not muted any more.
    now = 0L
    assertNull(m.matches(cfg, "ab"))
  }

  @Test
  fun mapRoundTripDropsUnusableEntries() {
    val json = TitleMute.serializeMap(mapOf("ws1" to auto, "ws2" to TitleMuteConfig("x", true)))
    val back = TitleMute.parseMap(json)
    assertEquals(auto, back["ws1"])
    assertEquals(TitleMuteConfig("x", true), back["ws2"])
    assertTrue(TitleMute.parseMap("""{"ws":{"pattern":""}}""").isEmpty())
    assertTrue(TitleMute.parseMap("nope").isEmpty())
    assertTrue(TitleMute.parseMap(null).isEmpty())
  }

  @Test
  fun titleCacheKeepsLastNonEmptyTitle() {
    val cache = IssueTitleCache(max = 2)
    cache.remember("i1", "AUTO: one")
    cache.remember("i1", "")
    assertEquals("AUTO: one", cache.get("i1"))
    cache.remember("i2", "two")
    cache.remember("i3", "three")
    assertNull(cache.get("i1"))
    assertNull(cache.get(null))
  }

  @Test
  fun deciderIgnoresMutedEntriesAlsoInReconcileSummary() {
    val entry = InboxEntry(
      id = "n1", workspaceId = "ws", issueId = "i1", type = "mentioned", severity = "info",
      title = "AUTO: x", body = null, read = false, archived = false,
      createdAtMs = 0L, detailsTo = null, commentId = null, actorId = null,
    )
    val settings = PingRule.Settings(true, emptySet(), null, null)
    val now = InboxDecider.CATCH_UP_MAX_AGE_MS * 2
    val live = InboxDecider.decide(entry, false, settings, 600, now, false, null, titleMuted = true)
    assertEquals(InboxDecider.Action.Ignore, live)
    val old = InboxDecider.decide(entry, false, settings, 600, now, true, null, titleMuted = true)
    assertEquals(InboxDecider.Action.Ignore, old)
    val notMuted = InboxDecider.decide(entry, false, settings, 600, 1L, false, null)
    assertTrue(notMuted is InboxDecider.Action.Notify)
  }
}
