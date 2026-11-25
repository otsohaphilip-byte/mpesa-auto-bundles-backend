
package com.mpesaautobundles.app

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.util.UUID


class LocalDeliveryDatabase(context: Context) :
    SQLiteOpenHelper(context, "mab_local_deliveries.db", null, 2) {

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
    }
    
