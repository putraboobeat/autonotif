const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { config } = require('../config');
const { createLogger } = require('../utils/logger');
const { createRoutes } = require('./routes');
const { ensureStreamlitRunning, stopStreamlit } = require('../utils/streamlit-runner');

const log = createLogger('DASHBOARD');

let server = null;

/**
 * Start the Express dashboard server
 */
function startDashboard() {
  const app = express();

  // Auto-start Streamlit & keep it always running 24/7
  ensureStreamlitRunning();

  // Streamlit Reverse Proxy with WebSockets
  const streamlitProxy = createProxyMiddleware({
    pathFilter: '/streamlit',
    target: 'http://127.0.0.1:8501',
    changeOrigin: true,
    ws: true,
    timeout: 6000,
    proxyTimeout: 6000,
    on: {
      error: (err, req, res) => {
        log.warn('Streamlit proxy connection error', { error: err.message });
        if (res && res.writeHead && !res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Memuat Streamlit...</title><style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}.card{background:#1e293b;padding:2rem;border-radius:12px;border:1px solid #334155;max-width:480px}.spinner{width:36px;height:36px;border:3px solid #334155;border-top-color:#3b82f6;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 1rem}@keyframes spin{to{transform:rotate(360deg)}}h2{font-size:1.15rem;margin-bottom:.5rem}p{color:#94a3b8;font-size:.85rem;line-height:1.4}</style></head><body><div class="card"><div class="spinner"></div><h2>Menghubungkan ke Streamlit...</h2><p>Server Streamlit sedang bersiap di background. Halaman akan otomatis memuat ulang dalam 3 detik...</p></div><script>setTimeout(()=>location.reload(),3000);</script></body></html>`);
        }
      }
    }
  });

  // Mount Streamlit reverse proxy
  app.use(streamlitProxy);

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Serve static files
  app.use(express.static(path.join(__dirname, 'public')));

  // API routes
  app.use('/api', createRoutes());

  // Catch-all for SPA (exclude /streamlit)
  app.get('*', (req, res, next) => {
    if (req.url.startsWith('/streamlit')) return next();
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // Error handler
  app.use((err, req, res, next) => {
    log.error('Dashboard error', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  });

  const port = config.app.dashboardPort;
  server = app.listen(port, '0.0.0.0', () => {
    log.info(`Dashboard running at http://localhost:${port}`);
    log.info(`Streamlit proxy available at http://localhost:${port}/streamlit/`);
  });

  // Handle WebSocket upgrade for Streamlit
  server.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith('/streamlit')) {
      streamlitProxy.upgrade(req, socket, head);
    }
  });

  return server;
}

function stopDashboard() {
  stopStreamlit();
  if (server) {
    server.close();
    log.info('Dashboard stopped');
  }
}

module.exports = { startDashboard, stopDashboard };
