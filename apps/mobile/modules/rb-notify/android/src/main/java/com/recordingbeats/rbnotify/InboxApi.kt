package com.recordingbeats.rbnotify

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * Minimal REST access of the service. Same headers as the JS client
 * (`data/api.ts`): Bearer token, `X-Workspace-Slug`, Cloudflare Access
 * service token — the CF headers only to the configured host (T6). No
 * logging interceptor; OkHttp uses the platform trust store, i.e. the app's
 * networkSecurityConfig (user CA for the Local/VPN mode), no own TrustManager.
 */
class InboxApi(context: Context) {
  private val store = CredentialStore(context.applicationContext)

  sealed class Result<out T> {
    data class Ok<T>(val value: T) : Result<T>()
    object Unauthorized : Result<Nothing>()
    data class Failed(val code: Int) : Result<Nothing>()
  }

  fun listInbox(slug: String): Result<List<InboxEntry>> {
    val creds = store.load() ?: return Result.Unauthorized
    val req = request(creds, slug, "/api/inbox").get().build()
    return try {
      client.newCall(req).execute().use { res ->
        when {
          res.code == 401 -> Result.Unauthorized
          !res.isSuccessful -> Result.Failed(res.code)
          else -> Result.Ok(InboxEntry.listFromJson(res.body?.string() ?: "[]"))
        }
      }
    } catch (_: Exception) {
      Result.Failed(0)
    }
  }

  fun markRead(slug: String, itemIds: List<String>) {
    val creds = store.load() ?: return
    for (id in itemIds) {
      val req = request(creds, slug, "/api/inbox/$id/read")
        .post("".toRequestBody(JSON))
        .build()
      try {
        client.newCall(req).execute().close()
      } catch (_: Exception) {
        // Best effort: the entry stays unread and comes back on next reconcile.
      }
    }
  }

  private fun request(creds: Credentials, slug: String, path: String): Request.Builder {
    val b = Request.Builder()
      .url(creds.baseUrl.trimEnd('/') + path)
      .header("Authorization", "Bearer ${creds.token}")
      .header("X-Workspace-Slug", slug)
      .header("X-Client-Platform", "mobile")
    applyCfHeaders(b, creds, creds.baseUrl)
    return b
  }

  companion object {
    private val JSON = "application/json".toMediaType()

    val client: OkHttpClient by lazy {
      OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        // Server pings every 54 s; our own ping only detects dead sockets.
        .pingInterval(4, TimeUnit.MINUTES)
        // T6 (review #14, PR #18): never follow a redirect. OkHttp would send
        // the CF Access headers along, e.g. to the Access login page; REST
        // and the WebSocket upgrade share this client.
        .followRedirects(false)
        .followSslRedirects(false)
        .build()
    }

    /** CF Access headers only when the request goes to the configured host. */
    fun applyCfHeaders(b: Request.Builder, creds: Credentials, url: String) {
      if (creds.cfClientId.isEmpty() || creds.cfClientSecret.isEmpty()) return
      val host = try {
        java.net.URI(url).host
      } catch (_: Exception) {
        null
      }
      if (host == null || host != creds.host()) return
      b.header("CF-Access-Client-Id", creds.cfClientId)
      b.header("CF-Access-Client-Secret", creds.cfClientSecret)
    }
  }
}
