const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://dumpor.com/v/kanwilbpnaceh', { waitUntil: 'domcontentloaded' });
  const posts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.post')).map(el => {
       const a = el.querySelector('a');
       const desc = el.querySelector('.post-desc');
       return { 
          link: a ? a.href : '', 
          caption: desc ? desc.textContent.trim() : ''
       };
    }).filter(p => p.link);
  });
  console.log('Posts:', posts.length);
  if (posts.length > 0) console.log(posts[0].caption.substring(0, 100));
  await browser.close();
})();
