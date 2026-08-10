const { z } = require("zod");

const createOrderSchema = z.object({
  customerName: z.string().min(1).max(200),
  item: z.string().min(1).max(200),
  quantity: z.number().int().positive().max(10000),
  // stored as integer cents, never a float, same pattern as LedgerLite
  totalCents: z.number().int().nonnegative().max(100_000_000),
});

const updateStatusSchema = z.object({
  status: z.enum(["pending", "fulfilled", "cancelled"]),
});

module.exports = { createOrderSchema, updateStatusSchema };
