
package com.mpesaautobundles.app

import android.app.Activity
import android.os.Bundle
import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.widget.*
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class DashboardSectionActivity : Activity() {

    private val baseUrl =
        "https://mpesa-auto-bundles-backend.onrender.com"

    private lateinit var offersList: LinearLayout
    private lateinit var statusText: TextView
    private lateinit var loading: ProgressBar

    private val green = Color.rgb(0, 140, 69)
    private val dark = Color.rgb(30, 40, 50)
    private val grey = Color.rgb(100, 110, 120)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20, 20, 20, 20)
            setBackgroundColor(Color.rgb(248, 250, 252))
        }

        val heading = TextView(this).apply {
            text = "My Offers"
            textSize = 25f
            setTextColor(dark)
            setPadding(0, 8, 0, 16)
        }

        statusText = TextView(this).apply {
            text = "Loading offers..."
            textSize = 14f
            setTextColor(grey)
            setPadding(0, 8, 0, 12)
        }

        loading = ProgressBar(this)

        offersList = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        val back = Button(this).apply {
            text = "Back to Dashboard"
            setOnClickListener { finish() }
        }

        page.addView(heading)
        page.addView(statusText)
        page.addView(loading)

        val scrollContent = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(offersList)
        }

        val scroll = ScrollView(this).apply {
            addView(scrollContent)
        }

        page.addView(
            scroll,
            LinearLayout.LayoutParams( -1, 0, 1f)
        )
        page.addView(back)

        setContentView(page)
        loadOffers()
    }

    private fun getToken(): String {
        return getSharedPreferences(
            "reseller_session",
            MODE_PRIVATE
        ).getString("token", "") ?: ""
    }

    private fun loadOffers() {
        loading.visibility = View.VISIBLE
        statusText.text = "Loading offers..."

        Thread {
            try {
                val connection = URL(
                    "$baseUrl/api/offers"
                ).openConnection() as HttpURLConnection

                connection.requestMethod = "GET"
                connection.connectTimeout = 30000
                connection.readTimeout = 30000
                connection.setRequestProperty(
                    "Authorization",
                    "Bearer ${getToken()}"
                )
                connection.setRequestProperty(
                    "Accept",
                    "application/json"
                )

                val code = connection.responseCode
                val stream = if (code in 200..299) {
                    connection.inputStream
                } else {
                    connection.errorStream
                }

                val body = stream.bufferedReader().use {
                    it.readText()
                }

                connection.disconnect()

                if (code !in 200..299) {
                    throw Exception(
                        JSONObject(body).optString(
                            "message",
                            "Server error: $code"
                        )
                    )
                }

                val response = JSONObject(body)
                val offers = response.optJSONArray("offers")
                    ?: JSONArray()

                runOnUiThread {
                    showOffers(offers)
                }

            } catch (e: Exception) {
                runOnUiThread {
                    loading.visibility = View.GONE
                    statusText.text =
                        "Could not load offers: ${e.message}"
                }
            }
        }.start()
    }

    private fun showOffers(offers: JSONArray) {
        loading.visibility = View.GONE
        offersList.removeAllViews()

        if (offers.length() == 0) {
            statusText.text = "No offers are available yet."
            return
        }

        statusText.text =
            "${offers.length()} offers available"

        for (i in 0 until offers.length()) {
            val offer = offers.getJSONObject(i)
            addOfferCard(offer)
        }
    }

    private fun addOfferCard(offer: JSONObject) {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(16, 16, 16, 16)
            setBackgroundColor(Color.WHITE)
        }

        val name = offer.optString(
            "name",
            "Data bundle"
        )

        val price = offer.optString("price", "0")
        val validity = offer.optString("validity", "")
        val category = offer.optString(
            "catalog_category",
            offer.optString("category", "")
        )

        val isPlatformOffer =
            offer.isNull("reseller_id")

        val active = offer.optBoolean("active", false)

        card.addView(makeText(name, 18f, dark, true))

        card.addView(
            makeText(
                "Selling price: KSh $price",
                15f,
                green,
                true
            )
        )

        if (validity.isNotBlank()) {
            card.addView(
                makeText("Validity: $validity", 13f, grey)
            )
        }

        if (category.isNotBlank()) {
            card.addView(
                makeText("Category: $category", 13f, grey)
            )
        }

        if (isPlatformOffer) {
            card.addView(
                makeText(
                    "Platform offer",
                    13f,
                    grey
                )
            )

            val addButton = Button(this).apply {
                text = "Add to My Offers"
                setOnClickListener {
                    customizeOffer(
                        offer.optLong("id"),
                        this
                    )
                }
            }

            card.addView(addButton)
        } else {
            card.addView(
                makeText(
                    if (active) "Status: ACTIVE"
                    else "Status: INACTIVE",
                    14f,
                    if (active) green else grey,
                    true
                )
            )

            card.addView(
                makeText(
                    "Your private offer",
                    13f,
                    grey
                )
            )
        }

        val params = LinearLayout.LayoutParams(
            -1,
            -2
        ).apply {
            setMargins(0, 0, 0, 14)
        }

        offersList.addView(card, params)
    }

    private fun customizeOffer(
        offerId: Long,
        button: Button
    ) {
        if (offerId < 1) return

        button.isEnabled = false
        button.text = "Adding..."

        Thread {
            try {
                val connection = URL(
                    "$baseUrl/api/reseller/offers/$offerId/customize"
                ).openConnection() as HttpURLConnection

                connection.requestMethod = "POST"
                connection.connectTimeout = 30000
                connection.readTimeout = 30000
                connection.doOutput = true

                connection.setRequestProperty(
                    "Authorization",
                    "Bearer ${getToken()}"
                )
                connection.setRequestProperty(
                    "Content-Type",
                    "application/json"
                )

                connection.outputStream.use {
                    it.write(
                        "{}".toByteArray(Charsets.UTF_8)
                    )
                }

                val code = connection.responseCode
                val stream = if (code in 200..299) {
                    connection.inputStream
                } else {
                    connection.errorStream
                }

                val body = stream.bufferedReader().use {
                    it.readText()
                }

                connection.disconnect()

                val response = JSONObject(body)

                if (code !in 200..299) {
                    throw Exception(
                        response.optString(
                            "message",
                            "Unable to add offer."
                        )
                    )
                }

                runOnUiThread {
                    Toast.makeText(
                        this,
                        "Offer added to your account.",
                        Toast.LENGTH_LONG
                    ).show()
                    loadOffers()
                }

            } catch (e: Exception) {
                runOnUiThread {
                    button.isEnabled = true
                    button.text = "Add to My Offers"

                    Toast.makeText(
                        this,
                        e.message ?: "Unable to add offer.",
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
            setPadding(0, 5, 0, 5)
        }
    }
}
