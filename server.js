const express = require("express");
require("dotenv").config();

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.send("M-Pesa Auto Bundles backend is running.");
});

app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    application: "M-Pesa Auto Bundles"
  });
});

// Generate a Safaricom Daraja access token
async function getDarajaAccessToken() {
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;

  if (!key || !secret) {
    throw new Error("Daraja credentials are missing.");
  }

  const credentials = Buffer.from(`${key}:${secret}`).toString("base64");

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

// Protected authentication test
app.get("/api/mpesa/auth-check", async (req, res) => {
  const testSecret = process.env.MPESA_TEST_SECRET;

  if (!testSecret) {
    return res.status(503).json({
      status: "ERROR",
      message: "Test protection is not configured."
    });
  }

  if (req.get("x-test-key") !== testSecret) {
    return res.status(401).json({
      status: "ERROR",
      message: "Not authorized."
    });
  }

  try {
    await getDarajaAccessToken();

    res.json({
      status: "OK",
      message: "Daraja sandbox authentication successful."
    });
  } catch (error) {
    console.error("Daraja authentication failed:", error.message);

    res.status(502).json({
      status: "ERROR",
      message: "Daraja authentication failed. Check credentials and settings."
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
