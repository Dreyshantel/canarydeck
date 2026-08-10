const { Pool } = require("pg");

// Standard pooled connection. Nothing DevOps-specific here, the
// interesting work in this repo is what happens AROUND this app during
// a release, not inside it.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

module.exports = { pool };
