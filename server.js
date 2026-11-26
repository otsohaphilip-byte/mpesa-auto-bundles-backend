const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { installOperations } = require("./operations");
require("dotenv").config();
const { installUssdDevices } = require("./ussd-devices");

const app = express();

app.use(express.json({ limit: "100kb" }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PATCH, DELETE, OPTIONS"
  );
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, x-test-key, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});
const ADMIN_BUY_GOODS_TILL = String(
  process.env.ADMIN_BUY_GOODS_TILL || "1731432"
).trim();

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

function normalizePhoneForUssd(phone) {
  const internationalPhone = normalizePhone(phone);
  return "0" + internationalPhone.substring(3);
}
function buildUssdCode(template, destinationPhone) {
  const codeTemplate = String(template || "").trim();

  if (!codeTemplate.includes("@")) {
    throw new Error("USSD template has no phone number placeholder.");
  }

  const localPhone = normalizePhoneForUssd(destinationPhone);
  const ussdCode = codeTemplate.replace(/@/g, localPhone);

  if (!/^\*[0-9*]+#$/.test(ussdCode)) {
    throw new Error("Generated USSD code is invalid.");
  }

  return ussdCode;
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

// SERIALIZE OFFER PRICE CHANGES AND CHECKS
async function lockOfferPrices(client) {
  await client.query(
    "SELECT pg_advisory_xact_lock($1)",
    [872341]
  );
}
async function ensureResellerDefaultOffers(client, resellerId) {
  await client.query(
    "SELECT pg_advisory_xact_lock($1)",
    [872342]
  );

  await client.query(
    `INSERT INTO offers (
       reseller_id,
       name,
       product_type,
       price,
       bundle_code,
       active,
       approval_status,
       bingwa_price,
       safaricom_price,
       catalog_product_id
     )
     SELECT
       $1,
       pc.product_name,
       pc.product_type,
       COALESCE(pc.bingwa_price, pc.safaricom_price),
       pc.bundle_code,
       TRUE,
       'approved',
       COALESCE(pc.bingwa_price, pc.safaricom_price),
       COALESCE(pc.safaricom_price, pc.bingwa_price),
       pc.id
     FROM product_catalog pc
     WHERE pc.active = TRUE
       AND COALESCE(pc.bingwa_price, pc.safaricom_price) > 0
       AND NOT EXISTS (
         SELECT 1
         FROM offers o
         WHERE o.reseller_id = $1
           AND o.catalog_product_id = pc.id
       )`,
    [resellerId]
  );
}

async function hasDuplicateActivePrice(
  client,
  price,
  excludeId = null,
  resellerId = null
) {
  const result = await client.query(
    `SELECT id
     FROM offers
     WHERE active = TRUE
       AND approval_status = 'approved'
       AND COALESCE(bingwa_price, price) = $1
       AND reseller_id IS NOT DISTINCT FROM $3
       AND ($2::BIGINT IS NULL OR id <> $2)
     LIMIT 1`,
    [price, excludeId, resellerId]
  );

  return result.rows.length > 0;
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
      payment_reference VARCHAR(100) UNIQUE,
      checkout_request_id VARCHAR(100) UNIQUE,
      merchant_request_id VARCHAR(100),
      mpesa_receipt VARCHAR(50) UNIQUE,
      paid_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE subscriptions
      ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(100),
      ADD COLUMN IF NOT EXISTS checkout_request_id VARCHAR(100),
      ADD COLUMN IF NOT EXISTS merchant_request_id VARCHAR(100),
      ADD COLUMN IF NOT EXISTS mpesa_receipt VARCHAR(50),
      ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

    CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_payment_reference
      ON subscriptions(payment_reference);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_checkout_request
      ON subscriptions(checkout_request_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_mpesa_receipt
      ON subscriptions(mpesa_receipt);
      

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
          ALTER TABLE product_catalog
      ADD COLUMN IF NOT EXISTS bingwa_price NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS safaricom_price NUMERIC(12,2);
      INSERT INTO product_catalog
(product_name, product_type, bundle_code, bingwa_price, safaricom_price, verified, active)
VALUES
('1GB - 1Hr', 'data', '*180*5*2*@*1*1#', 19, 20, FALSE, TRUE),
('250MB - 24Hrs', 'data', '*180*5*2*@*2*1#', 20, 20, FALSE, TRUE),
('1GB - 1Hr Tunukiwa', 'data', '*544*12*1*@*1#', 21, 20, FALSE, TRUE),
('400MB - 7Days', 'data', '*180*5*2*@*4*1#', 49, 50, FALSE, TRUE),
('750MBs_50SMS - 24Hrs', 'data', '*180*5*2*@*3*1#', 50, 50, FALSE, TRUE),
('1,5Gb - 3hrs', 'data', '*180*5*2*@*7*1#', 52, 50, FALSE, TRUE),
('2GB - 24Hr Tunukiwa', 'data', '*544*12*0*@*1*1#', 104, 100, FALSE, TRUE),
('2,5 GB 30days', 'data', '*180*5*2*@*0*1*1#', 254, 255, FALSE, TRUE),
('7GB 30 days', 'data', '*180*5*2*@*0*3*1#', 509, 500, FALSE, TRUE),
('8GB + 400 mins 30 days', 'data', '*180*5*2*@*0*6*1#', 1006, 1000, FALSE, TRUE),
('21 GB 3days', 'data', '*180*5*2*@*8*5*1#', 1009, 1000, FALSE, TRUE),

('20SMS - 24Hrs', 'sms', '*188*@*1*1*@*1*2#', 5, 5, FALSE, TRUE),
('200SMS - 24Hrs', 'sms', '*188*@*1*2*@*1*2#', 10, 10, FALSE, TRUE),
('100 SMS 7days', 'sms', '*188*@*2*1*@*1*2#', 24, 20, FALSE, TRUE),
('Unlimited SMS daily', 'sms', '*188*@*1*3*@*1*2#', 25, 250, FALSE, TRUE),
('1000SMS - 7Days', 'sms', '**188*@*2*2*@*1*2#', 30, 30, FALSE, TRUE),
('Unlimited SMS 7days', 'sms', '*188*@*2*3*@*1*2#', 54, 50, FALSE, TRUE),
('1500SMS - 1Month', 'sms', '*188*@*3*1*@*1*2#', 101, 100, FALSE, TRUE),
('3500 SMS 1 MONTH', 'sms', '*188*@*3*2*@*1*2#', 206, 200, FALSE, TRUE),

('350mins - 2 hrs (mins + SMS)', 'minutes', '*444*5*1*3*@*2*1#', 22, 20, FALSE, TRUE),
('500 mins - 2hrs ( mins + SMS)', 'minutes', '*444*5*2*3*@*2*1#', 33, 30, FALSE, TRUE),
('350 mins Midnyut', 'minutes', '*444*5*3*3*@*2*1#', 53, 50, FALSE, TRUE),
('1000 mins Midnyut', 'minutes', '*444*5*4*3*@*2*1#', 105, 100, FALSE, TRUE),
('1500 mins 7days', 'minutes', '*444*5*5*3*@*2*1#', 255, 250, FALSE, TRUE),
('3500 mins 7days', 'minutes', '*444*5*1*98*6*3*@*2*1#', 505, 500, FALSE, TRUE),
('9000 mins 30 days', 'minutes', '*444*5*1*98*7*3*@*2*1#', 1010, 1000, FALSE, TRUE),
('20000 min 30days', 'minutes', '*444*5*1*98*8*3*@*2*1#', 2020, 2000, FALSE, TRUE)
ON CONFLICT (bundle_code) DO NOTHING;
UPDATE product_catalog
SET bingwa_price = 254
WHERE bundle_code = '*180*5*2*@*0*1*1#';

    ALTER TABLE offers
      ADD COLUMN IF NOT EXISTS bingwa_price NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS safaricom_price NUMERIC(12,2);
          UPDATE offers
    SET bingwa_price = price
    WHERE bingwa_price IS NULL;

    UPDATE offers o
    SET safaricom_price = pc.safaricom_price
    FROM product_catalog pc
    WHERE o.catalog_product_id = pc.id
      AND o.safaricom_price IS NULL;
      ALTER TABLE resellers
  ADD COLUMN IF NOT EXISTS email VARCHAR(150);

ALTER TABLE resellers
  ADD COLUMN IF NOT EXISTS buy_goods_till VARCHAR(30);

ALTER TABLE resellers
  ADD COLUMN IF NOT EXISTS till_phone VARCHAR(20);
      CREATE TABLE IF NOT EXISTS mpesa_callback_events (
  id BIGSERIAL PRIMARY KEY,
  trans_id VARCHAR(50) UNIQUE,
  business_short_code VARCHAR(30),
  bill_ref_number VARCHAR(100),
  trans_amount NUMERIC(12,2),
  msisdn VARCHAR(20),
  first_name VARCHAR(100),
  middle_name VARCHAR(100),
  last_name VARCHAR(100),
  trans_time VARCHAR(30),
  raw_payload JSONB NOT NULL,
  processing_status VARCHAR(30) NOT NULL DEFAULT 'unmatched',
  processing_note TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

    CREATE TABLE IF NOT EXISTS delivery_jobs (
      id BIGSERIAL PRIMARY KEY,
      payment_receipt VARCHAR(50) UNIQUE NOT NULL,
      gateway_role VARCHAR(20) NOT NULL
        CHECK (gateway_role IN ('admin', 'reseller')),
      reseller_id BIGINT REFERENCES resellers(id),
      admin_phone VARCHAR(20),
      offer_id BIGINT REFERENCES offers(id),
      offer_name VARCHAR(150) NOT NULL,
      destination_phone VARCHAR(20) NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      ussd_code VARCHAR(150) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'queued'
        CHECK (status IN (
          'queued', 'claimed', 'running',
          'success', 'failed', 'uncertain'
        )),
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      claimed_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_delivery_jobs_gateway
      ON delivery_jobs(gateway_role, reseller_id, admin_phone, status);
      

    CREATE INDEX IF NOT EXISTS idx_orders_reseller
      ON orders(reseller_id);

    CREATE INDEX IF NOT EXISTS idx_offers_reseller
      ON offers(reseller_id);
  `);

  console.log("Database initialization completed.");
    }
// ==============================
// AUTHENTICATION MIDDLEWARE
// ==============================

function authenticateToken(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({
      status: "ERROR",
      message: "Authentication required."
    });
  }

  try {
    req.user = jwt.verify(
      token,
      process.env.JWT_SECRET || "change-this-secret"
    );
    next();
  } catch (error) {
    return res.status(401).json({
      status: "ERROR",
      message: "Invalid or expired token."
    });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({
      status: "ERROR",
      message: "Administrator access required."
    });
  }
  next();
}
function requireAdminOrReseller(req, res, next) {
  if (!["admin", "reseller"].includes(req.user.role)) {
    return res.status(403).json({
      status: "ERROR",
      message: "Access denied."
    });
  }

  next();
}

function requireReseller(req, res, next) {
  if (req.user.role !== "reseller") {
    return res.status(403).json({
      status: "ERROR",
      message: "Reseller access required."
    });
  }
  next();
}

// ==============================
// WEBSITE AND HEALTH ROUTES
// ==============================

app.get("/", (req, res) => {
  res.send("M-Pesa Auto Bundles API is running.");
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});
app.get("/admin-controls.js", (req, res) => {
  res.sendFile(path.join(__dirname, "admin-controls.js"));
});

app.get("/logo.png", (req, res) => {
  res.sendFile(path.join(__dirname, "logo.png"));
});

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "OK",
      message: "Server and database are running."
    });
  } catch (error) {
    res.status(500).json({
      status: "ERROR",
      message: "Database connection failed."
    });
  }
});

// ==============================
// DARAJA CONNECTION CHECK
// ==============================

async function getDarajaAccessToken() {
  const key = process.env.DARAJA_CONSUMER_KEY;
  const secret = process.env.DARAJA_CONSUMER_SECRET;

  if (!key || !secret) {
    throw new Error("Daraja credentials are not configured.");
  }

  const credentials = Buffer
    .from(`${key}:${secret}`)
    .toString("base64");

  const baseUrl =
    process.env.DARAJA_BASE_URL ||
    "https://sandbox.safaricom.co.ke";

  const response = await fetch(
    `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${credentials}`
      }
    }
  );

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error("Unable to obtain Daraja access token.");
  }

  return data.access_token;
}

app.get(
  "/api/admin/daraja-check",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      await getDarajaAccessToken();

      res.json({
        status: "OK",
        message: "Daraja credentials are working."
      });
    } catch (error) {
      res.status(400).json({
        status: "ERROR",
        message: error.message
      });
    }
  }
);

// RESELLER SUBSCRIPTION STK PUSH
app.post(
  "/api/subscriptions/stk-push",
  authenticateToken,
  requireReseller,
  async (req, res) => {
    const plans = {
      daily: { amount: 50, days: 1 },
      weekly: { amount: 250, days: 7 },
      monthly: { amount: 500, days: 30 }
    };

    const plan = String(req.body.plan || "").toLowerCase();
    const selectedPlan = plans[plan];

    if (!selectedPlan) {
      return sendError(res, 400, "Select a valid subscription plan.");
    }

    const shortcode = String(
      process.env.DARAJA_STK_SHORTCODE || ""
    ).trim();

    const passkey = String(
      process.env.DARAJA_STK_PASSKEY || ""
    ).trim();

    const callbackUrl = String(
      process.env.DARAJA_STK_CALLBACK_URL || ""
    ).trim();

    if (!shortcode || !passkey || !callbackUrl) {
      return sendError(
        res,
        503,
        "Subscription STK payment settings are incomplete."
      );
    }

    let phone;

    try {
      phone = normalizePhone(req.body.phone);
    } catch (error) {
      return sendError(res, 400, error.message);
    }

    const paymentReference =
      "SUB" + Date.now() + crypto.randomBytes(4).toString("hex");

    const client = await pool.connect();

    try {
      const resellerResult = await client.query(
        `SELECT id, status
         FROM resellers
         WHERE id = $1`,
        [req.user.resellerId]
      );

      if (
        resellerResult.rowCount === 0 ||
        resellerResult.rows[0].status !== "approved"
      ) {
        return sendError(
          res,
          403,
          "Your reseller account must be approved before subscribing."
        );
      }

      const subscription = await client.query(
        `INSERT INTO subscriptions (
           reseller_id,
           plan,
           amount,
           payer_phone,
           status,
           payment_reference
         )
         VALUES ($1, $2, $3, $4, 'pending', $5)
         RETURNING id`,
        [
          req.user.resellerId,
          plan,
          selectedPlan.amount,
          phone,
          paymentReference
        ]
      );

      const accessToken = await getDarajaAccessToken();

      const timestamp = new Date()
        .toISOString()
        .replace(/[-T:.Z]/g, "")
        .slice(0, 14);

      const password = Buffer.from(
        shortcode + passkey + timestamp
      ).toString("base64");

      const baseUrl =
        process.env.DARAJA_BASE_URL ||
        "https://sandbox.safaricom.co.ke";

      const stkResponse = await fetch(
        `${baseUrl}/mpesa/stkpush/v1/processrequest`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            BusinessShortCode: shortcode,
            Password: password,
            Timestamp: timestamp,
            TransactionType:
              process.env.DARAJA_STK_TRANSACTION_TYPE ||
              "CustomerBuyGoodsOnline",
            Amount: selectedPlan.amount,
            PartyA: phone,
            PartyB: ADMIN_BUY_GOODS_TILL,
            PhoneNumber: phone,
            CallBackURL: callbackUrl,
            AccountReference: paymentReference,
            TransactionDesc: `Reseller ${plan} subscription`
          })
        }
      );

      const stkData = await stkResponse.json();

      if (
        !stkResponse.ok ||
        !stkData.CheckoutRequestID ||
        Number(stkData.ResponseCode) !== 0
      ) {
        throw new Error(
          stkData.errorMessage ||
          stkData.ResponseDescription ||
          "Safaricom did not accept the STK request."
        );
      }

      await client.query(
        `UPDATE subscriptions
         SET checkout_request_id = $1,
             merchant_request_id = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [
          stkData.CheckoutRequestID,
          stkData.MerchantRequestID || null,
          subscription.rows[0].id
        ]
      );

      return res.json({
        status: "OK",
        message: "Payment prompt sent. Complete payment on your phone.",
        payment_reference: paymentReference,
        amount: selectedPlan.amount
      });
    } catch (error) {
      console.error("Subscription STK error:", error);

      await client.query(
        `UPDATE subscriptions
         SET status = 'failed',
             updated_at = NOW()
         WHERE payment_reference = $1
           AND status = 'pending'`,
        [paymentReference]
      );

      return sendError(
        res,
        502,
        "Could not start subscription payment. Please try again."
      );
    } finally {
      client.release();
    }
  }
);
              
// Required for serving the admin page and logo
const path = require("path");

// ==============================
// ADMIN LOGIN AND PROFILE
// ==============================

app.post("/api/admin/login", async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (
      !phone ||
      !password ||
      phone !== process.env.ADMIN_PHONE ||
      password !== process.env.ADMIN_PASSWORD
    ) {
      return res.status(401).json({
        status: "ERROR",
        message: "Invalid administrator credentials."
      });
    }

    const token = createToken({
      role: "admin",
      phone
    });

    res.json({
      status: "OK",
      token,
      role: "admin"
    });
  } catch (error) {
    console.error("Admin login error:", error);
    sendError(res, 500, "Administrator login failed.");
  }
});

