package com.mpesaautobundles.app

import android.os.Bundle
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
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

        private val green = Color.rgb(0, 153, 76)
    private val darkGreen = Color.rgb(0, 92, 46)
    private val yellow = Color.rgb(255, 193, 7)
    private val dark = Color.rgb(25, 45, 35)
    private val grey = Color.rgb(95, 112, 102)
    private val light = Color.rgb(239, 247, 242)

    private lateinit var contentLayout: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.statusBarColor = darkGreen
        window.navigationBarColor = darkGreen

        val token = getSharedPreferences(
            "reseller_session",
            MODE_PRIVATE
        ).getString("token", null)

        if (token.isNullOrBlank()) {
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
        contentLayout.addView(
            makeText(
                "Welcome back!",
                25f,
                dark,
                true
            ).apply {
                setPadding(0, 22, 0, 4)
            }
        )

        contentLayout.addView(
            makeText(
                "Here is your business overview.",
                14f,
                grey
            )
        )

        contentLayout.addView(createStatsGrid())
        contentLayout.addView(createCommissionSection())
        contentLayout.addView(createQuickActions())
        contentLayout.addView(createRecentTransactions())

        scrollView.addView(contentLayout)

        root.addView(
            scrollView,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        )

        root.addView(createSalesControl())
        root.addView(createBottomNavigation())

        setContentView(root)

        validateSession(token)
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

        val logo = makeText("⚡", 34f, yellow, true)
        val title = makeText(
            "M-PESA AUTO BUNDLES",
            16f,
            green,
            true
        )

        brand.addView(logo)
        brand.addView(title)

        header.addView(
            brand,
            LinearLayout.LayoutParams(0, 55, 1f)
        )

        val notification = makeText("♧", 27f, green, true)
        notification.gravity = Gravity.CENTER
        header.addView(notification)

        return header
    }

    private fun createStatsGrid(): View {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 20, 0, 0)
        }

        val firstRow = LinearLayout(this)
        val secondRow = LinearLayout(this)

        firstRow.addView(
            statCard("Today's Sales", "—", "KES"),
            weightedParams()
        )
        firstRow.addView(
            statCard("Commission Earned", "—", "KES"),
            weightedParams()
        )

        secondRow.addView(
            statCard("Successful", "—", "Orders"),
            weightedParams()
        )
        secondRow.addView(
            statCard("Pending / Failed", "—", "Orders"),
            weightedParams()
        )

        container.addView(firstRow)
        container.addView(secondRow)

        return container
    }

    private fun statCard(
        heading: String,
        value: String,
        unit: String
    ): View {
                        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(16, 19, 12, 19)
            minimumHeight = (112 * resources.displayMetrics.density).toInt()
            background = roundedBackground(light, 14)
        }

        card.addView(makeText(heading, 14f, darkGreen, true))
        card.addView(
            makeText(value, 26f, green, true).apply {
                setPadding(0, 9, 0, 2)
            }
        )
        card.addView(makeText(unit, 13f, grey))

        return card
    }

    private fun weightedParams(): LinearLayout.LayoutParams {
        return LinearLayout.LayoutParams(
            0,
            LinearLayout.LayoutParams.WRAP_CONTENT,
            1f
        ).apply {
            setMargins(4, 5, 4, 5)
        }
    }

    private fun createCommissionSection(): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(16, 18, 16, 18)
            background = roundedBackground(light, 14)
        }

        card.addView(
            makeText("Weekly Commission", 17f, dark, true)
        )

        card.addView(
            makeText(
                "Monday – Sunday",
                12f,
                grey
            ).apply {
                setPadding(0, 4, 0, 15)
            }
        )

        val graph = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.BOTTOM
            minimumHeight = 115
        }

        val days = listOf(
            "MON", "TUE", "WED", "THU",
            "FRI", "SAT", "SUN"
        )

        for (day in days) {
            val column = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            }

            val bar = View(this).apply {
                setBackgroundColor(
                    Color.rgb(210, 225, 215)
                )
            }

            column.addView(
                bar,
                LinearLayout.LayoutParams(
                    15,
                    48
                )
            )

            column.addView(
                makeText(day, 9f, grey).apply {
                    gravity = Gravity.CENTER
                    setPadding(0, 7, 0, 0)
                }
            )

            graph.addView(
                column,
                LinearLayout.LayoutParams(
                    0,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    1f
                )
            )
        }

        card.addView(graph)

        card.addView(
            makeText(
                "Actual commission data will appear here.",
                11f,
                grey
            ).apply {
                setPadding(0, 12, 0, 0)
            }
        )

        val params = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )
        params.setMargins(0, 12, 0, 0)

        return card.apply { layoutParams = params }
    }

    private fun createQuickActions(): View {
        val section = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 22, 0, 0)
        }

        section.addView(
            makeText("Quick Actions", 18f, dark, true)
        )

        val row1 = LinearLayout(this)
        val row2 = LinearLayout(this)

        row1.addView(
            actionCard("⚡", "Quick Sell"),
            weightedParams()
        )
        row1.addView(
            actionCard("▣", "My Offers"),
            weightedParams()
        )

        row2.addView(
            actionCard("↔", "Transactions"),
            weightedParams()
        )
        row2.addView(
            actionCard("◉", "My Earnings"),
            weightedParams()
        )

        section.addView(row1)
        section.addView(row2)

        return section
    }

        private fun actionCard(
        symbol: String,
        label: String
    ): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(10, 20, 10, 20)
            minimumHeight = (104 * resources.displayMetrics.density).toInt()
            background = roundedBackground(light, 12)
            isClickable = true
            isFocusable = true
        }

        card.addView(
            makeText(symbol, 27f, darkGreen, true)
        )

        card.addView(
            makeText(label, 14f, dark, true).apply {
                setPadding(0, 8, 0, 0)
            }
        )

        card.setOnClickListener {
            Toast.makeText(
                this,
                "$label will be connected in the next stages.",
                Toast.LENGTH_SHORT
            ).show()
        }

        return card
        }

    private fun createRecentTransactions(): View {
        val section = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 22, 0, 18)
        }

        section.addView(
            makeText("Recent Transactions", 18f, dark, true)
        )

        val emptyCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(15, 24, 15, 24)
            background = roundedBackground(light, 12)
        }

        emptyCard.addView(
            makeText("▤", 30f, grey)
        )

        emptyCard.addView(
            makeText(
                "Your recent transactions will appear here.",
                13f,
                grey
            ).apply {
                gravity = Gravity.CENTER
                setPadding(0, 8, 0, 0)
            }
        )

        section.addView(emptyCard)

        return section
    }

    private fun createSalesControl(): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.END
            setPadding(16, 9, 18, 9)
            setBackgroundColor(Color.WHITE)
        }

        row.addView(
            makeText(
                "Sales control",
                13f,
                dark,
                true
            )
        )

        val switchPreview = Button(this).apply {
            text = "ON"
            
        return row
    }

    private fun createBottomNavigation(): View {
        val nav = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(2, 13, 2, 13)
            setBackgroundColor(Color.rgb(239, 247, 242))
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
                item,
                12f,
                if (item.startsWith("⌂")) darkGreen else grey,
                true
            ).apply {
                gravity = Gravity.CENTER
                setPadding(2, 6, 2, 6)
                isClickable = true
                isFocusable = true
            }

            nav.addView(
                tab,
                LinearLayout.LayoutParams(
                    0,
                    (58 * resources.displayMetrics.density).toInt(),
                    1f
                )
            )
        }

        return nav
    }
    
                    1f
                )
            )
        }

        return nav
        }
        return nav
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

    private fun validateSession(token: String) {
        Thread {
            var valid = false

            try {
                val connection = URL(
                    "https://mpesa-auto-bundles-backend.onrender.com/api/resellers/me"
                ).openConnection() as HttpURLConnection

                connection.requestMethod = "GET"
                connection.connectTimeout = 20000
                connection.readTimeout = 20000

                connection.setRequestProperty(
                    "Authorization",
                    "Bearer $token"
                )

                valid = connection.responseCode in 200..299
                connection.disconnect()

            } catch (_: Exception) {
                valid = true
            }

            runOnUiThread {
                if (!valid) {
                    getSharedPreferences(
                        "reseller_session",
                        MODE_PRIVATE
                    ).edit().clear().apply()

                    Toast.makeText(
                        this,
                        "Your session has expired. Please log in again.",
                        Toast.LENGTH_LONG
                    ).show()

                    goToLogin()
                }
            }
        }.start()
    }

    private fun goToLogin() {
        startActivity(
            Intent(this, MainActivity::class.java)
        )
        finish()
    }
}
