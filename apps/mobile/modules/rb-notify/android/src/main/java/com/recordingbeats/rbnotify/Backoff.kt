package com.recordingbeats.rbnotify

/**
 * Reconnect delay (docs/TECHNIK.md §1.3): exponential from 1 s, capped at
 * 5 min, "equal jitter" so a fleet of clients does not reconnect in step.
 */
object Backoff {
  const val BASE_MS = 1_000L
  const val CAP_MS = 300_000L
  /** A connection that stayed up this long resets the attempt counter. */
  const val STABLE_MS = 60_000L

  fun delayMs(attempt: Int, random: Double): Long {
    val shift = attempt.coerceIn(0, 20)
    val exp = minOf(CAP_MS, BASE_MS shl shift)
    val half = exp / 2
    return half + (half * random.coerceIn(0.0, 1.0)).toLong()
  }
}
