package com.recordingbeats.rbnotify

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class CredentialsRecord : Record {
  @Field val baseUrl: String = ""
  @Field val token: String = ""
  @Field val cfClientId: String = ""
  @Field val cfClientSecret: String = ""
}

class WorkspaceRecord : Record {
  @Field val id: String = ""
  @Field val slug: String = ""
  @Field val name: String = ""
  @Field val enabled: Boolean = true
}

class SettingsRecord : Record {
  @Field val enabled: Boolean = false
  @Field val connectionEnabled: Boolean = true
  @Field val disabledCategories: List<String> = emptyList()
  @Field val quietStart: String? = null
  @Field val quietEnd: String? = null
  @Field val disabledWorkspaces: List<String> = emptyList()
}

/**
 * JS bridge of the operator notifications. The
 * session hand-over/clear functions are synchronous so a logout cannot
 * return before the native copy is gone.
 */
class RbNotifyModule : Module() {
  private val ctx: Context
    get() = appContext.reactContext?.applicationContext
      ?: throw IllegalStateException("no React context")

  override fun definition() = ModuleDefinition {
    Name("RbNotify")

    Function("setCredentials") { c: CredentialsRecord ->
      if (c.baseUrl.isEmpty() || c.token.isEmpty()) return@Function false
      CredentialStore(ctx).save(Credentials(c.baseUrl, c.token, c.cfClientId, c.cfClientSecret))
      NotifyPrefs(ctx).reloginShown = false
      Notifier.get(ctx).reopen() // new session after a logout
      true
    }

    Function("clearCredentials") {
      // Stop first and synchronously: a reconnect racing the logout must
      // not report "please sign in again" for a session the user ended.
      OperatorConnectionService.stop(ctx)
      CredentialStore(ctx).clear()
      Notifier.get(ctx).cancelAll()
      OperatorConnectionService.clearState(ctx)
      NotifyPrefs(ctx).clearSession()
    }

    Function("hasCredentials") { CredentialStore(ctx).exists() }

    Function("setWorkspaces") { list: List<WorkspaceRecord> ->
      NotifyPrefs(ctx).workspaces = list.filter { it.slug.isNotEmpty() }
        .map { Workspace(it.id, it.slug, it.name, it.enabled) }
    }

    Function("setSettings") { s: SettingsRecord ->
      val p = NotifyPrefs(ctx)
      p.enabled = s.enabled
      p.connectionEnabled = s.connectionEnabled
      p.disabledCategories = s.disabledCategories.filter { it in PingRule.CATEGORIES }.toSet()
      p.quietStart = s.quietStart?.takeIf { PingRule.parseHhMm(it) != null }
      p.quietEnd = s.quietEnd?.takeIf { PingRule.parseHhMm(it) != null }
      p.disabledWorkspaces = s.disabledWorkspaces.toSet()
    }

    Function("getSettings") {
      val p = NotifyPrefs(ctx)
      mapOf(
        "enabled" to p.enabled,
        "connectionEnabled" to p.connectionEnabled,
        "disabledCategories" to p.disabledCategories.toList(),
        "quietStart" to p.quietStart,
        "quietEnd" to p.quietEnd,
        "disabledWorkspaces" to p.disabledWorkspaces.toList(),
      )
    }

    Function("setStrings") { map: Map<String, String> ->
      NotifyPrefs(ctx).setStrings(map)
      Notifier.get(ctx).ensureChannels()
    }

    Function("setActors") { map: Map<String, String> -> NotifyPrefs(ctx).setActors(map) }

    // `dismiss` only for an open from inside the app or the app's own
    // notification (nonce): a deep link from another app must not remove
    // the notification (same rule as T5).
    Function("setForegroundIssue") { issueId: String?, dismiss: Boolean ->
      NotifyPrefs(ctx).foregroundIssueId = issueId
      if (issueId != null && dismiss) Notifier.get(ctx).cancelIssue(issueId)
    }

    /** Start or re-sync; only call while the app is in the foreground. */
    Function("start") {
      val p = NotifyPrefs(ctx)
      if (!p.serviceWanted() || !CredentialStore(ctx).exists()) {
        OperatorConnectionService.stop(ctx)
        return@Function false
      }
      Notifier.get(ctx).ensureChannels()
      OperatorConnectionService.start(ctx)
      true
    }

    Function("stop") { OperatorConnectionService.stop(ctx) }

    Function("getStatus") {
      val pm = ctx.getSystemService(PowerManager::class.java)
      mapOf(
        "running" to OperatorConnectionService.running,
        "connected" to OperatorConnectionService.connectedCount,
        "notificationsEnabled" to NotificationManagerCompat.from(ctx).areNotificationsEnabled(),
        "permissionGranted" to (
          Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
          ),
        "batteryExempt" to (pm?.isIgnoringBatteryOptimizations(ctx.packageName) ?: false),
        "sdk" to Build.VERSION.SDK_INT,
      )
    }

    /** Notification tap nonce (T5 narrow variant): true once per issued nonce. */
    Function("consumeNonce") { nonce: String, issueId: String ->
      NonceStore(ctx).consume(nonce, issueId)
    }

    Function("requestIgnoreBatteryOptimizations") {
      val intent = Intent(
        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
        Uri.parse("package:" + ctx.packageName),
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        ctx.startActivity(intent)
        true
      } catch (_: Exception) {
        false
      }
    }

    Function("openNotificationSettings") { channelId: String? ->
      val intent = if (channelId != null && Build.VERSION.SDK_INT >= 26) {
        Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
          .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
          .putExtra(Settings.EXTRA_CHANNEL_ID, channelId)
      } else {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
          .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
      }
      ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** Debug builds only: post a sample notification through the real path (UX §8.9 test trigger). */
    Function("debugNotify") { slug: String, issueId: String, title: String ->
      if (!BuildConfig.DEBUG) return@Function false
      val ws = NotifyPrefs(ctx).workspaces.firstOrNull { it.slug == slug }
        ?: Workspace("", slug, slug, true)
      Notifier.get(ctx).ensureChannels()
      val entry = InboxEntry(
        id = "debug-" + System.currentTimeMillis(),
        workspaceId = null,
        issueId = issueId,
        type = "mentioned",
        severity = "info",
        title = title,
        body = "Debug",
        read = false,
        archived = false,
        createdAtMs = System.currentTimeMillis(),
        detailsTo = null,
        commentId = null,
        actorId = null,
      )
      Notifier.get(ctx).notifyEntry(ws, entry, Channels.MENTIONS, PingRule.MENTIONS)
      true
    }
  }
}
