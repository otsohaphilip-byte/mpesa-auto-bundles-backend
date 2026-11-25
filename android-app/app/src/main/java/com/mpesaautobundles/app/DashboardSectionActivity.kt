package com.mpesaautobundles.app

import android.app.Activity
import android.app.AlertDialog
import android.os.Bundle
import android.graphics.Color
import android.view.View
import android.widget.*
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class DashboardSectionActivity : Activity() {

    private val baseUrl =
        "https://mpesa-auto-bundles-backend.onrender.com"

    private val green = Color.rgb(0, 150, 75)
    private val darkGreen = Color.rgb(0, 75, 40)
    private val dark = Color.rgb(30, 45, 38)
    private val grey = Color.rgb(100, 115, 105)
    private val light = Color.rgb(242, 248, 244)

    private var role = "reseller"
    private var section = "My Offers"

    private lateinit var content: LinearLayout
    private lateinit var heading: TextView
    private lateinit var statusText: TextView
    private lateinit var loading: ProgressBar

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        role = intent.getStringExtra("role") ?: "reseller"
        section = intent.getStringExtra("section") ?: "My Offers"

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(18, 18, 18, 18)
            setBackgroundColor(Color.WHITE)
        }

        heading = makeText(section, 25f, dark, true)
        statusText = makeText("Loading...", 15f, grey)
        loading = ProgressBar(this)

        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        root.addView(heading)
        root.addView(makeText(
            if (role == "admin") "ADMIN ACCOUNT" else "RESELLER ACCOUNT",
            12f, green, true
        ))
        root.addView(statusText)
        root.addView(loading)

        val scroll = ScrollView(this)
        scroll.addView(content)
        root.addView(
            scroll,
            LinearLayout.LayoutParams(-1, 0, 1f)
        )

        val back = Button(this).apply {
            text = "Back to Dashboard"
            textSize = 16f
            setOnClickListener { finish() }
        }
        root.addView(back)

        setContentView(root)
        loadSection()
    }

    private fun token(): String {
        val preference = if (role == "admin") {
            "admin_session"
        } else {
            "reseller_session"
        }

        return getSharedPreferences(preference, MODE_PRIVATE)
            .getString("token", "") ?: ""
    }

    private fun loadSection() {
        content.removeAllViews()
        loading.visibility = View.GONE

        when (section.lowercase()) {
            "my offers", "offers" -> loadOffers()
            "analytics" -> showUnavailable(
                "Analytics",
                "The current backend does not yet provide an analytics endpoint. No sales or commission figures will be invented."
            )
            "transactions" -> showUnavailable(
                "Transactions",
                "The current backend does not yet provide a transactions endpoint. Transaction records will appear here when that connection is added."
            )
            "account" -> loadAccount()
            "settings" -> loadSettings()
            "notifications" -> loadNotifications()
            else -> showUnavailable(
                section,
                "This section is not connected yet."
            )
        }
    }

    private fun showUnavailable(title: String, message: String) {
        heading.text = title
        statusText.text = "Information"
        content.addView(makeCard().apply {
            addView(makeText(message, 17f, dark))
        })
    }

    private fun makeCard(): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(18, 18, 18, 18)
            setBackgroundColor(light)
            val params = LinearLayout.LayoutParams(-1, -2)
            params.setMargins(0, 10, 0, 14)
            layoutParams = params
        }
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
            setPadding(0, 7, 0, 7)
        }
    }

    private fun showMessage(message: String) {
        runOnUiThread {
            loading.visibility = View.GONE
            statusText.text = message
        }
    }

    private fun request(
        path: String,
        method: String = "GET",
        body: JSONObject? = null
    ): JSONObject {
        val connection = URL(baseUrl + path)
            .openConnection() as HttpURLConnection

        try {
            connection.requestMethod = method
            connection.connectTimeout = 30000
            connection.readTimeout = 30000
            connection.setRequestProperty(
                "Authorization", "Bearer ${token()}"
            )
            connection.setRequestProperty(
                "Accept", "application/json"
            )

            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty(
                    "Content-Type", "application/json"
                )
                connection.outputStream.use {
                    it.write(body.toString().toByteArray(Charsets.UTF_8))
                }
            }

            val code = connection.responseCode
            val stream = if (code in 200..299) {
                connection.inputStream
            } else {
                connection.errorStream
            }

            val responseText = stream?.bufferedReader()?.use {
                it.readText()
            } ?: ""

            val response = if (responseText.isBlank()) {
                JSONObject()
            } else {
                JSONObject(responseText)
            }

            if (code == 401 || code == 403) {
                throw SecurityException(
                    "Your session has expired. Please log in again."
                )
            }

            if (code !in 200..299) {
                throw Exception(
                    response.optString(
                        "message",
                        "Server error: HTTP $code"
                    )
                )
            }

            return response
        } finally {
            connection.disconnect()
        }
    }

    private fun runRequest(
        task: () -> Unit
    ) {
        loading.visibility = View.VISIBLE
        statusText.text = "Loading..."

        Thread {
            try {
                task()
            } catch (e: SecurityException) {
                runOnUiThread {
                    Toast.makeText(
                        this,
                        e.message,
                        Toast.LENGTH_LONG
                    ).show()

                    val preference = if (role == "admin") {
                        "admin_session"
                    } else {
                        "reseller_session"
                    }

                    getSharedPreferences(preference, MODE_PRIVATE)
                        .edit().clear().apply()

                    finish()
                }
            } catch (e: Exception) {
                showMessage(
                    e.message ?: "Unable to load this section."
                )
            }
        }.start()
    }

    private fun loadOffers() {
        heading.text = "My Offers"

        runRequest {
            val response = request("/api/offers")
            val offers = response.optJSONArray("offers")
                ?: JSONArray()

            runOnUiThread {
                loading.visibility = View.GONE
                statusText.text =
                    "${offers.length()} offers found"
                content.removeAllViews()
                                if (role == "reseller") {
                    val addOfferButton = Button(this).apply {
                        text = "+ Add Your Own Offer"
                        textSize = 17f
                        setOnClickListener {
                            showAddOfferDialog()
                        }
                    }
                    content.addView(addOfferButton)
                                }

                if (offers.length() == 0) {
                    content.addView(makeText(
                        "No offers are available yet.",
                        17f, grey
                    ))
                }

                for (i in 0 until offers.length()) {
                    addOfferCard(offers.getJSONObject(i))
                }
            }
        }
    }
    
    private fun showAddOfferDialog() {
        runRequest {
            val response = request("/api/catalog")
            val catalog = response.optJSONArray("products")
                ?: JSONArray()

            runOnUiThread {
                if (catalog.length() == 0) {
                    Toast.makeText(
                        this,
                        "No active catalogue products are available.",
                        Toast.LENGTH_LONG
                    ).show()
                    return@runOnUiThread
                }

                val products = ArrayList<JSONObject>()
                val labels = ArrayList<String>()

                for (i in 0 until catalog.length()) {
                    val product = catalog.getJSONObject(i)
                    products.add(product)

                    labels.add(
                        "${product.optString("product_name")} - " +
                            "Safaricom KSh ${product.optString("safaricom_price")} - " +
                            "Bingwa KSh ${product.optString("bingwa_price")}"
                    )
                }

                AlertDialog.Builder(this)
                    .setTitle("Choose a Bundle")
                    .setItems(labels.toTypedArray()) { _, which ->
                        showNewOfferPriceDialog(products[which])
                    }
                    .setNegativeButton("Cancel", null)
                    .show()
            }
        }
    }

    private fun showNewOfferPriceDialog(product: JSONObject) {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 12, 24, 8)
        }

        val safaricomPrice = product.optString("safaricom_price", "0")
        val bingwaPrice = EditText(this).apply {
            hint = "Your advertised Bingwa price (KSh)"
            inputType = 8194
            setText(product.optString("bingwa_price", ""))
        }

        layout.addView(
            makeText(
                "Fixed Safaricom price: KSh $safaricomPrice",
                16f,
                grey
            )
        )
        layout.addView(bingwaPrice)

        val dialog = AlertDialog.Builder(this)
            .setTitle(product.optString("product_name"))
            .setMessage(
                "Set your Bingwa price. This is the exact amount " +
                    "the payer must send to your Till."
            )
            .setView(layout)
            .setPositiveButton("Create Offer", null)
            .setNegativeButton("Cancel", null)
            .create()

        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE)
                .setOnClickListener {
                    val bingwa = bingwaPrice.text.toString()
                        .trim().toDoubleOrNull()

                    if (bingwa == null || bingwa <= 0) {
                        Toast.makeText(
                            this,
                            "Enter a valid Bingwa price greater than zero.",
                            Toast.LENGTH_LONG
                        ).show()
                        return@setOnClickListener
                    }

                    val body = JSONObject()
                        .put("catalog_product_id", product.optLong("id"))
                        .put("name", product.optString("product_name"))
                        .put("price", bingwa)
                        .put("bingwa_price", bingwa)

                    dialog.dismiss()

                    runRequest {
                        val result = request(
                            "/api/offers",
                            "POST",
                            body
                        )

                        runOnUiThread {
                            Toast.makeText(
                                this,
                                result.optString(
                                    "message",
                                    "Offer created successfully."
                                ),
                                Toast.LENGTH_LONG
                            ).show()
                            loadOffers()
                        }
                    }
                }
        }

        dialog.show()
    }
    
    private fun addOfferCard(offer: JSONObject) {
        val card = makeCard()
        val id = offer.optLong("id")
        val name = offer.optString("name", "Data bundle")
        val price = offer.optString("price", "0")
        val validity = offer.optString("validity", "")
        val category = offer.optString(
            "catalog_category",
            offer.optString("category", "")
        )
        val platformOffer = offer.isNull("reseller_id")
        val active = offer.optBoolean("active", false)

        card.addView(makeText(name, 19f, dark, true))
        card.addView(makeText(
            "Selling price: KSh $price",
            17f, green, true
        ))

        if (validity.isNotBlank()) {
            card.addView(makeText("Validity: $validity", 14f, grey))
        }

        if (category.isNotBlank()) {
            card.addView(makeText("Category: $category", 14f, grey))
        }

        if (platformOffer) {
            card.addView(makeText(
                "Platform offer",
                14f, grey
            ))

            if (role == "reseller") {
                val add = Button(this).apply {
                    text = "Add to My Offers"
                    setOnClickListener {
                        customizeOffer(id, this)
                    }
                }
                card.addView(add)
            }
        } else {
            card.addView(makeText(
                if (active) "Status: ACTIVE" else "Status: INACTIVE",
                15f,
                if (active) green else grey,
                true
            ))

            if (role == "reseller") {
                val edit = Button(this).apply {
                    text = "Edit Selling Price"
                    setOnClickListener {
                        editOfferPrice(id, price)
                    }
                }
                card.addView(edit)

                val toggle = Button(this).apply {
                    text = if (active) "Deactivate Offer"
                        else "Activate Offer"
                    setOnClickListener {
                        changeOfferStatus(id, !active, this)
                    }
                }
                card.addView(toggle)
            } else {
                card.addView(makeText(
                    "Reseller-owned offer",
                    14f, grey
                ))
            }
        }

        content.addView(card)
    }
        private fun customizeOffer(id: Long, button: Button) {
        if (id < 1) return

        button.isEnabled = false
        button.text = "Adding..."

        runRequest {
            request(
                "/api/reseller/offers/$id/customize",
                "POST",
                JSONObject()
            )

            runOnUiThread {
                Toast.makeText(
                    this,
                    "Offer added to your account.",
                    Toast.LENGTH_LONG
                ).show()
                loadOffers()
            }
        }
    }

    private fun editOfferPrice(id: Long, currentPrice: String) {
        val input = EditText(this).apply {
            hint = "Enter new selling price"
            inputType =
                android.text.InputType.TYPE_CLASS_NUMBER or
                android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
            setText(currentPrice)
            textSize = 18f
        }

        AlertDialog.Builder(this)
            .setTitle("Change selling price")
            .setMessage("This changes only your own offer.")
            .setView(input)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Save") { _, _ ->
                val value = input.text.toString().trim()
                val price = value.toDoubleOrNull()

                if (price == null || price <= 0) {
                    Toast.makeText(
                        this,
                        "Enter a valid price.",
                        Toast.LENGTH_LONG
                    ).show()
                    return@setPositiveButton
                }

                runRequest {
                    val body = JSONObject().put("price", price)
                    request(
                        "/api/reseller/offers/$id",
                        "PATCH",
                        body
                    )

                    runOnUiThread {
                        Toast.makeText(
                            this,
                            "Selling price updated.",
                            Toast.LENGTH_SHORT
                        ).show()
                        loadOffers()
                    }
                }
            }
            .show()
    }

    private fun changeOfferStatus(
        id: Long,
        active: Boolean,
        button: Button
    ) {
        button.isEnabled = false

        runRequest {
            val body = JSONObject().put("active", active)
            request(
                "/api/reseller/offers/$id/active",
                "PATCH",
                body
            )

            runOnUiThread {
                Toast.makeText(
                    this,
                    if (active) "Offer activated."
                    else "Offer deactivated.",
                    Toast.LENGTH_SHORT
                ).show()
                loadOffers()
            }
        }
    }

    private fun loadAccount() {
        heading.text = "Account"

        if (role == "admin") {
            loadAdminAccount()
        } else {
            loadResellerAccount()
        }
    }

    private fun loadResellerAccount() {
        runRequest {
            val response = request("/api/reseller/me")
            val user = response.optJSONObject("user")
                ?: response.optJSONObject("reseller")
                ?: response

            runOnUiThread {
                loading.visibility = View.GONE
                statusText.text = "Reseller profile"
                content.removeAllViews()

                                                addProfileField("Full name", user, "name")
                addProfileField("Email", user, "email")
                addProfileField("Main phone", user, "phone")
                addProfileField(
                    "Safaricom Buy Goods Till",
                    user, "buy_goods_till"
                )
                addProfileField(
                    "Till phone number",
                    user, "till_phone"
                )
            }
        }
    }

    private fun loadAdminAccount() {
        runRequest {
            val response = request("/api/admin/settings/till")
            val settings = response.optJSONObject("settings")
                ?: response.optJSONObject("till")
                ?: response

            runOnUiThread {
                loading.visibility = View.GONE
                statusText.text = "Admin platform payment details"
                content.removeAllViews()

                                addProfileField(
                    "Platform Buy Goods Till",
                    settings,
                    "admin_buy_goods_till"
                )
                addProfileField(
                    "Phone associated with Till",
                    settings,
                    "admin_till_phone"
                )

                content.addView(makeText(
                    "These are the platform payment details.",
                    14f, grey
                ))
            }
        }
    }

    private fun addProfileField(
        label: String,
        data: JSONObject,
        key: String
    ) {
        val value = data.optString(key, "")
        val card = makeCard()
        card.addView(makeText(label, 14f, grey, true))
        card.addView(makeText(
            if (value.isBlank() || value == "null")
                "Not provided"
            else value,
            18f, dark
        ))
        content.addView(card)
    }

        private fun loadSettings() {
        heading.text = "Settings"

                runRequest {
            val isAdmin = role == "admin"

            val path = if (isAdmin) {
                "/api/system/sales-status"
            } else {
                "/api/reseller/sales-status"
            }

            val response = request(path)

            val paused = if (isAdmin) {
                response.optBoolean("salesPaused", false)
            } else {
                response.optBoolean("sales_paused", false)
            }

            runOnUiThread {
                loading.visibility = View.GONE
                statusText.text = "Sales controls"
                content.removeAllViews()

                val card = makeCard()

                card.addView(makeText(
                    "Sales status",
                    19f, dark, true
                ))

                card.addView(makeText(
                    if (paused) "Currently INACTIVE"
                    else "Currently ACTIVE",
                    17f,
                    if (paused) Color.RED else green,
                    true
                ))

                card.addView(makeText(
                    "This changes the sales status setting. It does not yet guarantee that payment processing is blocked.",
                    14f, grey
                ))

                val button = Button(this).apply {
                    text = if (paused) {
                        "Set Sales ACTIVE"
                    } else {
                        "Set Sales INACTIVE"
                    }

                    setOnClickListener {
                        updateSalesStatus(!paused, this)
                    }
                }

                card.addView(button)
                content.addView(card)

                if (role == "admin") {
                    addTillSettings()
                }
            }
        }
        }

    private fun updateSalesStatus(
        paused: Boolean,
        button: Button
    ) {
        button.isEnabled = false

        runRequest {
            val path = if (role == "admin") {
                "/api/admin/system/sales-status"
            } else {
                "/api/reseller/sales-status"
            }

            request(
                path,
                "PATCH",
                JSONObject().put("paused", paused)
            )

            runOnUiThread {
                Toast.makeText(
                    this,
                    "Sales status setting updated.",
                    Toast.LENGTH_LONG
                ).show()
                loadSettings()
            }
        }
    }

    private fun addTillSettings() {
        val card = makeCard()
        card.addView(makeText(
            "Platform Buy Goods Till settings",
            19f, dark, true
        ))

        val tillInput = EditText(this).apply {
            hint = "Buy Goods Till number"
            textSize = 17f
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
        }

        val phoneInput = EditText(this).apply {
            hint = "Phone associated with Till"
            textSize = 17f
            inputType = android.text.InputType.TYPE_CLASS_PHONE
        }

        card.addView(tillInput)
        card.addView(phoneInput)

        val loadButton = Button(this).apply {
            text = "Load Current Till Details"
            setOnClickListener {
                loadTillIntoFields(tillInput, phoneInput)
            }
        }

        val saveButton = Button(this).apply {
            text = "Save Till Settings"
            setOnClickListener {
                val till = tillInput.text.toString().trim()
                val phone = phoneInput.text.toString().trim()

                if (till.isBlank() || phone.isBlank()) {
                    Toast.makeText(
                        this@DashboardSectionActivity,
                        "Enter both Till details.",
                        Toast.LENGTH_LONG
                    ).show()
                    return@setOnClickListener
                }

                runRequest {
                    val body = JSONObject()
                        .put("buyGoodsTill", till)
                        .put("tillPhone", phone)

                    request(
                        "/api/admin/settings/till",
                        "PATCH",
                        body
                    )

                    runOnUiThread {
                        Toast.makeText(
                            this@DashboardSectionActivity,
                            "Till settings saved.",
                            Toast.LENGTH_LONG
                        ).show()
                    }
                }
            }
        }

        card.addView(loadButton)
        card.addView(saveButton)
        content.addView(card)

        loadTillIntoFields(tillInput, phoneInput)
    }

        private fun loadTillIntoFields(
        tillInput: EditText,
        phoneInput: EditText
    ) {
        runRequest {
            val response = request("/api/admin/settings/till")
            val settings = response.optJSONObject("settings")
                ?: response.optJSONObject("till")
                ?: response

            val till = settings.optString("admin_buy_goods_till", "")
            val phone = settings.optString("admin_till_phone", "")

            runOnUiThread {
                if (till.isNotBlank() && till != "null") {
                    tillInput.setText(till)
                }
                if (phone.isNotBlank() && phone != "null") {
                    phoneInput.setText(phone)
                }
            }
        }
        }
    private fun loadNotifications() {
        heading.text = "Notifications"

        if (role == "admin") {
            showUnavailable(
                "Notifications",
                "The current notifications endpoint is for reseller accounts. Admin notifications are not connected yet."
            )
            return
        }

        runRequest {
            val response = request("/api/resellers/notifications")
            val notifications =
                response.optJSONArray("notifications") ?: JSONArray()

            runOnUiThread {
                loading.visibility = View.GONE
                statusText.text =
                    "${notifications.length()} notifications"
                content.removeAllViews()

                if (notifications.length() == 0) {
                    content.addView(makeText(
                        "You have no notifications.",
                        17f, grey
                    ))
                }

                for (i in 0 until notifications.length()) {
                    addNotificationCard(
                        notifications.getJSONObject(i)
                    )
                }
            }
        }
    }

    private fun addNotificationCard(item: JSONObject) {
        val card = makeCard()
        val id = item.optLong("id")
        val title = item.optString(
            "title",
            "Notification"
        )
        val message = item.optString(
            "message",
            item.optString("body", "")
        )
        val read = !item.isNull("read_at")
        card.addView(makeText(title, 18f, dark, true))
        card.addView(makeText(message, 15f, grey))
        card.addView(makeText(
            if (read) "Read" else "Unread",
            13f,
            if (read) grey else green,
            true
        ))

        if (!read && id > 0) {
            val button = Button(this).apply {
                text = "Mark as Read"
                setOnClickListener {
                    markNotificationRead(id, this)
                }
            }
            card.addView(button)
        }

        content.addView(card)
    }

    private fun markNotificationRead(
        id: Long,
        button: Button
    ) {
        button.isEnabled = false

        runRequest {
            request(
                "/api/resellers/notifications/$id/read",
                "PATCH",
                JSONObject()
            )

            runOnUiThread {
                Toast.makeText(
                    this,
                    "Notification marked as read.",
                    Toast.LENGTH_SHORT
                ).show()
                loadNotifications()
            }
        }
    }
}
