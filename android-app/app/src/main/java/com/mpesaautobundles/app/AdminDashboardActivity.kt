
package com.mpesaautobundles.app

import android.os.Bundle
import android.content.Intent
import android.graphics.Color
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL

class AdminDashboardActivity : AppCompatActivity() {

    private val green = Color.rgb(0, 140, 69)
    private val yellow = Color.rgb(255, 193, 7)

    private lateinit var contentLayout: LinearLayout
    private lateinit var statusText: TextView

    private var adminToken: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.statusBarColor = Color.rgb(0, 107, 53)
        window.navigationBarColor = Color.rgb(0, 107, 53)

        adminToken = getSharedPreferences(
            "admin_session",
            MODE_PRIVATE
        ).getString("token", "") ?: ""

        if (adminToken.isBlank()) {
            goToLogin()
            return
        }

        val mainLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20, 24, 20, 20)
            setBackgroundColor(Color.WHITE)
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
            text = "ADMIN DASHBOARD"
            textSize = 24f
            gravity = Gravity.CENTER
            setTextColor(green)
        }

        val subtitle = TextView(this).apply {
            text = "M-Pesa Auto Bundles Platform Control"
            textSize = 14f
            gravity = Gravity.CENTER
            setTextColor(Color.DKGRAY)
        }

        statusText = TextView(this).apply {
            text = "Loading administrator account..."
            textSize = 15f
            gravity = Gravity.CENTER
            setPadding(0, 20, 0, 20)
        }

        val refreshButton = Button(this).apply {
            text = "REFRESH DASHBOARD"
            setBackgroundColor(green)
            setTextColor(Color.WHITE)
            setOnClickListener {
                loadDashboard()
            }
        }

        val logoutButton = Button(this).apply {
            text = "ADMIN LOG OUT"
            setBackgroundColor(Color.DKGRAY)
            setTextColor(Color.WHITE)

            setOnClickListener {
                getSharedPreferences(
                    "admin_session",
                    MODE_PRIVATE
                ).edit().clear().apply()

                Toast.makeText(
                    this@AdminDashboardActivity,
                    "Admin logged out",
                    Toast.LENGTH_SHORT
                ).show()

                goToLogin()
            }
        }

        contentLayout.addView(logo)
        contentLayout.addView(title)
        contentLayout.addView(subtitle)
        contentLayout.addView(statusText)

        scrollView.addView(contentLayout)

        mainLayout.addView(
            scrollView,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        )

        mainLayout.addView(refreshButton)
        mainLayout.addView(logoutButton)

        setContentView(mainLayout)

        loadDashboard()
    }

    private fun loadDashboard() {
        statusText.text = "Loading platform information..."

        contentLayout.removeViews(
            4,
            contentLayout.childCount - 4
        )

        Thread {
            var adminProfile: JSONObject? = null
            var resellers: JSONArray? = null
            var errorMessage = "Could not load dashboard."

            try {
                val adminConnection = openConnection(
                    "/api/admin/me"
                )

                val adminCode = adminConnection.responseCode
                val adminStream =
                    if (adminCode in 200..299) {
                        adminConnection.inputStream
                    } else {
                        adminConnection.errorStream
                    }

                val adminText = adminStream
                    ?.bufferedReader()
                    ?.use { it.readText() } ?: ""

                adminConnection.disconnect()

                if (adminCode == 401 || adminCode == 403) {
                    throw SecurityException("ADMIN_SESSION_INVALID")
                }

                val adminResponse = JSONObject(adminText)

                if (
                    adminCode !in 200..299 ||
                    adminResponse.optString("status") != "OK" ||
                    adminResponse.optString("role") != "admin"
                ) {
                    throw Exception("Admin verification failed.")
                }

                adminProfile = adminResponse

                val resellerConnection = openConnection(
                    "/api/admin/resellers"
                )

                val resellerCode = resellerConnection.responseCode
                val resellerStream =
                    if (resellerCode in 200..299) {
                        resellerConnection.inputStream
                    } else {
                        resellerConnection.errorStream
                    }

                val resellerText = resellerStream
                    ?.bufferedReader()
                    ?.use { it.readText() } ?: ""

                resellerConnection.disconnect()

                if (resellerCode == 401 || resellerCode == 403) {
                    throw SecurityException("ADMIN_SESSION_INVALID")
                }

                val resellerResponse = JSONObject(resellerText)

                if (
                    resellerCode !in 200..299 ||
                    resellerResponse.optString("status") != "OK"
                ) {
                    throw Exception("Could not load reseller accounts.")
                }

                resellers = resellerResponse.optJSONArray("resellers")

            } catch (e: SecurityException) {
                errorMessage = "Your Admin session has expired."
            } catch (e: Exception) {
                errorMessage =
                    "Could not connect. Check your internet and refresh."
            }

            runOnUiThread {
                if (adminProfile != null && resellers != null) {
                    statusText.text = "Platform information loaded."

                    addSection(
                        "ADMIN ACCOUNT",
                        "Administrator phone: " +
                            adminProfile!!.optString("phone", "Not available") +
                            "\nRole: " +
                            adminProfile!!.optString("role", "Admin")
                    )

                    addSection(
                        "RESELLER MANAGEMENT",
                        "Registered resellers: ${resellers!!.length()}"
                    )

                    var active = 0
                    var pending = 0
                    var suspended = 0

                    for (i in 0 until resellers!!.length()) {
                        val reseller = resellers!!.optJSONObject(i)
                            ?: continue

                        when (reseller.optString("status")) {
                            "active" -> active++
                            "pending" -> pending++
                            "suspended" -> suspended++
                        }
                    }

                    addSection(
                        "ACCOUNT SUMMARY",
                        "Active: $active\nPending approval: $pending\nSuspended: $suspended"
                    )

                    addResellerList(resellers!!)
                } else {
                    statusText.text = errorMessage

                    if (errorMessage.contains("session has expired")) {
                        getSharedPreferences(
                            "admin_session",
                            MODE_PRIVATE
                        ).edit().clear().apply()
                    }
                }
            }
        }.start()
    }

    private fun openConnection(path: String): HttpURLConnection {
        val url = URL(
            "https://mpesa-auto-bundles-backend.onrender.com$path"
        )

        return (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 20000
            readTimeout = 20000
            setRequestProperty(
                "Authorization",
                "Bearer $adminToken"
            )
        }
    }

    private fun addResellerList(resellers: JSONArray) {
        addSection(
            "REGISTERED RESELLERS",
            "Reseller accounts returned by the backend:"
        )

        if (resellers.length() == 0) {
            addSection(
                "NO RESELLERS YET",
                "Registered reseller accounts will appear here."
            )
            return
        }

        for (i in 0 until resellers.length()) {
            val reseller = resellers.optJSONObject(i) ?: continue

            val details =
                "Name: ${reseller.optString("name", "Not provided")}\n" +
                "Phone: ${reseller.optString("phone", "Not provided")}\n" +
                "Status: ${reseller.optString("status", "Unknown")}"

            addSection("RESELLER ${i + 1}", details)
        }
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

        params.setMargins(0, 12, 0, 0)
        contentLayout.addView(section, params)
    }

    private fun goToLogin() {
        startActivity(
            Intent(this, MainActivity::class.java)
        )
        finish()
    }
}
