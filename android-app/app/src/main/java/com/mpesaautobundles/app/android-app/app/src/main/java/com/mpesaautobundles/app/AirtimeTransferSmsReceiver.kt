package com.mpesaautobundles.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class AirtimeTransferSmsReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
            return
        }

        val messages = Telephony.Sms.Intents
            .getMessagesFromIntent(intent)

        if (messages.isEmpty()) return

        val body = messages.joinToString("") {
            it.messageBody ?: ""
        }

        if (
            !body.contains("transferred", ignoreCase = true) ||
            !body.contains("KSH", ignoreCase = true)
        ) {
            return
        }

        val pendingResult = goAsync()

        Thread {
            try {
                val preferences = context.getSharedPreferences(
                    "admin_agent_gateway",
                    Context.MODE_PRIVATE
                )

                val deviceToken = preferences.getString(
                    "device_token",
                    ""
                ) ?: ""

                if (deviceToken.isBlank()) {
                    Log.e("MAB_SMS", "Admin gateway token missing")
                    return@Thread
                }

                val receivedAt = SimpleDateFormat(
                    "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
                    Locale.US
                ).format(Date(messages.first().timestampMillis))

                val payload = JSONObject().apply {
                    put("message_body", body)
                    put("received_at", receivedAt)
                }

                val connection = URL(
                    "https://mpesa-auto-bundles-backend.onrender.com/api/admin/ussd/airtime-transfer-sms"
                ).openConnection() as HttpURLConnection

                try {
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
                        it.write(
                            payload.toString().toByteArray(Charsets.UTF_8)
                        )
                    }

                    Log.i(
                        "MAB_SMS",
                        "Sambaza SMS upload HTTP ${connection.responseCode}"
                    )

                } finally {
                    connection.disconnect()
                }

            } catch (e: Exception) {
                Log.e(
                    "MAB_SMS",
                    "Could not upload Sambaza SMS",
                    e
                )
            } finally {
                pendingResult.finish()
            }
        }.start()
    }
}
