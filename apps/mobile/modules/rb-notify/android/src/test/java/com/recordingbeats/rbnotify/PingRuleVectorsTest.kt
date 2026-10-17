package com.recordingbeats.rbnotify

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Runs every vector of docs/technik/ping-rule-vectors.json against the
 * production rule (the vectors are binding).
 */
class PingRuleVectorsTest {
  private fun vectors(): JSONObject {
    val path = System.getProperty("rb.pingVectors")
      ?: error("system property rb.pingVectors not set (see build.gradle)")
    return JSONObject(File(path).readText())
  }

  @Test
  fun allVectors() {
    val file = vectors()
    val list = file.getJSONArray("vectors")
    assertTrue("vector file is empty", list.length() > 0)
    assertEquals(
      file.getJSONArray("categories").let { a -> (0 until a.length()).map { a.getString(it) }.sorted() },
      PingRule.CATEGORIES.sorted(),
    )
    for (i in 0 until list.length()) {
      val v = list.getJSONObject(i)
      val id = v.getString("id")
      val item = v.getJSONObject("item")
      val details = item.optJSONObject("details")
      val settings = v.optJSONObject("settings")
      val quiet = settings?.optJSONObject("quietHours")
      val disabled = settings?.optJSONArray("disabledCategories")
      val result = PingRule.evaluate(
        PingRule.Item(
          type = item.getString("type"),
          severity = item.getString("severity"),
          detailsTo = details?.optNullableString("to"),
          read = item.getBoolean("read"),
          archived = item.getBoolean("archived"),
        ),
        PingRule.Settings(
          enabled = settings?.optBoolean("enabled", true) ?: true,
          disabledCategories = disabled?.let { a -> (0 until a.length()).map { a.getString(it) }.toSet() }
            ?: emptySet(),
          quietStart = PingRule.parseHhMm(quiet?.optString("start")),
          quietEnd = PingRule.parseHhMm(quiet?.optString("end")),
        ),
        PingRule.parseHhMm(v.optNullableString("localTime")),
      )
      val expect = v.getJSONObject("expect")
      assertEquals("$id: ping", expect.getBoolean("ping"), result.ping)
      assertEquals("$id: category", expect.optNullableString("category"), result.category)
      assertEquals("$id: channel", expect.optNullableString("channel"), result.channel)
    }
  }
}
