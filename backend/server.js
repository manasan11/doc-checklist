const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env'), override: true });

const config = require('./src/config');
const app = require('./src/app');
const { initDatabase } = require('./src/config/database');
const studentService = require('./src/modules/students/student.service');
const documentService = require('./src/modules/documents/document.service');
const { execSync } = require('child_process');

process.on('uncaughtException', (err) => {
  console.error('[Process Error] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process Error] Unhandled Rejection at:', promise, 'reason:', reason);
});

function listenOnPort(port, retries = 3) {
  const server = app.listen(port, () => {
    console.log(`=======================================================`);
    console.log(`Document Checklist API running on http://localhost:${port}`);
    console.log(`Architecture: Hybrid Modular Architecture (src/ based)`);
    console.log(`Mode: Google Drive Integration Enabled`);
    console.log(`Database: MySQL (${config.db.database}) Connected - Dynamic Users Enabled`);
    console.log(`=======================================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Port ${port} in use] Automatically clearing zombie process on port ${port}...`);
      try {
        if (process.platform === 'win32') {
          const stdout = execSync(`netstat -ano | findstr "LISTENING" | findstr ":${port}"`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
          });
          const pids = new Set();
          stdout.trim().split('\n').forEach(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5) {
              const pid = parseInt(parts[parts.length - 1], 10);
              if (pid && pid !== process.pid) pids.add(pid);
            }
          });
          pids.forEach(pid => {
            try { execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' }); } catch (_) {}
          });
        }
      } catch (_) {}

      if (retries > 0) {
        setTimeout(() => {
          listenOnPort(port, retries - 1);
        }, 1200);
      } else {
        console.error(`[Error] Port ${port} is already in use by another instance.`);
      }
    } else {
      console.error('[Server Error]:', err);
    }
  });
}

async function startServer() {
  try {
    await initDatabase();
    // Warm up master document templates and student list in background without blocking server startup
    Promise.all([
      documentService.getMasterDocTemplates(),
      studentService.getAllStudents()
    ]).catch(err => {
      console.warn('[Preload Notice]:', err.message);
    });
  } catch (err) {
    console.warn('[MySQL Warning]:', err.message);
  }

  listenOnPort(config.port);
}

startServer();

module.exports = app;
