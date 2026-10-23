package com.recordingbeats.rbnotify

import java.io.IOException
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HttpClientGuardTest {
  @Test
  fun firstReportedNetworkIsNoChange() {
    val t = NetworkChangeTracker()
    assertFalse(t.onAvailable(1))
    assertFalse(t.onAvailable(1))
  }

  @Test
  fun switchingNetworksResets() {
    val t = NetworkChangeTracker()
    t.onAvailable(1)
    assertTrue(t.onAvailable(2)) // Wi-Fi → mobile without a loss in between
  }

  @Test
  fun lossAndReturnReset() {
    val t = NetworkChangeTracker()
    t.onAvailable(1)
    assertTrue(t.onLost(1))
    assertTrue(t.onAvailable(1)) // airplane mode off: same network back
  }

  @Test
  fun lossOfAnotherNetworkIsIgnored() {
    val t = NetworkChangeTracker()
    t.onAvailable(1)
    assertFalse(t.onLost(7))
  }

  /** A request on a connection that never answers (like a pooled HTTP/2
   *  connection on a gone network, no read timeout as in React Native) is
   *  released by reset() instead of hanging. */
  @Test
  fun resetCancelsHangingCallsAndEmptiesPool() = hangingCall { client -> HttpClientGuard.reset(client) }

  /** The network-callback path resets on the guard thread (closing TLS on
   *  the main thread crashed the app: NetworkOnMainThreadException). */
  @Test
  fun workerResetCancelsHangingCalls() = hangingCall { client ->
    HttpClientGuard.resetOnWorker(listOf(client))
  }

  private fun hangingCall(doReset: (OkHttpClient) -> Unit) {
    ServerSocket(0).use { server ->
      val accepted = Thread { runCatching { server.accept() } }.apply { start() }
      val client = OkHttpClient.Builder().readTimeout(0, TimeUnit.MILLISECONDS).build()
      val failed = CountDownLatch(1)
      var error: IOException? = null
      val call = client.newCall(Request.Builder().url("http://127.0.0.1:${server.localPort}/").build())
      call.enqueue(object : Callback {
          override fun onFailure(call: Call, e: IOException) {
            error = e
            failed.countDown()
          }

          override fun onResponse(call: Call, response: Response) = response.close()
        })
      accepted.join(5_000)
      assertEquals(1, client.dispatcher.runningCallsCount())

      doReset(client)

      assertTrue("call still hanging", failed.await(5, TimeUnit.SECONDS))
      assertTrue(error.toString(), call.isCanceled())
      client.connectionPool.evictAll()
      assertEquals(0, client.connectionPool.connectionCount())
    }
  }

  @Test
  fun pingIntervalIsShort() {
    assertTrue(HttpClientGuard.PING_INTERVAL_S in 5..30)
  }
}
