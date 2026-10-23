package com.recordingbeats.rbnotify

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import java.lang.ref.WeakReference
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient

/**
 * Keeps JS `fetch` alive across a network change (smoke 6b).
 *
 * React Native's NetworkingModule builds its own OkHttpClient with no read
 * timeout and no HTTP/2 ping. The Multica server (Cloudflare and local) speaks
 * HTTP/2, so every request shares ONE pooled connection. After Wi-Fi/mobile
 * off → on, that connection is bound to the gone network: it never errors,
 * every new request is multiplexed onto it and hangs until the JS 30 s abort,
 * which cancels the stream but not the connection. The WebSocket has its own
 * client and reconnects fine; only an app restart (new pool) helped.
 *
 * Two measures, both on the client this factory hands to NetworkingModule:
 *   - default-network change or loss → cancel in-flight calls and evict the
 *     pool, so the next request dials a fresh connection on the new network;
 *   - HTTP/2 ping every PING_INTERVAL_S as a backstop for a connection that
 *     dies silently without a network change (NAT/proxy timeout). OkHttp
 *     pings only while a connection is open; the pool drops idle ones after
 *     5 min, so this is no polling.
 *
 * Installed from [RbNotifyPackage] in Application.onCreate, i.e. before the
 * first NetworkingModule is created.
 */
object HttpClientGuard {
  const val PING_INTERVAL_S = 15L
  /** Second eviction after cancelAll(): cancelled calls release their
   *  connection asynchronously, and evictAll() skips connections in use. */
  private const val SECOND_EVICT_MS = 1_000L

  private val clients = mutableListOf<WeakReference<OkHttpClient>>()
  /** Never the main thread: closing a TLS connection writes close_notify,
   *  which StrictMode rejects there (NetworkOnMainThreadException, crash). */
  private val worker = Executors.newSingleThreadScheduledExecutor { r ->
    Thread(r, "rb-http-guard").apply { isDaemon = true }
  }
  private val tracker = NetworkChangeTracker()
  @Volatile private var installed = false

  fun install(context: Context) {
    if (installed) return
    installed = true
    val app = context.applicationContext
    OkHttpClientProvider.setOkHttpClientFactory(
      OkHttpClientFactory {
        OkHttpClientProvider.createClientBuilder(app)
          .pingInterval(PING_INTERVAL_S, TimeUnit.SECONDS)
          .build()
          .also { register(it) }
      },
    )
    val cm = app.getSystemService(ConnectivityManager::class.java) ?: return
    try {
      cm.registerDefaultNetworkCallback(
        object : ConnectivityManager.NetworkCallback() {
          override fun onAvailable(network: Network) {
            if (synchronized(tracker) { tracker.onAvailable(network.networkHandle) }) resetAll()
          }

          override fun onLost(network: Network) {
            if (synchronized(tracker) { tracker.onLost(network.networkHandle) }) resetAll()
          }
        },
      )
    } catch (_: RuntimeException) {
      // Callback limit or missing permission: the ping backstop still applies.
    }
  }

  private fun register(client: OkHttpClient) = synchronized(clients) {
    clients.removeAll { it.get() == null }
    clients.add(WeakReference(client))
  }

  private fun resetAll() = resetOnWorker(synchronized(clients) { clients.mapNotNull { it.get() } })

  /** Reset [live] on the guard thread, then evict once more. */
  internal fun resetOnWorker(live: List<OkHttpClient>) {
    worker.execute { live.forEach { runCatching { reset(it) } } }
    worker.schedule(
      { live.forEach { runCatching { it.connectionPool.evictAll() } } },
      SECOND_EVICT_MS,
      TimeUnit.MILLISECONDS,
    )
  }

  /** Drop every call and pooled connection of [client]. */
  internal fun reset(client: OkHttpClient) {
    client.dispatcher.cancelAll()
    client.connectionPool.evictAll()
  }
}

/**
 * Decides when the default network really changed. Android reports the
 * current network once right after registering — that is not a change.
 * Handles are compared because a [Network] object is per callback.
 */
internal class NetworkChangeTracker {
  private var current: Long? = null
  private var seen = false

  /** True when pooled connections may belong to another network. */
  fun onAvailable(handle: Long): Boolean {
    val first = !seen
    seen = true
    val changed = current != handle
    current = handle
    return !first && changed
  }

  /** True when the current default network went away. */
  fun onLost(handle: Long): Boolean {
    if (current != handle) return false
    current = null
    return true
  }
}
