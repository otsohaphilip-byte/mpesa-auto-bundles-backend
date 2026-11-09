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
async function initializeDatabase() {
  await createCoreTables();
  await createAdditionalTables();
  await createFulfilmentTables();

  await pool.query(`
    ALTER TABLE resellers
      ADD COLUMN IF NOT EXISTS sales_paused
      BOOLEAN NOT NULL DEFAULT FALSE;

    ALTER TABLE offers
      ADD COLUMN IF NOT EXISTS catalog_product_id BIGINT,
      ADD COLUMN IF NOT EXISTS approval_status
        VARCHAR(20) NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS commission_per_sale
        NUMERIC(12,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS bingwa_price NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS safaricom_price NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS ussd_code TEXT,
      ADD COLUMN IF NOT EXISTS alternative_ussd_code TEXT,
      ADD COLUMN IF NOT EXISTS menu_keyword TEXT,
      ADD COLUMN IF NOT EXISTS active_start_time TIME,
      ADD COLUMN IF NOT EXISTS active_end_time TIME,
      ADD COLUMN IF NOT EXISTS daily_start_time TIME,
      ADD COLUMN IF NOT EXISTS daily_end_time TIME,
      ADD COLUMN IF NOT EXISTS category VARCHAR(100),
      ADD COLUMN IF NOT EXISTS delivery_method VARCHAR(50),
      ADD COLUMN IF NOT EXISTS recovery_strategy TEXT;

    ALTER TABLE product_catalog
      ADD COLUMN IF NOT EXISTS bingwa_price NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS safaricom_price NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS category VARCHAR(100),
      ADD COLUMN IF NOT EXISTS validity VARCHAR(100),
      ADD COLUMN IF NOT EXISTS ussd_code TEXT,
      ADD COLUMN IF NOT EXISTS menu_keyword TEXT,
      ADD COLUMN IF NOT EXISTS delivery_method VARCHAR(50),
      ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

    CREATE INDEX IF NOT EXISTS idx_resellers_status
      ON resellers(status);

    CREATE INDEX IF NOT EXISTS idx_payments_receipt
      ON payments(receipt_number);

    CREATE INDEX IF NOT EXISTS idx_mpesa_events_status
      ON mpesa_callback_events(processing_status);
  `);

  console.log("Database tables and migrations are ready.");
}
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return sendError(res, 401, "Authentication required.");
  }

  const token = authHeader.substring(7);

  if (!process.env.JWT_SECRET) {
    console.error("JWT_SECRET is not configured.");
    return sendError(res, 500, "Security configuration error.");
  }

  jwt.verify(token, process.env.JWT_SECRET, (error, decoded) => {
    if (error) {
      return sendError(res, 401, "Session expired or invalid.");
    }

    req.user = decoded;
    next();
  });
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

app.get("/", (req, res) => {
  res.json({
    status: "OK",
    message: "M-Pesa Auto Bundles API is running."
  });
});

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      status: "OK",
      database: "connected",
      service: "M-Pesa Auto Bundles"
    });
  } catch (error) {
    console.error("Health check failed:", error.message);

    res.status(503).json({
      status: "ERROR",
      database: "unavailable"
    });
  }
});

app.post("/api/admin/login", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const password = String(req.body.password || "");

    if (!password) {
      return sendError(res, 400, "Enter your password.");
    }

    const configuredPhone = process.env.ADMIN_PHONE
      ? normalizePhone(process.env.ADMIN_PHONE)
      : null;

    const configuredPassword = process.env.ADMIN_PASSWORD;

    if (
      !configuredPhone ||
      !configuredPassword ||
      phone !== configuredPhone ||
      password !== configuredPassword
    ) {
      return sendError(res, 401, "Invalid login details.");
    }

    const token = createToken({
      role: "admin",
      phone
    });

    res.json({
      status: "SUCCESS",
      message: "Administrator login successful.",
      token,
      user: {
        role: "admin",
        phone
      }
    });
  } catch (error) {
    console.error("Admin login error:", error.message);
    return sendError(res, 400, "Unable to complete login.");
  }
});

app.get(
  "/api/admin/me",
  authenticateToken,
  requireAdmin,
  (req, res) => {
    res.json({
      status: "SUCCESS",
      user: {
        role: "admin",
        phone: req.user.phone
      }
    });
  }
);

app.post("/api/resellers/register", async (req, res) => {
  const client = await pool.connect();

  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const phone = normalizePhone(req.body.phone);
    const buyGoodsTill = String(
      req.body.buy_goods_till || ""
    ).replace(/\D/g, "");
    const tillPhone = normalizePhone(req.body.till_phone);
    const password = String(req.body.password || "");

    if (!name || !email || !buyGoodsTill || !password) {
      return sendError(
        res,
        400,
        "Complete all required registration fields."
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendError(res, 400, "Enter a valid email address.");
    }

    if (!/^\d{5,8}$/.test(buyGoodsTill)) {
      return sendError(res, 400, "Enter a valid Buy Goods Till number.");
    }

    if (password.length < 8) {
      return sendError(
        res,
        400,
        "Password must contain at least 8 characters."
      );
    }

    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id
       FROM resellers
       WHERE phone = $1
          OR email = $2
          OR buy_goods_till = $3
       LIMIT 1`,
      [phone, email, buyGoodsTill]
    );

    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");

      return sendError(
        res,
        409,
        "An account already uses those registration details."
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const inserted = await client.query(
      `INSERT INTO resellers
       (name, email, phone, buy_goods_till, till_phone, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id, name, email, phone, buy_goods_till,
                 till_phone, status, created_at`,
      [name, email, phone, buyGoodsTill, tillPhone]
    );

    const reseller = inserted.rows[0];

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

    res.status(201).json({
      status: "SUCCESS",
      message: "Registration received. Await administrator approval.",
      reseller
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Reseller registration error:", error.message);

    sendError(res, 500, "Unable to complete registration.");
  } finally {
    client.release();
  }
});
app.post("/api/resellers/login", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const password = String(req.body.password || "");

    if (!password) {
      return sendError(res, 400, "Enter your password.");
    }

    const result = await pool.query(
      `SELECT r.id, r.name, r.email, r.phone,
              r.buy_goods_till, r.till_phone, r.status,
              c.password_hash
       FROM resellers r
       JOIN reseller_credentials c
         ON c.reseller_id = r.id
       WHERE r.phone = $1
       LIMIT 1`,
      [phone]
    );

    if (result.rows.length === 0) {
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
        "Your account is awaiting administrator approval or is inactive."
      );
    }

    const token = createToken({
      role: "reseller",
      resellerId: reseller.id,
      phone: reseller.phone
    });

    delete reseller.password_hash;

    res.json({
      status: "SUCCESS",
      message: "Reseller login successful.",
      token,
      user: reseller
    });
  } catch (error) {
    console.error("Reseller login error:", error.message);
    sendError(res, 400, "Unable to complete login.");
  }
});

app.get(
  "/api/resellers/me",
  authenticateToken,
  requireReseller,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, name, email, phone, buy_goods_till,
                till_phone, status, sales_paused, created_at
         FROM resellers
         WHERE id = $1
         LIMIT 1`,
        [req.user.resellerId]
      );

      if (result.rows.length === 0) {
        return sendError(res, 404, "Reseller account not found.");
      }

      res.json({
        status: "SUCCESS",
        user: result.rows[0]
      });
    } catch (error) {
      console.error("Reseller profile error:", error.message);
      sendError(res, 500, "Unable to load reseller profile.");
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
        `SELECT r.id, r.name, r.email, r.phone,
                r.buy_goods_till, r.till_phone,
                r.status, r.sales_paused, r.created_at,
                COALESCE(w.balance, 0) AS token_balance
         FROM resellers r
         LEFT JOIN token_wallets w
           ON w.reseller_id = r.id
         ORDER BY r.created_at DESC`
      );

      res.json({
        status: "SUCCESS",
        resellers: result.rows
      });
    } catch (error) {
      console.error("Admin reseller list error:", error.message);
      sendError(res, 500, "Unable to load reseller accounts.");
    }
  }
);

