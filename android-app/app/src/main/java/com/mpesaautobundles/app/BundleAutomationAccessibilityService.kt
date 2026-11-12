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

        // Approved bundle automation will be added here.
        // This service does not collect passwords, M-Pesa PINs,
        // personal messages, or unrelated screen content.
    }

    override fun onInterrupt() {
        Log.w(TAG, "Bundle automation service interrupted")
    }

    companion object {
        private const val TAG = "MAB_Automation"
    }
}
