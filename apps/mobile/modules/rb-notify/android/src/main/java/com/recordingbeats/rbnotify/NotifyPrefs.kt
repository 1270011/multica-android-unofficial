package com.recordingbeats.rbnotify

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Device settings of the operator notifications, the
 * workspace list, UI strings and actor names handed over by JS. Nothing
 * secret lives here (the session is in CredentialStore); the backup rules
 * still exclude the file so a restored phone starts without a stale
 * workspace list.
 */
class NotifyPrefs(context: Context) {
  private val prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  var enabled: Boolean
    get() = prefs.getBoolean("enabled", false)
    set(v) = prefs.edit().putBoolean("enabled", v).apply()

  /** "Hintergrundverbindung": push on but connection off = no service. */
  var connectionEnabled: Boolean
    get() = prefs.getBoolean("connectionEnabled", true)
    set(v) = prefs.edit().putBoolean("connectionEnabled", v).apply()

  /** The service may run: push on and background connection on. */
  fun serviceWanted(): Boolean = enabled && connectionEnabled

  var disabledCategories: Set<String>
    get() = prefs.getStringSet("disabledCategories", emptySet())?.toSet() ?: emptySet()
    set(v) = prefs.edit().putStringSet("disabledCategories", v).apply()

  /** Workspace slugs the user switched off (each socket costs battery). */
  var disabledWorkspaces: Set<String>
    get() = prefs.getStringSet("disabledWorkspaces", emptySet())?.toSet() ?: emptySet()
    set(v) = prefs.edit().putStringSet("disabledWorkspaces", v).apply()

  var quietStart: String?
    get() = prefs.getString("quietStart", null)
    set(v) = prefs.edit().putString("quietStart", v).apply()

  var quietEnd: String?
    get() = prefs.getString("quietEnd", null)
    set(v) = prefs.edit().putString("quietEnd", v).apply()

  /**
   * Issue whose chat is open in the foreground: no notification for it (UX
   * §8.4). Process-wide, not per instance: the module and the service each
   * create their own NotifyPrefs.
   */
  var foregroundIssueId: String?
    get() = foregroundIssue
    set(v) {
      foregroundIssue = v
    }

  fun pingSettings(): PingRule.Settings = PingRule.Settings(
    enabled = enabled,
    disabledCategories = disabledCategories,
    quietStart = PingRule.parseHhMm(quietStart),
    quietEnd = PingRule.parseHhMm(quietEnd),
  )

  var workspaces: List<Workspace>
    get() {
      val arr = try {
        JSONArray(prefs.getString("workspaces", "[]"))
      } catch (_: Exception) {
        JSONArray()
      }
      return (0 until arr.length()).mapNotNull { i ->
        val o = arr.optJSONObject(i) ?: return@mapNotNull null
        val slug = o.optString("slug")
        if (slug.isEmpty()) null else Workspace(
          o.optString("id"),
          slug,
          o.optString("name", slug),
          o.optBoolean("enabled", true) && slug !in disabledWorkspaces,
        )
      }
    }
    set(list) {
      val arr = JSONArray()
      list.forEach {
        arr.put(
          JSONObject().put("id", it.id).put("slug", it.slug).put("name", it.name)
            .put("enabled", it.enabled),
        )
      }
      prefs.edit().putString("workspaces", arr.toString()).apply()
    }

  /** Localised strings from JS (the in-app language differs from the system one). */
  fun string(key: String, fallback: String): String =
    stringsJson().optString(key, "").ifEmpty { fallback }

  fun setStrings(map: Map<String, String>) {
    prefs.edit().putString("strings", JSONObject(map as Map<*, *>).toString()).apply()
  }

  private fun stringsJson(): JSONObject = try {
    JSONObject(prefs.getString("strings", "{}") ?: "{}")
  } catch (_: Exception) {
    JSONObject()
  }

  fun actorName(id: String?): String? {
    if (id == null) return null
    return try {
      JSONObject(prefs.getString("actors", "{}") ?: "{}").optString(id, "").ifEmpty { null }
    } catch (_: Exception) {
      null
    }
  }

  fun setActors(map: Map<String, String>) {
    prefs.edit().putString("actors", JSONObject(map as Map<*, *>).toString()).apply()
  }

  /** "Please sign in again" was shown for the current expiry already. */
  var reloginShown: Boolean
    get() = prefs.getBoolean("reloginShown", false)
    set(v) = prefs.edit().putBoolean("reloginShown", v).apply()

  fun clearSession() {
    prefs.edit().remove("workspaces").remove("actors").apply()
  }

  companion object {
    const val FILE = "rb_notify"

    @Volatile private var foregroundIssue: String? = null
  }
}
