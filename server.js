const express = require("express");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();

app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, x-test-key");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

// PostgreSQL database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Homepage
app.get("/", (req, res) => {
  res.send("M-Pesa Auto Bundles backend is running.");
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    application: "M-Pesa Auto Bundles"
  });
});

// Daraja authentication
async function getDarajaAccessToken() {
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;

  if (!key || !secret) {
    throw new Error("Daraja credentials are missing.");
  }

  const credentials = Buffer.from(`${key}:${secret}`).toString("base64");

  const response = await fetch(
    "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: "application/json"
      }
    }
  );

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error("Daraja authentication failed.");
  }

  return data.access_token;
}

// Protected test routes
function checkTestSecret(req, res, next) {
  const testSecret = process.env.MPESA_TEST_SECRET;

  if (!testSecret || req.get("x-test-key") !== testSecret) {
    return res.status(401).json({
      status: "ERROR",
      message: "Not authorized."
    });
  }

  next();
}

// Test Daraja authentication
app.get("/api/mpesa/auth-check", checkTestSecret, async (req, res) => {
  try {
    await getDarajaAccessToken();

    res.json({
      status: "OK",
      message: "Daraja sandbox authentication successful."
    });
  } catch (error) {
    console.error("Daraja authentication failed:", error.message);

    res.status(502).json({
      status: "ERROR",
      message: "Daraja authentication failed."
    });
  }
});

// Test PostgreSQL connection
app.get("/api/db-check", checkTestSecret, async (req, res) => {
  if (!process.env.DATABASE_URL) {
    return res.status(503).json({
      status: "ERROR",
      message: "Database URL is missing."
    });
  }

  try {
    const result = await pool.query("SELECT NOW() AS database_time");

    res.json({
      status: "OK",
      message: "PostgreSQL database connection successful.",
      database_time: result.rows[0].database_time
    });
  } catch (error) {
    console.error("Database connection failed:", error.message);

    res.status(500).json({
      status: "ERROR",
      message: "Database connection failed. Check database settings."
    });
  }
});

// C2B validation callback
app.post("/c2b/validation", (req, res) => {
  console.log("C2B validation request received");

  res.json({
    ResultCode: 0,
    ResultDesc: "Accepted"
  });
});

// C2B confirmation callback
app.post("/c2b/confirmation", (req, res) => {
  const payment = req.body;

  console.log("C2B payment received:", {
    receipt: payment.TransID,
    amount: payment.TransAmount,
    reference: payment.BillRefNumber
  });

  res.json({
    ResultCode: 0,
    ResultDesc: "Accepted"
  });
});
// Create the platform database tables
async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS resellers (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      phone VARCHAR(20) UNIQUE NOT NULL,
      status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS offers (
      id BIGSERIAL PRIMARY KEY,
      reseller_id BIGINT REFERENCES resellers(id),
      name VARCHAR(150) NOT NULL,
      product_type VARCHAR(20) NOT NULL,
      price NUMERIC(12,2) NOT NULL CHECK (price > 0),
      bundle_code VARCHAR(100),
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      order_reference VARCHAR(100) UNIQUE NOT NULL,
      reseller_id BIGINT REFERENCES resellers(id),
      offer_id BIGINT REFERENCES offers(id),
      customer_phone VARCHAR(20) NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      status VARCHAR(30) DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payments (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT REFERENCES orders(id),
      mpesa_receipt VARCHAR(50) UNIQUE NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      phone VARCHAR(20),
      reference VARCHAR(100),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS token_wallets (
      id BIGSERIAL PRIMARY KEY,
      reseller_id BIGINT UNIQUE REFERENCES resellers(id),
      balance BIGINT DEFAULT 0 CHECK (balance >= 0)
    );

    CREATE TABLE IF NOT EXISTS token_transactions (
      id BIGSERIAL PRIMARY KEY,
      reseller_id BIGINT REFERENCES resellers(id),
      transaction_type VARCHAR(30) NOT NULL,
      amount BIGINT NOT NULL,
      reference VARCHAR(100) UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id BIGSERIAL PRIMARY KEY,
      reseller_id BIGINT REFERENCES resellers(id),
      plan VARCHAR(30) NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      payer_name VARCHAR(150),
      payer_phone VARCHAR(20),
      status VARCHAR(30) DEFAULT 'pending',
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS airtime_ledger (
      id BIGSERIAL PRIMARY KEY,
      owner_type VARCHAR(20) NOT NULL,
      reseller_id BIGINT REFERENCES resellers(id),
      transaction_type VARCHAR(30) NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      reference VARCHAR(100) UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log("Platform database tables created successfully.");
  }
// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
