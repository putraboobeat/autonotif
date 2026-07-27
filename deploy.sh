#!/usr/bin/env bash

# ==============================================================================
# Skrip Deploy & Update Otomatis - Auto Notif Pengaduan BPN Aceh
# ==============================================================================

echo "========================================================"
echo "🚀 [1/4] Menarik update kode terbaru dari GitHub..."
echo "========================================================"
git pull origin main

echo ""
echo "========================================================"
echo "📦 [2/4] Memeriksa dan menginstal modul dependensi (NPM)..."
echo "========================================================"
npm install

echo ""
echo "========================================================"
echo "⚙️  [3/4] Me-restart & memperbarui proses 24/7 di PM2..."
echo "========================================================"

# Cek apakah pm2 tersedia di sistem
if ! command -v pm2 &> /dev/null; then
    echo "⚠️ PM2 belum terpasang. Melakukan install pm2 secara global..."
    npm install -g pm2
fi

# Bersihkan proses ganda 'autonotif' jika terlanjur berduplikasi
if pm2 describe autonotif > /dev/null 2>&1; then
    echo "🧹 Menghapus duplikasi proses 'autonotif' yang ganda..."
    pm2 delete autonotif > /dev/null 2>&1
fi

# Jika app sudah berjalan di pm2 dengan nama asli, restart; bila belum, start dari awal
if pm2 describe auto-notif-pengaduan > /dev/null 2>&1; then
    echo "🔄 Mengulang (restart) layanan 'auto-notif-pengaduan' di PM2..."
    pm2 restart auto-notif-pengaduan --update-env
else
    echo "▶️  Mendaftarkan dan menjalankan layanan 'auto-notif-pengaduan' di PM2..."
    pm2 start src/index.js --name auto-notif-pengaduan
fi

pm2 save --force

echo ""
echo "========================================================"
echo "✅ [4/4] DEPLOYMENT SELESAI BERHASIL! Sistem Anda Kini Versi Terbaru!"
echo "========================================================"
echo "💡 Tips: Ketik 'pm2 logs auto-notif-pengaduan' jika ingin menonton live log pesan."
echo "========================================================"
