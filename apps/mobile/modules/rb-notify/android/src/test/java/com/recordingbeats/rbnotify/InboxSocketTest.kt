package com.recordingbeats.rbnotify

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** Review #14 B1/B2/4/5: one socket, routing by workspace_id, auth timeout. */
class InboxSocketTest {
  private class FakeConn : InboxSocket.Connection {
    val sent = mutableListOf<String>()
    var cancelled = false
    override fun send(text: String): Boolean { sent += text; return true }
    override fun cancel() { cancelled = true }
  }

  private class FakeTransport : InboxSocket.Transport {
    val opened = mutableListOf<Pair<FakeConn, InboxSocket.Events>>()
    val urls = mutableListOf<String>()
    override fun connect(url: String, events: InboxSocket.Events): InboxSocket.Connection {
      urls += url
      return FakeConn().also { opened += it to events }
    }
    fun open(i: Int) = opened[i].second.onOpen()
    fun message(i: Int, text: String) = opened[i].second.onMessage(text)
    fun fail(i: Int, code: Int?) = opened[i].second.onFailure(code)
  }

  /** Runs posted tasks at once; delayed ones wait for [advance]. */
  private class FakeScheduler : InboxSocket.Scheduler {
    var time = 0L
    val delayed = mutableListOf<Pair<Long, Runnable>>()
    override fun post(task: Runnable) = task.run()
    override fun postDelayed(task: Runnable, delayMs: Long) { delayed += (time + delayMs) to task }
    override fun remove(task: Runnable) { delayed.removeAll { it.second === task } }
    override fun now() = time
    fun advance(ms: Long) {
      time += ms
      val due = delayed.filter { it.first <= time }
      delayed.removeAll(due)
      due.forEach { it.second.run() }
    }
  }

  private class Events : InboxSocket.Listener {
    var connected = 0
    var unauthorized = 0
    var disconnected = 0
    var refused = 0
    val lost = mutableListOf<String>()
    val frames = mutableListOf<WsFrame>()
    override fun onConnected() { connected++ }
    override fun onFrame(frame: WsFrame) { frames += frame }
    override fun onUnauthorized() { unauthorized++ }
    override fun onWorkspaceLost(slug: String) { lost += slug }
    override fun onDisconnected() { disconnected++ }
    override fun onRefused() { refused++ }
  }

  private lateinit var transport: FakeTransport
  private lateinit var scheduler: FakeScheduler
  private lateinit var events: Events
  private lateinit var socket: InboxSocket

  @Before
  fun setUp() {
    transport = FakeTransport()
    scheduler = FakeScheduler()
    events = Events()
    socket = InboxSocket(transport, scheduler, { InboxSocket.Creds("https://m.example", "tok") }, events, { 0.0 })
  }

  private fun connect() {
    socket.start("rb")
    transport.open(transport.opened.lastIndex)
    transport.message(transport.opened.lastIndex, """{"type":"auth_ack"}""")
  }

  @Test
  fun authFrameIsTheFirstAndOnlyCredential() {
    socket.start("rb")
    assertTrue(transport.urls[0].startsWith("wss://m.example/ws?workspace_slug=rb"))
    assertFalse(transport.urls[0].contains("tok"))
    transport.open(0)
    assertEquals(listOf(InboxSocket.authFrame("tok")), transport.opened[0].first.sent)
  }

  @Test
  fun reconnectNowNeverOpensASecondSocket() {
    socket.start("rb")
    socket.reconnectNow() // network callback fires right after start
    assertEquals(1, transport.opened.size)
    transport.open(0)
    transport.message(0, """{"type":"auth_ack"}""")
    socket.reconnectNow()
    assertEquals(1, transport.opened.size)
    assertTrue(socket.connected)
  }

  @Test
  fun restartCancelsThePreviousSocketAndIgnoresItsCallbacks() {
    socket.start("rb")
    socket.start("other")
    assertEquals(2, transport.opened.size)
    assertTrue(transport.opened[0].first.cancelled)
    transport.open(0) // stale onOpen must not authenticate
    assertTrue(transport.opened[0].first.sent.isEmpty())
    transport.message(0, """{"type":"auth_ack"}""")
    assertFalse(socket.connected)
  }

  @Test
  fun missingAuthAckReconnectsAfterTenSecondsWithoutLoggingOut() {
    socket.start("rb")
    transport.open(0)
    scheduler.advance(InboxSocket.AUTH_TIMEOUT_MS - 1)
    assertEquals(1, transport.opened.size)
    scheduler.advance(1)
    assertTrue(transport.opened[0].first.cancelled)
    assertEquals(0, events.unauthorized)
    scheduler.advance(Backoff.CAP_MS)
    assertEquals(2, transport.opened.size)
  }

  @Test
  fun ackInTimeCancelsTheTimeout() {
    connect()
    scheduler.advance(InboxSocket.AUTH_TIMEOUT_MS * 3)
    assertTrue(socket.connected)
    assertEquals(1, transport.opened.size)
  }

  @Test
  fun onlyAnExplicitRejectionLogsOut() {
    socket.start("rb")
    transport.open(0)
    transport.message(0, """{"error":"auth timeout or read error"}""")
    transport.fail(0, null)
    assertEquals(0, events.unauthorized)

    scheduler.advance(Backoff.CAP_MS)
    transport.open(1)
    transport.message(1, """{"error":"invalid token"}""")
    assertEquals(1, events.unauthorized)
    scheduler.advance(Backoff.CAP_MS)
    assertEquals(2, transport.opened.size) // stopped, no reconnect
  }

