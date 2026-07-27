require('dotenv').config();

const config = {
  // OCA Interaction
  oca: {
    url: process.env.OCA_URL || 'https://interaction.ocaindonesia.co.id/',
    email: process.env.OCA_EMAIL || '',
    password: process.env.OCA_PASSWORD || '',
    departmentFilter: process.env.OCA_DEPARTMENT_FILTER || '',
    totpSecret: process.env.OCA_TOTP_SECRET || '',
  },

  // StarSender API
  starsender: {
    apiKey: process.env.STARSENDER_API_KEY || '',
    sendUrl: 'https://api.starsender.online/api/send',
    groupUrl: 'https://api.starsender.online/api/send/grup',
  },

  // WhatsApp
  wa: {
    groupName: process.env.WA_GROUP_NAME || '',
  },

  // Admin Kanwil — receives ALL notifications
  kanwil: {
    name: process.env.KANWIL_ADMIN_NAME || 'Admin Kanwil',
    phone: process.env.KANWIL_ADMIN_PHONE || '',
  },

  // Kasubbag Umum dan Hubungan Masyarakat (Kanwil) — menerima eskalasi jika tiket > 1x24 jam tidak di-close
  kasubbag_humas: {
    name: process.env.KASUBBAG_UMUM_HUMAS_NAME || 'Kasubbag Umum dan Hubungan Masyarakat',
    phone: process.env.KASUBBAG_UMUM_HUMAS_PHONE || '',
  },

  // App settings
  app: {
    scrapeInterval: parseInt(process.env.SCRAPE_INTERVAL, 10) || 60000,
    dashboardPort: parseInt(process.env.DASHBOARD_PORT, 10) || 3000,
    cookiePath: process.env.COOKIE_PATH || './data/cookies.json',
    env: process.env.NODE_ENV || 'development',
  },
};

// Validate required config
function validateConfig() {
  const missing = [];
  if (!config.oca.email) missing.push('OCA_EMAIL');
  if (!config.oca.password) missing.push('OCA_PASSWORD');
  if (!config.starsender.apiKey) missing.push('STARSENDER_API_KEY');
  if (!config.wa.groupName) missing.push('WA_GROUP_NAME');

  if (missing.length > 0) {
    console.warn(`⚠️  Missing environment variables: ${missing.join(', ')}`);
    console.warn('   Copy .env.example to .env and fill in the values.');
  }

  return missing.length === 0;
}

module.exports = { config, validateConfig };