app.patch(
  "/api/admin/resellers/:id/status",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const resellerId = Number(req.params.id);
      const status = String(req.body.status || "").toLowerCase();

      if (!Number.isSafeInteger(resellerId) || resellerId < 1) {
        return sendError(res, 400, "Invalid reseller ID.");
      }

      if (!["active", "pending", "suspended"].includes(status)) {
        return sendError(res, 400, "Invalid account status.");
      }

      const result = await pool.query(
        `UPDATE resellers
         SET status = $1
         WHERE id = $2
         RETURNING id, name, email, phone, status`,
        [status, resellerId]
      );

      if (result.rows.length === 0) {
        return sendError(res, 404, "Reseller account not found.");
      }

      res.json({
        status: "SUCCESS",
        message: "Reseller account status updated.",
        reseller: result.rows[0]
      });
    } catch (error) {
      console.error("Reseller status update error:", error.message);
      sendError(res, 500, "Unable to update reseller status.");
    }
  }
);

app.get(
  "/api/catalog",
  authenticateToken,
  requireAdminOrReseller,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, name, price, bingwa_price,
                safaricom_price, category, validity,
                ussd_code, menu_keyword, delivery_method
         FROM product_catalog
         WHERE active = TRUE
         ORDER BY category, price, name`
      );

      res.json({
        status: "SUCCESS",
        products: result.rows
      });
    } catch (error) {
      console.error("Catalogue error:", error.message);
      sendError(res, 500, "Unable to load product catalogue.");
    }
  }
);
app.post(
  "/api/offers",
  authenticateToken,
  requireAdminOrReseller,
  async (req, res) => {
    const client = await pool.connect();

    try {
      const name = String(req.body.name || "").trim();
      const price = Number(req.body.price);
      const catalogProductId = Number(req.body.catalog_product_id);

      const resellerId =
        req.user.role === "reseller"
          ? req.user.resellerId
          : null;

      if (
        !name ||
        !Number.isSafeInteger(catalogProductId) ||
        catalogProductId < 1 ||
        !Number.isFinite(price) ||
        price <= 0
      ) {
        return sendError(
          res,
          400,
          "Enter a valid offer name, catalogue product and price."
        );
      }

      const productResult = await client.query(
        `SELECT *
         FROM product_catalog
         WHERE id = $1 AND active = TRUE
         LIMIT 1`,
        [catalogProductId]
      );

      if (productResult.rows.length === 0) {
        return sendError(
          res,
          400,
          "Select an active product from the approved catalogue."
        );
      }

      const product = productResult.rows[0];

      const approvalStatus =
        req.user.role === "admin" ? "approved" : "pending";

      const active = req.user.role === "admin";

      await client.query("BEGIN");
      await lockOfferPrices(client);

      if (
        active &&
        await hasDuplicateActivePrice(
          client,
          price,
          resellerId
        )
      ) {
        await client.query("ROLLBACK");

        return sendError(
          res,
          409,
          "This business already has an active offer at that price."
        );
      }

      const inserted = await client.query(
        `INSERT INTO offers (
          reseller_id,
          catalog_product_id,
          name,
          price,
          approval_status,
          bingwa_price,
          safaricom_price,
          ussd_code,
          menu_keyword,
          category,
          delivery_method,
          active
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
        )
        RETURNING *`,
        [
          resellerId,
          product.id,
          name,
          price,
          approvalStatus,
          product.bingwa_price,
          product.safaricom_price,
          product.ussd_code,
          product.menu_keyword,
          product.category,
          product.delivery_method,
          active
        ]
      );

      await client.query("COMMIT");

      res.status(201).json({
        status: "SUCCESS",
        message: active
          ? "Administrator offer created."
          : "Offer submitted for administrator approval.",
        offer: inserted.rows[0]
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error("Offer creation error:", error.message);

      sendError(res, 500, "Unable to create offer.");
    } finally {
      client.release();
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
          `SELECT o.*, r.name AS reseller_name
           FROM offers o
           LEFT JOIN resellers r ON r.id = o.reseller_id
           ORDER BY o.created_at DESC`
        );
      } else {
        result = await pool.query(
          `SELECT o.*, r.name AS reseller_name
           FROM offers o
           LEFT JOIN resellers r ON r.id = o.reseller_id
           WHERE o.reseller_id = $1
              OR o.reseller_id IS NULL
           ORDER BY o.created_at DESC`,
          [req.user.resellerId]
        );
      }

      res.json({
        status: "SUCCESS",
        offers: result.rows
      });
    } catch (error) {
      console.error("Offer listing error:", error.message);
      sendError(res, 500, "Unable to load offers.");
    }
  }
);

app.get(
  "/api/offers/:id",
  authenticateToken,
  requireAdminOrReseller,
  async (req, res) => {
    try {
      const offerId = Number(req.params.id);

      if (!Number.isSafeInteger(offerId) || offerId < 1) {
        return sendError(res, 400, "Invalid offer ID.");
      }

      const result = await pool.query(
        `SELECT *
         FROM offers
         WHERE id = $1
           AND (
             $2::TEXT = 'admin'
             OR reseller_id = $3
             OR reseller_id IS NULL
           )
         LIMIT 1`,
        [
          offerId,
          req.user.role,
          req.user.resellerId || null
        ]
      );

      if (result.rows.length === 0) {
        return sendError(res, 404, "Offer not found.");
      }

      res.json({
        status: "SUCCESS",
        offer: result.rows[0]
      });
    } catch (error) {
      console.error("Offer detail error:", error.message);
      sendError(res, 500, "Unable to load offer.");
    }
  }
);
app.patch(
  "/api/admin/offers/:id/approval",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const client = await pool.connect();

    try {
      const offerId = Number(req.params.id);
      const approvalStatus = String(
        req.body.approval_status || ""
      ).toLowerCase();

      if (!Number.isSafeInteger(offerId) || offerId < 1) {
        return sendError(res, 400, "Invalid offer ID.");
      }

      if (!["approved", "rejected"].includes(approvalStatus)) {
        return sendError(
          res,
          400,
          "Choose approved or rejected."
        );
      }

      await client.query("BEGIN");

      const offerResult = await client.query(
        `SELECT *
         FROM offers
         WHERE id = $1
         FOR UPDATE`,
        [offerId]
      );

      if (offerResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return sendError(res, 404, "Offer not found.");
      }

      const offer = offerResult.rows[0];

      if (approvalStatus === "approved") {
        if (!offer.catalog_product_id) {
          await client.query("ROLLBACK");

          return sendError(
            res,
            400,
            "This offer is not linked to a catalogue product."
          );
        }

        const productResult = await client.query(
          `SELECT id
           FROM product_catalog
           WHERE id = $1
             AND active = TRUE
           LIMIT 1`,
          [offer.catalog_product_id]
        );

        if (productResult.rows.length === 0) {
          await client.query("ROLLBACK");

          return sendError(
            res,
            400,
            "The linked catalogue product is not active."
          );
        }

        await lockOfferPrices(client);

        const duplicate = await hasDuplicateActivePrice(
          client,
          offer.price,
          offer.reseller_id,
          offerId
        );

        if (duplicate) {
          await client.query("ROLLBACK");

          return sendError(
            res,
            409,
            "That business already has another active offer at this price."
          );
        }
      }

      const active = approvalStatus === "approved";

      const updated = await client.query(
        `UPDATE offers
         SET approval_status = $1,
             active = $2
         WHERE id = $3
         RETURNING *`,
        [approvalStatus, active, offerId]
      );

      await client.query("COMMIT");

      res.json({
        status: "SUCCESS",
        message:
          approvalStatus === "approved"
            ? "Offer approved and activated."
            : "Offer rejected and deactivated.",
        offer: updated.rows[0]
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(
        "Offer approval error:",
        error.message
      );

      sendError(res, 500, "Unable to update offer approval.");
    } finally {
      client.release();
    }
  }
);
app.patch(
  "/api/admin/offers/:id",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const client = await pool.connect();

    try {
      const offerId = Number(req.params.id);

      if (!Number.isSafeInteger(offerId) || offerId < 1) {
        return sendError(res, 400, "Invalid offer ID.");
      }

      const name = String(req.body.name || "").trim();
      const price = Number(req.body.price);
      const catalogProductId = Number(
        req.body.catalog_product_id
      );

      if (
        !name ||
        !Number.isFinite(price) ||
        price <= 0 ||
        !Number.isSafeInteger(catalogProductId) ||
        catalogProductId < 1
      ) {
        return sendError(
          res,
          400,
          "Enter a valid offer name, price and catalogue product."
        );
      }

      await client.query("BEGIN");

      const existing = await client.query(
        `SELECT *
         FROM offers
         WHERE id = $1
         FOR UPDATE`,
        [offerId]
      );

      if (existing.rows.length === 0) {
        await client.query("ROLLBACK");
        return sendError(res, 404, "Offer not found.");
      }

      const productResult = await client.query(
        `SELECT *
         FROM product_catalog
         WHERE id = $1
           AND active = TRUE
         LIMIT 1`,
        [catalogProductId]
      );

      if (productResult.rows.length === 0) {
        await client.query("ROLLBACK");

        return sendError(
          res,
          400,
          "Select an active catalogue product."
        );
      }

      const product = productResult.rows[0];
      const oldOffer = existing.rows[0];

      if (
        oldOffer.active &&
        oldOffer.approval_status === "approved"
      ) {
        await lockOfferPrices(client);

        const duplicate = await hasDuplicateActivePrice(
          client,
          price,
          oldOffer.reseller_id,
          offerId
        );

        if (duplicate) {
          await client.query("ROLLBACK");

          return sendError(
            res,
            409,
            "This business already has an active offer at that price."
          );
        }
      }

      const updated = await client.query(
        `UPDATE offers
         SET name = $1,
             price = $2,
             catalog_product_id = $3,
             bingwa_price = $4,
             safaricom_price = $5,
             ussd_code = $6,
             menu_keyword = $7,
             category = $8,
             delivery_method = $9
         WHERE id = $10
         RETURNING *`,
        [
          name,
          price,
          product.id,
          product.bingwa_price,
          product.safaricom_price,
          product.ussd_code,
          product.menu_keyword,
          product.category,
          product.delivery_method,
          offerId
        ]
      );

      await client.query("COMMIT");

      res.json({
        status: "SUCCESS",
        message: "Offer details updated.",
        offer: updated.rows[0]
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error("Offer edit error:", error.message);

      sendError(res, 500, "Unable to update offer.");
    } finally {
      client.release();
    }
  }
);

app.patch(
  "/api/admin/offers/:id/active",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const client = await pool.connect();

    try {
      const offerId = Number(req.params.id);
      const active = req.body.active === true;

      if (!Number.isSafeInteger(offerId) || offerId < 1) {
        return sendError(res, 400, "Invalid offer ID.");
      }

      await client.query("BEGIN");

      const existing = await client.query(
        `SELECT *
         FROM offers
         WHERE id = $1
         FOR UPDATE`,
        [offerId]
      );

      if (existing.rows.length === 0) {
        await client.query("ROLLBACK");
        return sendError(res, 404, "Offer not found.");
      }

      const offer = existing.rows[0];

      if (active) {
        if (offer.approval_status !== "approved") {
          await client.query("ROLLBACK");

          return sendError(
            res,
            400,
            "Only approved offers can be activated."
          );
        }

        await lockOfferPrices(client);

        const duplicate = await hasDuplicateActivePrice(
          client,
          offer.price,
          offer.reseller_id,
          offerId
        );

        if (duplicate) {
          await client.query("ROLLBACK");

          return sendError(
            res,
            409,
            "This business already has an active offer at that price."
          );
        }
      }

      const updated = await client.query(
        `UPDATE offers
         SET active = $1
         WHERE id = $2
         RETURNING *`,
        [active, offerId]
      );

      await client.query("COMMIT");

      res.json({
        status: "SUCCESS",
        message: active
          ? "Offer activated."
          : "Offer deactivated.",
        offer: updated.rows[0]
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error("Offer activation error:", error.message);

      sendError(res, 500, "Unable to update offer status.");
    } finally {
      client.release();
    }
  }
);

app.delete(
  "/api/admin/offers/:id",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const offerId = Number(req.params.id);

      if (!Number.isSafeInteger(offerId) || offerId < 1) {
        return sendError(res, 400, "Invalid offer ID.");
      }

      const result = await pool.query(
        `DELETE FROM offers
         WHERE id = $1
         RETURNING id, name`,
        [offerId]
      );

      if (result.rows.length === 0) {
        return sendError(res, 404, "Offer not found.");
      }

      res.json({
        status: "SUCCESS",
        message: "Offer deleted.",
        offer: result.rows[0]
      });
    } catch (error) {
      console.error("Offer deletion error:", error.message);
      sendError(res, 500, "Unable to delete offer.");
    }
  }
);
app.post("/api/mpesa/c2b/validation", async (req, res) => {
  try {
    res.json({
      ResultCode: 0,
      ResultDesc: "Accepted"
    });
  } catch (error) {
    console.error("M-Pesa validation error:", error.message);

    res.status(500).json({
      ResultCode: 1,
      ResultDesc: "Validation failed"
    });
  }
});

app.post("/api/mpesa/c2b/confirmation", async (req, res) => {
  const client = await pool.connect();

  try {
    const body = req.body || {};

    const receipt = String(body.TransID || "").trim();
    const amount = Number(body.TransAmount);
    const payerPhone = normalizePhone(body.MSISDN);

    const businessTill = String(
      body.BusinessShortCode || ""
    ).replace(/\D/g, "");

    if (
      !receipt ||
      !businessTill ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return res.status(400).json({
        ResultCode: 1,
        ResultDesc: "Invalid payment information"
      });
    }

    await client.query("BEGIN");

    const eventResult = await client.query(
      `INSERT INTO mpesa_callback_events (
        trans_id,
        business_short_code,
        trans_amount,
        msisdn,
        raw_payload,
        processing_status
      )
      VALUES ($1, $2, $3, $4, $5, 'received')
      ON CONFLICT (trans_id) DO NOTHING
      RETURNING id`,
      [
        receipt,
        businessTill,
        amount,
        payerPhone,
        JSON.stringify(body)
      ]
    );

    if (eventResult.rows.length === 0) {
      await client.query("COMMIT");

      return res.json({
        ResultCode: 0,
        ResultDesc: "Payment already received"
      });
    }

    await client.query(
      `INSERT INTO payments (
        receipt_number,
        business_till,
        payer_phone,
        amount,
        status
      )
      VALUES ($1, $2, $3, $4, 'received')
      ON CONFLICT (receipt_number) DO NOTHING`,
      [receipt, businessTill, payerPhone, amount]
    );

    const platformResult = await client.query(
      `SELECT admin_buy_goods_till, sales_paused
       FROM platform_settings
       WHERE id = 1
       LIMIT 1`
    );

    const platformSettings = platformResult.rows[0] || {};

    const globalPaused = await getSalesPaused(pool);

    if (globalPaused) {
      await client.query(
        `UPDATE mpesa_callback_events
         SET processing_status = 'paused',
             processing_note = 'Platform sales are paused'
         WHERE trans_id = $1`,
        [receipt]
      );

      await client.query("COMMIT");

      return res.json({
        ResultCode: 0,
        ResultDesc: "Payment recorded"
      });
    }

    const matchingBusinesses = [];

    const adminTill = String(
      platformSettings.admin_buy_goods_till || ""
    ).replace(/\D/g, "");

    if (adminTill && adminTill === businessTill) {
      const adminOffers = await client.query(
        `SELECT id, reseller_id, name, price
         FROM offers
         WHERE reseller_id IS NULL
           AND active = TRUE
           AND approval_status = 'approved'
           AND price = $1`,
        [amount]
      );

      for (const offer of adminOffers.rows) {
        matchingBusinesses.push({
          resellerId: null,
          offer
        });
      }
    }

    const resellerOffers = await client.query(
      `SELECT
         r.id AS reseller_id,
         r.status AS reseller_status,
         r.sales_paused,
         o.id AS offer_id,
         o.name AS offer_name,
         o.price AS offer_price
       FROM resellers r
       JOIN offers o
         ON o.reseller_id = r.id
       WHERE regexp_replace(r.buy_goods_till, '[^0-9]', '', 'g') = $1
         AND r.status = 'active'
         AND r.sales_paused = FALSE
         AND o.active = TRUE
         AND o.approval_status = 'approved'
         AND o.price = $2`,
      [businessTill, amount]
    );

    for (const row of resellerOffers.rows) {
      matchingBusinesses.push({
        resellerId: row.reseller_id,
        offer: {
          id: row.offer_id,
          name: row.offer_name,
          price: row.offer_price
        }
      });
    }

    if (matchingBusinesses.length !== 1) {
      const note =
        matchingBusinesses.length === 0
          ? "No active offer matched this Till and amount"
          : "More than one offer matched this Till and amount";

      await client.query(
        `UPDATE mpesa_callback_events
         SET processing_status = 'unmatched',
             processing_note = $1
         WHERE trans_id = $2`,
        [note, receipt]
      );

      await client.query(
        `UPDATE payments
         SET status = 'unmatched'
         WHERE receipt_number = $1`,
        [receipt]
      );

      await client.query("COMMIT");

      return res.json({
        ResultCode: 0,
        ResultDesc: "Payment recorded for review"
      });
    }

    const matched = matchingBusinesses[0];

    const orderResult = await client.query(
      `INSERT INTO orders (
        reseller_id,
        offer_id,
        payment_receipt,
        payer_phone,
        recipient_phone,
        amount,
        status
      )
      VALUES ($1, $2, $3, $4, $4, $5, 'pending')
      ON CONFLICT (payment_receipt) DO NOTHING
      RETURNING id`,
      [
        matched.resellerId,
        matched.offer.id,
        receipt,
        payerPhone,
        amount
      ]
    );

    if (orderResult.rows.length === 0) {
      await client.query(
        `UPDATE mpesa_callback_events
         SET processing_status = 'processed',
             processing_note = 'Existing order found'
         WHERE trans_id = $1`,
        [receipt]
      );

      await client.query("COMMIT");

      return res.json({
        ResultCode: 0,
        ResultDesc: "Payment already processed"
      });
    }

    const orderId = orderResult.rows[0].id;

    await client.query(
      `INSERT INTO ussd_agent_jobs (
        order_id,
        status
      )
      VALUES ($1, 'pending')
      ON CONFLICT (order_id) DO NOTHING`,
      [orderId]
    );

    await client.query(
      `UPDATE mpesa_callback_events
       SET processing_status = 'queued',
           processing_note = 'Matching order and fulfilment job created'
       WHERE trans_id = $1`,
      [receipt]
    );

    await client.query("COMMIT");

    res.json({
      ResultCode: 0,
      ResultDesc: "Payment received and order queued"
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error(
      "M-Pesa confirmation error:",
      error.message
    );

    res.status(500).json({
      ResultCode: 1,
      ResultDesc: "Unable to process payment"
    });
  } finally {
    client.release();
  }
});
// Register an Android fulfilment device.
app.post(
  "/api/devices/register",
  authenticateToken,
  requireAdminOrReseller,
  async (req, res) => {
    try {
      const deviceName = String(
        req.body.device_name || ""
      ).trim();

      const phone = normalizePhone(req.body.phone);

      if (!deviceName) {
        return sendError(
          res,
          400,
          "Enter a name for this Android device."
        );
      }

      const resellerId =
        req.user.role === "reseller"
          ? req.user.resellerId
          : null;

      const deviceToken = crypto
        .randomBytes(32)
        .toString("hex");

      const result = await pool.query(
        `INSERT INTO ussd_devices (
          reseller_id,
          device_name,
          phone,
          device_token,
          status,
          last_seen
        )
        VALUES ($1, $2, $3, $4, 'online', NOW())
        RETURNING id, device_name, phone, status, created_at`,
        [
          resellerId,
          deviceName,
          phone,
          deviceToken
        ]
      );

      res.status(201).json({
        status: "SUCCESS",
        message: "Android device registered.",
        device: result.rows[0],
        device_token: deviceToken
      });
    } catch (error) {
      console.error(
        "Device registration error:",
        error.message
      );

      sendError(
        res,
        400,
        "Unable to register this device."
      );
    }
  }
);

// Authenticate a registered Android device.
async function authenticateDevice(req, res, next) {
  try {
    const deviceToken = String(
      req.headers["x-device-token"] || ""
    );

    if (!deviceToken) {
      return sendError(
        res,
        401,
        "Device authentication required."
      );
    }

    const result = await pool.query(
      `SELECT id, reseller_id, device_name, phone
       FROM ussd_devices
       WHERE device_token = $1
         AND status <> 'disabled'
       LIMIT 1`,
      [deviceToken]
    );

    if (result.rows.length === 0) {
      return sendError(
        res,
        401,
        "Invalid or disabled device."
      );
    }

    req.device = result.rows[0];

    await pool.query(
      `UPDATE ussd_devices
       SET status = 'online',
           last_seen = NOW()
       WHERE id = $1`,
      [req.device.id]
    );

    next();
  } catch (error) {
    console.error(
      "Device authentication error:",
      error.message
    );

    sendError(
      res,
      500,
      "Unable to authenticate device."
    );
  }
}

// Device heartbeat.
app.post(
  "/api/devices/heartbeat",
  authenticateDevice,
  async (req, res) => {
    try {
      await pool.query(
        `UPDATE ussd_devices
         SET status = 'online',
             last_seen = NOW()
         WHERE id = $1`,
        [req.device.id]
      );

      res.json({
        status: "SUCCESS",
        message: "Device connection updated.",
        server_time: new Date().toISOString()
      });
    } catch (error) {
      console.error(
        "Device heartbeat error:",
        error.message
      );

      sendError(
        res,
        500,
        "Unable to update device connection."
      );
    }
  }
);

// Atomically claim the next available order.
app.post(
  "/api/devices/jobs/claim",
  authenticateDevice,
  async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const device = req.device;

      const result = await client.query(
        `SELECT
           j.id AS job_id,
           j.order_id,
           o.reseller_id,
           o.payer_phone,
           o.recipient_phone,
           o.amount,
           o.payment_receipt,
           o.offer_id,
           f.name AS offer_name,
           f.ussd_code,
           f.alternative_ussd_code,
           f.menu_keyword,
           f.delivery_method
         FROM ussd_agent_jobs j
         JOIN orders o ON o.id = j.order_id
         JOIN offers f ON f.id = o.offer_id
         WHERE j.status = 'pending'
           AND o.status = 'pending'
           AND o.reseller_id IS NOT DISTINCT FROM $1
           AND (
             j.device_id IS NULL
             OR j.device_id = $2
           )
         ORDER BY j.created_at ASC
                   LIMIT 1
          FOR UPDATE OF j SKIP LOCKED`,
        [
          device.reseller_id,
          device.id
        ]
      );

      if (result.rows.length === 0) {
        await client.query("COMMIT");

        return res.json({
          status: "SUCCESS",
          job: null,
          message: "No pending jobs."
        });
      }

      const job = result.rows[0];

      await client.query(
        `UPDATE ussd_agent_jobs
         SET status = 'processing',
             device_id = $1,
             attempts = attempts + 1,
             updated_at = NOW()
         WHERE id = $2`,
        [device.id, job.job_id]
      );

      await client.query(
        `UPDATE orders
         SET status = 'processing',
             updated_at = NOW()
         WHERE id = $1`,
        [job.order_id]
      );

      await client.query("COMMIT");

      res.json({
        status: "SUCCESS",
        job: {
          job_id: job.job_id,
          order_id: job.order_id,
          recipient_phone: job.recipient_phone,
          payer_phone: job.payer_phone,
          amount: job.amount,
          payment_receipt: job.payment_receipt,
          offer_id: job.offer_id,
          offer_name: job.offer_name,
          ussd_code: job.ussd_code,
          alternative_ussd_code:
            job.alternative_ussd_code,
          menu_keyword: job.menu_keyword,
          delivery_method: job.delivery_method
        }
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(
        "Job claim error:",
        error.message
      );

      sendError(
        res,
        500,
        "Unable to claim a fulfilment job."
      );
    } finally {
      client.release();
    }
  }
);
app.post(
  "/api/devices/jobs/:id/result",
  authenticateDevice,
  async (req, res) => {
    const client = await pool.connect();

    try {
      const jobId = Number(req.params.id);
      const resultStatus = String(
        req.body.status || ""
      ).toLowerCase();

      const deliveryReference = String(
        req.body.delivery_reference || ""
      ).trim();

      const errorMessage = String(
        req.body.error_message || ""
      ).trim();

      if (
        !Number.isSafeInteger(jobId) ||
        jobId < 1
      ) {
        return sendError(res, 400, "Invalid job ID.");
      }

      if (!["success", "failed"].includes(resultStatus)) {
        return sendError(
          res,
          400,
          "Result must be success or failed."
        );
      }

      if (
        resultStatus === "success" &&
        !deliveryReference
      ) {
        return sendError(
          res,
          400,
          "A delivery confirmation reference is required."
        );
      }

      await client.query("BEGIN");

      const jobResult = await client.query(
        `SELECT
           j.id,
           j.order_id,
           j.status,
           j.device_id,
           o.reseller_id,
           o.offer_id,
           o.payment_receipt,
           o.status AS order_status
         FROM ussd_agent_jobs j
         JOIN orders o ON o.id = j.order_id
         WHERE j.id = $1
         FOR UPDATE OF j, o`,
        [jobId]
      );

      if (jobResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return sendError(res, 404, "Fulfilment job not found.");
      }

      const job = jobResult.rows[0];

      if (Number(job.device_id) !== Number(req.device.id)) {
        await client.query("ROLLBACK");

        return sendError(
          res,
          403,
          "This job belongs to another device."
        );
      }

      if (job.status !== "processing") {
        await client.query("ROLLBACK");

        return sendError(
          res,
          409,
          "This job is no longer processing."
        );
      }

      if (resultStatus === "success") {
        await client.query(
          `UPDATE ussd_agent_jobs
           SET status = 'completed',
               last_error = NULL,
               updated_at = NOW()
           WHERE id = $1`,
          [jobId]
        );

        await client.query(
          `UPDATE orders
           SET status = 'completed',
               updated_at = NOW()
           WHERE id = $1`,
          [job.order_id]
        );

        await client.query(
          `UPDATE mpesa_callback_events
           SET processing_status = 'delivered',
               processing_note = $1
           WHERE trans_id = $2`,
          [
            "Delivery confirmed: " + deliveryReference,
            job.payment_receipt
          ]
        );

        await client.query("COMMIT");

        return res.json({
          status: "SUCCESS",
          message: "Delivery result recorded.",
          order_status: "completed",
          token_deduction: "Not yet implemented"
        });
      }

      await client.query(
        `UPDATE ussd_agent_jobs
         SET status = 'failed',
             last_error = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [
          errorMessage || "Device reported delivery failure.",
          jobId
        ]
      );

      await client.query(
        `UPDATE orders
         SET status = 'failed',
             updated_at = NOW()
         WHERE id = $1`,
        [job.order_id]
      );

      await client.query(
        `UPDATE mpesa_callback_events
         SET processing_status = 'failed',
             processing_note = $1
         WHERE trans_id = $2`,
        [
          errorMessage || "USSD fulfilment failed.",
          job.payment_receipt
        ]
      );

      await client.query("COMMIT");

      res.json({
        status: "SUCCESS",
        message: "Failed delivery recorded for review.",
        order_status: "failed",
        token_deduction: "None"
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(
        "Fulfilment result error:",
        error.message
      );

      sendError(
        res,
        500,
        "Unable to record fulfilment result."
      );
    } finally {
      client.release();
    }
  }
);

