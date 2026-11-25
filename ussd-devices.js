
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
  console.log("Admin and reseller USSD gateway routes initialized.");
}

module.exports = {
  installUssdDevices
};
        
