const crypto = require("crypto");

const SUBSCRIPTION_PLANS = {
  daily: { amount: 50, days: 1, label: "Daily" },
  weekly: { amount: 250, days: 7, label: "Weekly" },
  monthly: { amount: 500, days: 30, label: "Monthly" }
};

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;
const initiationAttempts = new Map();

function normalizeKenyanPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  else if (digits.startsWith("254")) digits = digits.slice(3);

  if (!/^[17]\d{8}$/.test(digits)) {
    throw new Error("Enter a valid Kenyan Safaricom mobile number.");
  }

  return "254" + digits;
}

function getDarajaConfig() {
  const environment = String(
    process.env.MPESA_ENV || "sandbox"
  ).trim().toLowerCase();

  if (!["sandbox", "production"].includes(environment)) {
    throw new Error("MPESA_ENV must be sandbox or production.");
  }

  const sandbox = environment === "sandbox";
  const consumerKey = String(
    process.env.MPESA_CONSUMER_KEY || ""
  ).trim();
  const consumerSecret = String(
    process.env.MPESA_CONSUMER_SECRET || ""
  ).trim();

  const passkey = String(
    sandbox
      ? (process.env.MPESA_TEST_SECRET ||
         process.env.MPESA_PASSKEY || "")
      : (process.env.MPESA_PASSKEY || "")
  ).trim();

  if (!consumerKey || !consumerSecret || !passkey) {
    throw new Error("Daraja credentials are incomplete.");
  }

  const businessShortCode = sandbox
    ? "174379"
    : String(process.env.MPESA_LIVE_SHORTCODE || "").trim();

  if (!businessShortCode) {
    throw new Error(
      "Live shortcode is not configured. Complete Safaricom Go-Live first."
    );
  }

  return {
    environment,
    sandbox,
    consumerKey,
    consumerSecret,
    passkey,
    businessShortCode,
    baseUrl: sandbox
      ? "https://sandbox.safaricom.co.ke"
      : "https://api.safaricom.co.ke"
  };
}

async function getAccessToken(config) {
  if (
    cachedAccessToken &&
    Date.now() < cachedAccessTokenExpiresAt
  ) {
    return cachedAccessToken;
  }

  const credentials = Buffer.from(
    config.consumerKey + ":" + config.consumerSecret
  ).toString("base64");

  const response = await fetch(
    config.baseUrl +
      "/oauth/v1/generate?grant_type=client_credentials",
    {
      method: "GET",
      headers: {
        Authorization: "Basic " + credentials
      }
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.access_token) {
    throw new Error("Daraja authentication failed.");
  }

  cachedAccessToken = data.access_token;
  cachedAccessTokenExpiresAt = Date.now() + 50 * 60 * 1000;

  return cachedAccessToken;
}

function getNairobiTimestamp() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());

  const values = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  return (
    values.year +
    values.month +
    values.day +
    values.hour +
    values.minute +
    values.second
  );
}

function getCallbackUrl() {
  const explicitUrl = String(
    process.env.MPESA_CALLBACK_URL || ""
  ).trim();

  const renderUrl = String(
    process.env.RENDER_EXTERNAL_URL || ""
  ).trim();

  const base = explicitUrl || (
    renderUrl
      ? renderUrl.replace(/\/$/, "") +
        "/api/payments/mpesa/stk/callback"
      : ""
  );

  if (!base) {
    throw new Error("Public M-Pesa callback URL is missing.");
  }

  let parsed;

  try {
    parsed = new URL(base);
  } catch (_) {
    throw new Error("M-Pesa callback URL is invalid.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Callback URL must use HTTPS.");
  }

  return base;
}

function callbackPhone(metadata) {
  const item = (metadata || []).find(
    x => x && x.Name === "PhoneNumber"
  );

  if (!item || item.Value == null) return null;

  try {
    return normalizeKenyanPhone(item.Value);
  } catch (_) {
    return null;
  }
}

function callbackAmount(metadata) {
  const item = (metadata || []).find(
    x => x && x.Name === "Amount"
  );

  if (!item || item.Value == null) return null;

  const amount = Number(item.Value);

  return Number.isFinite(amount) ? amount : null;
}

