
package com.mpesaautobundles.app

import android.os.Bundle
import android.content.Intent
import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.text.InputType
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class AdminLoginActivity : AppCompatActivity() {

    private val green = Color.rgb(0, 140, 69)

    private lateinit var phoneInput: EditText
    private lateinit var passwordInput: EditText
    private lateinit var loginButton: Button
    private lateinit var progressBar: ProgressBar

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.statusBarColor = Color.rgb(0, 107, 53)
        window.navigationBarColor = Color.rgb(0, 107, 53)

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(28, 32, 28, 32)
            setBackgroundColor(Color.WHITE)
        }

        val logo = TextView(this).apply {
            text = "⚡"
            textSize = 65f
            gravity = Gravity.CENTER
            setTextColor(Color.rgb(255, 193, 7))
        }

        val title = TextView(this).apply {
            text = "ADMIN LOGIN"
            textSize = 25f
            gravity = Gravity.CENTER
            setTextColor(green)
        }

        val subtitle = TextView(this).apply {
            text = "Restricted platform administrator access"
            textSize = 14f
            gravity = Gravity.CENTER
            setTextColor(Color.DKGRAY)
        }

        phoneInput = EditText(this).apply {
            hint = "Administrator phone number"
            inputType = InputType.TYPE_CLASS_PHONE
            setSingleLine(true)
        }

        passwordInput = EditText(this).apply {
            hint = "Administrator password"
            inputType = InputType.TYPE_CLASS_TEXT or
                InputType.TYPE_TEXT_VARIATION_PASSWORD
            setSingleLine(true)
        }

        loginButton = Button(this).apply {
            text = "ADMIN LOGIN"
            setBackgroundColor(green)
            setTextColor(Color.WHITE)
            setOnClickListener {
                loginAdmin()
            }
        }

        progressBar = ProgressBar(this).apply {
            visibility = View.GONE
        }

        layout.addView(logo)
        layout.addView(title)
        layout.addView(subtitle)
        layout.addView(phoneInput, fieldParams())
        layout.addView(passwordInput, fieldParams())
        layout.addView(loginButton, fieldParams())
        layout.addView(progressBar)

        setContentView(layout)
    }

    private fun fieldParams(): LinearLayout.LayoutParams {
        return LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            setMargins(0, 14, 0, 0)
        }
    }

    private fun loginAdmin() {
        val phone = phoneInput.text.toString().trim()
        val password = passwordInput.text.toString()

        if (phone.isEmpty() || password.isEmpty()) {
            Toast.makeText(
                this,
                "Enter your administrator phone and password",
                Toast.LENGTH_LONG
            ).show()
            return
        }

        loginButton.isEnabled = false
        progressBar.visibility = View.VISIBLE

        Thread {
            var message = "Administrator login failed."
            var token: String? = null

            try {
                val url = URL(
                    "https://mpesa-auto-bundles-backend.onrender.com/api/admin/login"
                )

                val connection =
                    url.openConnection() as HttpURLConnection

                connection.requestMethod = "POST"
                connection.connectTimeout = 20000
                connection.readTimeout = 20000
                connection.doOutput = true

                connection.setRequestProperty(
                    "Content-Type",
                    "application/json"
                )

                val request = JSONObject().apply {
                    put("phone", phone)
                    put("password", password)
                }

                connection.outputStream.use { output ->
                    output.write(
                        request.toString().toByteArray(Charsets.UTF_8)
                    )
                }

                val responseCode = connection.responseCode

                val responseStream =
                    if (responseCode in 200..299) {
                        connection.inputStream
                    } else {
                        connection.errorStream
                    }

                val responseText = responseStream
                    ?.bufferedReader()
                    ?.use { it.readText() }
                    ?: ""

                connection.disconnect()

                val response = JSONObject(responseText)

                if (
                    responseCode in 200..299 &&
                    response.optString("status") == "OK" &&
                    response.optString("role") == "admin"
                ) {
                    token = response.optString("token")

                    if (token.isNullOrBlank()) {
                        token = null
                        message = "Admin login response did not contain a token."
                    } else {
                        message = "Admin login successful."
                    }
                } else {
                    message = response.optString(
                        "message",
                        "Invalid administrator credentials."
                    )
                }

            } catch (e: Exception) {
                message = "Cannot connect. Check your internet and try again."
            }

            runOnUiThread {
                progressBar.visibility = View.GONE
                loginButton.isEnabled = true

                if (!token.isNullOrBlank()) {
                    getSharedPreferences(
                        "admin_session",
                        MODE_PRIVATE
                    ).edit()
                        .putString("token", token)
                        .apply()

                    Toast.makeText(
                        this,
                        message,
                        Toast.LENGTH_SHORT
                    ).show()

                    startActivity(
                        Intent(this, AdminDashboardActivity::class.java)
                    )
                    finish()

                } else {
                    Toast.makeText(
                        this,
                        message,
                        Toast.LENGTH_LONG
                    ).show()
                }
            }

        }.start()
    }
}
