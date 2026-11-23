const crypto = require("crypto");

async function installUssdDevices(
  app,
  pool,
  authenticateToken,
  requireReseller
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
  `);

  // Register the reseller's gateway phone
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
        console.error("Gateway registration error:", error);

        res.status(500).json({
          status: "ERROR",
          message: "Could not register gateway device."
        });
      }
    }
  );

  // Get registered gateway details
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
        console.error("Gateway status error:", error);

        res.status(500).json({
          status: "ERROR",
          message: "Could not load gateway status."
        });
      }
    }
  );

  console.log("USSD gateway device routes initialized.");
}

module.exports = {
  installUssdDevices
};