function callbackReceipt(metadata) {
  const item = (metadata || []).find(
    x => x && x.Name === "MpesaReceiptNumber"
  );

  return item && item.Value
    ? String(item.Value).trim()
    : null;
}

async function querySafaricomStk(checkoutRequestId) {
  const config = getDarajaConfig();
  const accessToken = await getAccessToken(config);
  const timestamp = getNairobiTimestamp();

  const password = Buffer.from(
    config.businessShortCode +
      config.passkey +
      timestamp
  ).toString("base64");

  const response = await fetch(
    config.baseUrl + "/mpesa/stkpushquery/v1/query",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        BusinessShortCode: config.businessShortCode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId
      })
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      "Safaricom could not verify the STK transaction."
    );
  }

  return data;
    }
async function ensureSubscriptionPaymentTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscription_payments (
      id BIGSERIAL PRIMARY KEY,
      reseller_id BIGINT NOT NULL REFERENCES resellers(id),
      plan VARCHAR(30) NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      merchant_request_id VARCHAR(150),
      checkout_request_id VARCHAR(150) UNIQUE,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      mpesa_receipt VARCHAR(50),
      callback_payload JSONB,
      query_payload JSONB,
      processing_note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      verified_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS subscription_payment_callbacks (
      id BIGSERIAL PRIMARY KEY,
      checkout_request_id VARCHAR(150) UNIQUE NOT NULL,
      callback_payload JSONB NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processing_status VARCHAR(30) NOT NULL DEFAULT 'received',
      processing_note TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_subscription_payments_reseller
      ON subscription_payments(reseller_id, created_at DESC);
  `);
}

async function processStoredSubscriptionCallback(
  pool,
  checkoutRequestId
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const paymentResult = await client.query(
      `SELECT *
       FROM subscription_payments
       WHERE checkout_request_id = $1
       FOR UPDATE`,
      [checkoutRequestId]
    );

    const callbackResult = await client.query(
      `SELECT *
       FROM subscription_payment_callbacks
       WHERE checkout_request_id = $1
       FOR UPDATE`,
      [checkoutRequestId]
    );

    if (
      !paymentResult.rows.length ||
      !callbackResult.rows.length
    ) {
      await client.query("ROLLBACK");
      return false;
    }

    const payment = paymentResult.rows[0];
    const callback = callbackResult.rows[0];

    if (payment.status === "success") {
      await client.query("COMMIT");
      return true;
    }

    const stk = callback.callback_payload?.Body?.stkCallback;
    const metadata = stk?.CallbackMetadata?.Item;

    if (!stk) {
      await client.query("ROLLBACK");
      return false;
    }

    if (Number(stk.ResultCode) !== 0) {
      await client.query(
        `UPDATE subscription_payments
         SET status = 'failed',
             processing_note = $2
         WHERE checkout_request_id = $1`,
        [
          checkoutRequestId,
          String(stk.ResultDesc || "Payment failed.")
        ]
      );

      await client.query(
        `UPDATE subscription_payment_callbacks
         SET processing_status = 'failed',
             processing_note = 'Payment was unsuccessful.'
         WHERE checkout_request_id = $1`,
        [checkoutRequestId]
      );

      await client.query("COMMIT");
      return false;
    }

    const amount = callbackAmount(metadata);
    const phone = callbackPhone(metadata);
    const receipt = callbackReceipt(metadata);

    const validMetadata =
      amount !== null &&
      amount === Number(payment.amount) &&
      phone !== null &&
      phone === payment.phone &&
      receipt !== null &&
      receipt.length >= 5;

    if (!validMetadata) {
      await client.query(
        `UPDATE subscription_payments
         SET status = 'review',
             processing_note = 'Callback details do not match payment.'
         WHERE checkout_request_id = $1`,
        [checkoutRequestId]
      );

      await client.query(
        `UPDATE subscription_payment_callbacks
         SET processing_status = 'review',
             processing_note = 'Callback details mismatch.'
         WHERE checkout_request_id = $1`,
        [checkoutRequestId]
      );

      await client.query("COMMIT");
      return false;
    }

    const queryResult = payment.query_payload;

    if (
      !queryResult ||
      String(queryResult.ResponseCode) !== "0" ||
      Number(queryResult.ResultCode) !== 0
    ) {
      await client.query(
        `UPDATE subscription_payment_callbacks
         SET processing_status = 'retry',
             processing_note = 'Safaricom verification is pending.'
         WHERE checkout_request_id = $1`,
        [checkoutRequestId]
      );

      await client.query(
        `UPDATE subscription_payments
         SET status = 'pending',
             processing_note = 'Awaiting transaction verification.'
         WHERE checkout_request_id = $1`,
        [checkoutRequestId]
      );

      await client.query("COMMIT");
      return false;
    }

    const plan = SUBSCRIPTION_PLANS[payment.plan];

    if (!plan) {
      throw new Error("Subscription plan is invalid.");
    }

    // Serialize subscription activation per reseller.
    await client.query(
      `SELECT id
       FROM resellers
       WHERE id = $1
       FOR UPDATE`,
      [payment.reseller_id]
    );

    const existing = await client.query(
      `SELECT expires_at
       FROM subscriptions
       WHERE reseller_id = $1
         AND status = 'active'
         AND expires_at > NOW()
       ORDER BY expires_at DESC
       LIMIT 1`,
      [payment.reseller_id]
    );

    const startsAt = existing.rows.length
      ? new Date(existing.rows[0].expires_at)
      : new Date();

    const expiresAt = new Date(startsAt);

    expiresAt.setUTCDate(
      expiresAt.getUTCDate() + plan.days
    );

    await client.query(
      `INSERT INTO subscriptions
       (reseller_id, plan, amount, status, starts_at, expires_at)
       VALUES ($1, $2, $3, 'active', $4, $5)`,
      [
        payment.reseller_id,
        payment.plan,
        payment.amount,
        startsAt,
        expiresAt
      ]
    );

    await client.query(
      `UPDATE subscription_payments
       SET status = 'success',
           mpesa_receipt = $2,
           verified_at = NOW(),
           processing_note = 'Payment verified successfully.'
       WHERE checkout_request_id = $1`,
      [checkoutRequestId, receipt]
    );

    await client.query(
      `UPDATE subscription_payment_callbacks
       SET processing_status = 'success',
           processing_note = 'Payment verified successfully.'
       WHERE checkout_request_id = $1`,
      [checkoutRequestId]
    );

    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(
      "Subscription verification error:",
      error
    );
    throw error;
  } finally {
    client.release();
  }
        
async function initiateSubscriptionStk(
  app,
  pool,
  authenticateToken,
  requireReseller
) {
  app.post(
    "/api/reseller/subscriptions/stk-push",
    authenticateToken,
    requireReseller,
    async (req, res) => {
      try {
        const resellerId = req.user.resellerId;
        const planKey = String(req.body?.plan || "")
          .trim()
          .toLowerCase();

        const plan = SUBSCRIPTION_PLANS[planKey];

        if (!plan) {
          return res.status(400).json({
            status: "ERROR",
            message: "Select a valid subscription plan."
          });
        }

        const now = Date.now();
        const previous = initiationAttempts.get(resellerId) || 0;

        if (now - previous < 30000) {
          return res.status(429).json({
            status: "ERROR",
            message: "Please wait before requesting another payment prompt."
          });
        }

        initiationAttempts.set(resellerId, now);

        const resellerResult = await pool.query(
          `SELECT id, phone, status
           FROM resellers
           WHERE id = $1`,
          [resellerId]
        );

        if (!resellerResult.rows.length) {
          return res.status(404).json({
            status: "ERROR",
            message: "Reseller account not found."
          });
        }

        const reseller = resellerResult.rows[0];

        if (reseller.status !== "active") {
          return res.status(403).json({
            status: "ERROR",
            message: "Your reseller account is not active."
          });
        }

        const phone = normalizeKenyanPhone(reseller.phone);
        const config = getDarajaConfig();
        const accessToken = await getAccessToken(config);
        const timestamp = getNairobiTimestamp();

        const password = Buffer.from(
          config.businessShortCode +
            config.passkey +
            timestamp
        ).toString("base64");

        let partyB = config.businessShortCode;
        let transactionType = "CustomerPayBillOnline";

        if (!config.sandbox) {
          const tillResult = await pool.query(
            `SELECT admin_buy_goods_till
             FROM platform_settings
             WHERE id = 1`
          );

          partyB = String(
            tillResult.rows[0]?.admin_buy_goods_till || ""
          ).trim();

          if (!/^\d{5,8}$/.test(partyB)) {
            return res.status(400).json({
              status: "ERROR",
              message: "Admin Buy Goods Till is not configured."
            });
          }

          transactionType = "CustomerBuyGoodsOnline";
        }

        const callbackUrl = getCallbackUrl();

        const requestBody = {
          BusinessShortCode: config.businessShortCode,
          Password: password,
          Timestamp: timestamp,
          TransactionType: transactionType,
          Amount: plan.amount,
          PartyA: phone,
          PartyB: partyB,
          PhoneNumber: phone,
          CallBackURL: callbackUrl,
          AccountReference: "SUB-" + resellerId,
          TransactionDesc:
            "M-Pesa Auto Bundles " + plan.label + " Subscription"
        };

        const paymentInsert = await pool.query(
          `INSERT INTO subscription_payments
           (reseller_id, plan, amount, phone, status)
           VALUES ($1, $2, $3, $4, 'initiating')
           RETURNING id`,
          [resellerId, planKey, plan.amount, phone]
        );

        const paymentId = paymentInsert.rows[0].id;

        const stkResponse = await fetch(
          config.baseUrl + "/mpesa/stkpush/v1/processrequest",
          {
            method: "POST",
            headers: {
              Authorization: "Bearer " + accessToken,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(requestBody)
          }
        );

        const stkData = await stkResponse.json().catch(() => ({}));

        if (
          !stkResponse.ok ||
          String(stkData.ResponseCode) !== "0" ||
          !stkData.CheckoutRequestID
        ) {
          await pool.query(
            `UPDATE subscription_payments
             SET status = 'failed',
                 processing_note = $2
             WHERE id = $1`,
            [
              paymentId,
              "STK initiation failed: " +
                String(stkData.ResponseDescription || stkData.errorMessage || "Unknown error")
            ]
          );

          return res.status(502).json({
            status: "ERROR",
            message: "M-Pesa payment prompt could not be started."
          });
        }

        await pool.query(
          `UPDATE subscription_payments
           SET merchant_request_id = $2,
               checkout_request_id = $3,
               status = 'pending',
               processing_note = 'STK prompt sent.'
           WHERE id = $1`,
          [
            paymentId,
            stkData.MerchantRequestID || null,
            stkData.CheckoutRequestID
          ]
        );

        res.json({
          status: "OK",
          message: "Payment prompt sent. Check your phone.",
          checkoutRequestId: stkData.CheckoutRequestID,
          plan: planKey,
          amount: plan.amount
        });
      } catch (error) {
        console.error("Subscription STK initiation error:", error);

        res.status(500).json({
          status: "ERROR",
          message: "Could not start subscription payment."
        });
      }
    }
  );
            }
function installSubscriptionCallback(app, pool) {
  app.post(
    "/api/payments/mpesa/stk/callback",
    async (req, res) => {
      try {
        const stk = req.body?.Body?.stkCallback;

        if (!stk || !stk.CheckoutRequestID) {
          return res.json({
            ResultCode: 0,
            ResultDesc: "Callback received."
          });
        }

        const checkoutRequestId =
          String(stk.CheckoutRequestID);

        await pool.query(
          `INSERT INTO subscription_payment_callbacks
           (checkout_request_id, callback_payload)
           VALUES ($1, $2)
           ON CONFLICT (checkout_request_id)
           DO UPDATE SET callback_payload = EXCLUDED.callback_payload`,
          [checkoutRequestId, req.body]
        );

        res.json({
          ResultCode: 0,
          ResultDesc: "Callback received successfully."
        });

        setImmediate(async () => {
          try {
            const paymentResult = await pool.query(
              `SELECT id, status
               FROM subscription_payments
               WHERE checkout_request_id = $1`,
              [checkoutRequestId]
            );

            if (!paymentResult.rows.length) {
              return;
            }

            if (paymentResult.rows[0].status === "success") {
              return;
            }

            const queryResult =
              await querySafaricomStk(checkoutRequestId);

            await pool.query(
              `UPDATE subscription_payments
               SET query_payload = $2
               WHERE checkout_request_id = $1`,
              [checkoutRequestId, queryResult]
            );

            await processStoredSubscriptionCallback(
              pool,
              checkoutRequestId
            );
          } catch (error) {
            console.error(
              "Subscription callback processing error:",
              error
            );

            await pool.query(
              `UPDATE subscription_payment_callbacks
               SET processing_status = 'retry',
                   processing_note = $2
               WHERE checkout_request_id = $1`,
              [
                checkoutRequestId,
                "Verification could not complete. Retry is required."
              ]
            ).catch(() => {});
          }
        });
      } catch (error) {
        console.error("M-Pesa callback storage error:", error);

                res.status(500).json({
          ResultCode: 1,
          ResultDesc: "Callback storage failed."
        });
      }
    }
  );
}
function installSubscriptionStatusRoutes(
  app,
  pool,
  authenticateToken,
  requireReseller
) {
  app.get(
    "/api/reseller/subscriptions/status/:checkoutRequestId",
    authenticateToken,
    requireReseller,
    async (req, res) => {
      try {
        const checkoutId = String(
          req.params.checkoutRequestId || ""
        ).trim();

        let result = await pool.query(
          `SELECT id, plan, amount, status,
                  mpesa_receipt, created_at, verified_at,
                  processing_note
           FROM subscription_payments
           WHERE checkout_request_id = $1
             AND reseller_id = $2`,
          [checkoutId, req.user.resellerId]
        );

                if (!result.rows.length) {
          return res.status(404).json({
            status: "ERROR",
            message: "Payment record not found."
          });
        }

        if (result.rows[0].status === "pending") {
          const callbackResult = await pool.query(
            `SELECT callback_payload
             FROM subscription_payment_callbacks
             WHERE checkout_request_id = $1`,
            [checkoutId]
          );

          if (callbackResult.rows.length) {
            try {
              const queryResult =
                await querySafaricomStk(checkoutId);

              await pool.query(
                `UPDATE subscription_payments
                 SET query_payload = $2
                 WHERE checkout_request_id = $1`,
                [checkoutId, queryResult]
              );

              await processStoredSubscriptionCallback(
                pool,
                checkoutId
              );

              result = await pool.query(
                `SELECT id, plan, amount, status,
                        mpesa_receipt, created_at, verified_at,
                        processing_note
                 FROM subscription_payments
                 WHERE checkout_request_id = $1
                   AND reseller_id = $2`,
                [checkoutId, req.user.resellerId]
              );
            } catch (retryError) {
              console.error(
                "Subscription verification retry error:",
                retryError
              );
            }
          }

        res.json({
          status: "OK",
          payment: result.rows[0]
        });
      } catch (error) {
        console.error("Subscription payment status error:", error);

        res.status(500).json({
          status: "ERROR",
          message: "Could not check payment status."
        });
      }
    }
  );

  app.get(
    "/api/reseller/subscriptions/current",
    authenticateToken,
    requireReseller,
    async (req, res) => {
      try {
        const result = await pool.query(
          `SELECT id, plan, amount, status,
                  starts_at, expires_at, created_at
           FROM subscriptions
           WHERE reseller_id = $1
             AND status = 'active'
             AND expires_at > NOW()
           ORDER BY expires_at DESC
           LIMIT 1`,
          [req.user.resellerId]
        );

        res.json({
          status: "OK",
          subscription: result.rows[0] || null
        });
      } catch (error) {
        console.error("Current subscription error:", error);

        res.status(500).json({
          status: "ERROR",
          message: "Could not load current subscription."
        });
      }
    }
  );
    }
async function installSubscriptionPayments(
  app,
  pool,
  authenticateToken,
  requireReseller
) {
  await ensureSubscriptionPaymentTables(pool);

  initiateSubscriptionStk(
    app,
    pool,
    authenticateToken,
    requireReseller
  );

  installSubscriptionCallback(app, pool);

  installSubscriptionStatusRoutes(
    app,
    pool,
    authenticateToken,
    requireReseller
  );

  console.log("Subscription payments module initialized.");
}

module.exports = {
  installSubscriptionPayments,
  SUBSCRIPTION_PLANS
};
