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
    
    // Coba ekstrak data
    const scrapedData = await page.evaluate(() => {
      // Halaman Lapor menggunakan list untuk tiket disposisi
      const cards = document.querySelectorAll('.list-group-item, .ticket-item, li[class*="ticket"], li[class*="disposisi"], div[class*="card"]');
      const data = [];
      
      cards.forEach((card, index) => {
        const text = card.innerText || '';
        if (text.trim().length < 20) return; // Skip elemen kosong
        
        // Ekstrak ID Tiket (biasanya diawali # diikuti angka di bagian bawah)
        const idMatch = text.match(/#(\d+)/);
        let ticketId = idMatch ? '#' + idMatch[1] : null;
        
        // Jika tidak ada ticket_id eksplisit, buat ID unik fallback
        if (!ticketId) ticketId = `LAPOR-${Date.now()}-${index}`;
        
        // Gunakan heuristik regex untuk memecah teks
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        
        // Asumsi baris 1: Nama | Tanggal | Sumber | Status Selesai/Verifikasi
        const firstLine = lines[0] || '';
        let namaPelapor = firstLine.split('Kamis')[0].split('Senin')[0].split('Selasa')[0].split('Rabu')[0].split('Jumat')[0].split('Sabtu')[0].split('Minggu')[0].split(',')[0].trim();
        if (namaPelapor.length > 50) namaPelapor = 'Anonim'; // Fallback
        
        // Mencari Waktu (misal: Kamis, 18:04)
        const timeMatch = firstLine.match(/(Senin|Selasa|Rabu|Kamis|Jumat|Sabtu|Minggu|\d{1,2}\s+[A-Za-z]{3}),\s+\d{2}:\d{2}/i);
        const waktuMasuk = timeMatch ? timeMatch[0] : '';
        
        // Mencari sumber (Tatap Muka, Website, Pos Surat)
        let sumberAduan = '';
        if (text.toLowerCase().includes('website')) sumberAduan = 'Website';
        else if (text.toLowerCase().includes('pos surat')) sumberAduan = 'Pos Surat';
        else if (text.toLowerCase().includes('tatap muka')) sumberAduan = 'Tatap Muka';
        
        // SLA/Deadline
        const slaMatch = text.match(/(Harus diproses dalam|Selesai otomatis dalam) \d+ hari/i);
        const slaDeadline = slaMatch ? slaMatch[0] : '';
        
        // Terdisposisi
        const dispMatch = text.match(/Terdisposisi:\s*(.+)/i);
        const kantahTerdisposisi = dispMatch ? dispMatch[1].trim() : '';
        
        // Judul Laporan (Baris setelah terdisposisi)
        let judulLaporan = '';
        let isiLaporan = '';
        const dispIndex = lines.findIndex(l => l.toLowerCase().startsWith('terdisposisi:'));
        if (dispIndex >= 0 && dispIndex + 1 < lines.length) {
          judulLaporan = lines[dispIndex + 1];
          if (dispIndex + 2 < lines.length) {
             isiLaporan = lines.slice(dispIndex + 2, dispIndex + 4).join('\n'); // ambil bbrp baris
          }
        } else {
          judulLaporan = lines[1] || '';
          isiLaporan = lines[2] || '';
        }
        
        // Status dan Keterangan
        let statusTiket = 'Open';
        let statusVerifikasi = '';
        let keteranganSelesai = '';
        
        if (text.toLowerCase().includes('selesai otomatis') || text.toLowerCase().includes('ditutup oleh')) {
          statusTiket = 'Closed';
          const tutupMatch = text.match(/Ditutup oleh (Admin|Sistem)/i);
          if (tutupMatch) keteranganSelesai = tutupMatch[0];
        } else if (text.toLowerCase().includes('sedang diproses') || text.toLowerCase().includes('ditindaklanjuti oleh instansi')) {
          statusTiket = 'Sedang Diproses';
          statusVerifikasi = 'Ditindaklanjuti';
        } else {
          statusTiket = 'Belum Ditindaklanjuti';
          if (text.toLowerCase().includes('terverifikasi')) statusVerifikasi = 'Terverifikasi';
        }
        
        data.push({
          ticketId,
          namaPelapor,
          waktuMasuk,
          sumberAduan,
          statusVerifikasi,
          slaDeadline,
          kantahTerdisposisi,
          judulLaporan,
          isiLaporan: isiLaporan.substring(0, 300), // batasi panjang
          statusTiket,
          keteranganSelesai,
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
