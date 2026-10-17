package com.recordingbeats.rbnotify

import kotlin.random.Random

/**
 * The one Multica WebSocket of the service:
 * token only in the first frame, `auth_ack` within 10 s, backoff
 * with jitter, immediate retry when the network returns.
 *
 * Pure Kotlin: OkHttp and the Android handler sit behind [Transport] and
 * [Scheduler], so the rules below are unit-tested on the JVM:
 * - at most one connection: a new open cancels the previous one, and
 *   `reconnectNow` does nothing while a connection exists or is opening;
 * - callbacks of an older connection (generation) are ignored, including
 *   `onOpen`, so a stale socket never authenticates;
 * - only an explicit token rejection reports [Listener.onUnauthorized];
 *   network errors and the auth timeout only reconnect.
 * All methods and callbacks run on the scheduler's thread.
 */
class InboxSocket(
  private val transport: Transport,
  private val scheduler: Scheduler,
  private val credentials: () -> Creds?,
  private val listener: Listener,
  private val random: () -> Double = { Random.nextDouble() },
) {
  data class Creds(val baseUrl: String, val token: String)

  interface Transport {
    fun connect(url: String, events: Events): Connection
  }

  interface Connection {
    fun send(text: String): Boolean
    fun cancel()
  }

  /** Called from any thread; InboxSocket hops onto the scheduler. */
  interface Events {
    fun onOpen()
    fun onMessage(text: String)
    fun onClosed()
    fun onFailure(httpCode: Int?)
  }

  interface Scheduler {
    fun post(task: Runnable)
    fun postDelayed(task: Runnable, delayMs: Long)
    fun remove(task: Runnable)
    fun now(): Long
  }

  interface Listener {
    fun onConnected()
    fun onFrame(frame: WsFrame)
    fun onUnauthorized()
    fun onWorkspaceLost(slug: String)
    fun onDisconnected()
    /** The upgrade was refused with 403 (Cloudflare Access?); retrying. */
    fun onRefused()
  }

  var connected = false
    private set
  /** Slug the current connection was opened with. */
  var slug: String? = null
    private set
  private var conn: Connection? = null
  private var attempt = 0
  private var connectedAt = 0L
  private var stopped = true
  private var generation = 0
  private val reconnect = Runnable { open() }
  private val authTimeout = Runnable { onAuthTimeout() }

  fun start(slug: String) {
    stopped = false
    this.slug = slug
    attempt = 0
    // A pending backoff must not tear down the fresh connection later.
    scheduler.remove(reconnect)
    open()
  }

  /** The default network went away: drop now instead of waiting for pings. */
  fun networkLost() {
    if (stopped || conn == null) return
    dropped()
  }

  fun stop() {
    stopped = true
    generation++
    scheduler.remove(reconnect)
    scheduler.remove(authTimeout)
    conn?.cancel()
    conn = null
    connected = false
  }

  /** Network came back: skip the remaining backoff, but never open a second socket. */
  fun reconnectNow() {
    if (stopped || conn != null) return
    scheduler.remove(reconnect)
    attempt = 0
    open()
  }

  private fun open() {
    if (stopped) return
    val target = slug ?: return
    val creds = credentials() ?: run {
      listener.onUnauthorized()
      return
    }
    // One connection only.
    conn?.cancel()
    scheduler.remove(authTimeout)
    connected = false
    val gen = ++generation
    val url = creds.baseUrl.trimEnd('/').replaceFirst(Regex("^http"), "ws") +
      "/ws?workspace_slug=" + java.net.URLEncoder.encode(target, "UTF-8") +
      "&client_platform=mobile"
    conn = transport.connect(url, object : Events {
      override fun onOpen() = scheduler.post {
        if (gen != generation) return@post
        conn?.send(authFrame(creds.token))
        scheduler.postDelayed(authTimeout, AUTH_TIMEOUT_MS)
      }

      override fun onMessage(text: String) {
        val frame = WsFrame.parse(text)
        scheduler.post { if (gen == generation) handle(frame) }
      }

      override fun onClosed() = scheduler.post { if (gen == generation) dropped() }

      override fun onFailure(httpCode: Int?) = scheduler.post {
        if (gen != generation) return@post
        fail(AuthFailure.fromHttp(httpCode))
      }
    })
  }

  private fun handle(frame: WsFrame) {
    when (frame) {
      is WsFrame.AuthAck -> {
        scheduler.remove(authTimeout)
        connected = true
        connectedAt = scheduler.now()
        listener.onConnected()
      }
      is WsFrame.AuthError -> fail(AuthFailure.fromMessage(frame.message))
      else -> if (connected) listener.onFrame(frame)
    }
  }

  private fun fail(kind: AuthFailure) {
    when (kind) {
      AuthFailure.Rejected -> {
        stop()
        listener.onUnauthorized()
      }
      AuthFailure.WorkspaceLost -> {
        val lost = slug
        stop()
        if (lost != null) listener.onWorkspaceLost(lost)
      }
      AuthFailure.Refused -> {
        listener.onRefused()
        dropped()
      }
      AuthFailure.Transient -> dropped()
    }
  }

  private fun onAuthTimeout() {
    if (stopped || connected) return
    dropped()
  }

  private fun dropped() {
    val wasConnected = connected
    connected = false
    scheduler.remove(authTimeout)
    generation++ // late callbacks of the dropped connection are ignored
    conn?.cancel()
    conn = null
    if (wasConnected) {
      if (scheduler.now() - connectedAt >= Backoff.STABLE_MS) attempt = 0
      listener.onDisconnected()
    }
    if (stopped) return
    scheduler.remove(reconnect)
    scheduler.postDelayed(reconnect, Backoff.delayMs(attempt++, random()))
  }

  companion object {
    const val AUTH_TIMEOUT_MS = 10_000L

    fun authFrame(token: String): String =
      org.json.JSONObject()
        .put("type", "auth")
        .put("payload", org.json.JSONObject().put("token", token))
        .toString()
  }
}
