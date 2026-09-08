const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://www.instagram.com/kanwilbpnaceh/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));
  const posts = await page.evaluate(() => {
    const els = document.querySelectorAll('article a[href^="/p/"]');
    return Array.from(els).map(el => el.href);
  });
  console.log('Posts:', posts);
  await browser.close();
})();
