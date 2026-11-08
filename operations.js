// M-Pesa Auto Bundles - Operations Module

function isWithinDailyWindow(start, end, date = new Date()) {
  if (!start && !end) return true;
  if (!start || !end) return false;

  const validTime = value =>
    /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value);

  if (!validTime(start) || !validTime(end)) return false;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const hour = Number(parts.find(p => p.type === "hour").value);
  const minute = Number(parts.find(p => p.type === "minute").value);
  const current = hour * 60 + minute;

  const toMinutes = value => {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  };

  const from = toMinutes(start);
  const until = toMinutes(end);

  if (from === until) return false;

  if (from < until) {
    return current >= from && current < until;
  }

  return current >= from || current < until;
}

async function getSalesPaused(pool) {
  const result = await pool.query(
    "SELECT sales_paused FROM platform_settings WHERE id = 1"
  );

  return result.rows.length
    ? result.rows[0].sales_paused
    : false;
}

async function installOperations(
  app,
  pool,
  authenticateToken,
  requireAdmin,
  requireReseller
) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      sales_paused BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    INSERT INTO platform_settings (id, sales_paused)
    VALUES (1, FALSE)
    ON CONFLICT (id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS reseller_notifications (
      id BIGSERIAL PRIMARY KEY,
      reseller_id BIGINT NOT NULL REFERENCES resellers(id),
      title VARCHAR(150) NOT NULL,
      message TEXT NOT NULL,
      notification_type VARCHAR(30) DEFAULT 'system',
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE offers
      ADD COLUMN IF NOT EXISTS daily_start_time TIME;

    ALTER TABLE offers
      ADD COLUMN IF NOT EXISTS daily_end_time TIME;
  `);

  // Check platform sales status
  app.get(
    "/api/system/sales-status",
    authenticateToken,
    async (req, res) => {
      try {
        const paused = await getSalesPaused(pool);

        res.json({
          status: "OK",
          salesPaused: paused
        });
      } catch (error) {
        console.error("Sales status error:", error);
        res.status(500).json({
          status: "ERROR",
          message: "Could not load sales status."
        });
      }
    }
  );

  // Admin pauses or resumes platform sales
  app.patch(
    "/api/admin/system/sales-status",
    authenticateToken,
    requireAdmin,
    async (req, res) => {
      try {
        const { paused } = req.body;

        if (typeof paused !== "boolean") {
          return res.status(400).json({
            status: "ERROR",
            message: "Paused must be true or false."
          });
        }

        const previous = await getSalesPaused(pool);

        await pool.query(
          `UPDATE platform_settings
           SET sales_paused = $1, updated_at = NOW()
           WHERE id = 1`,
          [paused]
        );

        if (previous !== paused) {
          const title = paused
            ? "Platform sales paused"
            : "Platform sales resumed";

          const message = paused
            ? "The administrator has paused new platform sales. Your existing paid orders remain recorded."
            : "The administrator has resumed platform sales.";

          await pool.query(
            `INSERT INTO reseller_notifications
             (reseller_id, title, message, notification_type)
             SELECT id, $1, $2, 'system'
             FROM resellers`,
            [title, message]
          );
        }

        res.json({
          status: "OK",
          salesPaused: paused
        });
      } catch (error) {
        console.error("Update sales status error:", error);
        res.status(500).json({
          status: "ERROR",
          message: "Could not update sales status."
        });
      }
    }
  );

  // Reseller notification history
  app.get(
    "/api/resellers/notifications",
    authenticateToken,
    requireReseller,
    async (req, res) => {
      try {
        const result = await pool.query(
          `SELECT id, title, message, notification_type,
                  read_at, created_at
           FROM reseller_notifications
           WHERE reseller_id = $1
           ORDER BY created_at DESC
           LIMIT 100`,
          [req.user.resellerId]
        );

        res.json({
          status: "OK",
          notifications: result.rows
        });
      } catch (error) {
        console.error("Notifications error:", error);
        res.status(500).json({
          status: "ERROR",
          message: "Could not load notifications."
        });
      }
    }
  );

  // Mark one reseller notification as read
  app.patch(
    "/api/resellers/notifications/:id/read",
    authenticateToken,
    requireReseller,
    async (req, res) => {
      try {
        const result = await pool.query(
          `UPDATE reseller_notifications
           SET read_at = NOW()
           WHERE id = $1 AND reseller_id = $2
           RETURNING id`,
          [req.params.id, req.user.resellerId]
        );

        if (!result.rows.length) {
          return res.status(404).json({
            status: "ERROR",
            message: "Notification not found."
          });
        }

        res.json({ status: "OK" });
      } catch (error) {
        console.error("Mark notification error:", error);
        res.status(500).json({
          status: "ERROR",
          message: "Could not update notification."
        });
      }
    }
  );

  console.log("Operations module initialized.");
}

module.exports = {
  installOperations,
  getSalesPaused,
  isWithinDailyWindow
};
