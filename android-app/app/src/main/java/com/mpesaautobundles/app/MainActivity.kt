
package com.mpesaautobundles.app

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

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
            textSize = 90f
            gravity = Gravity.CENTER
            setTextColor(Color.rgb(255, 193, 7))
        }

        val title = TextView(this).apply {
            text = "M-PESA AUTO BUNDLES"
            textSize = 25f
            gravity = Gravity.CENTER
            setTextColor(Color.rgb(0, 140, 69))
        }

        val subtitle = TextView(this).apply {
            text = "Fast. Simple. Reliable."
            textSize = 16f
            gravity = Gravity.CENTER
            setTextColor(Color.DKGRAY)
        }

        val loginButton = Button(this).apply {
            text = "LOGIN"
            textSize = 17f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(0, 140, 69))

            setOnClickListener {
                startActivity(
                    Intent(this@MainActivity, LoginActivity::class.java)
                )
            }
        }

        layout.addView(logo)
        layout.addView(title)
        layout.addView(subtitle)

        layout.addView(loginButton,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                60
            ).apply {
                setMargins(0, 35, 0, 0)
            }
        )

        setContentView(layout)
    }
}