app.get(
  "/api/admin/me",
  authenticateToken,
  requireAdmin,
  (req, res) => {
    res.json({
      status: "OK",
      role: "admin",
      phone: req.user.phone
    });
  }
);

// ==============================
// ADMIN RESELLER MANAGEMENT
// ==============================

app.get(
  "/api/admin/resellers",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, name, phone, status, created_at
         FROM resellers
         ORDER BY created_at DESC`
      );

      res.json({
        status: "OK",
        resellers: result.rows
      });
    } catch (error) {
      console.error("Load resellers error:", error);
      sendError(res, 500, "Could not load resellers.");
    }
  }
);

app.patch(
  "/api/admin/resellers/:id/status",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const id = req.params.id;
      let { status } = req.body;

      if (status === "approved") {
        status = "active";
      }

      if (!["active", "pending", "suspended"].includes(status)) {
        return sendError(res, 400, "Invalid reseller status.");
      }

      const result = await pool.query(
        `UPDATE resellers
         SET status = $1
         WHERE id = $2
         RETURNING id, name, phone, status, created_at`,
        [status, id]
      );

      if (result.rowCount === 0) {
        return sendError(res, 404, "Reseller not found.");
      }

      res.json({
        status: "OK",
        reseller: result.rows[0]
      });
    } catch (error) {
      console.error("Update reseller error:", error);
      sendError(res, 500, "Could not update reseller.");
    }
  }
);

// ==============================
// RESELLER REGISTRATION
// ==============================

app.post("/api/resellers/register", async (req, res) => {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    const {
      name,
      email,
      phone,
      buy_goods_till,
      till_phone,
      password
    } = req.body;

    if (
      !name ||
      !email ||
      !phone ||
      !buy_goods_till ||
      !till_phone ||
      !password
    ) {
      return sendError(
        res,
        400,
        "All reseller details are required."
      );
    }

    const cleanName = String(name).trim();
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPhone = String(phone).trim();
    const cleanTill = String(buy_goods_till).trim();
    const cleanTillPhone = String(till_phone).trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return sendError(res, 400, "Enter a valid email address.");
    }

    if (
      !/^\+?[0-9]{9,15}$/.test(cleanPhone) ||
      !/^\+?[0-9]{9,15}$/.test(cleanTillPhone)
    ) {
      return sendError(res, 400, "Enter valid phone numbers.");
    }

    if (!/^[0-9]{4,15}$/.test(cleanTill)) {
      return sendError(res, 400, "Enter a valid Buy Goods Till number.");
    }

    if (String(password).length < 6) {
      return sendError(
        res,
        400,
        "Password must contain at least 6 characters."
      );
    }

    const existing = await client.query(
      `SELECT id FROM resellers
       WHERE phone = $1
       OR LOWER(email) = LOWER($2)
       OR buy_goods_till = $3
       LIMIT 1`,
      [cleanPhone, cleanEmail, cleanTill]
    );

    if (existing.rowCount > 0) {
      return sendError(
        res,
        409,
        "This phone, email or Buy Goods Till is already registered."
      );
    }

    await client.query("BEGIN");
    transactionStarted = true;

    const resellerResult = await client.query(
      `INSERT INTO resellers (
        name,
        email,
        phone,
        buy_goods_till,
        till_phone,
        status
      )
      VALUES ($1, $2, $3, $4, $5, 'pending')
      RETURNING id, name, email, phone,
                buy_goods_till, till_phone, status`,
      [
        cleanName,
        cleanEmail,
        cleanPhone,
        cleanTill,
        cleanTillPhone
      ]
    );

    const reseller = resellerResult.rows[0];

    const passwordHash = await bcrypt.hash(
      String(password),
      12
    );

    await client.query(
      `INSERT INTO reseller_credentials
       (reseller_id, password_hash)
       VALUES ($1, $2)`,
      [reseller.id, passwordHash]
    );
await ensureResellerDefaultOffers(client, reseller.id);
    await client.query("COMMIT");
    transactionStarted = false;

    res.status(201).json({
      status: "OK",
      message: "Registration received. Await administrator approval."
    });

  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK");
    }

    console.error("Reseller registration error:", error);
    sendError(res, 500, "Reseller registration failed.");

  } finally {
    client.release();
  }
});

// ==============================
// RESELLER LOGIN
// ==============================

app.post("/api/resellers/login", async (req, res) => {
  try {
    const { email, password } = req.body;
const cleanEmail = String(email || "").trim().toLowerCase();

    if (!cleanEmail || !password) {
  return sendError(
    res,
    400,
    "Email and password are required."
  );
    }

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
              WHERE LOWER(r.email) = $1
       LIMIT 1`,
      [cleanEmail]
    );

    if (result.rowCount === 0) {
      return sendError(res, 401, "Invalid login details.");
    }

    const reseller = result.rows[0];

    const passwordMatches = await bcrypt.compare(
      password,
      reseller.password_hash
    );

    if (!passwordMatches) {
      return sendError(res, 401, "Invalid login details.");
    }

    if (reseller.status !== "active") {
      return sendError(
        res,
        403,
        "Your reseller account is awaiting approval or is suspended."
      );
    }

    const token = createToken({
      role: "reseller",
      resellerId: reseller.id,
      phone: reseller.phone
    });

    res.json({
      status: "OK",
      token,
      reseller: {
        id: reseller.id,
        name: reseller.name,
        phone: reseller.phone
      }
    });
  } catch (error) {
    console.error("Reseller login error:", error);
    sendError(res, 500, "Reseller login failed.");
  }
});

