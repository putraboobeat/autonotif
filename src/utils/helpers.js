/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 * Format phone number to international format
 * Converts 08xxx to 628xxx
 */
function formatPhoneNumber(phone) {
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');
  if (cleaned.startsWith('08')) {
    cleaned = '62' + cleaned.substring(1);
  } else if (cleaned.startsWith('+62')) {
    cleaned = cleaned.substring(1);
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
  retry,
  formatPhoneNumber,
  formatDate,
  extractKantorPertanahan,
  truncate,
};
