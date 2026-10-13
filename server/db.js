"use strict";
const fs = require("fs");
const path = require("path");
const { Pool, types } = require("pg");

// numeric -> number, date -> 'YYYY-MM-DD' (sin zona horaria)
types.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));
types.setTypeParser(1082, v => v);

let pool = null;
function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL || "postgres://gastos:gastos@localhost:5432/gastos_ti" });
  }
  return pool;
}

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
  await getPool().query(sql);
}

module.exports = {
  get pool() { return getPool(); },
  migrate,
  query: (text, params) => getPool().query(text, params),
};
