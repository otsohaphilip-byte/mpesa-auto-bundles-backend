package com.mpesaautobundles.app

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.InputType
import android.text.method.PasswordTransformationMethod
import android.text.method.HideReturnsTransformationMethod
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class LoginActivity : AppCompatActivity() {

    private lateinit var identifierInput: EditText
    private lateinit var passwordInput: EditText
    private lateinit var loginButton: Button
    private lateinit var progressBar: ProgressBar
    private lateinit var identifierLabel: TextView
    private lateinit var resellerButton: Button
    private lateinit var adminButton: Button

    private var selectedRole = "admin"
    private var passwordVisible = false

    private val brightGreen = Color.rgb(0, 190, 90)
    private val darkGreen = Color.rgb(0, 65, 35)
    private val cardGreen = Color.rgb(0, 90, 48)
    private val white = Color.WHITE
    private val grey = Color.rgb(205, 220, 210)

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

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(24, 25, 24, 25)
            setBackgroundColor(darkGreen)
        }

        val scroll = ScrollView(this).apply {
            isFillViewport = true
        }

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(12, 25, 12, 25)
        }

        val logo = TextView(this).apply {
            text = "⚡"
            textSize = 76f
            gravity = Gravity.CENTER
            setTextColor(Color.rgb(255, 193, 7))
        }

        val title = TextView(this).apply {
            text = "M-PESA AUTO BUNDLES"
            textSize = 23f
            gravity = Gravity.CENTER
            setTypeface(null, Typeface.BOLD)
            setTextColor(white)
        }

        val subtitle = TextView(this).apply {
            text = "FAST. SIMPLE. RELIABLE."
            textSize = 14f
            gravity = Gravity.CENTER
            setTextColor(grey)
        }

        val roleTitle = makeLabel("SELECT ACCOUNT TYPE")

        val roleRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }

        adminButton = Button(this).apply {
            text = "ADMIN"
            textSize = 16f
            setTextColor(white)
            setOnClickListener { selectRole("admin") }
        }

        resellerButton = Button(this).apply {
            text = "RESELLER"
            textSize = 16f
            setTextColor(white)
            setOnClickListener { selectRole("reseller") }
        }

        roleRow.addView(adminButton, equalParams())
        roleRow.addView(resellerButton, equalParams())

        identifierLabel = makeLabel("ADMIN PHONE NUMBER")

        identifierInput = EditText(this).apply {
            textSize = 18f
            setTextColor(white)
            setHintTextColor(grey)
            hint = "Enter admin phone number"
            inputType = InputType.TYPE_CLASS_PHONE
            setSingleLine(true)
            setPadding(18, 16, 18, 16)
            background = roundedBackground(cardGreen, 12)
        }

        val passwordLabel = makeLabel("PASSWORD")

        val passwordRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = roundedBackground(cardGreen, 12)
        }

        passwordInput = EditText(this).apply {
            textSize = 18f
            setTextColor(white)
            setHintTextColor(grey)
            hint = "Enter your password"
            inputType = InputType.TYPE_CLASS_TEXT or
                InputType.TYPE_TEXT_VARIATION_PASSWORD
            transformationMethod = PasswordTransformationMethod.getInstance()
            setSingleLine(true)
            setPadding(18, 16, 8, 16)
            background = null
        }

        val showPassword = Button(this).apply {
            text = "SHOW"
            textSize = 13f
            setTextColor(brightGreen)
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener { togglePassword(this) }
        }

        passwordRow.addView(passwordInput, LinearLayout.LayoutParams(
            0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f
        ))
        passwordRow.addView(showPassword)

        loginButton = Button(this).apply {
            text = "LOGIN"
            textSize = 19f
            setTypeface(null, Typeface.BOLD)
            setTextColor(white)
            setBackgroundColor(brightGreen)
            minHeight = 58
            setOnClickListener { performLogin() }
        }

        progressBar = ProgressBar(this).apply {
            visibility = View.GONE
        }

        content.addView(logo)
        content.addView(title)
        content.addView(subtitle)
        content.addView(roleTitle)
        content.addView(roleRow)
        content.addView(identifierLabel)
        content.addView(identifierInput, fieldParams())
        content.addView(passwordLabel)
        content.addView(passwordRow, fieldParams())
        content.addView(loginButton, fieldParams())
        content.addView(progressBar, fieldParams())

        scroll.addView(content)
        root.addView(scroll, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.MATCH_PARENT
        ))

        setContentView(root)
        selectRole("admin")
    }
        private fun selectRole(role: String) {
        selectedRole = role

        if (role == "admin") {
            identifierLabel.text = "ADMIN PHONE NUMBER"
            identifierInput.hint = "Enter admin phone number"
            identifierInput.inputType = InputType.TYPE_CLASS_PHONE
            adminButton.setBackgroundColor(brightGreen)
            resellerButton.setBackgroundColor(cardGreen)
        } else {
            identifierLabel.text = "RESELLER EMAIL ADDRESS"
            identifierInput.hint = "Enter reseller email"
            identifierInput.inputType =
                InputType.TYPE_CLASS_TEXT or
                InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
            resellerButton.setBackgroundColor(brightGreen)
            adminButton.setBackgroundColor(cardGreen)
        }

        identifierInput.text.clear()
    }

    private fun togglePassword(button: Button) {
        passwordVisible = !passwordVisible

        passwordInput.transformationMethod =
            if (passwordVisible) {
                HideReturnsTransformationMethod.getInstance()
            } else {
                PasswordTransformationMethod.getInstance()
            }

        button.text = if (passwordVisible) "HIDE" else "SHOW"
        passwordInput.setSelection(passwordInput.text.length)
    }

    private fun performLogin() {
        val identifier = identifierInput.text.toString().trim()
        val password = passwordInput.text.toString()

        if (identifier.isEmpty() || password.isEmpty()) {
            Toast.makeText(
                this,
                "Enter your login details.",
                Toast.LENGTH_LONG
            ).show()
            return
        }

        loginButton.isEnabled = false
        progressBar.visibility = View.VISIBLE

        Thread {
            val path = if (selectedRole == "admin") {
                "/api/admin/login"
            } else {
                "/api/resellers/login"
            }

            val result = sendLogin(path, identifier, password)

            runOnUiThread {
                progressBar.visibility = View.GONE
                loginButton.isEnabled = true

                if (!result.token.isNullOrBlank()) {
                    if (selectedRole == "admin") {
                        saveSession("admin_session", result.token)
                        clearSession("reseller_session")

                        startActivity(
                            Intent(this, AdminDashboardActivity::class.java)
                        )
                    } else {
                        saveSession("reseller_session", result.token)
                        clearSession("admin_session")

                        startActivity(
                            Intent(this, ResellerDashboardActivity::class.java)
                        )
                    }

                    finish()
                } else {
                    Toast.makeText(
                        this,
                        result.error ?: "Login unsuccessful.",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }.start()
    }

    private fun sendLogin(
        path: String,
        identifier: String,
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
                if (selectedRole == "admin") {
                    put("phone", identifier)
                } else {
                    put("email", identifier)
                }
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

            val body = stream?.bufferedReader()?.use {
                it.readText()
            } ?: ""

            val response = if (body.isNotBlank()) {
                JSONObject(body)
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
                        "Login failed. Server response: HTTP $code"
                    )
                )
            }
        } catch (e: Exception) {
            LoginAttempt(
                error = "Connection error: ${e.message ?: "Please try again."}"
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

    private fun makeLabel(value: String): TextView {
        return TextView(this).apply {
            text = value
            textSize = 15f
            setTypeface(null, Typeface.BOLD)
            setTextColor(brightGreen)
            setPadding(2, 22, 2, 8)
        }
    }

    private fun fieldParams(): LinearLayout.LayoutParams {
        return LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            setMargins(0, 8, 0, 12)
        }
    }

    private fun equalParams(): LinearLayout.LayoutParams {
        return LinearLayout.LayoutParams(
            0,
            58,
            1f
        ).apply {
            setMargins(5, 8, 5, 8)
        }
    }

    private fun roundedBackground(
        color: Int,
        radius: Int
    ): GradientDrawable {
        return GradientDrawable().apply {
            setColor(color)
            cornerRadius = radius * resources.displayMetrics.density
        }
    }
}
