
const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const path = require("path");

const {
  installOperations,
  getSalesPaused,
  isWithinDailyWindow
} = require("./operations");

require("dotenv").config();

const app = express();
app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

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

async function lockOfferPrices(client) {
  await client.query(
    "SELECT pg_advisory_xact_lock(734921)"
  );
}

async function hasDuplicateActivePrice(
  client,
  price,
  resellerId,
  excludeId = null
) {
  const result = await client.query(
    `SELECT id
     FROM offers
     WHERE active = TRUE
       AND approval_status = 'approved'
       AND price = $1
       AND reseller_id IS NOT DISTINCT FROM $2
       AND ($3::BIGINT IS NULL OR id <> $3)
     LIMIT 1`,
    [price, resellerId, excludeId]
  );

  return result.rows.length > 0;
}

async function createCoreTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS resellers (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      phone VARCHAR(20) NOT NULL UNIQUE,
      buy_goods_till VARCHAR(30) NOT NULL UNIQUE,
      till_phone VARCHAR(20) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      sales_paused BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reseller_credentials (
      reseller_id BIGINT PRIMARY KEY
        REFERENCES resellers(id) ON DELETE CASCADE,
      password_hash TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS offers (
      id BIGSERIAL PRIMARY KEY,
      reseller_id BIGINT
        REFERENCES resellers(id) ON DELETE CASCADE,
      catalog_product_id BIGINT,
      name VARCHAR(200) NOT NULL,
      price NUMERIC(12,2) NOT NULL,
      approval_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      commission_per_sale NUMERIC(12,2) DEFAULT 0,
      bingwa_price NUMERIC(12,2),
      safaricom_price NUMERIC(12,2),
      ussd_code TEXT,
      alternative_ussd_code TEXT,
      menu_keyword TEXT,
      active_start_time TIME,
      active_end_time TIME,
      daily_start_time TIME,
      daily_end_time TIME,
      category VARCHAR(100),
      delivery_method VARCHAR(50),
      recovery_strategy TEXT,
      active BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      reseller_id BIGINT
        REFERENCES resellers(id),
      offer_id BIGINT REFERENCES offers(id),
      payment_receipt VARCHAR(100) UNIQUE,
      payer_phone VARCHAR(20),
      recipient_phone VARCHAR(20),
      amount NUMERIC(12,2) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payments (
      id BIGSERIAL PRIMARY KEY,
      receipt_number VARCHAR(100) UNIQUE NOT NULL,
      business_till VARCHAR(30),
      payer_phone VARCHAR(20),
      amount NUMERIC(12,2) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'received',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function createAdditionalTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS token_wallets (
      reseller_id BIGINT PRIMARY KEY
        REFERENCES resellers(id) ON DELETE CASCADE,
      balance BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS token_transactions (
      id BIGSERIAL PRIMARY KEY,
      reseller_id BIGINT NOT NULL
        REFERENCES resellers(id),
      amount BIGINT NOT NULL,
      transaction_type VARCHAR(30) NOT NULL,
      reference VARCHAR(150),
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id BIGSERIAL PRIMARY KEY,
      reseller_id BIGINT NOT NULL
        REFERENCES resellers(id),
      plan VARCHAR(30) NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      starts_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS airtime_ledger (
      id BIGSERIAL PRIMARY KEY,
      reseller_id BIGINT NOT NULL
        REFERENCES resellers(id),
      phone VARCHAR(20),
      amount NUMERIC(12,2) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      reference VARCHAR(150) UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS product_catalog (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      price NUMERIC(12,2),
      bingwa_price NUMERIC(12,2),
      safaricom_price NUMERIC(12,2),
      category VARCHAR(100),
      validity VARCHAR(100),
      ussd_code TEXT,
      menu_keyword TEXT,
      delivery_method VARCHAR(50),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS mpesa_callback_events (
      id BIGSERIAL PRIMARY KEY,
      trans_id VARCHAR(100) UNIQUE NOT NULL,
      business_short_code VARCHAR(30),
      trans_amount NUMERIC(12,2),
      msisdn VARCHAR(20),
      raw_payload JSONB,
      processing_status VARCHAR(30) NOT NULL DEFAULT 'received',
      processing_note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function createFulfilmentTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ussd_devices (
      id BIGSERIAL PRIMARY KEY,
      reseller_id BIGINT
        REFERENCES resellers(id) ON DELETE CASCADE,
      device_name VARCHAR(150),
      phone VARCHAR(20),
      device_token TEXT UNIQUE,
      status VARCHAR(30) NOT NULL DEFAULT 'offline',
      last_seen TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ussd_templates (
      id BIGSERIAL PRIMARY KEY,
      product_catalog_id BIGINT
        REFERENCES product_catalog(id),
      version INTEGER NOT NULL DEFAULT 1,
      ussd_code TEXT NOT NULL,
      menu_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ussd_menu_observations (
      id BIGSERIAL PRIMARY KEY,
      device_id BIGINT
        REFERENCES ussd_devices(id),
      template_id BIGINT
        REFERENCES ussd_templates(id),
      menu_text TEXT,
      observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ussd_template_change_events (
      id BIGSERIAL PRIMARY KEY,
      template_id BIGINT
        REFERENCES ussd_templates(id),
      previous_version INTEGER,
      proposed_version INTEGER,
      change_reason TEXT,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ussd_agent_jobs (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT UNIQUE
        REFERENCES orders(id) ON DELETE CASCADE,
      device_id BIGINT
        REFERENCES ussd_devices(id),
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_orders_status_created
      ON orders(status, created_at);

    CREATE INDEX IF NOT EXISTS idx_offers_reseller_active
      ON offers(reseller_id, active);

    CREATE INDEX IF NOT EXISTS idx_ussd_jobs_status_created
      ON ussd_agent_jobs(status, created_at);
  `);
        }
  
async function createAuthenticationTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id BIGSERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      phone VARCHAR(20),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS password_reset_otps (
      id BIGSERIAL PRIMARY KEY,
      account_type VARCHAR(20) NOT NULL,
      account_id BIGINT NOT NULL,
      otp_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_password_reset_lookup
      ON password_reset_otps(account_type, account_id, created_at);
  `);
}

async function runDatabaseMigrations() {
  await pool.query(`
    ALTER TABLE resellers
      ADD COLUMN IF NOT EXISTS password_reset_phone VARCHAR(20);

    ALTER TABLE offers
      ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20)
        NOT NULL DEFAULT 'pending';

    ALTER TABLE offers
      ADD COLUMN IF NOT EXISTS active BOOLEAN
        NOT NULL DEFAULT FALSE;

    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
        NOT NULL DEFAULT NOW();

    ALTER TABLE payments
      ADD COLUMN IF NOT EXISTS business_till VARCHAR(30);

    ALTER TABLE payments
      ADD COLUMN IF NOT EXISTS payer_phone VARCHAR(20);
  `);
}

async function initializeDatabase() {
  await createCoreTables();
  await createAdditionalTables();
  await createFulfilmentTables();
  await createAuthenticationTables();
  await runDatabaseMigrations();

  console.log("Database tables and migrations are ready.");
}

async function authenticateToken(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const parts = header.split(" ");

    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return sendError(res, 401, "Authentication required.");
    }

    if (!process.env.JWT_SECRET) {
      return sendError(
        res,
        500,
        "Authentication security is not configured."
      );
    }

    const decoded = jwt.verify(
      parts[1],
      process.env.JWT_SECRET
    );

    if (
      !decoded ||
      !["admin", "reseller"].includes(decoded.role)
    ) {
      return sendError(res, 401, "Invalid login session.");
    }

    req.user = decoded;
    next();
  } catch (error) {
    return sendError(res, 401, "Your login session is invalid or expired.");
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return sendError(res, 403, "Administrator access required.");
  }

  next();
}

function requireReseller(req, res, next) {
  if (!req.user || req.user.role !== "reseller") {
    return sendError(res, 403, "Reseller access required.");
  }

  next();
}

function requireAdminOrReseller(req, res, next) {
  if (
    !req.user ||
    !["admin", "reseller"].includes(req.user.role)
  ) {
    return sendError(res, 403, "Access denied.");
  }

  next();
}

function getAccountId(req) {
  if (req.user.role === "admin") {
    return req.user.adminId;
  }

  return req.user.resellerId;
}

async function getAdminByEmail(email) {
  const result = await pool.query(
    `SELECT id, email, password_hash, phone
     FROM admin_users
     WHERE LOWER(email) = LOWER($1)
     LIMIT 1`,
    [String(email || "").trim()]
  );

  return result.rows[0] || null;
}

async function getResellerByEmail(email) {
  const result = await pool.query(
    `SELECT
       r.id,
       r.name,
       r.email,
       r.phone,
       r.status,
       c.password_hash
     FROM resellers r
     JOIN reseller_credentials c
       ON c.reseller_id = r.id
     WHERE LOWER(r.email) = LOWER($1)
     LIMIT 1`,
    [String(email || "").trim()]
  );

  return result.rows[0] || null;
}

async function createAdminFromEnvironment() {
  const email = String(process.env.ADMIN_EMAIL || "").trim();
  const password = String(process.env.ADMIN_PASSWORD || "");

  if (!email || !password) {
    console.log(
      "Admin bootstrap skipped: ADMIN_EMAIL or ADMIN_PASSWORD is not configured."
    );
    return;
  }

  const existing = await getAdminByEmail(email);

  if (existing) {
    console.log("Existing database administrator found.");
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await pool.query(
    `INSERT INTO admin_users (email, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING`,
    [email, passwordHash]
  );

  console.log("Initial administrator account created.");
}

const loginAttempts = new Map();

function checkLoginRateLimit(key) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const maximumAttempts = 10;

  let record = loginAttempts.get(key);

  if (!record || now - record.startedAt > windowMs) {
    record = {
      startedAt: now,
      count: 0
    };
  }

  if (record.count >= maximumAttempts) {
    loginAttempts.set(key, record);
    return false;
  }

  record.count += 1;
  loginAttempts.set(key, record);
  return true;
}

function clearLoginRateLimit(key) {
  loginAttempts.delete(key);
}

async function loginAccount(req, res, accountType) {
  const email = String(req.body.email || "")
    .trim()
    .toLowerCase();

  const password = String(req.body.password || "");
  const ip = String(req.ip || "unknown");
  const rateKey = accountType + ":" + ip + ":" + email;

  if (!checkLoginRateLimit(rateKey)) {
    return sendError(
      res,
      429,
      "Too many login attempts. Please try again later."
    );
  }

  if (!email || !password) {
    return sendError(
      res,
      400,
      "Enter your email address and password."
    );
  }

  try {
    let account;

    if (accountType === "admin") {
      account = await getAdminByEmail(email);
    } else {
      account = await getResellerByEmail(email);
    }

    if (!account) {
      return sendError(
        res,
        401,
        "Invalid email or password."
      );
    }

    if (
      accountType === "reseller" &&
      account.status !== "active"
    ) {
      return sendError(
        res,
        403,
        "Your reseller account is not active."
      );
    }

    const validPassword = await bcrypt.compare(
      password,
      account.password_hash
    );

    if (!validPassword) {
      return sendError(
        res,
        401,
        "Invalid email or password."
      );
    }

    clearLoginRateLimit(rateKey);

    const payload =
      accountType === "admin"
        ? {
            role: "admin",
            adminId: account.id,
            email: account.email
          }
        : {
            role: "reseller",
            resellerId: account.id,
            email: account.email,
            name: account.name
          };

    const token = createToken(payload);

    return res.json({
      status: "SUCCESS",
      message: "Login successful.",
      token,
      user: payload
    });
  } catch (error) {
    console.error("Login error:", error.message);

    return sendError(
      res,
      500,
      "Unable to complete login."
    );
  }
}

app.post("/api/admin/login", async (req, res) => {
  return loginAccount(req, res, "admin");
});

app.post("/api/reseller/login", async (req, res) => {
  return loginAccount(req, res, "reseller");
});

app.get(
  "/api/admin/me",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, email, phone, created_at
         FROM admin_users
         WHERE id = $1
         LIMIT 1`,
        [req.user.adminId]
      );

      if (!result.rows.length) {
        return sendError(res, 404, "Admin account not found.");
      }

      return res.json({
        status: "SUCCESS",
        user: result.rows[0]
      });
    } catch (error) {
      console.error("Admin profile error:", error.message);
      return sendError(res, 500, "Unable to load admin profile.");
    }
  }
);

app.get(
  "/api/reseller/me",
  authenticateToken,
  requireReseller,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
           id,
           name,
           email,
           phone,
           buy_goods_till,
           till_phone,
           status,
           created_at
         FROM resellers
         WHERE id = $1
         LIMIT 1`,
        [req.user.resellerId]
      );

      if (!result.rows.length) {
        return sendError(res, 404, "Reseller account not found.");
      }

      return res.json({
        status: "SUCCESS",
        user: result.rows[0]
      });
    } catch (error) {
      console.error("Reseller profile error:", error.message);
      return sendError(res, 500, "Unable to load reseller profile.");
    }
  }
);

app.post(
  "/api/logout",
  authenticateToken,
  (req, res) => {
    return res.json({
      status: "SUCCESS",
      message: "Logged out. Remove the saved token from this device."
    });
  }
);

app.post(
  "/api/admin/resellers",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const till = String(req.body.buy_goods_till || "").trim();
    const tillPhoneInput = req.body.till_phone;
    const phoneInput = req.body.phone;

    if (!name || !email || !password || !till || !phoneInput || !tillPhoneInput) {
      return sendError(
        res,
        400,
        "Complete all reseller registration fields."
      );
    }

    if (password.length < 8) {
      return sendError(
        res,
        400,
        "The password must contain at least 8 characters."
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendError(res, 400, "Enter a valid email address.");
    }

    let phone;
    let tillPhone;

    try {
      phone = normalizePhone(phoneInput);
      tillPhone = normalizePhone(tillPhoneInput);
    } catch (error) {
      return sendError(res, 400, error.message);
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existing = await client.query(
        `SELECT id
         FROM resellers
         WHERE LOWER(email) = LOWER($1)
            OR phone = $2
            OR buy_goods_till = $3
         LIMIT 1`,
        [email, phone, till]
      );

      if (existing.rows.length) {
        await client.query("ROLLBACK");
        return sendError(
          res,
          409,
          "A reseller with these details already exists."
        );
      }

      const resellerResult = await client.query(
        `INSERT INTO resellers
          (name, email, phone, buy_goods_till, till_phone, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         RETURNING id, name, email, phone,
                   buy_goods_till, till_phone, status, created_at`,
        [name, email, phone, till, tillPhone]
      );

      const reseller = resellerResult.rows[0];
      const passwordHash = await bcrypt.hash(password, 12);

      await client.query(
        `INSERT INTO reseller_credentials
          (reseller_id, password_hash)
         VALUES ($1, $2)`,
        [reseller.id, passwordHash]
      );

      await client.query(
        `INSERT INTO token_wallets (reseller_id, balance)
         VALUES ($1, 0)
         ON CONFLICT (reseller_id) DO NOTHING`,
        [reseller.id]
      );

      await client.query("COMMIT");

      return res.status(201).json({
        status: "SUCCESS",
        message: "Reseller created and awaiting approval.",
        reseller
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Create reseller error:", error.message);

      return sendError(
        res,
        500,
        "Unable to create reseller account."
      );
    } finally {
      client.release();
    }
  }
);

app.get(
  "/api/admin/resellers",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
           r.id,
           r.name,
           r.email,
           r.phone,
           r.buy_goods_till,
           r.till_phone,
           r.status,
           r.sales_paused,
           r.created_at,
           COALESCE(w.balance, 0) AS token_balance
         FROM resellers r
         LEFT JOIN token_wallets w
           ON w.reseller_id = r.id
         ORDER BY r.created_at DESC`
      );

      return res.json({
        status: "SUCCESS",
        resellers: result.rows
      });
    } catch (error) {
      console.error("List resellers error:", error.message);
      return sendError(res, 500, "Unable to load resellers.");
    }
  }
);

app.patch(
  "/api/admin/resellers/:id/status",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const resellerId = Number(req.params.id);
    const status = String(req.body.status || "").toLowerCase();

    if (!Number.isSafeInteger(resellerId) || resellerId < 1) {
      return sendError(res, 400, "Invalid reseller ID.");
    }

    if (!["active", "pending", "suspended"].includes(status)) {
      return sendError(res, 400, "Invalid reseller status.");
    }

    try {
      const result = await pool.query(
        `UPDATE resellers
         SET status = $1
         WHERE id = $2
         RETURNING id, name, email, status`,
        [status, resellerId]
      );

      if (!result.rows.length) {
        return sendError(res, 404, "Reseller not found.");
      }

      return res.json({
        status: "SUCCESS",
        message: "Reseller status updated.",
        reseller: result.rows[0]
      });
    } catch (error) {
      console.error("Update reseller status error:", error.message);
      return sendError(
        res,
        500,
        "Unable to update reseller status."
      );
    }
  }
);

app.patch(
  "/api/reseller/profile",
  authenticateToken,
  requireReseller,
  async (req, res) => {
    const name = String(req.body.name || "").trim();
    const phoneInput = req.body.phone;

    if (!name || !phoneInput) {
      return sendError(
        res,
        400,
        "Enter your name and phone number."
      );
    }

    let phone;

    try {
      phone = normalizePhone(phoneInput);
    } catch (error) {
      return sendError(res, 400, error.message);
    }

    try {
      const result = await pool.query(
        `UPDATE resellers
         SET name = $1, phone = $2
         WHERE id = $3
         RETURNING id, name, email, phone,
                   buy_goods_till, till_phone, status`,
        [name, phone, req.user.resellerId]
      );

      if (!result.rows.length) {
        return sendError(res, 404, "Reseller account not found.");
      }

      return res.json({
        status: "SUCCESS",
        message: "Profile updated.",
        user: result.rows[0]
      });
    } catch (error) {
      console.error("Reseller profile update error:", error.message);

      if (error.code === "23505") {
        return sendError(
          res,
          409,
          "That phone number is already registered."
        );
      }

      return sendError(res, 500, "Unable to update profile.");
    }
  }
);
         
async function getCatalogProduct(productId) {
  const result = await pool.query(
    `SELECT
       id,
       name,
       price,
       bingwa_price,
       safaricom_price,
       category,
       validity,
       ussd_code,
       menu_keyword,
       delivery_method,
       active
     FROM product_catalog
     WHERE id = $1
     LIMIT 1`,
    [productId]
  );

  return result.rows[0] || null;
}

function validateOfferPrice(value) {
  const price = Number(value);

  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }

  return Math.round(price * 100) / 100;
}

app.get(
  "/api/catalog",
  authenticateToken,
  requireAdminOrReseller,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
           id,
           name,
           price,
           bingwa_price,
           safaricom_price,
           category,
           validity,
           delivery_method,
           active
         FROM product_catalog
         WHERE active = TRUE
         ORDER BY category, name`
      );

      return res.json({
        status: "SUCCESS",
        catalog: result.rows
      });
    } catch (error) {
      console.error("Catalogue error:", error.message);
      return sendError(res, 500, "Unable to load product catalogue.");
    }
  }
);

app.post(
  "/api/admin/catalog",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const name = String(req.body.name || "").trim();
    const category = String(req.body.category || "").trim();
    const validity = String(req.body.validity || "").trim();
    const deliveryMethod = String(
      req.body.delivery_method || ""
    ).trim();
    const ussdCode = String(req.body.ussd_code || "").trim();
    const menuKeyword = String(req.body.menu_keyword || "").trim();

    const price = validateOfferPrice(req.body.price);
    const bingwaPrice =
      req.body.bingwa_price == null
        ? null
        : validateOfferPrice(req.body.bingwa_price);
    const safaricomPrice =
      req.body.safaricom_price == null
        ? null
        : validateOfferPrice(req.body.safaricom_price);

    if (
      !name ||
      !category ||
      !validity ||
      !deliveryMethod ||
      !price
    ) {
      return sendError(
        res,
        400,
        "Enter the product name, category, validity, delivery method and valid price."
      );
    }

    if (!["ussd", "api", "manual"].includes(deliveryMethod)) {
      return sendError(
        res,
        400,
        "Delivery method must be ussd, api or manual."
      );
    }

    if (deliveryMethod === "ussd" && !ussdCode) {
      return sendError(
        res,
        400,
        "A USSD code is required for USSD delivery."
      );
    }

    if (
      (req.body.bingwa_price != null && !bingwaPrice) ||
      (req.body.safaricom_price != null && !safaricomPrice)
    ) {
      return sendError(res, 400, "Enter valid supplier prices.");
    }

    try {
      const result = await pool.query(
        `INSERT INTO product_catalog
          (
            name,
            price,
            bingwa_price,
            safaricom_price,
            category,
            validity,
            ussd_code,
            menu_keyword,
            delivery_method,
            active
          )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)
         RETURNING *`,
        [
          name,
          price,
          bingwaPrice,
          safaricomPrice,
          category,
          validity,
          ussdCode || null,
          menuKeyword || null,
          deliveryMethod
        ]
      );

      return res.status(201).json({
        status: "SUCCESS",
        message: "Catalogue product created.",
        product: result.rows[0]
      });
    } catch (error) {
      console.error("Create catalogue product error:", error.message);
      return sendError(
        res,
        500,
        "Unable to create catalogue product."
      );
    }
  }
);

app.patch(
  "/api/admin/catalog/:id",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const productId = Number(req.params.id);

    if (!Number.isSafeInteger(productId) || productId < 1) {
      return sendError(res, 400, "Invalid product ID.");
    }

    const fields = {
      name: "name",
      price: "price",
      bingwa_price: "bingwa_price",
      safaricom_price: "safaricom_price",
      category: "category",
      validity: "validity",
      ussd_code: "ussd_code",
      menu_keyword: "menu_keyword",
      delivery_method: "delivery_method",
      active: "active"
    };

    const updates = [];
    const values = [];
    let position = 1;

    for (const [field, column] of Object.entries(fields)) {
      if (req.body[field] === undefined) {
        continue;
      }

      let value = req.body[field];

      if (
        ["price", "bingwa_price", "safaricom_price"].includes(field) &&
        value !== null
      ) {
        value = validateOfferPrice(value);

        if (!value) {
          return sendError(res, 400, "Invalid product price.");
        }
      }

      if (field === "active" && typeof value !== "boolean") {
        return sendError(res, 400, "Active must be true or false.");
      }

      if (typeof value === "string") {
        value = value.trim();
      }

      updates.push(`${column} = $${position++}`);
      values.push(value);
    }

    if (!updates.length) {
      return sendError(res, 400, "No valid changes supplied.");
    }

    values.push(productId);

    try {
      const result = await pool.query(
        `UPDATE product_catalog
         SET ${updates.join(", ")}
         WHERE id = $${position}
         RETURNING *`,
        values
      );

      if (!result.rows.length) {
        return sendError(res, 404, "Catalogue product not found.");
      }

      return res.json({
        status: "SUCCESS",
        message: "Catalogue product updated.",
        product: result.rows[0]
      });
    } catch (error) {
      console.error("Update catalogue error:", error.message);
      return sendError(
        res,
        500,
        "Unable to update catalogue product."
      );
    }
  }
);

app.get(
  "/api/offers",
  authenticateToken,
  requireAdminOrReseller,
  async (req, res) => {
    try {
      let result;

      if (req.user.role === "admin") {
        result = await pool.query(
          `SELECT
             o.*,
             r.name AS reseller_name,
             p.validity,
             p.category AS catalog_category
           FROM offers o
           LEFT JOIN resellers r
             ON r.id = o.reseller_id
           LEFT JOIN product_catalog p
             ON p.id = o.catalog_product_id
           ORDER BY o.created_at DESC`
        );
      } else {
        result = await pool.query(
          `SELECT
             o.*,
             p.validity,
             p.category AS catalog_category
           FROM offers o
           LEFT JOIN product_catalog p
             ON p.id = o.catalog_product_id
           WHERE
             (
               o.reseller_id = $1
               OR (
                 o.reseller_id IS NULL
                 AND o.approval_status = 'approved'
                 AND o.active = TRUE
               )
             )
           ORDER BY o.created_at DESC`,
          [req.user.resellerId]
        );
      }

      return res.json({
        status: "SUCCESS",
        offers: result.rows
      });
    } catch (error) {
      console.error("Load offers error:", error.message);
      return sendError(res, 500, "Unable to load offers.");
    }
  }
);

app.post(
  "/api/offers",
  authenticateToken,
  requireAdminOrReseller,
  async (req, res) => {
    const productId = Number(req.body.catalog_product_id);
    const price = validateOfferPrice(req.body.price);

    if (
      !Number.isSafeInteger(productId) ||
      productId < 1 ||
      !price
    ) {
      return sendError(
        res,
        400,
        "Select a catalogue product and enter a valid selling price."
      );
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const productResult = await client.query(
        `SELECT *
         FROM product_catalog
         WHERE id = $1 AND active = TRUE
         FOR SHARE`,
        [productId]
      );

      if (!productResult.rows.length) {
        await client.query("ROLLBACK");
        return sendError(
          res,
          400,
          "The selected catalogue product is not active."
        );
      }

      const product = productResult.rows[0];

      if (
        !product.delivery_method ||
        (
          product.delivery_method === "ussd" &&
          !product.ussd_code
        )
      ) {
        await client.query("ROLLBACK");
        return sendError(
          res,
          400,
          "This product does not have a complete delivery configuration."
        );
      }

      const resellerId =
        req.user.role === "reseller"
          ? req.user.resellerId
          : null;

            const approvalStatus = "approved";
      const active = false;

      const result = await client.query(
        `INSERT INTO offers
          (
            reseller_id,
            catalog_product_id,
            name,
            price,
            approval_status,
            ussd_code,
            menu_keyword,
            category,
            delivery_method,
            active
          )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          resellerId,
          product.id,
          product.name,
          price,
          approvalStatus,
          product.ussd_code,
          product.menu_keyword,
          product.category,
          product.delivery_method,
          active
        ]
      );

      await client.query("COMMIT");

      return res.status(201).json({
        status: "SUCCESS",
                message:
          req.user.role === "reseller"
            ? "Your offer was created. Activate it when ready."
            : "Admin offer created. Activate it when ready.",
        offer: result.rows[0]
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Create offer error:", error.message);

      return sendError(res, 500, "Unable to create offer.");
    } finally {
      client.release();
    }
  }
);
         
app.patch(
  "/api/admin/offers/:id/approval",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const offerId = Number(req.params.id);
    const approvalStatus = String(
      req.body.approval_status || req.body.status || ""
    ).toLowerCase();

    if (!Number.isSafeInteger(offerId) || offerId < 1) {
      return sendError(res, 400, "Invalid offer ID.");
    }

    if (!["approved", "rejected", "pending"].includes(approvalStatus)) {
      return sendError(res, 400, "Invalid approval status.");
    }

    try {
      const result = await pool.query(
        `UPDATE offers
         SET approval_status = $1,
             active = CASE
               WHEN $1 = 'approved' THEN active
               ELSE FALSE
             END
         WHERE id = $2
         RETURNING *`,
        [approvalStatus, offerId]
      );

      if (!result.rows.length) {
        return sendError(res, 404, "Offer not found.");
      }

      return res.json({
        status: "SUCCESS",
        message: "Offer approval status updated.",
        offer: result.rows[0]
      });
    } catch (error) {
      console.error("Offer approval error:", error.message);
      return sendError(res, 500, "Unable to update offer approval.");
    }
  }
);

app.patch(
  "/api/admin/offers/:id",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const offerId = Number(req.params.id);

    if (!Number.isSafeInteger(offerId) || offerId < 1) {
      return sendError(res, 400, "Invalid offer ID.");
    }

    const updates = [];
    const values = [];
    let position = 1;

    if (req.body.name !== undefined) {
      const name = String(req.body.name || "").trim();

      if (!name) {
        return sendError(res, 400, "Offer name cannot be empty.");
      }

      updates.push(`name = $${position++}`);
      values.push(name);
    }

    if (req.body.price !== undefined) {
      const price = validateOfferPrice(req.body.price);

      if (!price) {
        return sendError(res, 400, "Enter a valid offer price.");
      }

      updates.push(`price = $${position++}`);
      values.push(price);
    }

    if (req.body.commission_per_sale !== undefined) {
      const commission = Number(req.body.commission_per_sale);

      if (!Number.isFinite(commission) || commission < 0) {
        return sendError(res, 400, "Invalid commission amount.");
      }

      updates.push(`commission_per_sale = $${position++}`);
      values.push(Math.round(commission * 100) / 100);
    }

    if (!updates.length) {
      return sendError(res, 400, "No supported changes supplied.");
    }

    values.push(offerId);

    try {
      const result = await pool.query(
        `UPDATE offers
         SET ${updates.join(", ")}
         WHERE id = $${position}
         RETURNING *`,
        values
      );

      if (!result.rows.length) {
        return sendError(res, 404, "Offer not found.");
      }

      return res.json({
        status: "SUCCESS",
        message: "Offer updated.",
        offer: result.rows[0]
      });
    } catch (error) {
      console.error("Admin offer update error:", error.message);
      return sendError(res, 500, "Unable to update offer.");
    }
  }
);

app.patch(
  "/api/admin/offers/:id/active",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const offerId = Number(req.params.id);

    if (!Number.isSafeInteger(offerId) || offerId < 1) {
      return sendError(res, 400, "Invalid offer ID.");
    }

    if (typeof req.body.active !== "boolean") {
      return sendError(res, 400, "Active must be true or false.");
    }

    try {
      const result = await pool.query(
        `UPDATE offers o
         SET active = $1
         WHERE o.id = $2
           AND (
             $1 = FALSE
             OR (
               o.approval_status = 'approved'
               AND EXISTS (
                 SELECT 1
                 FROM product_catalog p
                 WHERE p.id = o.catalog_product_id
                   AND p.active = TRUE
                   AND p.delivery_method IS NOT NULL
                   AND (
                     p.delivery_method <> 'ussd'
                     OR NULLIF(p.ussd_code, '') IS NOT NULL
                   )
               )
             )
           )
         RETURNING *`,
        [req.body.active, offerId]
      );

      if (!result.rows.length) {
        return sendError(
          res,
          400,
          "Offer not found, not approved, or missing an active delivery configuration."
        );
      }

      return res.json({
        status: "SUCCESS",
        message: req.body.active
          ? "Offer activated."
          : "Offer deactivated.",
        offer: result.rows[0]
      });
    } catch (error) {
      console.error("Offer activation error:", error.message);
      return sendError(res, 500, "Unable to change offer activation.");
    }
  }
);

app.patch(
  "/api/reseller/offers/:id",
  authenticateToken,
  requireReseller,
  async (req, res) => {
    const offerId = Number(req.params.id);

    if (!Number.isSafeInteger(offerId) || offerId < 1) {
      return sendError(res, 400, "Invalid offer ID.");
    }

    const updates = [];
    const values = [];
    let position = 1;

    if (req.body.name !== undefined) {
      const name = String(req.body.name || "").trim();

      if (!name) {
        return sendError(res, 400, "Offer name cannot be empty.");
      }

      updates.push(`name = $${position++}`);
      values.push(name);
    }

    if (req.body.price !== undefined) {
      const price = validateOfferPrice(req.body.price);

      if (!price) {
        return sendError(res, 400, "Enter a valid offer price.");
      }

      updates.push(`price = $${position++}`);
      values.push(price);
    }
    if (req.body.bingwa_price !== undefined) {
      const bingwaPrice = validateOfferPrice(req.body.bingwa_price);

      if (!bingwaPrice) {
        return sendError(res, 400, "Enter a valid Bingwa price.");
      }

      updates.push(`bingwa_price = $${position++}`);
      values.push(bingwaPrice);
        }
    if (!updates.length) {
      return sendError(res, 400, "No supported changes supplied.");
    }

    
    values.push(offerId, req.user.resellerId);

    try {
      const result = await pool.query(
        `UPDATE offers
         SET ${updates.join(", ")}
         WHERE id = $${position}
           AND reseller_id = $${position + 1}
         RETURNING *`,
        values
      );

      if (!result.rows.length) {
        return sendError(
          res,
          404,
          "Your offer was not found."
        );
      }

      return res.json({
        status: "SUCCESS",
        message: "Your offer was updated successfully.",
        offer: result.rows[0]
      });
    } catch (error) {
      console.error("Reseller offer update error:", error.message);
      return sendError(res, 500, "Unable to update your offer.");
    }
  }
);

app.patch(
  "/api/reseller/offers/:id/active",
  authenticateToken,
  requireReseller,
  async (req, res) => {
    const offerId = Number(req.params.id);

    if (!Number.isSafeInteger(offerId) || offerId < 1) {
      return sendError(res, 400, "Invalid offer ID.");
    }

    if (typeof req.body.active !== "boolean") {
      return sendError(res, 400, "Active must be true or false.");
    }

    try {
      const result = await pool.query(
        `UPDATE offers o
         SET active = $1
         WHERE o.id = $2
           AND o.reseller_id = $3
           AND (
             $1 = FALSE
             OR (
               o.approval_status = 'approved'
               AND EXISTS (
                 SELECT 1
                 FROM product_catalog p
                 WHERE p.id = o.catalog_product_id
                   AND p.active = TRUE
                   AND p.delivery_method IS NOT NULL
                   AND (
                     p.delivery_method <> 'ussd'
                     OR NULLIF(p.ussd_code, '') IS NOT NULL
                   )
               )
             )
           )
         RETURNING *`,
        [
          req.body.active,
          offerId,
          req.user.resellerId
        ]
      );

      if (!result.rows.length) {
        return sendError(
          res,
          400,
          "Your offer was not found, approved, or ready for delivery."
        );
      }

      return res.json({
        status: "SUCCESS",
        message: req.body.active
          ? "Your offer is active."
          : "Your offer is inactive.",
        offer: result.rows[0]
      });
    } catch (error) {
      console.error("Reseller offer activation error:", error.message);
      return sendError(res, 500, "Unable to change your offer.");
    }
  }
);

app.patch(
  "/api/reseller/sales-status",
  authenticateToken,
  requireReseller,
  async (req, res) => {
    if (typeof req.body.paused !== "boolean") {
      return sendError(res, 400, "Paused must be true or false.");
    }

    try {
      const result = await pool.query(
        `UPDATE resellers
         SET sales_paused = $1
         WHERE id = $2
         RETURNING id, sales_paused`,
        [req.body.paused, req.user.resellerId]
      );

      if (!result.rows.length) {
        return sendError(res, 404, "Reseller account not found.");
      }

      return res.json({
        status: "SUCCESS",
        message: req.body.paused
          ? "Your sales are paused."
          : "Your sales are resumed.",
        sales_paused: result.rows[0].sales_paused
      });
    } catch (error) {
      console.error("Reseller sales pause error:", error.message);
      return sendError(res, 500, "Unable to update sales status.");
    }
  }
);

app.patch(
  "/api/admin/offers/:id/approval",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const offerId = Number(req.params.id);
    const approvalStatus = String(
      req.body.approval_status || req.body.status || ""
    ).toLowerCase();

    if (!Number.isSafeInteger(offerId) || offerId < 1) {
      return sendError(res, 400, "Invalid offer ID.");
    }

    if (!["approved", "rejected", "pending"].includes(approvalStatus)) {
      return sendError(res, 400, "Invalid approval status.");
    }

    try {
      const result = await pool.query(
        `UPDATE offers
         SET approval_status = $1,
             active = CASE
               WHEN $1 = 'approved' THEN active
               ELSE FALSE
             END
         WHERE id = $2
         RETURNING *`,
        [approvalStatus, offerId]
      );

      if (!result.rows.length) {
        return sendError(res, 404, "Offer not found.");
      }

      return res.json({
        status: "SUCCESS",
        message: "Offer approval status updated.",
        offer: result.rows[0]
      });
    } catch (error) {
      console.error("Offer approval error:", error.message);
      return sendError(res, 500, "Unable to update offer approval.");
    }
  }
);

app.patch(
  "/api/admin/offers/:id",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const offerId = Number(req.params.id);

    if (!Number.isSafeInteger(offerId) || offerId < 1) {
      return sendError(res, 400, "Invalid offer ID.");
    }

    const updates = [];
    const values = [];
    let position = 1;

    if (req.body.name !== undefined) {
      const name = String(req.body.name || "").trim();

      if (!name) {
        return sendError(res, 400, "Offer name cannot be empty.");
      }

      updates.push(`name = $${position++}`);
      values.push(name);
    }

    if (req.body.price !== undefined) {
      const price = validateOfferPrice(req.body.price);

      if (!price) {
        return sendError(res, 400, "Enter a valid offer price.");
      }

      updates.push(`price = $${position++}`);
      values.push(price);
    }

    if (req.body.commission_per_sale !== undefined) {
      const commission = Number(req.body.commission_per_sale);

      if (!Number.isFinite(commission) || commission < 0) {
        return sendError(res, 400, "Invalid commission amount.");
      }

      updates.push(`commission_per_sale = $${position++}`);
      values.push(Math.round(commission * 100) / 100);
    }

    if (!updates.length) {
      return sendError(res, 400, "No supported changes supplied.");
    }

    values.push(offerId);

    try {
      const result = await pool.query(
        `UPDATE offers
         SET ${updates.join(", ")}
         WHERE id = $${position}
         RETURNING *`,
        values
      );

      if (!result.rows.length) {
        return sendError(res, 404, "Offer not found.");
      }

      return res.json({
        status: "SUCCESS",
        message: "Offer updated.",
        offer: result.rows[0]
      });
    } catch (error) {
      console.error("Admin offer update error:", error.message);
      return sendError(res, 500, "Unable to update offer.");
    }
  }
);

app.patch(
  "/api/admin/offers/:id/active",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const offerId = Number(req.params.id);

    if (!Number.isSafeInteger(offerId) || offerId < 1) {
      return sendError(res, 400, "Invalid offer ID.");
    }

    if (typeof req.body.active !== "boolean") {
      return sendError(res, 400, "Active must be true or false.");
    }

    try {
      const result = await pool.query(
        `UPDATE offers o
         SET active = $1
         WHERE o.id = $2
           AND (
             $1 = FALSE
             OR (
               o.approval_status = 'approved'
               AND EXISTS (
                 SELECT 1
                 FROM product_catalog p
                 WHERE p.id = o.catalog_product_id
                   AND p.active = TRUE
                   AND p.delivery_method IS NOT NULL
                   AND (
                     p.delivery_method <> 'ussd'
                     OR NULLIF(p.ussd_code, '') IS NOT NULL
                   )
               )
             )
           )
         RETURNING *`,
        [req.body.active, offerId]
      );

      if (!result.rows.length) {
        return sendError(
          res,
          400,
          "Offer not found, not approved, or missing an active delivery configuration."
        );
      }

      return res.json({
        status: "SUCCESS",
        message: req.body.active
          ? "Offer activated."
          : "Offer deactivated.",
        offer: result.rows[0]
      });
    } catch (error) {
      console.error("Offer activation error:", error.message);
      return sendError(res, 500, "Unable to change offer activation.");
    }
  }
);

app.patch(
  "/api/reseller/offers/:id",
  authenticateToken,
  requireReseller,
  async (req, res) => {
    const offerId = Number(req.params.id);

    if (!Number.isSafeInteger(offerId) || offerId < 1) {
      return sendError(res, 400, "Invalid offer ID.");
    }

    const updates = [];
    const values = [];
    let position = 1;

    if (req.body.name !== undefined) {
      const name = String(req.body.name || "").trim();

      if (!name) {
        return sendError(res, 400, "Offer name cannot be empty.");
      }

      updates.push(`name = $${position++}`);
      values.push(name);
    }

    if (req.body.price !== undefined) {
      const price = validateOfferPrice(req.body.price);

      if (!price) {
        return sendError(res, 400, "Enter a valid offer price.");
      }

      updates.push(`price = $${position++}`);
      values.push(price);
    }

    if (!updates.length) {
      return sendError(res, 400, "No supported changes supplied.");
    }

    updates.push("approval_status = 'pending'");
    updates.push("active = FALSE");

    values.push(offerId, req.user.resellerId);

    try {
      const result = await pool.query(
        `UPDATE offers
         SET ${updates.join(", ")}
         WHERE id = $${position}
           AND reseller_id = $${position + 1}
         RETURNING *`,
        values
      );

      if (!result.rows.length) {
        return sendError(
          res,
          404,
          "Your offer was not found."
        );
      }

      return res.json({
        status: "SUCCESS",
        message: "Offer updated and submitted for approval.",
        offer: result.rows[0]
      });
    } catch (error) {
      console.error("Reseller offer update error:", error.message);
      return sendError(res, 500, "Unable to update your offer.");
    }
  }
);

app.patch(
  "/api/reseller/offers/:id/active",
  authenticateToken,
  requireReseller,
  async (req, res) => {
    const offerId = Number(req.params.id);

    if (!Number.isSafeInteger(offerId) || offerId < 1) {
      return sendError(res, 400, "Invalid offer ID.");
    }

    if (typeof req.body.active !== "boolean") {
      return sendError(res, 400, "Active must be true or false.");
    }

    try {
      const result = await pool.query(
        `UPDATE offers o
         SET active = $1
         WHERE o.id = $2
           AND o.reseller_id = $3
           AND (
             $1 = FALSE
             OR (
               o.approval_status = 'approved'
               AND EXISTS (
                 SELECT 1
                 FROM product_catalog p
                 WHERE p.id = o.catalog_product_id
                   AND p.active = TRUE
                   AND p.delivery_method IS NOT NULL
                   AND (
                     p.delivery_method <> 'ussd'
                     OR NULLIF(p.ussd_code, '') IS NOT NULL
                   )
               )
             )
           )
         RETURNING *`,
        [
          req.body.active,
          offerId,
          req.user.resellerId
        ]
      );

      if (!result.rows.length) {
        return sendError(
          res,
          400,
          "Your offer was not found, approved, or ready for delivery."
        );
      }

      return res.json({
        status: "SUCCESS",
        message: req.body.active
          ? "Your offer is active."
          : "Your offer is inactive.",
        offer: result.rows[0]
      });
    } catch (error) {
      console.error("Reseller offer activation error:", error.message);
      return sendError(res, 500, "Unable to change your offer.");
    }
  }
);

app.patch(
  "/api/reseller/sales-status",
  authenticateToken,
  requireReseller,
  async (req, res) => {
    if (typeof req.body.paused !== "boolean") {
      return sendError(res, 400, "Paused must be true or false.");
    }

    try {
      const result = await pool.query(
        `UPDATE resellers
         SET sales_paused = $1
         WHERE id = $2
         RETURNING id, sales_paused`,
        [req.body.paused, req.user.resellerId]
      );

      if (!result.rows.length) {
        return sendError(res, 404, "Reseller account not found.");
      }

      return res.json({
        status: "SUCCESS",
        message: req.body.paused
          ? "Your sales are paused."
          : "Your sales are resumed.",
        sales_paused: result.rows[0].sales_paused
      });
    } catch (error) {
      console.error("Reseller sales pause error:", error.message);
      return sendError(res, 500, "Unable to update sales status.");
    }
  }
);
async function startServer() {
  try {
    await initializeDatabase();

    await installOperations(
      app,
      pool,
      authenticateToken,
      requireAdmin,
      requireReseller
    );

    const PORT = Number(process.env.PORT) || 3000;

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`M-Pesa Auto Bundles backend running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Backend startup failed:", error);
    process.exit(1);
  }
}

startServer();
