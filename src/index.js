const express = require("express");
const { pool } = require("./db");
const { register, metricsMiddleware } = require("./metrics");
const ordersRouter = require("./routes/orders");

const app = express();
const PORT = process.env.PORT || 3000;
// APP_VERSION is set at build time (see Dockerfile) and read back out
// here so /healthz can report exactly what got deployed, the detail
// Project 1's canary comparison and Project 2's build integrity work
// both need to be able to trust.
const APP_VERSION = process.env.APP_VERSION || "dev";

app.use(express.json());
app.use(metricsMiddleware);

app.use("/orders", ordersRouter);

app.get("/healthz", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", version: APP_VERSION });
  } catch (err) {
    res.status(503).json({ status: "unhealthy", error: err.message });
  }
});

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal error" });
});

app.listen(PORT, () => {
  console.log(`CanaryDeck ${APP_VERSION} listening on ${PORT}`);
});

module.exports = app;
