package com.recordingbeats.rbnotify

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.security.SecureRandom

/**
 * One-time nonces for notification taps (security T5 narrow variant,
 * docs/UX.md §8.5). The notification's PendingIntent opens the chat deep
 * link with `n=<nonce>`; only a nonce this store issued (unguessable, single
 * use, expiring) lets the chat mark the issue read. A deep link fired by
 * another app cannot know one, so it only displays the chat. App-private,
 * excluded from backup.
 */
class NonceStore(context: Context) {
  private val file = File(context.noBackupFilesDir, "rb_notify_nonces.json")
  private val random = SecureRandom()

  @Synchronized
  fun issue(issueId: String, now: Long = System.currentTimeMillis()): String {
    val bytes = ByteArray(16).also { random.nextBytes(it) }
    val nonce = bytes.joinToString("") { "%02x".format(it) }
    val map = prune(read(), now)
    map.put(nonce, JSONObject().put("issue", issueId).put("at", now))
    write(map)
    return nonce
  }

  /** True once for a nonce issued for this issue within the TTL. */
  @Synchronized
  fun consume(nonce: String, issueId: String, now: Long = System.currentTimeMillis()): Boolean {
    val map = prune(read(), now)
    val entry = map.optJSONObject(nonce)
    map.remove(nonce)
    write(map)
    return entry != null && entry.optString("issue") == issueId
  }

  @Synchronized
  fun clear() {
    file.delete()
  }

  private fun read(): JSONObject = try {
    if (file.exists()) JSONObject(file.readText()) else JSONObject()
  } catch (_: Exception) {
    JSONObject()
  }

  private fun write(map: JSONObject) {
    try {
      file.writeText(map.toString())
    } catch (_: Exception) {
    }
  }

  private fun prune(map: JSONObject, now: Long): JSONObject {
    val keys = map.keys().asSequence().toList()
    for (k in keys) {
      val at = map.optJSONObject(k)?.optLong("at", 0L) ?: 0L
      if (now - at > TTL_MS) map.remove(k)
    }
    return map
  }

  companion object {
    /** Notifications can sit in the shade for days. */
    const val TTL_MS = 7L * 24 * 60 * 60 * 1000
  }
}
