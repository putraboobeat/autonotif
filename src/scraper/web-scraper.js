const puppeteer = require('puppeteer');
const { WebArticleModel, ConfigModel } = require('../database/models');
const { createLogger } = require('../utils/logger');

const log = createLogger('WEB-SCRAPER');

// Fetch latest links from the target source
async function fetchLatestLinks(options = {}) {
  const isEnabled = ConfigModel.get('web_enabled') === '1';
  if (!isEnabled && !options.isManual) {
    return { success: false, message: 'Web Scraper dinonaktifkan.' };
  }

  const sourceUrl = ConfigModel.get('web_source_url') || 'https://www.atrbpn.go.id/berita';
  ConfigModel.set('web_scraper_status', 'Fetching links...');
  log.info(`[WEB-SCRAPER] Fetching links from ${sourceUrl}`);
  
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait for the news cards
    try {
      await page.waitForSelector('div.pt-3.text-start, a[href*="/berita/"], .card, article', { timeout: 10000 });
    } catch {
      log.warn('[WEB-SCRAPER] Selector timeout, attempting fallback evaluation...');
    }
    
    // Evaluate page context to extract links
    const articles = await page.evaluate(() => {
      const results = [];
      const cards = document.querySelectorAll('div.pt-3.text-start');
      
      if (cards.length > 0) {
        cards.forEach(card => {
          const a = card.querySelector('a');
          if (!a) return;
          const href = a.getAttribute('href');
          if (!href) return;
          
          const dateSpan = card.querySelector('span.align-middle, small, .date');
          const dateText = dateSpan ? dateSpan.innerText.trim() : '';
          
          results.push({ href, date: dateText });
        });
      } else {
        // Fallback generic article selector
        const links = Array.from(document.querySelectorAll('a[href*="/berita/"]'));
        links.forEach(a => {
          const href = a.getAttribute('href');
          if (href && href !== '/berita' && href !== 'https://www.atrbpn.go.id/berita') {
            results.push({ href, date: '' });
          }
        });
      }
      return results;
    });
    
    let addedCount = 0;
    const parsedUrl = new URL(sourceUrl);
    const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
    
    for (const item of articles) {
      let fullUrl = item.href;
      if (!fullUrl.startsWith('http')) {
        fullUrl = `${baseUrl}${fullUrl.startsWith('/') ? '' : '/'}${fullUrl}`;
      }
      
      if (fullUrl === sourceUrl || fullUrl === `${sourceUrl}/`) continue;
      
      const categoryName = fullUrl.includes('aceh.atrbpn.go.id') ? 'Nanggroe' : 'Nasional';
      
      const existing = WebArticleModel.getByUrl(fullUrl);
      if (!existing) {
        WebArticleModel.save({
          url: fullUrl,
          title: '',
          post_date: item.date || '',
          category: categoryName,
          status: 'pending'
        });
        addedCount++;
        log.info(`[WEB-SCRAPER] Found new link: ${fullUrl}`);
      }
    }
    
    ConfigModel.set('last_web_fetch_time', new Date().toISOString());
    ConfigModel.set('web_scraper_status', 'idle');
    log.info(`[WEB-SCRAPER] Fetch completed. ${addedCount} new articles added.`);
    return { success: true, added: addedCount, totalFound: articles.length };
    
  } catch (error) {
    log.error(`[WEB-SCRAPER] Fetch error: ${error.message}`);
    ConfigModel.set('web_scraper_status', `error: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

// Scrape article content and post to WP
async function postArticlesToWP(options = {}) {
  const isEnabled = ConfigModel.get('web_enabled') === '1';
  if (!isEnabled && !options.isManual) {
    return { success: false, message: 'Web Scraper dinonaktifkan.' };
  }

  const wpUrl = (ConfigModel.get('web_wp_url') || '').replace(/\/$/, '');
  const wpUser = ConfigModel.get('web_wp_username');
  const wpPass = ConfigModel.get('web_wp_password');
  const postStatus = ConfigModel.get('web_wp_status') || 'draft';
  
  if (!wpUrl || !wpUser || !wpPass) {
    log.warn('[WEB-SCRAPER] WP Credentials not configured.');
    return { success: false, error: 'Kredensial WordPress belum disetting di Dashboard.' };
  }

  const unposted = WebArticleModel.getUnposted();
  if (unposted.length === 0) {
    return { success: true, message: 'Tidak ada artikel pending untuk diposting.' };
  }

  ConfigModel.set('web_scraper_status', `Posting ${unposted.length} articles to WordPress...`);
  
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    
    // Auth header for WP REST API
    const authHeader = `Basic ${Buffer.from(`${wpUser}:${wpPass}`).toString('base64')}`;
    
    // Category Helper using native fetch
    async function getOrCreateCategory(catName) {
      if (!catName) return [];
      try {
        const searchRes = await fetch(`${wpUrl}/wp-json/wp/v2/categories?search=${encodeURIComponent(catName)}`, {
          headers: { 'Authorization': authHeader, 'Accept': 'application/json' }
        });
        if (searchRes.ok) {
          const catList = await searchRes.json();
          if (Array.isArray(catList) && catList.length > 0) {
            const exactMatch = catList.find(c => c.name.toLowerCase() === catName.toLowerCase());
            if (exactMatch) return [exactMatch.id];
            return [catList[0].id];
          }
        }
        
        // Create new category
        const createRes = await fetch(`${wpUrl}/wp-json/wp/v2/categories`, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ name: catName })
        });
        if (createRes.ok) {
          const created = await createRes.json();
          return [created.id];
        }
      } catch (err) {
        log.error(`[WP-API] Failed to get/create category ${catName}: ${err.message}`);
      }
      return [];
    }
    
    let postedCount = 0;
    for (const item of unposted) {
      log.info(`[WEB-SCRAPER] Scraping article: ${item.url}`);
      try {
        await page.goto(item.url, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Wait for title
        try {
          await page.waitForSelector('h3.card-title, h1, .title, article h1', { timeout: 15000 });
        } catch {}
        
        const scraped = await page.evaluate(() => {
          const titleEl = document.querySelector('h3.card-title, h1, .article-title');
          const title = titleEl ? titleEl.innerText.trim() : 'Tanpa Judul';
          
          const contentEls = document.querySelectorAll('.cta-5 p, .article-content p, article p');
          let contentHtml = '';
          contentEls.forEach(p => {
            if (p.innerText.trim()) contentHtml += `<p>${p.innerHTML}</p>`;
          });
          
          const imgEl = document.querySelector('img[src*="/assets/"], .article-image img, article img');
          const imgUrl = imgEl ? imgEl.src : null;
          
          return { title, contentHtml, imgUrl };
        });
        
        // Upload featured image to WP if exists
        let mediaId = null;
        if (scraped.imgUrl) {
          try {
            const imgRes = await fetch(scraped.imgUrl);
            if (imgRes.ok) {
              const arrayBuf = await imgRes.arrayBuffer();
              const imgBuffer = Buffer.from(arrayBuf);
              const safeTitle = (scraped.title || 'featured').replace(/[^a-zA-Z0-9]/g, '-').substring(0, 50);
              const filename = `${safeTitle}.jpg`;
              
              const mediaUploadRes = await fetch(`${wpUrl}/wp-json/wp/v2/media`, {
                method: 'POST',
                headers: {
                  'Authorization': authHeader,
                  'Content-Disposition': `attachment; filename="${filename}"`,
                  'Content-Type': 'image/jpeg',
                  'Accept': 'application/json'
                },
                body: imgBuffer
              });
              if (mediaUploadRes.ok) {
                const mediaData = await mediaUploadRes.json();
                mediaId = mediaData.id;
              }
            }
          } catch (err) {
            log.error(`[WP-API] Failed to upload image: ${err.message}`);
          }
        }
        
        const catIds = await getOrCreateCategory(item.category);
        
        // Prepare WP Post data
        const postData = {
          title: scraped.title,
          content: scraped.contentHtml || `<p>Artikel dari ${item.url}</p>`,
          status: postStatus,
          categories: catIds
        };
        if (mediaId) postData.featured_media = mediaId;
        
        // Push to WP
        const wpPostRes = await fetch(`${wpUrl}/wp-json/wp/v2/posts`, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(postData)
        });
        
        const postResJson = await wpPostRes.json();
        if (!wpPostRes.ok) {
          throw new Error(postResJson.message || `HTTP ${wpPostRes.status}`);
        }
        
        const postedUrl = postResJson.link || '';
        log.info(`[WP-API] Successfully posted: ${postedUrl}`);
        
        // Update DB
        WebArticleModel.updateStatus(item.id, 'posted', '', postedUrl);
        WebArticleModel.save({ ...item, title: scraped.title, status: 'posted', wp_post_url: postedUrl });
        postedCount++;
        
      } catch (err) {
        log.error(`[WEB-SCRAPER] Failed to process ${item.url}: ${err.message}`);
        WebArticleModel.updateStatus(item.id, 'failed', err.message);
      }
    }
    
    ConfigModel.set('web_scraper_status', 'idle');
    return { success: true, posted: postedCount };
    
  } catch (error) {
    log.error(`[WEB-SCRAPER] Process error: ${error.message}`);
    ConfigModel.set('web_scraper_status', `error: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

module.exports = {
  fetchLatestLinks,
  postArticlesToWP
};
