
package com.mpesaautobundles.app

import android.os.Bundle
import android.graphics.Color
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Button
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class ResellerDashboardActivity : AppCompatActivity() {

    private val green = Color.rgb(0, 140, 69)
    private val yellow = Color.rgb(255, 193, 7)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.statusBarColor = Color.rgb(0, 107, 53)
        window.navigationBarColor = Color.rgb(0, 107, 53)

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP
            setPadding(24, 40, 24, 24)
            setBackgroundColor(Color.WHITE)
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

        val accountSection = createSection(
            "MY ACCOUNT",
            "Manage your reseller account details."
        )

        val offersSection = createSection(
            "MY BUNDLE OFFERS",
            "View and manage your available bundle offers."
        )

        val salesSection = createSection(
            "MY SALES",
            "View your sales and transactions."
        )

        val earningsSection = createSection(
            "MY EARNINGS",
            "Track your reseller earnings."
        )

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

                finishAffinity()

                startActivity(
                    android.content.Intent(
                        this@ResellerDashboardActivity,
                        MainActivity::class.java
                    )
                )
            }
        }

        layout.addView(logo)
        layout.addView(title)
        layout.addView(welcome)

        layout.addView(accountSection)
        layout.addView(offersSection)
        layout.addView(salesSection)
        layout.addView(earningsSection)
        layout.addView(logoutButton)

        setContentView(layout)
    }

    private fun createSection(
        heading: String,
        description: String
    ): LinearLayout {

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
        }

        section.addView(title)
        section.addView(details)

        val params = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )

        params.setMargins(0, 18, 0, 0)
        section.layoutParams = params

        return section
    }
}
