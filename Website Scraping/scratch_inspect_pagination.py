import asyncio
from playwright.async_api import async_playwright

async def inspect():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto("https://www.atrbpn.go.id/berita", wait_until="networkidle")
        
        # Give it a moment to load
        await page.wait_for_timeout(3000)
        
        # Try to find pagination elements
        # Usually it's nav, ul.pagination, or something at the bottom
        html = await page.evaluate("""
        () => {
            let paginations = Array.from(document.querySelectorAll('ul.pagination, nav[aria-label*="pagination"], .pagination'));
            if (paginations.length > 0) {
                return paginations[0].outerHTML;
            }
            // Fallback: get the HTML of the bottom part of the page container
            let container = document.querySelector('.container');
            if (container) {
                return container.innerHTML.substring(container.innerHTML.length - 2000);
            }
            return "Not found";
        }
        """)
        print("PAGINATION HTML:")
        print(html)
        await browser.close()

if __name__ == "__main__":
    asyncio.run(inspect())
