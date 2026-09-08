const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://www.instagram.com/p/DcxNjpXyjfm/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));
  const caption = await page.evaluate(() => {
    // IG often puts the caption in meta tag og:title, formatted as "Author on Instagram: \"Caption...\""
    const meta = document.querySelector('meta[property="og:title"]');
    if (meta) {
      const content = meta.getAttribute('content');
      const match = content.match(/on Instagram: "([^"]+)"/);
      if (match) return match[1];
      return content;
    }
    return '';
  });
  console.log('Caption:', caption);
  await browser.close();
})();
