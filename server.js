
const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
require("dotenv").config();

const app = express();

app.use(express.json({ limit: "100kb" }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, x-test-key, Authorization"
  );

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

pool.on("error", (error) => {
  console.error("Database error:", error.message);
});

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

function sendError(res, status, message) {
  return res.status(status).json({
    status: "ERROR",
    message
  });
}

function createToken(payload) {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT security is not configured.");
  }

  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: "12h"
  });
}

// DATABASE INITIALIZATION AND SAFE MIGRATIONS
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

    CREATE TABLE IF NOT EXISTS product_catalog (
      id BIGSERIAL PRIMARY KEY,
      product_name VARCHAR(150) NOT NULL,
      product_type VARCHAR(20) NOT NULL,
      bundle_code VARCHAR(100) UNIQUE NOT NULL,
      bundle_size VARCHAR(100),
      validity VARCHAR(100),
      supplier_name VARCHAR(150),
      verified BOOLEAN DEFAULT FALSE,
      active BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE offers
      ADD COLUMN IF NOT EXISTS catalog_product_id BIGINT
      REFERENCES product_catalog(id);

    ALTER TABLE offers
      ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20)
      DEFAULT 'pending';

    CREATE INDEX IF NOT EXISTS idx_orders_reseller
      ON orders(reseller_id);

    CREATE INDEX IF NOT EXISTS idx_offers_reseller
      ON offers(reseller_id);
  `);

  console.log("Database initialization completed.");
}

// TEST SECURITY
function checkTestSecret(req, res, next) {
  const secret = process.env.MPESA_TEST_SECRET;

  if (!secret || req.get("x-test-key") !== secret) {
    return sendError(res, 401, "Not authorized.");
  }

  next();
}

// GENERAL JWT AUTHENTICATION
function authenticateToken(req, res, next) {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    return sendError(res, 503, "Login security is not configured.");
  }

  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.substring(7)
    : "";

  if (!token) return sendError(res, 401, "Please log in.");

  try {
    req.user = jwt.verify(token, secret);
    next();
  } catch (error) {
    return sendError(res, 401, "Invalid or expired login session.");
  }
}

// RESELLER AUTHENTICATION
async function authenticateReseller(req, res, next) {
  authenticateToken(req, res, async () => {
    try {
      if (
        !req.user.resellerId ||
        req.user.role === "admin"
      ) {
        return sendError(res, 403, "Reseller access required.");
      }

      const result = await pool.query(
        "SELECT id, status FROM resellers WHERE id = $1",
        [req.user.resellerId]
      );

      if (
        result.rows.length === 0 ||
        result.rows[0].status !== "active"
      ) {
        return sendError(res, 403, "Reseller account is not active.");
      }

      req.reseller = result.rows[0];
      next();
    } catch (error) {
      console.error("Reseller authentication error:", error.message);
      return sendError(res, 500, "Could not verify reseller account.");
    }
  });
}

// ADMIN AUTHENTICATION
function authenticateAdmin(req, res, next) {
  authenticateToken(req, res, () => {
    if (req.user.role !== "admin") {
      return sendError(res, 403, "Administrator access required.");
    }

    next();
  });
}

// HOMEPAGE
app.get("/", (req, res) => {
  res.send("M-Pesa Auto Bundles backend is running.");
});

// ADMINISTRATOR DASHBOARD
app.get("/admin", (req, res) => {
  app.get("/logo.png", (req, res) => {
  res.sendFile(__dirname + "/logo.png");
});
  res.sendFile(__dirname + "/admin.html");
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

app.get("/api/mpesa/auth-check", checkTestSecret, async (req, res) => {
  try {
    await getDarajaAccessToken();

    res.json({
      status: "OK",
      message: "Daraja sandbox authentication successful."
    });
  } catch (error) {
    console.error("Daraja error:", error.message);
    sendError(res, 502, "Daraja authentication failed.");
  }
});

// DATABASE TEST
app.get("/api/db-check", checkTestSecret, async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS database_time");

    res.json({
      status: "OK",
      message: "PostgreSQL database connection successful.",
      database_time: result.rows[0].database_time
    });
  } catch (error) {
    console.error("Database test error:", error.message);
    sendError(res, 500, "Database connection failed.");
  }
});

// ADMINISTRATOR LOGIN
app.post("/api/admin/login", async (req, res) => {
  const { phone, password } = req.body;

  if (
    typeof phone !== "string" ||
    typeof password !== "string"
  ) {
    return sendError(res, 400, "Phone number and password are required.");
  }

  const configuredPhone = process.env.ADMIN_PHONE;
  const configuredPassword = process.env.ADMIN_PASSWORD;

  if (!configuredPhone || !configuredPassword || !process.env.JWT_SECRET) {
    return sendError(res, 503, "Administrator security is not configured.");
  }

  try {
    const submittedPhone = normalizePhone(phone);
    const expectedPhone = normalizePhone(configuredPhone);

    const phoneMatches = submittedPhone === expectedPhone;

    const submittedPassword = Buffer.from(password);
    const expectedPassword = Buffer.from(configuredPassword);

    const passwordMatches =
      submittedPassword.length === expectedPassword.length &&
      crypto.timingSafeEqual(submittedPassword, expectedPassword);

    if (!phoneMatches || !passwordMatches) {
      return sendError(res, 401, "Incorrect administrator credentials.");
    }

    const token = createToken({
      role: "admin"
    });

    res.json({
      status: "OK",
      message: "Administrator login successful.",
      token,
      administrator: {
        phone: expectedPhone,
        role: "admin"
      }
    });
  } catch (error) {
    if (error.message.includes("valid Kenyan mobile")) {
      return sendError(res, 400, error.message);
    }

    console.error("Administrator login error:", error.message);
    sendError(res, 500, "Administrator login failed.");
  }
});

// ADMINISTRATOR PROFILE
app.get("/api/admin/me", authenticateAdmin, (req, res) => {
  res.json({
    status: "OK",
    administrator: {
      phone: process.env.ADMIN_PHONE,
      role: "admin"
    }
  });
});

// ADMIN: VIEW ALL RESELLERS
app.get("/api/admin/resellers", authenticateAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        r.id,
        r.name,
        r.phone,
        r.status,
        r.created_at
      FROM resellers r
      ORDER BY r.created_at DESC
    `);

    res.json({
      status: "OK",
      resellers: result.rows
    });
  } catch (error) {
    console.error("Reseller list error:", error.message);
    sendError(res, 500, "Could not load reseller accounts.");
  }
});

