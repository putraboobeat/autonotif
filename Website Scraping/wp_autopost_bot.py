import asyncio
import csv
import os
import requests
from requests.auth import HTTPBasicAuth
import gspread
from dotenv import load_dotenv
from playwright.async_api import async_playwright
from datetime import datetime

# Load environment variables
load_dotenv()

WP_URL = os.getenv("WP_URL", "").rstrip("/")
WP_USERNAME = os.getenv("WP_USERNAME")
WP_APP_PASSWORD = os.getenv("WP_APP_PASSWORD")
POST_STATUS = os.getenv("POST_STATUS", "draft")

async def scrape_article(page, url):
    print(f"Scraping: {url}")
    await page.goto(url, wait_until="networkidle")
    
    # Wait for the Title (h3.card-title) to appear on the page
    try:
        await page.wait_for_selector('h3.card-title', timeout=15000)
    except:
        print(f"  [!] Timeout waiting for content to load on {url}")
        return None

    # 1. Extract Title
    title_element = await page.query_selector('h3.card-title')
    title = await title_element.inner_text() if title_element else "Title not found"

    # 2. Extract Date
    date_element = await page.query_selector('.text-medium em') 
    raw_date = await date_element.inner_text() if date_element else ""
    date = raw_date.replace("Tanggal Publikasi : ", "").strip() if raw_date else "Date not found"

    # 3. Extract Content (Paragraphs)
    content_elements = await page.query_selector_all('.cta-5 p')
    content = "\n\n".join([await p.inner_text() for p in content_elements if await p.inner_text()])
    
    # Convert newlines to HTML paragraphs for WordPress
    html_content = "".join([f"<p>{p.strip()}</p>" for p in content.split("\n\n") if p.strip()])

    # 4. Extract Main Image URL
    image_element = await page.query_selector('img[src*="/assets/"]')
    image_url = await image_element.get_attribute('src') if image_element else None

    return {
        "title": title,
        "date": date,
        "image_url": image_url,
        "content": html_content
    }

def upload_image_to_wp(image_url, title):
    if not image_url:
        return None
        
    print(f"  -> Downloading image...")
    response = requests.get(image_url)
    if response.status_code != 200:
        print("  [!] Failed to download image.")
        return None
        
    # WP Media REST API endpoint
    media_url = f"{WP_URL}/wp-json/wp/v2/media"
    
    # Create safe filename
    safe_title = "".join([c if c.isalnum() else "-" for c in title])[:50]
    filename = f"{safe_title}.jpg"
    
    headers = {
        'Content-Disposition': f'attachment; filename="{filename}"',
        'Content-Type': 'image/jpeg'
    }
    
    print(f"  -> Uploading image to WordPress...")
    auth = HTTPBasicAuth(WP_USERNAME, WP_APP_PASSWORD)
    res = requests.post(media_url, headers=headers, data=response.content, auth=auth)
    
    if res.status_code == 201:
        media_id = res.json().get('id')
        print(f"  -> Image uploaded successfully! Media ID: {media_id}")
        return media_id
    else:
        print(f"  [!] Failed to upload image: {res.text}")
        return None

def get_or_create_category(category_name):
    print(f"  -> Fetching category ID for '{category_name}'...")
    cat_url = f"{WP_URL}/wp-json/wp/v2/categories"
    auth = HTTPBasicAuth(WP_USERNAME, WP_APP_PASSWORD)
    
    # Check if category exists
    res = requests.get(f"{cat_url}?search={category_name}", auth=auth)
    if res.status_code == 200:
        categories = res.json()
        for cat in categories:
            if cat.get('name', '').lower() == category_name.lower():
                return cat.get('id')
    
    # Create if not exists
    print(f"  -> Category not found. Creating '{category_name}'...")
    res = requests.post(cat_url, json={'name': category_name}, auth=auth)
    if res.status_code == 201:
        return res.json().get('id')
    else:
        print(f"  [!] Failed to create category: {res.text}")
        return None

