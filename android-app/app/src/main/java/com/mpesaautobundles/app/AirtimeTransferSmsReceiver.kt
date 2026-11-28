package com.mpesaautobundles.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
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

        val receivedAt = SimpleDateFormat(
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
            Locale.US
        ).format(Date(messages.first().timestampMillis))

        val preferences = context.getSharedPreferences(
            "admin_agent_gateway",
            Context.MODE_PRIVATE
        )

        synchronized(preferences) {
            val existing = try {
                JSONArray(
                    preferences.getString(
                        PENDING_SMS_KEY,
                        "[]"
                    ) ?: "[]"
                )
            } catch (e: Exception) {
                Log.e("MAB_SMS", "Could not read pending SMS queue", e)
                JSONArray()
            }

            val alreadySaved = (0 until existing.length()).any { index ->
                val item = existing.optJSONObject(index)
                item?.optString("message_body") == body &&
                    item.optString("received_at") == receivedAt
            }

            if (alreadySaved) {
                Log.i("MAB_SMS", "Confirmation SMS is already queued")
                return
            }

            val updated = JSONArray()

            for (index in 0 until existing.length()) {
                updated.put(existing.getJSONObject(index))
            }

            updated.put(
                JSONObject().apply {
                    put("message_body", body)
                    put("received_at", receivedAt)
                }
            )

            if (updated.length() > MAX_PENDING_SMS) {
                Log.e("MAB_SMS", "Pending SMS queue is full; SMS was not discarded")
                return
            }

            val saved = preferences.edit()
                .putString(PENDING_SMS_KEY, updated.toString())
                .commit()

            if (saved) {
                Log.i(
                    "MAB_SMS",
                    "Sambaza confirmation SMS saved locally for server delivery"
                )
            } else {
                Log.e(
                    "MAB_SMS",
                    "Could not persist Sambaza confirmation SMS"
                )
            }
        }
    }

    companion object {
        const val PENDING_SMS_KEY = "pending_sambaza_sms"
        const val MAX_PENDING_SMS = 100

    }
}
