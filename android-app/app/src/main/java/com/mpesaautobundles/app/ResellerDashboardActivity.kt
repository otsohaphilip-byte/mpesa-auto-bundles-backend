
package com.mpesaautobundles.app

import android.os.Bundle
import android.content.Intent
import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class ResellerDashboardActivity : AppCompatActivity() {

    private val green = Color.rgb(0, 140, 69)
    private val yellow = Color.rgb(255, 193, 7)

    private lateinit var contentLayout: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.statusBarColor = Color.rgb(0, 107, 53)
        window.navigationBarColor = Color.rgb(0, 107, 53)

        val token = getSharedPreferences(
            "reseller_session",
            MODE_PRIVATE
        ).getString("token", null)

        if (token.isNullOrBlank()) {
            goToLogin()
            return
        }

        val mainLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
            setPadding(20, 24, 20, 20)
        }

        val scrollView = ScrollView(this)

        contentLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        val logo = TextView(this).apply {
            text = "⚡"
            textSize = 55f
            gravity = Gravity.CENTER
            setTextColor(yellow)
        }

        val title = TextView(this).apply {
            text = "RESELLER DASHBOARD"
            textSize = 23f
            gravity = Gravity.CENTER
            setTextColor(green)
        }

        val welcome = TextView(this).apply {
            text = "Welcome to M-Pesa Auto Bundles"
            textSize = 17f
            gravity = Gravity.CENTER
            setTextColor(Color.DKGRAY)
        }

        contentLayout.addView(logo)
        contentLayout.addView(title)
        contentLayout.addView(welcome)

        val loading = TextView(this).apply {
            text = "Loading your account..."
            textSize = 16f
            gravity = Gravity.CENTER
            setPadding(0, 30, 0, 30)
        }

        contentLayout.addView(loading)

        val logoutButton = Button(this).apply {
            text = "LOG OUT"
            setBackgroundColor(green)
            setTextColor(Color.WHITE)

            setOnClickListener {
                getSharedPreferences(
                    "reseller_session",
                    MODE_PRIVATE
                ).edit().clear().apply()

                Toast.makeText(
                    this@ResellerDashboardActivity,
                    "Logged out successfully",
                    Toast.LENGTH_SHORT
                ).show()

                goToLogin()
            }
        }

        scrollView.addView(contentLayout)
        mainLayout.addView(
            scrollView,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        )

        mainLayout.addView(logoutButton)
        setContentView(mainLayout)

        loadResellerProfile(token, loading)
    }

    private fun loadResellerProfile(
        token: String,
        loading: TextView
    ) {
        Thread {
            var profile: JSONObject? = null
            var errorMessage = "Could not load your account."

            try {
                val url = URL(
                    "https://mpesa-auto-bundles-backend.onrender.com/api/resellers/me"
                )

                val connection =
                    url.openConnection() as HttpURLConnection

                connection.requestMethod = "GET"
                connection.connectTimeout = 20000
                connection.readTimeout = 20000

                connection.setRequestProperty(
                    "Authorization",
                    "Bearer $token"
                )

                val responseCode = connection.responseCode

                val responseStream =
                    if (responseCode in 200..299) {
                        connection.inputStream
                    } else {
                        connection.errorStream
                    }

                val responseText = responseStream
                    ?.bufferedReader()
                    ?.use { it.readText() }
                    ?: ""

                connection.disconnect()

                val response = JSONObject(responseText)

                if (
                    responseCode in 200..299 &&
                    response.optString("status") == "OK"
                ) {
                    profile = response.optJSONObject("reseller")
                } else if (responseCode == 401) {
                    errorMessage = "Your session has expired. Please log in again."
                } else {
                    errorMessage = response.optString(
                        "message",
                        "Could not load your account."
                    )
                }

            } catch (e: Exception) {
                errorMessage =
                    "Connection failed. Please check your internet."
            }

            runOnUiThread {
                if (profile != null) {
                    loading.visibility = View.GONE
                    showProfile(profile!!)
                } else {
                    loading.text = errorMessage

                    if (errorMessage.contains("session has expired")) {
                        getSharedPreferences(
                            "reseller_session",
                            MODE_PRIVATE
                        ).edit().clear().apply()
                    }
                }
            }

        }.start()
    }

    private fun showProfile(profile: JSONObject) {

        addSection(
            "MY ACCOUNT",
            "Name: ${profile.optString("name", "Not provided")}\n" +
            "Email: ${profile.optString("email", "Not provided")}\n" +
            "Phone: ${profile.optString("phone", "Not provided")}\n" +
            "Buy Goods Till: ${profile.optString("buy_goods_till", "Not provided")}\n" +
            "Till Phone: ${profile.optString("till_phone", "Not provided")}\n" +
            "Account Status: ${profile.optString("status", "Unknown")}"
        )

        addSection(
            "MY BUNDLE OFFERS",
            "Your available bundle offers will appear here."
        )

        addSection(
            "MY SALES",
            "Your sales and transactions will appear here."
        )

        addSection(
            "MY EARNINGS",
            "Your earnings information will appear here."
        )
    }

    private fun addSection(
        heading: String,
        description: String
    ) {
        val section = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(18, 18, 18, 18)
            setBackgroundColor(Color.rgb(245, 248, 245))
        }

        val title = TextView(this).apply {
            text = heading
            textSize = 17f
            setTextColor(green)
        }

        val details = TextView(this).apply {
            text = description
            textSize = 14f
            setTextColor(Color.DKGRAY)
            setPadding(0, 10, 0, 0)
        }

        section.addView(title)
        section.addView(details)

        val params = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )

        params.setMargins(0, 18, 0, 0)
        contentLayout.addView(section, params)
    }

    private fun goToLogin() {
        startActivity(
            Intent(this, MainActivity::class.java)
        )
        finish()
    }
}
