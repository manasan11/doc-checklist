const mysql = require('mysql2/promise');
const config = require('./index');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit || 10,
  queueLimit: 0,
  charset: config.db.charset || 'utf8mb4',
  connectTimeout: config.db.connectTimeout || 20000
});

// Provide direct query access and backward-compatible references
pool.getPool = () => pool;

module.exports = pool;
