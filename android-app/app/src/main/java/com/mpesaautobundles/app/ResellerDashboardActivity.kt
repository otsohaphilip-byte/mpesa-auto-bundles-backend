
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
import java.net.HttpURLConnection
import java.net.URL

class ResellerDashboardActivity : AppCompatActivity() {

    private val green = Color.rgb(0, 153, 76)
    private val darkGreen = Color.rgb(0, 92, 46)
    private val yellow = Color.rgb(255, 193, 7)
    private val dark = Color.rgb(25, 45, 35)
    private val grey = Color.rgb(95, 112, 102)
    private val light = Color.rgb(239, 247, 242)

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

        val scroll = ScrollView(this)
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(18, 18, 18, 20)
        }

        content.addView(createHeader())
        content.addView(makeText("Welcome back!", 25f, dark, true).apply {
            setPadding(0, 22, 0, 4)
        })
        content.addView(makeText(
            "Here is your business overview.", 14f, grey
        ))
        content.addView(createStatsGrid())
        content.addView(createCommissionSection())
        content.addView(createQuickActions())
        content.addView(createRecentTransactions())

        scroll.addView(content)

        root.addView(
            scroll,
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

        brand.addView(makeText("⚡", 34f, yellow, true))
        brand.addView(makeText(
            "M-PESA AUTO BUNDLES", 16f, green, true
        ))

        header.addView(
            brand,
            LinearLayout.LayoutParams(0, 55, 1f)
        )
        header.addView(makeText("♧", 27f, green, true))

        return header
    }

    private fun createStatsGrid(): View {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 20, 0, 0)
        }

        val first = LinearLayout(this)
        val second = LinearLayout(this)

        first.addView(
            statCard("Today's Sales", "—", "KES"),
            weightedParams()
        )
        first.addView(
            statCard("Commission Earned", "—", "KES"),
            weightedParams()
        )
        second.addView(
            statCard("Successful", "—", "Orders"),
            weightedParams()
        )
        second.addView(
            statCard("Pending / Failed", "—", "Orders"),
            weightedParams()
        )

        container.addView(first)
        container.addView(second)

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
            minimumHeight = dp(112)
            background = roundedBackground(light, 14)
        }

        card.addView(makeText(heading, 14f, darkGreen, true))
        card.addView(makeText(value, 26f, green, true).apply {
            setPadding(0, 9, 0, 2)
        })
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

        card.addView(makeText("Weekly Commission", 17f, dark, true))
        card.addView(makeText(
            "Monday – Sunday", 12f, grey
        ).apply {
            setPadding(0, 4, 0, 15)
        })

        val graph = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.BOTTOM
            minimumHeight = dp(115)
        }

        val days = listOf("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")

        for (day in days) {
            val column = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            }

            val bar = View(this).apply {
                setBackgroundColor(Color.rgb(210, 225, 215))
            }

            column.addView(
                bar,
                LinearLayout.LayoutParams(dp(15), dp(48))
            )
            column.addView(makeText(day, 9f, grey).apply {
                gravity = Gravity.CENTER
                setPadding(0, 7, 0, 0)
            })

            graph.addView(
                column,
                LinearLayout.LayoutParams(0, -2, 1f)
            )
        }

        card.addView(graph)
        card.addView(makeText(
            "Actual commission data will appear here.",
            11f,
            grey
        ).apply {
            setPadding(0, 12, 0, 0)
        })

        return card.apply {
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply {
                setMargins(0, 12, 0, 0)
            }
        }
    }

    private fun createQuickActions(): View {
        val section = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 22, 0, 0)
        }

        section.addView(makeText("Quick Actions", 18f, dark, true))

        val first = LinearLayout(this)
        val second = LinearLayout(this)

        first.addView(actionCard("⚡", "Quick Sell"), weightedParams())
        first.addView(actionCard("▣", "My Offers"), weightedParams())
        second.addView(actionCard("↔", "Transactions"), weightedParams())
        second.addView(actionCard("◉", "My Earnings"), weightedParams())

        section.addView(first)
        section.addView(second)

        return section
    }

    private fun actionCard(symbol: String, label: String): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(10, 20, 10, 20)
            minimumHeight = dp(104)
            background = roundedBackground(light, 12)
            isClickable = true
            isFocusable = true
        }

        card.addView(makeText(symbol, 27f, darkGreen, true))
        card.addView(makeText(label, 14f, dark, true).apply {
            setPadding(0, 8, 0, 0)
        })

        card.setOnClickListener {
            Toast.makeText(
                this,
                "$label is not connected yet.",
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

        emptyCard.addView(makeText("▤", 30f, grey))
        emptyCard.addView(makeText(
            "Your recent transactions will appear here.",
            13f,
            grey
        ).apply {
            gravity = Gravity.CENTER
            setPadding(0, 8, 0, 0)
        })

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

        row.addView(makeText("Sales control", 13f, dark, true))

        val switchPreview = Button(this).apply {
            text = "ON"
            textSize = 13f
            setTextColor(Color.WHITE)
            setBackgroundColor(green)
            minWidth = dp(90)
            minHeight = dp(44)
            setOnClickListener {
                Toast.makeText(
                    this@ResellerDashboardActivity,
                    "Sales control is not connected yet.",
                    Toast.LENGTH_LONG
                ).show()
            }
        }

        row.addView(
            switchPreview,
            LinearLayout.LayoutParams(dp(100), dp(48)).apply {
                setMargins(12, 0, 0, 0)
            }
        )

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
                LinearLayout.LayoutParams(0, dp(58), 1f)
            )
        }

        
    private fun validateSession(token: String) {
        Thread {
            var sessionInvalid = false
            var connectionProblem = false

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

                val code = connection.responseCode

                sessionInvalid = code == 401 || code == 403
                connectionProblem = code !in 200..299 &&
                    !sessionInvalid

                connection.disconnect()

            } catch (_: Exception) {
                connectionProblem = true
            }

            runOnUiThread {
                if (sessionInvalid) {
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

                } else if (connectionProblem) {
                    Toast.makeText(
                        this,
                        "Could not verify your session. Check your internet connection.",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }.start()
    }
    
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
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}
