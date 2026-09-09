const path = require('path');
const { spawn } = require('child_process');
const { createLogger } = require('./logger');

const log = createLogger('STREAMLIT-RUNNER');

let streamlitProcess = null;
let isStopping = false;
let checkInterval = null;

function getStreamlitCommand() {
  const fs = require('fs');
  const rootDir = path.join(__dirname, '../..');
  const workingDir = path.join(rootDir, 'Website Scraping');
  
  // Check common virtualenv paths
  const candidateVenvs = [
    path.join(workingDir, 'venv', 'bin', 'streamlit'),
    path.join(workingDir, '.venv', 'bin', 'streamlit'),
    path.join(rootDir, 'venv', 'bin', 'streamlit'),
    path.join(rootDir, '.venv', 'bin', 'streamlit'),
  ];
  for (const binPath of candidateVenvs) {
    if (fs.existsSync(binPath)) {
      return { bin: binPath, argsPrefix: [], workingDir };
    }
  }

  // Check python binaries in venv
  const candidatePythonVenvs = [
    path.join(workingDir, 'venv', 'bin', 'python'),
    path.join(workingDir, 'venv', 'bin', 'python3'),
    path.join(workingDir, '.venv', 'bin', 'python'),
    path.join(workingDir, '.venv', 'bin', 'python3'),
  ];
  for (const pyPath of candidatePythonVenvs) {
    if (fs.existsSync(pyPath)) {
      return { bin: pyPath, argsPrefix: ['-m', 'streamlit'], workingDir };
    }
  }

  // Fallback to system python3 or streamlit
  return { bin: 'python3', argsPrefix: ['-m', 'streamlit'], workingDir };
}

async function isStreamlitAlive() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch('http://127.0.0.1:8501/streamlit/healthz', { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok || res.status < 500;
  } catch {
    try {
      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), 2000);
      const res2 = await fetch('http://127.0.0.1:8501/streamlit', { signal: controller2.signal });
      clearTimeout(timeout2);
      return res2.ok || res2.status < 500;
    } catch {
      return false;
    }
  }
}

function startStreamlitProcess() {
  if (streamlitProcess && !streamlitProcess.killed) {
    return streamlitProcess;
  }

  const { bin, argsPrefix, workingDir } = getStreamlitCommand();
  log.info(`[STREAMLIT] Launching Streamlit daemon in ${workingDir} using ${bin}...`);

  const args = [
    ...argsPrefix,
    'run',
    'app.py',
    '--server.port=8501',
    '--server.address=0.0.0.0',
    '--server.headless=true',
    '--server.baseUrlPath=streamlit',
    '--server.enableCORS=false',
    '--server.enableXsrfProtection=false',
  ];

  try {
    streamlitProcess = spawn(bin, args, {
      cwd: workingDir,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    streamlitProcess.stdout.on('data', (data) => {
      const text = data.toString().trim();
      if (text) log.debug(`[STREAMLIT-OUT] ${text}`);
    });

    streamlitProcess.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (text) log.debug(`[STREAMLIT-ERR] ${text}`);
    });

    streamlitProcess.on('exit', (code, signal) => {
      log.warn(`[STREAMLIT] Process exited with code ${code}, signal ${signal}`);
      streamlitProcess = null;
      if (!isStopping) {
        log.info('[STREAMLIT] Auto-restarting Streamlit in 3 seconds to keep it always alive...');
        setTimeout(startStreamlitProcess, 3000);
      }
    });

    streamlitProcess.on('error', (err) => {
      log.error(`[STREAMLIT] Failed to start process: ${err.message}`);
      streamlitProcess = null;
    });

    return streamlitProcess;
  } catch (err) {
    log.error(`[STREAMLIT] Spawn error: ${err.message}`);
    return null;
  }
}

/**
 * Start Streamlit & Auto-Keep Alive Supervisor
 */
function ensureStreamlitRunning() {
  isStopping = false;
  startStreamlitProcess();

  if (!checkInterval) {
    checkInterval = setInterval(async () => {
      if (isStopping) return;
      const alive = await isStreamlitAlive();
      if (!alive) {
        log.warn('[STREAMLIT] Health check failed, ensuring process is running...');
        startStreamlitProcess();
      }
    }, 15000); // Check every 15 seconds
  }
}

function stopStreamlit() {
  isStopping = true;
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  if (streamlitProcess) {
    try {
      streamlitProcess.kill('SIGTERM');
    } catch {}
    streamlitProcess = null;
  }
}

module.exports = {
  ensureStreamlitRunning,
  isStreamlitAlive,
  stopStreamlit,
};