  @Test
  fun http401LogsOutButNetworkErrorsDoNot() {
    socket.start("rb")
    transport.fail(0, null)
    scheduler.advance(Backoff.CAP_MS)
    transport.fail(1, 500) // each failure on the then-current socket
    scheduler.advance(Backoff.CAP_MS)
    assertEquals(3, transport.opened.size)
    assertEquals(0, events.unauthorized)
    transport.fail(2, 401)
    assertEquals(1, events.unauthorized)
  }

  @Test
  fun http403IsRefusedNotLostAndRetries() {
    socket.start("rb")
    transport.fail(0, 403)
    assertEquals(1, events.refused)
    assertTrue(events.lost.isEmpty())
    assertEquals(0, events.unauthorized)
    scheduler.advance(Backoff.CAP_MS)
    assertEquals(2, transport.opened.size)
  }

  @Test
  fun startCancelsAPendingBackoff() {
    socket.start("rb")
    transport.fail(0, null) // backoff scheduled
    socket.start("rb") // app start / workspace change opens right away
    transport.open(1)
    transport.message(1, """{"type":"auth_ack"}""")
    scheduler.advance(Backoff.CAP_MS)
    assertEquals(2, transport.opened.size)
    assertFalse(transport.opened[1].first.cancelled)
    assertTrue(socket.connected)
  }

  @Test
  fun networkLostDropsAndAllowsAnImmediateReconnect() {
    connect()
    socket.networkLost()
    assertFalse(socket.connected)
    assertTrue(transport.opened[0].first.cancelled)
    assertEquals(1, events.disconnected)
    socket.reconnectNow() // network back
    assertEquals(2, transport.opened.size)
  }

  @Test
  fun lostMembershipReportsTheSlug() {
    socket.start("gone")
    transport.open(0)
    transport.message(0, """{"error":"not a member of this workspace"}""")
    assertEquals(listOf("gone"), events.lost)
    assertEquals(0, events.unauthorized)
  }

  @Test
  fun framesOnlyAfterAuth() {
    socket.start("rb")
    transport.open(0)
    transport.message(0, """{"type":"inbox:batch-read"}""")
    assertTrue(events.frames.isEmpty())
    transport.message(0, """{"type":"auth_ack"}""")
    transport.message(0, """{"type":"inbox:batch-read"}""")
    assertEquals(1, events.frames.size)
  }

  @Test
  fun stopClosesTheSocketAndCancelsTimers() {
    connect()
    socket.stop()
    assertTrue(transport.opened[0].first.cancelled)
    assertFalse(socket.connected)
    socket.reconnectNow()
    scheduler.advance(Backoff.CAP_MS)
    assertEquals(1, transport.opened.size)
  }
}

class WorkspaceRoutingTest {
  private val a = Workspace("id-a", "a", "A", enabled = true)
  private val b = Workspace("id-b", "b", "B", enabled = false)
  private val c = Workspace("id-c", "c", "C", enabled = true)

  @Test
  fun routesByWorkspaceIdToEnabledWorkspacesOnly() {
    assertEquals(c, WorkspaceRouting.forEntry("id-c", listOf(a, b, c)))
    assertNull(WorkspaceRouting.forEntry("id-b", listOf(a, b, c)))
    assertNull(WorkspaceRouting.forEntry("id-x", listOf(a, b, c)))
    assertNull(WorkspaceRouting.forEntry(null, listOf(a, b, c)))
  }

  @Test
  fun connectsViaAnEnabledWorkspaceAndSkipsLostOnes() {
    assertEquals(a, WorkspaceRouting.connectVia(listOf(b, a, c)))
    assertEquals(c, WorkspaceRouting.connectVia(listOf(a, b, c), setOf("a")))
    assertEquals(b, WorkspaceRouting.connectVia(listOf(a, b, c), setOf("a", "c")))
    assertNull(WorkspaceRouting.connectVia(listOf(a), setOf("a")))
  }

  @Test
  fun classifiesServerAuthErrors() {
    assertEquals(AuthFailure.Rejected, AuthFailure.fromMessage("invalid token"))
    assertEquals(AuthFailure.Rejected, AuthFailure.fromMessage("account disabled"))
    assertEquals(AuthFailure.Rejected, AuthFailure.fromMessage("invalid claims"))
    assertEquals(AuthFailure.WorkspaceLost, AuthFailure.fromMessage("not a member of this workspace"))
    assertEquals(AuthFailure.Transient, AuthFailure.fromMessage("auth timeout or read error"))
    assertEquals(AuthFailure.Transient, AuthFailure.fromHttp(null))
    assertEquals(AuthFailure.Rejected, AuthFailure.fromHttp(401))
    assertEquals(AuthFailure.Refused, AuthFailure.fromHttp(403))
    assertEquals(AuthFailure.Refused, AuthFailure.fromHttp(302))
    assertEquals(AuthFailure.Refused, AuthFailure.fromHttp(307))
    assertEquals(AuthFailure.WorkspaceLost, AuthFailure.fromHttp(404))
  }
}