// ==============================
// RESELLER PROFILE
// ==============================

app.get(
  "/api/resellers/me",
  authenticateToken,
  requireReseller,
  async (req, res) => {
    try {
      const result = await pool.query(
                `SELECT id, name, email, phone,
                buy_goods_till, till_phone,
                status, created_at
         FROM resellers
         WHERE id = $1`,
        [req.user.resellerId]
      );

      if (result.rowCount === 0) {
        return sendError(res, 404, "Reseller account not found.");
      }

      res.json({
        status: "OK",
        reseller: result.rows[0]
      });
    } catch (error) {
      console.error("Reseller profile error:", error);
      sendError(res, 500, "Could not load reseller profile.");
    }
  }
);
// ==============================
// VERIFIED PRODUCT CATALOGUE
// ==============================

app.get(
  "/api/catalog",
  authenticateToken,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT *
         FROM product_catalog
         WHERE active = TRUE
         ORDER BY id ASC`
      );

      res.json({
        status: "OK",
        products: result.rows
      });
    } catch (error) {
      console.error("Catalogue error:", error);
      sendError(res, 500, "Could not load product catalogue.");
    }
  }
);

// ==============================
// CREATE NEW OFFER
// ==============================

app.post(
  "/api/offers",
  authenticateToken,
  async (req, res) => {
    const client = await pool.connect();

    try {
      const {
        catalog_product_id,
        name,
        price
      } = req.body;

      if (!["admin", "reseller"].includes(req.user.role)) {
        return sendError(res, 403, "Access denied.");
      }

      const amount = Number(price);

      if (
        !catalog_product_id ||
        !name ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        amount > 1000000
      ) {
        return sendError(
          res,
          400,
          "A valid catalogue product, offer name and price are required."
        );
      }

      await client.query("BEGIN");

      const productResult = await client.query(
        `SELECT *
         FROM product_catalog
         WHERE id = $1
           AND active = TRUE
         LIMIT 1`,
        [catalog_product_id]
      );

      if (productResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return sendError(
          res,
          400,
          "This product is not available in the approved catalogue."
        );
      }

      
      const isAdmin = req.user.role === "admin";
      const resellerId = isAdmin ? null : req.user.resellerId;
      
      const approvalStatus = "approved";
      const active = true;

      if (!isAdmin && !resellerId) {
        await client.query("ROLLBACK");
        return sendError(res, 403, "Reseller account not found.");
      }

            await lockOfferPrices(client);

      const duplicate = await hasDuplicateActivePrice(
        client,
        amount,
        null,
        resellerId
      );

      if (duplicate) {
        await client.query("ROLLBACK");
        return sendError(
          res,
          409,
          "Another active offer on this same Till already uses this Bingwa price."
        );
  }

      const result = await client.query(
        `INSERT INTO offers (
           reseller_id,
           name,
           product_type,
           price,
           bingwa_price,
           safaricom_price,
           bundle_code,
           catalog_product_id,
           approval_status,
           active
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          resellerId,
          String(name).trim(),
          productResult.rows[0].product_type,
          amount,
          amount,
          productResult.rows[0].safaricom_price,
          productResult.rows[0].bundle_code || null,
          catalog_product_id,
          approvalStatus,
          active
        ]
      );

      await client.query("COMMIT");

      res.status(201).json({
        status: "OK",
        message: isAdmin
          ? "Offer created and approved."
          : "Your offer is now active.",
        offer: result.rows[0]
      });
    
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Offer rollback error:", rollbackError);
      }

      console.error("Create offer error:", error);
      sendError(res, 500, "Could not create offer.");
    } finally {
      client.release();
    }
  }
);

