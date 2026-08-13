/**
 * Data Hari Besar Nasional dan Internasional (Template)
 * Digunakan untuk fungsi auto-scrape / seeding ke database.
 */

const https = require('https');

function fetchDynamicHolidays() {
  return new Promise((resolve, reject) => {
    https.get('https://raw.githubusercontent.com/guangrei/APIHariLibur_V2/main/holidays.json', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          resolve({});
        }
      });
    }).on('error', () => {
      resolve({});
    });
  });
}

async function getHolidaySeedData(year) {
  // Daftar template hari besar, MM-DD (Static)
  const templates = [
    // Januari
    { date: '01-10', name: 'Hari Lingkungan Hidup Nasional' },
    // Februari
    { date: '02-21', name: 'Hari Peduli Sampah Nasional' },
    // Maret
    { date: '03-21', name: 'Hari Hutan Internasional' },
    { date: '03-22', name: 'Hari Air Sedunia' },
    { date: '03-23', name: 'Hari Meteorologi Sedunia' },
    // April
    { date: '04-21', name: 'Hari Kartini' },
    { date: '04-22', name: 'Hari Bumi (Earth Day)' },
    // Mei
    { date: '05-02', name: 'Hari Pendidikan Nasional' },
    { date: '05-20', name: 'Hari Kebangkitan Nasional' },
    // Juni
    { date: '06-05', name: 'Hari Lingkungan Hidup Sedunia' },
    { date: '06-08', name: 'Hari Laut Sedunia' },
    // Juli
    { date: '07-23', name: 'Hari Anak Nasional' },
    // Agustus
    { date: '08-10', name: 'Hari Konservasi Alam Nasional' },
    { date: '08-14', name: 'Hari Pramuka' },
    // September
    { date: '09-16', name: 'Hari Ozon Internasional' },
    { date: '09-24', name: 'Hari Tani Nasional' },
    // Oktober
    { date: '10-01', name: 'Hari Kesaktian Pancasila' },
    { date: '10-05', name: 'Hari Tentara Nasional Indonesia (TNI)' },
    { date: '10-28', name: 'Hari Sumpah Pemuda' },
    // November
    { date: '11-05', name: 'Hari Cinta Puspa dan Satwa Nasional' },
    { date: '11-08', name: 'Hari Tata Ruang Nasional (HANTARU)' },
    { date: '11-10', name: 'Hari Pahlawan' },
    { date: '11-21', name: 'Hari Pohon Sedunia' },
    { date: '11-25', name: 'Hari Guru Nasional' },
    { date: '11-28', name: 'Hari Menanam Pohon Indonesia' },
    // Desember
    { date: '12-04', name: 'Hari Konservasi Kehidupan Liar' },
    { date: '12-22', name: 'Hari Ibu Nasional' }
  ];

  const results = [];

  // 1. Tambahkan static dates
  for (const t of templates) {
    results.push({
      name: t.name,
      event_date: `${year}-${t.date}`
    });
  }

  // 2. Tambahkan dynamic dates dari APIHariLibur_V2 (Untuk Cuti Bersama, Idul Fitri, dll yang berubah tiap tahun)
  const dynamicHolidays = await fetchDynamicHolidays();
  
  for (const [date, info] of Object.entries(dynamicHolidays)) {
    if (date === 'info') continue;
    // Cek apakah tahunnya sama dengan yang diminta (opsional, tapi json ini biasanya mencakup multiple years)
    if (date.startsWith(year.toString())) {
      results.push({
        name: info.summary,
        event_date: date
      });
    }
  }

  return results;
}

module.exports = {
  getHolidaySeedData
};