// ADMIN: APPROVE OR SUSPEND RESELLER
app.patch(
  "/api/admin/resellers/:id/status",
  authenticateAdmin,
  async (req, res) => {
    const { status } = req.body;
    const resellerId = req.params.id;

    if (!/^\d+$/.test(resellerId)) {
      return sendError(res, 400, "Invalid reseller ID.");
    }

    if (!["active", "suspended", "pending"].includes(status)) {
      return sendError(res, 400, "Invalid reseller status.");
    }

    try {
      const result = await pool.query(
        `UPDATE resellers
         SET status = $1
         WHERE id = $2
         RETURNING id, name, phone, status`,
        [status, resellerId]
      );

      if (result.rows.length === 0) {
        return sendError(res, 404, "Reseller not found.");
      }

      res.json({
        status: "OK",
        message: "Reseller status updated.",
        reseller: result.rows[0]
      });
    } catch (error) {
      console.error("Reseller status error:", error.message);
      sendError(res, 500, "Could not update reseller status.");
    }
  }
);

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
    return sendError(
      res,
      400,
      "Enter your name, valid phone number and password of at least 8 characters."
    );
  }

  let client;

  try {
    const normalizedPhone = normalizePhone(phone);
    const passwordHash = await bcrypt.hash(password, 12);

    client = await pool.connect();
    await client.query("BEGIN");

    const resellerResult = await client.query(
      `INSERT INTO resellers (name, phone, status)
       VALUES ($1, $2, 'pending')
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
      message: "Registration received. Await administrator approval.",
      reseller
    });
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }

    if (error.code === "23505") {
      return sendError(res, 409, "This phone number is already registered.");
    }

    if (error.message.includes("valid Kenyan mobile")) {
      return sendError(res, 400, error.message);
    }

    console.error("Registration error:", error.message);
    sendError(res, 500, "Registration failed. Please try again.");
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
    return sendError(res, 400, "Phone number and password are required.");
  }

  if (!process.env.JWT_SECRET) {
    return sendError(res, 503, "Login security is not configured.");
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
      return sendError(res, 401, "Incorrect phone number or password.");
    }

    const reseller = result.rows[0];

    const passwordMatches = await bcrypt.compare(
      password,
      reseller.password_hash
    );

    if (!passwordMatches) {
      return sendError(res, 401, "Incorrect phone number or password.");
    }

    if (reseller.status !== "active") {
      return sendError(
        res,
        403,
        "Your account is awaiting administrator approval or is suspended."
      );
    }

    const token = createToken({
      role: "reseller",
      resellerId: reseller.id
    });

    res.json({
      status: "OK",
      message: "Login successful.",
      token,
      reseller: {
        id: reseller.id,
        name: reseller.name,
        phone: reseller.phone
      }
    });
  } catch (error) {
    if (error.message.includes("valid Kenyan mobile")) {
      return sendError(res, 400, error.message);
    }

    console.error("Login error:", error.message);
    sendError(res, 500, "Login failed. Please try again.");
  }
});

// PRIVATE RESELLER PROFILE
app.get("/api/resellers/me", authenticateReseller, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, phone, status, created_at
       FROM resellers
       WHERE id = $1`,
      [req.reseller.id]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, "Reseller account not found.");
    }

    res.json({
      status: "OK",
      reseller: result.rows[0]
    });
  } catch (error) {
    console.error("Profile error:", error.message);
    sendError(res, 500, "Could not load reseller profile.");
  }
});

