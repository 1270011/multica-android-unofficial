package com.recordingbeats.rbnotify

import android.app.Application
import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/**
 * Application-start hook of rb-notify (found by Expo autolinking via the
 * `*Package.kt` name and the `Package` import). Installs [HttpClientGuard]
 * before React Native creates its networking client.
 */
class RbNotifyPackage : Package {
  override fun createApplicationLifecycleListeners(
    context: Context,
  ): List<ApplicationLifecycleListener> = listOf(
    object : ApplicationLifecycleListener {
      override fun onCreate(application: Application) {
        HttpClientGuard.install(application)
      }
    },
  )
}
