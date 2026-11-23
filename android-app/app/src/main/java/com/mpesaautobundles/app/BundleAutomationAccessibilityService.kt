package com.mpesaautobundles.app

import android.accessibilityservice.AccessibilityService
import android.util.Log
import android.view.accessibility.AccessibilityEvent

class BundleAutomationAccessibilityService : AccessibilityService() {

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

        Log.i(TAG, "Bundle automation service connected")
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

            Log.i(TAG, "Likely USSD screen detected")
        }
    }

    override fun onInterrupt() {
        Log.w(TAG, "Bundle automation service interrupted")
    }

    companion object {
        private const val TAG = "MAB_Automation"
    }
}
