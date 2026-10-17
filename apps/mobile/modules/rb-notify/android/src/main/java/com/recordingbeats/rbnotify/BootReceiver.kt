package com.recordingbeats.rbnotify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Restarts the service after a reboot or an app update when it is switched
 * on and a session copy exists (docs/TECHNIK.md §1.7). Not exported; only
 * the two system broadcasts below are accepted (T4) — both may start a
 * `specialUse` foreground service.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action
    if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    val prefs = NotifyPrefs(context)
    if (!prefs.serviceWanted() || !CredentialStore(context).exists()) return
    try {
      OperatorConnectionService.start(context)
    } catch (_: Exception) {
      // Background start refused (e.g. restricted app); next app start retries.
    }
  }
}