// Allow an administrator to inspect fulfilment jobs.
app.get(
  "/api/admin/fulfilment/jobs",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
           j.id AS job_id,
           j.order_id,
           j.status AS job_status,
           j.attempts,
           j.last_error,
           j.created_at,
           j.updated_at,
           o.payment_receipt,
           o.payer_phone,
           o.recipient_phone,
           o.amount,
           o.status AS order_status,
           f.name AS offer_name,
           d.device_name,
           d.phone AS device_phone
         FROM ussd_agent_jobs j
         JOIN orders o ON o.id = j.order_id
         JOIN offers f ON f.id = o.offer_id
         LEFT JOIN ussd_devices d ON d.id = j.device_id
         ORDER BY j.created_at DESC
         LIMIT 200`
      );

      res.json({
        status: "SUCCESS",
        jobs: result.rows
      });
    } catch (error) {
      console.error(
        "Admin fulfilment list error:",
        error.message
      );

      sendError(
        res,
        500,
        "Unable to load fulfilment jobs."
      );
    }
  }
);
async function installTokenDeduction() {
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS
      idx_token_transactions_order_deduction
    ON token_transactions (
      reseller_id,
      reference,
      transaction_type
    )
    WHERE reference IS NOT NULL;

    CREATE OR REPLACE FUNCTION deduct_bundle_token()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.status = 'completed'
         AND OLD.status IS DISTINCT FROM 'completed'
         AND NEW.reseller_id IS NOT NULL
      THEN
        INSERT INTO token_wallets (
          reseller_id,
          balance
        )
        VALUES (
          NEW.reseller_id,
          0
        )
        ON CONFLICT (reseller_id) DO NOTHING;

        INSERT INTO token_transactions (
          reseller_id,
          amount,
          transaction_type,
          reference,
          description
        )
        VALUES (
          NEW.reseller_id,
          -1,
          'bundle_deduction',
          'ORDER-' || NEW.id::TEXT,
          'One token deducted after successful bundle delivery'
        )
        ON CONFLICT (
          reseller_id,
          reference,
          transaction_type
        )
        WHERE reference IS NOT NULL
        DO NOTHING;

        IF FOUND THEN
          UPDATE token_wallets
          SET balance = balance - 1,
              updated_at = NOW()
          WHERE reseller_id = NEW.reseller_id;
        END IF;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS
      trigger_deduct_bundle_token
    ON orders;

    CREATE TRIGGER trigger_deduct_bundle_token
    AFTER UPDATE OF status ON orders
    FOR EACH ROW
    EXECUTE FUNCTION deduct_bundle_token();
  `);

  console.log("Automatic token deduction protection installed.");
}

