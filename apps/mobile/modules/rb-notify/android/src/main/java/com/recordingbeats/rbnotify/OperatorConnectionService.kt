package com.recordingbeats.rbnotify

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.SystemClock
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.io.File
import java.util.Calendar

/**
 * Foreground service `specialUse` holding ONE Multica WebSocket for all
 * workspaces: the server delivers
 * `inbox:*` to every connection of the user, so entries are matched to
 * their workspace by `item.workspace_id` (WorkspaceRouting). Runs fully
 * native, no JS in the background. Not exported. Started only from the
 * app in the foreground (settings switch, app start) or from BootReceiver.
 *
 * Event flow: `inbox:new` → InboxDecider → Notifier; `inbox:read/archived`
 * → remove the line; every (re)connect → `GET /api/inbox` reconcile per
 * enabled workspace (new unseen entries are notified, older than 24 h only
 * counted in the summary, notifications of entries read elsewhere
 * disappear). Only an explicit token rejection stops the service, deletes
 * the session copy and shows "please sign in again" once; network
 * errors and the 10 s auth timeout just reconnect (InboxSocket).
 */
class OperatorConnectionService : Service(), InboxSocket.Listener {
  private lateinit var thread: HandlerThread
  private lateinit var handler: Handler
  private lateinit var prefs: NotifyPrefs
  private lateinit var store: CredentialStore
  private lateinit var notifier: Notifier
  private lateinit var api: InboxApi
  private var socket: InboxSocket? = null
  /** Slugs the server refused ("not a member") since the service started. */
  private val lostSlugs = HashSet<String>()
  /** Last upgrade answered 403 (Cloudflare Access?), shown until connected. */
  @Volatile private var refused = false
  private val seen = HashMap<String, SeenIds>()
  private var networkCallback: ConnectivityManager.NetworkCallback? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    prefs = NotifyPrefs(this)
    store = CredentialStore(this)
    notifier = Notifier.get(this)
    api = InboxApi(this)
    notifier.ensureChannels()
    thread = HandlerThread("rb-notify").also { it.start() }
    handler = Handler(thread.looper)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // startForeground must come first, even if we stop right away. A repeated
    // start (app back in the foreground) keeps the current connection state.
    val connectedNow = connectedCount // maintained on the handler thread
    try {
      ServiceCompat.startForeground(
        this,
        Notifier.ID_CONNECTION,
        notifier.connectionNotification(connectedNow > 0, connectedNow, refused),
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
          ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
          0
        },
      )
    } catch (_: Exception) {
      // A sticky restart from the background may not start a foreground
      // service (Android 12+: ForegroundServiceStartNotAllowedException).
      // Stop instead of crashing; the next app start brings it back.
      stopSelf()
      return START_NOT_STICKY
    }
    if (stopRequested) {
      stopSelfSafely()
      return START_NOT_STICKY
    }
    running = true
    handler.post { syncSockets() }
    registerNetwork()
    return START_STICKY
  }

  override fun onDestroy() {
    running = false
    connectedCount = 0
    unregisterNetwork()
    handler.post {
      socket?.stop()
      socket = null
    }
    thread.quitSafely()
    super.onDestroy()
  }

  private fun enabledWorkspaces() = prefs.workspaces.filter { it.enabled }

  /** Bring the socket in line with prefs + credentials (thread: handler). */
  private fun syncSockets() {
    val all = prefs.workspaces
    if (stopRequested || !prefs.serviceWanted() || !store.exists() || all.none { it.enabled }) {
      stopSelfSafely()
      return
    }
    val via = WorkspaceRouting.connectVia(all, lostSlugs) ?: run {
      stopSelfSafely()
      return
    }
    val current = socket
    if (current == null) {
      socket = InboxSocket(OkHttpTransport(store), HandlerScheduler(handler), ::socketCreds, this)
        .also { it.start(via.slug) }
    } else if (all.none { it.slug == current.slug }) {
      // The workspace the socket was opened with is gone from the list.
      current.start(via.slug)
    } else if (current.connected) {
      // Switches changed while connected: reconcile the enabled set and
      // recount the status line ("1 of 2" still said "2 workspaces").
      updateConnectionNotification()
      reconcileAll()
    }
  }

  private fun socketCreds(): InboxSocket.Creds? =
    store.load()?.let { InboxSocket.Creds(it.baseUrl, it.token) }

  override fun onConnected() {
    refused = false
    updateConnectionNotification()
    reconcileAll()
  }

  /** `GET /api/inbox` per enabled workspace (own `X-Workspace-Slug`). */
  private fun reconcileAll() {
    for (workspace in enabledWorkspaces()) {
      if (stopRequested) return // logout during the previous request (N1)
      when (val res = api.listInbox(workspace.slug)) {
        is InboxApi.Result.Ok -> reconcile(workspace, res.value)
        is InboxApi.Result.Unauthorized -> {
          onUnauthorized()
          return
        }
        is InboxApi.Result.Failed -> Unit
      }
    }
  }

  override fun onDisconnected() {
    updateConnectionNotification()
  }

  override fun onFrame(frame: WsFrame) {
    if (stopRequested) return
    when (frame) {
      is WsFrame.InboxNew -> {
        val workspace = WorkspaceRouting.forEntry(frame.entry.workspaceId, prefs.workspaces) ?: return
        handleEntry(workspace, frame.entry, fromReconcile = false)
      }
      is WsFrame.InboxGone -> notifier.removeItem(frame.itemId)
      is WsFrame.InboxBatch -> reconcileAll()
      else -> Unit
    }
  }

  override fun onRefused() {
    refused = true
    updateConnectionNotification()
  }

  override fun onWorkspaceLost(slug: String) {
    if (stopRequested) {
      stopSelfSafely()
      return
    }
    lostSlugs.add(slug)
    updateConnectionNotification()
    // Nothing left to deliver once every enabled workspace is gone: stop and
    // say so instead of idling on a switched-off one. With no
    // enabled workspace at all there is nothing "lost" to report.
    val enabled = enabledWorkspaces()
    if (enabled.isEmpty()) {
      stopSelfSafely()
      return
    }
    if (enabled.all { it.slug in lostSlugs }) {
      socket?.stop()
      socket = null
      notifier.showNoWorkspace()
      stopSelfSafely()
      return
    }
    val via = WorkspaceRouting.connectVia(prefs.workspaces, lostSlugs)
    if (via == null) stopSelfSafely() else socket?.start(via.slug)
  }

  override fun onUnauthorized() {
    // T2: stop, forget the session copy, tell the user once.
    store.clear()
    socket?.stop()
    socket = null
    if (stopRequested) {
      // Logout or switch-off already in progress: no "sign in again".
      stopSelfSafely()
      return
    }
    notifier.cancelAll()
    if (!prefs.reloginShown) {
      prefs.reloginShown = true
      notifier.showRelogin()
    }
    stopSelfSafely()
  }

  private fun reconcile(workspace: Workspace, entries: List<InboxEntry>) {
    val unread = entries.filter { !it.read && !it.archived }
    notifier.retainOnly(workspace.slug, unread.map { it.id }.toSet())
    var summaryOnly = 0
    for (e in unread.sortedBy { it.createdAtMs ?: 0L }) {
      if (handleEntry(workspace, e, fromReconcile = true) == InboxDecider.Action.SummaryOnly) {
        summaryOnly++
      }
    }
    notifier.addSummaryOnly(summaryOnly)
  }

  private fun handleEntry(
    workspace: Workspace,
    entry: InboxEntry,
    fromReconcile: Boolean,
  ): InboxDecider.Action {
    // Logout while this thread was in a REST call: nothing after it.
    if (stopRequested) return InboxDecider.Action.Ignore
    val ids = seen.getOrPut(workspace.slug) { loadSeen(workspace.slug) }
    val cal = Calendar.getInstance()
    val action = InboxDecider.decide(
      entry = entry,
      alreadySeen = ids.contains(entry.id),
      settings = prefs.pingSettings(),
      localMinutes = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE),
      nowMs = System.currentTimeMillis(),
      fromReconcile = fromReconcile,
      foregroundIssueId = prefs.foregroundIssueId,
    )
    if (ids.add(entry.id)) saveSeen(workspace.slug, ids)
    if (action is InboxDecider.Action.Notify) {
      notifier.notifyEntry(workspace, entry, action.channel, action.category)
    }
    return action
  }

  private fun updateConnectionNotification() {
    // One socket serves every enabled workspace.
    connectedCount = NotifyDisplay.connectedCount(socket?.connected == true, prefs.workspaces)
    val refusedNow = refused
    try {
      androidx.core.app.NotificationManagerCompat.from(this).notify(
        Notifier.ID_CONNECTION,
        notifier.connectionNotification(connectedCount > 0, connectedCount, refusedNow),
      )
    } catch (_: SecurityException) {
    }
  }

  private fun registerNetwork() {
    if (networkCallback != null) return
    val cm = getSystemService(ConnectivityManager::class.java) ?: return
    val cb = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) {
        handler.post { socket?.reconnectNow() }
      }

      override fun onLost(network: Network) {
        handler.post { socket?.networkLost() }
      }
    }
    try {
      cm.registerDefaultNetworkCallback(cb)
      networkCallback = cb
    } catch (_: Exception) {
    }
  }

  private fun unregisterNetwork() {
    val cb = networkCallback ?: return
    networkCallback = null
    try {
      getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(cb)
    } catch (_: Exception) {
    }
  }

  private fun stopSelfSafely() {
    running = false
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun seenFile(slug: String) =
    File(noBackupFilesDir, "rb_notify_seen_" + slug.replace(Regex("[^A-Za-z0-9_-]"), "_") + ".txt")

  private fun loadSeen(slug: String): SeenIds = try {
    SeenIds.parse(seenFile(slug).takeIf { it.exists() }?.readText())
  } catch (_: Exception) {
    SeenIds()
  }

  private fun saveSeen(slug: String, ids: SeenIds) {
    try {
      seenFile(slug).writeText(ids.serialize())
    } catch (_: Exception) {
    }
  }

  companion object {
    @Volatile var running = false
      private set
    @Volatile var connectedCount = 0
      private set

    /**
     * Set synchronously by [stop]: the service may still be running its
     * last callbacks; none of them may restart the socket or report "sign in
     * again" after an intended stop. Cleared by [start].
     */
    @Volatile var stopRequested = false
      private set

    /** Start (or re-sync) from the app in the foreground or from BootReceiver. */
    fun start(context: Context) {
      stopRequested = false
      Notifier.get(context).reopen()
      val intent = Intent(context, OperatorConnectionService::class.java)
      ContextCompat.startForegroundService(context, intent)
    }

    fun stop(context: Context) {
      stopRequested = true
      context.stopService(Intent(context, OperatorConnectionService::class.java))
    }

    /** Remove per-workspace state files (logout). */
    fun clearState(context: Context) {
      context.noBackupFilesDir.listFiles()?.forEach {
        if (it.name.startsWith("rb_notify_seen_") || it.name == Notifier.STATE_FILE) it.delete()
      }
    }
  }
}

/** OkHttp behind InboxSocket.Transport; CF headers as for every request. */
private class OkHttpTransport(private val store: CredentialStore) : InboxSocket.Transport {
  override fun connect(url: String, events: InboxSocket.Events): InboxSocket.Connection {
    val b = Request.Builder().url(url)
    store.load()?.let { InboxApi.applyCfHeaders(b, it, it.baseUrl) }
    val ws = InboxApi.client.newWebSocket(b.build(), object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: Response) = events.onOpen()
      override fun onMessage(webSocket: WebSocket, text: String) = events.onMessage(text)
      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = events.onClosed()
      override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) =
        events.onFailure(response?.code)
    })
    return object : InboxSocket.Connection {
      override fun send(text: String) = ws.send(text)
      override fun cancel() = ws.cancel()
    }
  }
}

private class HandlerScheduler(private val handler: Handler) : InboxSocket.Scheduler {
  override fun post(task: Runnable) {
    handler.post(task)
  }
  override fun postDelayed(task: Runnable, delayMs: Long) {
    handler.postDelayed(task, delayMs)
  }
  override fun remove(task: Runnable) = handler.removeCallbacks(task)
  override fun now(): Long = SystemClock.elapsedRealtime()
}
