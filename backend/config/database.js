const mysql = require('mysql2/promise');
const config = require('./index');

let pool = null;
let isConnected = false;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      waitForConnections: true,
      connectionLimit: config.db.connectionLimit,
      queueLimit: 0,
      charset: config.db.charset,
      connectTimeout: config.db.connectTimeout,
      ssl: false
    });
  }
  return pool;
}

async function initDatabase() {
  try {
    const dbPool = getPool();
    const conn = await dbPool.getConnection();
    conn.release();
    isConnected = true;
    console.log(`[MySQL] Connected successfully to database: "${config.db.database}"`);
    return true;
  } catch (err) {
    isConnected = false;
    console.error('[MySQL] Connection warning:', err.message);
    return false;
  }
}

function isDbConnected() {
  return isConnected;
}

module.exports = {
  getPool,
  initDatabase,
  isDbConnected
};