// Read the reseller's current token balance.
app.get(
  "/api/resellers/tokens",
  authenticateToken,
  requireReseller,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT balance
         FROM token_wallets
         WHERE reseller_id = $1
         LIMIT 1`,
        [req.user.resellerId]
      );

      res.json({
        status: "SUCCESS",
        token_balance: result.rows.length
          ? Number(result.rows[0].balance)
          : 0
      });
    } catch (error) {
      console.error("Token balance error:", error.message);

      sendError(
        res,
        500,
        "Unable to load token balance."
      );
    }
  }
);

// View reseller token transaction history.
app.get(
  "/api/resellers/tokens/history",
  authenticateToken,
  requireReseller,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
           id,
           amount,
           transaction_type,
           reference,
           description,
           created_at
         FROM token_transactions
         WHERE reseller_id = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [req.user.resellerId]
      );

      res.json({
        status: "SUCCESS",
        transactions: result.rows
      });
    } catch (error) {
      console.error("Token history error:", error.message);

      sendError(
        res,
        500,
        "Unable to load token transaction history."
      );
    }
  }
);
// SECTION 15: TRANSACTION HISTORY

// SECTION 15: TRANSACTION HISTORY

app.get(
  "/api/transactions",
  authenticateToken,
  requireAdminOrReseller,
  async (req, res) => {
    try {
      let query;
      let values = [];

      if (req.user.role === "admin") {
        query = `
          SELECT
            o.id,
            o.reseller_id,
            o.offer_id,
            o.payer_phone,
            o.recipient_phone,
            o.amount,
            o.status,
            o.payment_receipt,
            o.created_at,
            o.updated_at,
            f.name AS offer_name,
            r.name AS reseller_name,
            p.receipt_number,
            p.status AS payment_status
          FROM orders o
          LEFT JOIN offers f
            ON f.id = o.offer_id
          LEFT JOIN resellers r
            ON r.id = o.reseller_id
          LEFT JOIN payments p
            ON p.receipt_number = o.payment_receipt
          ORDER BY o.created_at DESC
          LIMIT 200
        `;
      } else {
        query = `
          SELECT
            o.id,
            o.reseller_id,
            o.offer_id,
            o.payer_phone,
            o.recipient_phone,
            o.amount,
            o.status,
            o.payment_receipt,
            o.created_at,
            o.updated_at,
            f.name AS offer_name,
            p.receipt_number,
            p.status AS payment_status
          FROM orders o
          LEFT JOIN offers f
            ON f.id = o.offer_id
          LEFT JOIN payments p
            ON p.receipt_number = o.payment_receipt
          WHERE o.reseller_id = $1
          ORDER BY o.created_at DESC
          LIMIT 200
        `;

        values = [req.user.resellerId];
      }

      const result = await pool.query(query, values);

      return res.json({
        status: "SUCCESS",
        transactions: result.rows
      });
    } catch (error) {
      console.error("Transaction history error:", error.message);

      return sendError(
        res,
        500,
        "Unable to load transaction history."
      );
    }
  }
);

// ADMIN: VIEW UNMATCHED PAYMENTS

app.get(
  "/api/admin/payments/unmatched",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          p.id,
          p.receipt_number,
          p.amount,
          p.payer_phone,
          p.business_till,
          p.status,
          p.created_at
        FROM payments p
        LEFT JOIN orders o
          ON o.payment_receipt = p.receipt_number
        WHERE o.id IS NULL
        ORDER BY p.created_at DESC
        LIMIT 200
      `);

      return res.json({
        status: "SUCCESS",
        payments: result.rows
      });
    } catch (error) {
      console.error("Unmatched payments error:", error.message);

      return sendError(
        res,
        500,
        "Unable to load unmatched payments."
      );
    }
  }
);

