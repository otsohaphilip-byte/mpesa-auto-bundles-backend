package com.mpesaautobundles.app

import android.app.Activity
import android.os.Bundle
import android.graphics.Color
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class DashboardSectionActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val section = intent.getStringExtra("section") ?: "Section"
        val role = intent.getStringExtra("role") ?: "user"

        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(28, 28, 28, 28)
            setBackgroundColor(Color.rgb(248, 250, 252))
        }

        val heading = TextView(this).apply {
            text = section
            textSize = 26f
            setTextColor(Color.rgb(25, 35, 45))
            gravity = Gravity.CENTER
        }

        val message = TextView(this).apply {
            text = "This $role section is ready for navigation. Its data and actions will be connected next."
            textSize = 15f
            setTextColor(Color.rgb(95, 105, 115))
            gravity = Gravity.CENTER
            setPadding(0, 18, 0, 24)
        }

        val back = Button(this).apply {
            text = "Back to Dashboard"
            setOnClickListener { finish() }
        }

        page.addView(heading)
        page.addView(message)
        page.addView(back)
        setContentView(page)
    }
}
