import streamlit as st
import gspread
import subprocess
import pandas as pd
import time
import json
import os

# --- KONFIGURASI FILE ---
CONFIG_FILE = "config.json"

def load_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "r") as f:
            return json.load(f)
    return {"auto_fetch": False, "auto_post": False, "interval_minutes": 60, "target_pages": 1, "source_url": "https://www.atrbpn.go.id/berita"}

def save_config(config):
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=4)

# --- PENGATURAN UI STREAMLIT ---
st.set_page_config(page_title="Bot Auto-Post ATR/BPN", page_icon="🤖", layout="wide")

st.title("🤖 Dashboard Bot Auto-Post ATR/BPN")
st.markdown("Dashboard ini memungkinkan Anda menarik berita terbaru dan mem-postingnya ke WordPress secara otomatis.")

# --- KONEKSI GOOGLE SHEETS ---
@st.cache_resource
def get_google_sheet():
    try:
        gc = gspread.service_account(filename='credentials.json')
        sh = gc.open_by_key("1fJOXx9mEmM1vR_PUH0YrMXdy29aE9tZb9jA786IPqbU")
        worksheet = sh.worksheet("link")
        return worksheet
    except Exception as e:
        st.error(f"Gagal terhubung ke Google Sheets: {e}")
        return None

worksheet = get_google_sheet()

# --- TAMPILAN DATA ---
st.header("📊 Data Spreadsheet Saat Ini")
if worksheet:
    # Mengambil data untuk ditampilkan
    data = worksheet.get_all_records()
    if data:
        df = pd.DataFrame(data)
        st.dataframe(df, use_container_width=True)
    else:
        st.info("Spreadsheet masih kosong.")

st.divider()

# --- PANEL AUTO-PILOT SERVER ---
st.header("⚙️ Konfigurasi Auto-Pilot (Server Daemon)")
st.markdown("Pengaturan ini digunakan oleh script `server_daemon.py` yang berjalan di *background* server 24 jam.")

config = load_config()

col_auto1, col_auto2, col_auto3 = st.columns(3)

with col_auto1:
    new_auto_fetch = st.toggle("Aktifkan Auto Tarik Data", value=config.get("auto_fetch", False))
with col_auto2:
    new_auto_post = st.toggle("Aktifkan Auto Posting", value=config.get("auto_post", False))
with col_auto3:
    new_interval = st.number_input("Interval Waktu (Menit)", min_value=1, max_value=1440, value=config.get("interval_minutes", 60), step=5)

# Jika ada perubahan config, simpan
if (new_auto_fetch != config.get("auto_fetch") or 
    new_auto_post != config.get("auto_post") or 
    new_interval != config.get("interval_minutes")):
    
    config["auto_fetch"] = new_auto_fetch
    config["auto_post"] = new_auto_post
    config["interval_minutes"] = new_interval
    save_config(config)
    st.toast("Konfigurasi Auto-Pilot berhasil disimpan!", icon="✅")

st.divider()

# --- TOMBOL AKSI MANUAL ---
col1, col2 = st.columns(2)

with col1:
    st.header("1️⃣ Tarik Link Terbaru (Manual)")
    st.markdown("Bot akan membuka halaman berita ATR/BPN dan mencari link artikel terbaru yang belum ada di tabel.")
    
    # Pilihan Sumber Berita
    sumber_berita = st.radio(
        "Pilih Sumber Berita:",
        ("Nasional (www.atrbpn.go.id)", "Lokal Aceh (aceh.atrbpn.go.id)")
    )
    
    # Map pilihan ke URL
    if sumber_berita == "Nasional (www.atrbpn.go.id)":
        source_url = "https://www.atrbpn.go.id/berita"
    else:
        source_url = "https://aceh.atrbpn.go.id/berita-lokal"
        
    # Simpan pilihan ini ke config juga agar daemon menggunakan sumber yang sama
    if sumber_berita != "Nasional (www.atrbpn.go.id)" and config.get("source_url") == "https://www.atrbpn.go.id/berita":
        config["source_url"] = source_url
        save_config(config)
    elif sumber_berita == "Nasional (www.atrbpn.go.id)" and config.get("source_url") != "https://www.atrbpn.go.id/berita":
        config["source_url"] = source_url
        save_config(config)
        
    num_pages = st.number_input("Jumlah Halaman yang Ditarik", min_value=1, max_value=50, value=config.get("target_pages", 1), step=1)
    
    if num_pages != config.get("target_pages"):
        config["target_pages"] = num_pages
        save_config(config)
    
    if st.button("Jalankan Tarik Link Sekarang", type="primary", use_container_width=True):
        st.info(f"Sedang mencari link baru dari {num_pages} halaman di sumber {sumber_berita}...")
        log_container = st.empty()
        log_text = ""
        
        # Menjalankan script secara real-time
        process = subprocess.Popen(
            ["python", "-u", "link_fetcher.py", str(num_pages), source_url], 
            stdout=subprocess.PIPE, 
            stderr=subprocess.STDOUT, 
            text=True,
            bufsize=1
        )
        
        for line in process.stdout:
            log_text += line
            log_container.code(log_text, language="text")
            
        process.wait()
        
        if process.returncode == 0:
            st.success("Proses penarikan selesai!")
            time.sleep(2)
            st.rerun()
        else:
            st.error("Terjadi kesalahan saat memproses!")

with col2:
    st.header("2️⃣ Auto-Post WordPress (Manual)")
    st.markdown("Bot akan membaca link yang belum ter-posting (Kolom C kosong), mengunduh isinya, dan mem-publish ke WordPress.")
    if st.button("Jalankan Auto-Post Sekarang", type="primary", use_container_width=True):
        st.info("Bot sedang mem-posting... Jangan tutup halaman ini!")
        log_container = st.empty()
        log_text = ""
        
        # Menjalankan script secara real-time
        process = subprocess.Popen(
            ["python", "-u", "wp_autopost_bot.py"], 
            stdout=subprocess.PIPE, 
            stderr=subprocess.STDOUT, 
            text=True,
            bufsize=1
        )
        
        for line in process.stdout:
            log_text += line
            log_container.code(log_text, language="text")
            
        process.wait()
        
        if process.returncode == 0:
            st.success("Proses Auto-Post selesai!")
            time.sleep(2)
            st.rerun()
        else:
            st.error("Terjadi kesalahan saat memproses!")
