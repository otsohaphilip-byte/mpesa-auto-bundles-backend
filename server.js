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

// SERIALIZE OFFER PRICE CHANGES AND CHECKS
async function lockOfferPrices(client) {
  await client.query(
    "SELECT pg_advisory_xact_lock($1)",
    [872341]
  );
}

async function hasDuplicateActivePrice(client, price, excludeId = null) {
  const result = await client.query(
    `SELECT id
     FROM offers
     WHERE active = TRUE
       AND approval_status = 'approved'
       AND price = $1
       AND ($2::BIGINT IS NULL OR id <> $2)
     LIMIT 1`,
    [price, excludeId]
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

  try {
    const { name, phone, password } = req.body;

    if (!name || !phone || !password) {
      return sendError(
        res,
        400,
        "Name, phone number and password are required."
      );
    }

    if (String(password).length < 6) {
      return sendError(
        res,
        400,
        "Password must contain at least 6 characters."
      );
    }

    const existing = await client.query(
      "SELECT id FROM resellers WHERE phone = $1",
      [phone]
    );

    if (existing.rowCount > 0) {
      return sendError(
        res,
        409,
        "A reseller with this phone number already exists."
      );
    }

    await client.query("BEGIN");

    const resellerResult = await client.query(
      `INSERT INTO resellers (name, phone, status)
       VALUES ($1, $2, 'pending')
       RETURNING id, name, phone, status`,
      [String(name).trim(), String(phone).trim()]
    );

    const reseller = resellerResult.rows[0];

    const passwordHash = await bcrypt.hash(password, 12);

    await client.query(
      `INSERT INTO reseller_credentials
       (reseller_id, password_hash)
       VALUES ($1, $2)`,
      [reseller.id, passwordHash]
    );

    await client.query("COMMIT");

    res.status(201).json({
      status: "OK",
      message: "Registration received. Await administrator approval."
    });
  } catch (error) {
    await client.query("ROLLBACK");
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
    const { phone, password } = req.body;

    if (!phone || !password) {
      return sendError(
        res,
        400,
        "Phone number and password are required."
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
       WHERE r.phone = $1
       LIMIT 1`,
      [phone]
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
        `SELECT id, name, phone, status, created_at
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

      if (isAdmin) {
        await lockOfferPrices(client);

        const duplicate = await hasDuplicateActivePrice(
          client,
          amount
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

      const resellerId = isAdmin
        ? null
        : req.user.resellerId;

      const approvalStatus = isAdmin
        ? "approved"
        : "pending";

      const active = isAdmin;

      const result = await client.query(
        `INSERT INTO offers (
           reseller_id,
           name,
           product_type,
           price,
           bundle_code,
           catalog_product_id,
           approval_status,
           active
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          resellerId,
          String(name).trim(),
          productResult.rows[0].product_type,
          amount,
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
          : "Offer submitted for administrator approval.",
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
    try {
      let result;

      if (req.user.role === "admin") {
        result = await pool.query(
          `SELECT *
           FROM offers
           ORDER BY created_at DESC`
        );
      } else if (req.user.role === "reseller") {
        result = await pool.query(
          `SELECT *
           FROM offers
           WHERE reseller_id = $1
              OR reseller_id IS NULL
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
      console.error("Load offers error:", error);
      sendError(res, 500, "Could not load offers.");
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
          offer.price,
          id
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
  requireAdmin,
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
      const newPrice =
        amount === undefined ? offer.price : amount;

      if (
        offer.active === true &&
        offer.approval_status === "approved"
      ) {
        const duplicate = await hasDuplicateActivePrice(
          client,
          newPrice,
          id
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
             price = $2
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
  requireAdmin,
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
          offer.price,
          id
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
  try {
    console.log(
      "M-Pesa confirmation callback received:",
      JSON.stringify(req.body)
    );

    // Payment matching, idempotency checks and authorized
    // bundle fulfilment are not implemented in this callback yet.

    res.json({
      ResultCode: 0,
      ResultDesc: "Confirmation received"
    });
  } catch (error) {
    console.error("M-Pesa confirmation error:", error);

    res.status(500).json({
      ResultCode: 1,
      ResultDesc: "Confirmation processing failed"
    });
  }
});

// ==============================
// START SERVER
// ==============================

const PORT = process.env.PORT || 3000;

initializeDatabase()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`M-Pesa Auto Bundles running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Server startup failed:", error);
    process.exit(1);
  });
