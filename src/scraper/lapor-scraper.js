const { createLogger } = require('../utils/logger');
const { getPage, recreatePage, saveCookies } = require('./browser');
const { sleep } = require('../utils/helpers');

const log = createLogger('LAPOR-SCRAPER');

/**
 * Perform login to Lapor
 */
async function loginLapor(username, password) {
  let page = getPage();
  if (!page || page.isClosed()) {
    page = await recreatePage();
  }

  log.info('Mencoba login ke SP4N Lapor...');
  try {
    // Navigate to lapor login
    await page.goto('https://www.lapor.go.id/', { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // Cek apakah sudah login (misal mencari elemen dashboard atau logout button)
    const isLoggedIn = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      return text.includes('logout') || text.includes('keluar') || document.querySelector('a[href*="logout"]');
    });

    if (isLoggedIn) {
      log.info('Sudah login ke Lapor.');
      return true;
    }

    // Jika belum login, cari tombol login di halaman depan
    const loginLink = await page.$('a[href*="login"]');
    if (loginLink) {
      await loginLink.click();
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
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
      log.warn('Input username tidak ditemukan di Lapor');
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
       log.warn('Input password tidak ditemukan di Lapor');
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
      log.info('Login Lapor berhasil!');
      await saveCookies();
      return true;
    } else {
      log.error('Gagal login ke Lapor (kredensial salah atau ada captcha)');
      return false;
    }
  } catch (error) {
    log.error('Error saat login Lapor', { error: error.message });
    return false;
  }
}

/**
 * Scrape new tickets from Lapor
 */
async function scrapeLaporTickets(username, password) {
  const loggedIn = await loginLapor(username, password);
  if (!loggedIn) {
    return { success: false, error: 'Not logged in' };
  }

  const page = getPage();
  const tickets = [];

  try {
    log.info('Membuka halaman pengaduan Lapor...');
    
    // Coba ekstrak data jika ada tabel
    const scrapedData = await page.evaluate(() => {
      const rows = document.querySelectorAll('table tbody tr, .ticket-row, .complaint-item, .list-group-item');
      const data = [];
      
      rows.forEach((row, index) => {
        const text = row.innerText;
        // Buat ID unik sementara berdasarkan text konten jika tidak ada ID eksplisit
        const ticketId = row.querySelector('[data-id], .ticket-id') 
          ? (row.querySelector('[data-id]')?.getAttribute('data-id') || row.querySelector('.ticket-id')?.innerText)
          : `LAPOR-${Date.now()}-${index}`;
          
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
      log.info(`Berhasil mengekstrak ${scrapedData.length} tiket dari Lapor`);
      tickets.push(...scrapedData);
    } else {
      log.warn('Tidak ada data tabel/tiket yang ditemukan di halaman Lapor saat ini.');
    }

    return { success: true, tickets };
  } catch (error) {
    log.error('Error saat scraping tiket Lapor', { error: error.message });
    return { success: false, error: error.message };
  }
}

module.exports = {
  scrapeLaporTickets
};
