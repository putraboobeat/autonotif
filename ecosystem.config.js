module.exports = {
  apps: [
    {
      name: 'auto-notif-pengaduan',
      script: 'src/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-output.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
    },
    {
      name: 'website-scraping-streamlit',
      script: './Website Scraping/venv/bin/streamlit',
      args: 'run app.py --server.port=8501 --server.headless=true',
      cwd: __dirname + '/Website Scraping',
      instances: 1,
      autorestart: true,
      watch: false,
      error_file: './logs/streamlit-error.log',
      out_file: './logs/streamlit-output.log',
      merge_logs: true,
      restart_delay: 5000,
    }
  ],
};
