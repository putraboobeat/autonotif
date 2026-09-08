const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://www.instagram.com/p/DcxNjpXyjfm/', { waitUntil: 'networkidle2' });
  const date = await page.evaluate(() => {
    const timeEl = document.querySelector('time');
    return timeEl ? timeEl.getAttribute('datetime') : null;
  });
  console.log('Date:', date);
  await browser.close();
})();
