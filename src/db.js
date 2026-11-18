const postgres = require('postgres');
const config = require('./config');

// Use the Supabase "Session pooler" connection string. prepare:false keeps this
// working if you ever switch to the transaction pooler.
const sql = postgres(config.databaseUrl, {
  ssl: 'require',
  max: Number(process.env.DB_POOL_MAX) || 3,   // a small pool is plenty and keeps memory and database connections low
  idle_timeout: 0,          // never close a quiet connection: reconnecting to the database is slow, and the first member to press a button paid for it
  connect_timeout: 15,
  prepare: false,
});

module.exports = sql;
