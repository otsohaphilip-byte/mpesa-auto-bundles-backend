package com.mpesaautobundles.app

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
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

    private val permissionViews = mutableMapOf<String, TextView>()

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
            setPadding(dp(18), dp(18), dp(18), dp(20))
        }

        content.addView(createHeader())

        content.addView(
            makeText("Welcome back!", 25f, dark, true).apply {
                setPadding(0, dp(22), 0, dp(4))
            }
        )

        content.addView(
            makeText(
                "Here is your business overview.",
                14f,
                grey
            )
        )

        content.addView(createStatsGrid())
        content.addView(createCommissionSection())
        content.addView(createQuickActions())
        content.addView(createRecentTransactions())
        content.addView(createPermissionSection())

        scroll.addView(content)

        root.addView(
            scroll,
            LinearLayout.LayoutParams(
                -1,
                0,
                1f
            )
        )

        root.addView(createSalesControl())
        root.addView(createBottomNavigation())

        setContentView(root)

        refreshPermissionStatus()
        validateSession(token)
    }

    override fun onResume() {
        super.onResume()
        refreshPermissionStatus()
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
        brand.addView(
            makeText("M-PESA AUTO BUNDLES", 16f, green, true)
        )

        header.addView(
            brand,
            LinearLayout.LayoutParams(0, dp(55), 1f)
        )

        header.addView(makeText("♧", 27f, green, true))

        return header
    }

    private fun createStatsGrid(): View {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(20), 0, 0)
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
            setPadding(dp(16), dp(19), dp(12), dp(19))
            minimumHeight = dp(112)
            background = roundedBackground(light, 14)
        }

        card.addView(makeText(heading, 14f, darkGreen, true))

        card.addView(
            makeText(value, 26f, green, true).apply {
                setPadding(0, dp(9), 0, dp(2))
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
            setMargins(dp(4), dp(5), dp(4), dp(5))
        }
    }

    private fun createCommissionSection(): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(18), dp(16), dp(18))
            background = roundedBackground(light, 14)
        }

        card.addView(
            makeText("Weekly Commission", 17f, dark, true)
        )

        card.addView(
            makeText("Monday – Sunday", 12f, grey).apply {
                setPadding(0, dp(4), 0, dp(15))
            }
        )

        val graph = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.BOTTOM
            minimumHeight = dp(115)
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
                setBackgroundColor(Color.rgb(210, 225, 215))
            }

            column.addView(
                bar,
                LinearLayout.LayoutParams(dp(15), dp(48))
            )

            column.addView(
                makeText(day, 9f, grey).apply {
                    gravity = Gravity.CENTER
                    setPadding(0, dp(7), 0, 0)
                }
            )

            graph.addView(
                column,
                LinearLayout.LayoutParams(0, -2, 1f)
            )
        }

        card.addView(graph)

        card.addView(
            makeText(
                "Actual commission data will appear here.",
                11f,
                grey
            ).apply {
                setPadding(0, dp(12), 0, 0)
            }
        )

        return card.apply {
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply {
                setMargins(0, dp(12), 0, 0)
            }
        }
    }

    private fun createQuickActions(): View {
        val section = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(22), 0, 0)
        }

        section.addView(
            makeText("Quick Actions", 18f, dark, true)
        )

        val first = LinearLayout(this)
        val second = LinearLayout(this)

        first.addView(actionCard("⚡", "Quick Sell"), weightedParams())
        first.addView(actionCard("▣", "My Offers"), weightedParams())

        second.addView(
            actionCard("↔", "Transactions"),
            weightedParams()
        )

        second.addView(
            actionCard("◉", "My Earnings"),
            weightedParams()
        )

        section.addView(first)
        section.addView(second)

        return section
    }

    private fun actionCard(
        symbol: String,
        label: String
    ): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(10), dp(20), dp(10), dp(20))
            minimumHeight = dp(104)
            background = roundedBackground(light, 12)
            isClickable = true
            isFocusable = true
        }

        card.addView(makeText(symbol, 27f, darkGreen, true))

        card.addView(
            makeText(label, 14f, dark, true).apply {
                setPadding(0, dp(8), 0, 0)
            }
        )

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
            setPadding(0, dp(22), 0, dp(18))
        }

        section.addView(
            makeText("Recent Transactions", 18f, dark, true)
        )

        val emptyCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(15), dp(24), dp(15), dp(24))
            background = roundedBackground(light, 12)
        }

        emptyCard.addView(makeText("▤", 30f, grey))

        emptyCard.addView(
            makeText(
                "Your recent transactions will appear here.",
                13f,
                grey
            ).apply {
                gravity = Gravity.CENTER
                setPadding(0, dp(8), 0, 0)
            }
        )

        section.addView(emptyCard)
        return section
    }

    private fun createPermissionSection(): View {
        val section = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(12), 0, dp(18))
        }

        section.addView(
            makeText("App Permissions & Setup", 19f, dark, true)
        )

        section.addView(
            makeText(
                "Check your phone permissions and accessibility setup here.",
                13f,
                grey
            ).apply {
                setPadding(0, dp(6), 0, dp(12))
            }
        )

        val permissions = listOf(
            "Notifications" to notificationPermission(),
            "SMS" to Manifest.permission.READ_SMS,
            "Phone" to Manifest.permission.READ_PHONE_STATE,
            "Camera" to Manifest.permission.CAMERA,
            "Contacts" to Manifest.permission.READ_CONTACTS,
            "Location" to Manifest.permission.ACCESS_FINE_LOCATION,
            "Nearby devices" to nearbyDevicesPermission()
        )

        for ((name, permission) in permissions) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(12), dp(12), dp(12), dp(12))
                background = roundedBackground(light, 10)
            }

            row.addView(
                makeText(name, 14f, dark, true),
                LinearLayout.LayoutParams(0, -2, 1f)
            )

            val status = makeText("Checking…", 12f, grey, true)
            permissionViews[name] = status
            row.addView(status)

            section.addView(
                row,
                LinearLayout.LayoutParams(-1, -2).apply {
                    setMargins(0, dp(3), 0, dp(3))
                }
            )
        }

        val accessibilityRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(12), dp(12), dp(12))
            background = roundedBackground(light, 10)
        }

        accessibilityRow.addView(
            makeText("Accessibility Service", 14f, dark, true),
            LinearLayout.LayoutParams(0, -2, 1f)
        )

        val accessibilityStatus = makeText("Checking…", 12f, grey, true)
        permissionViews["Accessibility"] = accessibilityStatus
        accessibilityRow.addView(accessibilityStatus)

        section.addView(
            accessibilityRow,
            LinearLayout.LayoutParams(-1, -2).apply {
                setMargins(0, dp(3), 0, dp(3))
            }
        )

        val appSettingsButton = Button(this).apply {
            text = "OPEN APP PERMISSION SETTINGS"
            setTextColor(Color.WHITE)
            setBackgroundColor(green)
            setOnClickListener {
                openAppSettings()
            }
        }

        section.addView(
            appSettingsButton,
            LinearLayout.LayoutParams(-1, dp(50)).apply {
                setMargins(0, dp(10), 0, dp(6))
            }
        )

        val accessibilityButton = Button(this).apply {
            text = "OPEN ACCESSIBILITY SETTINGS"
            setTextColor(Color.WHITE)
            setBackgroundColor(darkGreen)
            setOnClickListener {
                try {
                    startActivity(
                        Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
                    )
                } catch (_: Exception) {
                    openAppSettings()
                }
            }
        }

        section.addView(
            accessibilityButton,
            LinearLayout.LayoutParams(-1, dp(50))
        )

        return section
    }

    private fun notificationPermission(): String {
        return if (Build.VERSION.SDK_INT >= 33) {
            Manifest.permission.POST_NOTIFICATIONS
        } else {
            "NOT_REQUIRED"
        }
    }

    private fun nearbyDevicesPermission(): String {
        return if (Build.VERSION.SDK_INT >= 31) {
            Manifest.permission.BLUETOOTH_CONNECT
        } else {
            "NOT_REQUIRED"
        }
    }

    private fun refreshPermissionStatus() {
        for ((name, permission) in listOf(
            "Notifications" to notificationPermission(),
            "SMS" to Manifest.permission.READ_SMS,
            "Phone" to Manifest.permission.READ_PHONE_STATE,
            "Camera" to Manifest.permission.CAMERA,
            "Contacts" to Manifest.permission.READ_CONTACTS,
            "Location" to Manifest.permission.ACCESS_FINE_LOCATION,
            "Nearby devices" to nearbyDevicesPermission()
        )) {
            val granted = permission == "NOT_REQUIRED" ||
                checkSelfPermission(permission) ==
                PackageManager.PERMISSION_GRANTED

            permissionViews[name]?.apply {
                text = if (granted) "Granted" else "Not granted"
                setTextColor(if (granted) green else Color.RED)
            }
        }

        val component = ComponentName(
            this,
            BundleAutomationAccessibilityService::class.java
        )

        val enabledServices = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ).orEmpty()

        val enabled = enabledServices.split(":").any {
            it.equals(component.flattenToString(), ignoreCase = true)
        }

        permissionViews["Accessibility"]?.apply {
            text = if (enabled) "Enabled" else "Not enabled"
            setTextColor(if (enabled) green else Color.RED)
        }
    }

    private fun openAppSettings() {
        val intent = Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:$packageName")
        )
        startActivity(intent)
    }

    private fun createSalesControl(): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.END
            setPadding(dp(16), dp(9), dp(18), dp(9))
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
                setMargins(dp(12), 0, 0, 0)
            }
        )

        return row
    }

        private fun createBottomNavigation(): View {
        val nav = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(dp(2), dp(13), dp(2), dp(13))
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
                setPadding(dp(2), dp(6), dp(2), dp(6))
                isClickable = true
                isFocusable = true

                setOnClickListener {
                    val section = item.substringAfter("\n")

                    if (section != "Home") {
                        val intent = Intent(
                            this@ResellerDashboardActivity,
                            DashboardSectionActivity::class.java
                        )
                        intent.putExtra("section", section)
                        intent.putExtra("role", "reseller")
                        startActivity(intent)
                    }
                }
            }

            nav.addView(
                tab,
                LinearLayout.LayoutParams(0, dp(58), 1f)
            )
        }

        return nav
        }

    private fun validateSession(token: String) {
        Thread {
            var sessionInvalid = false
            var connectionProblem = false

            try {
                val connection = URL(
                    "https://mpesa-auto-bundles-backend.onrender.com/api/reseller/me"
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
                connectionProblem =
                    code !in 200..299 && !sessionInvalid

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
                setTypeface(null, android.graphics.Typeface.BOLD)
            }
        }
    }

    private fun roundedBackground(
        color: Int,
        radius: Int
    ): GradientDrawable {
        return GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(radius).toFloat()
        }
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }

    private fun goToLogin() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}
