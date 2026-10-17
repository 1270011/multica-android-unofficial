package com.recordingbeats.rbnotify

import java.io.File

/**
 * The notification state file plus the session gate (review #14 Fix 3).
 *
 * - Writes are atomic: tmp file, then rename, so a crash never leaves a
 *   half-written file behind.
 * - `close()` ends the session (logout, T2): the file is deleted and every
 *   later write is dropped until `reopen()` (next login / service start).
 *   A handler thread that was inside a REST call during the logout can
 *   therefore not bring notification texts back to disk.
 */
class StateFile(private val file: File) {
  @Volatile var closed = false
    private set

  fun read(): String? = try {
    file.takeIf { it.exists() }?.readText()
  } catch (_: Exception) {
    null
  }

  /** Atomic replace; `null` deletes. No-op while closed. */
  @Synchronized
  fun write(text: String?) {
    if (closed) return
    try {
      if (text == null) {
        file.delete()
        return
      }
      val tmp = File(file.parentFile, file.name + ".tmp")
      tmp.writeText(text)
      if (!tmp.renameTo(file)) {
        file.delete()
        if (!tmp.renameTo(file)) tmp.delete()
      }
    } catch (_: Exception) {
      // Best effort: losing it only costs "Mark as read" after a restart.
    }
  }

  @Synchronized
  fun close() {
    closed = true
    file.delete()
    File(file.parentFile, file.name + ".tmp").delete()
  }

  @Synchronized
  fun reopen() {
    closed = false
  }
}
