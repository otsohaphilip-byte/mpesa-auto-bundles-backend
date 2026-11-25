package com.mpesaautobundles.app

import android.accessibilityservice.AccessibilityService
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import java.net.HttpURLConnection
import java.net.URL

class BundleAutomationAccessibilityService : AccessibilityService() {

    private val heartbeatHandler = Handler(Looper.getMainLooper())

    private val heartbeatRunnable = object : Runnable {
        override fun run() {
            sendAdminGatewayHeartbeat()
            heartbeatHandler.postDelayed(this, HEARTBEAT_INTERVAL)
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()

        getSharedPreferences("app_setup", MODE_PRIVATE)
            .edit()
            .putBoolean("accessibility_was_enabled", true)
            .putLong(
                "accessibility_last_connected",
                System.currentTimeMillis()
            )
            .apply()

        heartbeatHandler.removeCallbacks(heartbeatRunnable)
        heartbeatHandler.post(heartbeatRunnable)

        Log.i(TAG, "Bundle automation service connected")
    }

    private fun sendAdminGatewayHeartbeat() {
        Thread {
            var connection: HttpURLConnection? = null

            try {
                val deviceToken = getSharedPreferences(
                    "admin_agent_gateway",
                    MODE_PRIVATE
                ).getString("device_token", "") ?: ""

                if (deviceToken.isBlank()) {
                    return@Thread
                }

                connection = URL(
                    "https://mpesa-auto-bundles-backend.onrender.com/api/admin/ussd/device/heartbeat"
                ).openConnection() as HttpURLConnection

                connection.requestMethod = "POST"
                connection.connectTimeout = 20000
                connection.readTimeout = 20000
                connection.doOutput = true

                connection.setRequestProperty(
                    "X-Device-Token",
                    deviceToken
                )

                connection.setRequestProperty(
                    "Content-Type",
                    "application/json"
                )

                connection.outputStream.use {
                    it.write("{}".toByteArray(Charsets.UTF_8))
                }

                val code = connection.responseCode

                Log.i(TAG, "Admin gateway heartbeat HTTP $code")

            } catch (e: Exception) {
                Log.e(TAG, "Admin gateway heartbeat failed", e)
            } finally {
                connection?.disconnect()
            }
        }.start()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return

        val packageName = event.packageName?.toString() ?: return
        val className = event.className?.toString() ?: ""

        val isPhoneScreen =
            packageName.contains("phone", ignoreCase = true) ||
            packageName.contains("telephony", ignoreCase = true)

        if (!isPhoneScreen) return

        val eventText = event.text
            .joinToString(" ")
            .lowercase()

        val isLikelyUssd =
            eventText.contains("ussd") ||
            eventText.contains("safaricom") ||
            className.contains("alertdialog", ignoreCase = true)

        if (isLikelyUssd) {
            getSharedPreferences("app_setup", MODE_PRIVATE)
                .edit()
                .putBoolean("ussd_screen_detected", true)
                .putLong(
                    "ussd_screen_detected_at",
                    System.currentTimeMillis()
                )
                .apply()

            val activeDelivery =
                LocalDeliveryDatabase(this).getActiveDelivery()

            if (activeDelivery != null) {
                val activeRole =
                    activeDelivery.getAsString("role") ?: "unknown"

                val activeOffer =
                    activeDelivery.getAsString("offer_name") ?: "unknown"

                Log.i(
                    TAG,
                    "USSD linked to active delivery: role=$activeRole, offer=$activeOffer"
                )
            } else {
                Log.w(TAG, "USSD detected but no active delivery was saved")
            }
            
            Log.i(TAG, "Likely USSD screen detected")
        }
    }

    override fun onInterrupt() {
        heartbeatHandler.removeCallbacks(heartbeatRunnable)
        Log.w(TAG, "Bundle automation service interrupted")
    }

    override fun onDestroy() {
        heartbeatHandler.removeCallbacks(heartbeatRunnable)
        super.onDestroy()
    }

    companion object {
        private const val TAG = "MAB_Automation"
        private const val HEARTBEAT_INTERVAL = 5 * 60 * 1000L
    }
}
