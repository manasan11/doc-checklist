const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env'), override: true });

const config = require('./src/config');
const app = require('./src/app');

const PORT = config.port || 5000;

function startListening(port, retries = 5) {
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Document Checklist API running on http://localhost:${port}`);
    console.log(`Environment: ${config.env || 'development'}`);
    console.log(`Database connected: ${config.db.database}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Port ${port} in use] Retrying in 1s... (${retries} attempts left)`);
      if (retries > 0) {
        setTimeout(() => {
          startListening(port, retries - 1);
        }, 1000);
      } else {
        console.error(`Port ${port} is occupied by another process.`);
        process.exit(1);
      }
    } else {
      console.error('[Server Error]:', err);
    }
  });
}

startListening(PORT);

module.exports = app;
