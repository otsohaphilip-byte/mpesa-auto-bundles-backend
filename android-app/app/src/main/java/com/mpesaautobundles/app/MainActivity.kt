
package com.mpesaautobundles.app

import android.os.Bundle
import android.content.Intent
import android.graphics.Color
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private val green = Color.rgb(0, 140, 69)
    private val darkGreen = Color.rgb(0, 107, 53)
    private val yellow = Color.rgb(255, 193, 7)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.statusBarColor = darkGreen
        window.navigationBarColor = darkGreen

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(32, 40, 32, 40)
            setBackgroundColor(Color.WHITE)
        }

        val logo = TextView(this).apply {
            text = "⚡"
            textSize = 80f
            gravity = Gravity.CENTER
            setTextColor(yellow)
        }

        val title = TextView(this).apply {
            text = "M-PESA AUTO BUNDLES"
            textSize = 25f
            gravity = Gravity.CENTER
            setTextColor(green)
        }

        val subtitle = TextView(this).apply {
            text = "Fast. Simple. Reliable."
            textSize = 16f
            gravity = Gravity.CENTER
            setTextColor(Color.DKGRAY)
        }

        val adminLabel = TextView(this).apply {
            text = "PLATFORM ADMINISTRATOR"
            textSize = 12f
            gravity = Gravity.CENTER
            setTextColor(Color.DKGRAY)
        }

        val adminButton = Button(this).apply {
            text = "ADMIN LOGIN"
            setBackgroundColor(darkGreen)
            setTextColor(Color.WHITE)

            setOnClickListener {
                startActivity(
                    Intent(
                        this@MainActivity,
                        AdminLoginActivity::class.java
                    )
                )
            }
        }

        val resellerLabel = TextView(this).apply {
            text = "APPROVED RESELLERS"
            textSize = 12f
            gravity = Gravity.CENTER
            setTextColor(Color.DKGRAY)
        }

        val resellerButton = Button(this).apply {
            text = "RESELLER LOGIN"
            setBackgroundColor(green)
            setTextColor(Color.WHITE)

            setOnClickListener {
                startActivity(
                    Intent(
                        this@MainActivity,
                        LoginActivity::class.java
                    )
                )
            }
        }

        layout.addView(logo)
        layout.addView(title)
        layout.addView(subtitle)

        layout.addView(adminLabel, fieldParams(24))
        layout.addView(adminButton, buttonParams())

        layout.addView(resellerLabel, fieldParams(18))
        layout.addView(resellerButton, buttonParams())

        setContentView(layout)
    }

    private fun fieldParams(topMargin: Int): LinearLayout.LayoutParams {
        return LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            setMargins(0, topMargin, 0, 4)
        }
    }

    private fun buttonParams(): LinearLayout.LayoutParams {
        return LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            60
        ).apply {
            setMargins(0, 4, 0, 0)
        }
    }
}
