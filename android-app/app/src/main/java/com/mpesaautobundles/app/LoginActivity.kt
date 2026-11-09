
package com.mpesaautobundles.app

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class LoginActivity : AppCompatActivity() {

    private lateinit var phoneInput: EditText
    private lateinit var passwordInput: EditText
    private lateinit var loginButton: Button
    private lateinit var progressBar: ProgressBar

    private val green = Color.rgb(0, 140, 69)
    private val darkGreen = Color.rgb(0, 107, 53)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.statusBarColor = darkGreen
        window.navigationBarColor = darkGreen

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(28, 35, 28, 35)
            setBackgroundColor(Color.WHITE)
        }

        val logo = TextView(this).apply {
            text = "⚡"
            textSize = 75f
            gravity = Gravity.CENTER
            setTextColor(Color.rgb(255, 193, 7))
        }

        val title = TextView(this).apply {
            text = "M-PESA AUTO BUNDLES"
            textSize = 23f
            gravity = Gravity.CENTER
            setTextColor(green)
        }

        val subtitle = TextView(this).apply {
            text = "LOGIN"
            textSize = 21f
            gravity = Gravity.CENTER
            setTextColor(Color.DKGRAY)
        }

        phoneInput = EditText(this).apply {
            hint = "Phone number"
            setTextColor(Color.BLACK)
            setHintTextColor(Color.GRAY)
            textSize = 16f
            inputType = InputType.TYPE_CLASS_PHONE
            setSingleLine(true)
            setPadding(14, 12, 14, 12)
            backgroundTintList =
                android.content.res.ColorStateList.valueOf(green)
        }

        passwordInput = EditText(this).apply {
            hint = "Password"
            setTextColor(Color.BLACK)
            setHintTextColor(Color.GRAY)
            textSize = 16f
            inputType = InputType.TYPE_CLASS_TEXT or
                InputType.TYPE_TEXT_VARIATION_PASSWORD
            setSingleLine(true)
            setPadding(14, 12, 14, 12)
            backgroundTintList =
                android.content.res.ColorStateList.valueOf(green)
        }

        loginButton = Button(this).apply {
            text = "LOGIN"
            textSize = 17f
            setTextColor(Color.WHITE)
            setBackgroundColor(green)
            setOnClickListener {
                performLogin()
            }
        }

        progressBar = ProgressBar(this).apply {
            visibility = View.GONE
        }

        content.addView(logo)
        content.addView(title)
        content.addView(subtitle)

        content.addView(phoneInput, fieldParams())
        content.addView(passwordInput, fieldParams())
        content.addView(loginButton, fieldParams())

        content.addView(progressBar, fieldParams())

        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(content)
        }

        setContentView(scroll)
    }

    private fun fieldParams(): LinearLayout.LayoutParams {
        return LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            setMargins(0, 18, 0, 0)
        }
    }

    private fun performLogin() {
        val phone = phoneInput.text.toString().trim()
        val password = passwordInput.text.toString()

        if (phone.isEmpty() || password.isEmpty()) {
            Toast.makeText(
                this,
                "Enter your phone number and password",
                Toast.LENGTH_LONG
            ).show()
            return
        }

        loginButton.isEnabled = false
        progressBar.visibility = View.VISIBLE

        Thread {
            var adminToken: String? = null
            var resellerToken: String? = null
            var errorMessage =
                "Login failed. Check your phone number and password."

            try {
                val adminResponse = sendLogin(
                    "/api/admin/login",
                    phone,
                    password
                )

                if (
                    adminResponse != null &&
                    adminResponse.optString("status") == "OK" &&
                    adminResponse.optString("role") == "admin"
                ) {
                    adminToken = adminResponse.optString("token")
                }

                if (adminToken.isNullOrBlank()) {
                    val resellerResponse = sendLogin(
                        "/api/resellers/login",
                        phone,
                        password
                    )

                    if (
                        resellerResponse != null &&
                        resellerResponse.optString("status") == "OK"
                    ) {
                        resellerToken =
                            resellerResponse.optString("token")
                    }

                    if (resellerToken.isNullOrBlank()) {
                        errorMessage =
                            "Invalid login details, or reseller account is not approved."
                    }
                }

            } catch (e: Exception) {
                errorMessage =
                    "Cannot connect. Check your internet and try again."
            }

            runOnUiThread {
                progressBar.visibility = View.GONE
                loginButton.isEnabled = true

                when {
                    !adminToken.isNullOrBlank() -> {
                        getSharedPreferences(
                            "reseller_session",
                            MODE_PRIVATE
                        ).edit().clear().apply()

                        getSharedPreferences(
                            "admin_session",
                            MODE_PRIVATE
                        ).edit()
                            .putString("token", adminToken)
                            .apply()

                        startActivity(
                            Intent(
                                this,
                                AdminDashboardActivity::class.java
                            )
                        )
                        finish()
                    }

                    !resellerToken.isNullOrBlank() -> {
                        getSharedPreferences(
                            "admin_session",
                            MODE_PRIVATE
                        ).edit().clear().apply()

                        getSharedPreferences(
                            "reseller_session",
                            MODE_PRIVATE
                        ).edit()
                            .putString("token", resellerToken)
                            .apply()

                        startActivity(
                            Intent(
                                this,
                                ResellerDashboardActivity::class.java
                            )
                        )
                        finish()
                    }

                    else -> {
                        Toast.makeText(
                            this,
                            errorMessage,
                            Toast.LENGTH_LONG
                        ).show()
                    }
                }
            }
        }.start()
    }

    private fun sendLogin(
        path: String,
        phone: String,
        password: String
    ): JSONObject? {

        val connection = URL(
            "https://mpesa-auto-bundles-backend.onrender.com$path"
        ).openConnection() as HttpURLConnection

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

        return try {
            connection.outputStream.use {
                it.write(request.toString().toByteArray(Charsets.UTF_8))
            }

            val code = connection.responseCode

            val stream = if (code in 200..299) {
                connection.inputStream
            } else {
                connection.errorStream
            }

            val responseText = stream
                ?.bufferedReader()
                ?.use { it.readText() }
                ?: ""

            if (responseText.isBlank()) null
            else JSONObject(responseText)

        } finally {
            connection.disconnect()
        }
    }
}