// VIEW VERIFIED PRODUCT CATALOGUE
app.get(
  "/api/catalog",
  authenticateToken,
  async (req, res) => {
    try {
      if (
        req.user.role !== "admin" &&
        !req.user.resellerId
      ) {
        return sendError(res, 403, "Access denied.");
      }

      const result = await pool.query(
        `SELECT id, product_name, product_type,
                bundle_code, bundle_size, validity,
                supplier_name
         FROM product_catalog
         WHERE active = TRUE AND verified = TRUE
         ORDER BY product_name`
      );

      res.json({
        status: "OK",
        products: result.rows
      });
    } catch (error) {
      console.error("Catalogue error:", error.message);
      sendError(res, 500, "Could not load product catalogue.");
    }
  }
);

// CREATE A CUSTOM SELLING OFFER
app.post("/api/offers", authenticateToken, async (req, res) => {
  const { catalog_product_id, name, price } = req.body;

  if (
    !/^\d+$/.test(String(catalog_product_id || "")) ||
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 150 ||
    !Number.isFinite(Number(price)) ||
    Number(price) <= 0 ||
    Number(price) > 1000000
  ) {
    return sendError(res, 400, "Enter a valid product, offer name and selling price.");
  }

  const isAdmin = req.user.role === "admin";
  const resellerId = isAdmin ? null : req.user.resellerId;

  if (!isAdmin && !resellerId) {
    return sendError(res, 403, "Access denied.");
  }

  try {
    const productResult = await pool.query(
      `SELECT id, product_name, product_type, bundle_code
       FROM product_catalog
       WHERE id = $1
         AND active = TRUE
         AND verified = TRUE`,
      [catalog_product_id]
    );

    if (productResult.rows.length === 0) {
      return sendError(
        res,
        400,
        "This product is not in the verified active catalogue."
      );
    }

    const product = productResult.rows[0];

    const approvalStatus = isAdmin ? "approved" : "pending";
    const active = isAdmin;

    const result = await pool.query(
      `INSERT INTO offers
       (reseller_id, name, product_type, price,
        bundle_code, catalog_product_id,
        approval_status, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        resellerId,
        name.trim(),
        product.product_type,
        Number(price),
        product.bundle_code,
        product.id,
        approvalStatus,
        active
      ]
    );

    res.status(201).json({
      status: "OK",
      message: isAdmin
        ? "Administrator offer created."
        : "Offer submitted for administrator approval.",
      offer: result.rows[0]
    });
  } catch (error) {
    console.error("Offer creation error:", error.message);
    sendError(res, 500, "Could not create offer.");
  }
});

// VIEW OFFERS: ADMIN SEES ALL; RESELLER SEES OWN
app.get("/api/offers", authenticateToken, async (req, res) => {
  try {
    let result;

    if (req.user.role === "admin") {
      result = await pool.query(
        `SELECT * FROM offers ORDER BY created_at DESC`
      );
    } else if (req.user.resellerId) {
      result = await pool
     .query(
        `SELECT * FROM offers
         WHERE reseller_id = $1 OR reseller_id IS NULL
         ORDER BY created_at DESC`,
        [req.user.resellerId]
      );
    } else {
      return sendError(res, 403, "Access denied.");
    }

    res.json({
      status: "OK",
      offers: result.rows
    });
  } catch (error) {
    console.error("Offers list error:", error.message);
    sendError(res, 500, "Could not load offers.");
  }
});

// ADMIN: APPROVE OR REJECT A RESELLER OFFER
app.patch(
  "/api/admin/offers/:id/approval",
  authenticateAdmin,
  async (req, res) => {
    const { approval_status } = req.body;
    const offerId = req.params.id;

    if (!/^\d+$/.test(offerId)) {
      return sendError(res, 400, "Invalid offer ID.");
    }

    if (!["approved", "rejected"].includes(approval_status)) {
      return sendError(res, 400, "Choose approved or rejected.");
    }

    try {
      const result = await pool.query(
        `UPDATE offers
         SET approval_status = $1,
             active = $2
         WHERE id = $3
         RETURNING *`,
        [
          approval_status,
          approval_status === "approved",
          offerId
        ]
      );

      if (result.rows.length === 0) {
        return sendError(res, 404, "Offer not found.");
      }

      res.json({
        status: "OK",
        message: "Offer review completed.",
        offer: result.rows[0]
      });
    } catch (error) {
      console.error("Offer approval error:", error.message);
      sendError(res, 500, "Could not update offer.");
    }
  }
);

// SAFARICOM C2B VALIDATION CALLBACK
app.post("/api/mpesa/c2b/validation", (req, res) => {
  console.log("C2B validation callback received.");

  res.json({
    ResultCode: 0,
    ResultDesc: "Accepted"
  });
});

// SAFARICOM C2B CONFIRMATION CALLBACK
app.post("/api/mpesa/c2b/confirmation", async (req, res) => {
  try {
    console.log(
      "C2B confirmation callback received:",
      JSON.stringify(req.body)
    );

    res.json({
      ResultCode: 0,
      ResultDesc: "Confirmation received"
    });
  } catch (error) {
    console.error("C2B callback error:", error.message);

    res.json({
      ResultCode: 0,
      ResultDesc: "Received"
    });
  }
});

// START SERVER AFTER DATABASE INITIALIZATION
const PORT = process.env.PORT || 3000;

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`M-Pesa Auto Bundles backend running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  });
        
