import asyncio
import gspread
from playwright.async_api import async_playwright

import sys

def get_existing_urls():
    sheet_id = "1fJOXx9mEmM1vR_PUH0YrMXdy29aE9tZb9jA786IPqbU"
    sheet_name = "link"
    
    import os
    cred_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'credentials.json')
    gc = gspread.service_account(filename=cred_path)
    sh = gc.open_by_key(sheet_id)
    worksheet = sh.worksheet(sheet_name)
    
    # Ambil semua data untuk mengecek URL dan Tanggal (Kolom B dan D)
    all_values = worksheet.get_all_values()
    existing_data = {}
    
    # Skip header (baris 1), mulai dari indeks 1 (baris 2)
    for i in range(1, len(all_values)):
        row = all_values[i]
        row_num = i + 1
        if len(row) > 1 and row[1].strip():
            url = row[1].strip()
            # Cek apakah kolom D (indeks 3) ada isinya
            date_val = row[3].strip() if len(row) > 3 else ""
            existing_data[url] = (row_num, date_val)
            
    return existing_data, worksheet

import time
from urllib.parse import urlparse

async def fetch_latest_links(target_pages=1, source_url="https://www.atrbpn.go.id/berita"):
    existing_data, worksheet = get_existing_urls()
    print(f"Ditemukan {len(existing_data)} link yang sudah ada di Spreadsheet.")
    
    # Parse base URL to construct full URLs properly
    parsed_uri = urlparse(source_url)
    base_url = f"{parsed_uri.scheme}://{parsed_uri.netloc}"
    
    # We don't store new_data to write at the end anymore, we write immediately.
    # Just keeping track of what we added this session to avoid duplicates.
    added_urls_this_session = set()
    
    # Find next row number once at the start
    next_row = len(worksheet.col_values(2)) + 1
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        print(f"Membuka halaman {source_url} ...")
        await page.goto(source_url, wait_until="networkidle")
        
        for current_page in range(1, target_pages + 1):
            print(f"--- Menarik data dari Halaman {current_page} ---")
            
            # Wait for the cards to load
            try:
                await page.wait_for_selector('div.pt-3.text-start', timeout=15000)
            except:
                print("Gagal memuat konten berita atau halaman kosong.")
                break
            
            # Extract all article cards
            cards = await page.query_selector_all('div.pt-3.text-start')
            
            page_new_links = 0
            for card in cards:
                link_node = await card.query_selector('a')
                if not link_node:
                    continue
                href = await link_node.get_attribute('href')
                
                date_node = await card.query_selector('span.align-middle')
                date_text = await date_node.inner_text() if date_node else ""
                
                if href:
                    if href.startswith("http"):
                        full_url = href
                    else:
                        full_url = f"{base_url}{href}"
                        
                    if full_url in existing_data:
                        # URL sudah ada, cek apakah tanggalnya masih kosong
                        row_num, old_date = existing_data[full_url]
                        if not old_date and date_text.strip():
                            print(f"  -> Melengkapi tanggal kosong untuk baris {row_num}")
                            worksheet.update_acell(f"D{row_num}", date_text.strip())
                            # Update dictionary agar tidak di-update berkali-kali
                            existing_data[full_url] = (row_num, date_text.strip())
                            time.sleep(1.5) # Jeda untuk menghindari Rate Limit Google Sheets API
                    else:
                        if full_url not in added_urls_this_session:
                            # Ignore the main index link itself
                            if full_url != source_url:
                                category_name = "Nanggroe" if "aceh.atrbpn.go.id" in full_url else "Nasional"
                                print(f"  -> Link Baru Ditemukan! Menulis ke Spreadsheet baris {next_row}...")
                                # Gunakan batch update (1 request) alih-alih 3 request
                                worksheet.update(
                                    values=[[next_row - 1, full_url, "", date_text.strip(), category_name]],
                                    range_name=f"A{next_row}:E{next_row}"
                                )
                                added_urls_this_session.add(full_url)
                                next_row += 1
                                page_new_links += 1
                                time.sleep(1.5) # Jeda untuk menghindari Rate Limit
                            
            print(f"Selesai memproses halaman {current_page}. Ditemukan {page_new_links} link baru.")
            
            if current_page < target_pages:
                print("Mencoba pindah ke halaman selanjutnya...")
                try:
                    next_page_num = str(current_page + 1)
                    # Use precise playwright locator based on the actual pagination HTML
                    # It has <a class="page-link">2</a>
                    next_btn = page.locator(f'ul.pagination a.page-link:text-is("{next_page_num}")').first
                    
                    count = await next_btn.count()
                    if count == 0:
                        # Fallback to the 'Next' arrow which has <span class="visually-hidden">Next</span>
                        next_btn = page.locator('ul.pagination a.page-link:has(span.visually-hidden:has-text("Next"))').first
                        count = await next_btn.count()
                        
                    if count > 0:
                        await next_btn.click()
                        print(f"Berhasil klik halaman {current_page + 1}, menunggu loading...")
                        await page.wait_for_timeout(4000) # wait 4 seconds for API fetch and DOM update
                    else:
                        print("Tombol halaman selanjutnya tidak ditemukan. Menghentikan pencarian.")
                        break
                except Exception as e:
                    print(f"Gagal mengklik halaman selanjutnya: {e}")
                    break
        
        await browser.close()
        
    print(f"\n{'='*30}")
    print(f"Total berhasil menambahkan {len(added_urls_this_session)} link baru!")
    print("Selesai memasukkan data ke Spreadsheet.")

if __name__ == "__main__":
    target_pages = 1
    source_url = "https://www.atrbpn.go.id/berita"
    
    if len(sys.argv) > 1:
        try:
            target_pages = int(sys.argv[1])
        except ValueError:
            pass
    if len(sys.argv) > 2:
        source_url = sys.argv[2]
        
    asyncio.run(fetch_latest_links(target_pages, source_url))
