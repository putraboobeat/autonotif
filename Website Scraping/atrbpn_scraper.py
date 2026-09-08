import asyncio
from playwright.async_api import async_playwright
import json

async def scrape_atrbpn_article(url):
    async with async_playwright() as p:
        # Launch headless browser
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        print(f"Navigating to {url} ...")
        await page.goto(url, wait_until="networkidle")
        
        # Wait for the main content to render
        # We wait for the Title (h3.card-title) to appear on the page
        await page.wait_for_selector('h3.card-title', timeout=10000)

        # 1. Extract Title
        title_element = await page.query_selector('h3.card-title')
        title = await title_element.inner_text() if title_element else "Title not found"

        # 2. Extract Date
        # Based on user HTML: <div class="text-medium mt-2"><em>Tanggal Publikasi : 03/09/2026</em></div>
        date_element = await page.query_selector('.text-medium em') 
        raw_date = await date_element.inner_text() if date_element else ""
        date = raw_date.replace("Tanggal Publikasi : ", "").strip() if raw_date else "Date not found"

        # 3. Extract Content (Paragraphs)
        # Using the specific class .cta-5 p provided by the user
        content_elements = await page.query_selector_all('.cta-5 p')
        content = "\n\n".join([await p.inner_text() for p in content_elements if await p.inner_text()])

        # 4. Extract Main Image URL
        # The images from the CMS use the /assets/ path
        image_element = await page.query_selector('img[src*="/assets/"]')
        image_url = await image_element.get_attribute('src') if image_element else "Image not found"
        
        # Append .jpg if it's an asset URL and missing extension (for WP compatibility)
        if image_url and "/assets/" in image_url and not image_url.endswith(".jpg"):
            # If your WP auto-poster needs .jpg, you can just append it:
            # download_url = image_url + ".jpg" (though usually just downloading it with .jpg works)
            pass

        data = {
            "title": title,
            "date": date,
            "image_url": image_url,
            "content": content
        }

        await browser.close()
        return data

# Example Usage
if __name__ == "__main__":
    test_url = "https://www.atrbpn.go.id/berita/tak-perlu-khawatir-rusak-data-sertipikat-elektronik-tersimpan-di-brankas-elektronik"
    
    result = asyncio.run(scrape_atrbpn_article(test_url))
    print(json.dumps(result, indent=4, ensure_ascii=False))
