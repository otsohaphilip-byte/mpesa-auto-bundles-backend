package com.mpesaautobundles.app

import android.Manifest
import android.accessibilityservice.AccessibilityService
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONObject
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean

class BundleAutomationAccessibilityService : AccessibilityService() {

    private val heartbeatHandler = Handler(Looper.getMainLooper())
    private val jobPollingHandler = Handler(Looper.getMainLooper())

    private val jobPollingInProgress = AtomicBoolean(false)
    private val ussdSessionInProgress = AtomicBoolean(false)
    private val pendingSyncInProgress = AtomicBoolean(false)
    private val pendingAirtimeSmsSyncInProgress = AtomicBoolean(false)

    @Volatile
    private var reportingJobId: String? = null

    private var nextResellerQueueIsAirtime = false

    private val heartbeatRunnable = object : Runnable {
        override fun run() {
            sendAdminGatewayHeartbeat()
            sendResellerGatewayHeartbeat()

            heartbeatHandler.postDelayed(
                this,
                HEARTBEAT_INTERVAL
            )
        }
    }

    private val jobPollingRunnable = object : Runnable {
        override fun run() {
            try {
                recoverStaleActiveDelivery()
                syncPendingDeliveryResults()
                recoverPendingAirtimeTransferResult()

                val adminToken = getSharedPreferences(
                    ADMIN_GATEWAY_PREFS,
                    MODE_PRIVATE
                ).getString("device_token", "") ?: ""

                val resellerToken = getSharedPreferences(
                    RESELLER_GATEWAY_PREFS,
                    MODE_PRIVATE
                ).getString("device_token", "") ?: ""

                val activeTransferId = getSharedPreferences(
                    ACTIVE_TRANSFER_PREFS,
                    MODE_PRIVATE
                ).getLong("transfer_id", 0L)

                val activeDelivery =
                    LocalDeliveryDatabase(this@BundleAutomationAccessibilityService)
                        .getActiveDelivery()

                if (
                    !jobPollingInProgress.get() &&
                    !ussdSessionInProgress.get() &&
                    activeTransferId == 0L &&
                    activeDelivery == null
                ) {
                    when {
                        adminToken.isNotBlank() -> {
                            claimAndStartGatewayJob(
                                "admin",
                                ADMIN_GATEWAY_PREFS
                            )
                        }

                        resellerToken.isNotBlank() -> {
                            if (nextResellerQueueIsAirtime) {
                                claimAndStartAirtimeTransfer(
                                    RESELLER_GATEWAY_PREFS
                                )
                            } else {
                                claimAndStartGatewayJob(
                                    "reseller",
                                    RESELLER_GATEWAY_PREFS
                                )
                            }

                            nextResellerQueueIsAirtime =
                                !nextResellerQueueIsAirtime
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e(
                    TAG,
                    "Gateway polling cycle failed; polling will continue",
                    e
                )
            } finally {
                jobPollingHandler.postDelayed(
                    this,
                    JOB_POLL_INTERVAL
                )
            }
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()

        val activeTransferId = getSharedPreferences(
            ACTIVE_TRANSFER_PREFS,
            MODE_PRIVATE
        ).getLong("transfer_id", 0L)

        if (activeTransferId > 0L) {
            ussdSessionInProgress.set(true)
        }

        if (
            LocalDeliveryDatabase(this).getActiveDelivery() != null
        ) {
            ussdSessionInProgress.set(true)
        }

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
        sendGatewayHeartbeat(
            ADMIN_GATEWAY_PREFS,
            "$BASE_URL/api/admin/ussd/device/heartbeat",
            "Admin"
        )
    }

    private fun sendResellerGatewayHeartbeat() {
        sendGatewayHeartbeat(
            RESELLER_GATEWAY_PREFS,
            "$BASE_URL/api/reseller/ussd/device/heartbeat",
            "Reseller"
        )
    }

    private fun sendGatewayHeartbeat(
        preferencesName: String,
        endpoint: String,
        label: String
    ) {
        Thread {
            var connection: HttpURLConnection? = null

            try {
                val token = getSharedPreferences(
                    preferencesName,
                    MODE_PRIVATE
                ).getString("device_token", "") ?: ""

                if (token.isBlank()) return@Thread

                connection = openPost(endpoint, token)

                connection.outputStream.use {
                    it.write("{}".toByteArray(Charsets.UTF_8))
                }

                Log.i(
                    TAG,
                    "$label gateway heartbeat HTTP ${connection.responseCode}"
                )
            } catch (e: Exception) {
                Log.e(TAG, "$label gateway heartbeat failed", e)
            } finally {
                connection?.disconnect()
            }
        }.start()
    }

    private fun openPost(
        endpoint: String,
        deviceToken: String
    ): HttpURLConnection {
        return (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = NETWORK_TIMEOUT
            readTimeout = NETWORK_TIMEOUT
            doOutput = true

            setRequestProperty(
                "X-Device-Token",
                deviceToken
            )

            setRequestProperty(
                "Content-Type",
                "application/json"
            )
        }
    }

    private fun readConnectionResponse(
        connection: HttpURLConnection
    ): String {
        val stream = if (connection.responseCode in 200..299) {
            connection.inputStream
        } else {
            connection.errorStream
        }

        return stream?.bufferedReader()?.use {
            it.readText()
        } ?: ""
    }

    private fun isValidUssdCode(code: String): Boolean {
        val value = code.trim()

        return value.length in 3..150 &&
            value.startsWith("*") &&
            value.endsWith("#") &&
            value.all {
                it.isDigit() || it == '*' || it == '#'
            }
    }

    private fun isKenyanLocalPhone(phone: String): Boolean {
        return Regex("^(07|01)\\d{8}$").matches(
            phone.filter { it.isDigit() }
        )
    }

    private fun getGatewayDeviceToken(
        preferencesName: String
    ): String {
        return getSharedPreferences(
            preferencesName,
            MODE_PRIVATE
        ).getString("device_token", "") ?: ""
    }
        private fun claimAndStartGatewayJob(
        role: String,
        preferencesName: String
    ) {
        if (!jobPollingInProgress.compareAndSet(false, true)) {
            return
        }

        Thread {
            var connection: HttpURLConnection? = null

            try {
                val database = LocalDeliveryDatabase(this)

                if (
                    ussdSessionInProgress.get() ||
                    database.getActiveDelivery() != null
                ) {
                    return@Thread
                }

                val deviceToken = getGatewayDeviceToken(
                    preferencesName
                )

                if (deviceToken.isBlank()) return@Thread

                connection = openPost(
                    "$BASE_URL/api/ussd/jobs/claim",
                    deviceToken
                )

                connection.outputStream.use {
                    it.write("{}".toByteArray(Charsets.UTF_8))
                }

                val responseCode = connection.responseCode
                val responseText = readConnectionResponse(connection)

                if (responseCode !in 200..299) {
                    Log.e(
                        TAG,
                        "Delivery job claim failed: HTTP $responseCode $responseText"
                    )
                    return@Thread
                }

                val job = JSONObject(responseText)
                    .optJSONObject("job")
                    ?: return@Thread

                val jobId = job.optString("id", "")
                val jobRole = job.optString("gateway_role", "")

                val ownerId = if (role == "admin") {
                    job.optString("admin_phone", "")
                } else {
                    job.optString("reseller_id", "")
                }

                val destinationPhone = job.optString(
                    "destination_phone",
                    ""
                )

                val offerId = job.optString(
                    "offer_id",
                    ""
                )

                val offerName = job.optString(
                    "offer_name",
                    ""
                )

                val amount = job.optDouble(
                    "amount",
                    -1.0
                )

                val ussdCode = job.optString(
                    "ussd_code",
                    ""
                )

                val validJob =
                    jobId.toLongOrNull()?.let { it > 0L } == true &&
                    jobRole == role &&
                    ownerId.isNotBlank() &&
                    isKenyanLocalPhone(destinationPhone) &&
                                    offerId.isNotBlank() &&
                    offerName.isNotBlank() &&
                amount > 0.0 &&
                    isValidUssdCode(ussdCode)

                if (!validJob) {
                    Log.e(
                        TAG,
                        "Claimed delivery job has invalid or mismatched details: $jobId"
                    )

                    reportUnstartedDeliveryJob(
                        jobId,
                        deviceToken,
                        "Claimed job contains invalid or incomplete delivery details"
                    )
                    return@Thread
                }

                if (
                    ussdSessionInProgress.get() ||
                    database.getActiveDelivery() != null
                ) {
                    reportUnstartedDeliveryJob(
                        jobId,
                        deviceToken,
                        "Gateway was busy before this delivery could start"
                    )
                    return@Thread
                }

                if (
                    !ussdSessionInProgress.compareAndSet(false, true)
                ) {
                    reportUnstartedDeliveryJob(
                        jobId,
                        deviceToken,
                        "Another USSD session started before this delivery"
                    )
                    return@Thread
                }

                database.saveActiveDelivery(
                    role = role,
                    ownerId = ownerId,
                    phone = destinationPhone,
                    offerId = offerId,
                    offerName = offerName,
                    sellingPrice = amount,
                    ussdCode = ussdCode,
                    jobId = jobId
                )

                Log.i(
                    TAG,
                    "Delivery job $jobId saved locally; starting USSD"
                )

                val launchResult = launchUssdCall(ussdCode)

                if (launchResult == UssdLaunchResult.NOT_SENT) {
                    val active = database.getActiveDelivery()

                    if (active?.getAsString("job_id") == jobId) {
                        reportDeliveryResult(
                            active,
                            "failed",
                            "USSD request could not be launched. No request was sent."
                        )
                    }
                    return@Thread
                }

                scheduleDeliveryTimeout(jobId)

            } catch (e: Exception) {
                Log.e(
                    TAG,
                    "Gateway delivery job processing failed",
                    e
                )
            } finally {
                connection?.disconnect()
                jobPollingInProgress.set(false)
            }
        }.start()
    }

    private fun reportUnstartedDeliveryJob(
        jobId: String,
        deviceToken: String,
        reason: String
    ) {
        val numericJobId = jobId.toLongOrNull() ?: return

        Thread {
            var connection: HttpURLConnection? = null

            try {
                connection = openPost(
                    "$BASE_URL/api/ussd/jobs/result",
                    deviceToken
                )

                val payload = JSONObject().apply {
                    put("job_id", numericJobId)
                    put("status", "failed")
                    put("safaricom_response", reason.take(2000))
                }

                connection.outputStream.use {
                    it.write(
                        payload.toString().toByteArray(Charsets.UTF_8)
                    )
                }

                val responseCode = connection.responseCode
                val responseText = readConnectionResponse(connection)

                Log.i(
                    TAG,
                    "Unstarted job $numericJobId report HTTP $responseCode: $responseText"
                )
            } catch (e: Exception) {
                Log.e(
                    TAG,
                    "Could not report unstarted job $numericJobId",
                    e
                )
            } finally {
                connection?.disconnect()
            }
        }.start()
    }

    private fun scheduleDeliveryTimeout(jobId: String) {
        Handler(Looper.getMainLooper()).postDelayed({
            val database = LocalDeliveryDatabase(this)
            val active = database.getActiveDelivery()

            if (active?.getAsString("job_id") != jobId) {
                return@postDelayed
            }

            if (database.hasDeliveryResultForJob(jobId)) {
                return@postDelayed
            }

            val startedAt = active.getAsLong("started_at") ?: 0L
            val elapsed = System.currentTimeMillis() - startedAt

            if (elapsed >= DELIVERY_TIMEOUT) {
                Log.w(
                    TAG,
                    "Delivery job $jobId timed out without a definitive Safaricom response"
                )

                reportDeliveryResult(
                    active,
                    "uncertain",
                    "No definitive Safaricom response was detected within 60 seconds. The delivery was not automatically repeated."
                )
            }
        }, DELIVERY_TIMEOUT)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return

        if (!ussdSessionInProgress.get()) {
            return
        }

        val packageName = event.packageName?.toString() ?: ""
        val className = event.className?.toString() ?: ""

        val isPhoneInterface =
            packageName.contains("phone", ignoreCase = true) ||
            packageName.contains("telephony", ignoreCase = true) ||
            packageName.contains("systemui", ignoreCase = true)

        val eventText = event.text.joinToString(" ").lowercase()

        val containsUssdClue =
            eventText.contains("ussd") ||
            eventText.contains("safaricom") ||
            eventText.contains("bundle") ||
            eventText.contains("transferred") ||
            eventText.contains("insufficient") ||
            className.contains("alertdialog", ignoreCase = true)

        if (!isPhoneInterface && !containsUssdClue) {
            return
        }

        val menuText = readVisibleUssdMenu()

        if (menuText.isBlank()) {
            return
        }

        getSharedPreferences(
            "app_setup",
            MODE_PRIVATE
        ).edit()
            .putBoolean("ussd_screen_detected", true)
            .putLong(
                "ussd_screen_detected_at",
                System.currentTimeMillis()
            )
            .putString("last_ussd_menu_text", menuText)
            .apply()

        val activeDelivery =
            LocalDeliveryDatabase(this).getActiveDelivery()

        if (activeDelivery != null) {
            when {
                isSuccessfulSafaricomResponse(menuText) -> {
                    reportDeliveryResult(
                        activeDelivery,
                        "success",
                        menuText
                    )
                }

                isFailedSafaricomResponse(menuText) -> {
                    reportDeliveryResult(
                        activeDelivery,
                        "failed",
                        menuText
                    )
                }

                else -> {
                    Log.i(
                        TAG,
                        "Bundle USSD screen detected; awaiting a definitive response"
                    )
                }
            }

            return
        }

        val transferPreferences = getSharedPreferences(
            ACTIVE_TRANSFER_PREFS,
            MODE_PRIVATE
        )

        val transferId = transferPreferences.getLong(
            "transfer_id",
            0L
        )

        if (transferId <= 0L) {
            return
        }

        val lower = menuText.lowercase()

        when {
            lower.contains("failed") ||
            lower.contains("insufficient") ||
            lower.contains("invalid") ||
            lower.contains("not successful") -> {
                reportAirtimeTransferResult(
                    transferId,
                    "failed",
                    menuText
                )
            }

            lower.contains("transferred") ||
            lower.contains("successfully sent") ||
            lower.contains("successfully transferred") -> {
                reportAirtimeTransferResult(
                    transferId,
                    "awaiting_confirmation",
                    menuText
                )
            }

            else -> {
                Log.i(
                    TAG,
                    "Sambaza USSD response detected; awaiting a definitive result"
                )
            }
        }
    }
        private fun readVisibleUssdMenu(): String {
        val root = rootInActiveWindow ?: return ""

        val result = StringBuilder()

        fun collect(node: AccessibilityNodeInfo?) {
            if (
                node == null ||
                !node.isVisibleToUser ||
                node.isPassword ||
                result.length >= 2000
            ) {
                return
            }

            val text = node.text?.toString()?.trim()

            if (!text.isNullOrEmpty()) {
                result.append(text).append('\n')
            }

            val description =
                node.contentDescription?.toString()?.trim()

            if (!description.isNullOrEmpty()) {
                result.append(description).append('\n')
            }

            for (index in 0 until node.childCount) {
                collect(node.getChild(index))
            }
        }

        collect(root)

        return result.toString()
            .replace(Regex("[ \\t]+"), " ")
            .trim()
            .take(2000)
    }

    private fun isSuccessfulSafaricomResponse(
        responseText: String
    ): Boolean {
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

    private fun isFailedSafaricomResponse(
        responseText: String
    ): Boolean {
        val message = responseText.lowercase()
            .replace(Regex("\\s+"), " ")
            .trim()

        return message.contains("recommendation failed") ||
            message.contains("insufficient balance") ||
            message.contains("insufficient airtime") ||
            message.contains("invalid recipient") ||
            message.contains("invalid phone number") ||
            message.contains("you are not eligible") ||
            message.contains("unable to process your request") ||
            message.contains("transaction failed")
    }

    private fun reportAirtimeTransferResult(
        transferId: Long,
        resultStatus: String,
        responseText: String
    ) {
        if (
            transferId <= 0L ||
            resultStatus !in listOf(
                "awaiting_confirmation",
                "failed",
                "uncertain"
            )
        ) {
            return
        }

        val preferences = getSharedPreferences(
            ACTIVE_TRANSFER_PREFS,
            MODE_PRIVATE
        )

        if (
            preferences.getLong("transfer_id", 0L) != transferId
        ) {
            return
        }

        synchronized(preferences) {
            if (
                preferences.getBoolean(
                    "report_in_progress",
                    false
                )
            ) {
                return
            }

            preferences.edit()
                .putBoolean("report_in_progress", true)
                .putString("result_status", resultStatus)
                .putString(
                    "response_text",
                    responseText.take(2000)
                )
                .apply()
        }

        Thread {
            var connection: HttpURLConnection? = null

            try {
                val deviceToken = preferences.getString(
                    "device_token",
                    ""
                ) ?: ""

                if (deviceToken.isBlank()) {
                    throw IllegalStateException(
                        "Airtime transfer gateway token is missing"
                    )
                }

                connection = openPost(
                    "$BASE_URL/api/ussd/airtime-transfers/result",
                    deviceToken
                )

                val payload = JSONObject().apply {
                    put("transferId", transferId)
                    put("status", resultStatus)
                }

                connection.outputStream.use {
                    it.write(
                        payload.toString().toByteArray(Charsets.UTF_8)
                    )
                }

                val responseCode = connection.responseCode
                val responseTextFromServer =
                    readConnectionResponse(connection)

                if (responseCode in 200..299) {
                    preferences.edit().clear().apply()
                    ussdSessionInProgress.set(false)

                    Log.i(
                        TAG,
                        "Airtime transfer result accepted for $transferId: $responseTextFromServer"
                    )
                } else {
                    preferences.edit()
                        .putBoolean("report_in_progress", false)
                        .apply()

                    Log.e(
                        TAG,
                        "Airtime transfer result rejected: HTTP $responseCode $responseTextFromServer"
                    )
                }
            } catch (e: Exception) {
                preferences.edit()
                    .putBoolean("report_in_progress", false)
                    .apply()

                Log.e(
                    TAG,
                    "Could not report airtime transfer result",
                    e
                )
            } finally {
                connection?.disconnect()
            }
        }.start()
    }
            private fun reportDeliveryResult(
        activeDelivery: ContentValues,
        status: String,
        responseText: String
    ) {
        val jobIdText = activeDelivery.getAsString("job_id")
            ?: return

        val localStatus = when (status.lowercase()) {
            "success" -> "SUCCESS"
            "failed" -> "FAILED"
            "uncertain" -> "UNCERTAIN"
            else -> {
                Log.e(TAG, "Rejected invalid delivery result status: $status")
                return
            }
        }

        Thread {
            var connection: HttpURLConnection? = null
            var reportAccepted = false
            var ownsReportingSlot = false

            try {
                val role = activeDelivery.getAsString("role")
                    ?: throw IllegalStateException("Delivery role is missing")

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

                val savedResult = database.getDeliveryResultForJob(jobIdText)
                    ?: throw IllegalStateException(
                        "Saved delivery result could not be loaded"
                    )

                val savedStatus = savedResult.getAsString("result_status")
                    ?: throw IllegalStateException(
                        "Saved delivery status is missing"
                    )

                val savedResponse = savedResult.getAsString("safaricom_response")
                    ?: ""

                synchronized(this@BundleAutomationAccessibilityService) {
                    if (reportingJobId == jobIdText) {
                        return@Thread
                    }

                    reportingJobId = jobIdText
                                        ownsReportingSlot = true
                }

                val preferencesName = if (role == "admin") {
                    ADMIN_GATEWAY_PREFS
                } else {
                    RESELLER_GATEWAY_PREFS
                }

                val deviceToken = getGatewayDeviceToken(
                    preferencesName
                )

                if (deviceToken.isBlank()) {
                    throw IllegalStateException(
                        "Gateway device token is missing"
                    )
                }

                val jobId = jobIdText.toLongOrNull()
                    ?: throw IllegalArgumentException(
                        "Delivery job ID is invalid"
                    )

                val payload = JSONObject().apply {
                    put("job_id", jobId)
                    put("status", savedStatus.lowercase())
                    put("safaricom_response", savedResponse.take(2000))
                }

                connection = openPost(
                    "$BASE_URL/api/ussd/jobs/result",
                    deviceToken
                )

                connection.outputStream.use {
                    it.write(
                        payload.toString().toByteArray(Charsets.UTF_8)
                    )
                }

                val responseCode = connection.responseCode
                val serverResponse = readConnectionResponse(connection)

                if (responseCode in 200..299) {
                    database.markAsSynced(
                        localId,
                        savedStatus
                    )

                    val latestResult =
                        database.getDeliveryResultForJob(jobIdText)

                    if (
                        latestResult?.getAsString("result_status") ==
                        savedStatus
                    ) {
                        val currentActive = database.getActiveDelivery()

                        if (
                            currentActive?.getAsString("job_id") == jobIdText
                        ) {
                            database.clearActiveDelivery()
                            ussdSessionInProgress.set(false)
                        }
                    }

                    reportAccepted = true

                    Log.i(
                        TAG,
                        "Delivery result accepted for job $jobId: $serverResponse"
                    )
                } else {
                    Log.e(
                        TAG,
                        "Delivery result rejected for job $jobId: HTTP $responseCode $serverResponse"
                    )
                }
            } catch (e: Exception) {
                Log.e(
                    TAG,
                    "Could not report delivery result for job $jobIdText",
                    e
                )
            } finally {
                connection?.disconnect()

                synchronized(this@BundleAutomationAccessibilityService) {
                    if (ownsReportingSlot && reportingJobId == jobIdText) {
                        reportingJobId = null
                    }
                }

                if (!reportAccepted) {
                    Log.w(
                        TAG,
                        "Delivery result remains saved locally for retry: $jobIdText"
                    )
                }
            }
        }.start()
            }
    private fun recoverStaleActiveDelivery() {
        val database = LocalDeliveryDatabase(this)
        val activeDelivery = database.getActiveDelivery() ?: return

        val jobId = activeDelivery.getAsString("job_id")
            ?: return

        val startedAt = activeDelivery.getAsLong("started_at")
            ?: return

        if (database.hasDeliveryResultForJob(jobId)) {
            return
        }

        val elapsed = System.currentTimeMillis() - startedAt

        if (elapsed < DELIVERY_TIMEOUT) {
            return
        }

        Log.w(
            TAG,
            "Recovering stale delivery job $jobId after timeout"
        )

        reportDeliveryResult(
            activeDelivery,
            "uncertain",
            "Gateway recovery: no definitive Safaricom response was received within 60 seconds. The USSD request will not be repeated automatically."
        )
    }

    private fun syncPendingDeliveryResults() {
        if (!pendingSyncInProgress.compareAndSet(false, true)) {
            return
        }

        Thread {
            try {
                val database = LocalDeliveryDatabase(this)
                val pendingRecords = database.getPendingDeliveries()

                for (record in pendingRecords) {
                    var connection: HttpURLConnection? = null

                    try {
                        val localId = record.getAsString("local_id")
                            ?: continue

                        if (!localId.startsWith("job-")) {
                            continue
                        }

                        val jobId = localId
                            .removePrefix("job-")
                            .toLongOrNull()
                            ?: continue

                        val role = record.getAsString("role")
                            ?: continue

                        val preferencesName = if (role == "admin") {
                            ADMIN_GATEWAY_PREFS
                        } else {
                            RESELLER_GATEWAY_PREFS
                        }

                        val deviceToken = getGatewayDeviceToken(
                            preferencesName
                        )

                        if (deviceToken.isBlank()) {
                            continue
                        }

                        val resultStatus = record
                            .getAsString("result_status")
                            ?.lowercase()
                            ?: continue

                        val responseText = record
                            .getAsString("safaricom_response")
                            ?: ""

                        val payload = JSONObject().apply {
                            put("job_id", jobId)
                            put("status", resultStatus)
                            put("safaricom_response", responseText)
                        }

                        connection = openPost(
                            "$BASE_URL/api/ussd/jobs/result",
                            deviceToken
                        )

                        connection.outputStream.use {
                            it.write(
                                payload.toString().toByteArray(Charsets.UTF_8)
                            )
                        }

                        val responseCode = connection.responseCode
                        val serverResponse =
                            readConnectionResponse(connection)

                                                if (responseCode in 200..299) {
                            database.markAsSynced(
                                localId,
                                resultStatus.uppercase()
                            )

                            val latestResult =
                                database.getDeliveryResultForJob(
                                    jobId.toString()
                                )

                            if (
                                latestResult?.getAsString("result_status") ==
                                resultStatus.uppercase()
                            ) {
                                val active = database.getActiveDelivery()

                                if (
                                    active?.getAsString("job_id") ==
                                    jobId.toString()
                                ) {
                                    database.clearActiveDelivery()
                                    ussdSessionInProgress.set(false)
                                }
                            }
                            Log.i(
                                TAG,
                                "Pending delivery result synced: $jobId"
                            )
                        } else {
                            Log.e(
                                TAG,
                                "Pending result $jobId not accepted: HTTP $responseCode $serverResponse"
                            )
                        }
                    } catch (e: Exception) {
                        Log.e(
                            TAG,
                            "Pending delivery result sync failed",
                            e
                        )
                    } finally {
                        connection?.disconnect()
                    }
                }
            } catch (e: Exception) {
                Log.e(
                    TAG,
                    "Could not load pending delivery results",
                    e
                )
            } finally {
                pendingSyncInProgress.set(false)
            }
        }.start()
    }
        private fun claimAndStartAirtimeTransfer(
        preferencesName: String
    ) {
        if (
            jobPollingInProgress.get() ||
            ussdSessionInProgress.get()
        ) {
            return
        }

        if (!jobPollingInProgress.compareAndSet(false, true)) {
            return
        }

        Thread {
            var connection: HttpURLConnection? = null
            var transferId = 0L

            try {
                val database = LocalDeliveryDatabase(this)

                if (database.getActiveDelivery() != null) {
                    return@Thread
                }

                val transferPreferences = getSharedPreferences(
                    ACTIVE_TRANSFER_PREFS,
                    MODE_PRIVATE
                )

                if (
                    transferPreferences.getLong("transfer_id", 0L) > 0L
                ) {
                    return@Thread
                }

                val deviceToken = getGatewayDeviceToken(
                    preferencesName
                )

                if (deviceToken.isBlank()) {
                    Log.e(TAG, "Reseller gateway token is missing")
                    return@Thread
                }

                connection = openPost(
                    "$BASE_URL/api/ussd/airtime-transfers/claim",
                    deviceToken
                )

                connection.outputStream.use {
                    it.write(
                        "{}".toByteArray(Charsets.UTF_8)
                    )
                }

                val responseCode = connection.responseCode
                val responseText = readConnectionResponse(connection)

                if (responseCode !in 200..299) {
                    Log.e(
                        TAG,
                        "Airtime transfer claim failed: HTTP $responseCode $responseText"
                    )
                    return@Thread
                }

                val transfer = JSONObject(responseText)
                    .optJSONObject("transfer")
                    ?: return@Thread

                transferId = transfer.optLong("id", 0L)

                val ussdCode = transfer.optString(
                    "ussd_code",
                    ""
                ).trim()

                val destinationPhone = transfer.optString(
                    "destination_phone",
                    ""
                ).trim()

                val airtimeAmount = transfer.optDouble(
                    "airtime_amount",
                    transfer.optDouble("amount", 0.0)
                )

                if (
                    transferId <= 0L ||
                    !isValidUssdCode(ussdCode) ||
                    !isKenyanLocalPhone(destinationPhone) ||
                    airtimeAmount <= 0.0
                ) {
                    Log.e(
                        TAG,
                        "Claimed airtime transfer has invalid details"
                    )

                    if (transferId > 0L) {
                        transferPreferences.edit()
                            .putLong("transfer_id", transferId)
                            .putString("device_token", deviceToken)
                            .putLong(
                                "started_at",
                                System.currentTimeMillis()
                            )
                            .putBoolean("report_in_progress", false)
                            .apply()

                        reportAirtimeTransferResult(
                            transferId,
                            "failed",
                            "Transfer details were invalid. Sambaza was not started."
                        )
                    }

                    return@Thread
                }

                transferPreferences.edit()
                    .putLong("transfer_id", transferId)
                    .putString("device_token", deviceToken)
                    .putString("destination_phone", destinationPhone)
                    .putDouble("airtime_amount", airtimeAmount)
                    .putString("ussd_code", ussdCode)
                    .putLong(
                        "started_at",
                        System.currentTimeMillis()
                    )
                    .putString("result_status", "")
                    .putString("response_text", "")
                    .putBoolean("report_in_progress", false)
                    .apply()

                Log.i(
                    TAG,
                    "Saved airtime transfer $transferId before USSD launch"
                )

                if (!ussdSessionInProgress.compareAndSet(false, true)) {
                    reportAirtimeTransferResult(
                        transferId,
                        "failed",
                        "Another USSD session is already active. Sambaza was not started."
                    )
                    return@Thread
                }

                val launchResult = launchUssdCall(ussdCode)

                when (launchResult) {
                    UssdLaunchResult.NOT_SENT -> {
                        ussdSessionInProgress.set(false)

                        reportAirtimeTransferResult(
                            transferId,
                            "failed",
                            "The USSD request was not submitted. Sambaza was not started."
                        )
                    }

                    UssdLaunchResult.SENT -> {
                        Log.i(
                            TAG,
                            "Airtime transfer $transferId submitted through Android USSD API"
                        )
                    }

                    UssdLaunchResult.UNCERTAIN -> {
                        Log.w(
                            TAG,
                            "Airtime transfer $transferId has an uncertain USSD launch result"
                        )
                    }
                }

                if (launchResult != UssdLaunchResult.NOT_SENT) {
                    Handler(Looper.getMainLooper()).postDelayed({
                        val currentPreferences = getSharedPreferences(
                            ACTIVE_TRANSFER_PREFS,
                            MODE_PRIVATE
                        )

                        if (
                            currentPreferences.getLong(
                                "transfer_id",
                                0L
                            ) != transferId
                        ) {
                            return@postDelayed
                        }

                        val savedStatus = currentPreferences.getString(
                            "result_status",
                            ""
                        ) ?: ""

                        val startedAt = currentPreferences.getLong(
                            "started_at",
                            0L
                        )

                        if (
                            savedStatus.isBlank() &&
                            startedAt > 0L &&
                            System.currentTimeMillis() - startedAt >=
                            DELIVERY_TIMEOUT
                        ) {
                            reportAirtimeTransferResult(
                                transferId,
                                "uncertain",
                                "No definitive Sambaza response was received within 60 seconds. The request will not be repeated automatically."
                            )
                        }
                    }, DELIVERY_TIMEOUT)
                }
            } catch (e: Exception) {
                Log.e(
                    TAG,
                    "Could not claim or start airtime transfer",
                    e
                )

                if (transferId > 0L) {
                    reportAirtimeTransferResult(
                        transferId,
                        "uncertain",
                        "An error occurred while starting the Sambaza transfer: ${e.message}"
                    )
                }
            } finally {
                connection?.disconnect()
                jobPollingInProgress.set(false)
            }
        }.start()
    }

    private fun recoverPendingAirtimeTransferResult() {
        val preferences = getSharedPreferences(
            ACTIVE_TRANSFER_PREFS,
            MODE_PRIVATE
        )

        val transferId = preferences.getLong(
            "transfer_id",
            0L
        )

        if (transferId <= 0L) {
            return
        }

        ussdSessionInProgress.set(true)

        val startedAt = preferences.getLong(
            "started_at",
            0L
        )

        val savedStatus = preferences.getString(
            "result_status",
            ""
        ) ?: ""

        val savedResponse = preferences.getString(
            "response_text",
            ""
        ) ?: ""

        if (savedStatus.isNotBlank()) {
            reportAirtimeTransferResult(
                transferId,
                savedStatus,
                savedResponse.ifBlank {
                    "Retrying saved Sambaza result after service recovery"
                }
            )
            return
        }

        if (
            startedAt > 0L &&
            System.currentTimeMillis() - startedAt >= DELIVERY_TIMEOUT
        ) {
            reportAirtimeTransferResult(
                transferId,
                "uncertain",
                "Sambaza recovery timeout: no definitive response was saved. The USSD request will not be repeated."
            )
        }
    }
        private enum class UssdLaunchResult {
        NOT_SENT,
        SENT,
        UNCERTAIN
    }

    private fun launchUssdCall(
        ussdCode: String
    ): UssdLaunchResult {
        val code = ussdCode.trim()

        if (!isValidUssdCode(code)) {
            Log.e(TAG, "Rejected invalid USSD code")
            return UssdLaunchResult.NOT_SENT
        }

        if (
            checkSelfPermission(Manifest.permission.CALL_PHONE) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            Log.e(TAG, "CALL_PHONE permission is missing")
            return UssdLaunchResult.NOT_SENT
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            Log.w(
                TAG,
                "Android USSD API is unavailable on this Android version; using Accessibility fallback"
            )

            return if (launchAccessibilityFallback(code)) {
                UssdLaunchResult.SENT
            } else {
                UssdLaunchResult.NOT_SENT
            }
        }

        if (
            checkSelfPermission(Manifest.permission.READ_PHONE_STATE) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            Log.e(TAG, "READ_PHONE_STATE permission is missing")
            return UssdLaunchResult.NOT_SENT
        }

        val telephonyManager: TelephonyManager

        try {
            val subscriptionManager =
                getSystemService(SubscriptionManager::class.java)

            val gatewaySim = subscriptionManager
                .activeSubscriptionInfoList
                ?.firstOrNull { it.simSlotIndex == 0 }

            if (gatewaySim == null) {
                Log.e(TAG, "Safaricom gateway SIM was not found in SIM 1")
                return UssdLaunchResult.NOT_SENT
            }

            telephonyManager =
                getSystemService(TelephonyManager::class.java)
                    .createForSubscriptionId(
                        gatewaySim.subscriptionId
                    )
        } catch (e: Exception) {
            Log.e(
                TAG,
                "Could not prepare the SIM 1 USSD connection",
                e
            )
            return UssdLaunchResult.NOT_SENT
        }

        return try {
            telephonyManager.sendUssdRequest(
                code,
                object : TelephonyManager.UssdResponseCallback() {

                    override fun onReceiveUssdResponse(
                        telephonyManager: TelephonyManager,
                        request: String,
                        response: CharSequence
                    ) {
                        val message = response.toString()

                        Log.i(
                            TAG,
                            "Android USSD API response: $message"
                        )

                        handleUssdApiResponse(message)
                    }

                    override fun onReceiveUssdResponseFailed(
                        telephonyManager: TelephonyManager,
                        request: String,
                        failureCode: Int
                    ) {
                        val message =
                            "Android USSD API returned failure code $failureCode after the request was submitted. No second USSD request was started."

                        Log.e(TAG, message)

                        handleUssdApiUncertainResult(message)
                    }
                },
                Handler(Looper.getMainLooper())
            )

            Log.i(
                TAG,
                "USSD request submitted through Android API using SIM 1"
            )

            UssdLaunchResult.SENT

        } catch (e: Exception) {
            Log.e(
                TAG,
                "USSD API threw an exception during submission; outcome is treated as uncertain",
                e
            )

            handleUssdApiUncertainResult(
                "Android USSD API threw an exception during submission: ${e.message}. No Accessibility retry was started."
            )

            UssdLaunchResult.UNCERTAIN
        }
    }

    private fun handleUssdApiResponse(message: String) {
        val activeDelivery =
            LocalDeliveryDatabase(this).getActiveDelivery()

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
                    Log.i(
                        TAG,
                        "Bundle USSD response is not yet definitive; waiting for further evidence"
                    )
                }
            }

            return
        }

        val preferences = getSharedPreferences(
            ACTIVE_TRANSFER_PREFS,
            MODE_PRIVATE
        )

        val transferId = preferences.getLong(
            "transfer_id",
            0L
        )

        if (transferId <= 0L) {
            Log.w(
                TAG,
                "Received a USSD response without an active delivery or airtime transfer"
            )
            return
        }

        val lower = message.lowercase()

        when {
            isFailedSafaricomResponse(message) -> {
                reportAirtimeTransferResult(
                    transferId,
                    "failed",
                    message
                )
            }

            lower.contains("transferred") ||
            lower.contains("successfully sent") ||
            lower.contains("successfully transferred") ||
            lower.contains("successfully shared") ||
            lower.contains("sambaza successful") -> {
                reportAirtimeTransferResult(
                    transferId,
                    "awaiting_confirmation",
                    message
                )
            }

            else -> {
                Log.i(
                    TAG,
                    "Airtime USSD response is not definitive; waiting for confirmation"
                )
            }
        }
    }

    private fun handleUssdApiUncertainResult(message: String) {
        val activeDelivery =
            LocalDeliveryDatabase(this).getActiveDelivery()

        if (activeDelivery != null) {
            reportDeliveryResult(
                activeDelivery,
                "uncertain",
                message
            )
            return
        }

        val preferences = getSharedPreferences(
            ACTIVE_TRANSFER_PREFS,
            MODE_PRIVATE
        )

        val transferId = preferences.getLong(
            "transfer_id",
            0L
        )

        if (transferId > 0L) {
            reportAirtimeTransferResult(
                transferId,
                "uncertain",
                message
            )
        } else {
            Log.w(
                TAG,
                "USSD failure received without a saved active transaction"
            )
        }
    }

    private fun launchAccessibilityFallback(
        ussdCode: String
    ): Boolean {
        val code = ussdCode.trim()

        if (!isValidUssdCode(code)) {
            Log.e(
                TAG,
                "Accessibility fallback rejected invalid USSD code"
            )
            return false
        }

        if (
            checkSelfPermission(Manifest.permission.CALL_PHONE) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            Log.e(
                TAG,
                "Accessibility fallback cannot start without CALL_PHONE permission"
            )
            return false
        }

        return try {
            val intent = Intent(Intent.ACTION_CALL).apply {
                data = Uri.parse(
                    "tel:${Uri.encode(code)}"
                )
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            startActivity(intent)

            Log.i(
                TAG,
                "Accessibility USSD fallback launched"
            )

            true
        } catch (e: Exception) {
            Log.e(
                TAG,
                "Accessibility USSD fallback could not launch",
                e
            )
            false
        }
    }
        override fun onInterrupt() {
        heartbeatHandler.removeCallbacks(heartbeatRunnable)
        jobPollingHandler.removeCallbacks(jobPollingRunnable)

        Log.w(
            TAG,
            "Bundle automation service interrupted"
        )
    }

    override fun onDestroy() {
        heartbeatHandler.removeCallbacks(heartbeatRunnable)
        jobPollingHandler.removeCallbacks(jobPollingRunnable)

        Log.i(
            TAG,
            "Bundle automation service destroyed"
        )

        super.onDestroy()
    }

    companion object {
        private const val TAG = "MAB_Automation"

        private const val BASE_URL =
            "https://mpesa-auto-bundles-backend.onrender.com"

        private const val ADMIN_GATEWAY_PREFS =
            "admin_agent_gateway"

        private const val RESELLER_GATEWAY_PREFS =
            "agent_gateway"

        private const val ACTIVE_TRANSFER_PREFS =
            "active_airtime_transfer"

        private const val HEARTBEAT_INTERVAL =
            5 * 60 * 1000L

        private const val JOB_POLL_INTERVAL =
            15 * 1000L

        private const val DELIVERY_TIMEOUT =
            60 * 1000L
                private const val NETWORK_TIMEOUT =
            20 * 1000
    }
}
