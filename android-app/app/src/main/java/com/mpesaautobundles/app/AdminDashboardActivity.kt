package com.mpesaautobundles.app

import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class AdminDashboardActivity : AppCompatActivity() {

    private val green = Color.rgb(0, 140, 69)
    private val darkGreen = Color.rgb(0, 107, 53)
    private val yellow = Color.rgb(255, 193, 7)
    private val dark = Color.rgb(35, 45, 40)
    private val grey = Color.rgb(110, 120, 115)
    private val light = Color.rgb(245, 248, 246)

    private lateinit var contentLayout: LinearLayout
    private lateinit var statusText: TextView
    private var adminToken = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = darkGreen
        window.navigationBarColor = darkGreen

        adminToken = getSharedPreferences("admin_session", MODE_PRIVATE)
            .getString("token", "") ?: ""

        if (adminToken.isBlank()) {
            goToLogin()
            return
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
        }
        val scrollView = ScrollView(this)
        contentLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(18, 18, 18, 20)
        }

        contentLayout.addView(createHeader())
        contentLayout.addView(makeText("Welcome back!", 25f, dark, true).apply {
            setPadding(0, 22, 0, 4)
        })
        contentLayout.addView(makeText("Here is your business overview.", 14f, grey))

        statusText = makeText("Loading business information...", 12f, grey).apply {
            setPadding(0, 8, 0, 4)
        }
        contentLayout.addView(statusText)
        contentLayout.addView(createStatsGrid())
        contentLayout.addView(createCommissionSection())
        contentLayout.addView(createQuickActions())
        contentLayout.addView(createRecentTransactions())

        scrollView.addView(contentLayout)
        root.addView(scrollView, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f
        ))
        root.addView(createSalesControl())
        root.addView(createBottomNavigation())
        setContentView(root)
        loadDashboard()
    }

    private fun createHeader(): View {
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val brand = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        brand.addView(makeText("⚡", 34f, yellow, true))
        brand.addView(makeText("M-PESA AUTO BUNDLES", 16f, green, true))
        header.addView(brand, LinearLayout.LayoutParams(0, 55, 1f))
        header.addView(makeText("♧", 27f, green, true).apply {
            gravity = Gravity.CENTER
        })
        return header
    }

    private fun createStatsGrid(): View {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 20, 0, 0)
        }
        val first = LinearLayout(this)
        val second = LinearLayout(this)
        first.addView(statCard("Today's Sales", "—", "KES"), weightedParams())
        first.addView(statCard("Commission Earned", "—", "KES"), weightedParams())
        second.addView(statCard("Successful", "—", "Orders"), weightedParams())
        second.addView(statCard("Pending / Failed", "—", "Orders"), weightedParams())
        container.addView(first)
        container.addView(second)
        return container
    }

    private fun statCard(heading: String, value: String, unit: String): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(14, 16, 10, 16)
            background = roundedBackground(light, 14)
        }
        card.addView(makeText(heading, 13f, grey, true))
        card.addView(makeText(value, 25f, green, true).apply {
            setPadding(0, 9, 0, 2)
        })
        card.addView(makeText(unit, 12f, grey))
        return card
    }

    private fun weightedParams() = LinearLayout.LayoutParams(
        0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f
    ).apply { setMargins(4, 5, 4, 5) }

    private fun createCommissionSection(): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(16, 18, 16, 18)
            background = roundedBackground(light, 14)
        }
        card.addView(makeText("Weekly Commission", 17f, dark, true))
        card.addView(makeText("Monday – Sunday", 12f, grey).apply {
            setPadding(0, 4, 0, 15)
        })
        val graph = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.BOTTOM
            minimumHeight = 115
        }
        for (day in listOf("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")) {
            val column = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            }
            val bar = View(this).apply {
                setBackgroundColor(Color.rgb(210, 225, 215))
            }
            column.addView(bar, LinearLayout.LayoutParams(15, 48))
            column.addView(makeText(day, 9f, grey).apply {
                gravity = Gravity.CENTER
                setPadding(0, 7, 0, 0)
            })
            graph.addView(column, LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f
            ))
        }
        card.addView(graph)
        card.addView(makeText("Actual commission data will appear here.", 11f, grey).apply {
            setPadding(0, 12, 0, 0)
        })
        return card.apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(0, 12, 0, 0) }
        }
    }

    private fun createQuickActions(): View {
        val section = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 22, 0, 0)
        }
        section.addView(makeText("Quick Actions", 18f, dark, true))
        val row1 = LinearLayout(this)
        val row2 = LinearLayout(this)
        val row3 = LinearLayout(this)
        row1.addView(actionCard("⚡", "Quick Sell"), weightedParams())
        row1.addView(actionCard("+", "My Offers"), weightedParams())
        row2.addView(actionCard("↔", "Transactions"), weightedParams())
        row2.addView(actionCard("◉", "My Earnings"), weightedParams())
        row3.addView(actionCard("👥", "Sellers"), weightedParams())
        section.addView(row1)
        section.addView(row2)
        section.addView(row3)
        return section
    }

    private fun actionCard(symbol: String, label: String): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(8, 17, 8, 17)
            background = roundedBackground(light, 12)
            isClickable = true
            isFocusable = true
        }
        card.addView(makeText(symbol, 25f, green, true))
        card.addView(makeText(label, 13f, dark, true).apply {
            setPadding(0, 7, 0, 0)
        })
        card.setOnClickListener {
            if (label == "Sellers") loadResellers()
            else Toast.makeText(this, "$label will be connected in the next stage.", Toast.LENGTH_SHORT).show()
        }
        return card
    }

    private fun createRecentTransactions(): View {
        val section = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 22, 0, 18)
        }
        section.addView(makeText("Recent Transactions", 18f, dark, true))
        val empty = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(15, 24, 15, 24)
            background = roundedBackground(light, 12)
        }
        empty.addView(makeText("▤", 30f, grey))
        empty.addView(makeText("Your recent transactions will appear here.", 13f, grey).apply {
            gravity = Gravity.CENTER
            setPadding(0, 8, 0, 0)
        })
        section.addView(empty)
        return section
    }

    private fun createSalesControl(): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.END
            setPadding(16, 9, 18, 9)
            setBackgroundColor(Color.WHITE)
        }
        row.addView(makeText("Sales control", 13f, dark, true))
        val button = Button(this).apply {
            text = "ON"
            textSize = 13f
            setTextColor(Color.WHITE)
            setBackgroundColor(green)
            minWidth = 90
            minHeight = 44
            setOnClickListener {
                Toast.makeText(this@AdminDashboardActivity,
                    "Sales control will be connected to platform settings.",
                    Toast.LENGTH_LONG).show()
            }
        }
        row.addView(button, LinearLayout.LayoutParams(100, 48).apply {
            setMargins(12, 0, 0, 0)
        })
        return row
    }
        private fun createBottomNavigation(): View {
        val nav = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(2, 10, 2, 10)
            setBackgroundColor(Color.rgb(250, 250, 250))
        }
        val items = listOf(
            "⌂\nHome",
            "▥\nAnalytics",
            "↔\nTransactions",
            "●\nAccount",
            "⚙\nSettings"
        )
        for (item in items) {
            val tab = makeText(
                item, 11f,
                if (item.startsWith("⌂")) green else grey,
                true
            ).apply {
                gravity = Gravity.CENTER
                setPadding(2, 4, 2, 4)
                isClickable = true
                isFocusable = true
                setOnClickListener {
                    val section = item.substringAfter("\n")
                    if (section != "Home") {
                        val intent = Intent(
                            this@AdminDashboardActivity,
                            DashboardSectionActivity::class.java
                        )
                        intent.putExtra("section", section)
                        intent.putExtra("role", "admin")
                        startActivity(intent)
                    }
                }
            }
            nav.addView(tab, LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f
            ))
        }
        return nav
    }

    private fun loadDashboard() {
        Thread {
            var message = "Admin account connected."
            var expired = false
            try {
                val connection = openConnection("/api/admin/me")
                val code = connection.responseCode
                val stream = if (code in 200..299) {
                    connection.inputStream
                } else {
                    connection.errorStream
                }
                val body = stream?.bufferedReader()?.use {
                    it.readText()
                } ?: ""
                connection.disconnect()

                if (code == 401 || code == 403) {
                    throw SecurityException()
                }

                val response = JSONObject(body)
                if (
                    code !in 200..299 ||
                    response.optString("status") != "SUCCESS" ||
                    response.optJSONObject("user") == null
                ) {
                    throw Exception("Admin profile could not be verified.")
                }
            } catch (e: SecurityException) {
                message = "Your Admin session has expired."
                expired = true
            } catch (e: Exception) {
                message = "Could not connect. Check your internet and try again."
            }

            runOnUiThread {
                statusText.text = message
                if (expired) {
                    getSharedPreferences("admin_session", MODE_PRIVATE)
                        .edit().clear().apply()
                    goToLogin()
                }
            }
        }.start()
    }

    private fun loadResellers() {
        Toast.makeText(
            this,
            "Loading sellers...",
            Toast.LENGTH_SHORT
        ).show()

        Thread {
            try {
                val connection = openConnection("/api/admin/resellers")
                val code = connection.responseCode
                val stream = if (code in 200..299) {
                    connection.inputStream
                } else {
                    connection.errorStream
                }
                val body = stream?.bufferedReader()?.use {
                    it.readText()
                } ?: ""
                connection.disconnect()

                if (code == 401 || code == 403) {
                    throw SecurityException()
                }

                val response = JSONObject(body)
                if (
                    code !in 200..299 ||
                    response.optString("status") != "SUCCESS"
                ) {
                    throw Exception(
                        response.optString(
                            "message",
                            "Unable to load sellers."
                        )
                    )
                }

                val sellers = response.optJSONArray("resellers")
                    ?: JSONArray()

                runOnUiThread {
                    showResellers(sellers)
                }
            } catch (e: SecurityException) {
                runOnUiThread {
                    Toast.makeText(
                        this,
                        "Your Admin session has expired. Please log in again.",
                        Toast.LENGTH_LONG
                    ).show()

                    getSharedPreferences("admin_session", MODE_PRIVATE)
                        .edit().clear().apply()
                    goToLogin()
                }
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(
                        this,
                        e.message ?: "Could not load sellers.",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }.start()
    }

    private fun showResellers(sellers: JSONArray) {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20, 12, 20, 12)
        }

        if (sellers.length() == 0) {
            container.addView(
                makeText("No sellers have registered yet.", 15f, grey)
            )
        }

        for (i in 0 until sellers.length()) {
            val seller = sellers.getJSONObject(i)
            val name = seller.optString("name", "Unnamed seller")
            val email = seller.optString("email", "No email")
            val phone = seller.optString("phone", "No phone")
            val status = seller.optString("status", "pending")
            val till = seller.optString("buy_goods_till", "Not provided")

            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(12, 12, 12, 12)
                background = roundedBackground(light, 12)
            }

            card.addView(makeText(name, 17f, dark, true))
            card.addView(makeText("Email: $email", 13f, grey))
            card.addView(makeText("Phone: $phone", 13f, grey))
            card.addView(makeText("Buy Goods Till: $till", 13f, grey))
            card.addView(
                makeText(
                    "Account status: ${status.uppercase()}",
                    13f,
                    if (status == "active") green else grey,
                    true
                )
            )

            container.addView(
                card,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    setMargins(0, 0, 0, 12)
                }
            )
        }

        val scroll = ScrollView(this).apply {
            addView(container)
        }

        AlertDialog.Builder(this)
            .setTitle("Registered Sellers (${sellers.length()})")
            .setView(scroll)
            .setPositiveButton("Close", null)
            .show()
    }

    private fun makeText(
        value: String,
        size: Float,
        color: Int,
        bold: Boolean = false
    ): TextView {
        return TextView(this).apply {
            text = value
            textSize = size
            setTextColor(color)
            if (bold) {
                setTypeface(null, Typeface.BOLD)
            }
        }
    }

    private fun roundedBackground(
        color: Int,
        radius: Int
    ): GradientDrawable {
        return GradientDrawable().apply {
            setColor(color)
            cornerRadius = radius * resources.displayMetrics.density
        }
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

    private fun goToLogin() {
        startActivity(
            Intent(this, MainActivity::class.java)
        )
        finish()
    }
}
