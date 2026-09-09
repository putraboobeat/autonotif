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
    onError(err, req, res) {
      if (res.writeHead && !res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h3>Sedang menyambungkan ke server Streamlit... Halaman akan termuat otomatis dalam beberapa detik.</h3><script>setTimeout(() => location.reload(), 2500);</script>');
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