// ==============================
// LIST OFFERS
// ==============================

app.get(
  "/api/offers",
  authenticateToken,
  async (req, res) => {
    const client = await pool.connect();
    let transactionStarted = false;

    try {
      let result;

      if (req.user.role === "admin") {
        result = await client.query(
          `SELECT *
           FROM offers
           ORDER BY created_at DESC`
        );
      } else if (req.user.role === "reseller") {
        await client.query("BEGIN");
        transactionStarted = true;

        await ensureResellerDefaultOffers(
          client,
          req.user.resellerId
        );

        result = await client.query(
          `SELECT *
           FROM offers
           WHERE reseller_id = $1
           ORDER BY created_at DESC`,
          [req.user.resellerId]
        );

        await client.query("COMMIT");
        transactionStarted = false;
      } else {
        return sendError(res, 403, "Access denied.");
      }

      res.json({
        status: "OK",
        offers: result.rows
      });
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }

      console.error("Load offers error:", error);
      sendError(res, 500, "Could not load offers.");
    } finally {
      client.release();
    }
  }
);
// ==============================
// APPROVE OR REJECT AN OFFER
// ==============================

app.patch(
  "/api/admin/offers/:id/approval",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const client = await pool.connect();

    try {
      const id = req.params.id;
      const approvalStatus =
        req.body.approval_status || req.body.status;

      if (!["approved", "rejected"].includes(approvalStatus)) {
        return sendError(
          res,
          400,
          "Approval status must be approved or rejected."
        );
      }

      await client.query("BEGIN");
      await lockOfferPrices(client);

      const existing = await client.query(
        "SELECT * FROM offers WHERE id = $1 FOR UPDATE",
        [id]
      );

      if (existing.rowCount === 0) {
        await client.query("ROLLBACK");
        return sendError(res, 404, "Offer not found.");
      }

      const offer = existing.rows[0];

      if (approvalStatus === "approved") {
                const duplicate = await hasDuplicateActivePrice(
          client,
          offer.bingwa_price ?? offer.price,
          id,
          null
        );

        if (duplicate) {
          await client.query("ROLLBACK");
          return sendError(
            res,
            409,
            "Another active approved offer already uses this payment amount."
          );
        }
      }

      const result = await client.query(
        `UPDATE offers
         SET approval_status = $1,
             active = $2
         WHERE id = $3
         RETURNING *`,
        [
          approvalStatus,
          approvalStatus === "approved",
          id
        ]
      );

      await client.query("COMMIT");

      res.json({
        status: "OK",
        message: `Offer ${approvalStatus}.`,
        offer: result.rows[0]
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Approval rollback error:", rollbackError);
      }

      console.error("Offer approval error:", error);
      sendError(res, 500, "Could not update offer approval.");
    } finally {
      client.release();
    }
  }
);