app.get(
  "/api/transactions",
  authenticateToken,
  requireAdminOrReseller,
  async (req, res) => {
    try {
      let query;
      let values = [];

      if (req.user.role === "admin") {
        query = `
          SELECT
            o.id,
            o.reseller_id,
            o.offer_id,
            o.customer_phone,
            o.amount,
            o.status,
            o.delivery_reference,
            o.created_at,
            o.updated_at,
            f.name AS offer_name,
            r.full_name AS reseller_name,
            p.receipt_number,
            p.status AS payment_status
          FROM orders o
          LEFT JOIN offers f ON f.id = o.offer_id
          LEFT JOIN resellers r ON r.id = o.reseller_id
          LEFT JOIN payments p ON p.order_id = o.id
          ORDER BY o.created_at DESC
          LIMIT 200
        `;
      } else {
        query = `
          SELECT
            o.id,
            o.reseller_id,
            o.offer_id,
            o.customer_phone,
            o.amount,
            o.status,
            o.delivery_reference,
            o.created_at,
            o.updated_at,
            f.name AS offer_name,
            p.receipt_number,
            p.status AS payment_status
          FROM orders o
          LEFT JOIN offers f ON f.id = o.offer_id
          LEFT JOIN payments p ON p.order_id = o.id
          WHERE o.reseller_id = $1
          ORDER BY o.created_at DESC
          LIMIT 200
        `;

        values = [req.user.resellerId];
      }

      const result = await pool.query(query, values);

      return res.json({
        status: "SUCCESS",
        transactions: result.rows
      });
    } catch (error) {
      console.error("Transaction history error:", error.message);
      return sendError(
        res,
        500,
        "Unable to load transaction history."
      );
    }
  }
);

