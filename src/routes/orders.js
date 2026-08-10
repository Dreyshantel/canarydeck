const express = require("express");
const { pool } = require("../db");
const { createOrderSchema, updateStatusSchema } = require("../validation");
const { orderErrorsTotal } = require("../metrics");

const router = express.Router();

router.get("/", async (req, res) => {
  const result = await pool.query(
    "SELECT id, customer_name, item, quantity, total_cents, status, created_at FROM orders ORDER BY created_at DESC LIMIT 100"
  );
  res.json(result.rows);
});

router.get("/:id", async (req, res) => {
  const result = await pool.query("SELECT * FROM orders WHERE id = $1", [req.params.id]);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Not found" });
  }
  res.json(result.rows[0]);
});

router.post("/", async (req, res) => {
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid order data" });
  }
  const { customerName, item, quantity, totalCents } = parsed.data;

  try {
    const result = await pool.query(
      `INSERT INTO orders (customer_name, item, quantity, total_cents, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING id, customer_name, item, quantity, total_cents, status, created_at`,
      [customerName, item, quantity, totalCents]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    orderErrorsTotal.inc();
    throw err;
  }
});

router.patch("/:id/status", async (req, res) => {
  const parsed = updateStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid status" });
  }

  try {
    const result = await pool.query(
      "UPDATE orders SET status = $1 WHERE id = $2 RETURNING id, status",
      [parsed.data.status, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    orderErrorsTotal.inc();
    throw err;
  }
});

module.exports = router;