// ==============================
// EDIT AN OFFER
// ==============================

app.patch(
  "/api/admin/offers/:id",
  authenticateToken,
    requireAdminOrReseller,
  async (req, res) => {
    const client = await pool.connect();

    try {
      const id = req.params.id;
      const { name, price } = req.body;

      if (
        name === undefined &&
        price === undefined
      ) {
        return sendError(
          res,
          400,
          "Provide an offer name or price to update."
        );
      }

      if (
        name !== undefined &&
        (typeof name !== "string" || !name.trim())
      ) {
        return sendError(res, 400, "Offer name is invalid.");
      }

      let amount;

      if (price !== undefined) {
        amount = Number(price);

        if (
          !Number.isFinite(amount) ||
          amount <= 0 ||
          amount > 1000000
        ) {
          return sendError(res, 400, "Offer price is invalid.");
        }
      }

      await client.query("BEGIN");
      await lockOfferPrices(client);

      const existing = await client.query(
        "SELECT * FROM offers WHERE id = $1 FOR UPDATE",
        [id]
      );

      if (existing.rowCount === 0) {
        await client.query("ROLLBACK");
        return sendError(res, 404, "Offer not found.");
      }

      const offer = existing.rows[0];
            if (
        req.user.role === "reseller" &&
        Number(offer.reseller_id) !== Number(req.user.resellerId)
      ) {
        await client.query("ROLLBACK");
        return sendError(
          res,
          403,
          "You can only edit your own offers."
        );
            }
      const newPrice =
        amount === undefined ? offer.price : amount;

      if (
        offer.active === true &&
        offer.approval_status === "approved"
      ) {
                                const duplicate = await hasDuplicateActivePrice(
          client,
          newPrice,
          id,
          req.user.role === "admin" ? null : req.user.resellerId
        );

        if (duplicate) {
          await client.query("ROLLBACK");
          return sendError(
            res,
            409,
            "Another active approved offer already uses this payment amount."
          );
        }
      }

                    const result = await client.query(
        `UPDATE offers
         SET name = $1,
             price = $2,
             bingwa_price = $2
         WHERE id = $3
         RETURNING *`,
        [
          name === undefined ? offer.name : name.trim(),
          newPrice,
          id
        ]
      );

      await client.query("COMMIT");

      res.json({
        status: "OK",
        message: "Offer updated successfully.",
        offer: result.rows[0]
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Edit rollback error:", rollbackError);
      }

      console.error("Edit offer error:", error);
      sendError(res, 500, "Could not edit offer.");
    } finally {
      client.release();
    }
  }
);
// ==============================
// ACTIVATE OR DEACTIVATE OFFER
// ==============================

app.patch(
  "/api/admin/offers/:id/active",
  authenticateToken,
    requireAdminOrReseller,
  async (req, res) => {
    const client = await pool.connect();

    try {
      const id = req.params.id;
      const active = req.body.active;

      if (typeof active !== "boolean") {
        return sendError(
          res,
          400,
          "Active must be true or false."
        );
      }

      await client.query("BEGIN");
      await lockOfferPrices(client);

      const existing = await client.query(
        "SELECT * FROM offers WHERE id = $1 FOR UPDATE",
        [id]
      );

      if (existing.rowCount === 0) {
        await client.query("ROLLBACK");
        return sendError(res, 404, "Offer not found.");
      }

      const offer = existing.rows[0];
            if (
        req.user.role === "reseller" &&
        Number(offer.reseller_id) !== Number(req.user.resellerId)
      ) {
        await client.query("ROLLBACK");
        return sendError(
          res,
          403,
          "You can only manage your own offers."
        );
            }

      if (
        active &&
        offer.approval_status !== "approved"
      ) {
        await client.query("ROLLBACK");
        return sendError(
          res,
          400,
          "Only approved offers can be activated."
        );
      }

      if (active) {
                        const duplicate = await hasDuplicateActivePrice(
          client,
          offer.bingwa_price ?? offer.price,
          id,
          req.user.role === "admin" ? null : req.user.resellerId
        );
        if (duplicate) {
          await client.query("ROLLBACK");
          return sendError(
            res,
            409,
            "Another active approved offer already uses this payment amount."
          );
        }
      }

      const result = await client.query(
        `UPDATE offers
         SET active = $1
         WHERE id = $2
         RETURNING *`,
        [active, id]
      );

      await client.query("COMMIT");

      res.json({
        status: "OK",
        message: active
          ? "Offer activated."
          : "Offer deactivated.",
        offer: result.rows[0]
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Toggle rollback error:", rollbackError);
      }

      console.error("Toggle offer error:", error);
      sendError(res, 500, "Could not change offer status.");
    } finally {
      client.release();
    }
  }
);

// ==============================
// DELETE OFFER
// ==============================

app.delete(
  "/api/admin/offers/:id",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const id = req.params.id;

      const result = await pool.query(
        `DELETE FROM offers
         WHERE id = $1
         RETURNING *`,
        [id]
      );

      if (result.rowCount === 0) {
        return sendError(res, 404, "Offer not found.");
      }

      res.json({
        status: "OK",
        message: "Offer deleted successfully.",
        offer: result.rows[0]
      });
    } catch (error) {
      if (error.code === "23503") {
        return sendError(
          res,
          409,
          "This offer is linked to existing orders and cannot be deleted. Deactivate it instead."
        );
      }

      console.error("Delete offer error:", error);
      sendError(res, 500, "Could not delete offer.");
    }
  }
);

 // SAFARICOM SUBSCRIPTION STK CALLBACK
