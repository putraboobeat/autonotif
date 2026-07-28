/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get a random integer between min and max (inclusive)
 */
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Sleep for a random human-like duration between minMs and maxMs (Jitter / Anti-Bot)
 */
async function humanlikeSleep(minMs = 3500, maxMs = 8500) {
  const delay = getRandomInt(minMs, maxMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Retry a function with exponential backoff
 */
async function retry(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

/**
 * Format phone number to international format (+62 / 62)
 * Converts 08xxx or 8xxx (without leading 0) to 628xxx
 * Mencegah error country code +852 (Hong Kong) pada input tanpa angka 0
 */
function formatPhoneNumber(phone) {
  if (!phone) return '';
  // Remove all non-digit characters (strips +, spaces, dashes, parentheses)
  let cleaned = String(phone).replace(/\D/g, '');
  
  // Convert leading 0 to 62 (e.g., 0852... -> 62852...)
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.substring(1);
  } 
  // Convert leading 8 (input without 0 or 62) to 628... (e.g., 852... -> 62852...)
  else if (cleaned.startsWith('8')) {
    cleaned = '62' + cleaned;
  }
  
  return cleaned;
}

/**
 * Format date to Indonesian locale string
 */
function formatDate(dateStr) {
  try {
    const date = new Date(dateStr);
    return date.toLocaleString('id-ID', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

/**
 * Extract kantor pertanahan name from agent text
 * Agent format from OCA: "Kantah Kab Gayo Lues - Prov Ac...\n Kantor Pertanahan Kabupaten Ga..."
 */
function extractKantorPertanahan(agentText) {
  if (!agentText) return '';

  // Try to get the first line which usually contains the short name
  const lines = agentText.split('\n').map((l) => l.trim()).filter(Boolean);

  // Return the first line as primary identifier
  return lines[0] || agentText.trim();
}

/**
 * Truncate string with ellipsis
 */
function truncate(str, maxLength = 50) {
  if (!str || str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

module.exports = {
  sleep,
  getRandomInt,
  humanlikeSleep,
  retry,
  formatPhoneNumber,
  formatDate,
  extractKantorPertanahan,
  truncate,
};
