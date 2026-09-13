const { createLogger } = require('../utils/logger');
const { getPage, recreatePage, saveCookies } = require('./browser');
const { sleep } = require('../utils/helpers');

const log = createLogger('TUNTAS-SCRAPER');

/**
 * Perform login to Tuntas
 */
async function loginTuntas(username, password) {
  let page = getPage();
  if (!page || page.isClosed()) {
    page = await recreatePage();
  }

  log.info('Mencoba login ke Tuntas ATR/BPN...');
  try {
    // Navigate to tuntas login
    await page.goto('https://tuntas.atrbpn.go.id/login', { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // Cek apakah sudah login
    const isLoggedIn = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      return text.includes('logout') || text.includes('keluar') || document.querySelector('a[href*="logout"]');
    });

    if (isLoggedIn) {
      log.info('Sudah login ke Tuntas.');
      return true;
    }

    // Isi username
    const usernameSelectors = ['input[type="email"]', 'input[name="email"]', 'input[name="username"]', 'input[type="text"]'];
    let usernameFilled = false;
    for (const sel of usernameSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.click({ clickCount: 3 });
        await el.type(username, { delay: 50 });
        usernameFilled = true;
        break;
      }
    }

    if (!usernameFilled) {
      log.warn('Input username tidak ditemukan di Tuntas');
      return false;
    }

    // Isi password
    const passwordSelectors = ['input[type="password"]', 'input[name="password"]'];
    let passwordFilled = false;
    for (const sel of passwordSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.click({ clickCount: 3 });
        await el.type(password, { delay: 50 });
        passwordFilled = true;
        break;
      }
    }

    if (!passwordFilled) {
       log.warn('Input password tidak ditemukan di Tuntas');
       return false;
    }

    // Klik tombol submit
    const submitSelectors = ['button[type="submit"]', 'input[type="submit"]', '.btn-login'];
    let submitted = false;
    for (const sel of submitSelectors) {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click();
        submitted = true;
        break;
      }
    }
    
    if (!submitted) await page.keyboard.press('Enter');

    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
    await sleep(3000);

    // Verify login
    const isNowLoggedIn = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      return text.includes('logout') || text.includes('keluar') || !document.querySelector('input[type="password"]');
    });

    if (isNowLoggedIn) {
      log.info('Login Tuntas berhasil!');
      await saveCookies();
      return true;
    } else {
      log.error('Gagal login ke Tuntas (kredensial salah atau ada captcha)');
      return false;
    }
  } catch (error) {
    log.error('Error saat login Tuntas', { error: error.message });
    return false;
  }
}

/**
 * Scrape new tickets from Tuntas
 */
async function scrapeTuntasTickets(username, password) {
  const loggedIn = await loginTuntas(username, password);
  if (!loggedIn) {
    return { success: false, error: 'Not logged in' };
  }

  const page = getPage();
  const tickets = [];

  try {
    log.info('Membuka halaman pengaduan Tuntas...');
    
    // Coba ekstrak data jika ada tabel
    const scrapedData = await page.evaluate(() => {
      const rows = document.querySelectorAll('table tbody tr, .ticket-row, .complaint-item, .list-group-item');
      const data = [];
      
      rows.forEach((row, index) => {
        const text = row.innerText;
        // Buat ID unik sementara berdasarkan text konten jika tidak ada ID eksplisit
        const ticketId = row.querySelector('[data-id], .ticket-id') 
          ? (row.querySelector('[data-id]')?.getAttribute('data-id') || row.querySelector('.ticket-id')?.innerText)
          : `TUNTAS-${Date.now()}-${index}`;
          
        const status = text.toLowerCase().includes('selesai') ? 'Closed' : 'Open';
        
        data.push({
          ticketId: ticketId.trim(),
          subject: text.substring(0, 100).replace(/\n/g, ' ').trim() + '...',
          status: status,
          createdDate: new Date().toISOString(),
          rawText: text
        });
      });
      return data;
    });

    if (scrapedData && scrapedData.length > 0) {
      log.info(`Berhasil mengekstrak ${scrapedData.length} tiket dari Tuntas`);
      tickets.push(...scrapedData);
    } else {
      log.warn('Tidak ada data tabel/tiket yang ditemukan di halaman Tuntas saat ini.');
    }

    return { success: true, tickets };
  } catch (error) {
    log.error('Error saat scraping tiket Tuntas', { error: error.message });
    return { success: false, error: error.message };
  }
}

module.exports = {
  scrapeTuntasTickets
};