app.post(
  "/api/mpesa/subscription-callback",
  async (req, res) => {
    const client = await pool.connect();

    try {
      const callback = req.body?.Body?.stkCallback;

      if (!callback?.CheckoutRequestID) {
        return res.json({
          ResultCode: 0,
          ResultDesc: "Callback received"
        });
      }

      await client.query("BEGIN");

      const result = await client.query(
        `SELECT *
         FROM subscriptions
         WHERE checkout_request_id = $1
         FOR UPDATE`,
        [callback.CheckoutRequestID]
      );

      if (result.rowCount === 0) {
        await client.query("COMMIT");

        return res.json({
          ResultCode: 0,
          ResultDesc: "Unknown subscription callback received"
        });
      }

      const subscription = result.rows[0];

      if (subscription.status === "active") {
        await client.query("COMMIT");

        return res.json({
          ResultCode: 0,
          ResultDesc: "Payment already processed"
        });
      }

      if (Number(callback.ResultCode) !== 0) {
        await client.query(
          `UPDATE subscriptions
           SET status = 'failed',
               updated_at = NOW()
           WHERE id = $1
             AND status = 'pending'`,
          [subscription.id]
        );

        await client.query("COMMIT");

        return res.json({
          ResultCode: 0,
          ResultDesc: "Payment was not completed"
        });
      }

      const items =
        callback.CallbackMetadata?.Item || [];

      const getItem = (name) => {
        const item = items.find(
          entry => entry.Name === name
        );

        return item ? item.Value : null;
      };

      
      const paidAmount = Number(getItem("Amount"));
      const receipt = String(
        getItem("MpesaReceiptNumber") || ""
      ).trim();

      let callbackPhone = "";
      let expectedPhone = "";

      try {
        callbackPhone = normalizePhone(
          getItem("PhoneNumber")
        );

        expectedPhone = normalizePhone(
          subscription.payer_phone
        );
      } catch (error) {
        console.error(
          "Invalid subscription payer phone:",
          error.message
        );
      }

      const expectedAmount = Number(subscription.amount);

      if (
        !receipt ||
        !Number.isFinite(paidAmount) ||
        paidAmount !== expectedAmount ||
        !callbackPhone ||
        !expectedPhone ||
        callbackPhone !== expectedPhone
      ) {
  
        await client.query(
          `UPDATE subscriptions
           SET status = 'failed',
               updated_at = NOW()
           WHERE id = $1
             AND status = 'pending'`,
          [subscription.id]
        );

        await client.query("COMMIT");

        return res.json({
          ResultCode: 0,
          ResultDesc: "Payment details did not match"
        });
      }
      
      // VERIFY THE PAYMENT DIRECTLY WITH SAFARICOM
      const shortcode = String(
        process.env.DARAJA_STK_SHORTCODE || ""
      ).trim();

      const passkey = String(
        process.env.DARAJA_STK_PASSKEY || ""
      ).trim();

      if (!shortcode || !passkey) {
        throw new Error(
          "STK query settings are not configured."
        );
      }

      const accessToken = await getDarajaAccessToken();

      const queryTimestamp = new Date()
        .toISOString()
        .replace(/[-T:.Z]/g, "")
        .slice(0, 14);

      const queryPassword = Buffer.from(
        shortcode + passkey + queryTimestamp
      ).toString("base64");

      const baseUrl =
        process.env.DARAJA_BASE_URL ||
        "https://sandbox.safaricom.co.ke";

      const queryResponse = await fetch(
        `${baseUrl}/mpesa/stkpushquery/v1/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            BusinessShortCode: shortcode,
            Password: queryPassword,
            Timestamp: queryTimestamp,
            CheckoutRequestID: callback.CheckoutRequestID
          })
        }
      );

      const queryData = await queryResponse.json();

      if (
        !queryResponse.ok ||
        String(queryData.ResponseCode) !== "0"
      ) {
        throw new Error(
          "Safaricom STK payment verification could not be completed."
        );
      }

              if (
        queryData.ResultCode === undefined ||
        queryData.ResultCode === null ||
        String(queryData.ResultCode).trim() === ""
      ) {
        throw new Error(
          "Safaricom has not returned a final STK payment result yet."
        );
      }

      const queryResultCode = Number(queryData.ResultCode);

      if (!Number.isFinite(queryResultCode)) {
        throw new Error(
          "Safaricom returned an invalid STK payment result."
        );
      }

      if (queryResultCode !== 0) {
        await client.query(
          `UPDATE subscriptions
           SET status = 'failed',
               updated_at = NOW()
           WHERE id = $1
             AND status = 'pending'`,
          [subscription.id]
        );

        await client.query("COMMIT");

        return res.json({
          ResultCode: 0,
          ResultDesc: "Safaricom confirmed payment was not successful"
        });
      }
      

      const expiry = await client.query(
        `UPDATE subscriptions
         SET status = 'active',
             mpesa_receipt = $1,
             paid_at = NOW(),
             expires_at =
               GREATEST(
                 COALESCE(expires_at, NOW()),
                 NOW()
               ) +
               CASE plan
                 WHEN 'daily' THEN INTERVAL '1 day'
                 WHEN 'weekly' THEN INTERVAL '7 days'
                 WHEN 'monthly' THEN INTERVAL '30 days'
               END,
             updated_at = NOW()
         WHERE id = $2
           AND status = 'pending'
         RETURNING id, reseller_id, plan, amount, expires_at`,
        [receipt, subscription.id]
      );

      if (expiry.rowCount === 0) {
        await client.query("COMMIT");

        return res.json({
          ResultCode: 0,
          ResultDesc: "Subscription already processed"
        });
      }

      await client.query("COMMIT");

      console.log(
        "Subscription payment confirmed:",
        receipt,
        "Subscription:",
        subscription.id
      );

      return res.json({
        ResultCode: 0,
        ResultDesc: "Subscription activated"
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(
        "Subscription callback error:",
        error
      );

      return res.status(500).json({
        ResultCode: 1,
        ResultDesc: "Subscription callback processing failed"
      });
    } finally {
      client.release();
    }
  }
);

// RESELLER SUBSCRIPTION STATUS
app.get(
  "/api/subscriptions/status",
  authenticateToken,
  requireReseller,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
           plan,
           amount,
           status,
           paid_at,
           expires_at,
           mpesa_receipt,
           CASE
             WHEN status = 'active'
              AND expires_at > NOW()
             THEN TRUE
             ELSE FALSE
           END AS is_active
         FROM subscriptions
         WHERE reseller_id = $1
                  ORDER BY
           CASE
             WHEN status = 'active'
              AND expires_at > NOW()
             THEN 0
             ELSE 1
           END,
           created_at DESC,
            id DESC`,
        [req.user.resellerId]
      );

      if (result.rowCount === 0) {
        return res.json({
          status: "none",
          is_active: false,
          message: "No subscription payment found."
        });
      }

      return res.json({
        status: result.rows[0].status,
        plan: result.rows[0].plan,
        amount: Number(result.rows[0].amount),
        is_active: result.rows[0].is_active,
        paid_at: result.rows[0].paid_at,
        expires_at: result.rows[0].expires_at,
        mpesa_receipt: result.rows[0].mpesa_receipt
      });
    } catch (error) {
      console.error(
        "Subscription status error:",
        error
      );

      return sendError(
        res,
        500,
        "Could not load subscription status."
      );
    }
  }
);

        
// ==============================
// SAFARICOM C2B VALIDATION
// ==============================