// ADMIN: VIEW UNMATCHED PAYMENTS

app.get(
  "/api/admin/payments/unmatched",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          id,
          receipt_number,
          amount,
          payer_phone,
          business_till,
          status,
          created_at
        FROM payments
        WHERE order_id IS NULL
        ORDER BY created_at DESC
        LIMIT 200
      `);

      return res.json({
        status: "SUCCESS",
        payments: result.rows
      });
    } catch (error) {
      console.error("Unmatched payments error:", error.message);
      return sendError(
        res,
        500,
        "Unable to load unmatched payments."
      );
    }
  }
);
// SECTION 16: RESELLER SALES CONTROLS

app.patch(
  "/api/resellers/system/sales-status",
  authenticateToken,
  requireReseller,
  async (req, res) => {
    const paused = req.body.paused;

    if (typeof paused !== "boolean") {
      return sendError(
        res,
        400,
        "Paused must be true or false."
      );
    }

    try {
      const result = await pool.query(
        `
          UPDATE resellers
          SET sales_paused = $1
          WHERE id = $2
          RETURNING id, sales_paused
        `,
        [paused, req.user.resellerId]
      );

      if (result.rowCount === 0) {
        return sendError(res, 404, "Reseller account not found.");
      }

      return res.json({
        status: "SUCCESS",
        message: paused
          ? "Your sales have been paused."
          : "Your sales have been resumed.",
        sales_paused: result.rows[0].sales_paused
      });
    } catch (error) {
      console.error("Reseller sales control error:", error.message);
      return sendError(
        res,
        500,
        "Unable to update your sales status."
      );
    }
  }
);

// GET THE CURRENT RESELLER SALES STATUS

app.get(
  "/api/resellers/system/sales-status",
  authenticateToken,
  requireReseller,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          SELECT sales_paused
          FROM resellers
          WHERE id = $1
        `,
        [req.user.resellerId]
      );

      if (result.rowCount === 0) {
        return sendError(res, 404, "Reseller account not found.");
      }

      return res.json({
        status: "SUCCESS",
        sales_paused: result.rows[0].sales_paused
      });
    } catch (error) {
      console.error("Reseller sales status error:", error.message);
      return sendError(
        res,
        500,
        "Unable to load your sales status."
      );
    }
  }
);
// SECTION 17: RESELLER SALES-CONTROL DATABASE MIGRATION

