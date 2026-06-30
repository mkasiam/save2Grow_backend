const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const app = express();

// Register global middleware that all incoming API requests pass through.
app.use(cors());
app.use(express.json());

// Connect to MongoDB using Mongoose.
const mongoURI = process.env.MONGODB_URI;
const PORT = process.env.PORT || 5000;

mongoose
  .connect(mongoURI)
  .then(
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Save2Grow API running...`);
    }),
  )
  .catch((err) => {
    console.warn("MongoDB not available - Running in DEMO MODE");
    console.warn(`Connection error: ${err.message}`);
  });

// Mount the main API route groups under their public URL prefixes.
app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/users"));
app.use("/api/goals", require("./routes/goals"));
app.use("/api/transactions", require("./routes/transactions"));
app.use("/api/challenges", require("./routes/challenges"));

// Lightweight health-check endpoint for uptime checks and quick local verification.
app.get("/api/health", (req, res) => {
  console.log("Health check received");
  res.json({ status: "OK", message: "Save2Grow API is running" });
});

// Final fallback error handler so unexpected server errors return a consistent JSON response.
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});
