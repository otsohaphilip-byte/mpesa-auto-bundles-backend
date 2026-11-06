
const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();

app.use(express.json({ limit: "100kb" }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, x-test-key, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

// DATABASE CONNECTION
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

pool.on("error", (error) => {
  console.error("Database error:", error.message);
});

// NORMALIZE KENYAN PHONE NUMBERS
function normalizePhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");

  if (digits.startsWith("0")) {
    digits = digits.substring(1);
  } else if (digits.startsWith("254")) {
    digits = digits.substring(3);
  }

  if (!/^[17]\d{8}$/.test(digits)) {
    throw new Error("Enter a valid Kenyan mobile number.");
  }

  return "254" + digits;
}

// DATABASE TABLES
async function initializeDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing.");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS resellers (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      phone VARCHAR(20) UNIQUE NOT NULL,
      status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reseller_credentials (
      id BIGSERIAL PRIMARY KEY,
      reseller_id BIGINT UNIQUE NOT NULL
        REFERENCES resellers(id),
      password_hash TEXT NOT NULL,
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

  console.log("SUCCESS: Database tables created.");
}

// TEST SECURITY
function checkTestSecret(req, res, next) {
  const secret = process.env.MPESA_TEST_SECRET;

  if (!secret || req.get("x-test-key") !== secret) {
    return res.status(401).json({
      status: "ERROR",
      message: "Not authorized."
    });
  }

  next();
}

// RESELLER LOGIN SECURITY
function authenticateReseller(req, res, next) {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    return res.status(503).json({
      status: "ERROR",
      message: "Login security is not configured."
    });
  }

  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.substring(7)
    : "";

  if (!token) {
    return res.status(401).json({
      status: "ERROR",
      message: "Please log in."
    });
  }

  try {
    req.reseller = jwt.verify(token, secret);
    next();
  } catch (error) {
    return res.status(401).json({
      status: "ERROR",
      message: "Invalid or expired login session."
    });
  }
}

// HOMEPAGE
app.get("/", (req, res) => {
  res.send("M-Pesa Auto Bundles backend is running.");
});

// HEALTH CHECK
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    application: "M-Pesa Auto Bundles"
  });
});

// DARAJA AUTHENTICATION
async function getDarajaAccessToken() {
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;

  if (!key || !secret) {
    throw new Error("Daraja credentials are missing.");
  }

  const credentials = Buffer.from(
    `${key}:${secret}`
  ).toString("base64");

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

// DARAJA TEST
app.get("/api/mpesa/auth-check", checkTestSecret, async (req, res) => {
  try {
    await getDarajaAccessToken();

    res.json({
      status: "OK",
      message: "Daraja sandbox authentication successful."
    });
  } catch (error) {
    console.error("Daraja error:", error.message);

    res.status(502).json({
      status: "ERROR",
      message: "Daraja authentication failed."
    });
  }
});

// DATABASE TEST
app.get("/api/db-check", checkTestSecret, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT NOW() AS database_time"
    );

    res.json({
      status: "OK",
      message: "PostgreSQL database connection successful.",
      database_time: result.rows[0].database_time
    });
  } catch (error) {
    console.error("Database test error:", error.message);

    res.status(500).json({
      status: "ERROR",
      message: "Database connection failed."
    });
  }
});