async function installResellerSalesControls() {
  await pool.query(`
    ALTER TABLE resellers
    ADD COLUMN IF NOT EXISTS
    sales_paused BOOLEAN NOT NULL DEFAULT FALSE
  `);

  console.log("Reseller sales controls database is ready.");
}
// SECTION 18: SALES ANALYTICS SUMMARY

app.get(
  "/api/analytics/summary",
  authenticateToken,
  requireAdminOrReseller,
  async (req, res) => {
    try {
      let result;

      if (req.user.role === "admin") {
        result = await pool.query(`
          SELECT
            COUNT(*)::INTEGER AS total_orders,

            COUNT(*) FILTER (
              WHERE status = 'completed'
            )::INTEGER AS completed_orders,

            COUNT(*) FILTER (
              WHERE status = 'pending'
            )::INTEGER AS pending_orders,

            COUNT(*) FILTER (
              WHERE status = 'failed'
            )::INTEGER AS failed_orders,

            COALESCE(
              SUM(amount) FILTER (
                WHERE status = 'completed'
              ),
              0
            ) AS completed_sales,

            COALESCE(
              SUM(amount) FILTER (
                WHERE status = 'pending'
              ),
              0
            ) AS pending_sales

          FROM orders
        `);
      } else {
        result = await pool.query(
          `
            SELECT
              COUNT(*)::INTEGER AS total_orders,

              COUNT(*) FILTER (
                WHERE status = 'completed'
              )::INTEGER AS completed_orders,

              COUNT(*) FILTER (
                WHERE status = 'pending'
              )::INTEGER AS pending_orders,

              COUNT(*) FILTER (
                WHERE status = 'failed'
              )::INTEGER AS failed_orders,

              COALESCE(
                SUM(amount) FILTER (
                  WHERE status = 'completed'
                ),
                0
              ) AS completed_sales,

              COALESCE(
                SUM(amount) FILTER (
                  WHERE status = 'pending'
                ),
                0
              ) AS pending_sales

            FROM orders
            WHERE reseller_id = $1
          `,
          [req.user.resellerId]
        );
      }

      return res.json({
        status: "SUCCESS",
        analytics: result.rows[0]
      });
    } catch (error) {
      console.error("Analytics summary error:", error.message);

      return sendError(
        res,
        500,
        "Unable to load sales analytics."
      );
    }
  }
);
// SECTION 19: NOTIFICATION SUMMARY

