const puppeteer = require('puppeteer');
const axios = require('axios');
const { WebArticleModel, ConfigModel } = require('../database/models');
const { log } = require('../utils/logger');
const { getDb } = require('../database/init'); // Actually getDb is from init.js, wait models.js doesn't export getDb, I should use a helper

// Fetch latest links from the target source
async function fetchLatestLinks() {
  const isEnabled = ConfigModel.get('web_enabled') === '1';
  if (!isEnabled) return { success: false, message: 'Web Scraper dinonaktifkan.' };

  const sourceUrl = ConfigModel.get('web_source_url') || 'https://www.atrbpn.go.id/berita';
  ConfigModel.set('web_scraper_status', 'Fetching links...');
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    
    log.info(`[WEB-SCRAPER] Fetching links from ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait for the cards
    await page.waitForSelector('div.pt-3.text-start', { timeout: 10000 });
    
    // Evaluate page context to extract links
    const articles = await page.evaluate(() => {
      const cards = document.querySelectorAll('div.pt-3.text-start');
      const results = [];
      cards.forEach(card => {
        const a = card.querySelector('a');
        if (!a) return;
        const href = a.getAttribute('href');
        if (!href) return;
        
        const dateSpan = card.querySelector('span.align-middle');
        const dateText = dateSpan ? dateSpan.innerText.trim() : '';
        
        results.push({ href, date: dateText });
      });
      return results;
    });
    
    let addedCount = 0;
    const parsedUrl = new URL(sourceUrl);
    const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
    
    for (const item of articles) {
      let fullUrl = item.href;
      if (!fullUrl.startsWith('http')) {
        fullUrl = `${baseUrl}${fullUrl}`;
      }
      
      if (fullUrl === sourceUrl) continue;
      
      const categoryName = fullUrl.includes("aceh.atrbpn.go.id") ? "Nanggroe" : "Nasional";
      
      const existing = WebArticleModel.getByUrl(fullUrl);
      if (!existing) {
        WebArticleModel.save({
          url: fullUrl,
          title: '',
          post_date: item.date,
          category: categoryName,
          status: 'pending'
        });
        addedCount++;
        log.info(`[WEB-SCRAPER] Found new link: ${fullUrl}`);
      }
    }
    
    ConfigModel.set('last_web_fetch_time', new Date().toISOString());
    ConfigModel.set('web_scraper_status', 'idle');
    return { success: true, added: addedCount };
    
  } catch (error) {
    log.error(`[WEB-SCRAPER] Fetch error: ${error.message}`);
    ConfigModel.set('web_scraper_status', 'error');
    return { success: false, error: error.message };
  } finally {
    if (browser) await browser.close();
  }
}

// Scrape article content and post to WP
async function postArticlesToWP() {
  const isEnabled = ConfigModel.get('web_enabled') === '1';
  if (!isEnabled) return { success: false, message: 'Web Scraper dinonaktifkan.' };

  const wpUrl = (ConfigModel.get('web_wp_url') || '').replace(/\/$/, '');
  const wpUser = ConfigModel.get('web_wp_username');
  const wpPass = ConfigModel.get('web_wp_password');
  const postStatus = ConfigModel.get('web_wp_status') || 'draft';
  
  if (!wpUrl || !wpUser || !wpPass) {
    log.warn('[WEB-SCRAPER] WP Credentials not configured.');
    return { success: false, error: 'Kredensial WordPress belum disetting.' };
  }

  const unposted = WebArticleModel.getUnposted();
  if (unposted.length === 0) return { success: true, message: 'Tidak ada artikel pending.' };

  ConfigModel.set('web_scraper_status', `Posting ${unposted.length} articles...`);
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    
    // Auth header for WP
    const authHeader = `Basic ${Buffer.from(`${wpUser}:${wpPass}`).toString('base64')}`;
    
    // Category Helper
    async function getOrCreateCategory(catName) {
      if (!catName) return [];
      try {
        const searchRes = await axios.get(`${wpUrl}/wp-json/wp/v2/categories?search=${encodeURIComponent(catName)}`, {
          headers: { 'Authorization': authHeader }
        });
        if (searchRes.data && searchRes.data.length > 0) {
          const exactMatch = searchRes.data.find(c => c.name.toLowerCase() === catName.toLowerCase());
          if (exactMatch) return [exactMatch.id];
          return [searchRes.data[0].id];
        }
        
        // Create new
        const createRes = await axios.post(`${wpUrl}/wp-json/wp/v2/categories`, { name: catName }, {
          headers: { 'Authorization': authHeader }
        });
        return [createRes.data.id];
      } catch (err) {
        log.error(`[WP-API] Failed to get/create category ${catName}: ${err.message}`);
        return [];
      }
    }
    
    for (const item of unposted) {
      log.info(`[WEB-SCRAPER] Scraping article: ${item.url}`);
      try {
        await page.goto(item.url, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Wait for title
        await page.waitForSelector('h3.card-title', { timeout: 15000 });
        
        const scraped = await page.evaluate(() => {
          const titleEl = document.querySelector('h3.card-title');
          const title = titleEl ? titleEl.innerText : 'Tanpa Judul';
          
          const contentEls = document.querySelectorAll('.cta-5 p');
          let contentHtml = '';
          contentEls.forEach(p => {
             if(p.innerText.trim()) contentHtml += `<p>${p.innerHTML}</p>`;
          });
          
          const imgEl = document.querySelector('img[src*="/assets/"]');
          const imgUrl = imgEl ? imgEl.src : null;
          
          return { title, contentHtml, imgUrl };
        });
        
        // Upload image to WP if exists
        let mediaId = null;
        if (scraped.imgUrl) {
          try {
             const imgRes = await axios.get(scraped.imgUrl, { responseType: 'arraybuffer' });
             const safeTitle = scraped.title.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 50);
             const filename = `${safeTitle}.jpg`;
             
             const mediaUploadRes = await axios.post(`${wpUrl}/wp-json/wp/v2/media`, imgRes.data, {
               headers: {
                 'Authorization': authHeader,
                 'Content-Disposition': `attachment; filename="${filename}"`,
                 'Content-Type': 'image/jpeg'
               }
             });
             mediaId = mediaUploadRes.data.id;
          } catch(err) {
             log.error(`[WP-API] Failed to upload image: ${err.message}`);
          }
        }
        
        const catIds = await getOrCreateCategory(item.category);
        
        // Prepare WP Post data
        const postData = {
          title: scraped.title,
          content: scraped.contentHtml,
          status: postStatus,
          categories: catIds
        };
        if (mediaId) postData.featured_media = mediaId;
        
        // Push to WP
        const wpPostRes = await axios.post(`${wpUrl}/wp-json/wp/v2/posts`, postData, {
          headers: { 'Authorization': authHeader }
        });
        
        const postedUrl = wpPostRes.data.link;
        log.info(`[WP-API] Successfully posted: ${postedUrl}`);
        
        // Update DB
        WebArticleModel.updateStatus(item.id, 'posted', '', postedUrl);
        // Update title
        WebArticleModel.save({ ...item, title: scraped.title, status: 'posted', wp_post_url: postedUrl });
        
      } catch (err) {
        log.error(`[WEB-SCRAPER] Failed to process ${item.url}: ${err.message}`);
        WebArticleModel.updateStatus(item.id, 'failed', err.message);
      }
    }
    
    ConfigModel.set('web_scraper_status', 'idle');
    return { success: true };
    
  } catch (error) {
    log.error(`[WEB-SCRAPER] Process error: ${error.message}`);
    ConfigModel.set('web_scraper_status', 'error');
    return { success: false, error: error.message };
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = {
  fetchLatestLinks,
  postArticlesToWP
};
