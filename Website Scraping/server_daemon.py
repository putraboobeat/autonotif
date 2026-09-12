import time
import json
import subprocess
from datetime import datetime
import os
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE_DIR, "config.json")

def log(msg):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] {msg}")

def load_config():
    if not os.path.exists(CONFIG_FILE):
        return None
    try:
        with open(CONFIG_FILE, "r") as f:
            return json.load(f)
    except Exception as e:
        log(f"Error reading config: {e}")
        return None

def main():
    log("Server Daemon Starting... Auto-Pilot is Active.")
    
    while True:
        config = load_config()
        if not config:
            log("Config not found or invalid. Retrying in 60 seconds...")
            time.sleep(60)
            continue
            
        interval_minutes = config.get("interval_minutes", 60)
        auto_fetch = config.get("auto_fetch", False)
        auto_post = config.get("auto_post", False)
        target_pages = config.get("target_pages", 1)
        source_url = config.get("source_url", "https://www.atrbpn.go.id/berita")
        
        log(f"Status: Fetch={auto_fetch}, Post={auto_post}, Interval={interval_minutes}m")
        
        if auto_fetch:
            log(f"--> Menjalankan AUTO FETCH ({target_pages} halaman, {source_url})...")
            try:
                subprocess.run(
                    [sys.executable, "link_fetcher.py", str(target_pages), source_url], 
                    check=True,
                    cwd=BASE_DIR
                )
                log("AUTO FETCH selesai.")
            except subprocess.CalledProcessError as e:
                log(f"AUTO FETCH gagal: {e}")
                
        if auto_post:
            log("--> Menjalankan AUTO POST...")
            try:
                subprocess.run(
                    [sys.executable, "wp_autopost_bot.py"], 
                    check=True,
                    cwd=BASE_DIR
                )
                log("AUTO POST selesai.")
            except subprocess.CalledProcessError as e:
                log(f"AUTO POST gagal: {e}")
                
        log(f"Sleeping for {interval_minutes} minutes...")
        time.sleep(interval_minutes * 60)

if __name__ == "__main__":
    main()
