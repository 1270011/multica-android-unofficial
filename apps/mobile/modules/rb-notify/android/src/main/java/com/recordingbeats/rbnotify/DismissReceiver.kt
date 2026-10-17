package com.recordingbeats.rbnotify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Delete intent of an issue notification: the user swiped it
 * away, so it leaves the summary count at once. Not exported; reached only
 * through the app's own immutable PendingIntent. Marks nothing read.
 */
class DismissReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION) return
    val issueId = intent.getStringExtra(EXTRA_ISSUE) ?: return
    Notifier.get(context).dismissed(issueId, intent.getLongExtra(EXTRA_STAMP, Long.MAX_VALUE))
  }

  companion object {
    const val ACTION = "com.recordingbeats.rbnotify.DISMISSED"
    const val EXTRA_ISSUE = "issue_id"
    const val EXTRA_STAMP = "posted_at"
  }
}
