package com.recordingbeats.rbnotify

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

/** Review #14 Fix 3: N1 (nothing after logout) and atomic writes. */
class StateFileTest {
  private val dir: File = Files.createTempDirectory("rbnotify").toFile()
  private val file = File(dir, "rb_notify_state.json")

  @Test
  fun writesAtomicallyWithoutLeftovers() {
    val s = StateFile(file)
    s.write("one")
    s.write("two")
    assertEquals("two", s.read())
    assertFalse(File(dir, "rb_notify_state.json.tmp").exists())
    s.write(null)
    assertFalse(file.exists())
  }

  @Test
  fun aWriteAfterLogoutIsDropped() {
    val s = StateFile(file)
    s.write("before")
    s.close() // logout while the handler thread is still in a REST call …
    s.write("late text") // … and persists afterwards
    assertFalse(file.exists())
    assertNull(s.read())
    assertTrue(s.closed)
  }

  @Test
  fun reopenAllowsWritesForTheNextSession() {
    val s = StateFile(file)
    s.close()
    s.reopen()
    s.write("new session")
    assertEquals("new session", s.read())
  }
}
