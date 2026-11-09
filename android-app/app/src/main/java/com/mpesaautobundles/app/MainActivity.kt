
package com.mpesaautobundles.app

import android.os.Bundle
import android.graphics.Color
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private val green = Color.rgb(0, 140, 69)
    private val yellow = Color.rgb(255, 193, 7)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.statusBarColor = Color.rgb(0, 107, 53)
        window.navigationBarColor = Color.rgb(0, 107, 53)

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

        val resellerButton = Button(this).apply {
            text = "RESELLER LOGIN"
            setBackgroundColor(green)
            setTextColor(Color.WHITE)
            setOnClickListener {
                // Reseller login will be connected next.
            }
        }

        layout.addView(logo)
        layout.addView(title)
        layout.addView(subtitle)

        layout.addView(
            resellerButton,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                60
            ).apply {
                setMargins(0, 28, 0, 0)
            }
        )

        setContentView(layout)
    }
}
