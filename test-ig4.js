const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://www.instagram.com/kanwilbpnaceh/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));
  const posts = await page.evaluate(() => {
    const els = document.querySelectorAll('a');
    return Array.from(els).filter(a => a.href && a.href.includes('/p/')).map(el => {
       const img = el.querySelector('img');
       return { href: el.href, alt: img ? img.alt : '' };
    });
  });
  console.log('Posts length:', posts.length);
  if (posts.length > 0) console.log(posts[0]);
  await browser.close();
})();
