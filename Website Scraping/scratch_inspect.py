import asyncio
from playwright.async_api import async_playwright

async def inspect():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto("https://www.atrbpn.go.id/berita", wait_until="networkidle")
        await page.wait_for_selector('a[href^="/berita/"]', timeout=15000)
        
        # Get the first card's HTML
        # Assuming cards are usually col-md-4 or similar, let's just get the parent element of the first link
        links = await page.query_selector_all('a[href^="/berita/"]')
        for link in links:
            html = await link.evaluate("node => node.parentElement.parentElement.outerHTML")
            print(html)
            break
        await browser.close()

if __name__ == "__main__":
    asyncio.run(inspect())
