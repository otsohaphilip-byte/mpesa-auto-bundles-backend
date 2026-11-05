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

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