def create_wp_post(data, media_id, category_id):
    print(f"  -> Creating post in WordPress...")
    posts_url = f"{WP_URL}/wp-json/wp/v2/posts"
    
    post_data = {
        'title': data['title'],
        'content': data['content'],
        'status': POST_STATUS
    }
    
    # Parse date (DD/MM/YYYY) to ISO8601 (YYYY-MM-DDTHH:MM:SS) for WP
    try:
        parsed_date = datetime.strptime(data['date'], "%d/%m/%Y")
        post_data['date'] = parsed_date.strftime("%Y-%m-%dT12:00:00") # Defaulting time to noon
    except Exception as e:
        print(f"  [!] Failed to parse date '{data['date']}', using today's date instead.")

    if media_id:
        post_data['featured_media'] = media_id
        
    if category_id:
        post_data['categories'] = [category_id]
        
    auth = HTTPBasicAuth(WP_USERNAME, WP_APP_PASSWORD)
    res = requests.post(posts_url, json=post_data, auth=auth)
    
    if res.status_code == 201:
        post_url = res.json().get('link')
        print(f"  -> Post created successfully! URL: {post_url}")
        return post_url
    else:
        print(f"  [!] Failed to create post: {res.text}")
        return None

async def main():
    if not WP_URL or not WP_USERNAME or not WP_APP_PASSWORD:
        print("ERROR: Please configure your .env file with WordPress credentials first.")
        return

    # Connect to Google Sheets
    print(f"Mengoneksikan ke Google Sheets...")
    sheet_id = "1fJOXx9mEmM1vR_PUH0YrMXdy29aE9tZb9jA786IPqbU"
    sheet_name = "link"
    
    try:
        # This requires credentials.json to be present in the same directory
        gc = gspread.service_account(filename='credentials.json')
        sh = gc.open_by_key(sheet_id)
        worksheet = sh.worksheet(sheet_name)
    except Exception as e:
        print(f"ERROR: Gagal terhubung ke Google Sheets. Pastikan credentials.json valid. Detail: {e}")
        return
    
    # Get all records to process
    all_values = worksheet.get_all_values()
    
    # We will store tuples of (row_number, url, cat_name)
    tasks = []
    
    # Process rows
    for i in range(1, len(all_values)):
        row = all_values[i]
        # Column B (index 1) contains the Link Berita
        if len(row) > 1 and row[1].strip() and row[1].startswith("http"):
            # Check if Column C is empty (index 2) so we don't repost
            if len(row) <= 2 or not row[2].strip():
                # gspread row numbers are 1-indexed, so row[0] in all_values is row 1
                row_num = i + 1
                url = row[1].strip()
                # Baca Kategori dari Kolom E (indeks 4) jika ada, jika tidak tebak dari URL
                if len(row) > 4 and row[4].strip():
                    cat_name = row[4].strip()
                else:
                    cat_name = "Nanggroe" if "aceh.atrbpn.go.id" in url else "Nasional"
                    
                tasks.append((row_num, url, cat_name))
            
    if not tasks:
        print("No new URLs found in Google Sheets.")
        return

    print(f"Found {len(tasks)} URLs to process.")
    
    # Cache categories to avoid multiple API calls
    category_cache = {}
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        for row_num, url, cat_name in tasks:
            print(f"\n{'='*50}")
            
            # Determine Category
            if cat_name not in category_cache:
                category_cache[cat_name] = get_or_create_category(cat_name)
            category_id = category_cache[cat_name]
            data = await scrape_article(page, url)
            
            if data:
                print(f"  -> Title: {data['title'][:50]}...")
                
                # 1. Upload Image
                media_id = upload_image_to_wp(data['image_url'], data['title'])
                
                # 2. Create Post
                post_url = create_wp_post(data, media_id, category_id)
                
                if post_url:
                    print(f"  -> Writing URL back to Spreadsheet at C{row_num}...")
                    worksheet.update_acell(f"C{row_num}", post_url)
            else:
                print("  [!] Skipping URL due to scraping failure.")
                
        await browser.close()
    
    print(f"\n{'='*50}")
    print("All tasks completed!")

if __name__ == "__main__":
    asyncio.run(main())