// RESELLER REGISTRATION
app.post("/api/resellers/register", async (req, res) => {
  const { name, phone, password } = req.body;

  if (
    typeof name !== "string" ||
    typeof phone !== "string" ||
    typeof password !== "string" ||
    !name.trim() ||
    password.length < 8 ||
    password.length > 128
  ) {
    return res.status(400).json({
      status: "ERROR",
      message: "Enter your name, valid phone number and password of at least 8 characters."
    });
  }

  let client;

  try {
    const normalizedPhone = normalizePhone(phone);
    const passwordHash = await bcrypt.hash(password, 12);

    client = await pool.connect();

    await client.query("BEGIN");

    const resellerResult = await client.query(
      `INSERT INTO resellers (name, phone, status)
       VALUES ($1, $2, 'active')
       RETURNING id, name, phone, status`,
      [name.trim(), normalizedPhone]
    );

    const reseller = resellerResult.rows[0];

    await client.query(
      `INSERT INTO reseller_credentials
       (reseller_id, password_hash)
       VALUES ($1, $2)`,
      [reseller.id, passwordHash]
    );

    await client.query(
      `INSERT INTO token_wallets (reseller_id, balance)
       VALUES ($1, 0)`,
      [reseller.id]
    );

    await client.query("COMMIT");

    res.status(201).json({
      status: "OK",
      message: "Reseller registration successful.",
      reseller: reseller
    });

  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }

    if (error.code === "23505") {
      return res.status(409).json({
        status: "ERROR",
        message: "This phone number is already registered."
      });
    }

    if (error.message.includes("valid Kenyan mobile")) {
      return res.status(400).json({
        status: "ERROR",
        message: error.message
      });
    }

    console.error("Registration error:", error.message);

    res.status(500).json({
      status: "ERROR",
      message: "Registration failed. Please try again."
    });

  } finally {
    if (client) client.release();
  }
});

// RESELLER LOGIN
app.post("/api/resellers/login", async (req, res) => {
  const { phone, password } = req.body;

  if (
    typeof phone !== "string" ||
    typeof password !== "string" ||
    !password
  ) {
    return res.status(400).json({
      status: "ERROR",
      message: "Phone number and password are required."
    });
  }

  if (!process.env.JWT_SECRET) {
    return res.status(503).json({
      status: "ERROR",
      message: "Login security is not configured."
    });
  }

  try {
    const normalizedPhone = normalizePhone(phone);

    const result = await pool.query(
      `SELECT
         r.id,
         r.name,
         r.phone,
         r.status,
         c.password_hash
       FROM resellers r
       JOIN reseller_credentials c
         ON c.reseller_id = r.id
       WHERE r.phone = $1`,
      [normalizedPhone]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        status: "ERROR",
        message: "Incorrect phone number or password."
      });
    }

    const reseller = result.rows[0];

    const passwordMatches = await bcrypt.compare(
      password,
      reseller.password_hash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        status: "ERROR",
        message: "Incorrect phone number or password."
      });
    }

    if (reseller.status !== "active") {
      return res.status(403).json({
        status: "ERROR",
        message: "Your reseller account is not active."
      });
    }

    const token = jwt.sign(
      { resellerId: reseller.id },
      process.env.JWT_SECRET,
      { expiresIn: "12h" }
    );

    res.json({
      status: "OK",
      message: "Login successful.",
      token: token,
      reseller: {
        id: reseller.id,
        name: reseller.name,
        phone: reseller.phone
      }
    });

  } catch (error) {
    if (error.message.includes("valid Kenyan mobile")) {
      return res.status(400).json({
        status: "ERROR",
        message: error.message
      });
    }

    console.error("Login error:", error.message);

    res.status(500).json({
      status: "ERROR",
      message: "Login failed. Please try again."
    });
  }
});

// PRIVATE RESELLER PROFILE
app.get(
  "/api/resellers/me",
  authenticateReseller,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, name, phone, status, created_at
         FROM resellers
         WHERE id = $1`,
        [req.reseller.resellerId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "ERROR",
          message: "Reseller account not found."
        });
      }

      res.json({
        status: "OK",
        reseller: result.rows[0]
      });

    } catch (error) {
      console.error("Profile error:", error.message);

      res.status(500).json({
        status: "ERROR",
        message: "Could not load reseller profile."
      });
    }
  }
);

// C2B VALIDATION CALLBACK
app.post("/c2b/validation", (req, res) => {
  console.log("C2B validation received.");

  res.json({
    ResultCode: 0,
    ResultDesc: "Accepted"
  });
});

// C2B CONFIRMATION CALLBACK
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

// START BACKEND
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);

  initializeDatabase()
    .then(() => {
      console.log("Database initialization completed.");
    })
    .catch((error) => {
      console.error(
        "DATABASE INITIALIZATION FAILED:",
        error.message
      );
    });
});
                              
