const { spawn, execSync } = require('child_process');
const path = require('path');

console.log('=======================================================');
console.log('       Starting DocuVault Fullstack System             ');
console.log('       Backend:  http://localhost:5000                 ');
console.log('       Frontend: http://localhost:4200                 ');
console.log('=======================================================');

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';

// 1. Spawn Backend API Server
const serverProcess = spawn(npmCmd, ['start'], {
  cwd: path.join(__dirname, 'backend'),
  stdio: 'inherit',
  shell: true
});

serverProcess.on('error', (err) => {
  console.error('[Backend Error]:', err.message);
});

// 2. Spawn Frontend (Angular)
const clientProcess = spawn(npmCmd, ['start'], {
  cwd: path.join(__dirname, 'frontend'),
  stdio: 'inherit',
  shell: true
});

clientProcess.on('error', (err) => {
  console.error('[Frontend Error]:', err.message);
});

clientProcess.on('exit', (code, signal) => {
  console.log(`[Frontend] Exited with code ${code || signal}`);
});

function handleExit() {
  const pids = [serverProcess?.pid, clientProcess?.pid].filter(Boolean);
  for (const pid of pids) {
    try {
      if (isWindows) {
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
      } else {
        process.kill(pid);
      }
    } catch (_) {}
  }
  process.exit(0);
}

process.on('SIGINT', handleExit);
process.on('SIGTERM', handleExit);
process.on('exit', handleExit);
