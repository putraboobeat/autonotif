const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://www.instagram.com/kanwilbpnaceh/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));
  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a')).map(a => a.href).filter(h => h.includes('/p/'));
  });
  console.log('Links:', links);
  await browser.close();
})();
