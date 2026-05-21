require('dotenv').config();
const { pool } = require('./db');

async function fixTable() {
  try {
    await pool.query("ALTER TABLE users MODIFY pwd VARCHAR(255) NOT NULL DEFAULT '';");
    console.log("Table users altered successfully.");
  } catch (err) {
    console.error("Error altering table:", err);
  } finally {
    process.exit(0);
  }
}

fixTable();
