package com.mpesaautobundles.app

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.os.Build
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import android.view.accessibility.AccessibilityEvent
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

class BundleAutomationAccessibilityService : AccessibilityService() {
        @Volatile
    private var reportingJobId: String? = null

    private val heartbeatHandler = Handler(Looper.getMainLooper())

    private val heartbeatRunnable = object : Runnable {
        override fun run() {
            sendAdminGatewayHeartbeat()
                        sendResellerGatewayHeartbeat()
            heartbeatHandler.postDelayed(this, HEARTBEAT_INTERVAL)
        }
    }
    private val jobPollingHandler = Handler(Looper.getMainLooper())

    @Volatile
    private var jobPollingInProgress = false
            @Volatile
    private var ussdSessionInProgress = false
        @Volatile
private var pendingSyncInProgress = false

    private val jobPollingRunnable = object : Runnable {
        override fun run() {
                recoverStaleActiveDelivery()
                syncPendingDeliveryResults()
            val adminToken = getSharedPreferences(
                "admin_agent_gateway",
                MODE_PRIVATE
            ).getString("device_token", "") ?: ""

            val resellerToken = getSharedPreferences(
                "agent_gateway",
                MODE_PRIVATE
            ).getString("device_token", "") ?: ""

            if (adminToken.isNotBlank()) {
                claimAndStartGatewayJob("admin", "admin_agent_gateway")
                                    } else if (resellerToken.isNotBlank()) {
                claimAndStartGatewayJob("reseller", "agent_gateway")
            }

            jobPollingHandler.postDelayed(this, JOB_POLL_INTERVAL)
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
        jobPollingHandler.removeCallbacks(jobPollingRunnable)
        jobPollingHandler.post(jobPollingRunnable)
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

                if (deviceToken.isBlank()) return@Thread

                connection = URL(
                    "https://mpesa-auto-bundles-backend.onrender.com/api/admin/ussd/device/heartbeat"
                ).openConnection() as HttpURLConnection

                connection.requestMethod = "POST"
                connection.connectTimeout = 20000
                connection.readTimeout = 20000
                connection.doOutput = true

                connection.setRequestProperty("X-Device-Token", deviceToken)
                connection.setRequestProperty("Content-Type", "application/json")

                connection.outputStream.use {
                    it.write("{}".toByteArray(Charsets.UTF_8))
                }

                Log.i(TAG, "Admin gateway heartbeat HTTP ${connection.responseCode}")

            } catch (e: Exception) {
                Log.e(TAG, "Admin gateway heartbeat failed", e)
            } finally {
                connection?.disconnect()
            }
        }.start()
    }

    private fun sendResellerGatewayHeartbeat() {
        Thread {
            var connection: HttpURLConnection? = null

            try {
                val deviceToken = getSharedPreferences(
                    "agent_gateway",
                    MODE_PRIVATE
                ).getString("device_token", "") ?: ""

                if (deviceToken.isBlank()) return@Thread

                connection = URL(
                    "https://mpesa-auto-bundles-backend.onrender.com/api/reseller/ussd/device/heartbeat"
                ).openConnection() as HttpURLConnection

                connection.requestMethod = "POST"
                connection.connectTimeout = 20000
                connection.readTimeout = 20000
                connection.doOutput = true

                connection.setRequestProperty("X-Device-Token", deviceToken)
                connection.setRequestProperty("Content-Type", "application/json")

                connection.outputStream.use {
                    it.write("{}".toByteArray(Charsets.UTF_8))
                }

                Log.i(TAG, "Reseller gateway heartbeat HTTP ${connection.responseCode}")

            } catch (e: Exception) {
                Log.e(TAG, "Reseller gateway heartbeat failed", e)
            } finally {
                connection?.disconnect()
            }
        }.start()
    }
        private fun claimAndStartGatewayJob(
        role: String,
        preferencesName: String
    ) {

                if (jobPollingInProgress || ussdSessionInProgress) return
        jobPollingInProgress = true

        Thread {
            var connection: HttpURLConnection? = null

            try {
                if (LocalDeliveryDatabase(this).getActiveDelivery() != null) {
                    return@Thread
                }

                val deviceToken = getSharedPreferences(
                    preferencesName,
                    MODE_PRIVATE
                ).getString("device_token", "") ?: ""

                if (deviceToken.isBlank()) return@Thread

                connection = URL(
                    "https://mpesa-auto-bundles-backend.onrender.com/api/ussd/jobs/claim"
                ).openConnection() as HttpURLConnection

                connection.requestMethod = "POST"
                connection.connectTimeout = 15000
                connection.readTimeout = 15000
                connection.doOutput = true

                connection.setRequestProperty("X-Device-Token", deviceToken)
                connection.setRequestProperty("Content-Type", "application/json")

                connection.outputStream.use {
                    it.write("{}".toByteArray(Charsets.UTF_8))
                }

                if (connection.responseCode != 200) {
                    Log.e(TAG, "Job claim failed: HTTP ${connection.responseCode}")
                    return@Thread
                }

                val response = connection.inputStream
                    .bufferedReader()
                    .use { it.readText() }

                val job = JSONObject(response).optJSONObject("job")
                    ?: return@Thread

                val jobId = job.optString("id", "")
                val jobRole = job.optString("gateway_role", "")
                val ownerId = if (role == "admin") {
                    job.optString("admin_phone", "")
                } else {
                    job.optString("reseller_id", "")
                }

                val phone = job.optString("destination_phone", "")
                val offerId = job.optString("offer_id", "")
                val offerName = job.optString("offer_name", "")
                val amount = job.optDouble("amount", -1.0)
                val ussdCode = job.optString("ussd_code", "")

                if (
                    jobId.isBlank() ||
                    jobRole != role ||
                    ownerId.isBlank() ||
                    phone.isBlank() ||
                    offerName.isBlank() ||
                    amount < 0 ||
                    ussdCode.isBlank()
                ) {
                    Log.e(TAG, "Claimed job has incomplete or mismatched details")
                    return@Thread
                }

                LocalDeliveryDatabase(this).saveActiveDelivery(
                    role,
                    ownerId,
                    phone,
                    offerId,
                    offerName,
                    amount,
                    ussdCode,
                    jobId
                )

                Log.i(TAG, "Saved delivery job $jobId locally")

                                ussdSessionInProgress = true

                if (!launchUssdCall(ussdCode)) {
                    Log.e(TAG, "Could not launch USSD for job $jobId")
                    ussdSessionInProgress = false
                }
                                Handler(Looper.getMainLooper()).postDelayed({
                    val pendingDelivery =
                        LocalDeliveryDatabase(this).getActiveDelivery()

                    if (pendingDelivery?.getAsString("job_id") == jobId) {
                        val startedAt =
                            pendingDelivery.getAsLong("started_at") ?: 0L

                        val elapsed =
                            System.currentTimeMillis() - startedAt

                        if (elapsed >= 60000) {
                            Log.w(
                                TAG,
                                "USSD delivery reached 60-second timeout"
                            )

                            reportDeliveryResult(
                                pendingDelivery,
                                "uncertain",
                                "No definitive Safaricom response within 60 seconds"
                            )
                        }
                    }
                }, 60000)

            } catch (e: Exception) {
                Log.e(TAG, "Gateway job polling failed", e)
            } finally {
                connection?.disconnect()
                jobPollingInProgress = false
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

                        if (activeDelivery != null) {
                val menuText = readVisibleUssdMenu()

                if (menuText.isNotBlank()) {
                    getSharedPreferences("app_setup", MODE_PRIVATE)
                        .edit()
                        .putString("last_ussd_menu_text", menuText)
                        .apply()

                    Log.i(TAG, "USSD menu text captured for active delivery")

                                        if (isSuccessfulSafaricomResponse(menuText)) {
                        Log.i(TAG, "Confirmed Safaricom purchase success")
                        reportDeliveryResult(
                            activeDelivery,
                            "success",
                            menuText
                        )
                    } else if (isFailedSafaricomResponse(menuText)) {
                        Log.w(TAG, "Confirmed Safaricom recommendation failure")
                        reportDeliveryResult(
                            activeDelivery,
                            "failed",
                            menuText
                        )
                                        }
                }
                        }
        }
    }

    private fun readVisibleUssdMenu(): String {
        val root = rootInActiveWindow ?: return ""

        val rootPackage = root.packageName?.toString() ?: ""
        if (
            !rootPackage.contains("phone", ignoreCase = true) &&
            !rootPackage.contains("telephony", ignoreCase = true)
        ) {
            return ""
        }

        val result = StringBuilder()

        fun collect(node: android.view.accessibility.AccessibilityNodeInfo?) {
            if (
                node == null ||
                !node.isVisibleToUser ||
                node.isPassword ||
                node.isEditable ||
                result.length >= 2000
            ) return

            val text = node.text?.toString()?.trim()
            if (!text.isNullOrEmpty()) {
                result.append(text).append('\n')
            }

            val description = node.contentDescription?.toString()?.trim()
            if (!description.isNullOrEmpty()) {
                result.append(description).append('\n')
            }

            for (i in 0 until node.childCount) {
                collect(node.getChild(i))
            }
        }

        collect(root)
        return result.toString().take(2000)
    }
        private fun isSuccessfulSafaricomResponse(responseText: String): Boolean {
        val message = responseText.lowercase()
            .replace(Regex("\\s+"), " ")
            .trim()

        return message.contains("you have successfully purchased") ||
            (
                message.contains("thank you for choosing safaricom") &&
                message.contains("you have purchased") &&
                message.contains("bundle")
            )
        }
            private fun isFailedSafaricomResponse(responseText: String): Boolean {
        val message = responseText.lowercase()
            .replace(Regex("\\s+"), " ")
            .trim()

        return message.contains("recommendation failed") &&
            message.contains("has already been recommended")
            }
                    private fun reportDeliveryResult(
        activeDelivery: android.content.ContentValues,
        status: String,
        responseText: String
    ) {
        val jobIdText = activeDelivery.getAsString("job_id") ?: return

        synchronized(this) {
            if (reportingJobId == jobIdText) return
            reportingJobId = jobIdText
        }

        Thread {
            var connection: HttpURLConnection? = null
            var reportAccepted = false

            try {
                val role = activeDelivery.getAsString("role") ?: "reseller"

                val localStatus = when (status.lowercase()) {
                    "success" -> "SUCCESS"
                    "failed" -> "FAILED"
                    "uncertain" -> "UNCERTAIN"
                    else -> throw IllegalArgumentException("Invalid delivery status")
                }

                val database = LocalDeliveryDatabase(this)

                val localId = database.saveDeliveryResultForJob(
                    jobId = jobIdText,
                    role = role,
                    ownerId = activeDelivery.getAsString("owner_id") ?: "",
                    phone = activeDelivery.getAsString("destination_phone") ?: "",
                    offerId = activeDelivery.getAsString("offer_id") ?: "",
                    offerName = activeDelivery.getAsString("offer_name") ?: "Unknown offer",
                    sellingPrice = activeDelivery.getAsDouble("selling_price") ?: 0.0,
                    status = localStatus,
                    safaricomResponse = responseText.take(2000)
                )

                Log.i(TAG, "Delivery result saved locally for job $jobIdText")

                val preferencesName = if (role == "admin") {
                    "admin_agent_gateway"
                } else {
                    "agent_gateway"
                }

                val deviceToken = getSharedPreferences(
                    preferencesName,
                    MODE_PRIVATE
                ).getString("device_token", "") ?: ""

                val jobId = jobIdText.toLongOrNull()
                    ?: throw IllegalArgumentException("Invalid delivery job ID")

                if (deviceToken.isBlank()) {
                    throw IllegalStateException("Gateway device token is missing")
                }

                val payload = JSONObject().apply {
                    put("job_id", jobId)
                    put(
    "status",
    database.getDeliveryResultStatusForJob(jobIdText)?.lowercase() ?: status
)
                    put("safaricom_response", responseText.take(2000))
                }

                connection = URL(
                    "https://mpesa-auto-bundles-backend.onrender.com/api/ussd/jobs/result"
                ).openConnection() as HttpURLConnection

                connection.requestMethod = "POST"
                connection.connectTimeout = 20000
                connection.readTimeout = 20000
                connection.doOutput = true

                connection.setRequestProperty("X-Device-Token", deviceToken)
                connection.setRequestProperty("Content-Type", "application/json")

                connection.outputStream.use {
                    it.write(payload.toString().toByteArray(Charsets.UTF_8))
                }

                val responseCode = connection.responseCode

                if (responseCode == 200) {
                    database.markAsSynced(localId)

val currentActiveDelivery = database.getActiveDelivery()
if (currentActiveDelivery?.getAsString("job_id") == jobIdText) {
    database.clearActiveDelivery()
}
                    reportAccepted = true

                    Log.i(TAG, "Delivery result accepted by backend for job $jobId")
                } else {
                    Log.e(TAG, "Delivery result report failed: HTTP $responseCode")
                }

            } catch (e: Exception) {
                Log.e(TAG, "Delivery result reporting failed", e)
            } finally {
                connection?.disconnect()

                if (!reportAccepted) {
                    synchronized(this@BundleAutomationAccessibilityService) {
                        if (reportingJobId == jobIdText) {
                            reportingJobId = null
                        }
                    }
                }
            }
        }.start()
                    }
                        private fun recoverStaleActiveDelivery() {
        val database = LocalDeliveryDatabase(this)
        val activeDelivery = database.getActiveDelivery() ?: return

        val jobId = activeDelivery.getAsString("job_id") ?: return
        val startedAt = activeDelivery.getAsLong("started_at") ?: return
if (database.hasDeliveryResultForJob(jobId)) return
        val elapsed = System.currentTimeMillis() - startedAt

        if (elapsed >= 60000) {
            Log.w(TAG, "Recovering stale delivery job $jobId")

            reportDeliveryResult(
                activeDelivery,
                "uncertain",
                "Gateway recovery: no definitive Safaricom response within 60 seconds"
            )
        }
                        }
                        private fun syncPendingDeliveryResults() {
        synchronized(this) {
            if (pendingSyncInProgress) return
            pendingSyncInProgress = true
        }

        Thread {
            try {
                val database = LocalDeliveryDatabase(this)
                val pendingRecords = database.getPendingDeliveries()

                for (record in pendingRecords) {
                    var connection: HttpURLConnection? = null

                    try {
                        val localId = record.getAsString("local_id") ?: continue

                        if (!localId.startsWith("job-")) continue

                        val jobId = localId.removePrefix("job-").toLongOrNull()
                            ?: continue

                        val role = record.getAsString("role") ?: continue

                        val preferencesName = if (role == "admin") {
                            "admin_agent_gateway"
                        } else {
                            "agent_gateway"
                        }

                        val deviceToken = getSharedPreferences(
                            preferencesName,
                            MODE_PRIVATE
                        ).getString("device_token", "") ?: ""

                        if (deviceToken.isBlank()) continue

                        val resultStatus = record.getAsString("result_status")?.lowercase()
    ?: continue

val payload = JSONObject().apply {
    put("job_id", jobId)
    put("status", resultStatus)
    put(
        "safaricom_response",
        record.getAsString("safaricom_response") ?: ""
    )
}

                        connection = URL(
                            "https://mpesa-auto-bundles-backend.onrender.com/api/ussd/jobs/result"
                        ).openConnection() as HttpURLConnection

                        connection.requestMethod = "POST"
                        connection.connectTimeout = 10000
                        connection.readTimeout = 10000
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
                            it.write(
                                payload.toString().toByteArray(Charsets.UTF_8)
                            )
                        }

                        if (connection.responseCode == 200) {
                            database.markAsSynced(localId)
                            val activeDelivery = database.getActiveDelivery()

if (activeDelivery?.getAsString("job_id") == jobId.toString()) {
    database.clearActiveDelivery()
}
                            Log.i(
                                TAG,
                                "Pending delivery result synced: $jobId"
                            )
                        }

                    } catch (e: Exception) {
                        Log.e(TAG, "Pending delivery sync failed", e)
                    } finally {
                        connection?.disconnect()
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Could not load pending delivery results", e)
            } finally {
                synchronized(this@BundleAutomationAccessibilityService) {
                    pendingSyncInProgress = false
                }
            }
        }.start()
                        }
                            private fun claimAndStartAirtimeTransfer(
        preferencesName: String
    ) {
        if (jobPollingInProgress) return
        jobPollingInProgress = true

        Thread {
            var connection: HttpURLConnection? = null

            try {
                if (
                    LocalDeliveryDatabase(this)
                        .getActiveDelivery() != null
                ) return@Thread

                val deviceToken = getSharedPreferences(
                    preferencesName,
                    MODE_PRIVATE
                ).getString("device_token", "") ?: ""

                if (deviceToken.isBlank()) return@Thread

                connection = URL(
                    "https://mpesa-auto-bundles-backend.onrender.com/api/ussd/airtime-transfers/claim"
                ).openConnection() as HttpURLConnection

                connection.requestMethod = "POST"
                connection.connectTimeout = 15000
                connection.readTimeout = 15000
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

                if (connection.responseCode != 200) {
                    Log.e(
                        TAG,
                        "Airtime transfer claim failed: HTTP ${connection.responseCode}"
                    )
                    return@Thread
                }

                val response = connection.inputStream
                    .bufferedReader()
                    .use { it.readText() }

                val transfer = JSONObject(response)
                    .optJSONObject("transfer")
                    ?: return@Thread

                val transferId = transfer.optLong("id", 0L)
                val ussdCode = transfer.optString("ussd_code", "")

                if (transferId <= 0 || ussdCode.isBlank()) {
                    Log.e(TAG, "Invalid airtime transfer details")
                    return@Thread
                }

                if (
                    checkSelfPermission(
                        android.Manifest.permission.CALL_PHONE
                    ) != android.content.pm.PackageManager.PERMISSION_GRANTED ||
                    checkSelfPermission(
                        android.Manifest.permission.READ_PHONE_STATE
                    ) != android.content.pm.PackageManager.PERMISSION_GRANTED
                ) {
                    Log.e(TAG, "Phone permissions missing for Sambaza")
                    return@Thread
                }

                val subscriptions =
                    getSystemService(SubscriptionManager::class.java)

                val gatewaySim = subscriptions
                    .activeSubscriptionInfoList
                    ?.firstOrNull { it.simSlotIndex == 0 }
                    ?: return@Thread

                val telephonyManager =
                    getSystemService(TelephonyManager::class.java)
                        .createForSubscriptionId(
                            gatewaySim.subscriptionId
                        )

                fun reportResult(resultStatus: String) {
                    Thread {
                        var resultConnection: HttpURLConnection? = null

                        try {
                            resultConnection = URL(
                                "https://mpesa-auto-bundles-backend.onrender.com/api/ussd/airtime-transfers/result"
                            ).openConnection() as HttpURLConnection

                            resultConnection.requestMethod = "POST"
                            resultConnection.connectTimeout = 15000
                            resultConnection.readTimeout = 15000
                            resultConnection.doOutput = true

                            resultConnection.setRequestProperty(
                                "X-Device-Token",
                                deviceToken
                            )
                            resultConnection.setRequestProperty(
                                "Content-Type",
                                "application/json"
                            )

                            val payload = JSONObject().apply {
                                put("transferId", transferId)
                                put("status", resultStatus)
                            }

                            resultConnection.outputStream.use {
                                it.write(
                                    payload.toString()
                                        .toByteArray(Charsets.UTF_8)
                                )
                            }

                            Log.i(
                                TAG,
                                "Airtime transfer result HTTP ${resultConnection.responseCode}"
                            )

                        } catch (e: Exception) {
                            Log.e(TAG, "Could not report Sambaza result", e)
                        } finally {
                            resultConnection?.disconnect()
                        }
                    }.start()
                }

                telephonyManager.sendUssdRequest(
                    ussdCode,
                    object : TelephonyManager.UssdResponseCallback() {

                        override fun onReceiveUssdResponse(
                            telephonyManager: TelephonyManager,
                            request: String,
                            response: CharSequence
                        ) {
                            val message = response.toString()
                            val lower = message.lowercase()

                            Log.i(TAG, "Sambaza USSD response: $message")

                            when {
                                lower.contains("failed") ||
                                lower.contains("insufficient") ||
                                lower.contains("invalid") -> {
                                    reportResult("failed")
                                }

                                lower.contains("transferred") ||
                                lower.contains("successful") -> {
                                    reportResult("awaiting_confirmation")
                                }

                                else -> {
                                    reportResult("uncertain")
                                }
                            }
                        }

                        override fun onReceiveUssdResponseFailed(
                            telephonyManager: TelephonyManager,
                            request: String,
                            failureCode: Int
                        ) {
                            Log.e(
                                TAG,
                                "Sambaza Android USSD API failed: $failureCode"
                            )

                            launchAccessibilityFallback(ussdCode)
                            reportResult("uncertain")
                        }
                    },
                    Handler(Looper.getMainLooper())
                )

                Log.i(
                    TAG,
                    "Sambaza request started using Android USSD API on SIM 1"
                )

            } catch (e: Exception) {
                Log.e(TAG, "Could not start Sambaza transfer", e)
            } finally {
                connection?.disconnect()
                jobPollingInProgress = false
            }
        }.start()
                            }
private fun launchUssdCall(ussdCode: String): Boolean {
    val code = ussdCode.trim()

    if (
        !code.startsWith("*") ||
        !code.endsWith("#") ||
        code.any {
            !it.isDigit() && it != '*' && it != '#'
        }
    ) {
        Log.e(TAG, "Invalid USSD code")
        return false
    }

    if (
        checkSelfPermission(android.Manifest.permission.CALL_PHONE) !=
        android.content.pm.PackageManager.PERMISSION_GRANTED
    ) {
        Log.e(TAG, "CALL_PHONE permission not granted")
        return false
    }

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        Log.w(TAG, "Android USSD API unavailable; using Accessibility fallback")
        return launchAccessibilityFallback(code)
    }

    if (
        checkSelfPermission(android.Manifest.permission.READ_PHONE_STATE) !=
        android.content.pm.PackageManager.PERMISSION_GRANTED
    ) {
        Log.e(TAG, "READ_PHONE_STATE permission required to select SIM 1")
        return false
    }

    return try {
        val subscriptionManager =
            getSystemService(SubscriptionManager::class.java)

        val gatewaySim = subscriptionManager
            .activeSubscriptionInfoList
            ?.firstOrNull { it.simSlotIndex == 0 }

        if (gatewaySim == null) {
            Log.e(TAG, "Safaricom gateway SIM not found in SIM 1")
            return false
        }

        val baseTelephonyManager =
            getSystemService(TelephonyManager::class.java)

        val telephonyManager =
            baseTelephonyManager.createForSubscriptionId(
                gatewaySim.subscriptionId
            )

        telephonyManager.sendUssdRequest(
            code,
            object : TelephonyManager.UssdResponseCallback() {

                override fun onReceiveUssdResponse(
                    telephonyManager: TelephonyManager,
                    request: String,
                    response: CharSequence
                ) {
                    val message = response.toString()
                    Log.i(TAG, "Android USSD API response: $message")

                    val activeDelivery =
                        LocalDeliveryDatabase(this@BundleAutomationAccessibilityService)
                            .getActiveDelivery()

                    if (activeDelivery != null) {
                        when {
                            isSuccessfulSafaricomResponse(message) -> {
                                reportDeliveryResult(
                                    activeDelivery,
                                    "success",
                                    message
                                )
                            }

                            isFailedSafaricomResponse(message) -> {
                                reportDeliveryResult(
                                    activeDelivery,
                                    "failed",
                                    message
                                )
                            }

                            else -> {
                                Log.w(
                                    TAG,
                                    "USSD response needs review; not retrying automatically"
                                )
                                reportDeliveryResult(
                                    activeDelivery,
                                    "uncertain",
                                    message
                                )
                            }
                        }
                    }
                }

                override fun onReceiveUssdResponseFailed(
                    telephonyManager: TelephonyManager,
                    request: String,
                    failureCode: Int
                ) {
                    Log.e(
                        TAG,
                        "Android USSD API failed: $failureCode. Starting Accessibility fallback."
                    )

                    launchAccessibilityFallback(code)
                }
            },
            Handler(Looper.getMainLooper())
        )

        Log.i(TAG, "USSD request sent using Android API on SIM 1")
        true

    } catch (e: Exception) {
        Log.e(TAG, "Android USSD API could not start", e)
        launchAccessibilityFallback(code)
    }
}

private fun launchAccessibilityFallback(ussdCode: String): Boolean {
    return try {
        val intent = Intent(Intent.ACTION_CALL).apply {
            data = Uri.parse("tel:${Uri.encode(ussdCode)}")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        startActivity(intent)
        Log.i(TAG, "Accessibility USSD fallback launched")
        true

    } catch (e: Exception) {
        Log.e(TAG, "Accessibility fallback could not launch", e)
        false
    }
}

    override fun onInterrupt() {
        heartbeatHandler.removeCallbacks(heartbeatRunnable)
        jobPollingHandler.removeCallbacks(jobPollingRunnable)
        Log.w(TAG, "Bundle automation service interrupted")
    }

    override fun onDestroy() {
        heartbeatHandler.removeCallbacks(heartbeatRunnable)
        jobPollingHandler.removeCallbacks(jobPollingRunnable)
        super.onDestroy()
    }

    companion object {
        private const val TAG = "MAB_Automation"
        private const val HEARTBEAT_INTERVAL = 5 * 60 * 1000L
                private const val JOB_POLL_INTERVAL = 15 * 1000L
    }
}
