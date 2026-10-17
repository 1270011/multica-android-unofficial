package com.recordingbeats.rbnotify

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person

/**
 * Local notifications. One notification per issue
 * (tag = issue id), updated instead of stacked, MessagingStyle with up to
 * five lines, sound only the first time; a summary from two issues on.
 * Lock screen shows only the neutral public version. Texts come from
 * the inbox entry (title = issue title, body = comment excerpt) and are
 * never logged.
 */
class Notifier(private val context: Context, private val prefs: NotifyPrefs) {
  private val nm = NotificationManagerCompat.from(context)
  private val nonces = NonceStore(context)

  /** Survives process restarts, see NotifyStateCodec. */
  private val stateFile = StateFile(java.io.File(context.noBackupFilesDir, STATE_FILE))

  fun ensureChannels() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = context.getSystemService(NotificationManager::class.java) ?: return
    fun ch(id: String, nameKey: String, fallback: String, importance: Int) =
      NotificationChannel(id, prefs.string(nameKey, fallback), importance).apply {
        lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
      }
    mgr.createNotificationChannels(
      listOf(
        ch(Channels.BLOCKED, "channel_blocked", "Blocked", NotificationManager.IMPORTANCE_HIGH),
        ch(Channels.MENTIONS, "channel_mentions", "Mentions and questions", NotificationManager.IMPORTANCE_HIGH),
        ch(Channels.APPROVALS, "channel_approvals", "Approvals", NotificationManager.IMPORTANCE_DEFAULT),
        ch(Channels.ASSIGNMENTS, "channel_assignments", "Assignments", NotificationManager.IMPORTANCE_DEFAULT),
        ch(Channels.QUIET, "channel_quiet", "Quiet hours", NotificationManager.IMPORTANCE_LOW),
        ch(Channels.CONNECTION, "channel_connection", "Background connection", NotificationManager.IMPORTANCE_MIN).apply {
          setShowBadge(false)
        },
      ),
    )
  }

  /** Ongoing notification of the foreground service. Tap → notification settings. */
  fun connectionNotification(connected: Boolean, count: Int, refused: Boolean = false): android.app.Notification {
    val title = when {
      refused && !connected -> prefs.string("connection_refused", "Multica · connection refused (Cloudflare Access?)")
      !connected -> prefs.string("connection_wait", "Multica · reconnecting…")
      count > 1 -> prefs.string("connection_on_many", "Multica connected · {count} workspaces")
        .replace("{count}", count.toString())
      else -> prefs.string("connection_on", "Multica connected")
    }
    return NotificationCompat.Builder(context, Channels.CONNECTION)
      .setSmallIcon(smallIcon())
      .setContentTitle(title)
      .setOngoing(true)
      .setSilent(true)
      .setShowWhen(false)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setContentIntent(settingsIntent())
      .build()
  }

  @Synchronized
  fun notifyEntry(workspace: Workspace, entry: InboxEntry, channel: String, category: String) {
    if (stateFile.closed) return // after logout (N1)
    val issueId = entry.issueId ?: return
    forgetInvisible()
    val state = issues.getOrPut(issueId) {
      NotifyIssue(workspace.slug, issueId, entry.title, channel, mutableListOf(), entry.commentId)
    }
    val first = state.lines.isEmpty()
    if (!first && InboxDecider.rank(channel) > InboxDecider.rank(state.channel)) state.channel = channel
    if (channel == Channels.QUIET) state.channel = Channels.QUIET
    state.title = entry.title.ifEmpty { state.title }
    if (entry.commentId != null) state.commentId = entry.commentId
    if (state.lines.none { it.itemId == entry.id }) {
      state.lines.add(NotifyLine(entry.id, lineText(entry, category), senderName(entry), entry.createdAtMs ?: System.currentTimeMillis()))
      while (state.lines.size > MAX_LINES) state.lines.removeAt(0)
    }
    post(state, category, alert = first)
    postSummary()
    persist()
  }

  /** Entry read/archived elsewhere → drop its line, cancel when empty. */
  @Synchronized
  fun removeItem(itemId: String) {
    forgetInvisible()
    val state = issues.values.firstOrNull { s -> s.lines.any { it.itemId == itemId } } ?: return
    state.lines.removeAll { it.itemId == itemId }
    if (state.lines.isEmpty()) cancelIssue(state.issueId) else post(state, null, alert = false)
    postSummary()
    persist()
  }

  /** Keep only lines whose item is still unread (reconcile after a reconnect). */
  @Synchronized
  fun retainOnly(workspaceSlug: String, unreadIds: Set<String>) {
    forgetInvisible()
    for (state in issues.values.filter { it.workspaceSlug == workspaceSlug }.toList()) {
      val before = state.lines.size
      state.lines.removeAll { it.itemId !in unreadIds }
      if (state.lines.isEmpty()) cancelIssue(state.issueId)
      else if (state.lines.size != before) post(state, null, alert = false)
    }
    postSummary()
    persist()
  }

  @Synchronized
  fun addSummaryOnly(count: Int) {
    if (count <= 0) return
    forgetInvisible()
    catchUpCount += count
    postSummary(force = true)
    persist()
  }

  /**
   * The user swiped an issue notification away (delete intent): it
   * leaves the summary count at once, not only with the next ping. Ignored
   * when the issue was posted again after the swiped version.
   */
  @Synchronized
  fun dismissed(issueId: String, stamp: Long) {
    if (stateFile.closed || issueId !in issues) return
    if (!NotifyDisplay.dismissApplies(postedAt[issueId], stamp)) return
    issues.remove(issueId)
    postedAt.remove(issueId)
    seenActive.remove(issueId)
    postSummary()
    persist()
  }

  /** Workspace slug and inbox item ids behind an issue notification. */
  @Synchronized
  fun itemsOf(issueId: String): Pair<String, List<String>>? =
    issues[issueId]?.let { s -> s.workspaceSlug to s.lines.map { it.itemId } }

  @Synchronized
  fun cancelIssue(issueId: String) {
    issues.remove(issueId)
    postedAt.remove(issueId)
    seenActive.remove(issueId)
    nm.cancel(issueId, ID_ISSUE)
    postSummary()
    scheduleReconcile()
    persist()
  }

  @Synchronized
  fun cancelAll() {
    // Logout: close first, so a late handler-thread call can neither
    // post nor write texts back to disk.
    stateFile.close()
    main.removeCallbacks(reconcileRun)
    issues.clear()
    postedAt.clear()
    seenActive.clear()
    summaryActive = null
    catchUpCount = 0
    nm.cancelAll()
    nonces.clear()
  }

  fun showRelogin() = showHint("relogin_text", "Please sign in again")

  /** All enabled workspaces were refused ("not a member"): service stopped. */
  fun showNoWorkspace() = showHint("no_workspace_text", "No workspace left for notifications. Check them in the app.")

  private fun showHint(key: String, fallback: String) {
    if (!canPost()) return
    val n = NotificationCompat.Builder(context, Channels.BLOCKED)
      .setSmallIcon(smallIcon())
      .setContentTitle(prefs.string("relogin_title", "Multica"))
      .setContentText(prefs.string(key, fallback))
      .setAutoCancel(true)
      .setContentIntent(launchIntent(REQ_RELOGIN))
      .build()
    notifySafe(null, ID_RELOGIN, n)
  }

  private val issues = LinkedHashMap<String, NotifyIssue>()
  private var catchUpCount = 0

  /** When this process last posted each issue / the summary (not persisted). */
  private val postedAt = HashMap<String, Long>()
  private var summaryPostedAt: Long? = null

  /** Issues seen in the active list since their last post. */
  private val seenActive = HashSet<String>()

  /** Summary in the active list at the last check (null: list not readable). */
  private var summaryActive: Boolean? = null

  /**
   * Forget issues whose notification is no longer shown (summary tapped,
   * swiped away), so the summary counts only visible ones.
   * Runs before a change, so the issue about to be posted is never dropped.
   * Without a readable active list nothing is forgotten.
   */
  private fun forgetInvisible() {
    val active = try {
      context.getSystemService(NotificationManager::class.java)?.activeNotifications
    } catch (_: Exception) {
      null
    } ?: return
    val tags = active.filter { it.id == ID_ISSUE }.mapNotNull { it.tag }.toSet()
    val now = System.currentTimeMillis()
    seenActive.addAll(tags.filter { it in issues })
    val gone = NotifyDisplay.goneIssues(issues.keys.associateWith { postedAt[it] }, tags, now, seen = seenActive)
    gone.forEach {
      issues.remove(it)
      postedAt.remove(it)
      seenActive.remove(it)
    }
    summaryActive = active.any { it.id == ID_SUMMARY }
    if (!NotifyDisplay.keepCatchUp(summaryActive == true, summaryPostedAt, now)) catchUpCount = 0
  }

  private val main = Handler(Looper.getMainLooper())
  private val reconcileRun = Runnable { reconcile() }

  /**
   * Second look after a post or cancel: once Android has registered the
   * change, notifications it removed by itself (summary cascade, a swipe)
   * leave the count, and the summary follows. Debounced, never alerts.
   */
  private fun scheduleReconcile() {
    main.removeCallbacks(reconcileRun)
    main.postDelayed(reconcileRun, NotifyDisplay.VISIBLE_GRACE_MS + 500)
  }

  @Synchronized
  private fun reconcile() {
    if (stateFile.closed) return
    val before = issues.size
    forgetInvisible()
    if (issues.size != before) {
      postSummary(reconciling = true)
      persist()
    }
  }

  init {
    val saved = try {
      NotifyStateCodec.decode(stateFile.read())
    } catch (_: Exception) {
      NotifyStateCodec.State(emptyList(), 0)
    }
    saved.issues.forEach { issues[it.issueId] = it }
    catchUpCount = saved.catchUpCount
  }

  /** Called at the end of every mutation (all @Synchronized). */
  private fun persist() {
    stateFile.write(
      if (issues.isEmpty() && catchUpCount == 0) null else NotifyStateCodec.encode(issues.values, catchUpCount),
    )
  }

  /** New session (login / service start): notifications may appear again. */
  @Synchronized
  fun reopen() {
    stateFile.reopen()
  }

  private fun post(state: NotifyIssue, category: String?, alert: Boolean) {
    if (stateFile.closed || !canPost()) return
    val me = Person.Builder().setName(prefs.string("me", "Me")).build()
    // §8.4: with several switched-on workspaces the name is shown. Android
    // drops subText for messaging notifications, so it also goes into the
    // conversation title.
    val workspaceLabel = NotifyDisplay.workspaceLabel(prefs.workspaces, state.workspaceSlug)
    val style = NotificationCompat.MessagingStyle(me)
      .setConversationTitle(NotifyDisplay.conversationTitle(state.title, workspaceLabel))
    for (line in state.lines) {
      style.addMessage(line.text, line.at, Person.Builder().setName(line.sender).build())
    }
    val stamp = System.currentTimeMillis()
    val headline = category?.let { "${state.title} · ${reason(it)}" } ?: state.title
    val builder = NotificationCompat.Builder(context, state.channel)
      .setSmallIcon(smallIcon())
      .setContentTitle(headline)
      .setContentText(state.lines.lastOrNull()?.text ?: "")
      .setStyle(style)
      .setGroup(GROUP)
      .setOnlyAlertOnce(!alert)
      .setAutoCancel(true)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPublicVersion(publicVersion(issues.size))
      .setContentIntent(chatIntent(state))
      .addAction(0, prefs.string("action_mark_read", "Mark as read"), markReadIntent(state.issueId))
      .setDeleteIntent(dismissIntent(state.issueId, stamp))
    if (workspaceLabel != null) builder.setSubText(workspaceLabel)
    if (state.channel == Channels.QUIET) builder.setSilent(true)
    notifySafe(state.issueId, ID_ISSUE, builder.build())
    postedAt[state.issueId] = stamp
    seenActive.remove(state.issueId)
    scheduleReconcile()
  }

  private fun postSummary(force: Boolean = false, reconciling: Boolean = false) {
    if (stateFile.closed || !canPost()) return
    val count = issues.size
    val now = System.currentTimeMillis()
    // Shown = listed at the last check, or posted a moment ago and not yet
    // listed. Unknown list: assume shown, so a cancel is still considered.
    val shown = summaryActive != false ||
      summaryPostedAt?.let { now - it <= NotifyDisplay.VISIBLE_GRACE_MS } == true
    when (NotifyDisplay.summaryPlan(count, catchUpCount, force, shown)) {
      NotifyDisplay.SummaryPlan.NONE -> return
      NotifyDisplay.SummaryPlan.CANCEL -> {
        // No child is visible, so the cascade can take nothing with it.
        nm.cancel(null, ID_SUMMARY)
        summaryActive = false
        summaryPostedAt = null
        if (count == 0) catchUpCount = 0
        return
      }
      NotifyDisplay.SummaryPlan.POST -> Unit
    }
    val total = count + catchUpCount
    val title = NotifyDisplay.summaryTitle(count, catchUpCount, prefs::string)
    val n = NotificationCompat.Builder(context, Channels.QUIET)
      .setSmallIcon(smallIcon())
      .setContentTitle(title)
      .setGroup(GROUP)
      .setGroupSummary(true)
      .setSilent(true)
      .setAutoCancel(true)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPublicVersion(publicVersion(total))
      .setContentIntent(inboxIntent())
      .build()
    notifySafe(null, ID_SUMMARY, n)
    summaryPostedAt = now
    if (!reconciling) scheduleReconcile()
  }

  private fun publicVersion(count: Int): android.app.Notification =
    NotificationCompat.Builder(context, Channels.QUIET)
      .setSmallIcon(smallIcon())
      .setContentTitle(
        prefs.string("public_title", "Multica · {count} new").replace("{count}", maxOf(count, 1).toString()),
      )
      .build()

  private fun reason(category: String): String = when (category) {
    PingRule.BLOCKED -> prefs.string("reason_blocked", "Blocked")
    PingRule.MENTIONS -> prefs.string("reason_mention", "Mention")
    PingRule.APPROVALS -> prefs.string("reason_approval", "Waiting for approval")
    PingRule.FAILED_RUNS -> prefs.string("reason_failed", "Run failed")
    PingRule.ASSIGNMENTS -> prefs.string("reason_assigned", "Assigned to you")
    else -> ""
  }

  private fun lineText(entry: InboxEntry, category: String): String {
    val body = entry.body?.let { plain(it) }?.takeIf { it.isNotEmpty() }
    return when {
      body != null -> body.take(120)
      category == PingRule.BLOCKED -> prefs.string("line_blocked", "Status → Blocked")
      category == PingRule.APPROVALS -> prefs.string("line_review", "Status → In review")
      else -> reason(category)
    }
  }

  private fun senderName(entry: InboxEntry): String =
    prefs.actorName(entry.actorId) ?: "Multica"

  private fun plain(md: String): String = md
    .replace(Regex("!\\[[^\\]]*]\\([^)]*\\)"), "")
    .replace(Regex("\\[([^\\]]*)]\\([^)]*\\)"), "$1")
    .replace(Regex("[*_`>#~]+"), "")
    .replace(Regex("\\s+"), " ")
    .trim()

  private fun chatIntent(state: NotifyIssue): PendingIntent {
    val nonce = nonces.issue(state.issueId)
    val uri = Uri.Builder().scheme(SCHEME).authority(state.workspaceSlug)
      .appendPath("issue").appendPath(state.issueId).appendPath("chat")
      .apply { state.commentId?.let { appendQueryParameter("comment", it) } }
      .appendQueryParameter("n", nonce)
      .build()
    val intent = Intent(Intent.ACTION_VIEW, uri).setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      state.issueId.hashCode(),
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  /**
   * Summary tap → Inbox, segment "Unread", in the workspace of the newest
   * entry. The Inbox is a tab root, so the tab bar is the
   * anchor. Only shows data; nothing is marked read, so no nonce.
   */
  private fun inboxIntent(): PendingIntent {
    val slug = NotifyDisplay.summarySlug(issues.values, prefs.workspaces) ?: return launchIntent(REQ_SUMMARY)
    val uri = Uri.Builder().scheme(SCHEME).authority(slug)
      .appendPath("inbox").appendQueryParameter("view", "unread").build()
    val intent = Intent(Intent.ACTION_VIEW, uri).setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      REQ_SUMMARY,
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  private fun settingsIntent(): PendingIntent {
    val slug = prefs.workspaces.firstOrNull { it.enabled }?.slug ?: return launchIntent(REQ_CONNECTION)
    val uri = Uri.Builder().scheme(SCHEME).authority(slug)
      .appendPath("more").appendPath("settings").appendPath("notifications").build()
    val intent = Intent(Intent.ACTION_VIEW, uri).setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      REQ_CONNECTION,
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  private fun launchIntent(requestCode: Int): PendingIntent {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: Intent().setPackage(context.packageName)
    return PendingIntent.getActivity(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  private fun markReadIntent(issueId: String): PendingIntent {
    val intent = Intent(context, MarkReadReceiver::class.java)
      .setAction(MarkReadReceiver.ACTION)
      .putExtra(MarkReadReceiver.EXTRA_ISSUE, issueId)
    return PendingIntent.getBroadcast(
      context,
      issueId.hashCode(),
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  private fun dismissIntent(issueId: String, stamp: Long): PendingIntent {
    val intent = Intent(context, DismissReceiver::class.java)
      .setAction(DismissReceiver.ACTION)
      .putExtra(DismissReceiver.EXTRA_ISSUE, issueId)
      .putExtra(DismissReceiver.EXTRA_STAMP, stamp)
    return PendingIntent.getBroadcast(
      context,
      issueId.hashCode(),
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  private fun canPost(): Boolean = nm.areNotificationsEnabled()

  @SuppressLint("MissingPermission")
  private fun notifySafe(tag: String?, id: Int, n: android.app.Notification) {
    try {
      nm.notify(tag, id, n)
    } catch (_: SecurityException) {
      // POST_NOTIFICATIONS revoked in the meantime; settings show it.
    }
  }

  private fun smallIcon(): Int {
    val res = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
    return if (res != 0) res else context.applicationInfo.icon
  }

  companion object {
    const val SCHEME = "multica"
    const val GROUP = "rb_operator"
    const val STATE_FILE = "rb_notify_state.json"
    const val ID_ISSUE = 1001
    const val ID_SUMMARY = 1002
    const val ID_RELOGIN = 1003
    const val ID_CONNECTION = 1004
    private const val MAX_LINES = 5
    private const val REQ_CONNECTION = 1
    private const val REQ_SUMMARY = 2
    private const val REQ_RELOGIN = 3

    @Volatile private var instance: Notifier? = null

    fun get(context: Context): Notifier = instance ?: synchronized(this) {
      instance ?: Notifier(context.applicationContext, NotifyPrefs(context.applicationContext))
        .also { instance = it }
    }
  }
}
