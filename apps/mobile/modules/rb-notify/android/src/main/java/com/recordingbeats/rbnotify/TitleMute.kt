package com.recordingbeats.rbnotify

import org.json.JSONObject

/**
 * "Also mute push notifications" of the issue title filter (W7).
 * The pattern lives in the JS view-prefs store (per workspace);
 * JS mirrors it here only while the filter is on, the pattern is valid
 * (length, syntax, no nested repetition, not too slow) and the mute switch
 * is on. The service runs without JS, so the match runs here.
 *
 * Rules:
 *  - only the app's own notifications; the inbox entry stays (server, web
 *    and inbox unchanged)
 *  - the inbox item title is the issue title (server notification_listeners);
 *    empty → the last title seen for that issue; unknown → no mute
 *  - the same guards as lib/title-filter.ts: pattern ≤ 200, title cut to
 *    300, one test at most 10 ms; a timeout or an unusable pattern never
 *    mutes, and a slow pattern stays off until the process ends
 *  - hidden people and agents never mute (nothing here looks at actors)
 */
data class TitleMuteConfig(val pattern: String, val ignoreCase: Boolean)

object TitleMute {
  const val MAX_PATTERN = 200
  const val MAX_TITLE = 300
  const val MAX_SINGLE_MS = 10L

  /** Map workspace id → config, as stored in NotifyPrefs. Unreadable → empty. */
  fun parseMap(json: String?): Map<String, TitleMuteConfig> {
    val o = try {
      JSONObject(json ?: return emptyMap())
    } catch (_: Exception) {
      return emptyMap()
    }
    val out = HashMap<String, TitleMuteConfig>()
    for (key in o.keys()) {
      val v = o.optJSONObject(key) ?: continue
      val pattern = v.optString("pattern", "")
      if (key.isEmpty() || pattern.isEmpty() || pattern.length > MAX_PATTERN) continue
      out[key] = TitleMuteConfig(pattern, v.optBoolean("ignoreCase", false))
    }
    return out
  }

  fun serializeMap(map: Map<String, TitleMuteConfig>): String {
    val o = JSONObject()
    map.forEach { (k, v) ->
      o.put(k, JSONObject().put("pattern", v.pattern).put("ignoreCase", v.ignoreCase))
    }
    return o.toString()
  }

  /** The title to test: the entry's own, else the cached one, else null. */
  fun titleFor(entryTitle: String, cachedTitle: String?): String? =
    entryTitle.ifBlank { null } ?: cachedTitle?.ifBlank { null }

  /**
   * True only when [config] is set, a title is known and the pattern
   * matches it within the time budget.
   */
  fun shouldMute(
    config: TitleMuteConfig?,
    entryTitle: String,
    cachedTitle: String?,
    matcher: Matcher,
  ): Boolean {
    if (config == null) return false
    val title = titleFor(entryTitle, cachedTitle) ?: return false
    return matcher.matches(config, title) == true
  }

  /**
   * Compiled patterns and the "too slow" list, shared by the service thread.
   * `clock` in ms, injectable for tests.
   */
  class Matcher(
    private val budgetMs: Long = MAX_SINGLE_MS,
    private val clock: () -> Long = { System.nanoTime() / 1_000_000 },
  ) {
    private val compiled = HashMap<TitleMuteConfig, Regex?>()
    private val slow = HashSet<TitleMuteConfig>()

    /** true/false = result; null = no usable answer (invalid, too slow). */
    @Synchronized
    fun matches(config: TitleMuteConfig, title: String): Boolean? {
      if (config in slow || config.pattern.length > MAX_PATTERN) return null
      val regex = compiled.getOrPut(config) { compile(config) } ?: return null
      val deadline = clock() + budgetMs
      return try {
        regex.containsMatchIn(DeadlineChars(title.take(MAX_TITLE), deadline, clock))
      } catch (_: Timeout) {
        slow.add(config)
        null
      } catch (_: StackOverflowError) {
        slow.add(config)
        null
      } catch (_: RuntimeException) {
        null
      }
    }

    private fun compile(config: TitleMuteConfig): Regex? = try {
      // JS "i" folds non-ASCII letters too (ä/Ä); Kotlin's IGNORE_CASE adds
      // UNICODE_CASE on the JVM (TitleMuteTest.ignoreCaseFoldsUmlauts).
      if (config.ignoreCase) Regex(config.pattern, RegexOption.IGNORE_CASE) else Regex(config.pattern)
    } catch (_: Exception) {
      null // Java syntax differs from JS in corners: no mute rather than a guess.
    }
  }

  private class Timeout : RuntimeException()

  /**
   * java.util.regex has no timeout; it reads the input through charAt, so a
   * CharSequence that checks the clock stops runaway backtracking.
   */
  private class DeadlineChars(
    private val s: CharSequence,
    private val deadline: Long,
    private val clock: () -> Long,
  ) : CharSequence {
    private var reads = 0
    override val length: Int get() = s.length
    override fun get(index: Int): Char {
      if ((++reads and 0xFF) == 0 && clock() > deadline) throw Timeout()
      return s[index]
    }
    override fun subSequence(startIndex: Int, endIndex: Int): CharSequence =
      DeadlineChars(s.subSequence(startIndex, endIndex), deadline, clock)
    override fun toString(): String = s.toString()
  }
}

/** Last non-empty title per issue id (inbox items carry the issue title). */
class IssueTitleCache(private val max: Int = 500) {
  private val map = object : LinkedHashMap<String, String>(64, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?) = size > max
  }

  @Synchronized
  fun remember(issueId: String?, title: String) {
    if (issueId.isNullOrEmpty() || title.isBlank()) return
    map[issueId] = title
  }

  @Synchronized
  fun get(issueId: String?): String? = if (issueId.isNullOrEmpty()) null else map[issueId]
}