app.post("/api/mpesa/validation", async (req, res) => {
  try {
    console.log(
      "M-Pesa validation callback received:",
      JSON.stringify(req.body)
    );

    res.json({
      ResultCode: 0,
      ResultDesc: "Accepted"
    });
  } catch (error) {
    console.error("M-Pesa validation error:", error);

    res.status(500).json({
      ResultCode: 1,
      ResultDesc: "Validation processing failed"
    });
  }
});

// ==============================
// SAFARICOM C2B CONFIRMATION
// ==============================



app.post("/api/mpesa/confirmation", async (req, res) => {
  const client = await pool.connect();

  try {
    const body = req.body || {};

    console.log(
      "M-Pesa confirmation callback received:",
      JSON.stringify(body)
    );

    const transId = String(body.TransID || "").trim();
    const till = String(body.BusinessShortCode || "").trim();
    const amount = Number(body.TransAmount);
    const payerPhone = String(body.MSISDN || "").trim();

    await client.query("BEGIN");

    const saved = await client.query(
      `INSERT INTO mpesa_callback_events (
        trans_id,
        business_short_code,
        bill_ref_number,
        trans_amount,
        msisdn,
        first_name,
        middle_name,
        last_name,
        trans_time,
        raw_payload,
        processing_note
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10::jsonb, $11
      )
      ON CONFLICT (trans_id) DO NOTHING
      RETURNING id`,
      [
        transId || null,
        till || null,
        body.BillRefNumber || null,
        Number.isFinite(amount) ? amount : null,
        payerPhone || null,
        body.FirstName || null,
        body.MiddleName || null,
        body.LastName || null,
        body.TransTime || null,
        JSON.stringify(body),
        transId ? null : "Missing M-Pesa receipt number."
      ]
    );

    if (saved.rowCount === 0) {
      await client.query("COMMIT");
      return res.json({
        ResultCode: 0,
        ResultDesc: "Duplicate confirmation received"
      });
    }

    const callbackId = saved.rows[0].id;

    const markUnmatched = async (reason) => {
      await client.query(
        `UPDATE mpesa_callback_events
         SET processing_status = 'unmatched',
             processing_note = $1
         WHERE id = $2`,
        [reason, callbackId]
      );
    };

    if (
      !transId ||
      !till ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !payerPhone
    ) {
      await markUnmatched(
        "Missing or invalid receipt, Till, amount or payer phone."
      );
      await client.query("COMMIT");

      return res.json({
        ResultCode: 0,
        ResultDesc: "Confirmation received"
      });
    }

    let gatewayRole;
    let resellerId = null;
    let adminPhone = null;

    if (till === ADMIN_BUY_GOODS_TILL) {
      gatewayRole = "admin";
      adminPhone = String(process.env.ADMIN_PHONE || "").trim();

      if (!adminPhone) {
        await markUnmatched(
          "Admin phone is not configured."
        );
        await client.query("COMMIT");

        return res.json({
          ResultCode: 0,
          ResultDesc: "Confirmation received"
        });
      }
    } else {
      const resellerResult = await client.query(
        `SELECT id
         FROM resellers
         WHERE buy_goods_till = $1
         LIMIT 1`,
        [till]
      );

      if (resellerResult.rowCount === 0) {
        await markUnmatched("Receiving Till is not registered.");
        await client.query("COMMIT");

        return res.json({
          ResultCode: 0,
          ResultDesc: "Confirmation received"
        });
      }

      gatewayRole = "reseller";
      resellerId = resellerResult.rows[0].id;
    }

    const offersResult = await client.query(
      `SELECT *
       FROM offers
       WHERE reseller_id IS NOT DISTINCT FROM $1
         AND active = TRUE
         AND approval_status = 'approved'
         AND COALESCE(bingwa_price, price) = $2
       FOR UPDATE`,
      [resellerId, amount]
    );

    if (offersResult.rowCount === 0) {
      await markUnmatched(
        "No active offer matches this payment amount on the receiving Till."
      );
      await client.query("COMMIT");

      return res.json({
        ResultCode: 0,
        ResultDesc: "Confirmation received"
      });
    }

    if (offersResult.rowCount > 1) {
      await markUnmatched(
        "More than one active offer matches this payment amount."
      );
      await client.query("COMMIT");

      return res.json({
        ResultCode: 0,
        ResultDesc: "Confirmation received"
      });
    }

    const offer = offersResult.rows[0];

    const destinationPhone = normalizePhoneForUssd(payerPhone);
    const ussdCode = buildUssdCode(
      offer.bundle_code,
      destinationPhone
    );

    await client.query(
      `INSERT INTO delivery_jobs (
        payment_receipt,
        gateway_role,
        reseller_id,
        admin_phone,
        offer_id,
        offer_name,
        destination_phone,
        amount,
        ussd_code
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        transId,
        gatewayRole,
        resellerId,
        adminPhone,
        offer.id,
        offer.name,
        destinationPhone,
        amount,
        ussdCode
      ]
    );

    await client.query(
      `UPDATE mpesa_callback_events
       SET processing_status = 'queued',
           processing_note = 'Payment matched. Delivery job created.'
       WHERE id = $1`,
      [callbackId]
    );

    await client.query("COMMIT");

    res.json({
      ResultCode: 0,
      ResultDesc: "Payment matched and delivery queued"
    });

  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("M-Pesa rollback error:", rollbackError);
    }

    console.error("M-Pesa confirmation error:", error);

    res.status(500).json({
      ResultCode: 1,
      ResultDesc: "Confirmation processing failed"
    });
  } finally {
    client.release();
  }
});

        

// ==============================
// START SERVER
// ==============================

const PORT = process.env.PORT || 3000;

initializeDatabase()
  .then(async () => {
        await installUssdDevices(
      app,
      pool,
      authenticateToken,
      requireReseller,
      requireAdmin
    );
          await installOperations(
        app,
        pool,
        authenticateToken,
        requireAdmin,
        requireReseller
      );
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`M-Pesa Auto Bundles running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Server startup failed:", error);
    process.exit(1);
  });
