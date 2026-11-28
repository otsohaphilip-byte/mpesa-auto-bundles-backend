
const crypto = require("crypto");

async function installUssdDevices(
  app,
  pool,
  authenticateToken,
  requireReseller,
  requireAdmin
) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reseller_ussd_devices (
      id BIGSERIAL PRIMARY KEY,
      reseller_id BIGINT UNIQUE NOT NULL REFERENCES resellers(id),
      phone VARCHAR(20) UNIQUE NOT NULL,
      device_name VARCHAR(150) NOT NULL,
      device_token_hash TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'offline',
      airtime_balance NUMERIC(12,2),
      last_seen TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS admin_ussd_devices (
      id BIGSERIAL PRIMARY KEY,
      admin_phone VARCHAR(20) UNIQUE NOT NULL,
      phone VARCHAR(20) UNIQUE NOT NULL,
      device_name VARCHAR(150) NOT NULL,
      device_token_hash TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'offline',
      airtime_balance NUMERIC(12,2),
      last_seen TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
        CREATE TABLE IF NOT EXISTS airtime_transfer_confirmations (
      id BIGSERIAL PRIMARY KEY,
      transfer_id BIGINT REFERENCES airtime_transfer_requests(id),
      admin_device_id BIGINT REFERENCES admin_ussd_devices(id),
      sender_phone VARCHAR(20) NOT NULL,
      airtime_amount NUMERIC(12,2) NOT NULL,
      message_body TEXT NOT NULL,
      message_hash VARCHAR(64) UNIQUE NOT NULL,
      received_at TIMESTAMPTZ NOT NULL,
      verification_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Register reseller gateway phone
  app.post(
    "/api/reseller/ussd/device",
    authenticateToken,
    requireReseller,
    async (req, res) => {
      try {
        let phone = String(req.body.phone || "")
          .replace(/\D/g, "");

        if (phone.startsWith("254")) {
          phone = "0" + phone.substring(3);
        }

        if (!/^(07|01)\d{8}$/.test(phone)) {
          return res.status(400).json({
            status: "ERROR",
            message: "Enter a valid Kenyan mobile number."
          });
        }
                const resellerTillResult = await pool.query(
          `SELECT till_phone
           FROM resellers
           WHERE id = $1`,
          [req.user.resellerId]
        );

        if (resellerTillResult.rowCount === 0) {
          return res.status(404).json({
            status: "ERROR",
            message: "Reseller account not found."
          });
        }

        const registeredTillPhone = String(
          resellerTillResult.rows[0].till_phone || ""
        ).replace(/\D/g, "");

        const normalizedTillPhone = registeredTillPhone.startsWith("254")
          ? "0" + registeredTillPhone.substring(3)
          : registeredTillPhone;

        if (phone !== normalizedTillPhone) {
          return res.status(400).json({
            status: "ERROR",
            message: "Gateway phone must be the same SIM number registered for your Buy Goods Till."
          });
        }

        const deviceName = String(
          req.body.device_name || ""
        ).trim();

        if (!deviceName || deviceName.length > 150) {
          return res.status(400).json({
            status: "ERROR",
            message: "Enter a valid device name."
          });
        }

        const adminDevice = await pool.query(
          `SELECT id FROM admin_ussd_devices
           WHERE phone = $1`,
          [phone]
        );

        if (adminDevice.rows.length > 0) {
          return res.status(409).json({
            status: "ERROR",
            message: "This phone is already registered as the administrator gateway."
          });
        }

        const deviceToken = crypto.randomBytes(32).toString("hex");

        const tokenHash = crypto
          .createHash("sha256")
          .update(deviceToken)
          .digest("hex");

        const result = await pool.query(
          `INSERT INTO reseller_ussd_devices (
             reseller_id,
             phone,
             device_name,
             device_token_hash,
             status,
             updated_at
           )
           VALUES ($1, $2, $3, $4, 'offline', NOW())
           ON CONFLICT (reseller_id)
           DO UPDATE SET
             phone = EXCLUDED.phone,
             device_name = EXCLUDED.device_name,
             device_token_hash = EXCLUDED.device_token_hash,
             status = 'offline',
             updated_at = NOW()
           RETURNING id, phone, device_name, status`,
          [
            req.user.resellerId,
            phone,
            deviceName,
            tokenHash
          ]
        );

        res.json({
          status: "SUCCESS",
          message: "Gateway device registered.",
          device: result.rows[0],
          device_token: deviceToken
        });

      } catch (error) {
        console.error("Reseller gateway registration error:", error);

        res.status(500).json({
          status: "ERROR",
          message: "Could not register gateway device."
        });
      }
    }
  );

  // Get reseller gateway details
  app.get(
    "/api/reseller/ussd/device",
    authenticateToken,
    requireReseller,
    async (req, res) => {
      try {
        const result = await pool.query(
          `SELECT id, phone, device_name, status,
                  airtime_balance, last_seen, created_at
           FROM reseller_ussd_devices
           WHERE reseller_id = $1`,
          [req.user.resellerId]
        );

        res.json({
          status: "OK",
          device: result.rows[0] || null
        });

      } catch (error) {
        console.error("Reseller gateway status error:", error);

        res.status(500).json({
          status: "ERROR",
          message: "Could not load gateway status."
        });
      }
    }
  );

  // Register administrator gateway phone
  app.post(
    "/api/admin/ussd/device",
    authenticateToken,
    requireAdmin,
    async (req, res) => {
      try {
        let phone = String(req.body.phone || "")
          .replace(/\D/g, "");

        if (phone.startsWith("254")) {
          phone = "0" + phone.substring(3);
        }

        if (!/^(07|01)\d{8}$/.test(phone)) {
          return res.status(400).json({
            status: "ERROR",
            message: "Enter a valid Kenyan mobile number."
          });
        }
                let adminTillPhone = String(
          process.env.ADMIN_TILL_PHONE || ""
        ).replace(/\D/g, "");

        if (adminTillPhone.startsWith("254")) {
          adminTillPhone = "0" + adminTillPhone.substring(3);
        }

        if (!/^(07|01)\d{8}$/.test(adminTillPhone)) {
          return res.status(500).json({
            status: "ERROR",
            message: "Admin Till phone is not configured correctly."
          });
        }

        if (phone !== adminTillPhone) {
          return res.status(400).json({
            status: "ERROR",
            message: "Admin gateway phone must be the SIM number registered for the Admin Buy Goods Till."
          });
        }

        const deviceName = String(
          req.body.device_name || ""
        ).trim();

        if (!deviceName || deviceName.length > 150) {
          return res.status(400).json({
            status: "ERROR",
            message: "Enter a valid device name."
          });
        }

        const resellerDevice = await pool.query(
          `SELECT id FROM reseller_ussd_devices
           WHERE phone = $1`,
          [phone]
        );

        if (resellerDevice.rows.length > 0) {
          return res.status(409).json({
            status: "ERROR",
            message: "This phone is already registered to a reseller gateway."
          });
        }

        const deviceToken = crypto.randomBytes(32).toString("hex");

        const tokenHash = crypto
          .createHash("sha256")
          .update(deviceToken)
          .digest("hex");

        const result = await pool.query(
          `INSERT INTO admin_ussd_devices (
             admin_phone,
             phone,
             device_name,
             device_token_hash,
             status,
             updated_at
           )
           VALUES ($1, $2, $3, $4, 'offline', NOW())
           ON CONFLICT (admin_phone)
           DO UPDATE SET
             phone = EXCLUDED.phone,
             device_name = EXCLUDED.device_name,
             device_token_hash = EXCLUDED.device_token_hash,
             status = 'offline',
             updated_at = NOW()
           RETURNING id, phone, device_name, status`,
          [
            req.user.phone,
            phone,
            deviceName,
            tokenHash
          ]
        );

        res.json({
          status: "SUCCESS",
          message: "Administrator gateway device registered.",
          device: result.rows[0],
          device_token: deviceToken
        });

      } catch (error) {
        console.error("Administrator gateway registration error:", error);

        res.status(500).json({
          status: "ERROR",
          message: "Could not register administrator gateway device."
        });
      }
    }
  );

  // Get administrator gateway details
  app.get(
    "/api/admin/ussd/device",
    authenticateToken,
    requireAdmin,
    async (req, res) => {
      try {
        const result = await pool.query(
                    `SELECT id, phone, device_name,
                  CASE
                    WHEN last_seen IS NOT NULL
                     AND last_seen >= NOW() - INTERVAL '10 minutes'
                    THEN 'online'
                    ELSE 'offline'
                  END AS status,
                  airtime_balance, last_seen, created_at
           FROM admin_ussd_devices
           WHERE admin_phone = $1`,
          [req.user.phone]
        );

        res.json({
          status: "OK",
          device: result.rows[0] || null
        });

      } catch (error) {
        console.error("Administrator gateway status error:", error);

        res.status(500).json({
          status: "ERROR",
          message: "Could not load administrator gateway status."
        });
      }
    }
  );
    // Receive Admin gateway phone heartbeat
  app.post(
    "/api/admin/ussd/device/heartbeat",
    async (req, res) => {
      try {
        const deviceToken = String(
          req.headers["x-device-token"] || ""
        );

        if (!deviceToken) {
          return res.status(401).json({
            status: "ERROR",
            message: "Gateway device token is required."
          });
        }

        const tokenHash = crypto
          .createHash("sha256")
          .update(deviceToken)
          .digest("hex");

        let airtimeBalance = null;

        if (req.body.airtime_balance !== undefined) {
          airtimeBalance = Number(req.body.airtime_balance);

          if (
            !Number.isFinite(airtimeBalance) ||
            airtimeBalance < 0
          ) {
            return res.status(400).json({
              status: "ERROR",
              message: "Invalid airtime balance."
            });
          }
        }

        const result = await pool.query(
          `UPDATE admin_ussd_devices
           SET status = 'online',
               airtime_balance = COALESCE($2, airtime_balance),
               last_seen = NOW(),
               updated_at = NOW()
           WHERE device_token_hash = $1
           RETURNING phone, status, airtime_balance, last_seen`,
          [tokenHash, airtimeBalance]
        );

        if (result.rows.length === 0) {
          return res.status(401).json({
            status: "ERROR",
            message: "Invalid gateway device token."
          });
        }

        res.json({
          status: "SUCCESS",
          device: result.rows[0]
        });

      } catch (error) {
        console.error("Admin gateway heartbeat error:", error);

        res.status(500).json({
          status: "ERROR",
          message: "Could not update Admin gateway status."
        });
      }
    }
  );
    // Receive Reseller gateway phone heartbeat
  app.post(
    "/api/reseller/ussd/device/heartbeat",
    async (req, res) => {
      try {
        const deviceToken = String(
          req.headers["x-device-token"] || ""
        );

        if (!deviceToken) {
          return res.status(401).json({
            status: "ERROR",
            message: "Gateway device token is required."
          });
        }

        const tokenHash = crypto
          .createHash("sha256")
          .update(deviceToken)
          .digest("hex");

        let airtimeBalance = null;

        if (req.body.airtime_balance !== undefined) {
          airtimeBalance = Number(req.body.airtime_balance);

          if (
            !Number.isFinite(airtimeBalance) ||
            airtimeBalance < 0
          ) {
            return res.status(400).json({
              status: "ERROR",
              message: "Invalid airtime balance."
            });
          }
        }

        const result = await pool.query(
          `UPDATE reseller_ussd_devices
           SET status = 'online',
               airtime_balance = COALESCE($2, airtime_balance),
               last_seen = NOW(),
               updated_at = NOW()
           WHERE device_token_hash = $1
           RETURNING phone, status, airtime_balance, last_seen`,
          [tokenHash, airtimeBalance]
        );

        if (result.rows.length === 0) {
          return res.status(401).json({
            status: "ERROR",
            message: "Invalid gateway device token."
          });
        }

        res.json({
          status: "SUCCESS",
          device: result.rows[0]
        });

      } catch (error) {
        console.error("Reseller gateway heartbeat error:", error);

        res.status(500).json({
          status: "ERROR",
          message: "Could not update Reseller gateway status."
        });
      }
    }
  );
  // Allow registered gateway phones to claim one delivery job
  app.post(
    "/api/ussd/jobs/claim",
    async (req, res) => {
      const client = await pool.connect();

      try {
        const deviceToken = String(
          req.headers["x-device-token"] || ""
        );

        if (!deviceToken) {
          return res.status(401).json({
            status: "ERROR",
            message: "Gateway device token is required."
          });
        }

        const tokenHash = crypto
          .createHash("sha256")
          .update(deviceToken)
          .digest("hex");

        const admin = await client.query(
          `SELECT admin_phone
           FROM admin_ussd_devices
           WHERE device_token_hash = $1`,
          [tokenHash]
        );

        let gatewayRole;
        let gatewayId;

        if (admin.rows.length > 0) {
          gatewayRole = "admin";
          gatewayId = admin.rows[0].admin_phone;
        } else {
          const reseller = await client.query(
            `SELECT reseller_id
             FROM reseller_ussd_devices
             WHERE device_token_hash = $1`,
            [tokenHash]
          );

          if (reseller.rows.length === 0) {
            return res.status(401).json({
              status: "ERROR",
              message: "Invalid gateway device token."
            });
          }

          gatewayRole = "reseller";
          gatewayId = reseller.rows[0].reseller_id;
        }

        const result = await client.query(
          `UPDATE delivery_jobs
           SET status = 'claimed',
               attempt_count = attempt_count + 1,
               claimed_at = NOW(),
               updated_at = NOW()
           WHERE id = (
             SELECT id
             FROM delivery_jobs
             WHERE status = 'queued'
               AND gateway_role = $1
               AND (
                                   ($1 = 'admin' AND admin_phone = $2::text)
                  OR
                  ($1 = 'reseller' AND reseller_id::text = $2::text)
               )
             ORDER BY created_at ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED
           )
           RETURNING id, gateway_role, reseller_id,
                     admin_phone, offer_id, offer_name,
                     destination_phone, amount, ussd_code`,
          [gatewayRole, gatewayId]
        );

        res.json({
          status: "SUCCESS",
          job: result.rows[0] || null
        });

      } catch (error) {
        console.error("Gateway job claim error:", error);

        res.status(500).json({
          status: "ERROR",
          message: "Could not retrieve delivery job."
        });

      } finally {
        client.release();
      }
    }
  );
    // Allow reseller gateway phones to claim Sambaza transfers
  app.post(
    "/api/ussd/airtime-transfers/claim",
    async (req, res) => {
      try {
        const deviceToken = String(
          req.headers["x-device-token"] || ""
        );

        if (!deviceToken) {
          return res.status(401).json({
            status: "ERROR",
            message: "Gateway device token is required."
          });
        }

        const tokenHash = crypto
          .createHash("sha256")
          .update(deviceToken)
          .digest("hex");

        const gateway = await pool.query(
          `SELECT reseller_id
           FROM reseller_ussd_devices
           WHERE device_token_hash = $1`,
          [tokenHash]
        );

        if (gateway.rows.length === 0) {
          return res.status(401).json({
            status: "ERROR",
            message: "Invalid reseller gateway device token."
          });
        }

        const resellerId = gateway.rows[0].reseller_id;

        const result = await pool.query(
          `WITH next_transfer AS (
             SELECT id
             FROM airtime_transfer_requests
             WHERE reseller_id = $1
               AND status = 'queued'
             ORDER BY created_at ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED
           )
           UPDATE airtime_transfer_requests AS transfer
           SET status = 'started',
               updated_at = NOW()
           FROM next_transfer
           WHERE transfer.id = next_transfer.id
           RETURNING transfer.id,
                     transfer.airtime_amount,
                     transfer.tokens_to_credit,
                     transfer.destination_phone,
                     transfer.ussd_code,
                     transfer.status`,
          [resellerId]
        );

        res.json({
          status: "SUCCESS",
          transfer: result.rows[0] || null
        });

      } catch (error) {
        console.error(
          "Sambaza transfer claim error:",
          error
        );

        res.status(500).json({
          status: "ERROR",
          message: "Could not retrieve airtime transfer."
        });
      }
    }
  );
  // Receive Sambaza USSD execution result
  app.post(
    "/api/ussd/airtime-transfers/result",
    async (req, res) => {
      try {
        const deviceToken = String(
          req.headers["x-device-token"] || ""
        );

        const transferId = Number(req.body.transferId);
        const transferStatus = String(
          req.body.status || ""
        );

        if (!deviceToken) {
          return res.status(401).json({
            status: "ERROR",
            message: "Gateway device token is required."
          });
        }

        if (
          !Number.isSafeInteger(transferId) ||
          transferId <= 0 ||
          ![
            "awaiting_confirmation",
            "failed",
            "uncertain"
          ].includes(transferStatus)
        ) {
          return res.status(400).json({
            status: "ERROR",
            message: "Invalid transfer result."
          });
        }

        const tokenHash = crypto
          .createHash("sha256")
          .update(deviceToken)
          .digest("hex");

        const gateway = await pool.query(
          `SELECT reseller_id
           FROM reseller_ussd_devices
           WHERE device_token_hash = $1`,
          [tokenHash]
        );

        if (gateway.rows.length === 0) {
          return res.status(401).json({
            status: "ERROR",
            message: "Invalid reseller gateway device token."
          });
        }

        const result = await pool.query(
          `UPDATE airtime_transfer_requests
           SET status = $1,
               updated_at = NOW()
           WHERE id = $2
             AND reseller_id = $3
             AND status = 'started'
           RETURNING id, status`,
          [
            transferStatus,
            transferId,
            gateway.rows[0].reseller_id
          ]
        );

        if (result.rows.length === 0) {
          return res.status(404).json({
            status: "ERROR",
            message: "Transfer not found or no longer active."
          });
        }

        res.json({
          status: "SUCCESS",
          transfer: result.rows[0],
          message: "USSD execution result recorded. Token credit still requires confirmation."
        });

      } catch (error) {
        console.error(
          "Sambaza transfer result error:",
          error
        );

        res.status(500).json({
          status: "ERROR",
          message: "Could not record transfer result."
        });
      }
    }
  );
    // Receive Sambaza confirmation SMS on the admin gateway
  app.post(
    "/api/admin/ussd/airtime-transfer-sms",
    async (req, res) => {
      const client = await pool.connect();

      try {
        const deviceToken = String(
          req.headers["x-device-token"] || ""
        );

        if (!deviceToken) {
          return res.status(401).json({
            status: "ERROR",
            message: "Gateway device token is required."
          });
        }

        const tokenHash = crypto
          .createHash("sha256")
          .update(deviceToken)
          .digest("hex");

        const device = await client.query(
          `SELECT id
           FROM admin_ussd_devices
           WHERE device_token_hash = $1`,
          [tokenHash]
        );

        if (device.rows.length === 0) {
          return res.status(401).json({
            status: "ERROR",
            message: "Invalid administrator gateway token."
          });
        }

        const messageBody = String(
          req.body.message_body || ""
        ).trim().slice(0, 2000);

        const receivedAt = new Date(
          req.body.received_at
        );

        const match = messageBody.match(
          /The subscriber\s+(\d{9,12})\s+transferred\s+(\d+(?:\.\d{1,2})?)\s+KSH\s+for you/i
        );

        if (
          !match ||
          !messageBody ||
          Number.isNaN(receivedAt.getTime())
        ) {
          return res.status(400).json({
            status: "ERROR",
            message: "SMS format or received time is invalid."
          });
        }

        let senderPhone = match[1];

        if (senderPhone.startsWith("254")) {
          senderPhone = "0" + senderPhone.substring(3);
        } else if (
          senderPhone.length === 9 &&
          /^[71]/.test(senderPhone)
        ) {
          senderPhone = "0" + senderPhone;
        }

        if (!/^(07|01)\d{8}$/.test(senderPhone)) {
          return res.status(400).json({
            status: "ERROR",
            message: "Sender phone number is invalid."
          });
        }

        const airtimeAmount = Number(match[2]);

        const messageHash = crypto
          .createHash("sha256")
          .update(
            device.rows[0].id + "|" +
            senderPhone + "|" +
            messageBody + "|" +
            receivedAt.toISOString()
          )
          .digest("hex");

        await client.query("BEGIN");

        const candidates = await client.query(
          `SELECT transfer.id
           FROM airtime_transfer_requests AS transfer
           JOIN reseller_ussd_devices AS gateway
             ON gateway.reseller_id = transfer.reseller_id
           WHERE
             CASE
               WHEN LEFT(
                 REGEXP_REPLACE(gateway.phone, '\\D', '', 'g'),
                 3
               ) = '254'
               THEN '0' || SUBSTRING(
                 REGEXP_REPLACE(gateway.phone, '\\D', '', 'g')
                 FROM 4
               )
               ELSE REGEXP_REPLACE(
                 gateway.phone, '\\D', '', 'g'
               )
             END = $1
             AND transfer.airtime_amount = $2
             AND transfer.status IN (
               'started',
               'awaiting_confirmation',
               'uncertain'
             )
             AND transfer.created_at BETWEEN
               $3::timestamptz - INTERVAL '15 minutes'
               AND
               $3::timestamptz + INTERVAL '2 minutes'
           ORDER BY transfer.created_at DESC
           LIMIT 2
           FOR UPDATE OF transfer`,
          [
            senderPhone,
            airtimeAmount,
            receivedAt.toISOString()
          ]
        );

        let transferId = null;
        let verificationStatus = "unmatched";

        if (candidates.rows.length === 1) {
          transferId = candidates.rows[0].id;
          verificationStatus = "matched";
        } else if (candidates.rows.length > 1) {
          verificationStatus = "ambiguous";
        }

        const saved = await client.query(
          `INSERT INTO airtime_transfer_confirmations (
             transfer_id,
             admin_device_id,
             sender_phone,
             airtime_amount,
             message_body,
             message_hash,
             received_at,
             verification_status
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (message_hash) DO NOTHING
           RETURNING id, verification_status`,
          [
            transferId,
            device.rows[0].id,
            senderPhone,
            airtimeAmount,
            messageBody,
            messageHash,
            receivedAt.toISOString(),
            verificationStatus
          ]
        );

        if (saved.rows.length === 0) {
          await client.query("ROLLBACK");

          return res.json({
            status: "SUCCESS",
            duplicate: true,
            message: "This confirmation SMS was already received."
          });
        }

                if (
          transferId !== null &&
          verificationStatus === "matched"
        ) {
          const transfer = await client.query(
            `SELECT reseller_id, airtime_amount,
                    tokens_to_credit
             FROM airtime_transfer_requests
             WHERE id = $1
               AND status IN (
                 'started',
                 'awaiting_confirmation',
                 'uncertain'
               )
             FOR UPDATE`,
            [transferId]
          );

          if (transfer.rows.length === 1) {
            const item = transfer.rows[0];

            const marked = await client.query(
              `UPDATE airtime_transfer_requests
               SET status = 'credited',
                   confirmation_sms_hash = $2,
                   confirmed_at = $3,
                   updated_at = NOW()
               WHERE id = $1
                 AND status IN (
                   'started',
                   'awaiting_confirmation',
                   'uncertain'
                 )
               RETURNING id`,
              [
                transferId,
                messageHash,
                receivedAt.toISOString()
              ]
            );

            if (marked.rows.length === 1) {
              await client.query(
                `INSERT INTO token_wallets (
                   reseller_id, balance
                 )
                 VALUES ($1, $2)
                 ON CONFLICT (reseller_id)
                 DO UPDATE SET
                   balance = token_wallets.balance
                     + EXCLUDED.balance`,
                [
                  item.reseller_id,
                  item.tokens_to_credit
                ]
              );

              await client.query(
                `INSERT INTO token_transactions (
                   reseller_id,
                   transaction_type,
                   amount,
                   reference
                 )
                 VALUES ($1, $2, $3, $4)`,
                [
                  item.reseller_id,
                  "airtime_purchase",
                  item.tokens_to_credit,
                  `airtime-transfer-${transferId}`
                ]
              );

              await client.query(
                `INSERT INTO airtime_ledger (
                   owner_type,
                   reseller_id,
                   transaction_type,
                   amount,
                   reference
                 )
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                  "admin",
                  item.reseller_id,
                  "reseller_airtime_received",
                  item.airtime_amount,
                  `airtime-transfer-${transferId}`
                ]
              );

              await client.query(
                `UPDATE airtime_transfer_confirmations
                 SET verification_status = 'credited'
                 WHERE id = $1`,
                [saved.rows[0].id]
              );
            }
          }
        }
        await client.query("COMMIT");

        res.json({
          status: "SUCCESS",
          confirmation: saved.rows[0],
          message: "Sambaza SMS recorded. Token credit is not yet applied."
        });

      } catch (error) {
        await client.query("ROLLBACK");

        console.error(
          "Admin Sambaza SMS reception error:",
          error
        );

        res.status(500).json({
          status: "ERROR",
          message: "Could not record Sambaza confirmation SMS."
        });

      } finally {
        client.release();
      }
    }
  );
  // Receive delivery result from a registered gateway
  app.post(
    "/api/ussd/jobs/result",
    async (req, res) => {
      try {
        const deviceToken = String(
          req.headers["x-device-token"] || ""
        );

        if (!deviceToken) {
          return res.status(401).json({
            status: "ERROR",
            message: "Gateway device token is required."
          });
        }

        const tokenHash = crypto
          .createHash("sha256")
          .update(deviceToken)
          .digest("hex");

        const admin = await pool.query(
          `SELECT admin_phone
           FROM admin_ussd_devices
           WHERE device_token_hash = $1`,
          [tokenHash]
        );

        let gatewayRole;
        let gatewayId;

        if (admin.rows.length > 0) {
          gatewayRole = "admin";
          gatewayId = admin.rows[0].admin_phone;
        } else {
          const reseller = await pool.query(
            `SELECT reseller_id
             FROM reseller_ussd_devices
             WHERE device_token_hash = $1`,
            [tokenHash]
          );

          if (reseller.rows.length === 0) {
            return res.status(401).json({
              status: "ERROR",
              message: "Invalid gateway device token."
            });
          }

          gatewayRole = "reseller";
          gatewayId = reseller.rows[0].reseller_id;
        }

        const jobId = Number(req.body.job_id);
        const resultStatus = String(
          req.body.status || ""
        ).toLowerCase();

        const allowedStatuses = [
          "success",
          "failed",
          "uncertain"
        ];

        if (
          !Number.isSafeInteger(jobId) ||
          jobId <= 0 ||
          !allowedStatuses.includes(resultStatus)
        ) {
          return res.status(400).json({
            status: "ERROR",
            message: "Invalid job ID or delivery status."
          });
        }

        const responseText = String(
          req.body.safaricom_response || ""
        ).slice(0, 2000);

        const result = await pool.query(
          `UPDATE delivery_jobs
           SET status = $1,
               last_error = CASE
                 WHEN $1 = 'success' THEN NULL
                 ELSE $2
               END,
               completed_at = NOW(),
               updated_at = NOW()
           WHERE id = $3
             AND status IN ('claimed', 'running')
             AND gateway_role = $4
             AND (
               ($4 = 'admin' AND admin_phone = $5::text)
               OR
               ($4 = 'reseller' AND reseller_id::text = $5::text)
             )
           RETURNING id, status`,
          [
            resultStatus,
            responseText,
            jobId,
            gatewayRole,
            gatewayId
          ]
        );

                if (result.rows.length === 0) {
          const existing = await pool.query(
            `SELECT id, status
             FROM delivery_jobs
             WHERE id = $1
               AND gateway_role = $2
               AND (
                 ($2 = 'admin' AND admin_phone = $3::text)
                 OR
                 ($2 = 'reseller' AND reseller_id::text = $3::text)
               )`,
            [jobId, gatewayRole, gatewayId]
          );

          if (existing.rows.length === 0) {
            return res.status(404).json({
              status: "ERROR",
              message: "Job not found or not assigned to this gateway."
            });
          }

          if (existing.rows[0].status !== resultStatus) {
            return res.status(409).json({
              status: "ERROR",
              message: "Job already has a different delivery result."
            });
          }

          return res.json({
            status: "SUCCESS",
            already_recorded: true,
            job: existing.rows[0]
          });
          }

        res.json({
          status: "SUCCESS",
          job: result.rows[0]
        });

      } catch (error) {
        console.error("Gateway delivery result error:", error);

        res.status(500).json({
          status: "ERROR",
          message: "Could not save delivery result."
        });
      }
    }
  );
  console.log("Admin and reseller USSD gateway routes initialized.");
}

module.exports = {
  installUssdDevices
};
        
