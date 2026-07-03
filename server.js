const express = require("express");
const cors = require("cors");
require("dotenv").config();
const connectToDatabase = require("./config/db");

const app = express();

// Register global middleware that all incoming API requests pass through.
app.use(cors());
app.use(express.json());

// health-check endpoint for uptime checks and quick local verification.
app.get("/api/health", (req, res) => {
  console.log("Health check received");
  res.json({ status: "OK", message: "Save2Grow API is running" });
});

app.use("/api", async (req, res, next) => {
  try {
    await connectToDatabase();
    next();
  } catch (err) {
    console.warn("MongoDB not available - Running in DEMO MODE");
    console.warn(`Connection error: ${err.message}`);
    next(err);
  }
});

// Mount the main API route groups under their public URL prefixes.
app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/users"));
app.use("/api/goals", require("./routes/goals"));
app.use("/api/transactions", require("./routes/transactions"));
app.use("/api/challenges", require("./routes/challenges"));

// Final fallback error handler so unexpected server errors return a consistent JSON response.
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

if (require.main === module) {
  const PORT = process.env.PORT || 5000;

  connectToDatabase()
    .then(() => {
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Save2Grow API running...`);
      });
    })
    .catch((err) => {
      console.warn("MongoDB not available - Running in DEMO MODE");
      console.warn(`Connection error: ${err.message}`);
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Save2Grow API running...`);
      });
    });
}

module.exports = app;
