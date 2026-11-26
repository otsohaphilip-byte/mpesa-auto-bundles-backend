
package com.mpesaautobundles.app

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.util.UUID


class LocalDeliveryDatabase(context: Context) :
    SQLiteOpenHelper(context, "mab_local_deliveries.db", null, 3)
{
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE deliveries (
                local_id TEXT PRIMARY KEY,
                role TEXT NOT NULL,
                owner_id TEXT NOT NULL,
                destination_phone TEXT NOT NULL,
                offer_id TEXT,
                offer_name TEXT NOT NULL,
                selling_price REAL NOT NULL,
                result_status TEXT NOT NULL,
                safaricom_response TEXT,
                created_at INTEGER NOT NULL,
                synced INTEGER NOT NULL DEFAULT 0
            )
            """.trimIndent()
        )

        createActiveDeliveryTable(db)
    }

    private fun createActiveDeliveryTable(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS active_delivery (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                                job_id TEXT,
                role TEXT NOT NULL,
                owner_id TEXT NOT NULL,
                destination_phone TEXT NOT NULL,
                offer_id TEXT,
                offer_name TEXT NOT NULL,
                selling_price REAL NOT NULL,
                ussd_code TEXT NOT NULL,
                started_at INTEGER NOT NULL
            )
            """.trimIndent()
        )
    }

        override fun onUpgrade(
        db: SQLiteDatabase,
        oldVersion: Int,
        newVersion: Int
    ) {
        if (oldVersion < 2) {
            createActiveDeliveryTable(db)
        }

        if (oldVersion >= 2 && oldVersion < 3) {
            db.execSQL(
                "ALTER TABLE active_delivery ADD COLUMN job_id TEXT"
            )
        }
        }
    

    fun saveDeliveryResult(
        role: String,
        ownerId: String,
        phone: String,
        offerId: String,
        offerName: String,
        sellingPrice: Double,
        status: String,
        safaricomResponse: String
    ): String {
        require(status in listOf("SUCCESS", "FAILED", "UNCERTAIN"))

        val localId = UUID.randomUUID().toString()

        val values = ContentValues().apply {
            put("local_id", localId)
            put("role", role)
            put("owner_id", ownerId)
            put("destination_phone", phone)
            put("offer_id", offerId)
            put("offer_name", offerName)
            put("selling_price", sellingPrice)
            put("result_status", status)
            put("safaricom_response", safaricomResponse)
            put("created_at", System.currentTimeMillis())
            put("synced", 0)
        }

        writableDatabase.insertOrThrow(
            "deliveries",
            null,
            values
        )

        return localId
    }
        fun saveDeliveryResultForJob(
        jobId: String,
        role: String,
        ownerId: String,
        phone: String,
        offerId: String,
        offerName: String,
        sellingPrice: Double,
        status: String,
        safaricomResponse: String
    ): String {
        require(status in listOf("SUCCESS", "FAILED", "UNCERTAIN"))

        val localId = "job-$jobId"

        val values = ContentValues().apply {
            put("local_id", localId)
            put("role", role)
            put("owner_id", ownerId)
            put("destination_phone", phone)
            put("offer_id", offerId)
            put("offer_name", offerName)
            put("selling_price", sellingPrice)
            put("result_status", status)
            put("safaricom_response", safaricomResponse)
            put("created_at", System.currentTimeMillis())
            put("synced", 0)
        }

        writableDatabase.insertWithOnConflict(
            "deliveries",
            null,
            values,
            SQLiteDatabase.CONFLICT_IGNORE
        )

        return localId
        }

    fun getPendingDeliveries(): List<android.content.ContentValues> {
        val records = mutableListOf<android.content.ContentValues>()

        readableDatabase.query(
            "deliveries",
            null,
            "synced = ?",
            arrayOf("0"),
            null,
            null,
            "created_at ASC"
        ).use { cursor ->
            while (cursor.moveToNext()) {
                val values = android.content.ContentValues()

                for (i in 0 until cursor.columnCount) {
                    when (cursor.getType(i)) {
                        1 -> values.put(cursor.getColumnName(i), cursor.getLong(i))
                        2 -> values.put(cursor.getColumnName(i), cursor.getDouble(i))
                        3 -> values.put(cursor.getColumnName(i), cursor.getString(i))
                        4 -> values.putNull(cursor.getColumnName(i))
                    }
                }

                records.add(values)
            }
        }

        return records
    }
    fun hasDeliveryResultForJob(jobId: String): Boolean {
    readableDatabase.rawQuery(
        "SELECT 1 FROM deliveries WHERE local_id = ? LIMIT 1",
        arrayOf("job-$jobId")
    ).use { cursor ->
        return cursor.moveToFirst()
    }
    }

    fun markAsSynced(localId: String) {
        val values = ContentValues().apply {
            put("synced", 1)
        }

        writableDatabase.update(
            "deliveries",
            values,
            "local_id = ?",
            arrayOf(localId)
        )
    }
        
    fun saveActiveDelivery(
        role: String,
        ownerId: String,
        phone: String,
        offerId: String,
        offerName: String,
        sellingPrice: Double,
                ussdCode: String,
        jobId: String
    ) {
        val values = ContentValues().apply {
            put("id", 1)
                        put("job_id", jobId)
            put("role", role)
            put("owner_id", ownerId)
            put("destination_phone", phone)
            put("offer_id", offerId)
            put("offer_name", offerName)
            put("selling_price", sellingPrice)
            put("ussd_code", ussdCode)
            put("started_at", System.currentTimeMillis())
        }

        writableDatabase.insertWithOnConflict(
            "active_delivery",
            null,
            values,
            SQLiteDatabase.CONFLICT_REPLACE
        )
    }

    fun getActiveDelivery(): ContentValues? {
        val cursor = readableDatabase.query(
            "active_delivery",
            null,
            "id = ?",
            arrayOf("1"),
            null,
            null,
            null
        )

        cursor.use {
            if (!it.moveToFirst()) return null

            return ContentValues().apply {
                put("role", it.getString(it.getColumnIndexOrThrow("role")))
                                put("job_id", it.getString(it.getColumnIndexOrThrow("job_id")))
                put("owner_id", it.getString(it.getColumnIndexOrThrow("owner_id")))
                put("destination_phone", it.getString(it.getColumnIndexOrThrow("destination_phone")))
                put("offer_id", it.getString(it.getColumnIndexOrThrow("offer_id")))
                put("offer_name", it.getString(it.getColumnIndexOrThrow("offer_name")))
                put("selling_price", it.getDouble(it.getColumnIndexOrThrow("selling_price")))
                put("ussd_code", it.getString(it.getColumnIndexOrThrow("ussd_code")))
                put("started_at", it.getLong(it.getColumnIndexOrThrow("started_at")))
            }
        }
    }

    fun clearActiveDelivery() {
        writableDatabase.delete(
            "active_delivery",
            "id = ?",
            arrayOf("1")
        )
    }
    
    }
    
