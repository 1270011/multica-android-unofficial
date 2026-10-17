package com.recordingbeats.rbnotify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * "Mark as read" action on an issue notification (docs/UX.md §8.4). Not
 * exported; reached only through the app's own immutable PendingIntent
 * (T4). Marks the issue's inbox entries read on the server, then removes
 * the notification.
 */
class MarkReadReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION) return
    val issueId = intent.getStringExtra(EXTRA_ISSUE) ?: return
    val notifier = Notifier.get(context)
    val (slug, itemIds) = notifier.itemsOf(issueId) ?: return
    notifier.cancelIssue(issueId)
    if (itemIds.isEmpty()) return
    val pending = goAsync()
    Thread {
      try {
        InboxApi(context).markRead(slug, itemIds)
      } finally {
        pending.finish()
      }
    }.start()
  }

  companion object {
    const val ACTION = "com.recordingbeats.rbnotify.MARK_READ"
    const val EXTRA_ISSUE = "issue_id"
  }
}
