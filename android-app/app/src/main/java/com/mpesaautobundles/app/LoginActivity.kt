
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
    private val baseUrl =
        "https://mpesa-auto-bundles-backend.onrender.com"

    data class LoginAttempt(
        val token: String? = null,
        val error: String? = null
    )

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
            setOnClickListener { performLogin() }
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
            val admin = sendLogin("/api/admin/login", phone, password)
            var reseller = LoginAttempt()

            if (admin.token.isNullOrBlank()) {
                reseller = sendLogin(
                    "/api/resellers/login",
                    phone,
                    password
                )
            }

            runOnUiThread {
                progressBar.visibility = View.GONE
                loginButton.isEnabled = true

                when {
                    !admin.token.isNullOrBlank() -> {
                        saveSession("admin_session", admin.token)
                        clearSession("reseller_session")

                        startActivity(
                            Intent(this, AdminDashboardActivity::class.java)
                        )
                        finish()
                    }

                    !reseller.token.isNullOrBlank() -> {
                        saveSession("reseller_session", reseller.token)
                        clearSession("admin_session")

                        startActivity(
                            Intent(this, ResellerDashboardActivity::class.java)
                        )
                        finish()
                    }

                    else -> {
                        val message = listOfNotNull(
                            admin.error,
                            reseller.error
                        ).joinToString("\n")

                        Toast.makeText(
                            this,
                            message.ifBlank {
                                "Login unsuccessful. Check your details."
                            },
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
    ): LoginAttempt {
        var connection: HttpURLConnection? = null

        return try {
            connection = URL(baseUrl + path)
                .openConnection() as HttpURLConnection

            connection.requestMethod = "POST"
            connection.connectTimeout = 30000
            connection.readTimeout = 30000
            connection.doOutput = true
            connection.setRequestProperty(
                "Content-Type",
                "application/json"
            )
            connection.setRequestProperty(
                "Accept",
                "application/json"
            )

            val request = JSONObject().apply {
                put("phone", phone)
                put("password", password)
            }

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

            val response = if (responseText.isNotBlank()) {
                JSONObject(responseText)
            } else {
                JSONObject()
            }

            if (
                code in 200..299 &&
                response.optString("status") == "OK" &&
                response.optString("token").isNotBlank()
            ) {
                LoginAttempt(token = response.optString("token"))
            } else {
                LoginAttempt(
                    error = response.optString(
                        "message",
                        "Server returned HTTP $code for $path"
                    )
                )
            }

        } catch (e: Exception) {
            LoginAttempt(
                error = "$path: ${e.javaClass.simpleName}: " +
                    (e.message ?: "Unknown connection error")
            )
        } finally {
            connection?.disconnect()
        }
    }

    private fun saveSession(name: String, token: String) {
        getSharedPreferences(name, MODE_PRIVATE)
            .edit()
            .putString("token", token)
            .apply()
    }

    private fun clearSession(name: String) {
        getSharedPreferences(name, MODE_PRIVATE)
            .edit()
            .clear()
            .apply()
    }
}
