package com.recordingbeats.rbnotify

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The service's copy of the session.
 *
 * AES-256-GCM with a key in the Android Keystore, created WITHOUT user
 * authentication so the service can read it while the device is locked. The
 * ciphertext lives in `noBackupFilesDir` (never part of Auto Backup or device
 * transfer; the backup rules exclude it explicitly as well). No
 * EncryptedSharedPreferences (deprecated), nothing in Intent extras,
 * WorkManager input or plain prefs.
 *
 * Written only by JS after a successful login/renewal commit; cleared
 * synchronously on logout, clearToken, server reset and on a 401 seen by the
 * service.
 */
data class Credentials(
  val baseUrl: String,
  val token: String,
  /** Cloudflare Access service token, both empty in direct mode. */
  val cfClientId: String,
  val cfClientSecret: String,
) {
  fun toJson(): String = JSONObject()
    .put("baseUrl", baseUrl)
    .put("token", token)
    .put("cfClientId", cfClientId)
    .put("cfClientSecret", cfClientSecret)
    .toString()

  /** Host the CF headers may be sent to (only the configured host). */
  fun host(): String? = try {
    java.net.URI(baseUrl).host
  } catch (_: Exception) {
    null
  }

  companion object {
    fun fromJson(text: String): Credentials? = try {
      val o = JSONObject(text)
      Credentials(
        o.getString("baseUrl"),
        o.getString("token"),
        o.optString("cfClientId", ""),
        o.optString("cfClientSecret", ""),
      ).takeIf { it.baseUrl.isNotEmpty() && it.token.isNotEmpty() }
    } catch (_: Exception) {
      null
    }
  }
}

class CredentialStore(context: Context) {
  private val file = File(context.noBackupFilesDir, FILE_NAME)

  @Synchronized
  fun save(credentials: Credentials) {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val iv = cipher.iv
    val sealed = cipher.doFinal(credentials.toJson().toByteArray(Charsets.UTF_8))
    val tmp = File(file.parentFile, "$FILE_NAME.tmp")
    tmp.writeBytes(byteArrayOf(iv.size.toByte()) + iv + sealed)
    if (!tmp.renameTo(file)) {
      file.delete()
      tmp.renameTo(file)
    }
  }

  @Synchronized
  fun load(): Credentials? {
    if (!file.exists()) return null
    return try {
      val bytes = file.readBytes()
      val ivLen = bytes[0].toInt()
      val iv = bytes.copyOfRange(1, 1 + ivLen)
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
      val plain = cipher.doFinal(bytes.copyOfRange(1 + ivLen, bytes.size))
      Credentials.fromJson(String(plain, Charsets.UTF_8))
    } catch (_: Exception) {
      // Key lost (e.g. restored onto another device) or file damaged: the
      // copy is worthless, drop it. JS hands over a fresh one on next start.
      file.delete()
      null
    }
  }

  @Synchronized
  fun clear() {
    file.delete()
    File(file.parentFile, "$FILE_NAME.tmp").delete()
  }

  fun exists(): Boolean = file.exists()

  private fun key(): SecretKey {
    val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    (ks.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
    gen.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .setRandomizedEncryptionRequired(true)
        // Deliberately no setUserAuthenticationRequired: the service must
        // read the session while the screen is locked.
        .build(),
    )
    return gen.generateKey()
  }

  companion object {
    const val FILE_NAME = "rb_notify_session.bin"
    private const val KEY_ALIAS = "rb_notify_session_key"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
  }
}