// RESELLER: COUNT UNREAD NOTIFICATIONS

app.get(
  "/api/resellers/notifications/unread-count",
  authenticateToken,
  requireReseller,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          SELECT COUNT(*)::INTEGER AS unread_count
          FROM reseller_notifications
          WHERE reseller_id = $1
            AND read_at IS NULL
        `,
        [req.user.resellerId]
      );

      return res.json({
        status: "SUCCESS",
        unread_count: result.rows[0].unread_count
      });
    } catch (error) {
      console.error("Unread notification count error:", error.message);

      return sendError(
        res,
        500,
        "Unable to load unread notifications."
      );
    }
  }
);

// ADMIN: VIEW RECENT RESELLER NOTIFICATIONS

app.get(
  "/api/admin/notifications",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          n.id,
          n.reseller_id,
          r.full_name AS reseller_name,
          n.title,
          n.message,
          n.notification_type,
          n.read_at,
          n.created_at
        FROM reseller_notifications n
        JOIN resellers r
          ON r.id = n.reseller_id
        ORDER BY n.created_at DESC
        LIMIT 200
      `);

      return res.json({
        status: "SUCCESS",
        notifications: result.rows
      });
    } catch (error) {
      console.error("Admin notifications error:", error.message);

      return sendError(
        res,
        500,
        "Unable to load notifications."
      );
    }
  }
);// SECTION 20: SERVER STARTUP

async function startServer() {
  try {
    console.log("Starting M-Pesa Auto Bundles backend...");

    await initializeDatabase();

    await installResellerSalesControls();

    await installTokenDeduction();

    await installOperations(
      app,
      pool,
      authenticateToken,
      requireAdmin,
      requireReseller
    );

    const PORT = process.env.PORT || 3000;

    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `M-Pesa Auto Bundles backend running on port ${PORT}.`
      );
    });
  } catch (error) {
    console.error("Backend startup failed:", error);

    process.exit(1);
  }
}

startServer();
