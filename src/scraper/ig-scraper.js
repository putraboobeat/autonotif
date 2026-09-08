const { getBrowser, getPage } = require('./browser');
const { IgRuleModel, IgPostModel, ConfigModel } = require('../database/models');
const { sendGroupMessage } = require('../notifier/starsender');
const { createLogger } = require('../utils/logger');

const log = createLogger('IG-SCRAPER');

async function scrapeInstagram() {
  const isEnabled = ConfigModel.get('ig_enabled');
  if (isEnabled !== '1') {
    return;
  }

  const usernameConfig = ConfigModel.get('ig_username');
  if (!usernameConfig) {
    log.warn('IG Scraper enabled but ig_username is empty');
    return;
  }

  const usernames = usernameConfig.split(',').map(u => u.trim()).filter(Boolean);
  if (usernames.length === 0) {
    log.warn('No valid IG usernames found to scrape.');
    return;
  }

  const activeRules = IgRuleModel.getActive();
  if (activeRules.length === 0) {
    log.debug('No active IG rules found. Skipping scrape.');
    return;
  }

  ConfigModel.set('ig_scraper_status', 'running');
  
  let page = getPage();
  if (!page) {
    log.warn('Browser page not available yet for IG scraper. Skipping...');
    return;
  }

  try {
    for (const username of usernames) {
      log.info(`Checking Instagram for @${username}...`);
      
      // We create a new page for IG to avoid messing with OCA page
      const browser = getBrowser();
      const igPage = await browser.newPage();
      
      // Block unnecessary resources
      await igPage.setRequestInterception(true);
      igPage.on('request', (req) => {
        const resourceType = req.resourceType();
        if (['image', 'font', 'media', 'stylesheet'].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      // Go to profile
      const url = `https://www.instagram.com/${username}/`;
      await igPage.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Wait for articles to load
      try {
        await igPage.waitForSelector('article a[href^="/p/"]', { timeout: 10000 });
      } catch (err) {
        log.warn(`Could not find posts for @${username}. Maybe private or blocked.`);
        await igPage.close();
        continue; // Try next user
      }

      // Extract posts
      const posts = await igPage.evaluate(() => {
        const postElements = document.querySelectorAll('article a[href^="/p/"]');
        const results = [];
        
        postElements.forEach(el => {
          const href = el.getAttribute('href');
          const match = href.match(/\/p\/(.+?)\//);
          if (match) {
            const shortcode = match[1];
            const img = el.querySelector('img');
            const caption = img ? img.getAttribute('alt') || '' : '';
            results.push({ shortcode, caption, link: `https://www.instagram.com/p/${shortcode}/` });
          }
        });
        return results;
      });
      
      await igPage.close();
      
      log.info(`Found ${posts.length} posts for @${username}`);

      for (const post of posts) {
        // Check if already processed
        if (IgPostModel.isProcessed(post.shortcode)) {
          continue;
        }
        
        let matchedRule = null;
        const lowerCaption = post.caption.toLowerCase();
        
        for (const rule of activeRules) {
          const lowerCode = rule.code.toLowerCase();
          if (lowerCaption.includes(lowerCode)) {
            matchedRule = rule;
            break; // First match wins
          }
        }
        
        if (matchedRule) {
          log.info(`Post ${post.shortcode} matched rule code: ${matchedRule.code}`);
          
          // Format message
          const message = `📸 *INFO POSTINGAN BARU* 📸\n\nAda postingan Instagram terbaru (@${username}) yang terkait dengan instansi Anda.\n\n*Kode:* ${matchedRule.code}\n*Caption:* ${post.caption.substring(0, 300)}${post.caption.length > 300 ? '...' : ''}\n\n*Link:* ${post.link}\n\n_Pesan otomatis dari Auto Notif Pengaduan_`;
          
          // Send to group
          const result = await sendGroupMessage(matchedRule.target_group, message);
          
          // Save to processed
          IgPostModel.save({
            shortcode: post.shortcode,
            caption: post.caption,
            matched_code: matchedRule.code,
            notified_group: matchedRule.target_group
          });
          
        } else {
          // Save as processed even if no match so we don't check it again
          IgPostModel.save({
            shortcode: post.shortcode,
            caption: post.caption,
            matched_code: '',
            notified_group: ''
          });
        }
      }
    } // End of loop over usernames

  } catch (error) {
    log.error('Error scraping Instagram', { error: error.message });
  } finally {
    ConfigModel.set('ig_scraper_status', 'stopped');
    ConfigModel.set('last_ig_scrape_time', new Date().toISOString());
  }
}

module.exports = {
  scrapeInstagram
};
