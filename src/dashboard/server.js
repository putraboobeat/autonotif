const express = require('express');
const path = require('path');
const { config } = require('../config');
const { createLogger } = require('../utils/logger');
const { createRoutes } = require('./routes');

const log = createLogger('DASHBOARD');

let server = null;

/**
 * Start the Express dashboard server
 */
function startDashboard() {
  const app = express();

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Serve static files
  app.use(express.static(path.join(__dirname, 'public')));

  // API routes
  app.use('/api', createRoutes());

  // Catch-all for SPA
  app.get('*', (req, res) => {
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
  });

  return server;
}

function stopDashboard() {
  if (server) {
    server.close();
    log.info('Dashboard stopped');
  }
}

module.exports = { startDashboard, stopDashboard };
