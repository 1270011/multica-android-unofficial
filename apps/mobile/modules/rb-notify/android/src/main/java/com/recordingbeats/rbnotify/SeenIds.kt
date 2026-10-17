package com.recordingbeats.rbnotify

/**
 * Inbox item ids already handled for one workspace, newest last, capped
 * (docs/TECHNIK.md §1.3: last 500 per workspace). Duplicates across the live
 * socket, the reconcile after a reconnect and a service restart are dropped
 * by id.
 */
class SeenIds(private val max: Int = 500) {
  private val ids = LinkedHashSet<String>()

  /** Returns false when the id was already seen. */
  fun add(id: String): Boolean {
    if (ids.contains(id)) return false
    ids.add(id)
    while (ids.size > max) ids.remove(ids.first())
    return true
  }

  fun contains(id: String): Boolean = ids.contains(id)

  fun size(): Int = ids.size

  fun serialize(): String = ids.joinToString("\n")

  companion object {
    fun parse(text: String?, max: Int = 500): SeenIds {
      val out = SeenIds(max)
      text?.lineSequence()?.map { it.trim() }?.filter { it.isNotEmpty() }?.forEach { out.add(it) }
      return out
    }
  }
}
