/**
 * Seed script: Insert 24 admin data from screenshot
 * Run: node src/seed-admins.js
 */
const { initDatabase } = require('./database/init');
const { AdminModel } = require('./database/models');

const admins = [
  { nama: 'Putra Muharril', kantor_pertanahan: 'Kanwil BPN Prov Aceh', no_hp: '85225726372' },
  { nama: 'Yasrul', kantor_pertanahan: 'Kantah Kab Aceh Barat Daya - Prov Aceh', no_hp: '82165659616' },
  { nama: 'Mariani', kantor_pertanahan: 'Kantah Kab Aceh Barat - Prov Aceh', no_hp: '82183036296' },
  { nama: 'Maulidarianti', kantor_pertanahan: 'Kantah Kab Aceh Besar - Prov Aceh', no_hp: '82168603941' },
  { nama: 'Adiyat Al Kausar', kantor_pertanahan: 'Kantah Kab Aceh Jaya - Prov Aceh', no_hp: '81362692909' },
  { nama: 'Eko Pohan', kantor_pertanahan: 'Kantah Kab Aceh Selatan - Prov Aceh', no_hp: '85260965862' },
  { nama: 'Bryan Nugraha', kantor_pertanahan: 'Kantah Kab Aceh Singkil - Prov Aceh', no_hp: '85260965862' },
  { nama: 'Adinda Khoiruddin', kantor_pertanahan: 'Kantah Kab Aceh Tamiang - Prov Aceh', no_hp: '81377489353' },
  { nama: 'Elvin', kantor_pertanahan: 'Kantah Kab Aceh Tenggara - Prov Aceh', no_hp: '85283764287' },
  { nama: 'Fadli Ulli Rusyadi', kantor_pertanahan: 'Kantah Kab Aceh Tengah - Prov Aceh', no_hp: '85260266117' },
  { nama: 'Muhadjir', kantor_pertanahan: 'Kantah Kab Aceh Timur - Prov Aceh', no_hp: '82214123822' },
  { nama: 'Muhibbul Putra', kantor_pertanahan: 'Kantah Kab Aceh Utara - Prov Aceh', no_hp: '8999350422' },
  { nama: 'Hariri', kantor_pertanahan: 'Kantah Kab Bener Meriah - Prov Aceh', no_hp: '82237653729' },
  { nama: 'Alfarisi', kantor_pertanahan: 'Kantah Kab Bireuen - Prov Aceh', no_hp: '85275933046' },
  { nama: 'Masdi Berutu', kantor_pertanahan: 'Kantah Kab Gayo Lues - Prov Aceh', no_hp: '85282862296' },
  { nama: 'Okti Ryanki', kantor_pertanahan: 'Kantah Kab Nagan Raya - Prov Aceh', no_hp: '82162789197' },
  { nama: 'Munawar Khalil', kantor_pertanahan: 'Kantah Kab Pidie Jaya - Prov Aceh', no_hp: '85206091525' },
  { nama: 'Melin', kantor_pertanahan: 'Kantah Kab Pidie - Prov Aceh', no_hp: '85231205839' },
  { nama: 'Naufal', kantor_pertanahan: 'Kantah Kab Simeuleu - Prov Aceh', no_hp: '81214354501' },
  { nama: 'Rizky Syahputra', kantor_pertanahan: 'Kantah Kota Lhokseumawe - Prov Aceh', no_hp: '85262757114' },
  { nama: 'Eli', kantor_pertanahan: 'Kantah Kota Subulussalam - Prov Aceh', no_hp: '81370545884' },
  { nama: 'Aulia Shahtya Putri', kantor_pertanahan: 'Kantah Kota Langsa - Prov Aceh', no_hp: '82277200225' },
  { nama: 'Al Furqran', kantor_pertanahan: 'Kantah Kota Sabang - Prov Aceh', no_hp: '852965403276' },
  { nama: 'Zakiul Hamdi', kantor_pertanahan: 'Kantah Kota Banda Aceh - Prov Aceh', no_hp: '85260300728' },
];

initDatabase();

// Clear existing admins
const { getDb } = require('./database/init');
const db = getDb();
const existing = db.prepare('SELECT COUNT(*) as count FROM admins').get();
console.log(`Data admin lama: ${existing.count} record`);
db.prepare('DELETE FROM admins').run();
console.log('Seluruh data admin lama berhasil dihapus.');

// Insert new admins
const { formatPhoneNumber } = require('./utils/helpers');
let inserted = 0;
for (const admin of admins) {
  try {
    const cleanedAdmin = {
      ...admin,
      no_hp: formatPhoneNumber(admin.no_hp)
    };
    AdminModel.create(cleanedAdmin);
    inserted++;
    console.log(`  [${inserted}] ${cleanedAdmin.kantor_pertanahan} — ${cleanedAdmin.nama} (${cleanedAdmin.no_hp})`);
  } catch (err) {
    console.error(`  GAGAL: ${admin.nama} — ${err.message}`);
  }
}

console.log(`\nSelesai! ${inserted}/${admins.length} data admin berhasil dimasukkan ke database.`);
process.exit(0);
